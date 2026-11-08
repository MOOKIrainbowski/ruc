"use client";

import { useEffect, useRef, useState } from "react";
import { CHAT } from "../shared/data/chat";
import { ROOM_NAME } from "../shared/data/dungeons";
import type { RoomKind } from "../shared/constants";
import type { S2C } from "../shared/protocol";
import type { HudState } from "./game";
import { t } from "./i18n";

/** P8 운영 화면: 채팅(Enter) · F3 디버그 오버레이 · GM 창(F8) · 버그 제보 (§5 · §28 · §29) */

type Send = (m: Parameters<import("./net").Net["send"]>[0]) => void;
export type ChatLine = { ch: "room" | "party" | "system" | "gm"; from: string; text: string; at: number; key: number };
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
const CH_COLOR = { room: "#ffffff", party: "#9be36b", system: "#F2C94C", gm: "#ff9a9e" };
export function ChatBox({ lines, open, party, onSend, onClose, onToggleParty }: {
  lines: ChatLine[]; open: boolean; party: boolean; onSend: (text: string) => void; onClose: () => void; onToggleParty: () => void;
}) {
  const [text, setText] = useState("");
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
            {l.ch === "party" ? t("chat.tagParty") : l.ch === "gm" ? t("chat.tagGm") : ""}{l.from && <b>{l.from}: </b>}{l.text}
          </div>
        ))}
      </div>
      {open && (
        <form className="mt-1 flex gap-1" onSubmit={(e) => { e.preventDefault(); if (text.trim()) onSend(party && !text.startsWith("/") ? `/p ${text}` : text); setText(""); onClose(); }}>
          <button type="button" className="rpg-btn !px-1.5 !py-0 !text-[10px]" data-on={party} onClick={onToggleParty} title={t("chat.toggle")}>{party ? t("chat.party") : t("chat.room")}</button>
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
  const [tab, setTab] = useState<"players" | "bugs">("players");
  const [cmd, setCmd] = useState("");
  const [open, setOpen] = useState<number | null>(null);
  const gm = (c: string) => send({ t: "chat", text: `/gm ${c}` });
  useEffect(() => { const id = setInterval(() => send({ t: "gm" }), 3000); return () => clearInterval(id); }, [send]);
  const btn = (label: string, c: string) => <button className="rpg-btn !px-1.5 !py-0 !text-[10px]" onClick={() => gm(c)}>{label}</button>;
  return (
    <Window title={t("gm.title")} onClose={onClose} wide>
      <div className="mb-2 flex gap-1.5">
        <button className="rpg-btn" data-on={tab === "players"} onClick={() => setTab("players")}>{t("gm.players")} ({data.players?.length ?? 0})</button>
        <button className="rpg-btn" data-on={tab === "bugs"} onClick={() => setTab("bugs")}>{t("gm.bugs")} ({data.bugs?.length ?? 0})</button>
      </div>
      <div className="max-h-[380px] overflow-y-auto pr-1">
        {tab === "players" && (data.players ?? []).map((p) => (
          <div key={p.name} className="mb-1 flex items-center gap-1.5 rounded border border-[#c9a97a] bg-[#f6e9c8] px-2 py-1">
            <b className="w-24 truncate">{p.name}</b>
            <span className="w-32 text-[11px] text-[#8c6642]">Lv{p.lv} · {ROOM_NAME[p.where as RoomKind] ?? "-"} {p.where === "dungeon" ? "" : `${p.ch}ch`}</span>
            <span className="flex-1 text-[11px] text-[#8c6642]">({p.x}, {p.y}){p.party ? ` · ${t("gm.inParty")}` : ""}{p.muted ? ` · ${t("gm.muted")}` : ""}</span>
            {btn(t("gm.tp"), `tp ${p.name}`)}
            {btn(p.muted ? t("gm.unmute") : t("gm.mute"), p.muted ? `unmute ${p.name}` : `mute ${p.name} 10`)}
            {btn(t("gm.kick"), `kick ${p.name}`)}
            {btn(t("gm.ban"), `ban ${p.name} 24`)}
          </div>
        ))}
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
