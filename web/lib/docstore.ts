import fs from "node:fs";
import path from "node:path";
import { DOCS_CHANNEL_ID, bot, botToken, channelMessages, type Message } from "./discord";

/**
 * 웹에서 편집하는 문서 (2026-10-13) — 정책 5종(content/policy/*.md)과 규칙 · 제재(content/rules.json).
 *
 * 저장하면 디스코드 "🗂️ㅣ웹문서" 채널에 판 하나가 메시지(머리말 `RUCDOC {json}` + 첨부 파일)로 올라가고,
 * 페이지는 그 채널의 가장 최근 판을 읽습니다. 판이 없거나 디스코드를 못 읽으면 저장소 파일을 씁니다.
 * 채널 기록이 곧 수정 이력입니다 (누가 · 언제). 저장소 파일은 자동으로 바뀌지 않습니다 — 웹 편집본을
 * 저장소에 반영하려면 관리자 화면의 "현재 판 내려받기" 로 받아 파일을 덮어쓰세요.
 */

export const DOCS_TAG = "ruc-docs";

export type DocKey = { slug: string; title: string; kind: "md" | "json"; file: string; href: string };

const POLICY_DIR = path.join(process.cwd(), "content", "policy");

export function editableDocs(): DocKey[] {
  const policies = fs
    .readdirSync(POLICY_DIR)
    .filter((f) => f.endsWith(".md"))
    .map((f) => {
      const slug = f.slice(0, -3);
      const title = fs.readFileSync(path.join(POLICY_DIR, f), "utf8").match(/^title:\s*(.+)$/m)?.[1] ?? slug;
      return { slug, title, kind: "md" as const, file: path.join(POLICY_DIR, f), href: `/policy/${slug}` };
    });
  return [
    ...policies,
    { slug: "rules", title: "서버 규칙 · 제재 단계", kind: "json", file: path.join(process.cwd(), "content", "rules.json"), href: "/rules" },
  ];
}

export function docKey(slug: string) {
  return editableDocs().find((d) => d.slug === slug) ?? null;
}

export type Revision = { id: string; slug: string; by: string; byId: string; at: number; url: string };

async function revisions(): Promise<Revision[]> {
  if (!botToken()) return [];
  const list: Message[] = await channelMessages(DOCS_CHANNEL_ID, "RUCDOC ", [DOCS_TAG]);
  const out: Revision[] = [];
  for (const m of list) {
    try {
      const head = JSON.parse(m.content.slice(7));
      if (m.attachments[0]) out.push({ id: m.id, ...head, url: m.attachments[0].url });
    } catch {
      // 머리말이 깨진 판은 건너뜁니다
    }
  }
  return out;
}

export async function history(slug: string, limit = 20) {
  return (await revisions().catch(() => [])).filter((r) => r.slug === slug).slice(0, limit);
}

/** 지금 보여 줄 본문과 출처. */
export async function currentText(slug: string): Promise<{ text: string; revision: Revision | null }> {
  const key = docKey(slug);
  if (!key) throw new Error(`없는 문서: ${slug}`);
  try {
    const [latest] = await history(slug, 1);
    if (latest) {
      const res = await fetch(latest.url, { next: { revalidate: 3600, tags: [DOCS_TAG] } });
      if (res.ok) return { text: await res.text(), revision: latest };
    }
  } catch {
    // 디스코드 장애 — 저장소 파일로
  }
  return { text: fs.readFileSync(key.file, "utf8"), revision: null };
}

/** 저장 전 검사. 문제가 있으면 이유를, 없으면 null. */
export function validate(key: DocKey, text: string): string | null {
  if (text.length > 200_000) return "200KB 를 넘습니다";
  if (!text.trim()) return "비어 있습니다";
  if (key.kind === "json") {
    try {
      const data = JSON.parse(text);
      if (!Array.isArray(data.sections) || !data.sanctions?.tiers) return "sections · sanctions.tiers 가 있어야 합니다";
    } catch (e) {
      return `JSON 형식 오류: ${(e as Error).message}`;
    }
  } else if (!/^---\r?\n[\s\S]*?\r?\n---/.test(text)) {
    return "맨 위 머리말(--- title: … ---)이 있어야 합니다";
  }
  return null;
}

export async function saveRevision(key: DocKey, text: string, by: { id: string; name: string }) {
  const form = new FormData();
  const head = { slug: key.slug, by: by.name, byId: by.id, at: Date.now() };
  form.append(
    "payload_json",
    JSON.stringify({
      content: `RUCDOC ${JSON.stringify(head)}`,
      allowed_mentions: { parse: [] },
      attachments: [{ id: 0, filename: `${key.slug}.${key.kind}` }],
    }),
  );
  form.append("files[0]", new Blob([text], { type: "text/plain; charset=utf-8" }), `${key.slug}.${key.kind}`);
  return bot(`/channels/${DOCS_CHANNEL_ID}/messages`, { method: "POST", body: form });
}
