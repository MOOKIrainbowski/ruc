import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";

/** 상단 바 로그인 표시용. 페이지들이 정적으로 남도록 쿠키는 여기서만 읽습니다. */
export async function GET() {
  const s = await getSession();
  return NextResponse.json(s ? { id: s.id, name: s.name, avatar: s.avatar, admin: s.admin } : null, {
    headers: { "Cache-Control": "private, no-store" },
  });
}
