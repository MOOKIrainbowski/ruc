"use client";

import { useEffect, useRef, useState } from "react";
import { CHAT, type ChatChannel } from "../shared/data/chat";
import { ITEMS, RARITIES, RARITY, type Rarity } from "../shared/data/items";
import { ROOM_NAME } from "../shared/data/dungeons";
import type { RoomKind } from "../shared/constants";
import type { S2C } from "../shared/protocol";
import type { HudState } from "./game";
import { t } from "./i18n";
import { iconUrl } from "./art/icons";
import { itemIcon } from "./art/items";

/** P8 운영 화면: 채팅(Enter) · F3 디버그 오버레이 · GM 창(F8) · 버그 제보 (§5 · §28 · §29) */

type Send = (m: Parameters<import("./net").Net["send"]>[0]) => void;
export type ChatLine = { ch: ChatChannel; from: string; text: string; at: number; key: number; to?: string };
/** 채팅 보낼 곳 (Tab 버튼으로 돌아가며) */
export type ChatMode = "room" | "party" | "guild" | "nation";
export type GmData = Omit<Extract<S2C, { t: "gm" }>, "t">;

// ── 클라이언트 로그 (버그 제보에 붙임): 콘솔 오류 · 경고 · 안내 문구 최근 60줄 ────────────────
export const clientLog: string[] = [];
export function logLine(s: string) {
  clientLog.push(`${new Date().toISOString().slice(11, 19)} ${s.slice(0, 280)}`);
  if (clientLog.length > 60) clientLog.shift();
}
let captured = false;
export function captureConsole() {
  if (captured || typeof window === "undefined") return;
  captured = true;
  for (const k of ["error", "warn"] as const) {
    const orig = console[k].bind(console);
    console[k] = (...a: unknown[]) => { logLine(`[${k}] ${a.map(String).join(" ")}`); orig(...a); };
  }
  window.addEventListener("error", (e) => logLine(`[error] ${e.message} @${e.filename}:${e.lineno}`));
  window.addEventListener("unhandledrejection", (e) => logLine(`[reject] ${String(e.reason)}`));
}

// ── 채팅 (Enter, §5) ─────────────────────────────────────────────────
const CH_COLOR: Record<ChatChannel, string> = { room: "#ffffff", party: "#9be36b", system: "#F2C94C", gm: "#ff9a9e", guild: "#7fe3e3", whisper: "#e7a3ff", nation: "#ffb86b" };
const PREFIX: Record<ChatMode, string> = { room: "", party: "/p ", guild: "/g ", nation: "/n " };
/** seed = 채팅을 열면서 미리 넣을 글 (귓속말 버튼: "/w 닉 ") */
export function ChatBox({ lines, open, mode, seed, onSend, onClose, onMode }: {
  lines: ChatLine[]; open: boolean; mode: ChatMode; seed: { text: string; n: number }; onSend: (text: string) => void; onClose: () => void; onMode: () => void;
}) {
  const [text, setText] = useState("");
  useEffect(() => { if (seed.n) setText(seed.text); }, [seed]);
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const [, tick] = useState(0);
  useEffect(() => { if (open) input.current?.focus(); }, [open]);
  useEffect(() => { list.current?.scrollTo(0, list.current.scrollHeight); }, [lines.length, open]);
  useEffect(() => { const id = setInterval(() => tick((n) => n + 1), 2000); return () => clearInterval(id); }, []);
  const now = Date.now();
  const shown = open ? lines : lines.filter((l) => now - l.at < 12_000).slice(-6);
  if (!open && !shown.length) return null;
  return (
    // 왼쪽 아래, 스탯창 · HUD 위 (좁은 화면에서도 겹치지 않게)
    <div className={`pointer-events-auto absolute bottom-[236px] left-3 w-[360px] max-w-[40vw] rounded ${open ? "bg-[rgba(20,14,28,0.72)] p-1.5" : ""}`}>
      <div ref={list} className={`${open ? "max-h-[220px] overflow-y-auto" : ""} flex flex-col gap-px text-[12px] leading-snug [text-shadow:0_1px_0_#000,0_0_3px_#000]`}>
        {shown.map((l) => (
          <div key={l.key} style={{ color: CH_COLOR[l.ch] }} className="whitespace-pre-wrap break-words">
            {l.ch === "party" ? t("chat.tagParty") : l.ch === "gm" ? t("chat.tagGm") : l.ch === "guild" ? t("chat.tagGuild") : l.ch === "nation" ? t("chat.tagNation") : ""}
            {l.ch === "whisper" ? <b>{t("chat.tagWhisper")}{l.from} → {l.to}: </b> : l.from && <b>{l.from}: </b>}{l.text}
          </div>
        ))}
      </div>
      {open && (
        <form className="mt-1 flex gap-1" onSubmit={(e) => { e.preventDefault(); if (text.trim()) onSend(text.startsWith("/") ? text : PREFIX[mode] + text); setText(""); onClose(); }}>
          <button type="button" className="rpg-btn !px-1.5 !py-0 !text-[10px]" data-on={mode !== "room"} onClick={onMode} title={t("chat.toggle")}>{t(`chat.${mode}`)}</button>
          <input
            ref={input} className="rpg-input flex-1 !py-0.5 text-[12px]" maxLength={CHAT.maxLen} value={text} placeholder={t("chat.ph")}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Escape") { e.stopPropagation(); e.nativeEvent.stopImmediatePropagation(); setText(""); onClose(); } }}
          />
        </form>
      )}
    </div>
  );
}

