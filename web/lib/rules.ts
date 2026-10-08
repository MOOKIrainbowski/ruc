import raw from "@/content/rules.json";

// 규칙 본문은 content/rules.json 에 있습니다. 문구를 고칠 때는 그 파일만 고치고
// updatedAt 을 바꾸세요 — 코드는 손대지 않아도 됩니다.

export type Rule = { no: string; text: string; sanction: string };
export type RuleGroup = { no: string; title: string; rules: Rule[] };
export type RuleSection = { id: string; label: string; intro: string; groups: RuleGroup[] };
export type SanctionTier = {
  tier: number;
  discord: string;
  minecraft: string;
  confiscate: string;
  extra: string;
};

export type RulesData = {
  updatedAt: string;
  /** 비어 있지 않으면 페이지 위에 검토 안내를 띄웁니다. */
  reviewNote?: string;
  intro: string;
  sections: RuleSection[];
  sanctions: { title: string; intro: string; tiers: SanctionTier[]; notes: string[] };
};

// JSON import 는 타입이 넓게 잡히므로 여기서 한 번 고정합니다.
export const rules: RulesData = raw;

// ── .txt 내보내기 (규칙 페이지의 복사 · 다운로드 버튼) ──────────────────

export const SITE_RULES = "https://ruc-server.vercel.app/rules";

/** 탭 하나(공통 · 디스코드 · 마인크래프트)를 디스코드 공지에 그대로 붙일 수 있는 글로. */
export function sectionText(data: RulesData, s: RuleSection): string {
  const lines = [`러크 서버 규칙 — ${s.label}`, `최종 수정 ${data.updatedAt} · ${SITE_RULES}#${s.id}`, "", s.intro];
  for (const g of s.groups) {
    lines.push("", `${g.no}. ${g.title}`);
    for (const r of g.rules) lines.push(`  ${r.no}  ${r.text}`, `        제재: ${r.sanction}`);
  }
  return lines.join("\n") + "\n";
}

export function sanctionsText(data: RulesData): string {
  const { title, intro, tiers, notes } = data.sanctions;
  const lines = [`러크 서버 규칙 — ${title}`, `최종 수정 ${data.updatedAt} · ${SITE_RULES}#sanctions`, "", intro, ""];
  for (const t of tiers) {
    lines.push(
      `${t.tier}단계 | 디스코드 ${t.discord} | 마인크래프트 ${t.minecraft} | Gold 몰수 ${t.confiscate} | 추가 ${t.extra}`,
    );
  }
  lines.push("", ...notes.map((n) => `· ${n}`));
  return lines.join("\n") + "\n";
}
