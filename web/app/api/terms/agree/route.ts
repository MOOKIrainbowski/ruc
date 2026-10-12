import { revalidateTag } from "next/cache";
import { NextResponse, type NextRequest } from "next/server";
import { currentText } from "@/lib/docstore";
import { getSession, sameOrigin } from "@/lib/session";
import { AGREE_TAG, checkLink, findAgreement, recordAgreement, type AgreeLink } from "@/lib/terms";

/** 이용약관 동의 — 게임이 준 서명 링크 + 디스코드 로그인. */
export async function POST(req: NextRequest) {
  if (!sameOrigin(req)) return NextResponse.json({ error: "잘못된 요청" }, { status: 403 });
  const s = await getSession();
  if (!s) return NextResponse.json({ error: "디스코드 로그인이 필요합니다" }, { status: 401 });
  const link = (await req.json().catch(() => ({}))) as Partial<AgreeLink>;
  const why = checkLink(link);
  if (why) return NextResponse.json({ error: why }, { status: 400 });
  if (!(await findAgreement(link.u!))) {
    const { revision } = await currentText("terms");
    await recordAgreement({
      uuid: link.u!,
      name: link.n!,
      discord: s.id,
      version: revision ? `web-${revision.id}` : "file",
      at: Date.now(),
    });
    revalidateTag(AGREE_TAG);
  }
  return NextResponse.json({ ok: true });
}
