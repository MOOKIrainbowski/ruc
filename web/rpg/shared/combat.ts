import type { Stats } from "./character.ts";
import { ELEMENTS, ELEMENT_IDS, type ElementId } from "./data/elements.ts";
import { CAPS, COMBAT, SECONDARY } from "./data/stats.ts";

/** 전투 공식 (§6-3 · §13-1). 서버가 판정하고, 클라이언트는 툴팁 · 미리보기에 같은 함수를 씁니다. */

export type FullStats = Stats & typeof SECONDARY & { elDef: Record<ElementId, number> };
export type StatKey = Exclude<keyof FullStats, "elDef">;
/** 스탯 보정: 최종 = (기본 + Σadd) × (1 + Σmul). k 가 "elDef" 면 el 속성 방어력 */
export type Mod = { k: StatKey | "elDef"; add?: number; mul?: number; el?: ElementId };

export function finalStats(base: Stats, mods: readonly Mod[]): FullStats {
  const s = { ...base, ...SECONDARY, elDef: Object.fromEntries(ELEMENT_IDS.map((e) => [e, 0])) } as FullStats;
  const add = new Map<string, number>();
  const mul = new Map<string, number>();
  for (const m of mods) {
    const key = m.k === "elDef" ? `el:${m.el}` : m.k;
    add.set(key, (add.get(key) ?? 0) + (m.add ?? 0));
    mul.set(key, (mul.get(key) ?? 0) + (m.mul ?? 0));
  }
  for (const [key, a] of add) {
    const f = 1 + (mul.get(key) ?? 0);
    if (key.startsWith("el:")) s.elDef[key.slice(3) as ElementId] = Math.max(0, (s.elDef[key.slice(3) as ElementId] + a) * f);
    else (s as Record<StatKey, number>)[key as StatKey] = Math.max(0, ((s as Record<StatKey, number>)[key as StatKey] + a) * f);
  }
  s.atkSpeed = Math.min(s.atkSpeed, CAPS.atkSpeed);
  s.moveSpeed = Math.min(s.moveSpeed, CAPS.moveSpeed);
  s.cdr = Math.min(s.cdr, CAPS.cdr);
  s.tenacity = Math.min(s.tenacity, CAPS.tenacity);
  s.luck = Math.min(s.luck, CAPS.luck);
  return s;
}

/** 방어 상쇄: 방어력 100 이면 50% 경감 (수확체감) */
export const mitigation = (def: number, pen: number) => 100 / (100 + Math.max(0, def * (1 - pen)));

/** 속성 상성 (§12-2) */
export function elementMul(atk: ElementId | null, def: ElementId | null): number {
  if (!atk || !def) return 1;
  const a = ELEMENTS[atk];
  return (a.strong as readonly string[]).includes(def) ? 1.25 : (a.weak as readonly string[]).includes(def) ? 0.8 : 1;
}

/** 시전 · 평타 시간: 기본 × 100 / 공속 (상한 250) */
export const castMs = (baseMs: number, atkSpeed: number) => (baseMs * 100) / Math.min(Math.max(atkSpeed, 1), CAPS.atkSpeed);
export const cooldownMs = (baseMs: number, s: FullStats) => baseMs * (1 - s.cdr);

export type Hit = {
  base: number;
  atkRatio: number;
  apRatio: number;
  cat: "physical" | "magical" | "hybrid";
  el: ElementId | null;
  /** 스킬 등급 배율 (§10-4) · 스킬 레벨 */
  gradeMul?: number;
  skillLv?: number;
  skill?: boolean;
  melee?: boolean;
  /** 무(無) 속성 스킬 기본 위력 +8% 같은 추가 배율 */
  power?: number;
};

/** §13-1 피해 공식. defEl = 맞는 쪽 속성(몹 속성 · 플레이어 주 속성) */
export function computeDamage(a: FullStats, d: FullStats, h: Hit, defEl: ElementId | null, crit: boolean): number {
  const raw =
    (h.base + a.atk * h.atkRatio + a.ap * h.apRatio) *
    (h.gradeMul ?? 1) *
    (1 + 0.04 * ((h.skillLv ?? 1) - 1)) *
    (1 + (h.power ?? 0)) *
    elementMul(h.el, defEl) *
    (crit ? a.critDmg : 1) *
    (1 + a.dmgUp + (h.skill ? a.skillDmg : 0) + d.dmgTakenUp) *
    (1 - Math.min(CAPS.dmgDown, d.dmgDown + (h.melee ? d.meleeDown : 0)));
  const phys = h.cat === "physical" ? 1 : h.cat === "hybrid" ? 0.5 : 0;
  const def = phys * mitigation(d.pdef, a.penPhys) + (1 - phys) * mitigation(d.mdef, a.penMag);
  const elDef = h.el ? 100 / (100 + Math.max(0, d.elDef[h.el] * (1 - a.elPen))) : 1;
  return Math.max(1, Math.round(raw * def * elDef));
}

/** 치유: 주는 쪽 · 받는 쪽 정신력 각각 × (1 + 정신력/200) (§6-3) */
export const healAmount = (base: number, giver: FullStats, taker: FullStats) =>
  base * (1 + giver.spirit / 200) * (1 + giver.healPower) * (1 + taker.spirit / 200) * (1 + taker.healTaken);

/** 정신계 디버프 저항 확률 */
export const mentalResist = (spirit: number) => spirit / (spirit + 200);

/** 초당 HP 자연 회복 */
export const hpRegen = (s: FullStats, inCombat: boolean) => s.regen * COMBAT.regenPerPoint * (inCombat ? COMBAT.regenInCombatMul : 1);
/** 초당 마나 · 기력 회복 */
export const resRegen = (max: number, inCombat: boolean) => max * (inCombat ? COMBAT.resPerSec : COMBAT.resPerSecIdle);
