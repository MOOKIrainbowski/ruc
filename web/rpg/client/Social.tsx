"use client";

import { useEffect, useState } from "react";
import { JOBS, LINES, type LineId } from "../shared/data/jobs";
import { GUILD, type SocialView } from "../shared/data/social";
import type { You } from "../shared/protocol";
import { t } from "./i18n";

/** P10 소셜 창 (O): 친구 · 차단 · 길드 (§21-4 기초) */

type Send = (m: Parameters<import("./net").Net["send"]>[0]) => void;
const jobName = (jb: string) => (!jb ? "견습" : jb in LINES ? LINES[jb as LineId].name : (JOBS[jb]?.name ?? ""));
const PLACE: Record<string, string> = { plaza: "광장", field: "초원", arena: "결투장", dungeon: "던전" };
const Row = ({ children }: { children: React.ReactNode }) => <div className="mb-1.5 flex items-center gap-2 rounded border border-[#c9a97a] bg-[#f6e9c8] px-2 py-1.5">{children}</div>;
const Btn = ({ onClick, children, on }: { onClick: () => void; children: React.ReactNode; on?: boolean }) => (
  <button className="rpg-btn !px-1.5 !py-0.5 !text-[10px]" data-on={on} onClick={onClick}>{children}</button>
);
const Dot = ({ on }: { on: boolean }) => <span className={`inline-block h-2 w-2 rounded-full ${on ? "bg-[#4CC764]" : "bg-[#9a8a78]"}`} title={on ? t("so.on") : t("so.off")} />;

