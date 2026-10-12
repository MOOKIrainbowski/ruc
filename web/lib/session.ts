import crypto from "node:crypto";
import { cookies } from "next/headers";
import { secret } from "./discord";

/**
 * 디스코드 로그인 세션 — 서명한 쿠키 하나 (`ruc_session`). 서버에 저장하는 것은 없습니다.
 * admin 은 로그인할 때의 판정입니다. 저장 같은 쓰기는 매번 디스코드에 다시 물어봅니다 (lib/discord memberAdmin).
 */

export type Session = { id: string; name: string; avatar: string | null; admin: boolean; exp: number };

export const SESSION_COOKIE = "ruc_session";
const DAYS = 7;

function sign(body: string) {
  return crypto.createHmac("sha256", secret("session")).update(body).digest("base64url");
}

export function encodeSession(s: Omit<Session, "exp">): string {
  const body = Buffer.from(JSON.stringify({ ...s, exp: Date.now() + DAYS * 86400_000 })).toString("base64url");
  return `${body}.${sign(body)}`;
}

export function decodeSession(value: string | undefined): Session | null {
  if (!value || !secret("session")) return null;
  const [body, sig] = value.split(".");
  if (!body || !sig) return null;
  const a = Buffer.from(sig);
  const b = Buffer.from(sign(body));
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const s = JSON.parse(Buffer.from(body, "base64url").toString()) as Session;
    return s.exp > Date.now() ? s : null;
  } catch {
    return null;
  }
}

export async function getSession(): Promise<Session | null> {
  return decodeSession((await cookies()).get(SESSION_COOKIE)?.value);
}

export const cookieOptions = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax" as const,
  path: "/",
  maxAge: DAYS * 86400,
};

/** 로그인 후 돌아갈 주소 — 같은 사이트 경로만 (열린 리디렉트 방지). */
export function safeNext(next: string | null | undefined) {
  return next && next.startsWith("/") && !next.startsWith("//") ? next : "/";
}

/** 쓰기 요청이 이 사이트에서 왔는지 (SameSite 쿠키 위에 한 겹 더). */
export function sameOrigin(req: Request) {
  const origin = req.headers.get("origin");
  return !origin || origin === new URL(req.url).origin;
}
