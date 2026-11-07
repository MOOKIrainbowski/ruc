import type { Stats } from "../character.ts";
import { BASE_STATS } from "./stats.ts";
import type { ElementId } from "./elements.ts";
import type { DropRoll } from "./items.ts";

/** 몹 등급 (§20-1) */
export const GRADES = {
  normal: { name: "일반", hp: 1, atk: 1, exp: 1, color: "#ffffff" },
  low: { name: "하급", hp: 1.5, atk: 1.2, exp: 1.5, color: "#a3e635" },
  mid: { name: "중급", hp: 2.5, atk: 1.5, exp: 2.5, color: "#facc15" },
  high: { name: "상급", hp: 4, atk: 1.9, exp: 4, color: "#fb923c" },
  minor: { name: "소재앙", hp: 10, atk: 2.5, exp: 10, color: "#ef4444" },
  calamity: { name: "재앙", hp: 40, atk: 3.2, exp: 40, color: "#be123c" },
  catastrophe: { name: "대재앙", hp: 120, atk: 4, exp: 150, color: "#a855f7" },
} as const;
export type Grade = keyof typeof GRADES;

/**
 * 몹 (§18 햇살 초원 · §20). 수치는 Lv1 기준, 레벨당 HP +30% · 공격 +15% · 방어 +1.
 * aggro = 먼저 덤비는 거리(0 = 맞아야 반격). leash = 리젠 구역 밖으로 이만큼 벗어나면 돌아감(귀환 중 무적 · 체력 회복).
 * attack.kind: melee = 사거리 안 근접, shot = 투사체. special = 바닥 경고 후 강한 공격 (§10-2).
 * drops = 드롭 테이블 (§20-2) — 종류별로 고정, 운이 높으면 개수가 늘어남. ruc = 처치한 사람 베타 지갑으로 [최소, 최대] × (1 + 등급 순번).
 */
export type MobAttack = { kind: "melee" | "shot"; range: number; cdMs: number; windMs: number; speed?: number; fx?: { id: string; ms: number; v?: number; dot?: number; chance?: number } };
export type MobSpecial = {
  shape: "circle" | "line";
  /** circle: 반지름 · line: 길이 */
  size: number;
  width?: number;
  windMs: number;
  mul: number;
  /** 평타 몇 번마다(every) 또는 쿨마다(cdMs) */
  every?: number;
  cdMs?: number;
  minRange?: number;
  maxRange?: number;
  /** line 이면 경고선 끝까지 돌진 */
  lunge?: boolean;
  fx?: { id: string; ms: number; v?: number };
};
export type MobDef = {
  name: string;
  el: ElementId;
  /** 피격 반지름 px */
  r: number;
  hp: number;
  atk: number;
  pdef: number;
  mdef: number;
  speed: number;
  exp: number;
  aggro: number;
  leash: number;
  attack: MobAttack;
  special?: MobSpecial;
  drops: DropRoll[];
  ruc: [number, number];
};

