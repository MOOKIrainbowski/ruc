import { NextResponse, type NextRequest } from "next/server";
import { CLIENT_ID, memberAdmin } from "@/lib/discord";
import { SESSION_COOKIE, cookieOptions, encodeSession, safeNext } from "@/lib/session";

/** 디스코드가 돌려보낸 곳 — 코드를 토큰으로 바꿔 누구인지 확인하고 세션 쿠키를 굽습니다. */
export async function GET(req: NextRequest) {
  const fail = (why: string) => NextResponse.redirect(new URL(`/login?error=${encodeURIComponent(why)}`, req.url));
  let saved: { state?: string; next?: string } = {};
  try {
    saved = JSON.parse(req.cookies.get("ruc_oauth")?.value || "{}");
  } catch {
    // 아래에서 state 불일치로 처리
  }
  const code = req.nextUrl.searchParams.get("code");
  if (!code || !saved.state || saved.state !== req.nextUrl.searchParams.get("state")) return fail("로그인이 취소되었거나 만료되었습니다");

  const secret = process.env.DISCORD_CLIENT_SECRET?.trim();
  if (!secret) return fail("웹 설정이 아직 끝나지 않았습니다 (DISCORD_CLIENT_SECRET)");
  const tokenRes = await fetch("https://discord.com/api/v10/oauth2/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: CLIENT_ID,
      client_secret: secret,
      grant_type: "authorization_code",
      code,
      redirect_uri: `${req.nextUrl.origin}/api/auth/callback`,
    }),
  });
  if (!tokenRes.ok) return fail("디스코드 로그인에 실패했습니다");
  const { access_token } = await tokenRes.json();
  const user = await fetch("https://discord.com/api/v10/users/@me", {
    headers: { Authorization: `Bearer ${access_token}` },
  }).then((r) => (r.ok ? r.json() : null));
  if (!user?.id) return fail("디스코드 계정 정보를 받지 못했습니다");

  const member = await memberAdmin(user.id).catch(() => null);
  const res = NextResponse.redirect(new URL(safeNext(saved.next), req.url));
  res.cookies.set(
    SESSION_COOKIE,
    encodeSession({
      id: user.id,
      name: member?.nick || user.global_name || user.username,
      avatar: user.avatar ? `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png?size=64` : null,
      admin: !!member?.admin,
    }),
    cookieOptions,
  );
  res.cookies.delete("ruc_oauth");
  return res;
}
