import crypto from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { CLIENT_ID } from "@/lib/discord";
import { safeNext } from "@/lib/session";

/** 디스코드 로그인 시작 — state 쿠키를 두고 디스코드 동의 화면으로 보냅니다. */
export function GET(req: NextRequest) {
  const next = safeNext(req.nextUrl.searchParams.get("next"));
  const state = crypto.randomBytes(16).toString("hex");
  const url = new URL("https://discord.com/oauth2/authorize");
  url.search = new URLSearchParams({
    client_id: CLIENT_ID,
    response_type: "code",
    scope: "identify",
    redirect_uri: `${req.nextUrl.origin}/api/auth/callback`,
    state,
    prompt: "none",
  }).toString();
  const res = NextResponse.redirect(url);
  res.cookies.set("ruc_oauth", JSON.stringify({ state, next }), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 600,
  });
  return res;
}