export const MOBS: Record<string, MobDef> = {
  slime: {
    name: "초원 슬라임", el: "grass", r: 9, hp: 70, atk: 7, pdef: 3, mdef: 2, speed: 50, exp: 14, aggro: 0, leash: 120, ruc: [1, 3],
    attack: { kind: "melee", range: 18, cdMs: 1500, windMs: 350, fx: { id: "slow", ms: 1200, v: 0.2, chance: 0.3 } },
    drops: [
      { item: "slime_jelly", chance: 0.7, qty: [1, 2] }, { item: "hp_potion_s", chance: 0.12 }, { item: "mp_potion_s", chance: 0.08 },
      { item: "leather_cap", chance: 0.04 }, { item: "leather_boots", chance: 0.04 }, { item: "old_dagger", chance: 0.04 },
      { item: "wood_sword", chance: 0.03 }, { item: "apprentice_staff", chance: 0.03 }, { item: "copper_ring", chance: 0.02 },
    ],
  },
  rabbit: {
    name: "토끼정령", el: "wind", r: 8, hp: 60, atk: 9, pdef: 2, mdef: 6, speed: 85, exp: 18, aggro: 0, leash: 140, ruc: [1, 4],
    attack: { kind: "shot", range: 110, cdMs: 1800, windMs: 300, speed: 150 },
    drops: [
      { item: "rabbit_fluff", chance: 0.7, qty: [1, 2] }, { item: "en_potion_s", chance: 0.1 }, { item: "hp_potion_s", chance: 0.08 },
      { item: "hunter_bow", chance: 0.04 }, { item: "leather_gloves", chance: 0.04 }, { item: "meadow_cape", chance: 0.03 }, { item: "rabbit_charm", chance: 0.015 },
    ],
  },
  goblin: {
    name: "숲 고블린", el: "none", r: 10, hp: 140, atk: 12, pdef: 8, mdef: 4, speed: 62, exp: 30, aggro: 80, leash: 140, ruc: [2, 6],
    attack: { kind: "melee", range: 22, cdMs: 1400, windMs: 300 },
    special: { shape: "circle", size: 30, windMs: 800, mul: 2, every: 3, fx: { id: "stun", ms: 600 } },
    drops: [
      { item: "goblin_coin", chance: 0.8, qty: [1, 3] }, { item: "hp_potion_m", chance: 0.1 }, { item: "en_potion_s", chance: 0.08 },
      { item: "leather_vest", chance: 0.05 }, { item: "leather_pants", chance: 0.05 }, { item: "goblin_axe", chance: 0.04 },
      { item: "wood_sword", chance: 0.03 }, { item: "enhance_stone", chance: 0.03 }, { item: "book_random", chance: 0.006 },
    ],
  },
  wolf: {
    name: "덩굴 늑대", el: "grass", r: 10, hp: 190, atk: 15, pdef: 8, mdef: 8, speed: 88, exp: 46, aggro: 110, leash: 160, ruc: [4, 10],
    attack: { kind: "melee", range: 22, cdMs: 1100, windMs: 200, fx: { id: "bleed", ms: 3000, dot: 0.12, chance: 0.3 } },
    special: { shape: "line", size: 80, width: 20, windMs: 700, mul: 1.5, cdMs: 6000, minRange: 40, maxRange: 90, lunge: true, fx: { id: "root", ms: 1000 } },
    drops: [
      { item: "wolf_pelt", chance: 0.75, qty: [1, 2] }, { item: "hp_potion_m", chance: 0.1 }, { item: "mp_potion_m", chance: 0.06 }, { item: "hp_potion_l", chance: 0.02 },
      { item: "sprout_helm", chance: 0.03 }, { item: "sprout_mail", chance: 0.03 }, { item: "sprout_greaves", chance: 0.03 }, { item: "sprout_boots", chance: 0.03 }, { item: "sprout_gloves", chance: 0.03 },
      { item: "fang_sword", chance: 0.02 }, { item: "vine_wand", chance: 0.02 }, { item: "fang_earring", chance: 0.015 }, { item: "enhance_stone", chance: 0.04 },
      { item: "book_random", chance: 0.012 },
    ],
  },
};

/** 레벨 · 등급을 반영한 기본 스탯 (finalStats 의 base) */
export function mobStats(def: MobDef, lv: number, grade: Grade): Stats {
  const g = GRADES[grade];
  const atk = def.atk * (1 + 0.15 * (lv - 1)) * g.atk;
  return {
    ...BASE_STATS,
    hp: Math.round(def.hp * (1 + 0.3 * (lv - 1)) * g.hp),
    atk,
    ap: atk,
    pdef: def.pdef + (lv - 1),
    mdef: def.mdef + (lv - 1),
    moveSpeed: def.speed,
    spirit: 5 + lv,
    regen: 0,
  };
}

/** 처치 경험치: 몹이 나보다 10레벨 이상 낮으면 10% (§7) */
export const mobExp = (def: MobDef, lv: number, grade: Grade, playerLv: number) =>
  Math.round(def.exp * (1 + 0.25 * (lv - 1)) * GRADES[grade].exp * (playerLv - lv >= 10 ? 0.1 : 1));
