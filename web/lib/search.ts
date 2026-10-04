/**
 * 검색 공용 — 상단 바(사이트 전체)와 위키 사이드바가 같이 씁니다.
 * 클라이언트에서도 import 하므로 fs 같은 서버 전용 코드는 두지 않습니다.
 * 색인을 만드는 쪽은 app/api/search/route.ts (사이트) · lib/wiki.ts (위키) 입니다.
 */

/** 검색 색인 한 줄 — 클라이언트로 내려가므로 본문은 평문으로만 */
export type SearchEntry = {
  href: string;
  title: string;
  /** 결과에서 제목 옆에 작게 보이는 분류 (페이지 · 위키 분류 · 규칙 등) */
  category: string;
  description: string;
  text: string;
};

/**
 * 띄어쓰기로 나눈 단어가 전부 들어 있는 항목만 남기고,
 * 제목 > 설명 > 본문 순으로 점수를 매깁니다. 0 이면 제외.
 */
export function score(e: SearchEntry, terms: string[]) {
  const title = e.title.toLowerCase();
  const desc = e.description.toLowerCase();
  const text = e.text.toLowerCase();
  let s = 0;
  for (const t of terms) {
    if (title.includes(t)) s += 10;
    else if (desc.includes(t)) s += 4;
    else if (text.includes(t)) s += 1;
    else return 0;
  }
  return s;
}

export function search(index: SearchEntry[], terms: string[], limit = 8) {
  if (terms.length === 0) return [];
  return index
    .map((e) => ({ e, s: score(e, terms) }))
    .filter((r) => r.s > 0)
    .sort((a, b) => b.s - a.s)
    .slice(0, limit)
    .map((r) => r.e);
}

/** 결과 아래 한 줄 — 찾은 단어 주변을 잘라 보여 줍니다. */
export function snippet(e: SearchEntry, term: string) {
  const text = e.text || e.description;
  const i = text.toLowerCase().indexOf(term);
  if (i < 0) return text.slice(0, 70);
  const start = Math.max(0, i - 24);
  return (start > 0 ? "…" : "") + text.slice(start, start + 70) + "…";
}

export function toTerms(q: string) {
  return q.trim().toLowerCase().split(/\s+/).filter(Boolean);
}
