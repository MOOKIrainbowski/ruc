"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { CHAR_H, CHAR_W } from "../shared/constants";
import { ITEMS, type Item } from "../shared/data/items";
import {
  COLLECT_CHOICES, MOB_CHOICES, NPCS, QUESTS, USER_QUEST, objText, userQuestFee,
  type Noti, type QState, type QuestView, type UserKind, type UserQuestRow,
} from "../shared/data/quests";
import type { You } from "../shared/protocol";
import { FRAMES, characterSheet } from "./art/character";
import { t } from "./i18n";
import { SOCIAL_ICON, socialAction } from "./Social";
import { NPC_LOOK, NPC_PLACE, type Place } from "./npcs";

type Send = (m: Parameters<import("./net").Net["send"]>[0]) => void;
export type QStates = { active: QState[]; done: string[] };
export type BoardData = Pick<QuestView, "board" | "mine" | "taken">;

const won = (n: number) => n.toLocaleString("ko-KR");
const FRAME_PX = 3;

function Window({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="rpg-modal-bg">
      <div className="rpg-panel relative w-[640px] max-w-[96vw] p-4 text-[12px]">
        <button className="rpg-x" onClick={onClose} aria-label={t("hud.close")}>✕</button>
        <h2 className="mb-2 text-base font-bold">{title}</h2>
        {children}
      </div>
    </div>
  );
}