// ── F3 디버그 오버레이 (§29) ────────────────────────────────────────────
export function DebugOverlay({ d, fps }: { d: NonNullable<HudState["dbg"]>; fps: number }) {
  const row = (k: string, v: string, bad = false) => <div className="flex justify-between gap-3"><span className="text-white/60">{k}</span><span className={bad ? "text-[#ff6b6b]" : ""}>{v}</span></div>;
  return (
    <div className="rpg-chip pointer-events-none absolute right-3 top-28 !block w-[170px] !p-2 font-mono !text-[11px]">
      <b className="text-[#F2C94C]">{t("dbg.title")}</b>
      {row("FPS", String(fps), fps < 55)}
      {row(t("dbg.cpu"), `${d.cpu.toFixed(2)}ms`, d.cpu > 8)}
      {row(t("dbg.frame"), `${d.dt.toFixed(1)}ms`)}
      {row(t("dbg.ents"), String(d.ents))}
      {row(t("dbg.drawn"), String(d.drawn))}
      {row("RTT", `${d.rtt}ms`, d.rtt > 120)}
      {row(t("dbg.tick"), `${d.tick.toFixed(2)}ms`, d.tick > 25)}
      {row(t("dbg.net"), `${d.kbps.toFixed(1)}KB/s`, d.kbps > 10)}
    </div>
  );
}

function Window({ title, onClose, children, wide }: { title: string; onClose: () => void; children: React.ReactNode; wide?: boolean }) {
  return (
    <div className="rpg-modal-bg">
      <div className={`rpg-panel relative ${wide ? "w-[760px]" : "w-[480px]"} max-w-[96vw] p-4 text-[12px]`}>
        <button className="rpg-x" onClick={onClose} aria-label={t("hud.close")}>✕</button>
        <h2 className="mb-2 text-base font-bold">{title}</h2>
        {children}
      </div>
    </div>
  );
}

