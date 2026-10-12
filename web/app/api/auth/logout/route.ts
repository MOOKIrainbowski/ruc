import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, safeNext } from "@/lib/session";

export function GET(req: NextRequest) {
  const res = NextResponse.redirect(new URL(safeNext(req.nextUrl.searchParams.get("next")), req.url));
  res.cookies.delete(SESSION_COOKIE);
  return res;
}