// ── NPC 대화창 (§19-1): 초상화 + 타이핑 + 선택지 ───────────────────────────
export function Dialogue({ npc, states, onPlace, onClose }: { npc: string; states: QStates; onPlace: (p: Place) => void; onClose: () => void }) {
  const info = NPCS[npc];
  const look = NPC_LOOK[npc];
  const place = NPC_PLACE[npc];
  const mine = states.active.map((s) => QUESTS[s.id]).filter((q) => q?.npc === npc);
  const lines = useMemo(() => [...mine.map((q) => `[${q.title}] ${q.desc}`), ...(info?.lines ?? ["..."])], [npc, states.active.length]); // eslint-disable-line react-hooks/exhaustive-deps
  const [i, setI] = useState(0);
  const [shown, setShown] = useState(0);
  const text = lines[i % lines.length];
  const cv = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    setShown(0);
    const id = setInterval(() => setShown((n) => Math.min(text.length, n + 1)), 28);
    return () => clearInterval(id);
  }, [text]);
  useEffect(() => {
    if (!look) return;
    const sheet = characterSheet(look.ap, look.outfit);
    const ctx = cv.current?.getContext("2d");
    if (!ctx) return;
    let f = 0;
    const draw = () => {
      ctx.imageSmoothingEnabled = false;
      ctx.clearRect(0, 0, CHAR_W * FRAME_PX, CHAR_H * FRAME_PX);
      ctx.drawImage(sheet, (f++ % FRAMES) * CHAR_W, 0, CHAR_W, CHAR_H, 0, 0, CHAR_W * FRAME_PX, CHAR_H * FRAME_PX);
    };
    draw();
    const id = setInterval(draw, 250);
    return () => clearInterval(id);
  }, [npc, look]);

  if (!info) return null;
  return (
    <div className="rpg-modal-bg !items-end pb-6">
      <div className="rpg-panel relative flex w-[620px] max-w-[96vw] gap-3 p-3 text-[13px]" onClick={() => setShown(text.length)}>
        <canvas ref={cv} width={CHAR_W * FRAME_PX} height={CHAR_H * FRAME_PX} className="rpg-pixel shrink-0 rounded bg-[#8CC63F]" />
        <div className="min-w-0 flex-1">
          <div className="mb-1 font-bold">{info.name} <span className="text-[11px] font-normal text-[#8c6642]">{info.role}</span></div>
          <p className="min-h-[3.2em] whitespace-pre-wrap leading-relaxed">{text.slice(0, shown)}</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {lines.length > 1 && <button className="rpg-btn" onClick={(e) => { e.stopPropagation(); setI((n) => n + 1); }}>{t("dlg.next")}</button>}
            {place && info.place && <button className="rpg-btn" onClick={(e) => { e.stopPropagation(); onPlace(place); }}>{info.place}</button>}
            <button className="rpg-btn" onClick={(e) => { e.stopPropagation(); onClose(); }}>{t("dlg.close")}</button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── 일지 (J): 진행 중 / 완료 / 유저 퀘스트 게시판 ─────────────────────────────
type Tab = "active" | "done" | "board";
type BoardTab = "browse" | "register" | "mine";

const goalText = (r: { kind: string; target: string; n: number }) =>
  r.kind === "kill" ? `${MOB_CHOICES.find(([k]) => k === r.target)?.[1] ?? r.target} ${r.n}마리 처치` :
  r.kind === "stage" ? `고목의 유적 ${r.n}스테이지 도달` : r.kind === "duel" ? `결투 ${r.n}번 승리` : r.kind === "collect" ? `${ITEMS[r.target]?.name ?? r.target} ${r.n}개 채집` : `${ITEMS[r.target]?.name ?? r.target} ${r.n}개 전달`;
const rewardText = (r: { ruc: number; items: [string, number][] }) =>
  [r.ruc ? `${won(r.ruc)} RUC` : "", ...r.items.map(([tp, n]) => `${ITEMS[tp]?.name ?? tp}${n > 1 ? ` ×${n}` : ""}`)].filter(Boolean).join(" + ");
const leftText = (ms: number) => {
  const h = Math.max(0, Math.floor(ms / 3_600_000));
  return h >= 24 ? `${Math.floor(h / 24)}일 ${h % 24}시간` : `${h}시간`;
};

export function Journal({ tab: first, states, board, items, you, send, onClose }: {
  tab: Tab; states: QStates; board: BoardData | null; items: Item[]; you: You; send: Send; onClose: () => void;
}) {
  const [tab, setTab] = useState<Tab>(first);
  const [sub, setSub] = useState<BoardTab>("browse");
  const tracked = states.active.filter((s) => s.tracked).length;
  const tabBtn = (k: Tab, label: string) => <button key={k} className="rpg-btn" data-on={tab === k} onClick={() => { setTab(k); if (k === "board") send({ t: "quest", op: "board" }); }}>{label}</button>;
  return (
    <Window title={t("qj.title")} onClose={onClose}>
      <div className="mb-2 flex gap-1.5">{tabBtn("active", `${t("qj.active")} (${states.active.length})`)}{tabBtn("done", `${t("qj.done")} (${states.done.length})`)}{tabBtn("board", t("qj.board"))}</div>
      <div className="max-h-[440px] overflow-y-auto pr-1">
        {tab === "active" && (
          <>
            {!states.active.length && !board?.taken.length && <p className="py-6 text-center text-[#8c6642]">{t("qj.empty")}</p>}
            {states.active.map((s) => {
              const def = QUESTS[s.id];
              if (!def) return null;
              const r = def.reward;
              return (
                <div key={s.id} className="mb-2 rounded border border-[#c9a97a] bg-[#f6e9c8] p-2">
                  <div className="flex items-center justify-between">
                    <b>{def.title}</b>
                    <label className="flex items-center gap-1 text-[11px]"><input type="checkbox" checked={s.tracked} disabled={!s.tracked && tracked >= 3} onChange={(e) => send({ t: "quest", op: "track", id: s.id, on: e.target.checked })} />{t("qj.track")}</label>
                  </div>
                  <p className="my-1 text-[#6d513b]">{def.desc}</p>
                  {def.obj.map((o, i) => <div key={i} className={s.prog[i] >= o.n ? "text-[#3d7a14]" : ""}>• {objText(o, s.prog[i] ?? 0)}</div>)}
                  <div className="mt-1 text-[11px] text-[#8c6642]">{t("qj.reward")}: {[r.exp ? `경험치 ${r.exp}` : "", r.ruc ? `${won(r.ruc)} RUC` : "", ...(r.items ?? []).map(([tp, n]) => `${ITEMS[tp].name} ×${n}`)].filter(Boolean).join(", ") || "-"}</div>
                </div>
              );
            })}
            {!!board?.taken.length && <h3 className="mb-1 mt-2 font-bold">{t("qj.taken")}</h3>}
            {board?.taken.map((r) => (
              <div key={r.id} className="mb-2 rounded border border-[#c9a97a] bg-[#f6e9c8] p-2">
                <div className="flex justify-between"><b>{r.title}</b><span className="text-[11px] text-[#8c6642]">{r.owner}</span></div>
                <div>• {goalText(r)} {r.kind !== "deliver" ? `${Math.min(r.prog, r.n)}/${r.n}` : ""}</div>
                <div className="text-[11px] text-[#8c6642]">{t("qj.reward")}: {rewardText(r) || "-"}</div>
                <div className="mt-1 flex gap-1.5">
                  {r.kind === "deliver" && <button className="rpg-btn" onClick={() => send({ t: "quest", op: "deliver", id: r.id, rid: crypto.randomUUID() })}>{t("qj.deliver")}</button>}
                  <button className="rpg-btn" onClick={() => send({ t: "quest", op: "abandon", id: r.id })}>{t("qj.abandon")}</button>
                </div>
              </div>
            ))}
          </>
        )}
        {tab === "done" && (states.done.length ? states.done.map((id) => <div key={id} className="border-b border-[#d8c19a] py-1">✔ {QUESTS[id]?.title ?? id}</div>) : <p className="py-6 text-center text-[#8c6642]">-</p>)}
        {tab === "board" && (
          <>
            <div className="mb-2 flex items-center justify-between gap-1.5">
              <div className="flex gap-1.5">
                {(["browse", "register", "mine"] as BoardTab[]).map((k) => <button key={k} className="rpg-btn" data-on={sub === k} onClick={() => setSub(k)}>{t(`qj.${k}` as never)}</button>)}
              </div>
              <span className="rounded bg-[#3a2a1e] px-2 py-0.5 text-[11px] text-[#F2C94C]">{won(you.ruc)} RUC</span>
            </div>
            {sub === "browse" && <BoardList rows={board?.board ?? []} send={send} />}
            {sub === "mine" && <BoardList rows={board?.mine ?? []} send={send} mine />}
            {sub === "register" && <Register items={items} ruc={you.ruc} send={send} done={() => setSub("mine")} />}
          </>
        )}
      </div>
    </Window>
  );
}

function BoardList({ rows, send, mine }: { rows: UserQuestRow[]; send: Send; mine?: boolean }) {
  if (!rows.length) return <p className="py-6 text-center text-[#8c6642]">{t("qj.noBoard")}</p>;
  return (
    <>
      {rows.map((r) => (
        <div key={r.id} className="mb-2 rounded border border-[#c9a97a] bg-[#f6e9c8] p-2">
          <div className="flex justify-between"><b>{r.title}</b><span className="text-[11px] text-[#8c6642]">{r.owner}</span></div>
          <div>• {goalText(r)}</div>
          <div className="text-[11px] text-[#8c6642]">{t("qj.reward")}: {rewardText(r) || "-"} · {t("qj.left", { n: r.left, m: r.slots })} · {t("qj.expires", { d: leftText(r.expires - Date.now()) })}</div>
          <div className="mt-1 flex gap-1.5">
            {!r.mine && <button className="rpg-btn" disabled={r.joined || r.left <= 0} onClick={() => send({ t: "quest", op: "accept", id: r.id })}>{r.joined ? t("qj.joined") : t("qj.accept")}</button>}
            {!r.mine && <button className="rpg-btn" onClick={() => send({ t: "quest", op: "report", id: r.id })}>{t("qj.report")}</button>}
            {(mine || r.mine) && <button className="rpg-btn" onClick={() => send({ t: "quest", op: "cancel", id: r.id })}>{t("qj.cancel")}</button>}
          </div>
        </div>
      ))}
    </>
  );
}

const ITEM_CHOICES = Object.entries(ITEMS).filter(([, v]) => v.kind === "material" || v.kind === "potion").map(([k, v]) => [k, v.name] as const).sort((a, b) => a[1].localeCompare(b[1], "ko"));

function Register({ items, ruc, send, done }: { items: Item[]; ruc: number; send: Send; done: () => void }) {
  const [title, setTitle] = useState("");
  const [kind, setKind] = useState<UserKind>("kill");
  const [target, setTarget] = useState("slime");
  const [n, setN] = useState(5);
  const [reward, setReward] = useState(100);
  const [slots, setSlots] = useState(1);
  const [days, setDays] = useState(3);
  const [pick, setPick] = useState<Item[]>([]);
  const fee = userQuestFee(reward, slots);
  const total = reward * slots + fee;
  const bag = items.filter((i) => (i.loc === "inventory" || i.loc === "hotbar") && !pick.includes(i));
  const num = (v: string, lo: number, hi: number) => Math.max(lo, Math.min(hi, Math.floor(Number(v) || 0)));
  const field = (label: string, el: React.ReactNode) => <label className="flex items-center gap-2"><span className="w-24 shrink-0 text-[#6d513b]">{label}</span>{el}</label>;
  return (
    <div className="flex flex-col gap-1.5">
      {field(t("qj.formTitle"), <input className="rpg-input flex-1" maxLength={24} value={title} onChange={(e) => setTitle(e.target.value)} />)}
      {field(t("qj.kind"), (
        <select className="rpg-input" value={kind} onChange={(e) => { const k = e.target.value as UserKind; setKind(k); setTarget(k === "kill" ? "slime" : k === "stage" ? "ruins" : k === "duel" ? "duel" : k === "collect" ? "herb" : ITEM_CHOICES[0][0]); if (k === "stage") setN(1); }}>
          <option value="kill">{t("qj.kill")}</option><option value="deliver">{t("qj.deliverKind")}</option>
          <option value="stage">{t("qj.stageKind")}</option><option value="duel">{t("qj.duelKind")}</option><option value="collect">{t("qj.collectKind")}</option>
        </select>
      ))}
      {(kind === "kill" || kind === "deliver" || kind === "collect") && field(t("qj.target"), (
        <select className="rpg-input" value={target} onChange={(e) => setTarget(e.target.value)}>
          {(kind === "kill" ? MOB_CHOICES : kind === "collect" ? COLLECT_CHOICES : ITEM_CHOICES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
      ))}
      {field(kind === "stage" ? t("qj.stageN") : t("qj.n"), <input className="rpg-input w-24" inputMode="numeric" value={n} onChange={(e) => setN(num(e.target.value, 1, kind === "stage" ? 10 : USER_QUEST.maxN))} />)}
      {field(t("qj.ruc"), <input className="rpg-input w-32" inputMode="numeric" value={reward} onChange={(e) => setReward(num(e.target.value, 0, USER_QUEST.maxRuc))} />)}
      {field(t("qj.slots"), <input className="rpg-input w-24" inputMode="numeric" value={slots} onChange={(e) => { const v = num(e.target.value, 1, USER_QUEST.maxSlots); setSlots(v); if (v > 1) setPick([]); }} />)}
      {field(t("qj.days"), <input className="rpg-input w-24" inputMode="numeric" value={days} onChange={(e) => setDays(num(e.target.value, 1, USER_QUEST.maxDays))} />)}
      {slots === 1 && (
        <div>
          <div className="text-[#6d513b]">{t("qj.items")}: {pick.map((i) => ITEMS[i.tpl].name).join(", ") || "-"}</div>
          <div className="mt-1 flex max-h-[84px] flex-wrap gap-1 overflow-y-auto">
            {bag.map((i) => <button key={i.id} className="rpg-btn !px-1.5 !py-0.5 text-[11px]" disabled={pick.length >= USER_QUEST.maxItems} onClick={() => setPick([...pick, i])}>{i.name ?? ITEMS[i.tpl].name}{i.qty > 1 ? ` ×${i.qty}` : ""}</button>)}
            {pick.map((i) => <button key={i.id} className="rpg-btn !px-1.5 !py-0.5 text-[11px]" data-on onClick={() => setPick(pick.filter((x) => x !== i))}>✕ {i.name ?? ITEMS[i.tpl].name}</button>)}
          </div>
        </div>
      )}
      <p className="text-[11px] text-[#8c6642]">{t("qj.fee", { fee, total: won(total) })}</p>
      <button
        className="rpg-btn self-start"
        disabled={title.trim().length < 2 || (!reward && !pick.length) || total > ruc}
        onClick={() => {
          send({ t: "quest", op: "create", title, kind, target, n, ruc: reward, slots, days, list: pick.map((i) => [i.loc, i.slot] as never), rid: crypto.randomUUID() });
          setPick([]);
          done();
        }}
      >{t("qj.submit")}</button>
    </div>
  );
}

// ── 오른쪽 추적 창 (최대 3개) ─────────────────────────────────────────────
export function Tracker({ states }: { states: QStates }) {
  const list = states.active.filter((s) => s.tracked && QUESTS[s.id]).slice(0, 3);
  if (!list.length) return null;
  return (
    <div className="pointer-events-none flex w-[220px] flex-col gap-1.5">
      {list.map((s) => {
        const def = QUESTS[s.id];
        return (
          <div key={s.id} className="rpg-chip !block !whitespace-normal !text-left !text-[11px] leading-snug">
            <b className="text-[#F2C94C]">{def.title}</b>
            {def.obj.map((o, i) => <div key={i} className={s.prog[i] >= o.n ? "text-[#9be36b]" : ""}>{objText(o, s.prog[i] ?? 0)}</div>)}
          </div>
        );
      })}
    </div>
  );
}

// ── 알림 종 · 드롭다운 (§22) · 토스트 · 퀘스트 팝업 ─────────────────────────────
const ICON: Record<string, string> = {
  party_invite: "👥", party_join_request: "👥", party_accepted: "👥", party_kicked: "👥", gift: "🎁", mail_unclaimed: "✉",
  quest_complete: "✔", quest_accepted_by: "📜", market_sold: "💰", market_expired: "⌛", enhance_broadcast: "✨", system: "ℹ",
};
const ago = (at: number) => {
  const m = Math.floor((Date.now() - at) / 60_000);
  return m < 1 ? "방금" : m < 60 ? `${m}분 전` : m < 1440 ? `${Math.floor(m / 60)}시간 전` : `${Math.floor(m / 1440)}일 전`;
};

export function Bell({ notis, send, onRead }: { notis: Noti[]; send: Send; onRead: (id: number | "all") => void }) {
  const [open, setOpen] = useState(false);
  const unread = notis.filter((n) => !n.read).length;
  return (
    <div className="relative">
      <button className="rpg-chip relative" onClick={() => setOpen((v) => !v)} title={t("noti.title")} aria-label={t("noti.title")}>
        🔔{unread > 0 && <span className="absolute -right-1 -top-1 min-w-[14px] rounded-full bg-[#E5484D] px-1 text-center text-[10px] leading-[14px] text-white">{unread > 99 ? "99+" : unread}</span>}
      </button>
      {open && (
        <div className="rpg-panel absolute right-0 top-8 z-30 w-[300px] p-2 text-[12px]">
          <div className="mb-1 flex items-center justify-between"><b>{t("noti.title")}</b><button className="text-[11px] underline" onClick={() => { send({ t: "noti", op: "readAll" }); onRead("all"); }}>{t("noti.readAll")}</button></div>
          <div className="max-h-[280px] overflow-y-auto">
            {!notis.length && <p className="py-4 text-center text-[#8c6642]">{t("noti.empty")}</p>}
            {notis.map((n) => (
              <div key={n.id} role="button" tabIndex={0} className={`flex w-full gap-2 border-b border-[#d8c19a] px-1 py-1 text-left ${n.read ? "opacity-60" : ""}`} onClick={() => { if (!n.read) { send({ t: "noti", op: "read", id: n.id }); onRead(n.id); } }}>
                <span>{ICON[n.kind] ?? SOCIAL_ICON[n.kind] ?? "ℹ"}</span>
                <span className="flex-1">
                  {n.text}<span className="block text-[10px] text-[#8c6642]">{ago(n.at)}</span>
                  {/* 바로 수락 · 거절 (§22) — 파티 초대 · 가입 신청 */}
                  {!n.read && n.kind === "party_invite" && typeof n.data?.party === "number" && (
                    <span className="mt-1 flex gap-1">
                      <button className="rpg-btn !px-1.5 !py-0 !text-[10px]" onClick={(e) => { e.stopPropagation(); send({ t: "party", op: "accept", id: n.data!.party as number }); send({ t: "noti", op: "read", id: n.id }); onRead(n.id); }}>{t("noti.accept")}</button>
                      <button className="rpg-btn !px-1.5 !py-0 !text-[10px]" onClick={(e) => { e.stopPropagation(); send({ t: "party", op: "decline", id: n.data!.party as number }); send({ t: "noti", op: "read", id: n.id }); onRead(n.id); }}>{t("noti.decline")}</button>
                    </span>
                  )}
                  {!n.read && socialAction(n.kind, n.data, true) && (
                    <span className="mt-1 flex gap-1">
                      {[true, false].map((yes) => (
                        <button key={String(yes)} className="rpg-btn !px-1.5 !py-0 !text-[10px]" onClick={(e) => { e.stopPropagation(); send(socialAction(n.kind, n.data, yes)!); send({ t: "noti", op: "read", id: n.id }); onRead(n.id); }}>{t(yes ? "noti.accept" : "noti.decline")}</button>
                      ))}
                    </span>
                  )}
                  {!n.read && n.kind === "party_join_request" && typeof n.data?.cid === "number" && (
                    <span className="mt-1 flex gap-1">
                      <button className="rpg-btn !px-1.5 !py-0 !text-[10px]" onClick={(e) => { e.stopPropagation(); send({ t: "party", op: "approve", cid: n.data!.cid as number }); send({ t: "noti", op: "read", id: n.id }); onRead(n.id); }}>{t("noti.accept")}</button>
                      <button className="rpg-btn !px-1.5 !py-0 !text-[10px]" onClick={(e) => { e.stopPropagation(); send({ t: "party", op: "reject", cid: n.data!.cid as number }); send({ t: "noti", op: "read", id: n.id }); onRead(n.id); }}>{t("noti.decline")}</button>
                    </span>
                  )}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export function Toasts({ list }: { list: { key: number; text: string }[] }) {
  return (
    <div className="pointer-events-none absolute bottom-24 right-3 flex flex-col items-end gap-1.5">
      {list.map((x) => <div key={x.key} className="rpg-chip rpg-toast !text-[12px]">{x.text}</div>)}
    </div>
  );
}

export function QuestPop({ pop }: { pop: { kind: "start" | "done"; title: string; text: string; at: number } }) {
  return (
    <div key={pop.at} className="rpg-questpop pointer-events-none absolute left-1/2 top-24 -translate-x-1/2 text-center">
      <div className="text-[11px] text-[#F2C94C]">{pop.kind === "start" ? t("qp.start") : t("qp.done")}</div>
      <div className="text-lg font-bold">{pop.title}</div>
      {pop.text && <div className="mt-0.5 max-w-[360px] text-[12px] text-white/90">{pop.text}</div>}
    </div>
  );
}