// ── GM 창 (F8, §28): 실시간 접속자 · 명령 · 공지 · 버그 제보 ────────────────────
export function GmWindow({ data, send, onClose }: { data: GmData; send: Send; onClose: () => void }) {
  const [tab, setTab] = useState<"players" | "items" | "bugs">("players");
  const [cmd, setCmd] = useState("");
  const [open, setOpen] = useState<number | null>(null);
  const [target, setTarget] = useState("");
  const [category, setCategory] = useState("all");
  const [search, setSearch] = useState("");
  const [tpl, setTpl] = useState(Object.keys(ITEMS)[0]);
  const [qty, setQty] = useState(1);
  const [rarity, setRarity] = useState<Rarity>("common");
  const [speedValue, setSpeedValue] = useState("1");
  const [map, setMap] = useState<"plaza" | "field" | "highland" | "arena">("plaza");
  const [x, setX] = useState(320);
  const [y, setY] = useState(320);
  const gm = (c: string) => send({ t: "chat", text: `/gm ${c}` });
  useEffect(() => { const id = setInterval(() => send({ t: "gm" }), 3000); return () => clearInterval(id); }, [send]);
  const btn = (label: string, c: string) => <button className="rpg-btn !px-1.5 !py-0 !text-[10px]" onClick={() => gm(c)}>{label}</button>;
  const players = data.players ?? [];
  const selected = players.find((p) => p.name === target) ?? players[0];
  useEffect(() => setSpeedValue(String(selected?.speed ?? 1)), [selected?.name]);
  const groups: Record<string, string> = { all: t("gm.allItems"), weapon: t("gm.weapon"), armor: t("gm.armor"), accessory: t("gm.accessory"), potion: t("gm.potion"), food: t("gm.food"), material: t("gm.material"), book: t("gm.book"), consumable: t("gm.consumable") };
  const items = Object.entries(ITEMS).filter(([id, item]) => {
    const group = item.use?.food ? "food" : item.kind;
    return (category === "all" || group === category) && `${item.name} ${id}`.toLowerCase().includes(search.toLowerCase());
  });
  const chosen = ITEMS[tpl];
  return (
    <Window title={t("gm.title")} onClose={onClose} wide>
      <div className="mb-2 flex gap-1.5">
        <button className="rpg-btn" data-on={tab === "players"} onClick={() => setTab("players")}>{t("gm.players")} ({data.players?.length ?? 0})</button>
        <button className="rpg-btn" data-on={tab === "items"} onClick={() => setTab("items")}>{t("gm.items")}</button>
        <button className="rpg-btn" data-on={tab === "bugs"} onClick={() => setTab("bugs")}>{t("gm.bugs")} ({data.bugs?.length ?? 0})</button>
      </div>
      <div className="max-h-[380px] overflow-y-auto pr-1">
        {tab === "players" && <>
          <div className="mb-2 flex flex-wrap items-center gap-1.5 rounded border border-[#c9a97a] bg-[#f6e9c8] p-2">
            <select className="rpg-input min-w-32 flex-1" value={selected?.name ?? ""} onChange={(e) => setTarget(e.target.value)} disabled={!players.length}>
              {players.map((p) => <option key={p.name} value={p.name}>{p.name} · Lv{p.lv}</option>)}
            </select>
            <button className="rpg-btn" disabled={!selected} onClick={() => selected && gm(`tp "${selected.name}"`)}>{t("gm.tp")}</button>
            <button className="rpg-btn" disabled={!selected} onClick={() => selected && gm(`summon "${selected.name}"`)}>{t("gm.summon")}</button>
            <select className="rpg-input" value={map} onChange={(e) => setMap(e.target.value as typeof map)}>
              <option value="plaza">{ROOM_NAME.plaza}</option><option value="field">{ROOM_NAME.field}</option><option value="highland">{ROOM_NAME.highland}</option><option value="arena">{ROOM_NAME.arena}</option>
            </select>
            <label className="flex items-center gap-1 text-[10px]">{t("gm.x")}<input className="rpg-input w-16" type="number" value={x} onChange={(e) => setX(Number(e.target.value))} /></label>
            <label className="flex items-center gap-1 text-[10px]">{t("gm.y")}<input className="rpg-input w-16" type="number" value={y} onChange={(e) => setY(Number(e.target.value))} /></label>
            <button className="rpg-btn" onClick={() => gm(`tp ${map} ${x} ${y}`)}>{t("gm.teleportSelf")}</button>
            <button className="rpg-btn" disabled={!selected} onClick={() => selected && gm(`warp "${selected.name}" ${map} ${x} ${y}`)}>{t("gm.warp")}</button>
            <button className="rpg-btn" disabled={!selected} onClick={() => selected && gm(`heal "${selected.name}"`)}>{t("gm.heal")}</button>
            <button className="rpg-btn" disabled={!selected} onClick={() => selected && gm(`info "${selected.name}"`)}>{t("gm.info")}</button>
            {selected && <>
              <button className="rpg-btn" onClick={() => gm(`toggle "${selected.name}" invuln ${selected.invuln ? "off" : "on"}`)}>{t("gm.invuln")}: {selected.invuln ? t("gm.on") : t("gm.off")}</button>
              <button className="rpg-btn" onClick={() => gm(`toggle "${selected.name}" resources ${selected.resources ? "off" : "on"}`)}>{t("gm.resources")}: {selected.resources ? t("gm.on") : t("gm.off")}</button>
              <label className="flex items-center gap-1 text-[10px]" title={t("gm.speedHelp")}>{t("gm.speed")}<input className="rpg-input w-14" type="number" min="0.5" max="2" step="0.1" value={speedValue} onChange={(e) => setSpeedValue(e.target.value)} onBlur={() => gm(`speed "${selected.name}" ${speedValue}`)} /><span>{t("gm.speedHelp")}</span></label>
            </>}
          </div>
          {players.map((p) => (
          <div key={p.name} className="mb-1 flex flex-wrap items-center gap-1.5 rounded border border-[#c9a97a] bg-[#f6e9c8] px-2 py-1">
            <b className="w-24 truncate">{p.name}</b>
            <span className="w-32 text-[11px] text-[#8c6642]">Lv{p.lv} · {ROOM_NAME[p.where as RoomKind] ?? "-"} {p.where === "dungeon" ? "" : `${p.ch}ch`}</span>
            <span className="flex-1 text-[11px] text-[#8c6642]">({p.x}, {p.y}){p.party ? ` · ${t("gm.inParty")}` : ""}{p.muted ? ` · ${t("gm.muted")}` : ""}</span>
            {btn(t("gm.tp"), `tp "${p.name}"`)}
            {btn(p.muted ? t("gm.unmute") : t("gm.mute"), p.muted ? `unmute "${p.name}"` : `mute "${p.name}" 10`)}
            {btn(t("gm.kick"), `kick "${p.name}"`)}
            {btn(t("gm.ban"), `ban "${p.name}" 24`)}
          </div>
        ))}</>}
        {tab === "items" && <>
          <div className="mb-2 flex flex-wrap gap-1.5">
            <select className="rpg-input" value={category} onChange={(e) => setCategory(e.target.value)}>{Object.entries(groups).map(([k, name]) => <option key={k} value={k}>{name}</option>)}</select>
            <input className="rpg-input min-w-32 flex-1" value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t("gm.searchItem")} />
          </div>
          <div className="grid grid-cols-2 gap-1 sm:grid-cols-3">
            {items.map(([id, item]) => <button key={id} className="flex min-w-0 items-center gap-1 rounded border border-[#c9a97a] bg-[#f6e9c8] p-1 text-left" data-on={tpl === id} onClick={() => setTpl(id)}>
              <img className="rpg-pixel h-8 w-8 shrink-0" src={iconUrl(itemIcon(id, item.rarity ?? rarity))} alt="" />
              <span className="min-w-0 truncate text-[11px]">{item.name}</span>
            </button>)}
            {!items.length && <span className="col-span-full p-2 text-center text-xs">{t("gm.noItems")}</span>}
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-1.5 rounded border border-[#c9a97a] bg-[#f6e9c8] p-2">
            {chosen && <><img className="rpg-pixel h-8 w-8" src={iconUrl(itemIcon(tpl, rarity))} alt="" /><b className="mr-auto text-xs">{chosen.name}</b></>}
            <select className="rpg-input" value={rarity} onChange={(e) => setRarity(e.target.value as Rarity)}>{RARITIES.map((r) => <option key={r} value={r}>{RARITY[r].name}</option>)}</select>
            <label className="flex items-center gap-1 text-[10px]">{t("gm.quantity")}<input className="rpg-input w-16" type="number" min="1" max="999" value={qty} onChange={(e) => setQty(Math.max(1, Math.min(999, Number(e.target.value))))} /></label>
            <select className="rpg-input min-w-28" value={selected?.name ?? ""} onChange={(e) => setTarget(e.target.value)} disabled={!players.length}>
              {players.map((p) => <option key={p.name} value={p.name}>{p.name}</option>)}
            </select>
            <button className="rpg-btn" disabled={!selected} onClick={() => selected && gm(`give "${selected.name}" ${tpl} ${qty} ${rarity}`)}>{t("gm.give")}</button>
          </div>
        </>}
        {tab === "bugs" && (data.bugs ?? []).map((b) => (
          <div key={b.id} className="mb-1 rounded border border-[#c9a97a] bg-[#f6e9c8] px-2 py-1">
            <div className="flex justify-between"><b>#{b.id} {b.name}</b><span className="text-[11px] text-[#8c6642]">{b.place} · {new Date(b.at).toLocaleString("ko-KR")}</span></div>
            <p className="whitespace-pre-wrap">{b.text}</p>
            {b.img && <button className="rpg-btn mt-1 !px-1.5 !py-0 !text-[10px]" onClick={() => { setOpen(b.id); send({ t: "gm", bug: b.id }); }}>{t("gm.shot")}</button>}
            {open === b.id && data.bug?.id === b.id && (
              <>
                {data.bug.img && <img src={data.bug.img} alt="" className="mt-1 max-w-full rounded border border-[#c9a97a]" />}
                <pre className="mt-1 max-h-[120px] overflow-auto whitespace-pre-wrap rounded bg-[#3a2a1e] p-1 text-[10px] text-[#f6e9c8]">{data.bug.log.join("\n")}</pre>
              </>
            )}
          </div>
        ))}
      </div>
      <form className="mt-2 flex gap-1.5" onSubmit={(e) => { e.preventDefault(); if (cmd.trim()) gm(cmd.trim()); setCmd(""); }}>
        <span className="self-center font-mono text-[#8c6642]">/gm</span>
        <input className="rpg-input flex-1" value={cmd} placeholder="announce 점검 10분 뒤 · give 닉 enhance_stone 10 · help" onChange={(e) => setCmd(e.target.value)} />
        <button className="rpg-btn" type="submit">{t("gm.run")}</button>
      </form>
    </Window>
  );
}

