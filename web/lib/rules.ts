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
