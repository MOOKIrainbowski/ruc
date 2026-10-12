import { NextResponse, type NextRequest } from "next/server";
import { agreementsAfter, checkApiSig } from "@/lib/terms";

/** 게임 서버(RucCore TermsService)가 주기적으로 부릅니다. ?after=<메시지 ID>&sig=<HMAC("agreements:"+after)> */
export async function GET(req: NextRequest) {
  const after = req.nextUrl.searchParams.get("after") || "0";
  if (!/^\d{1,20}$/.test(after) || !checkApiSig(after, req.nextUrl.searchParams.get("sig"))) {
    return NextResponse.json({ error: "서명 오류" }, { status: 401 });
  }
  return NextResponse.json(await agreementsAfter(after), { headers: { "Cache-Control": "no-store" } });
}
