import { revalidatePath, revalidateTag } from "next/cache";
import { NextResponse, type NextRequest } from "next/server";
import { memberAdmin } from "@/lib/discord";
import { DOCS_TAG, currentText, docKey, history, saveRevision, validate } from "@/lib/docstore";
import { getSession, sameOrigin } from "@/lib/session";

type Ctx = { params: Promise<{ slug: string }> };

/** 관리자만 — 세션의 admin 이 아니라 디스코드에 지금 다시 물어봅니다 (역할을 뺏긴 사람 차단). */
async function admin() {
  const s = await getSession();
  if (!s) return null;
  const m = await memberAdmin(s.id).catch(() => null);
  return m?.admin ? s : null;
}

export async function GET(_req: NextRequest, { params }: Ctx) {
  const key = docKey((await params).slug);
  if (!key) return NextResponse.json({ error: "없는 문서" }, { status: 404 });
  if (!(await admin())) return NextResponse.json({ error: "관리자만 볼 수 있습니다" }, { status: 403 });
  const { text, revision } = await currentText(key.slug);
  return NextResponse.json({ key, text, revision, history: await history(key.slug) });
}

export async function PUT(req: NextRequest, { params }: Ctx) {
  if (!sameOrigin(req)) return NextResponse.json({ error: "잘못된 요청" }, { status: 403 });
  const key = docKey((await params).slug);
  if (!key) return NextResponse.json({ error: "없는 문서" }, { status: 404 });
  const s = await admin();
  if (!s) return NextResponse.json({ error: "관리자만 저장할 수 있습니다" }, { status: 403 });
  const { text } = (await req.json().catch(() => ({}))) as { text?: string };
  const why = typeof text === "string" ? validate(key, text) : "본문이 없습니다";
  if (why) return NextResponse.json({ error: why }, { status: 400 });
  await saveRevision(key, text!, { id: s.id, name: s.name });
  // 판 목록(fetch 캐시)과 그 문서 페이지를 함께 비워 다음 요청이 새 판을 그립니다
  revalidateTag(DOCS_TAG);
  revalidatePath(key.href);
  return NextResponse.json({ ok: true });
}
