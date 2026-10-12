import crypto from "node:crypto";

/**
 * 웹 ↔ 디스코드 (서버 전용). 봇 토큰은 Vercel 의 DISCORD_BOT_TOKEN (피드 · 연대기와 같은 값).
 *
 * 디스코드 로그인(OAuth) · 관리자 판정 · 문서 저장소 · 약관 동의 기록이 전부 이 파일의 함수를 씁니다.
 * 새 서비스(DB · KV)를 들이지 않고 디스코드 채널을 저장소로 쓰는 이유는 docs/08 "웹으로 데이터 보내는 길" ①.
 */

export const GUILD_ID = "1406632846986051605";
/** MOOKI 봇 애플리케이션 — OAuth 클라이언트 ID 도 같습니다. */
export const CLIENT_ID = process.env.DISCORD_CLIENT_ID?.trim() || "1425396419946221699";
/** 로그 카테고리의 저장 채널 (2026-10-13 생성). 지우면 편집본 · 동의 기록이 사라집니다. */
export const DOCS_CHANNEL_ID = process.env.DOCS_CHANNEL_ID?.trim() || "1559233710014996513";
export const AGREE_CHANNEL_ID = process.env.AGREE_CHANNEL_ID?.trim() || "1559233713097674815";
/** 웹 관리자 = 이 역할(Owner · Manager, MOOKI roles.json 의 priority ≥ 950) · 관리자 권한 역할 · 서버 주인. */
const ADMIN_ROLE_IDS = ["1414495321349951508", "1406889344890966077"];

const API = "https://discord.com/api/v10";

export function botToken() {
  return process.env.DISCORD_BOT_TOKEN?.trim() || "";
}

/** 비밀값. 따로 넣지 않으면 봇 토큰에서 만듭니다 (봇 토큰을 바꾸면 같이 바뀝니다). */
export function secret(name: "session" | "terms") {
  const explicit = name === "session" ? process.env.SESSION_SECRET : process.env.RUC_TERMS_SECRET;
  if (explicit?.trim()) return explicit.trim();
  const token = botToken();
  if (!token) return "";
  return crypto.createHmac("sha256", token).update(`ruc-${name}`).digest("hex");
}

export async function bot(path: string, init: RequestInit & { next?: { revalidate?: number; tags?: string[] } } = {}) {
  const token = botToken();
  if (!token) throw new Error("DISCORD_BOT_TOKEN 이 없습니다");
  const res = await fetch(API + path, {
    ...init,
    headers: { Authorization: `Bot ${token}`, ...(init.headers || {}) },
  });
  if (!res.ok) throw new Error(`디스코드 ${res.status} ${path}`);
  return res.status === 204 ? null : res.json();
}

export type Message = {
  id: string;
  content: string;
  timestamp: string;
  author: { id: string; bot?: boolean };
  attachments: { url: string; filename: string }[];
};

/** 채널 메시지, 최근 것부터. 접두어가 맞는 봇 메시지만. ponytail: 최근 500건까지 — 넘치면 오래된 판은 안 보임 */
export async function channelMessages(channel: string, prefix: string, tags: string[]): Promise<Message[]> {
  const out: Message[] = [];
  let before = "";
  for (let page = 0; page < 5; page++) {
    const list = (await bot(`/channels/${channel}/messages?limit=100${before && `&before=${before}`}`, {
      next: { revalidate: 30, tags },
    })) as Message[];
    out.push(...list.filter((m) => m.author.bot && m.content.startsWith(prefix)));
    if (list.length < 100) break;
    before = list[list.length - 1].id;
  }
  return out;
}

/** 서버 멤버 → 웹 관리자인가. 멤버가 아니면 null. */
export async function memberAdmin(userId: string): Promise<{ admin: boolean; nick: string | null } | null> {
  let member: { roles: string[]; nick?: string | null };
  try {
    member = await bot(`/guilds/${GUILD_ID}/members/${userId}`, { cache: "no-store" });
  } catch {
    return null;
  }
  const [guild, roles] = await Promise.all([
    bot(`/guilds/${GUILD_ID}`, { next: { revalidate: 300 } }) as Promise<{ owner_id: string }>,
    bot(`/guilds/${GUILD_ID}/roles`, { next: { revalidate: 300 } }) as Promise<{ id: string; permissions: string }[]>,
  ]);
  const ADMINISTRATOR = BigInt(8);
  const admin =
    guild.owner_id === userId ||
    member.roles.some((id) => ADMIN_ROLE_IDS.includes(id)) ||
    roles.some((r) => member.roles.includes(r.id) && (BigInt(r.permissions) & ADMINISTRATOR) === ADMINISTRATOR);
  return { admin, nick: member.nick ?? null };
}
