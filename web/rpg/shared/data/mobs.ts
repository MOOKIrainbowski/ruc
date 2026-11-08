import type { Stats } from "../character.ts";
import { BASE_STATS } from "./stats.ts";
import type { ElementId } from "./elements.ts";
import { tierGear, type DropRoll } from "./items.ts";

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
  /** 움직이지도 공격하지도 않음 (정화의 구슬) */
  passive?: boolean;
  /** 보스 패턴 (§20-4 JSON 타임라인) */
  boss?: BossDef;
};

/**
 * 보스 패턴 (§20-4). 페이즈는 HP 비율이 hp 이하가 되면 시작 — 페이즈마다 timeline 을 loopMs 주기로 되풀이.
 * 모든 패턴은 바닥 경고(windMs) 뒤에 터짐. mul = 공격력 배율.
 *  slam   대상 플레이어 발밑 원 (count 명, 없으면 1)      nova   보스 주변 원
 *  line   대상 쪽 직선 (lunge = 끝까지 돌진)               summon 졸개 소환
 *  spread 모든 플레이어 발밑 원 — 다른 사람이 원 안에 있으면 그만큼 더 아픔 (분산)
 *  stack  한 명 발밑 큰 원 — 안에 든 사람 수로 피해를 나눔 (집결)
 *  orbs   정화의 구슬 n개 — ms 안에 다 부수지 못하면 남은 구슬마다 최대 체력의 pct 피해 (전멸기)
 */
export type BossMove =
  | { kind: "slam"; r: number; windMs: number; mul: number; count?: number; fx?: { id: string; ms: number; v?: number } }
  | { kind: "nova"; r: number; windMs: number; mul: number; fx?: { id: string; ms: number; v?: number } }
  | { kind: "line"; len: number; width: number; windMs: number; mul: number; lunge?: boolean; fx?: { id: string; ms: number; v?: number } }
  | { kind: "summon"; mob: string; n: number; grade: Grade }
  | { kind: "spread"; r: number; windMs: number; mul: number }
  | { kind: "stack"; r: number; windMs: number; mul: number }
  | { kind: "orbs"; n: number; ms: number; pct: number };
export type BossPhase = { hp: number; name: string; loopMs: number; timeline: { at: number; move: BossMove }[] };
export type BossDef = { phases: BossPhase[] };

