import type { ElementId } from "./elements.ts";

/**
 * 스킬 (§10-6 스키마를 따름, 거리는 px · 시간은 ms).
 * job = 배울 수 있는 계열 · 세부 직업 ("all" = 견습 공통). learnLv = 그 레벨이 되면 자동 습득 (전직 조건을 채웠을 때).
 * 계열 공통 Q2 · W1 · E2 · R1 + 세부 직업 전용 Q1 · W1 · E1 · R1 = 직업마다 Q3 · W2 · E3 · R2 (§10-1 최소 기준).
 *
 * targeting
 *   melee 앞쪽 부채꼴 · skillshot 투사체 · dash 마우스 쪽 돌진 경로 타격 · ally 커서 근처 아군(없으면 자신)
 *   self 자신 중심 반경 · target 커서 근처(24px) 적 · ground 커서 지점 반경 · blink 커서 쪽 순간이동
 * repeat = 같은 조준으로 n번 (채널링 · 지속 장판), lockMs = 그동안 이동 불가, charge = 누르고 있다 떼면 최대 mul 배
 */

export type Slot = "A" | "Q" | "W" | "E" | "R";
export const SLOTS: Slot[] = ["A", "Q", "W", "E", "R"];

export type Targeting = "melee" | "skillshot" | "dash" | "ally" | "self" | "target" | "ground" | "blink";
export type SkillFx = { id: string; ms: number; v?: number; dot?: number; chance?: number };
export type Amount = { base: number; apRatio: number; hpPct: number; ms?: number };

export type SkillDef = {
  id: string;
  name: string;
  slot: Slot;
  category: "physical" | "magical" | "hybrid";
  targeting: Targeting;
  range: number;
  /** 부채꼴 각도(도) · 투사체 / 돌진 판정 폭 · self · ground · blink 착지 반경 */
  arc?: number;
  width?: number;
  radius?: number;
  speed?: number;
  /** 돌진 시간 (이동 스텝 수) */
  dashSteps?: number;
  castMs: number;
  cooldownMs: number;
  cost: { stamina?: number; mana?: number; energy?: number };
  damage?: { base: number; atkRatio: number; apRatio: number };
  /** 치유: base + 주문력 × apRatio + 대상 최대 HP × hpPct. ms 가 있으면 지속 회복 */
  heal?: Amount;
  /** 보호막 (ms 동안) */
  shield?: Amount & { ms: number };
  elementInherit: boolean;
  /** 고정 속성 · 원소술사 보조 속성(sub) */
  el?: ElementId;
  sub?: boolean;
  /** 맞은 적 · 시전자 · 범위 안 아군(시전자 포함, ally 는 대상) */
  effects?: SkillFx[];
  selfFx?: SkillFx[];
  allyFx?: SkillFx[];
  /** 아군 디버프 해제 */
  cleanse?: boolean;
  /** 넉백 px (음수면 끌어당김) */
  knock?: number;
  pierce?: number;
  bounce?: number;
  /** 부채꼴로 여러 발 (count 발, spread 도 간격) */
  count?: number;
  spread?: number;
  repeat?: { n: number; ms: number };
  lockMs?: number;
  /** ground: 바닥 경고 뒤 발동 */
  delayMs?: number;
  charge?: { ms: number; mul: number };
  /** dash 를 마우스 반대쪽으로 */
  back?: boolean;
  /** target: 대상 뒤로 순간이동한 뒤 타격 */
  blinkTo?: boolean;
  /** 대상 HP 가 이 비율 이하면 피해 2배 */
  execute?: number;
  /** 이 타격의 치명타 확률 + */
  crit?: number;
  /** 커서 근처의 쓰러진 아군을 이 HP 비율로 부활 */
  revive?: number;
  /** 보조 스킬을 ms 뒤에 (시전자 위치 기준) */
  after?: { ms: number; skill: string };
  /** 특수 동작: wall = 적 투사체를 막는 벽, alternate = 반복마다 주 · 보조 속성을 번갈아 */
  special?: "wall" | "alternate";
  /** 스킬창에 안 보이는 보조 스킬 */
  hidden?: boolean;
  job: string[];
  learnLv?: number;
  threat: number;
  icon: string;
  desc: string;
  difficulty: "low" | "mid" | "high" | "transcendent";
};

type Def = Omit<SkillDef, "id" | "elementInherit" | "threat" | "difficulty" | "castMs" | "cost"> &
  Partial<Pick<SkillDef, "elementInherit" | "threat" | "difficulty" | "castMs" | "cost">>;

