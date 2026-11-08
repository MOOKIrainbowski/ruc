import { CHAT, cleanChat, filterChat, type ChatChannel } from "../../../web/rpg/shared/data/chat.ts";
import { activeSanction } from "./db.ts";
import { online } from "./economy.ts";
import { gmCommand } from "./gm.ts";
import { partyOf } from "./party.ts";
import { send, type Player } from "./room.ts";

/**
 * 채팅 (§5 Enter · §28): 같은 방(채널) 또는 파티. 서버가 욕설을 가리고(data/chat.ts), 도배(5초에 5번) · 채팅 금지를 막음.
 * "/p 말" = 파티, "/gm …" = GM 명령 (gm.ts).
 */

const logs = new Map<number, number[]>();

export function chatTo(to: Iterable<Player>, ch: ChatChannel, from: string, text: string) {
  const m = { t: "chat" as const, ch, from, text, at: Date.now() };
  for (const q of to) send(q, m);
}

export function chatOp(p: Player, m: { ch?: unknown; text?: unknown }): string | null {
  const text = cleanChat(m.text);
  if (!text) return null;
  if (text === "/gm" || text.startsWith("/gm ")) return gmCommand(p, text);
  if (text.startsWith("/p ")) return say(p, "party", text.slice(3));
  return say(p, m.ch === "party" ? "party" : "room", text);
}

function say(p: Player, ch: "room" | "party", raw: string): string | null {
  const mute = activeSanction(p.discordId, "mute");
  if (mute) return `채팅 금지 중입니다 (${mute.until ? `${Math.ceil((mute.until - Date.now()) / 60_000)}분 남음` : "영구"})`;
  const now = Date.now();
  const log = (logs.get(p.char.id) ?? []).filter((t) => now - t < CHAT.windowMs);
  if (log.length >= CHAT.burst) return "채팅이 너무 빨라요. 잠시 뒤에 보내 주세요";
  log.push(now);
  logs.set(p.char.id, log);
  const text = filterChat(raw.trim());
  if (!text) return null;
  if (ch === "party") {
    const pt = partyOf(p);
    if (!pt) return "파티에 있지 않습니다 (P 파티창)";
    chatTo(pt.members.map((cid) => online.byChar(cid)).filter((q): q is Player => !!q), "party", p.char.nickname, text);
    return null;
  }
  if (p.room) chatTo(p.room.players.values(), "room", p.char.nickname, text);
  return null;
}
