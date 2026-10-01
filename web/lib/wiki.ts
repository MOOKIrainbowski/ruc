import fs from "node:fs";
import path from "node:path";
import { Marked, type RendererObject } from "marked";

/**
 * 러크 위키 — content/wiki/*.md 를 읽어 페이지로 만듭니다.
 *
 * 문서를 추가하려면 md 파일 하나만 넣으면 됩니다. 파일 이름이 주소가 됩니다
 * (join.md → /wiki/join). 머리말 형식:
 *
 *   ---
 *   title: 접속 방법
 *   category: 시작하기
 *   order: 2
 *   description: 한 줄 요약 (목록 · 검색 결과에 보입니다)
 *   updated: 2026-10-01
 *   ---
 *
 * 머리말 파서는 직접 짰습니다 — key: value 한 줄짜리만 쓰므로
 * gray-matter 같은 의존성을 들일 이유가 없습니다.
 */

const WIKI_DIR = path.join(process.cwd(), "content", "wiki");

/** 사이드바 · 위키 첫 화면에 나오는 분류 순서. 여기 없는 분류는 맨 뒤에 붙습니다. */
export const CATEGORY_ORDER = ["시작하기", "기본 가이드", "서버", "커뮤니티", "FAQ"];

export type WikiMeta = {
  slug: string;
  title: string;
  category: string;
  order: number;
  description: string;
  updated: string;
};

export type WikiHeading = { id: string; text: string };

export type WikiDoc = WikiMeta & { html: string; headings: WikiHeading[] };

/** 검색 색인 한 줄 — 클라이언트로 내려가므로 본문은 평문으로만 */
export type WikiSearchEntry = Pick<WikiMeta, "slug" | "title" | "category" | "description"> & {
  text: string;
};

function parseFrontMatter(src: string): { data: Record<string, string>; body: string } {
  // CRLF 로 저장된 파일도 받습니다 (윈도우에서 편집하면 그렇게 됩니다).
  const m = src.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!m) return { data: {}, body: src };
  const data: Record<string, string> = {};
  for (const line of m[1].split(/\r?\n/)) {
    const i = line.indexOf(":");
    if (i <= 0) continue;
    data[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  return { data, body: src.slice(m[0].length) };
}

/** 한글을 살린 앵커 id. 같은 제목이 두 번 나오면 -2, -3 을 붙입니다. */
function slugify(text: string, seen: Map<string, number>) {
  const base =
    text
      .toLowerCase()
      .replace(/<[^>]+>/g, "")
      .replace(/[^\p{L}\p{N}\s-]/gu, "")
      .trim()
      .replace(/\s+/g, "-") || "section";
  const n = (seen.get(base) ?? 0) + 1;
  seen.set(base, n);
  return n === 1 ? base : `${base}-${n}`;
}

function readFile(slug: string) {
  const src = fs.readFileSync(path.join(WIKI_DIR, `${slug}.md`), "utf8");
  return parseFrontMatter(src);
}

function toMeta(slug: string, data: Record<string, string>): WikiMeta {
  return {
    slug,
    title: data.title || slug,
    category: data.category || "기타",
    order: Number(data.order) || 999,
    description: data.description || "",
    updated: data.updated || "",
  };
}

export function listSlugs(): string[] {
  return fs
    .readdirSync(WIKI_DIR)
    .filter((f) => f.endsWith(".md"))
    .map((f) => f.slice(0, -3));
}

export function listDocs(): WikiMeta[] {
  const cat = (c: string) => {
    const i = CATEGORY_ORDER.indexOf(c);
    return i === -1 ? CATEGORY_ORDER.length : i;
  };
  return listSlugs()
    .map((slug) => toMeta(slug, readFile(slug).data))
    .sort((a, b) => cat(a.category) - cat(b.category) || a.order - b.order);
}

/** 분류별로 묶은 목록 (정렬 유지) */
export function groupedDocs(): { category: string; docs: WikiMeta[] }[] {
  const groups: { category: string; docs: WikiMeta[] }[] = [];
  for (const d of listDocs()) {
    const g = groups.find((x) => x.category === d.category);
    if (g) g.docs.push(d);
    else groups.push({ category: d.category, docs: [d] });
  }
  return groups;
}

export function getDoc(slug: string): WikiDoc | null {
  if (!listSlugs().includes(slug)) return null;
  const { data, body } = readFile(slug);

  const headings: WikiHeading[] = [];
  const seen = new Map<string, number>();
  const renderer: RendererObject = {
    heading(token) {
      const inner = this.parser.parseInline(token.tokens);
      const id = slugify(token.text, seen);
      if (token.depth === 2) headings.push({ id, text: token.text });
      return `<h${token.depth} id="${id}"><a href="#${id}" class="anchor" aria-hidden="true">#</a>${inner}</h${token.depth}>\n`;
    },
    link(token) {
      const inner = this.parser.parseInline(token.tokens);
      const external = /^https?:\/\//.test(token.href);
      const attrs = external ? ' target="_blank" rel="noopener noreferrer"' : "";
      return `<a href="${token.href}"${attrs}>${inner}</a>`;
    },
  };
  const marked = new Marked({ gfm: true, renderer });

  let html = marked.parse(body, { async: false }) as string;

  // GitHub 식 알림 상자: "> [!NOTE]" · "> [!TIP]" · "> [!WARNING]"
  html = html.replace(
    /<blockquote>\s*<p>\[!(NOTE|TIP|WARNING)\]\s*/g,
    (_, kind: string) => `<blockquote class="callout callout-${kind.toLowerCase()}"><p>`,
  );

  // 표는 모바일에서 가로 스크롤되도록 감쌉니다.
  html = html
    .replace(/<table>/g, '<div class="table-wrap" tabindex="0"><table>')
    .replace(/<\/table>/g, "</table></div>");

  return { ...toMeta(slug, data), html, headings };
}

/** 마크다운 → 검색용 평문 */
function plain(md: string) {
  return md
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`([^`]*)`/g, "$1")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/^>\s*\[![A-Z]+\]/gm, "")
    .replace(/[#>*_|~-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function searchIndex(): WikiSearchEntry[] {
  return listDocs().map((d) => ({
    slug: d.slug,
    title: d.title,
    category: d.category,
    description: d.description,
    text: plain(readFile(d.slug).body),
  }));
}
