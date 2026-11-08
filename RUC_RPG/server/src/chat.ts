import { CHAT, cleanChat, filterChat, type ChatChannel } from "../../../web/rpg/shared/data/chat.ts";
import { activeSanction } from "./db.ts";
import { online } from "./economy.ts";
import { gmCommand } from "./gm.ts";
import { partyOf } from "./party.ts";
import { send, type Player } from "./room.ts";
import { guildSay, whisper } from "./social.ts";
import { logChat } from "./db.ts";

/**
 * 채팅 (§5 Enter · §28): 같은 방(채널) 또는 파티. 서버가 욕설을 가리고(data/chat.ts), 도배(5초에 5번) · 채팅 금지를 막음.
 * "/p 말" = 파티, "/g 말" = 길드, "/w 닉 말" = 귓속말, "/r 말" = 마지막 귓속말 상대에게, "/gm …" = GM 명령 (gm.ts). 모두 DB 에 7일 저장 (P10).
 */

const logs = new Map<number, number[]>();

export function chatTo(to: Iterable<Player>, ch: Exclude<ChatChannel, "whisper">, from: string, text: string) {
  const m = { t: "chat" as const, ch, from, text, at: Date.now() };
  for (const q of to) send(q, m);
}

export function chatOp(p: Player, m: { ch?: unknown; text?: unknown }): string | null {
  const text = cleanChat(m.text);
  if (!text) return null;
  if (text === "/gm" || text.startsWith("/gm ")) return gmCommand(p, text);
  if (text.startsWith("/p ")) return say(p, "party", text.slice(3));
  if (text.startsWith("/g ")) return say(p, "guild", text.slice(3));
  const w = /^\/(?:w|귓)\s+(\S+)\s+(.+)$/.exec(text);
  if (w) return say(p, "whisper", w[2], w[1]);
  if (text.startsWith("/r ")) return say(p, "whisper", text.slice(3), null);
  if (/^\/(w|귓|r)\b/.test(text)) return "귓속말: /w 닉네임 할 말 · 답장: /r 할 말";
  return say(p, m.ch === "party" ? "party" : m.ch === "guild" ? "guild" : "room", text);
}

function say(p: Player, ch: "room" | "party" | "guild" | "whisper", raw: string, to?: string | null): string | null {
  const mute = activeSanction(p.discordId, "mute");
  if (mute) return `채팅 금지 중입니다 (${mute.until ? `${Math.ceil((mute.until - Date.now()) / 60_000)}분 남음` : "영구"})`;
  const now = Date.now();
  const log = (logs.get(p.char.id) ?? []).filter((t) => now - t < CHAT.windowMs);
  if (log.length >= CHAT.burst) return "채팅이 너무 빨라요. 잠시 뒤에 보내 주세요";
  log.push(now);
  logs.set(p.char.id, log);
  if (ch === "whisper") return whisper(p, to ?? null, raw);
  const text = filterChat(raw.trim());
  if (!text) return null;
  if (ch === "guild") return guildSay(p, text);
  if (ch === "party") {
    const pt = partyOf(p);
    if (!pt) return "파티에 있지 않습니다 (P 파티창)";
    chatTo(pt.members.map((cid) => online.byChar(cid)).filter((q): q is Player => !!q), "party", p.char.nickname, text);
    logChat("party", p.char.id, null, null, String(pt.id), text);
    return null;
  }
  if (p.room) {
    chatTo(p.room.players.values(), "room", p.char.nickname, text);
    logChat("room", p.char.id, null, null, `${p.room.kind}:${p.room.ch}`, text);
  }
  return null;
}
