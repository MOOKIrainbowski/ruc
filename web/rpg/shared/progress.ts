import { CAPS } from "./data/stats.ts";
import type { ElementId } from "./data/elements.ts";
import type { LineId } from "./data/jobs.ts";
import { SKILLS, type SkillDef, type Slot } from "./data/skills.ts";

/**
 * 성장 (§10-3 숙련도 · 스킬 레벨 · 잠재력, §10-4 등급). 서버 판정과 클라이언트 예측 · 툴팁이 같은 함수를 씁니다.
 */

export const SKILL_GRADES = ["low", "mid", "high", "trans"] as const;
export type SkillGrade = (typeof SKILL_GRADES)[number];
/** power = 위력 · cost = 자원 소모 · fx = 부가 효과 수치 · range = 범위 · 사거리 */
export const GRADE: Record<SkillGrade, { name: string; power: number; cost: number; fx: number; range: number }> = {
  low: { name: "하급", power: 1, cost: 1, fx: 1, range: 1 },
  mid: { name: "중급", power: 1.2, cost: 0.9, fx: 1.2, range: 1 },
  high: { name: "상급", power: 1.45, cost: 0.8, fx: 1.2, range: 1.15 },
  trans: { name: "초월급", power: 1.8, cost: 0.7, fx: 1.2, range: 1.15 },
};

export type Learned = { id: string; grade: SkillGrade; lv: number; mastery: number; slot: Slot | null };
/** 캐릭터 성장 상태 — 계열 · 세부 직업 · 원소술사 보조 속성 · 잠재력 [물리, 마법] · 배운 스킬 */
export type Progress = { line: LineId | null; job: string | null; sub: ElementId | null; pot: [number, number]; skills: Learned[]; awake?: boolean };

/** 숙련도 (§10-3): 사용 1 · 적중 대상당 2 · 처치 기여 5 · 힐 · 버프 대상당 2 */
export const MASTERY = { use: 1, hit: 2, kill: 5, support: 2 };
/** 몹 등급 배율 (일반 1 ~ 대재앙 10) — GRADES 순서 */
export const MASTERY_MOB = [1, 1.5, 2, 3, 5, 7, 10];
/** 스킬 습득 시 잠재력 상승 (난이도별) */
export const POT_GAIN = { low: 1, mid: 3, high: 6, transcendent: 12 } as const;

export const needMastery = (lv: number) => Math.floor(30 * lv ** 1.5);
/** 첫 습득 레벨 = 1 + floor(잠재력 / 40), 플레이어 레벨 이하 */
export const startLevel = (pot: number, playerLv: number) => Math.max(1, Math.min(playerLv, 1 + Math.floor(pot / 40)));
/** 스킬 계열의 잠재력 (물리 · 마법 · 혼합 = 평균) */
export const potOf = (sk: SkillDef, pot: [number, number]) => (sk.category === "physical" ? pot[0] : sk.category === "magical" ? pot[1] : (pot[0] + pot[1]) / 2);

/**
 * 숙련도 더하기 → 연속 레벨업. 스킬 레벨은 플레이어 레벨을 넘지 않고, 넘치는 숙련도는 1레벨분까지만 보관.
 * 플레이어가 레벨업한 뒤 amount 0 으로 부르면 쌓아 둔 숙련도로 바로 오름. 반환: 오른 레벨 수
 */
export function addMastery(l: Learned, amount: number, playerLv: number): number {
  l.mastery += amount;
  let up = 0;
  while (l.lv < playerLv && l.mastery >= needMastery(l.lv)) {
    l.mastery -= needMastery(l.lv);
    l.lv++;
    up++;
  }
  if (l.lv >= playerLv) l.mastery = Math.min(l.mastery, needMastery(l.lv));
  l.mastery = Math.round(l.mastery * 100) / 100;
  return up;
}

/** 등급 · 레벨을 반영한 수치. power = 피해 · 치유 · 보호막 배율 (등급 × 레벨당 +4%), 쿨은 5레벨마다 −3% 뒤 쿨감 */
export function skillNums(sk: SkillDef, l: { grade: SkillGrade; lv: number } | undefined, cdr: number) {
  const g = GRADE[l?.grade ?? "low"];
  const lv = l?.lv ?? 1;
  const c = (v?: number) => (v ? Math.round(v * g.cost) : 0);
  return {
    power: g.power * (1 + 0.04 * (lv - 1)),
    gradeMul: g.power,
    lv,
    fx: g.fx,
    range: sk.range * g.range,
    radius: (sk.radius ?? 0) * g.range,
    cost: { stamina: sk.cost.stamina ?? 0, mana: c(sk.cost.mana), energy: c(sk.cost.energy) },
    cooldownMs: sk.cooldownMs * (1 - 0.03 * Math.floor(lv / 5)) * (1 - Math.min(cdr, CAPS.cdr)),
  };
}

/** 장착한 슬롯 → 스킬 id (평타 A 는 무기에서) */
export const slotsOf = (p: Progress, basic: string): Partial<Record<Slot, string>> => {
  const out: Partial<Record<Slot, string>> = { A: basic };
  for (const l of p.skills) if (l.slot) out[l.slot] = l.id;
  return out;
};

/** 레벨 · 전직 상태로 자동 습득할 스킬 (아직 안 배운 것) */
export const autoLearn = (p: Progress, level: number) =>
  Object.values(SKILLS).filter(
    (sk) => sk.learnLv !== undefined && sk.learnLv <= level && !sk.hidden && sk.slot !== "A" && !p.skills.some((l) => l.id === sk.id) &&
      (sk.job.includes("all") || (!!p.line && sk.job.includes(p.line)) || (!!p.job && sk.job.includes(p.job))),
  );
