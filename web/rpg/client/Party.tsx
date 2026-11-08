"use client";

import { useEffect, useState } from "react";
import { RUINS, type DungeonState } from "../shared/data/dungeons";
import { JOBS, LINES, type LineId } from "../shared/data/jobs";
import { PARTY, PINGS, PING_WHEEL, TITLES, type PartyAd, type PartyVitals, type PartyView } from "../shared/data/party";
import type { S2C, You } from "../shared/protocol";
import type { HudState } from "./game";
import { t, type StrKey } from "./i18n";

/** P7 파티 · 던전 · 결투 화면 (§21 · §20-4 · §13-3) */

type Send = (m: Parameters<import("./net").Net["send"]>[0]) => void;
export type Who = Extract<S2C, { t: "who" }>["list"];
export type Ask = Extract<S2C, { t: "ask" }>;

const jobName = (jb: string) => (!jb ? "견습" : jb in LINES ? LINES[jb as LineId].name : (JOBS[jb]?.name ?? ""));
const mmss = (ms: number) => { const s = Math.max(0, Math.ceil(ms / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`; };

function Window({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="rpg-modal-bg">
      <div className="rpg-panel relative w-[600px] max-w-[96vw] p-4 text-[12px]">
        <button className="rpg-x" onClick={onClose} aria-label={t("hud.close")}>✕</button>
        <h2 className="mb-2 text-base font-bold">{title}</h2>
        {children}
      </div>
    </div>
  );
}

const Row = ({ children }: { children: React.ReactNode }) => <div className="mb-1.5 flex items-center gap-2 rounded border border-[#c9a97a] bg-[#f6e9c8] px-2 py-1.5">{children}</div>;

// ── 파티창 (P) ─────────────────────────────────────────────────────────
type Tab = "party" | "ads" | "near" | "me";
export function PartyWindow({ you, party, ads, who, titles, send, onClose }: {
  you: You; party: PartyView | null; ads: PartyAd[]; who: Who; titles: { list: string[]; on: string | null }; send: Send; onClose: () => void;
}) {
  const [tab, setTab] = useState<Tab>("party");
  const [name, setName] = useState("");
  const [note, setNote] = useState(party?.note ?? "");
  const [open, setOpen] = useState(party?.open ?? false);
  const meId = party?.members.find((m) => m.eid === you.id)?.cid ?? 0;
  const leader = !!party && party.leader === meId;
  const inParty = (n: string) => !!party?.members.some((m) => m.name === n);
  useEffect(() => { setNote(party?.note ?? ""); setOpen(party?.open ?? false); }, [party?.id, party?.note, party?.open]);
  const go = (k: Tab) => {
    setTab(k);
    if (k === "ads") send({ t: "party", op: "list" });
    if (k === "near") send({ t: "who" });
  };
  const tabBtn = (k: Tab) => <button key={k} className="rpg-btn" data-on={tab === k} onClick={() => go(k)}>{t(`pt.tab.${k}` as StrKey)}</button>;
  return (
    <Window title={t("pt.title")} onClose={onClose}>
      <div className="mb-2 flex flex-wrap gap-1.5">{(["party", "ads", "near", "me"] as Tab[]).map(tabBtn)}</div>
      <div className="max-h-[440px] overflow-y-auto pr-1">
        {tab === "party" && (
          <>
            {!party ? (
              <div className="py-3 text-center">
                <p className="mb-2 text-[#6d513b]">{t("pt.none")}</p>
                <button className="rpg-btn" onClick={() => send({ t: "party", op: "create" })}>{t("pt.create")}</button>
              </div>
            ) : (
              <>
                {party.dungeon && <p className="mb-1.5 text-[11px] font-bold text-[#7a3fbf]">⚑ {t("pt.dungeon")}</p>}
                {party.members.map((m) => (
                  <Row key={m.cid}>
                    <span className="w-4 text-center">{m.cid === party.leader ? "👑" : ""}</span>
                    <b className={m.online ? "" : "opacity-50"}>{m.name}</b>
                    <span className="text-[11px] text-[#8c6642]">{m.online ? `Lv${m.lv} ${jobName(m.jb)} · ${t(`pt.where.${m.where}` as StrKey)}${m.where === "dungeon" ? "" : ` ${m.ch}ch`}` : t("pt.offline")}</span>
                    <span className="flex-1" />
                    {leader && m.cid !== meId && <button className="rpg-btn !px-1.5 !py-0.5 !text-[10px]" onClick={() => send({ t: "party", op: "promote", cid: m.cid })}>{t("pt.promote")}</button>}
                    {leader && m.cid !== meId && <button className="rpg-btn !px-1.5 !py-0.5 !text-[10px]" onClick={() => send({ t: "party", op: "kick", cid: m.cid })}>{t("pt.kick")}</button>}
                  </Row>
                ))}
                <p className="mb-2 text-[11px] text-[#8c6642]">{party.members.length}/{PARTY.max} · {t("pt.share")}</p>
                {leader && party.requests.length > 0 && (
                  <>
                    <h3 className="mb-1 font-bold">{t("pt.requests")}</h3>
                    {party.requests.map((r) => (
                      <Row key={r.cid}>
                        <b>{r.name}</b><span className="text-[11px] text-[#8c6642]">Lv{r.lv}</span><span className="flex-1" />
                        <button className="rpg-btn !px-1.5 !py-0.5 !text-[10px]" onClick={() => send({ t: "party", op: "approve", cid: r.cid })}>{t("pt.approve")}</button>
                        <button className="rpg-btn !px-1.5 !py-0.5 !text-[10px]" onClick={() => send({ t: "party", op: "reject", cid: r.cid })}>{t("pt.reject")}</button>
                      </Row>
                    ))}
                  </>
                )}
                {leader && (
                  <div className="mb-2 flex items-center gap-1.5">
                    <label className="flex items-center gap-1 text-[11px]"><input type="checkbox" checked={open} onChange={(e) => setOpen(e.target.checked)} />{t("pt.open")}</label>
                    <input className="rpg-input flex-1" maxLength={PARTY.noteMax} placeholder={t("pt.notePh")} value={note} onChange={(e) => setNote(e.target.value)} />
                    <button className="rpg-btn !py-0.5" onClick={() => send({ t: "party", op: "open", on: open, note })}>{t("pt.save")}</button>
                  </div>
                )}
                <div className="flex gap-1.5">
                  <button className="rpg-btn" onClick={() => send({ t: "party", op: "leave" })}>{t("pt.leave")}</button>
                  {leader && <button className="rpg-btn" onClick={() => send({ t: "party", op: "disband" })}>{t("pt.disband")}</button>}
                </div>
              </>
            )}
            {(!party || leader) && (
              <form className="mt-3 flex gap-1.5" onSubmit={(e) => { e.preventDefault(); if (name.trim()) send({ t: "party", op: "invite", name: name.trim() }); setName(""); }}>
                <input className="rpg-input flex-1" maxLength={12} placeholder={t("pt.invitePh")} value={name} onChange={(e) => setName(e.target.value)} />
                <button className="rpg-btn" type="submit">{t("pt.invite")}</button>
              </form>
            )}
          </>
        )}
        {tab === "ads" && (ads.length ? ads.map((a) => (
          <Row key={a.id}>
            <b>{a.leader}</b><span className="text-[11px] text-[#8c6642]">Lv{a.lv} · {a.n}/{PARTY.max}</span>
            <span className="flex-1 truncate">{a.note}</span>
            <button className="rpg-btn !px-1.5 !py-0.5 !text-[10px]" disabled={!!party} onClick={() => send({ t: "party", op: "request", id: a.id })}>{t("pt.request")}</button>
          </Row>
        )) : <p className="py-6 text-center text-[#8c6642]">{t("pt.ads.empty")}</p>)}
        {tab === "near" && (
          <>
            <p className="mb-1.5 text-[11px] text-[#8c6642]">{t("pt.duelHint")}</p>
            {who.filter((w) => w.name !== you.nickname).length ? who.filter((w) => w.name !== you.nickname).map((w) => (
              <Row key={w.name}>
                <b className={inParty(w.name) ? "text-[#3d7a14]" : ""}>{w.name}</b>
                <span className="text-[11px] text-[#8c6642]">Lv{w.lv} {jobName(w.jb)} · {w.kda.join("/")}</span>
                <span className="flex-1" />
                {!inParty(w.name) && (!party || leader) && <button className="rpg-btn !px-1.5 !py-0.5 !text-[10px]" onClick={() => send({ t: "party", op: "invite", name: w.name })}>{t("pt.invite")}</button>}
                {!party && <button className="rpg-btn !px-1.5 !py-0.5 !text-[10px]" onClick={() => send({ t: "party", op: "request", name: w.name })}>{t("pt.request")}</button>}
                {!inParty(w.name) && <button className="rpg-btn !px-1.5 !py-0.5 !text-[10px]" onClick={() => send({ t: "duel", op: "ask", name: w.name })}>{t("pt.duel")}</button>}
                {leader && !inParty(w.name) && <button className="rpg-btn !px-1.5 !py-0.5 !text-[10px]" onClick={() => send({ t: "duel", op: "ask", name: w.name, party: true })}>{t("pt.duelParty")}</button>}
              </Row>
            )) : <p className="py-6 text-center text-[#8c6642]">{t("pt.near.empty")}</p>}
          </>
        )}
        {tab === "me" && (
          <>
            <p className="mb-2">{t("pt.kda")}: <b>{you.kda.join(" / ")}</b></p>
            <h3 className="mb-1 font-bold">{t("pt.titles")}</h3>
            {!titles.list.length && <p className="text-[#8c6642]">{t("pt.titlesEmpty")}</p>}
            {titles.list.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                <button className="rpg-btn" data-on={!titles.on} onClick={() => send({ t: "title", id: null })}>{t("pt.noTitle")}</button>
                {titles.list.map((id) => <button key={id} className="rpg-btn" data-on={titles.on === id} onClick={() => send({ t: "title", id })}>「{TITLES[id] ?? id}」</button>)}
              </div>
            )}
          </>
        )}
      </div>
    </Window>
  );
}

// ── 파티 프레임 (미니맵 아래, §21-1) ───────────────────────────────────────
export function PartyFrames({ party, pv, you, here }: { party: PartyView | null; pv: PartyVitals[]; you: You; here: { kind: string; ch: number } }) {
  if (!party || party.members.length < 2) return null;
  const vit = new Map(pv.map((r) => [r[0], r]));
  return (
    <div className="mt-1.5 flex w-[160px] flex-col gap-1">
      {party.members.filter((m) => m.eid !== you.id).map((m) => {
        const v = vit.get(m.cid);
        const away = !v || v[5] !== here.kind || (here.kind !== "dungeon" && v[6] !== here.ch);
        const dead = v?.[7] === 1;
        return (
          <div key={m.cid} className={`rpg-chip !block !px-1.5 !py-1 !text-left ${!m.online || dead ? "opacity-60" : ""}`}>
            <div className="flex justify-between text-[10px]">
              <b className="truncate text-[#9be36b]">{m.cid === party.leader ? "👑 " : ""}{m.name}</b>
              <span className="text-white/70">{m.online ? (dead ? "✝" : away ? t(`pt.where.${m.where}` as StrKey) : `Lv${m.lv}`) : t("pt.offline")}</span>
            </div>
            <div className="mt-0.5 h-1.5 overflow-hidden rounded-sm bg-[#1b1420]"><div className="h-full bg-[#4CC764]" style={{ width: `${(v?.[1] ?? 0) / 10}%` }} /></div>
            <div className="mt-px h-1 overflow-hidden rounded-sm bg-[#1b1420]"><div className="h-full bg-[#2f7bff]" style={{ width: `${(v?.[2] ?? 0) / 10}%` }} /></div>
          </div>
        );
      })}
    </div>
  );
}

// ── 확인 창: 결투 신청 · 던전 입장 ──────────────────────────────────────────
export function AskPrompt({ ask, send, onClose }: { ask: Ask; send: Send; onClose: () => void }) {
  if (ask.kind === "duel") {
    return (
      <div className="rpg-panel pointer-events-auto absolute left-1/2 top-28 w-[320px] -translate-x-1/2 p-3 text-center text-[12px]">
        <p className="font-bold">{t(ask.party ? "ask.duelParty" : "ask.duel", { from: ask.from })}</p>
        <div className="mt-2 flex justify-center gap-2">
          <button className="rpg-btn" onClick={() => { send({ t: "duel", op: "accept", id: ask.id }); onClose(); }}>{t("ask.accept")}</button>
          <button className="rpg-btn" onClick={() => { send({ t: "duel", op: "decline", id: ask.id }); onClose(); }}>{t("ask.decline")}</button>
        </div>
      </div>
    );
  }
  return (
    <div className="rpg-modal-bg">
      <div className="rpg-panel relative w-[380px] max-w-[96vw] p-4 text-center text-[12px]">
        <h2 className="mb-1 text-base font-bold">{t("ask.dungeon")}</h2>
        <p className="text-[11px] text-[#8c6642]">{RUINS.name} · {ask.recommend}</p>
        <p className="mt-2 text-[11px] text-[#6d513b]">{t("ask.dungeonWho")}</p>
        <p className="font-bold">{ask.members.join(", ")}</p>
        <p className="mt-2 text-[11px] text-[#8c6642]">{t("ask.dungeonNote")}</p>
        <div className="mt-3 flex justify-center gap-2">
          <button className="rpg-btn" onClick={() => { send({ t: "dungeon", op: "enter" }); onClose(); }}>{t("ask.enter")}</button>
          <button className="rpg-btn" onClick={onClose}>{t("ask.cancel")}</button>
        </div>
      </div>
    </div>
  );
}

// ── 던전 HUD (위 가운데) · 보스 HP 바 ─────────────────────────────────────
export function DungeonHud({ dg, hud, at, send }: { dg: DungeonState; hud: HudState; at: number; send: Send }) {
  const [sure, setSure] = useState(false);
  const ms = Math.max(0, dg.ms - (Date.now() - at));
  const line =
    dg.phase === "fight" ? `${t("dg.left", { n: dg.left })}${dg.ms ? ` · ${t("dg.limit", { t: mmss(ms) })}` : ""}` :
    dg.phase === "rest" ? t("dg.rest", { s: Math.ceil(ms / 1000) }) :
    dg.phase === "open" ? t("dg.open") : dg.phase === "clear" ? t("dg.clear") : t("dg.fail");
  return (
    <div className="pointer-events-auto absolute left-1/2 top-3 flex -translate-x-1/2 flex-col items-center gap-1.5">
      <div className="rpg-chip flex items-center gap-2 !text-[12px]">
        <b className="text-[#F2C94C]">{RUINS.name}</b>
        <span>{t("dg.stage", { n: dg.stage, m: dg.total })} · {dg.name}</span>
        <span className="text-white/80">· {line}</span>
        <span className="text-[#9be36b]">· {t("dg.revives", { n: dg.revives })}</span>
        <span className="text-[#ff9a9e]">· {t("dg.potions", { n: dg.potions })}</span>
        <button className="rpg-btn !px-1.5 !py-0 !text-[10px]" data-on={sure} title={t("dg.leaveConfirm")} onClick={() => { if (sure) send({ t: "dungeon", op: "leave" }); else { setSure(true); setTimeout(() => setSure(false), 3000); } }}>{sure ? t("dg.leaveSure") : t("dg.leave")}</button>
      </div>
      {dg.boss && hud.bossHp >= 0 && (
        <div className="w-[460px] max-w-[80vw] text-center">
          <div className="text-[13px] font-bold text-[#e9d5ff] [text-shadow:0_2px_0_#1b1420]">♛ {dg.boss.name} <span className="text-[11px] font-normal text-white/80">— {dg.boss.phase}</span></div>
          <div className="mt-0.5 h-3.5 overflow-hidden rounded border-2 border-[#3a2a1e] bg-[#1b1420]">
            <div className="h-full bg-gradient-to-b from-[#c084fc] to-[#7e22ce] transition-[width] duration-200" style={{ width: `${hud.bossHp / 10}%` }} />
          </div>
        </div>
      )}
    </div>
  );
}

/** 던전에서 쓰러짐: 관전 + 공용 부활 버튼 (10초 뒤) */
export function GhostOverlay({ dg, since, send }: { dg: DungeonState | null; since: number; send: Send }) {
  const [, tick] = useState(0);
  useEffect(() => { const id = setInterval(() => tick((n) => n + 1), 250); return () => clearInterval(id); }, []);
  const wait = Math.max(0, RUINS.reviveDelayMs - (Date.now() - since));
  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-40 flex justify-center">
      <div className="rpg-panel pointer-events-auto px-6 py-3 text-center">
        <p className="font-bold">{t("dg.ghost")}</p>
        <p className="mt-1 text-[11px] text-[#8c6642]">{t("dg.ghostNote")}</p>
        <button className="rpg-btn mt-2" disabled={wait > 0 || !dg || dg.revives <= 0} onClick={() => send({ t: "dungeon", op: "revive" })}>
          {wait > 0 ? t("dg.reviveIn", { s: Math.ceil(wait / 1000) }) : t("dg.revive", { n: dg?.revives ?? 0 })}
        </button>
      </div>
    </div>
  );
}

// ── 현황판 (Tab 누르고 있기) ─────────────────────────────────────────────
export function Scoreboard({ list, room }: { list: Who; room: string }) {
  return (
    <div className="pointer-events-none absolute left-1/2 top-24 w-[420px] max-w-[92vw] -translate-x-1/2">
      <div className="rpg-chip !block !p-2 !text-left !text-[12px]">
        <b className="text-[#F2C94C]">{t("board.title", { room })}</b>
        <table className="mt-1 w-full">
          <thead><tr className="text-[10px] text-white/60"><th className="text-left">{t("board.name")}</th><th>Lv</th><th className="text-left">{t("sk.job")}</th><th>K/D/A</th></tr></thead>
          <tbody>
            {list.map((w) => (
              <tr key={w.name} className={w.party ? "text-[#9be36b]" : ""}>
                <td>{w.name}</td><td className="text-center">{w.lv}</td><td>{jobName(w.jb)}</td><td className="text-center">{w.kda.join("/")}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── 핑 휠 (G 누르고 있기, §21-3) ──────────────────────────────────────────
export function PingWheel({ wheel }: { wheel: NonNullable<HudState["wheel"]> }) {
  const R = 64;
  return (
    <div className="pointer-events-none absolute" style={{ left: wheel.sx - R - 30, top: wheel.sy - R - 30, width: (R + 30) * 2, height: (R + 30) * 2 }}>
      <div className="absolute inset-[30px] rounded-full border-2 border-white/40 bg-[rgba(20,14,28,0.55)]" />
      {PING_WHEEL.map((k, i) => {
        const a = (i / PING_WHEEL.length) * Math.PI * 2;
        const x = R + 30 + Math.sin(a) * R;
        const y = R + 30 - Math.cos(a) * R;
        const on = wheel.sel === i;
        return (
          <div key={k} className="absolute -translate-x-1/2 -translate-y-1/2 text-center" style={{ left: x, top: y }}>
            <div className={`mx-auto flex h-8 w-8 items-center justify-center rounded-full border-2 text-[16px] ${on ? "scale-125 bg-white/90" : "bg-[rgba(20,14,28,0.8)]"}`} style={{ borderColor: PINGS[k].color, color: on ? "#1b1420" : PINGS[k].color }}>{PINGS[k].icon}</div>
            <div className="mt-0.5 whitespace-nowrap text-[10px] text-white [text-shadow:0_1px_0_#000]">{PINGS[k].name}</div>
          </div>
        );
      })}
      <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 whitespace-nowrap text-[10px] text-white/80">{wheel.sel < 0 ? PINGS.danger.name : ""}</div>
    </div>
  );
}

/** 화면 가운데 큰 글씨 (보스 페이즈 · 스테이지 · 결투) */
export function Banner({ text }: { text: string }) {
  return <div className="rpg-questpop pointer-events-none absolute left-1/2 top-[22%] -translate-x-1/2 text-center text-xl font-bold [text-shadow:0_2px_0_#1b1420]">{text}</div>;
}