/** 그 단계 장비를 전부 같은 확률로 (P15) */
const gearDrops = (key: string, chance: number): DropRoll[] => tierGear(key).map((item) => ({ item, chance }));

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

  // ── 황혼 고원 (P15, Lv30~100 · D99) — 드롭: 그 레벨대 장비 단계 (data/items.ts TIERS) ──
  dusk_imp: {
    name: "황혼 임프", el: "dark", r: 9, hp: 150, atk: 14, pdef: 10, mdef: 12, speed: 80, exp: 70, aggro: 110, leash: 160, ruc: [8, 16],
    attack: { kind: "melee", range: 20, cdMs: 1100, windMs: 250, fx: { id: "curse", ms: 2000, chance: 0.2 } },
    special: { shape: "line", size: 70, width: 16, windMs: 600, mul: 1.6, cdMs: 6000, minRange: 30, maxRange: 80, lunge: true },
    drops: [{ item: "enhance_stone", chance: 0.1 }, { item: "hp_potion_l", chance: 0.06 }, { item: "ore", chance: 0.2 }, ...gearDrops("dusk", 0.012), { item: "random_box", chance: 0.004 }],
  },
  stone_boar: {
    name: "바위 멧돼지", el: "earth", r: 12, hp: 230, atk: 15, pdef: 18, mdef: 8, speed: 70, exp: 85, aggro: 90, leash: 170, ruc: [10, 20],
    attack: { kind: "melee", range: 24, cdMs: 1500, windMs: 350 },
    special: { shape: "line", size: 100, width: 22, windMs: 800, mul: 2, cdMs: 7000, minRange: 40, maxRange: 110, lunge: true, fx: { id: "stun", ms: 800 } },
    drops: [{ item: "enhance_stone", chance: 0.12 }, { item: "ore", chance: 0.4, qty: [1, 2] }, { item: "hp_potion_l", chance: 0.06 }, ...gearDrops("dusk", 0.015), { item: "random_box", chance: 0.005 }],
  },
  frost_harpy: {
    name: "서리 하피", el: "ice", r: 10, hp: 170, atk: 16, pdef: 10, mdef: 16, speed: 90, exp: 95, aggro: 150, leash: 180, ruc: [12, 24],
    attack: { kind: "shot", range: 140, cdMs: 1400, windMs: 300, speed: 180, fx: { id: "chill", ms: 2500, v: 0.15 } },
    special: { shape: "circle", size: 40, windMs: 1000, mul: 1.8, cdMs: 7000, maxRange: 150, fx: { id: "slow", ms: 2000, v: 0.4 } },
    drops: [{ item: "enhance_stone", chance: 0.14 }, { item: "mp_potion_l", chance: 0.08 }, { item: "blue_herb", chance: 0.3 }, ...gearDrops("frost", 0.012), { item: "random_box", chance: 0.006 }],
  },
  ember_golem: {
    name: "잿불 골렘", el: "fire", r: 14, hp: 300, atk: 17, pdef: 22, mdef: 12, speed: 50, exp: 110, aggro: 110, leash: 170, ruc: [14, 28],
    attack: { kind: "melee", range: 26, cdMs: 1800, windMs: 450, fx: { id: "burn", ms: 3000, dot: 0.1, chance: 0.3 } },
    special: { shape: "circle", size: 46, windMs: 1100, mul: 2.2, every: 3, fx: { id: "stun", ms: 900 } },
    drops: [{ item: "enhance_stone", chance: 0.18 }, { item: "ore", chance: 0.5, qty: [1, 3] }, { item: "blessed_stone", chance: 0.01 }, ...gearDrops("frost", 0.006), ...gearDrops("ember", 0.008), { item: "random_box", chance: 0.007 }],
  },
  shade_knight: {
    name: "그림자 기사", el: "dark", r: 12, hp: 260, atk: 19, pdef: 20, mdef: 18, speed: 75, exp: 125, aggro: 160, leash: 180, ruc: [16, 32],
    attack: { kind: "melee", range: 26, cdMs: 1200, windMs: 300, fx: { id: "bleed", ms: 3000, dot: 0.12, chance: 0.3 } },
    special: { shape: "line", size: 110, width: 20, windMs: 700, mul: 2.2, cdMs: 6000, minRange: 40, maxRange: 120, lunge: true, fx: { id: "fear", ms: 800 } },
    drops: [{ item: "enhance_stone", chance: 0.2 }, { item: "dark_sap", chance: 0.3 }, { item: "protect_scroll", chance: 0.02 }, ...gearDrops("ember", 0.012), { item: "random_box", chance: 0.008 }],
  },
  storm_drake: {
    name: "폭풍 비룡", el: "electric", r: 14, hp: 320, atk: 20, pdef: 18, mdef: 20, speed: 85, exp: 140, aggro: 170, leash: 200, ruc: [20, 40],
    attack: { kind: "shot", range: 150, cdMs: 1300, windMs: 300, speed: 200, fx: { id: "shock", ms: 400, chance: 0.2 } },
    special: { shape: "circle", size: 52, windMs: 1200, mul: 2.4, cdMs: 6500, maxRange: 160, fx: { id: "stun", ms: 1000 } },
    drops: [{ item: "enhance_stone", chance: 0.25 }, { item: "blessed_stone", chance: 0.02 }, { item: "storage_ticket", chance: 0.002 }, ...gearDrops("storm", 0.01), { item: "random_box", chance: 0.01 }],
  },

  // ── 던전 "고목의 유적" (§20-3) ──────────────────────────────────────
  sprout_slime: {
    name: "새싹 슬라임", el: "grass", r: 9, hp: 80, atk: 8, pdef: 4, mdef: 3, speed: 55, exp: 16, aggro: 110, leash: 2000, ruc: [1, 3],
    attack: { kind: "melee", range: 18, cdMs: 1400, windMs: 350, fx: { id: "root", ms: 600, chance: 0.15 } },
    drops: [{ item: "slime_jelly", chance: 0.8, qty: [1, 2] }, { item: "hp_potion_s", chance: 0.1 }, { item: "enhance_stone", chance: 0.03 }],
  },
  shroom_shaman: {
    name: "버섯 주술사", el: "poison", r: 9, hp: 120, atk: 13, pdef: 5, mdef: 10, speed: 50, exp: 40, aggro: 140, leash: 2000, ruc: [3, 8],
    attack: { kind: "shot", range: 130, cdMs: 1700, windMs: 350, speed: 140, fx: { id: "poison", ms: 4000, dot: 0.1, chance: 0.5 } },
    special: { shape: "circle", size: 34, windMs: 1000, mul: 1.6, cdMs: 7000, maxRange: 140, fx: { id: "slow", ms: 2000, v: 0.3 } },
    drops: [{ item: "spore_dust", chance: 0.8, qty: [1, 2] }, { item: "enhance_stone", chance: 0.12 }, { item: "mp_potion_m", chance: 0.08 }],
  },
  moss_golem: {
    name: "이끼 골렘", el: "earth", r: 13, hp: 260, atk: 16, pdef: 18, mdef: 8, speed: 42, exp: 70, aggro: 120, leash: 2000, ruc: [5, 12],
    attack: { kind: "melee", range: 24, cdMs: 1800, windMs: 450 },
    special: { shape: "circle", size: 40, windMs: 1100, mul: 2.2, every: 3, fx: { id: "stun", ms: 900 } },
    drops: [{ item: "moss_heart", chance: 0.35 }, { item: "enhance_stone", chance: 0.15 }, { item: "hp_potion_m", chance: 0.1 }],
  },
  shadow_vine: {
    name: "그림자 덩굴", el: "dark", r: 10, hp: 170, atk: 18, pdef: 8, mdef: 12, speed: 80, exp: 80, aggro: 160, leash: 2000, ruc: [6, 14],
    attack: { kind: "melee", range: 22, cdMs: 1100, windMs: 250, fx: { id: "curse", ms: 3000, chance: 0.3 } },
    special: { shape: "line", size: 90, width: 18, windMs: 650, mul: 1.6, cdMs: 6000, minRange: 40, maxRange: 100, lunge: true, fx: { id: "root", ms: 1000 } },
    drops: [{ item: "dark_sap", chance: 0.4 }, { item: "ench_vamp", chance: 0.05 }, { item: "ench_crit", chance: 0.05 }, { item: "enhance_stone", chance: 0.12 }],
  },
  tree_knight: {
    name: "고대 수목 기사", el: "iron", r: 12, hp: 220, atk: 18, pdef: 16, mdef: 10, speed: 60, exp: 90, aggro: 160, leash: 2000, ruc: [10, 20],
    attack: { kind: "melee", range: 26, cdMs: 1300, windMs: 350, fx: { id: "bleed", ms: 3000, dot: 0.1, chance: 0.3 } },
    special: { shape: "circle", size: 42, windMs: 900, mul: 2, every: 3, fx: { id: "airborne", ms: 600 } },
    drops: [{ item: "ancient_bark", chance: 0.5 }, { item: "enhance_stone", chance: 0.3 }, { item: "ancient_blade", chance: 0.03 }, { item: "ancient_mail", chance: 0.03 }],
  },
  twin_witch: {
    name: "쌍둥이 꽃의 마녀", el: "poison", r: 11, hp: 200, atk: 17, pdef: 8, mdef: 16, speed: 65, exp: 100, aggro: 180, leash: 2000, ruc: [12, 24],
    attack: { kind: "shot", range: 150, cdMs: 1300, windMs: 300, speed: 170, fx: { id: "blind", ms: 1500, chance: 0.25 } },
    special: { shape: "circle", size: 46, windMs: 1200, mul: 2.2, cdMs: 6500, maxRange: 160, fx: { id: "poison", ms: 5000, v: 0 } },
    drops: [{ item: "twin_ring", chance: 0.35 }, { item: "enhance_stone", chance: 0.4 }, { item: "spirit_leaf", chance: 0.2 }],
  },
  purify_orb: {
    name: "정화의 구슬", el: "light", r: 9, hp: 60, atk: 0, pdef: 0, mdef: 0, speed: 0, exp: 0, aggro: 0, leash: 99999, ruc: [0, 0], passive: true,
    attack: { kind: "melee", range: 0, cdMs: 1e9, windMs: 0 }, drops: [],
  },
  fern: {
    name: "성난 숲정령 페른", el: "grass", r: 16, hp: 160, atk: 11, pdef: 14, mdef: 14, speed: 70, exp: 140, aggro: 220, leash: 99999, ruc: [40, 60],
    attack: { kind: "melee", range: 26, cdMs: 1500, windMs: 400 },
    drops: [
      { item: "spirit_leaf", chance: 1 }, { item: "enhance_stone", chance: 1, qty: [3, 3] }, { item: "ancient_blade", chance: 0.05 }, { item: "ancient_staff", chance: 0.05 },
      { item: "ancient_bow", chance: 0.05 }, { item: "hp_potion_l", chance: 0.5 },
    ],
    boss: {
      phases: [
        { hp: 1, name: "성난 숲정령", loopMs: 12_000, timeline: [
          { at: 2500, move: { kind: "slam", r: 34, windMs: 1100, mul: 2.2, fx: { id: "root", ms: 1200 } } },
          { at: 6000, move: { kind: "line", len: 120, width: 26, windMs: 900, mul: 2, lunge: true } },
          { at: 9000, move: { kind: "summon", mob: "sprout_slime", n: 3, grade: "low" } },
        ] },
        { hp: 0.5, name: "폭풍의 정령 (바람)", loopMs: 10_000, timeline: [
          { at: 1500, move: { kind: "nova", r: 70, windMs: 1300, mul: 2.4, fx: { id: "airborne", ms: 700 } } },
          { at: 4500, move: { kind: "slam", r: 30, windMs: 1000, mul: 2, count: 3 } },
          { at: 7500, move: { kind: "line", len: 140, width: 28, windMs: 800, mul: 2.2, lunge: true } },
          { at: 9000, move: { kind: "summon", mob: "sprout_slime", n: 2, grade: "mid" } },
        ] },
      ],
    },
  },
  eldra: {
    name: "고목왕 엘드라", el: "grass", r: 20, hp: 150, atk: 12, pdef: 18, mdef: 18, speed: 55, exp: 200, aggro: 260, leash: 99999, ruc: [100, 150],
    attack: { kind: "melee", range: 30, cdMs: 1600, windMs: 450, fx: { id: "bleed", ms: 3000, dot: 0.08, chance: 0.3 } },
    drops: [{ item: "spirit_leaf", chance: 1, qty: [2, 3] }, { item: "ancient_bark", chance: 1, qty: [2, 4] }, { item: "hp_potion_l", chance: 1, qty: [2, 3] }],
    boss: {
      phases: [
        { hp: 1, name: "깨어난 고목왕", loopMs: 14_000, timeline: [
          { at: 2500, move: { kind: "slam", r: 36, windMs: 1100, mul: 2.2, fx: { id: "root", ms: 1000 } } },
          { at: 6000, move: { kind: "nova", r: 64, windMs: 1400, mul: 2.4 } },
          { at: 9500, move: { kind: "summon", mob: "shadow_vine", n: 2, grade: "mid" } },
          { at: 12_000, move: { kind: "slam", r: 30, windMs: 1000, mul: 2, count: 5 } },
        ] },
        { hp: 0.66, name: "가시 덩굴의 분노", loopMs: 16_000, timeline: [
          { at: 2000, move: { kind: "spread", r: 40, windMs: 2600, mul: 1.6 } },
          { at: 6500, move: { kind: "nova", r: 72, windMs: 1300, mul: 2.6, fx: { id: "airborne", ms: 700 } } },
          { at: 9500, move: { kind: "stack", r: 46, windMs: 3000, mul: 6 } },
          { at: 13_500, move: { kind: "line", len: 160, width: 30, windMs: 900, mul: 2.4, lunge: true } },
        ] },
        { hp: 0.33, name: "균형이 깨진 정령", loopMs: 30_000, timeline: [
          { at: 2000, move: { kind: "orbs", n: 4, ms: 12_000, pct: 0.35 } },
          { at: 5000, move: { kind: "slam", r: 32, windMs: 1000, mul: 2.2, count: 5 } },
          { at: 9000, move: { kind: "nova", r: 76, windMs: 1300, mul: 2.8 } },
          { at: 16_000, move: { kind: "spread", r: 40, windMs: 2400, mul: 1.8 } },
          { at: 21_000, move: { kind: "stack", r: 46, windMs: 2800, mul: 6.5 } },
          { at: 26_000, move: { kind: "summon", mob: "shadow_vine", n: 2, grade: "high" } },
        ] },
      ],
    },
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
