import crypto from "node:crypto";

/**
 * 게임 입장 티켓 (§2-3) — HS256 JWT. 웹 API(/api/rpg/ticket)가 서명하고 게임 서버가 검증합니다.
 * 브라우저 번들에서 import 하지 마세요 (node:crypto).
 */

export type Ticket = { sub: string; name: string; avatar: string | null; exp: number };

export const TICKET_TTL_S = 60;
/** 개발 전용 (DECISIONS D6). 운영에서는 RPG_TICKET_SECRET 이 반드시 있어야 합니다. */
export const DEV_TICKET_SECRET = "ruc-rpg-dev-only-secret";

const b64 = (s: string | Buffer) => Buffer.from(s).toString("base64url");
const HEADER = b64(JSON.stringify({ alg: "HS256", typ: "JWT" }));

function hmac(secret: string, data: string) {
  return crypto.createHmac("sha256", secret).update(data).digest("base64url");
}

export function signTicket(t: Omit<Ticket, "exp">, secret: string, now = Date.now()): string {
  const body = b64(JSON.stringify({ ...t, exp: Math.floor(now / 1000) + TICKET_TTL_S }));
  return `${HEADER}.${body}.${hmac(secret, `${HEADER}.${body}`)}`;
}

export function verifyTicket(token: string, secret: string, now = Date.now()): Ticket | null {
  const [h, body, sig] = String(token).split(".");
  if (h !== HEADER || !body || !sig) return null;
  const a = Buffer.from(sig);
  const b = Buffer.from(hmac(secret, `${h}.${body}`));
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const t = JSON.parse(Buffer.from(body, "base64url").toString()) as Ticket;
    return typeof t.sub === "string" && t.exp * 1000 > now ? t : null;
  } catch {
    return null;
  }
}
