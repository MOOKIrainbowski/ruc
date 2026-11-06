import { BASE_STATS, LEVEL_GROWTH } from "./data/stats.ts";

export type Stats = typeof BASE_STATS;

/** 견습 모험가 기본값 + 레벨 성장 (§6-2). 직업 배율 · 장비 · 버프는 P2~P4 에서 이 위에 얹습니다. */
export function baseStats(level: number): Stats {
  const s = { ...BASE_STATS };
  for (const [k, v] of Object.entries(LEVEL_GROWTH)) s[k as keyof Stats] += v * (level - 1);
  return s;
}

/** §7 필요 경험치 */
export const expToNext = (level: number) => Math.floor(100 * level ** 1.6);

export function validNickname(n: unknown): n is string {
  return typeof n === "string" && /^[가-힣a-zA-Z0-9_]{2,12}$/.test(n);
}