export function SocialWindow({ you, s, send, onWhisper, onClose }: { you: You; s: SocialView; send: Send; onWhisper: (name: string) => void; onClose: () => void }) {
  const [tab, setTab] = useState<"friends" | "guild">("friends");
  const [name, setName] = useState("");
  const [gname, setGname] = useState("");
  const [notice, setNotice] = useState(s.guild?.notice ?? "");
  const [sure, setSure] = useState(false); // 해산은 두 번 눌러야
  useEffect(() => setNotice(s.guild?.notice ?? ""), [s.guild?.notice]);
  const g = s.guild;
  const meMaster = !!g?.members.find((m) => m.name === you.nickname)?.master;
  const friends = [...s.friends].sort((a, b) => Number(b.on) - Number(a.on) || a.name.localeCompare(b.name));
  const onN = (l: { on: boolean }[]) => l.filter((x) => x.on).length;
  return (
    <div className="rpg-modal-bg">
      <div className="rpg-panel relative w-[560px] max-w-[96vw] p-4 text-[12px]">
        <button className="rpg-x" onClick={onClose} aria-label={t("hud.close")}>✕</button>
        <h2 className="mb-2 text-base font-bold">{t("so.title")}</h2>
        <div className="mb-2 flex gap-1.5">
          <button className="rpg-btn" data-on={tab === "friends"} onClick={() => setTab("friends")}>{t("so.friends")} ({onN(s.friends)}/{s.friends.length})</button>
          <button className="rpg-btn" data-on={tab === "guild"} onClick={() => setTab("guild")}>{t("so.guild")}{g ? ` ‹${g.name}›` : ""}</button>
        </div>
        <div className="max-h-[440px] overflow-y-auto pr-1">
          {tab === "friends" && (
            <>
              <form className="mb-2 flex gap-1" onSubmit={(e) => { e.preventDefault(); if (name.trim()) send({ t: "friend", op: "request", name: name.trim() }); setName(""); }}>
                <input className="rpg-input flex-1" maxLength={12} value={name} placeholder={t("so.namePh")} onChange={(e) => setName(e.target.value)} />
                <button className="rpg-btn">{t("so.request")}</button>
                <button type="button" className="rpg-btn" onClick={() => { if (name.trim()) send({ t: "friend", op: "block", name: name.trim() }); setName(""); }}>{t("so.block")}</button>
              </form>
              {s.pending.length > 0 && <h3 className="mb-1 font-bold">{t("so.pending")}</h3>}
              {s.pending.map((r) => (
                <Row key={r.cid}>
                  <b className="flex-1">{r.name}</b>
                  <Btn onClick={() => send({ t: "friend", op: "accept", cid: r.cid })}>{t("noti.accept")}</Btn>
                  <Btn onClick={() => send({ t: "friend", op: "decline", cid: r.cid })}>{t("noti.decline")}</Btn>
                </Row>
              ))}
              {!friends.length && <p className="py-4 text-center text-[#8c6642]">{t("so.noFriends")}</p>}
              {friends.map((f) => (
                <Row key={f.cid}>
                  <Dot on={f.on} />
                  <b>{f.name}</b>
                  <span className="flex-1 text-[11px] text-[#8c6642]">Lv{f.lv} {jobName(f.jb)}{f.on && f.where ? ` · ${PLACE[f.where] ?? f.where}` : ""}</span>
                  {f.on && <Btn onClick={() => onWhisper(f.name)}>{t("so.whisper")}</Btn>}
                  {f.on && <Btn onClick={() => send({ t: "party", op: "invite", name: f.name })}>{t("pt.invite")}</Btn>}
                  {meMaster && !g!.members.some((m) => m.cid === f.cid) && <Btn onClick={() => send({ t: "guild", op: "invite", name: f.name })}>{t("so.ginvite")}</Btn>}
                  <Btn onClick={() => send({ t: "friend", op: "remove", cid: f.cid })}>{t("so.remove")}</Btn>
                </Row>
              ))}
              {s.blocked.length > 0 && <h3 className="mb-1 mt-2 font-bold">{t("so.blocked")}</h3>}
              {s.blocked.map((b) => (
                <Row key={b.cid}>
                  <b className="flex-1">{b.name}</b>
                  <Btn onClick={() => send({ t: "friend", op: "unblock", cid: b.cid })}>{t("so.unblock")}</Btn>
                </Row>
              ))}
            </>
          )}
          {tab === "guild" && !g && (
            <div className="py-2">
              <p className="mb-2">{t("so.noGuild")}</p>
              <div className="flex gap-1">
                <input className="rpg-input flex-1" maxLength={10} value={gname} placeholder={t("so.gnamePh")} onChange={(e) => setGname(e.target.value)} />
                <button className="rpg-btn" disabled={!gname.trim()} onClick={() => send({ t: "guild", op: "create", name: gname.trim() })}>{t("so.gcreate", { ruc: GUILD.createRuc.toLocaleString() })}</button>
                <button className="rpg-btn" disabled={!gname.trim()} onClick={() => send({ t: "guild", op: "apply", name: gname.trim() })}>{t("so.gapply")}</button>
              </div>
              <p className="mt-2 text-[11px] text-[#8c6642]">{t("so.ghelp", { n: GUILD.max })}</p>
            </div>
          )}
          {tab === "guild" && g && (
            <>
              <div className="mb-2 rounded border border-[#c9a97a] bg-[#fff6dd] p-2">
                <b>{t("so.notice")}</b>
                {meMaster ? (
                  <form className="mt-1 flex gap-1" onSubmit={(e) => { e.preventDefault(); send({ t: "guild", op: "notice", text: notice }); }}>
                    <input className="rpg-input flex-1" maxLength={GUILD.noticeMax} value={notice} onChange={(e) => setNotice(e.target.value)} />
                    <button className="rpg-btn">{t("so.save")}</button>
                  </form>
                ) : <p className="mt-1">{g.notice || t("so.noNotice")}</p>}
              </div>
              {meMaster && (
                <form className="mb-2 flex gap-1" onSubmit={(e) => { e.preventDefault(); if (name.trim()) send({ t: "guild", op: "invite", name: name.trim() }); setName(""); }}>
                  <input className="rpg-input flex-1" maxLength={12} value={name} placeholder={t("so.namePh")} onChange={(e) => setName(e.target.value)} />
                  <button className="rpg-btn">{t("so.ginvite")}</button>
                </form>
              )}
              <h3 className="mb-1 font-bold">{t("so.members")} ({onN(g.members)}/{g.members.length} · {t("so.max", { n: GUILD.max })})</h3>
              {g.members.map((m) => (
                <Row key={m.cid}>
                  <Dot on={m.on} />
                  <b>{m.name}</b>
                  {m.master && <span className="text-[10px] font-bold text-[#b8860b]">{t("so.master")}</span>}
                  <span className="flex-1 text-[11px] text-[#8c6642]">Lv{m.lv} {jobName(m.jb)}</span>
                  {m.on && m.name !== you.nickname && <Btn onClick={() => onWhisper(m.name)}>{t("so.whisper")}</Btn>}
                  {meMaster && !m.master && <Btn onClick={() => send({ t: "guild", op: "promote", cid: m.cid })}>{t("so.promote")}</Btn>}
                  {meMaster && !m.master && <Btn onClick={() => send({ t: "guild", op: "kick", cid: m.cid })}>{t("so.kick")}</Btn>}
                </Row>
              ))}
              <div className="mt-2 flex justify-end gap-1.5">
                {meMaster ? (
                  <button className="rpg-btn" data-on={sure} onClick={() => { if (sure) send({ t: "guild", op: "disband" }); setSure(!sure); }}>{sure ? t("so.disbandQ") : t("so.disband")}</button>
                ) : (
                  <button className="rpg-btn" onClick={() => send({ t: "guild", op: "leave" })}>{t("so.leave")}</button>
                )}
              </div>
              <p className="mt-1 text-[11px] text-[#8c6642]">{t("so.gchat")}</p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

/** 알림 드롭다운에서 바로 수락 · 거절할 수 있는 소셜 알림 → 보낼 메시지 (§22) */
export function socialAction(kind: string, data: Record<string, unknown> | undefined, yes: boolean): Parameters<Send>[0] | null {
  if (kind === "friend_request" && typeof data?.cid === "number") return { t: "friend", op: yes ? "accept" : "decline", cid: data.cid };
  if (kind === "guild_invite" && typeof data?.gid === "number") return { t: "guild", op: yes ? "accept" : "decline", id: data.gid };
  if (kind === "guild_request" && typeof data?.cid === "number") return { t: "guild", op: yes ? "approve" : "reject", cid: data.cid };
  return null;
}
export const SOCIAL_ICON: Record<string, string> = { friend_request: "🤝", friend_accepted: "🤝", guild_invite: "🛡", guild_request: "🛡", guild_joined: "🛡", guild_kicked: "🛡" };
