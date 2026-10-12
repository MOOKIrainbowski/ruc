import fs from "node:fs";
import path from "node:path";
import { currentText, type Revision } from "./docstore";
import { parseFrontMatter, renderMarkdown, type WikiHeading } from "./wiki";

/**
 * 정책 문서 — content/policy/*.md (이용약관 · 개인정보처리방침 · 환불 정책 · 운영정책 · 보호자 동의 절차).
 * 머리말 형식은 위키와 같습니다 (title · order · description · updated). 파일 이름이 주소입니다.
 * 본문은 웹에서 편집한 최신 판이 있으면 그것을, 없으면 파일을 씁니다 (lib/docstore). 목록 · 주소는 파일 기준.
 */

const DIR = path.join(process.cwd(), "content", "policy");

export type PolicyMeta = { slug: string; title: string; order: number; description: string; updated: string };
export type PolicyDoc = PolicyMeta & { html: string; headings: WikiHeading[]; revision: Revision | null };

function read(slug: string, src = fs.readFileSync(path.join(DIR, `${slug}.md`), "utf8")) {
  const { data, body } = parseFrontMatter(src);
  const meta: PolicyMeta = {
    slug,
    title: data.title || slug,
    order: Number(data.order) || 999,
    description: data.description || "",
    updated: data.updated || "",
  };
  return { meta, body };
}

export function listPolicies(): PolicyMeta[] {
  return fs
    .readdirSync(DIR)
    .filter((f) => f.endsWith(".md"))
    .map((f) => read(f.slice(0, -3)).meta)
    .sort((a, b) => a.order - b.order);
}

export async function getPolicy(slug: string): Promise<PolicyDoc | null> {
  if (!listPolicies().some((p) => p.slug === slug)) return null;
  const { text, revision } = await currentText(slug);
  const { meta, body } = read(slug, text);
  // 웹에서 고쳤으면 그 날짜가 최종 수정일
  if (revision) meta.updated = new Date(revision.at).toISOString().slice(0, 10);
  return { ...meta, ...renderMarkdown(body), revision };
}