const RAW: Record<string, Def> = {
  // ── 평타 (D20) — 무기 칸의 무기에 따라 바뀜 ──
  punch: {
    name: "맨손 평타", slot: "A", category: "physical", targeting: "melee", range: 26, arc: 110, cooldownMs: 500, cost: { stamina: 3 },
    damage: { base: 0, atkRatio: 1, apRatio: 0 }, job: ["all"], icon: "punch", desc: "앞쪽을 주먹으로 칩니다. 무기를 들면 무기 평타로 바뀝니다.",
  },
  slash: {
    name: "무기 베기", slot: "A", category: "physical", targeting: "melee", range: 30, arc: 120, cooldownMs: 600, cost: { stamina: 3 },
    damage: { base: 0, atkRatio: 1.1, apRatio: 0 }, job: ["all"], icon: "dash_slash", desc: "검 · 도끼 · 단검으로 앞쪽을 넓게 벱니다.",
  },
  shot: {
    name: "활쏘기", slot: "A", category: "physical", targeting: "skillshot", range: 200, width: 4, speed: 320, cooldownMs: 700, cost: { stamina: 3 },
    damage: { base: 0, atkRatio: 1, apRatio: 0 }, job: ["all"], icon: "magic_arrow", desc: "마우스 쪽으로 화살을 쏩니다.",
  },
  bolt: {
    name: "마력탄", slot: "A", category: "magical", targeting: "skillshot", range: 160, width: 6, speed: 220, cooldownMs: 800, cost: { stamina: 2 },
    damage: { base: 0, atkRatio: 0, apRatio: 1 }, job: ["all"], icon: "magic_arrow", desc: "지팡이 · 완드로 작은 마력 덩어리를 날립니다.",
  },

  // ── 견습 모험가 공통 (§9-1, D15) ──
  magic_arrow: {
    name: "마력 화살", slot: "Q", category: "magical", targeting: "skillshot", range: 176, width: 6, speed: 240, cooldownMs: 1500, cost: { mana: 8, stamina: 2 },
    damage: { base: 18, atkRatio: 0, apRatio: 0.9 }, elementInherit: true, job: ["all"], learnLv: 1,
    icon: "magic_arrow", desc: "마우스 쪽으로 정령의 힘을 담은 화살을 쏩니다. 속성에 따라 부가 효과가 붙습니다.",
  },
  dash_slash: {
    name: "대시 베기", slot: "W", category: "physical", targeting: "dash", range: 80, width: 22, dashSteps: 10, cooldownMs: 12_000, cost: { energy: 15, stamina: 8 },
    damage: { base: 25, atkRatio: 1.2, apRatio: 0 }, elementInherit: true, threat: 1.2, job: ["all"], learnLv: 1,
    icon: "dash_slash", desc: "마우스 쪽으로 5칸 돌진하며 지나가는 적을 벱니다. 위험할 때 빠져나가는 데도 씁니다.",
  },
  first_aid: {
    name: "응급 처치", slot: "E", category: "magical", targeting: "ally", range: 160, castMs: 400, cooldownMs: 8000, cost: { mana: 15, stamina: 4 },
    heal: { base: 20, apRatio: 0.5, hpPct: 0.06, ms: 3000 }, threat: 0.5, job: ["all"], learnLv: 1,
    icon: "first_aid", desc: "커서 근처 아군(없으면 자신)을 3초 동안 치료합니다. 시전 중에는 움직일 수 없습니다.",
  },

  // ── 탱커 공통 ──
  shield_bash: {
    name: "방패 강타", slot: "Q", category: "physical", targeting: "melee", range: 30, arc: 90, cooldownMs: 3500, cost: { energy: 8, stamina: 6 },
    damage: { base: 30, atkRatio: 0.9, apRatio: 0 }, effects: [{ id: "slow", ms: 1500, v: 0.3 }], elementInherit: true, threat: 2, job: ["tank"], learnLv: 10,
    icon: "shield", desc: "앞을 방패로 짧게 쳐서 1.5초 동안 30% 둔화시킵니다.",
  },
  taunt_shout: {
    name: "도발의 외침", slot: "Q", category: "physical", targeting: "self", range: 0, radius: 64, cooldownMs: 4000, cost: { energy: 10, stamina: 4 },
    effects: [{ id: "taunt", ms: 2500 }], threat: 3, job: ["tank"], learnLv: 15,
    icon: "fist", desc: "주변 4칸의 적을 2.5초 동안 도발해 나만 노리게 합니다.",
  },
  iron_wall: {
    name: "철벽", slot: "W", category: "physical", targeting: "self", range: 0, cooldownMs: 15_000, cost: { energy: 15, stamina: 6 },
    selfFx: [{ id: "dmgdown", ms: 2000, v: 0.6 }], lockMs: 2000, job: ["tank"], learnLv: 10,
    icon: "wall", desc: "2초 동안 받는 피해가 60% 줄어듭니다. 그동안 움직일 수 없습니다.",
  },
  earth_split: {
    name: "대지 가르기", slot: "E", category: "physical", targeting: "melee", range: 48, arc: 70, castMs: 300, cooldownMs: 8000, cost: { energy: 20, stamina: 8 },
    damage: { base: 50, atkRatio: 1.3, apRatio: 0 }, effects: [{ id: "airborne", ms: 600 }], elementInherit: true, threat: 2, job: ["tank"], learnLv: 10,
    icon: "crack", desc: "앞쪽 부채꼴을 내려쳐 피해를 주고 0.6초 띄웁니다.",
  },
  counter_stance: {
    name: "반격 태세", slot: "E", category: "physical", targeting: "self", range: 0, cooldownMs: 9000, cost: { energy: 15, stamina: 6 },
    selfFx: [{ id: "counter", ms: 1000 }], lockMs: 1000, threat: 2, job: ["tank"], learnLv: 20,
    icon: "thorn", desc: "1초 동안 받는 근접 공격을 막고 그대로 되돌려 주며 공격자를 1초 기절시킵니다.",
  },
  fortress: {
    name: "불굴의 요새", slot: "R", category: "physical", targeting: "self", range: 0, radius: 96, cooldownMs: 90_000, cost: { energy: 50, stamina: 10 },
    selfFx: [{ id: "unstoppable", ms: 6000 }], allyFx: [{ id: "dmgdown", ms: 6000, v: 0.25 }], after: { ms: 6000, skill: "fortress_end" },
    threat: 3, job: ["tank"], learnLv: 10, difficulty: "mid",
    icon: "crown", desc: "6초 동안 군중 제어에 걸리지 않고, 주변 아군이 받는 피해가 25% 줄어듭니다. 끝날 때 주변 적을 기절시킵니다.",
  },
  fortress_end: {
    name: "요새 붕괴", slot: "R", category: "physical", targeting: "self", range: 0, radius: 64, cooldownMs: 0,
    damage: { base: 60, atkRatio: 1.5, apRatio: 0 }, effects: [{ id: "stun", ms: 1200 }], threat: 3, job: ["tank"], hidden: true, icon: "crown", desc: "",
  },
  // 수호기사
  shield_throw: {
    name: "방패 투척", slot: "Q", category: "physical", targeting: "skillshot", range: 160, width: 10, speed: 260, bounce: 2, cooldownMs: 4000, cost: { energy: 10, stamina: 4 },
    damage: { base: 35, atkRatio: 1, apRatio: 0 }, elementInherit: true, threat: 2, job: ["guardian"], learnLv: 30,
    icon: "shield", desc: "방패를 던집니다. 맞으면 근처의 다른 적에게 최대 2번 튕깁니다.",
  },
  guardian_rush: {
    name: "수호 돌진", slot: "W", category: "physical", targeting: "ally", range: 160, dashSteps: 12, cooldownMs: 14_000, cost: { energy: 15, stamina: 8 },
    shield: { base: 30, apRatio: 0, hpPct: 0.1, ms: 4000 }, job: ["guardian"], learnLv: 30,
    icon: "wing", desc: "커서 근처 아군에게 돌진해 그 아군에게 최대 HP 10% 보호막을 씌웁니다 (아군이 없으면 자신).",
  },
  sanctuary_wall: {
    name: "성역의 방패", slot: "E", category: "physical", targeting: "self", range: 0, cooldownMs: 10_000, cost: { energy: 20, stamina: 6 }, special: "wall",
    job: ["guardian"], learnLv: 30, difficulty: "mid",
    icon: "wall", desc: "바라보는 쪽 땅에 5초 동안 방패를 박아 적의 투사체를 막는 벽을 세웁니다.",
  },
  kings_guard: {
    name: "왕의 수호", slot: "R", category: "physical", targeting: "self", range: 0, radius: 160, cooldownMs: 100_000, cost: { energy: 60, stamina: 10 },
    shield: { base: 0, apRatio: 0, hpPct: 0.2, ms: 6000 }, allyFx: [{ id: "immune", ms: 3000 }], job: ["guardian"], learnLv: 30, difficulty: "high",
    icon: "crown", desc: "주변 10칸 아군 전원에게 최대 HP 20% 보호막과 3초 상태이상 면역을 줍니다.",
  },

  // ── 전사 공통 ──
  double_slash: {
    name: "연속 베기", slot: "Q", category: "physical", targeting: "melee", range: 32, arc: 120, cooldownMs: 2000, cost: { energy: 6, stamina: 4 },
    damage: { base: 18, atkRatio: 0.7, apRatio: 0 }, repeat: { n: 2, ms: 160 }, elementInherit: true, job: ["warrior"], learnLv: 10,
    icon: "sword", desc: "앞쪽을 빠르게 두 번 벱니다.",
  },
  lunge: {
    name: "돌진 찌르기", slot: "Q", category: "physical", targeting: "dash", range: 64, width: 18, dashSteps: 8, cooldownMs: 4000, cost: { energy: 10, stamina: 6 },
    damage: { base: 30, atkRatio: 1, apRatio: 0 }, elementInherit: true, job: ["warrior"], learnLv: 15,
    icon: "arrowUp", desc: "마우스 쪽으로 4칸 찌르며 나아갑니다.",
  },
  battle_cry: {
    name: "전투 함성", slot: "W", category: "physical", targeting: "self", range: 0, cooldownMs: 16_000, cost: { energy: 15, stamina: 4 },
    selfFx: [{ id: "haste", ms: 3000, v: 0.3 }, { id: "tenacity", ms: 4000, v: 0.4 }], cleanse: true, job: ["warrior"], learnLv: 10,
    icon: "wind", desc: "몸에 걸린 디버프를 털어 내고 3초 동안 이속 +30%, 4초 동안 강인함 +40%.",
  },
  whirlwind: {
    name: "회전 베기", slot: "E", category: "physical", targeting: "self", range: 0, radius: 44, cooldownMs: 7000, cost: { energy: 18, stamina: 8 },
    damage: { base: 25, atkRatio: 0.6, apRatio: 0 }, repeat: { n: 3, ms: 250 }, elementInherit: true, job: ["warrior"], learnLv: 10,
    icon: "swirl", desc: "제자리에서 세 바퀴 돌며 주변 적을 벱니다. 돌면서 움직일 수 있습니다.",
  },
  crushing_blow: {
    name: "강타", slot: "E", category: "physical", targeting: "melee", range: 34, arc: 60, castMs: 400, cooldownMs: 9000, cost: { energy: 22, stamina: 8 },
    damage: { base: 60, atkRatio: 1.6, apRatio: 0 }, effects: [{ id: "shatter", ms: 4000, v: 8 }, { id: "stun", ms: 500 }], elementInherit: true, job: ["warrior"], learnLv: 20,
    icon: "fist", desc: "힘을 모아 내려쳐 0.5초 기절시키고 4초 동안 방어력을 8 깎습니다.",
  },
  sword_storm: {
    name: "검풍", slot: "R", category: "physical", targeting: "skillshot", range: 180, width: 40, speed: 220, pierce: 99, castMs: 300, cooldownMs: 70_000, cost: { energy: 45, stamina: 10 },
    damage: { base: 90, atkRatio: 2.2, apRatio: 0 }, knock: 24, elementInherit: true, job: ["warrior"], learnLv: 10, difficulty: "mid",
    icon: "wave", desc: "거대한 검기를 날려 꿰뚫은 모든 적에게 큰 피해를 주고 밀어냅니다.",
  },
  // 전투기사
  knight_strike: {
    name: "기사의 일격", slot: "Q", category: "physical", targeting: "melee", range: 34, arc: 80, cooldownMs: 3000, cost: { energy: 9, stamina: 4 },
    damage: { base: 35, atkRatio: 1.1, apRatio: 0 }, selfFx: [{ id: "guard", ms: 3000, v: 6 }], elementInherit: true, job: ["battle_knight"], learnLv: 30,
    icon: "sword", desc: "단단히 베고 3초 동안 방어력 +6.",
  },
  parry: {
    name: "흘려 막기", slot: "W", category: "physical", targeting: "self", range: 0, cooldownMs: 13_000, cost: { energy: 12, stamina: 6 },
    selfFx: [{ id: "invuln", ms: 700 }, { id: "haste", ms: 1500, v: 0.25 }], job: ["battle_knight"], learnLv: 30,
    icon: "shield", desc: "0.7초 동안 모든 피해를 흘려 내고 1.5초 동안 이속 +25%.",
  },
  knight_charge: {
    name: "돌격", slot: "E", category: "physical", targeting: "dash", range: 112, width: 24, dashSteps: 12, cooldownMs: 9000, cost: { energy: 22, stamina: 10 },
    damage: { base: 50, atkRatio: 1.3, apRatio: 0 }, effects: [{ id: "stun", ms: 700 }], elementInherit: true, job: ["battle_knight"], learnLv: 30,
    icon: "arrowUp", desc: "7칸 돌격하며 부딪친 적을 0.7초 기절시킵니다.",
  },
  commander: {
    name: "기사단장의 결의", slot: "R", category: "physical", targeting: "self", range: 0, radius: 120, cooldownMs: 80_000, cost: { energy: 50, stamina: 10 },
    selfFx: [{ id: "power", ms: 8000, v: 0.3 }, { id: "atkspd", ms: 8000, v: 30 }, { id: "vamp", ms: 8000, v: 0.1 }], allyFx: [{ id: "power", ms: 8000, v: 0.15 }],
    job: ["battle_knight"], learnLv: 30, difficulty: "high",
    icon: "crown", desc: "8초 동안 공격력 +30% · 공속 +30 · 흡혈 10%, 주변 아군 공격력 +15%.",
  },

  // ── 암살자 공통 ──
  shuriken: {
    name: "표창", slot: "Q", category: "physical", targeting: "skillshot", range: 170, width: 6, speed: 340, pierce: 1, cooldownMs: 1800, cost: { energy: 6, stamina: 2 },
    damage: { base: 18, atkRatio: 0.8, apRatio: 0 }, elementInherit: true, job: ["assassin"], learnLv: 10,
    icon: "shuriken", desc: "빠른 표창을 던집니다. 적 하나를 꿰뚫고 지나갑니다.",
  },
  backstab: {
    name: "급소 찌르기", slot: "Q", category: "physical", targeting: "melee", range: 26, arc: 60, cooldownMs: 3000, cost: { energy: 10, stamina: 4 },
    damage: { base: 30, atkRatio: 1.2, apRatio: 0 }, crit: 0.25, elementInherit: true, job: ["assassin"], learnLv: 15,
    icon: "target", desc: "급소를 찌릅니다. 치명타 확률 +25%.",
  },
  smoke: {
    name: "연막", slot: "W", category: "physical", targeting: "self", range: 0, radius: 56, cooldownMs: 14_000, cost: { energy: 15, stamina: 4 },
    effects: [{ id: "blind", ms: 2000 }], selfFx: [{ id: "stealth", ms: 2500 }, { id: "haste", ms: 2500, v: 0.3 }], job: ["assassin"], learnLv: 10,
    icon: "ghost", desc: "연막을 터뜨려 주변 적을 실명시키고 2.5초 동안 은신 · 이속 +30%. 공격하거나 맞으면 은신이 풀립니다.",
  },
  shadow_strike: {
    name: "그림자 습격", slot: "E", category: "physical", targeting: "target", range: 140, blinkTo: true, cooldownMs: 8000, cost: { energy: 18, stamina: 6 },
    damage: { base: 45, atkRatio: 1.4, apRatio: 0 }, elementInherit: true, job: ["assassin"], learnLv: 10,
    icon: "eye", desc: "커서 근처의 적 뒤로 순간이동해 벱니다.",
  },
  poison_blade: {
    name: "독 바르기", slot: "E", category: "physical", targeting: "self", range: 0, cooldownMs: 10_000, cost: { energy: 15, stamina: 2 },
    selfFx: [{ id: "venom", ms: 6000 }], job: ["assassin"], learnLv: 20,
    icon: "drop", desc: "6초 동안 평타가 독을 겁니다 (중첩).",
  },
  thousand_blades: {
    name: "천 개의 칼날", slot: "R", category: "physical", targeting: "self", range: 0, radius: 72, cooldownMs: 75_000, cost: { energy: 50, stamina: 10 },
    damage: { base: 25, atkRatio: 0.6, apRatio: 0 }, repeat: { n: 6, ms: 200 }, lockMs: 1200, selfFx: [{ id: "unstoppable", ms: 1200 }], elementInherit: true,
    job: ["assassin"], learnLv: 10, difficulty: "mid",
    icon: "stars", desc: "1.2초 동안 칼날 폭풍으로 주변을 6번 벱니다. 그동안 군중 제어에 걸리지 않습니다.",
  },
  // 닌자
  triple_shuriken: {
    name: "삼연 표창", slot: "Q", category: "physical", targeting: "skillshot", range: 170, width: 6, speed: 340, count: 3, spread: 15, cooldownMs: 3500, cost: { energy: 12, stamina: 4 },
    damage: { base: 14, atkRatio: 0.52, apRatio: 0 }, elementInherit: true, job: ["ninja"], learnLv: 30,
    icon: "shuriken", desc: "표창 세 개를 부채꼴로 던집니다.",
  },
  shunpo: {
    name: "순보", slot: "W", category: "physical", targeting: "blink", range: 112, cooldownMs: 12_000, cost: { energy: 12, stamina: 4 },
    selfFx: [{ id: "haste", ms: 1000, v: 0.2 }], job: ["ninja"], learnLv: 30,
    icon: "blink", desc: "마우스 쪽으로 7칸 순간이동합니다.",
  },
  leaf_cut: {
    name: "낙엽 베기", slot: "E", category: "physical", targeting: "dash", range: 96, width: 20, dashSteps: 8, cooldownMs: 8000, cost: { energy: 20, stamina: 6 },
    damage: { base: 50, atkRatio: 1.3, apRatio: 0 }, effects: [{ id: "bleed", ms: 3000, dot: 0.15 }], elementInherit: true, job: ["ninja"], learnLv: 30,
    icon: "dash_slash", desc: "순식간에 6칸을 지나가며 벱니다. 맞은 적은 출혈.",
  },
  shadow_execute: {
    name: "그림자 처형", slot: "R", category: "physical", targeting: "target", range: 160, blinkTo: true, execute: 0.3, castMs: 200, cooldownMs: 80_000, cost: { energy: 50, stamina: 8 },
    damage: { base: 120, atkRatio: 3, apRatio: 0 }, elementInherit: true, job: ["ninja"], learnLv: 30, difficulty: "high",
    icon: "skull", desc: "대상 뒤로 이동해 큰 피해를 줍니다. 대상 HP 가 30% 이하면 피해 2배.",
  },

  // ── 마법사 공통 ──
  element_bolt: {
    name: "원소탄", slot: "Q", category: "magical", targeting: "skillshot", range: 220, width: 8, speed: 260, cooldownMs: 1500, cost: { mana: 10, stamina: 2 },
    damage: { base: 20, atkRatio: 0, apRatio: 1 }, elementInherit: true, job: ["mage"], learnLv: 10,
    icon: "star", desc: "주 속성 마력탄을 쏩니다.",
  },
  arcane_burst: {
    name: "마력 폭발", slot: "Q", category: "magical", targeting: "ground", range: 200, radius: 28, cooldownMs: 3500, cost: { mana: 14, stamina: 2 },
    damage: { base: 25, atkRatio: 0, apRatio: 0.8 }, elementInherit: true, job: ["mage"], learnLv: 15,
    icon: "sparkle", desc: "커서 지점을 즉시 폭발시킵니다.",
  },
  mage_blink: {
    name: "점멸", slot: "W", category: "magical", targeting: "blink", range: 100, cooldownMs: 14_000, cost: { mana: 15, stamina: 2 },
    job: ["mage"], learnLv: 10, icon: "blink", desc: "마우스 쪽으로 6칸 순간이동합니다.",
  },
  element_nova: {
    name: "원소 폭발진", slot: "E", category: "magical", targeting: "ground", range: 220, radius: 40, delayMs: 700, cooldownMs: 8000, cost: { mana: 25, stamina: 2 },
    damage: { base: 60, atkRatio: 0, apRatio: 1.6 }, elementInherit: true, job: ["mage"], learnLv: 10,
    icon: "burst", desc: "0.7초 뒤 커서 지점에 큰 원소 폭발을 일으킵니다.",
  },
  bind: {
    name: "속박의 사슬", slot: "E", category: "magical", targeting: "target", range: 200, cooldownMs: 9000, cost: { mana: 20, stamina: 2 },
    damage: { base: 30, atkRatio: 0, apRatio: 0.8 }, effects: [{ id: "root", ms: 1500 }], job: ["mage"], learnLv: 20,
    icon: "chain", desc: "커서 근처의 적을 사슬로 묶어 1.5초 속박합니다.",
  },
  meteor: {
    name: "운석 낙하", slot: "R", category: "magical", targeting: "ground", range: 240, radius: 64, delayMs: 1200, cooldownMs: 80_000, cost: { mana: 60, stamina: 4 },
    damage: { base: 150, atkRatio: 0, apRatio: 3 }, knock: 30, elementInherit: true, job: ["mage"], learnLv: 10, difficulty: "mid",
    icon: "meteor", desc: "1.2초 뒤 거대한 운석이 떨어져 범위 안 적에게 큰 피해를 주고 밀어냅니다.",
  },
  // 원소술사
  sub_bolt: {
    name: "보조 원소탄", slot: "Q", category: "magical", targeting: "skillshot", range: 220, width: 8, speed: 280, sub: true, cooldownMs: 2000, cost: { mana: 8, stamina: 2 },
    damage: { base: 22, atkRatio: 0, apRatio: 1 }, job: ["elementalist"], learnLv: 30,
    icon: "star", desc: "보조 속성 마력탄 — 주 속성 상태이상과 원소 반응을 일으키기 좋습니다.",
  },
  element_shield: {
    name: "원소 보호막", slot: "W", category: "magical", targeting: "self", range: 0, cooldownMs: 15_000, cost: { mana: 20, stamina: 2 },
    shield: { base: 40, apRatio: 1, hpPct: 0, ms: 4000 }, selfFx: [{ id: "haste", ms: 2000, v: 0.2 }], job: ["elementalist"], learnLv: 30,
    icon: "ring", desc: "4초 동안 주문력만큼 보호막을 두르고 2초 동안 이속 +20%.",
  },
  dual_storm: {
    name: "이중 원소 폭풍", slot: "E", category: "magical", targeting: "ground", range: 200, radius: 48, delayMs: 300, repeat: { n: 4, ms: 400 }, special: "alternate",
    cooldownMs: 10_000, cost: { mana: 22, stamina: 2 }, damage: { base: 25, atkRatio: 0, apRatio: 0.7 }, elementInherit: true, job: ["elementalist"], learnLv: 30, difficulty: "mid",
    icon: "swirl", desc: "주 속성과 보조 속성이 번갈아 4번 몰아쳐 스스로 원소 반응을 일으킵니다.",
  },
  cataclysm: {
    name: "원소 붕괴", slot: "R", category: "magical", targeting: "ground", range: 220, radius: 80, delayMs: 1000, repeat: { n: 2, ms: 120 }, special: "alternate",
    cooldownMs: 90_000, cost: { mana: 70, stamina: 4 }, damage: { base: 110, atkRatio: 0, apRatio: 2.3 }, elementInherit: true, job: ["elementalist"], learnLv: 30, difficulty: "high",
    icon: "meteor", desc: "1초 뒤 주 속성 · 보조 속성 폭발이 연달아 터져 큰 원소 반응을 일으킵니다.",
  },

  // ── 원거리 딜러 공통 ──
  quick_shot: {
    name: "속사", slot: "Q", category: "physical", targeting: "skillshot", range: 300, width: 4, speed: 380, cooldownMs: 1200, cost: { energy: 5, stamina: 2 },
    damage: { base: 15, atkRatio: 0.85, apRatio: 0 }, elementInherit: true, job: ["ranged"], learnLv: 10,
    icon: "arrow", desc: "빠르게 화살 한 발을 쏩니다.",
  },
  multishot: {
    name: "다중 사격", slot: "Q", category: "physical", targeting: "skillshot", range: 260, width: 4, speed: 360, count: 3, spread: 20, cooldownMs: 3500, cost: { energy: 12, stamina: 3 },
    damage: { base: 14, atkRatio: 0.6, apRatio: 0 }, elementInherit: true, job: ["ranged"], learnLv: 15,
    icon: "bow", desc: "화살 세 발을 부채꼴로 쏩니다.",
  },
  disengage: {
    name: "후퇴 사격", slot: "W", category: "physical", targeting: "dash", range: 64, width: 0, dashSteps: 8, back: true, cooldownMs: 13_000, cost: { energy: 12, stamina: 4 },
    selfFx: [{ id: "haste", ms: 1500, v: 0.2 }], job: ["ranged"], learnLv: 10,
    icon: "arrowDown", desc: "마우스 반대쪽으로 4칸 물러나고 1.5초 동안 이속 +20%.",
  },
  piercing_arrow: {
    name: "관통 화살", slot: "E", category: "physical", targeting: "skillshot", range: 300, width: 8, speed: 420, pierce: 99, castMs: 300, cooldownMs: 7000, cost: { energy: 18, stamina: 4 },
    damage: { base: 50, atkRatio: 1.4, apRatio: 0 }, elementInherit: true, job: ["ranged"], learnLv: 10,
    icon: "arrow", desc: "일직선의 모든 적을 꿰뚫는 화살.",
  },
  arrow_rain: {
    name: "화살비", slot: "E", category: "physical", targeting: "ground", range: 260, radius: 48, repeat: { n: 5, ms: 300 }, cooldownMs: 10_000, cost: { energy: 22, stamina: 4 },
    damage: { base: 15, atkRatio: 0.45, apRatio: 0 }, effects: [{ id: "slow", ms: 1000, v: 0.2 }], job: ["ranged"], learnLv: 20,
    icon: "arrowDown", desc: "커서 지점에 1.5초 동안 화살비를 내립니다. 맞은 적은 둔화.",
  },
  storm_arrow: {
    name: "폭풍 화살", slot: "R", category: "physical", targeting: "skillshot", range: 360, width: 24, speed: 300, pierce: 99, castMs: 500, cooldownMs: 70_000, cost: { energy: 45, stamina: 6 },
    damage: { base: 130, atkRatio: 2.6, apRatio: 0 }, knock: 40, elementInherit: true, job: ["ranged"], learnLv: 10, difficulty: "mid",
    icon: "wind", desc: "폭풍을 두른 거대한 화살이 모든 적을 꿰뚫고 날려 버립니다.",
  },
  // 궁수
  aimed_shot: {
    name: "조준 사격", slot: "Q", category: "physical", targeting: "skillshot", range: 320, width: 6, speed: 450, charge: { ms: 1200, mul: 2 }, cooldownMs: 2500, cost: { energy: 10, stamina: 3 },
    damage: { base: 25, atkRatio: 1, apRatio: 0 }, elementInherit: true, job: ["archer"], learnLv: 30,
    icon: "target", desc: "누르고 있다가 떼면 쏩니다. 1.2초까지 모을수록 피해가 최대 2배.",
  },
  roll_shot: {
    name: "구르며 쏘기", slot: "W", category: "physical", targeting: "dash", range: 56, width: 0, dashSteps: 8, cooldownMs: 12_000, cost: { energy: 12, stamina: 4 },
    selfFx: [{ id: "atkspd", ms: 3000, v: 40 }], job: ["archer"], learnLv: 30,
    icon: "foot", desc: "마우스 쪽으로 굴러 3초 동안 공속 +40.",
  },
  snare_arrow: {
    name: "덫 화살", slot: "E", category: "physical", targeting: "skillshot", range: 280, width: 6, speed: 380, cooldownMs: 8000, cost: { energy: 16, stamina: 3 },
    damage: { base: 30, atkRatio: 0.9, apRatio: 0 }, effects: [{ id: "root", ms: 1500 }], elementInherit: true, job: ["archer"], learnLv: 30,
    icon: "chain", desc: "맞은 적을 1.5초 속박합니다.",
  },
  hawk_eye: {
    name: "매의 눈", slot: "R", category: "physical", targeting: "self", range: 0, cooldownMs: 60_000, cost: { energy: 40, stamina: 4 },
    selfFx: [{ id: "critup", ms: 8000, v: 0.3 }, { id: "atkspd", ms: 8000, v: 50 }], job: ["archer"], learnLv: 30, difficulty: "high",
    icon: "eye", desc: "8초 동안 치명타 확률 · 피해 +30%, 공속 +50.",
  },

  // ── 서포터 공통 ──
  heal_light: {
    name: "치유의 빛", slot: "Q", category: "magical", targeting: "ally", range: 200, cooldownMs: 2500, cost: { mana: 12, stamina: 2 },
    heal: { base: 30, apRatio: 0.8, hpPct: 0.04 }, threat: 0.5, job: ["support"], learnLv: 10,
    icon: "heartPlus", desc: "커서 근처 아군(없으면 자신)을 즉시 치료합니다.",
  },
  holy_bolt: {
    name: "신성 화살", slot: "Q", category: "magical", targeting: "skillshot", range: 220, width: 8, speed: 260, cooldownMs: 2000, cost: { mana: 8, stamina: 2 },
    damage: { base: 18, atkRatio: 0, apRatio: 0.9 }, elementInherit: true, job: ["support"], learnLv: 15,
    icon: "star", desc: "빛을 모아 쏩니다.",
  },
  swift_blessing: {
    name: "축복의 발걸음", slot: "W", category: "magical", targeting: "self", range: 0, radius: 96, cooldownMs: 14_000, cost: { mana: 18, stamina: 2 },
    allyFx: [{ id: "haste", ms: 3000, v: 0.25 }], cleanse: true, job: ["support"], learnLv: 10,
    icon: "wing", desc: "주변 6칸 아군의 디버프를 풀고 3초 동안 이속 +25%.",
  },
  prayer_shield: {
    name: "보호의 기도", slot: "E", category: "magical", targeting: "ally", range: 200, cooldownMs: 8000, cost: { mana: 20, stamina: 2 },
    shield: { base: 40, apRatio: 1.2, hpPct: 0, ms: 4000 }, allyFx: [{ id: "guard", ms: 4000, v: 10 }], job: ["support"], learnLv: 10,
    icon: "shield", desc: "아군에게 4초 보호막과 방어력 +10.",
  },
  purify_wave: {
    name: "정화의 물결", slot: "E", category: "magical", targeting: "self", range: 0, radius: 120, cooldownMs: 10_000, cost: { mana: 22, stamina: 2 },
    heal: { base: 20, apRatio: 0.5, hpPct: 0 }, cleanse: true, job: ["support"], learnLv: 20,
    icon: "drop", desc: "주변 7칸 아군의 디버프를 풀고 치료합니다.",
  },
  sanctuary: {
    name: "성역", slot: "R", category: "magical", targeting: "ground", range: 200, radius: 72, repeat: { n: 8, ms: 500 }, cooldownMs: 90_000, cost: { mana: 60, stamina: 4 },
    heal: { base: 15, apRatio: 0.4, hpPct: 0.02 }, job: ["support"], learnLv: 10, difficulty: "mid",
    icon: "cross", desc: "4초 동안 성역을 펼쳐 안의 아군을 0.5초마다 치료합니다.",
  },
  // 힐러(사제)
  healing_breath: {
    name: "치유의 숨결", slot: "Q", category: "magical", targeting: "ally", range: 200, repeat: { n: 4, ms: 300 }, lockMs: 1200, cooldownMs: 4000, cost: { mana: 15, stamina: 2 },
    heal: { base: 14, apRatio: 0.4, hpPct: 0.02 }, threat: 0.5, job: ["priest"], learnLv: 30,
    icon: "heartPlus", desc: "1.2초 동안 아군에게 치유를 흘려 보냅니다 (채널링, 그동안 이동 불가).",
  },
  guardian_angel: {
    name: "수호천사", slot: "W", category: "magical", targeting: "ally", range: 200, cooldownMs: 16_000, cost: { mana: 20, stamina: 2 },
    allyFx: [{ id: "invuln", ms: 1000 }], job: ["priest"], learnLv: 30,
    icon: "wing", desc: "아군 하나를 1초 동안 무적으로 만듭니다.",
  },
  radiance: {
    name: "광휘", slot: "E", category: "magical", targeting: "self", range: 0, radius: 120, cooldownMs: 9000, cost: { mana: 28, stamina: 2 },
    heal: { base: 40, apRatio: 1, hpPct: 0 }, damage: { base: 30, atkRatio: 0, apRatio: 0.8 }, el: "light", job: ["priest"], learnLv: 30,
    icon: "sparkle", desc: "빛을 터뜨려 주변 아군을 치료하고 적에게 빛 피해를 줍니다.",
  },
  resurrection: {
    name: "부활의 기적", slot: "R", category: "magical", targeting: "ally", range: 160, radius: 160, castMs: 1500, cooldownMs: 120_000, cost: { mana: 80, stamina: 4 },
    revive: 0.4, heal: { base: 0, apRatio: 0, hpPct: 0.25 }, job: ["priest"], learnLv: 30, difficulty: "high",
    icon: "cross", desc: "커서 근처의 쓰러진 아군을 HP 40%로 되살리고, 주변 10칸 아군의 최대 HP 25%를 회복시킵니다.",
  },
};

export const SKILLS: Record<string, SkillDef> = Object.fromEntries(
  Object.entries(RAW).map(([id, d]) => [id, { elementInherit: false, threat: 1, difficulty: "low", castMs: 0, cost: {}, ...d, id } as SkillDef]),
);

/** 이 스킬을 이 계열 · 직업이 배울 수 있는가 */
export const canLearn = (sk: SkillDef, line: string | null, job: string | null) =>
  !sk.hidden && sk.slot !== "A" && (sk.job.includes("all") || (!!line && sk.job.includes(line)) || (!!job && sk.job.includes(job)));

/** 새 캐릭터 · 견습 기본 슬롯 */
export const APPRENTICE_SLOTS: Partial<Record<Slot, string>> = { Q: "magic_arrow", W: "dash_slash", E: "first_aid" };
