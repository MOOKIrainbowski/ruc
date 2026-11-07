import { NextResponse, type NextRequest } from "next/server";
import { getSession, sameOrigin } from "@/lib/session";
import { DEV_TICKET_SECRET, signTicket } from "@/rpg/shared/ticket";

/** RPG 게임 서버 입장 티켓 (60초). 디스코드 세션이 있어야 발급합니다 (§2-3). */
export async function POST(req: NextRequest) {
  if (!sameOrigin(req)) return NextResponse.json({ error: "origin" }, { status: 403 });
  const dev = process.env.NODE_ENV === "development";
  const s = await getSession();
  // 개발 로그인 (DECISIONS D6) — next dev 에서만. 운영 빌드에서는 이 분기가 항상 false.
  // ?dev= 를 붙이면 디스코드로 로그인돼 있어도 개발 계정으로 (실제 계정에 시험 캐릭터가 생기지 않게)
  const devName = dev ? req.nextUrl.searchParams.get("dev") : null;
  const user =
    devName && /^[가-힣a-zA-Z0-9_]{1,12}$/.test(devName)
      ? { sub: `dev-${devName}`, name: devName, avatar: null }
      : s
        ? { sub: s.id, name: s.name, avatar: s.avatar }
        : null;
  if (!user) return NextResponse.json({ error: "login" }, { status: 401 });

  const secret = process.env.RPG_TICKET_SECRET?.trim() || (dev ? DEV_TICKET_SECRET : "");
  if (!secret) return NextResponse.json({ error: "RPG_TICKET_SECRET 이 설정되지 않았습니다" }, { status: 503 });
  return NextResponse.json({ ticket: signTicket(user, secret) }, { headers: { "Cache-Control": "no-store" } });
}