// ── 버그 제보 (§28): 설명 + 스크린샷 + 좌표 · 클라이언트 로그 ─────────────────────
export function BugWindow({ shot, send, onClose }: { shot: () => Promise<string | null>; send: Send; onClose: () => void }) {
  const [text, setText] = useState("");
  const [withShot, setWithShot] = useState(true);
  const [busy, setBusy] = useState(false);
  return (
    <Window title={t("bug.title")} onClose={onClose}>
      <p className="mb-1.5 text-[#6d513b]">{t("bug.lead")}</p>
      <textarea className="rpg-input h-28 w-full resize-none" maxLength={1000} value={text} onChange={(e) => setText(e.target.value)} placeholder={t("bug.ph")} />
      <label className="mt-1 flex items-center gap-1 text-[11px]"><input type="checkbox" checked={withShot} onChange={(e) => setWithShot(e.target.checked)} />{t("bug.shot")}</label>
      <button
        className="rpg-btn mt-2" disabled={busy || text.trim().length < 2}
        onClick={async () => {
          setBusy(true);
          const img = withShot ? await shot().catch(() => null) : null;
          send({ t: "bug", text: text.trim(), ...(img ? { img } : {}), log: clientLog.slice(-40) });
          onClose();
        }}
      >{t("bug.send")}</button>
    </Window>
  );
}
