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
  /** 소환수 · 설치물 (P9 data/pets.ts): ms 동안, 최대 max 개 (넘으면 오래된 것부터), n 개를 한꺼번에 */
  summon?: { pet: string; ms: number; max?: number; n?: number };
  /** 투척 스킬 — 투척수 「손재주」로 2회 충전 */
  throw?: boolean;
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

  // ══ P9 세부 직업 24개 (D80) — 직업마다 전용 Q · W · E · R, 2차 전직(Lv30)에 배움 ══
  // 광전사 (탱커)
  blood_cleave: {
    name: "피의 가르기", slot: "Q", category: "physical", targeting: "melee", range: 34, arc: 120, cooldownMs: 4000, cost: { energy: 10, stamina: 5 },
    damage: { base: 35, atkRatio: 1.1, apRatio: 0 }, selfFx: [{ id: "vamp", ms: 3000, v: 0.1 }], elementInherit: true, threat: 2, job: ["berserker"], learnLv: 30,
    icon: "fang", desc: "앞을 넓게 베고 3초 동안 준 피해의 10%를 흡혈합니다.",
  },
  reckless_leap: {
    name: "무모한 도약", slot: "W", category: "physical", targeting: "dash", range: 96, width: 24, dashSteps: 10, cooldownMs: 12_000, cost: { energy: 15, stamina: 8 },
    damage: { base: 30, atkRatio: 0.9, apRatio: 0 }, threat: 2, job: ["berserker"], learnLv: 30, icon: "arrowUp", desc: "마우스 쪽으로 6칸 뛰어들며 지나가는 적을 칩니다.",
  },
  bloodlust_howl: {
    name: "피의 포효", slot: "E", category: "physical", targeting: "self", range: 0, radius: 72, cooldownMs: 12_000, cost: { energy: 15, stamina: 6 },
    effects: [{ id: "weaken", ms: 3000, v: 0.15 }], selfFx: [{ id: "atkspd", ms: 5000, v: 20 }], threat: 3, job: ["berserker"], learnLv: 30,
    icon: "skull", desc: "주변 적의 공격력 · 주문력을 3초 동안 15% 깎고, 5초 동안 공속 +20.",
  },
  undying_rage: {
    name: "불사의 분노", slot: "R", category: "physical", targeting: "self", range: 0, cooldownMs: 90_000, cost: { energy: 50, stamina: 10 },
    selfFx: [{ id: "undying", ms: 4000 }, { id: "power", ms: 6000, v: 0.25 }], job: ["berserker"], learnLv: 30, difficulty: "high",
    icon: "flame", desc: "4초 동안 체력이 1% 아래로 내려가지 않고, 6초 동안 공격력 +25%.",
  },
  // 대지수호자 (탱커)
  stone_spike: {
    name: "바위 가시", slot: "Q", category: "physical", targeting: "ground", range: 140, radius: 30, delayMs: 450, cooldownMs: 5000, cost: { energy: 10, stamina: 5 },
    damage: { base: 30, atkRatio: 0.8, apRatio: 0 }, effects: [{ id: "airborne", ms: 500 }], el: "earth", threat: 2, job: ["earthwarden"], learnLv: 30,
    icon: "crack", desc: "커서 지점에서 바위 가시가 솟아 적을 띄웁니다.",
  },
  earth_bulwark: {
    name: "대지 성벽", slot: "W", category: "physical", targeting: "self", range: 0, cooldownMs: 14_000, cost: { energy: 15, stamina: 6 }, special: "wall",
    selfFx: [{ id: "guard", ms: 4000, v: 15 }], job: ["earthwarden"], learnLv: 30, icon: "wall", desc: "바라보는 쪽에 흙벽을 세워 적 투사체를 막고, 4초 동안 방어력 +15.",
  },
  quake: {
    name: "지진", slot: "E", category: "physical", targeting: "self", range: 0, radius: 76, castMs: 300, cooldownMs: 9000, cost: { energy: 18, stamina: 8 },
    damage: { base: 40, atkRatio: 1, apRatio: 0 }, effects: [{ id: "slow", ms: 2000, v: 0.4 }], el: "earth", threat: 2, job: ["earthwarden"], learnLv: 30,
    icon: "wave", desc: "땅을 내리쳐 주변 적에게 피해를 주고 2초 동안 40% 둔화.",
  },
  iron_domain: {
    name: "강철 결계", slot: "R", category: "physical", targeting: "ground", range: 120, radius: 92, repeat: { n: 6, ms: 500 }, cooldownMs: 90_000, cost: { energy: 50, stamina: 10 },
    damage: { base: 18, atkRatio: 0.45, apRatio: 0 }, effects: [{ id: "slow", ms: 700, v: 0.3 }], allyFx: [{ id: "guard", ms: 700, v: 20 }], el: "iron", threat: 3,
    job: ["earthwarden"], learnLv: 30, difficulty: "high", icon: "chain", desc: "3초 동안 결계를 펼쳐 안의 적을 둔화시키며 피해를 주고, 안의 아군은 방어력 +20.",
  },
  // 성기사 (탱커)
  holy_strike: {
    name: "신성 강타", slot: "Q", category: "physical", targeting: "melee", range: 32, arc: 100, cooldownMs: 4000, cost: { energy: 10, stamina: 5 },
    damage: { base: 30, atkRatio: 0.9, apRatio: 0 }, selfFx: [{ id: "shield", ms: 3000, v: 35 }], el: "light", threat: 2, job: ["paladin"], learnLv: 30,
    icon: "sword", desc: "빛을 실어 앞을 내려치고 자신에게 작은 보호막 (신성한 방벽으로 주변 아군도 회복).",
  },
  dawn_rush: {
    name: "여명의 질주", slot: "W", category: "physical", targeting: "dash", range: 90, width: 22, dashSteps: 10, cooldownMs: 12_000, cost: { energy: 15, stamina: 8 },
    damage: { base: 20, atkRatio: 0.6, apRatio: 0 }, selfFx: [{ id: "haste", ms: 2000, v: 0.2 }], el: "light", threat: 1.5, job: ["paladin"], learnLv: 30,
    icon: "wing", desc: "빛을 두르고 돌진하며 지나가는 적을 칩니다. 2초 동안 이속 +20%.",
  },
  consecration: {
    name: "축성", slot: "E", category: "physical", targeting: "self", range: 0, radius: 84, cooldownMs: 10_000, cost: { energy: 15, mana: 10, stamina: 6 },
    damage: { base: 25, atkRatio: 0.6, apRatio: 0 }, heal: { base: 20, apRatio: 0.3, hpPct: 0.04 }, el: "light", threat: 2, job: ["paladin"], learnLv: 30,
    icon: "sparkle", desc: "발밑을 축성해 주변 적에게 빛 피해를 주고 주변 아군을 치유합니다.",
  },
  aegis_of_dawn: {
    name: "새벽의 방패", slot: "R", category: "physical", targeting: "self", range: 0, radius: 128, cooldownMs: 100_000, cost: { energy: 50, stamina: 10 },
    shield: { base: 40, apRatio: 0.4, hpPct: 0.15, ms: 5000 }, cleanse: true, job: ["paladin"], learnLv: 30, difficulty: "high",
    icon: "crown", desc: "주변 8칸 아군의 디버프를 지우고 최대 HP 15% 보호막을 씌웁니다.",
  },
  // 마검사 (전사, 혼합형 — 마나 + 기력)
  rune_slash: {
    name: "룬 베기", slot: "Q", category: "hybrid", targeting: "melee", range: 34, arc: 100, cooldownMs: 3500, cost: { energy: 8, mana: 8, stamina: 5 },
    damage: { base: 28, atkRatio: 0.7, apRatio: 0.7 }, elementInherit: true, threat: 1.5, job: ["spellblade"], learnLv: 30, icon: "rune", desc: "속성 룬을 새긴 검으로 앞을 벱니다 (공격력 · 주문력 모두).",
  },
  blink_strike: {
    name: "섬광 베기", slot: "W", category: "hybrid", targeting: "blink", range: 96, radius: 32, cooldownMs: 12_000, cost: { energy: 10, mana: 10, stamina: 6 },
    damage: { base: 20, atkRatio: 0.5, apRatio: 0.5 }, elementInherit: true, job: ["spellblade"], learnLv: 30, icon: "blink", desc: "커서 쪽으로 순간이동하며 착지 지점 주변을 벱니다.",
  },
  arcane_edge: {
    name: "마력 검기", slot: "E", category: "hybrid", targeting: "skillshot", range: 160, width: 14, speed: 300, pierce: 3, cooldownMs: 8000, cost: { energy: 12, mana: 14, stamina: 6 },
    damage: { base: 36, atkRatio: 0.8, apRatio: 0.8 }, elementInherit: true, job: ["spellblade"], learnLv: 30, icon: "arrow", desc: "검기를 날려 일직선의 적 4명까지 꿰뚫습니다.",
  },
  storm_blade: {
    name: "폭풍 마검", slot: "R", category: "hybrid", targeting: "self", range: 0, radius: 80, repeat: { n: 5, ms: 300 }, cooldownMs: 80_000, cost: { energy: 30, mana: 30, stamina: 10 },
    damage: { base: 24, atkRatio: 0.6, apRatio: 0.6 }, elementInherit: true, job: ["spellblade"], learnLv: 30, difficulty: "high", icon: "swirl", desc: "1.5초 동안 속성 칼바람을 다섯 번 휘몰아칩니다.",
  },
  // 검투사 (전사)
  pommel_strike: {
    name: "자루 치기", slot: "Q", category: "physical", targeting: "melee", range: 30, arc: 80, cooldownMs: 5000, cost: { energy: 10, stamina: 5 },
    damage: { base: 32, atkRatio: 1.05, apRatio: 0 }, effects: [{ id: "stun", ms: 400 }], elementInherit: true, threat: 1.5, job: ["gladiator"], learnLv: 30, icon: "fist", desc: "칼자루로 쳐서 0.4초 기절시킵니다.",
  },
  sidestep: {
    name: "흘려 넘기기", slot: "W", category: "physical", targeting: "dash", range: 60, width: 0, dashSteps: 8, back: true, cooldownMs: 10_000, cost: { energy: 10, stamina: 8 },
    selfFx: [{ id: "critup", ms: 3000, v: 0.2 }], job: ["gladiator"], learnLv: 30, icon: "foot", desc: "뒤로 물러서며 3초 동안 치명타 확률 · 피해 +20%.",
  },
  challenge: {
    name: "결투 신청", slot: "E", category: "physical", targeting: "target", range: 130, cooldownMs: 10_000, cost: { energy: 12, stamina: 4 },
    damage: { base: 20, atkRatio: 0.6, apRatio: 0 }, effects: [{ id: "taunt", ms: 2000 }, { id: "mark", ms: 4000, v: 0.15 }], threat: 3, job: ["gladiator"], learnLv: 30,
    icon: "target", desc: "대상을 2초 동안 도발하고 4초 동안 받는 피해 +15%.",
  },
  champions_duel: {
    name: "챔피언의 결투", slot: "R", category: "physical", targeting: "target", range: 140, blinkTo: true, cooldownMs: 80_000, cost: { energy: 45, stamina: 10 },
    damage: { base: 80, atkRatio: 2.2, apRatio: 0 }, execute: 0.3, selfFx: [{ id: "unstoppable", ms: 3000 }], job: ["gladiator"], learnLv: 30, difficulty: "high",
    icon: "crown", desc: "대상 뒤로 뛰어들어 크게 벱니다. 대상 HP 30% 이하면 2배. 3초 동안 저지 불가.",
  },
  // 창술사 (전사)
  piercing_thrust: {
    name: "관통 찌르기", slot: "Q", category: "physical", targeting: "melee", range: 64, arc: 30, cooldownMs: 3500, cost: { energy: 8, stamina: 5 },
    damage: { base: 34, atkRatio: 1.1, apRatio: 0 }, elementInherit: true, threat: 1.5, job: ["lancer"], learnLv: 30, icon: "arrow", desc: "앞으로 길게 찌릅니다 (4칸). 끝부분으로 맞히면 더 아픕니다.",
  },
  pole_vault: {
    name: "장대 뛰기", slot: "W", category: "physical", targeting: "blink", range: 92, radius: 0, cooldownMs: 11_000, cost: { energy: 10, stamina: 8 },
    selfFx: [{ id: "haste", ms: 2000, v: 0.2 }], job: ["lancer"], learnLv: 30, icon: "arrowUp", desc: "창을 짚고 커서 쪽으로 뛰어넘습니다. 2초 동안 이속 +20%.",
  },
  spear_sweep: {
    name: "창 휘두르기", slot: "E", category: "physical", targeting: "melee", range: 58, arc: 170, cooldownMs: 8000, cost: { energy: 15, stamina: 6 },
    damage: { base: 40, atkRatio: 1, apRatio: 0 }, knock: 24, elementInherit: true, threat: 2, job: ["lancer"], learnLv: 30, icon: "swirl", desc: "창을 크게 휘둘러 앞쪽 반원의 적을 밀어냅니다.",
  },
  dragon_lance: {
    name: "용의 창", slot: "R", category: "physical", targeting: "skillshot", range: 230, width: 20, speed: 420, pierce: 99, cooldownMs: 80_000, cost: { energy: 45, stamina: 10 },
    damage: { base: 90, atkRatio: 2, apRatio: 0 }, elementInherit: true, job: ["lancer"], learnLv: 30, difficulty: "high", icon: "meteor", desc: "창을 던져 일직선의 모든 적을 꿰뚫습니다.",
  },
  // 권사 (전사)
  flurry: {
    name: "연타", slot: "Q", category: "physical", targeting: "melee", range: 28, arc: 90, repeat: { n: 3, ms: 120 }, cooldownMs: 3000, cost: { energy: 8, stamina: 5 },
    damage: { base: 12, atkRatio: 0.45, apRatio: 0 }, elementInherit: true, job: ["monk"], learnLv: 30, icon: "fist", desc: "주먹을 세 번 빠르게 내지릅니다.",
  },
  step_kick: {
    name: "발돋움 차기", slot: "W", category: "physical", targeting: "dash", range: 72, width: 22, dashSteps: 8, cooldownMs: 10_000, cost: { energy: 10, stamina: 8 },
    damage: { base: 20, atkRatio: 0.7, apRatio: 0 }, effects: [{ id: "airborne", ms: 400 }], job: ["monk"], learnLv: 30, icon: "foot", desc: "뛰어들며 차올려 지나가는 적을 띄웁니다.",
  },
  palm_wave: {
    name: "장풍", slot: "E", category: "physical", targeting: "skillshot", range: 130, width: 16, speed: 260, cooldownMs: 7000, cost: { energy: 12, stamina: 6 },
    damage: { base: 40, atkRatio: 1, apRatio: 0 }, knock: 30, elementInherit: true, job: ["monk"], learnLv: 30, icon: "wave", desc: "손바닥에서 기를 쏘아 맞은 적을 밀어냅니다.",
  },
  hundred_fists: {
    name: "백열권", slot: "R", category: "physical", targeting: "melee", range: 30, arc: 110, repeat: { n: 10, ms: 100 }, lockMs: 1000, cooldownMs: 75_000, cost: { energy: 40, stamina: 10 },
    damage: { base: 10, atkRatio: 0.38, apRatio: 0 }, elementInherit: true, job: ["monk"], learnLv: 30, difficulty: "high", icon: "burst", desc: "1초 동안 앞쪽을 열 번 두들깁니다. 그동안 움직일 수 없습니다.",
  },
  // 나이트워커 (암살자, 마법형 — 주문력 · 마나)
  shadow_bolt: {
    name: "그림자 화살", slot: "Q", category: "magical", targeting: "skillshot", range: 160, width: 8, speed: 300, cooldownMs: 2500, cost: { mana: 10, stamina: 3 },
    damage: { base: 25, atkRatio: 0, apRatio: 0.95 }, el: "dark", job: ["nightwalker"], learnLv: 30, icon: "ghost", desc: "어둠 화살을 쏩니다.",
  },
  night_veil: {
    name: "밤의 장막", slot: "W", category: "magical", targeting: "self", range: 0, cooldownMs: 15_000, cost: { mana: 15, stamina: 4 },
    selfFx: [{ id: "stealth", ms: 3000 }, { id: "haste", ms: 3000, v: 0.25 }], job: ["nightwalker"], learnLv: 30, icon: "eye", desc: "3초 동안 은신하고 이속 +25%. 은신을 깨는 첫 공격은 치명타.",
  },
  dusk_blade: {
    name: "황혼의 칼날", slot: "E", category: "magical", targeting: "target", range: 110, blinkTo: true, cooldownMs: 9000, cost: { mana: 20, stamina: 6 },
    damage: { base: 48, atkRatio: 0, apRatio: 1.35 }, effects: [{ id: "curse", ms: 3000 }], el: "dark", job: ["nightwalker"], learnLv: 30, icon: "shuriken", desc: "대상 뒤로 스며들어 베고 3초 동안 저주.",
  },
  eclipse_reaper: {
    name: "월식", slot: "R", category: "magical", targeting: "self", range: 0, radius: 92, cooldownMs: 80_000, cost: { mana: 50, stamina: 8 },
    damage: { base: 90, atkRatio: 0, apRatio: 2.2 }, effects: [{ id: "fear", ms: 800 }], el: "dark", job: ["nightwalker"], learnLv: 30, difficulty: "high",
    icon: "stars", desc: "주변을 어둠으로 덮어 크게 베고 적을 0.8초 공포에 빠뜨립니다.",
  },
  // 환영자객 (암살자)
  mirage_slash: {
    name: "신기루 베기", slot: "Q", category: "physical", targeting: "melee", range: 32, arc: 100, cooldownMs: 3500, cost: { energy: 8, stamina: 5 },
    damage: { base: 30, atkRatio: 1, apRatio: 0 }, effects: [{ id: "confuse", ms: 1000, chance: 0.3 }], elementInherit: true, job: ["phantom"], learnLv: 30, icon: "dash_slash", desc: "앞을 벱니다. 30% 확률로 1초 혼란.",
  },
  shade_swap: {
    name: "그림자 바꿔치기", slot: "W", category: "physical", targeting: "blink", range: 100, radius: 40, cooldownMs: 12_000, cost: { energy: 12, stamina: 8 },
    damage: { base: 15, atkRatio: 0.5, apRatio: 0 }, effects: [{ id: "blind", ms: 1500 }], job: ["phantom"], learnLv: 30, icon: "blink", desc: "커서 쪽으로 순간이동하고 착지 주변 적을 1.5초 실명시킵니다.",
  },
  phantom_blades: {
    name: "환영 칼날", slot: "E", category: "physical", targeting: "skillshot", range: 140, width: 6, speed: 300, count: 3, spread: 20, cooldownMs: 7000, cost: { energy: 12, stamina: 6 },
    damage: { base: 18, atkRatio: 0.6, apRatio: 0 }, elementInherit: true, job: ["phantom"], learnLv: 30, icon: "shuriken", desc: "환영 칼날 셋을 부채꼴로 던집니다.",
  },
  thousand_shades: {
    name: "천의 그림자", slot: "R", category: "physical", targeting: "self", range: 0, radius: 96, repeat: { n: 4, ms: 250 }, cooldownMs: 80_000, cost: { energy: 45, stamina: 10 },
    damage: { base: 30, atkRatio: 0.9, apRatio: 0 }, effects: [{ id: "confuse", ms: 1200 }], selfFx: [{ id: "stealth", ms: 1500 }], job: ["phantom"], learnLv: 30, difficulty: "high",
    icon: "ghost", desc: "분신들이 주변을 네 번 베어 혼란에 빠뜨리고, 본체는 1.5초 은신.",
  },
  // 정찰자 (암살자)
  scout_dart: {
    name: "정찰 표창", slot: "Q", category: "physical", targeting: "skillshot", range: 180, width: 6, speed: 340, cooldownMs: 2000, cost: { energy: 6, stamina: 3 },
    damage: { base: 22, atkRatio: 0.8, apRatio: 0 }, job: ["scout"], learnLv: 30, icon: "arrow", desc: "가볍게 표창을 날립니다.",
  },
  sprint: {
    name: "질주", slot: "W", category: "physical", targeting: "self", range: 0, cooldownMs: 12_000, cost: { energy: 10, stamina: 2 },
    selfFx: [{ id: "haste", ms: 3000, v: 0.4 }, { id: "swift", ms: 3000 }], job: ["scout"], learnLv: 30, icon: "foot", desc: "3초 동안 이속 +40%, 달리기 · 구르기 스태미나 소모 0.",
  },
  flare: {
    name: "조명탄", slot: "E", category: "physical", targeting: "ground", range: 220, radius: 84, cooldownMs: 10_000, cost: { energy: 12, stamina: 4 },
    damage: { base: 12, atkRatio: 0.35, apRatio: 0 }, effects: [{ id: "mark", ms: 5000, v: 0.12 }, { id: "blind", ms: 1000 }], el: "light", job: ["scout"], learnLv: 30,
    icon: "sparkle", desc: "커서 지점에 조명탄을 터뜨려 적을 표시합니다 (5초 동안 받는 피해 +12%).",
  },
  ambush: {
    name: "매복", slot: "R", category: "physical", targeting: "target", range: 160, blinkTo: true, cooldownMs: 70_000, cost: { energy: 40, stamina: 8 },
    damage: { base: 70, atkRatio: 2, apRatio: 0 }, crit: 0.3, job: ["scout"], learnLv: 30, difficulty: "high", icon: "target", desc: "대상 뒤로 뛰어들어 급소를 찌릅니다 (치명타 +30%).",
  },
  // 비전술사 (마법사)
  arcane_missile: {
    name: "비전 화살", slot: "Q", category: "magical", targeting: "skillshot", range: 185, width: 6, speed: 300, count: 3, spread: 6, cooldownMs: 2000, cost: { mana: 9, stamina: 2 },
    damage: { base: 12, atkRatio: 0, apRatio: 0.45 }, el: "none", job: ["arcanist"], learnLv: 30, icon: "magic_arrow", desc: "순수 마력 화살 셋을 쏩니다.",
  },
  phase_shift: {
    name: "위상 이동", slot: "W", category: "magical", targeting: "blink", range: 110, radius: 0, cooldownMs: 12_000, cost: { mana: 15, stamina: 2 },
    selfFx: [{ id: "dmgdown", ms: 1500, v: 0.3 }], job: ["arcanist"], learnLv: 30, icon: "blink", desc: "커서 쪽으로 순간이동하고 1.5초 동안 받는 피해 −30%.",
  },
  mana_orb: {
    name: "마력 구체", slot: "E", category: "magical", targeting: "skillshot", range: 210, width: 18, speed: 160, pierce: 99, cooldownMs: 8000, cost: { mana: 22, stamina: 2 },
    damage: { base: 35, atkRatio: 0, apRatio: 1 }, el: "none", job: ["arcanist"], learnLv: 30, icon: "ring", desc: "느리게 나아가며 닿는 모든 적에게 피해를 주는 구체.",
  },
  arcane_cataclysm: {
    name: "비전 대격변", slot: "R", category: "magical", targeting: "ground", range: 220, radius: 92, delayMs: 900, cooldownMs: 85_000, cost: { mana: 60, stamina: 4 },
    damage: { base: 140, atkRatio: 0, apRatio: 3 }, el: "none", job: ["arcanist"], learnLv: 30, difficulty: "high", icon: "meteor", desc: "0.9초 뒤 커서 지점에 거대한 마력 폭발.",
  },
  // 소환사 (마법사)
  summon_spirit: {
    name: "정령 소환", slot: "Q", category: "magical", targeting: "self", range: 0, cooldownMs: 6000, cost: { mana: 18, stamina: 2 },
    summon: { pet: "pet_spirit", ms: 15_000, max: 2 }, job: ["summoner"], learnLv: 30, icon: "sparkle", desc: "15초 동안 따라다니며 마력탄을 쏘는 정령을 부릅니다 (최대 2마리).",
  },
  spirit_swap: {
    name: "정령 보호막", slot: "W", category: "magical", targeting: "blink", range: 100, radius: 0, cooldownMs: 12_000, cost: { mana: 15, stamina: 2 },
    selfFx: [{ id: "shield", ms: 3000, v: 40 }], job: ["summoner"], learnLv: 30, icon: "blink", desc: "커서 쪽으로 순간이동하며 정령이 작은 보호막을 씌웁니다.",
  },
  summon_golem: {
    name: "골렘 소환", slot: "E", category: "magical", targeting: "self", range: 0, cooldownMs: 18_000, cost: { mana: 30, stamina: 2 },
    summon: { pet: "pet_golem", ms: 20_000, max: 1 }, job: ["summoner"], learnLv: 30, difficulty: "mid", icon: "shield", desc: "20초 동안 함께 싸우며 적을 둔화시키는 바위 골렘을 부릅니다.",
  },
  grand_pact: {
    name: "대계약", slot: "R", category: "magical", targeting: "self", range: 0, radius: 140, cooldownMs: 90_000, cost: { mana: 60, stamina: 4 },
    summon: { pet: "pet_spirit", ms: 12_000, max: 5, n: 3 }, allyFx: [{ id: "power", ms: 6000, v: 0.2 }], job: ["summoner"], learnLv: 30, difficulty: "high",
    icon: "crown", desc: "정령 셋을 한꺼번에 부르고 주변 아군의 공격력 · 주문력을 6초 동안 20% 올립니다.",
  },
  // 흑마법사 (마법사)
  hex_bolt: {
    name: "저주탄", slot: "Q", category: "magical", targeting: "skillshot", range: 175, width: 8, speed: 260, cooldownMs: 2500, cost: { mana: 10, stamina: 2 },
    damage: { base: 20, atkRatio: 0, apRatio: 0.8 }, effects: [{ id: "poison", ms: 4000, dot: 0.15 }], el: "dark", job: ["warlock"], learnLv: 30, icon: "skull", desc: "독을 거는 저주탄 (최대 5중첩).",
  },
  dark_pact: {
    name: "어둠의 계약", slot: "W", category: "magical", targeting: "self", range: 0, cooldownMs: 14_000, cost: { mana: 15, stamina: 2 },
    selfFx: [{ id: "vamp", ms: 4000, v: 0.2 }, { id: "haste", ms: 2000, v: 0.2 }], job: ["warlock"], learnLv: 30, icon: "drop", desc: "4초 동안 준 피해의 20%를 흡혈하고 2초 동안 이속 +20%.",
  },
  curse_field: {
    name: "저주의 땅", slot: "E", category: "magical", targeting: "ground", range: 180, radius: 64, repeat: { n: 5, ms: 600 }, cooldownMs: 10_000, cost: { mana: 24, stamina: 2 },
    damage: { base: 12, atkRatio: 0, apRatio: 0.4 }, effects: [{ id: "curse", ms: 3000 }, { id: "weaken", ms: 1000, v: 0.15 }], el: "dark", job: ["warlock"], learnLv: 30,
    icon: "chain", desc: "3초 동안 저주받은 땅을 만들어 안의 적을 약화시키며 피해를 줍니다.",
  },
  soul_drain: {
    name: "영혼 흡수", slot: "R", category: "magical", targeting: "target", range: 180, repeat: { n: 6, ms: 300 }, lockMs: 1800, cooldownMs: 80_000, cost: { mana: 50, stamina: 4 },
    damage: { base: 26, atkRatio: 0, apRatio: 0.75 }, selfFx: [{ id: "vamp", ms: 2000, v: 0.4 }], el: "dark", job: ["warlock"], learnLv: 30, difficulty: "high",
    icon: "ghost", desc: "1.8초 동안 대상의 영혼을 빨아들여 피해를 주고 그 40%를 회복합니다.",
  },
  // 연금술사 (마법사)
  acid_flask: {
    name: "산성 플라스크", slot: "Q", category: "magical", targeting: "ground", range: 165, radius: 36, delayMs: 400, cooldownMs: 3000, cost: { mana: 10, stamina: 2 },
    damage: { base: 22, atkRatio: 0, apRatio: 0.8 }, effects: [{ id: "poison", ms: 4000, dot: 0.12 }], el: "poison", job: ["alchemist"], learnLv: 30, icon: "drop", desc: "플라스크를 던져 터진 자리에 산성 독을 뿌립니다.",
  },
  smoke_bomb: {
    name: "연막탄", slot: "W", category: "magical", targeting: "self", range: 0, radius: 64, cooldownMs: 12_000, cost: { mana: 12, stamina: 2 },
    effects: [{ id: "blind", ms: 2000 }], selfFx: [{ id: "haste", ms: 2000, v: 0.3 }], job: ["alchemist"], learnLv: 30, icon: "swirl", desc: "연막을 터뜨려 주변 적을 2초 실명시키고 빠져나갑니다.",
  },
  healing_mist: {
    name: "치유 안개", slot: "E", category: "magical", targeting: "ground", range: 165, radius: 64, cooldownMs: 10_000, cost: { mana: 20, stamina: 2 },
    heal: { base: 15, apRatio: 0.3, hpPct: 0.03, ms: 3000 }, threat: 0.5, job: ["alchemist"], learnLv: 30, icon: "heartPlus", desc: "회복약을 흩뿌려 안의 아군을 3초 동안 치유합니다.",
  },
  great_reaction: {
    name: "대반응", slot: "R", category: "magical", targeting: "ground", range: 200, radius: 92, delayMs: 700, repeat: { n: 3, ms: 500 }, cooldownMs: 85_000, cost: { mana: 55, stamina: 4 },
    damage: { base: 48, atkRatio: 0, apRatio: 1.15 }, effects: [{ id: "burn", ms: 3000, dot: 0.15 }], el: "fire", job: ["alchemist"], learnLv: 30, difficulty: "high",
    icon: "flame", desc: "촉매를 섞어 커서 지점을 세 번 폭발시키고 불태웁니다.",
  },
  // 환술사 (마법사)
  mind_spike: {
    name: "정신 송곳", slot: "Q", category: "magical", targeting: "skillshot", range: 175, width: 8, speed: 280, cooldownMs: 2500, cost: { mana: 10, stamina: 2 },
    damage: { base: 32, atkRatio: 0, apRatio: 1.15 }, effects: [{ id: "confuse", ms: 1200, chance: 0.4 }], job: ["illusionist"], learnLv: 30, icon: "rune", desc: "정신을 찌르는 화살. 40% 확률로 1.2초 혼란.",
  },
  mirror_step: {
    name: "거울 걸음", slot: "W", category: "magical", targeting: "blink", range: 100, radius: 0, cooldownMs: 13_000, cost: { mana: 15, stamina: 2 },
    selfFx: [{ id: "stealth", ms: 1200 }], job: ["illusionist"], learnLv: 30, icon: "eye", desc: "환영을 남기고 순간이동해 1.2초 은신합니다.",
  },
  enthrall: {
    name: "매혹", slot: "E", category: "magical", targeting: "target", range: 165, cooldownMs: 9000, cost: { mana: 20, stamina: 2 },
    damage: { base: 45, atkRatio: 0, apRatio: 1.1 }, effects: [{ id: "charm", ms: 1500 }], job: ["illusionist"], learnLv: 30, icon: "heart", desc: "대상을 1.5초 매혹해 나에게 걸어오게 합니다.",
  },
  dreamscape: {
    name: "꿈의 정원", slot: "R", category: "magical", targeting: "ground", range: 200, radius: 96, delayMs: 500, cooldownMs: 90_000, cost: { mana: 55, stamina: 4 },
    damage: { base: 60, atkRatio: 0, apRatio: 1.4 }, effects: [{ id: "sleep", ms: 3000 }], job: ["illusionist"], learnLv: 30, difficulty: "high",
    icon: "zzz", desc: "커서 지점의 적을 3초 재웁니다 (맞으면 깸).",
  },
  // 백마법사 (마법사)
  holy_light: {
    name: "성광탄", slot: "Q", category: "magical", targeting: "skillshot", range: 185, width: 8, speed: 300, cooldownMs: 2500, cost: { mana: 10, stamina: 2 },
    damage: { base: 28, atkRatio: 0, apRatio: 1.05 }, el: "light", job: ["cleric"], learnLv: 30, icon: "sparkle", desc: "빛의 탄환을 쏩니다.",
  },
  purify: {
    name: "정화", slot: "W", category: "magical", targeting: "ally", range: 165, cooldownMs: 10_000, cost: { mana: 15, stamina: 2 },
    heal: { base: 20, apRatio: 0.3, hpPct: 0.04 }, cleanse: true, threat: 0.5, job: ["cleric"], learnLv: 30, icon: "cross", desc: "커서 근처 아군(없으면 자신)의 디버프를 지우고 치유합니다.",
  },
  judgment: {
    name: "심판", slot: "E", category: "magical", targeting: "ground", range: 200, radius: 56, delayMs: 600, cooldownMs: 9000, cost: { mana: 20, stamina: 2 },
    damage: { base: 60, atkRatio: 0, apRatio: 1.4 }, effects: [{ id: "blind", ms: 1500 }], el: "light", job: ["cleric"], learnLv: 30, icon: "sword", desc: "0.6초 뒤 빛의 기둥이 내려와 적을 실명시킵니다.",
  },
  sanctum_ray: {
    name: "성역의 광선", slot: "R", category: "magical", targeting: "skillshot", range: 260, width: 30, speed: 500, pierce: 99, cooldownMs: 85_000, cost: { mana: 55, stamina: 4 },
    damage: { base: 120, atkRatio: 0, apRatio: 2.6 }, el: "light", job: ["cleric"], learnLv: 30, difficulty: "high", icon: "star", desc: "굵은 빛줄기로 일직선의 모든 적을 꿰뚫습니다.",
  },
  // 스나이퍼 (원거리 딜러)
  precise_shot: {
    name: "정밀 사격", slot: "Q", category: "physical", targeting: "skillshot", range: 270, width: 6, speed: 480, cooldownMs: 3000, cost: { energy: 8, stamina: 3 },
    damage: { base: 30, atkRatio: 1.1, apRatio: 0 }, crit: 0.15, job: ["sniper"], learnLv: 30, icon: "arrow", desc: "멀리 정확하게 쏩니다 (치명타 +15%).",
  },
  tumble_back: {
    name: "후방 구르기", slot: "W", category: "physical", targeting: "dash", range: 72, width: 0, dashSteps: 8, back: true, cooldownMs: 10_000, cost: { energy: 10, stamina: 6 },
    job: ["sniper"], learnLv: 30, icon: "foot", desc: "마우스 반대쪽으로 굴러 거리를 벌립니다.",
  },
  piercing_round: {
    name: "관통탄", slot: "E", category: "physical", targeting: "skillshot", range: 300, width: 10, speed: 520, pierce: 3, charge: { ms: 1200, mul: 2 }, cooldownMs: 9000, cost: { energy: 14, stamina: 4 },
    damage: { base: 40, atkRatio: 1.2, apRatio: 0 }, job: ["sniper"], learnLv: 30, difficulty: "mid", icon: "bow", desc: "누르고 있다 떼면 최대 2배 — 일직선 4명까지 꿰뚫습니다.",
  },
  deadeye: {
    name: "필살 저격", slot: "R", category: "physical", targeting: "skillshot", range: 380, width: 10, speed: 700, charge: { ms: 2000, mul: 2.5 }, cooldownMs: 80_000, cost: { energy: 40, stamina: 6 },
    damage: { base: 120, atkRatio: 2.8, apRatio: 0 }, crit: 0.3, job: ["sniper"], learnLv: 30, difficulty: "high", icon: "target", desc: "2초 동안 모으면 최대 2.5배인 초장거리 저격 (치명타 +30%).",
  },
  // 헌터 (원거리 딜러)
  marked_shot: {
    name: "표식 사격", slot: "Q", category: "physical", targeting: "skillshot", range: 230, width: 6, speed: 360, cooldownMs: 3000, cost: { energy: 8, stamina: 3 },
    damage: { base: 18, atkRatio: 0.65, apRatio: 0 }, effects: [{ id: "mark", ms: 5000, v: 0.06 }], job: ["hunter"], learnLv: 30, icon: "target", desc: "맞은 적에게 5초 동안 사냥감 표식 (받는 피해 +6%).",
  },
  bear_trap: {
    name: "곰덫", slot: "W", category: "physical", targeting: "ground", range: 150, radius: 26, delayMs: 800, cooldownMs: 9000, cost: { energy: 10, stamina: 4 },
    damage: { base: 20, atkRatio: 0.6, apRatio: 0 }, effects: [{ id: "root", ms: 1500 }], job: ["hunter"], learnLv: 30, icon: "chain", desc: "덫을 놓아 0.8초 뒤 밟은 적을 1.5초 묶습니다.",
  },
  call_wolf: {
    name: "사냥개 부르기", slot: "E", category: "physical", targeting: "self", range: 0, cooldownMs: 25_000, cost: { energy: 15, stamina: 4 },
    summon: { pet: "pet_wolf", ms: 18_000, max: 1 }, job: ["hunter"], learnLv: 30, difficulty: "mid", icon: "fang", desc: "18초 동안 함께 사냥하는 사냥개를 부릅니다 (출혈).",
  },
  beast_volley: {
    name: "몰이 사격", slot: "R", category: "physical", targeting: "ground", range: 230, radius: 84, repeat: { n: 5, ms: 300 }, cooldownMs: 80_000, cost: { energy: 40, stamina: 6 },
    damage: { base: 20, atkRatio: 0.6, apRatio: 0 }, effects: [{ id: "mark", ms: 3000, v: 0.06 }], job: ["hunter"], learnLv: 30, difficulty: "high", icon: "bow", desc: "커서 지점에 화살비를 다섯 번 퍼붓고 표식을 남깁니다.",
  },
  // 투척수 (원거리 딜러) — 「손재주」: 투척 스킬 2회 충전
  dagger_fan: {
    name: "단검 부채", slot: "Q", category: "physical", targeting: "skillshot", range: 145, width: 6, speed: 300, count: 3, spread: 18, cooldownMs: 3500, cost: { energy: 8, stamina: 3 },
    damage: { base: 13, atkRatio: 0.42, apRatio: 0 }, throw: true, job: ["thrower"], learnLv: 30, icon: "shuriken", desc: "단검 셋을 부채꼴로 던집니다 (2회 충전).",
  },
  caltrops: {
    name: "마름쇠", slot: "W", category: "physical", targeting: "ground", range: 130, radius: 40, repeat: { n: 4, ms: 500 }, cooldownMs: 12_000, cost: { energy: 10, stamina: 4 },
    damage: { base: 6, atkRatio: 0.2, apRatio: 0 }, effects: [{ id: "slow", ms: 1000, v: 0.4 }], throw: true, job: ["thrower"], learnLv: 30, icon: "thorn", desc: "마름쇠를 뿌려 2초 동안 안의 적을 둔화시킵니다 (2회 충전).",
  },
  bomb: {
    name: "폭탄", slot: "E", category: "physical", targeting: "ground", range: 175, radius: 48, delayMs: 600, cooldownMs: 8000, cost: { energy: 14, stamina: 4 },
    damage: { base: 44, atkRatio: 1.05, apRatio: 0 }, knock: 20, el: "fire", throw: true, job: ["thrower"], learnLv: 30, icon: "burst", desc: "0.6초 뒤 터지는 폭탄 (2회 충전).",
  },
  cluster_bomb: {
    name: "집속 폭탄", slot: "R", category: "physical", targeting: "ground", range: 200, radius: 82, delayMs: 800, repeat: { n: 3, ms: 300 }, cooldownMs: 80_000, cost: { energy: 40, stamina: 6 },
    damage: { base: 44, atkRatio: 1.1, apRatio: 0 }, effects: [{ id: "stun", ms: 500 }], el: "fire", job: ["thrower"], learnLv: 30, difficulty: "high", icon: "meteor", desc: "커서 지점을 세 번 폭격하고 기절시킵니다.",
  },
  // 마궁사 (원거리 딜러, 마법형)
  arcane_arrow: {
    name: "마력 화살", slot: "Q", category: "magical", targeting: "skillshot", range: 245, width: 6, speed: 380, cooldownMs: 2500, cost: { mana: 8, stamina: 2 },
    damage: { base: 25, atkRatio: 0, apRatio: 0.9 }, elementInherit: true, job: ["magic_archer"], learnLv: 30, icon: "magic_arrow", desc: "속성을 실은 마력 화살.",
  },
  arrow_blink: {
    name: "화살 도약", slot: "W", category: "magical", targeting: "blink", range: 100, radius: 0, cooldownMs: 11_000, cost: { mana: 12, stamina: 2 },
    selfFx: [{ id: "haste", ms: 1500, v: 0.2 }], job: ["magic_archer"], learnLv: 30, icon: "blink", desc: "커서 쪽으로 순간이동합니다.",
  },
  prism_shot: {
    name: "프리즘 사격", slot: "E", category: "magical", targeting: "skillshot", range: 205, width: 6, speed: 360, count: 5, spread: 10, cooldownMs: 8000, cost: { mana: 18, stamina: 2 },
    damage: { base: 15, atkRatio: 0, apRatio: 0.5 }, elementInherit: true, job: ["magic_archer"], learnLv: 30, icon: "stars", desc: "빛이 갈라지듯 마력 화살 다섯을 부채꼴로 쏩니다.",
  },
  starfall_arrow: {
    name: "별똥 화살", slot: "R", category: "magical", targeting: "ground", range: 260, radius: 96, delayMs: 800, cooldownMs: 85_000, cost: { mana: 50, stamina: 4 },
    damage: { base: 110, atkRatio: 0, apRatio: 2.6 }, elementInherit: true, job: ["magic_archer"], learnLv: 30, difficulty: "high", icon: "meteor", desc: "하늘로 쏜 화살이 0.8초 뒤 커서 지점에 떨어집니다.",
  },
  // 버퍼 · 음유시인 (서포터)
  song_of_valor: {
    name: "용기의 노래", slot: "Q", category: "magical", targeting: "self", range: 0, radius: 128, cooldownMs: 8000, cost: { mana: 15, stamina: 2 },
    allyFx: [{ id: "power", ms: 5000, v: 0.12 }], threat: 0.5, job: ["bard"], learnLv: 30, icon: "wave", desc: "주변 8칸 아군의 공격력 · 주문력을 5초 동안 12% 올립니다.",
  },
  song_of_haste: {
    name: "질풍의 노래", slot: "W", category: "magical", targeting: "self", range: 0, radius: 128, cooldownMs: 14_000, cost: { mana: 18, stamina: 2 },
    allyFx: [{ id: "haste", ms: 3000, v: 0.2 }, { id: "swift", ms: 3000 }], threat: 0.5, job: ["bard"], learnLv: 30, icon: "wing", desc: "주변 아군 이속 +20% · 달리기 스태미나 0 (3초).",
  },
  dissonance: {
    name: "불협화음", slot: "E", category: "magical", targeting: "self", range: 0, radius: 96, cooldownMs: 9000, cost: { mana: 18, stamina: 2 },
    damage: { base: 20, atkRatio: 0, apRatio: 0.6 }, effects: [{ id: "weaken", ms: 3000, v: 0.15 }, { id: "slow", ms: 2000, v: 0.25 }], job: ["bard"], learnLv: 30,
    icon: "mute", desc: "귀를 찢는 음으로 주변 적을 약화 · 둔화시킵니다.",
  },
  grand_symphony: {
    name: "대교향곡", slot: "R", category: "magical", targeting: "self", range: 0, radius: 160, cooldownMs: 90_000, cost: { mana: 60, stamina: 4 },
    heal: { base: 40, apRatio: 0.6, hpPct: 0.1 }, allyFx: [{ id: "atkspd", ms: 6000, v: 25 }, { id: "accel", ms: 6000, v: 0.3 }], threat: 0.5, job: ["bard"], learnLv: 30, difficulty: "high",
    icon: "crown", desc: "주변 10칸 아군을 치유하고 6초 동안 공속 +25 · 쿨타임 회복 +30%.",
  },
  // 엔지니어 (서포터)
  deploy_turret: {
    name: "포탑 설치", slot: "Q", category: "physical", targeting: "self", range: 0, cooldownMs: 8000, cost: { mana: 15, stamina: 2 },
    summon: { pet: "turret", ms: 15_000, max: 2 }, job: ["engineer"], learnLv: 30, icon: "target", desc: "15초 동안 적을 쏘는 포탑을 그 자리에 세웁니다 (최대 2개).",
  },
  rocket_jump: {
    name: "로켓 점프", slot: "W", category: "physical", targeting: "dash", range: 84, width: 26, dashSteps: 8, back: true, cooldownMs: 12_000, cost: { mana: 12, stamina: 4 },
    damage: { base: 15, atkRatio: 0.4, apRatio: 0.3 }, knock: 30, el: "fire", job: ["engineer"], learnLv: 30, icon: "burst", desc: "발밑을 터뜨려 뒤로 날아가며 길목의 적을 밀어냅니다.",
  },
  mend_bot: {
    name: "수리 장치", slot: "E", category: "magical", targeting: "self", range: 0, cooldownMs: 16_000, cost: { mana: 22, stamina: 2 },
    summon: { pet: "mend_station", ms: 12_000, max: 1 }, job: ["engineer"], learnLv: 30, difficulty: "mid", icon: "heartPlus", desc: "12초 동안 주변 아군을 치유하는 장치를 설치합니다.",
  },
  overclock: {
    name: "과부하", slot: "R", category: "magical", targeting: "self", range: 0, radius: 160, cooldownMs: 80_000, cost: { mana: 50, stamina: 4 },
    allyFx: [{ id: "atkspd", ms: 6000, v: 30 }, { id: "accel", ms: 6000, v: 0.25 }], summon: { pet: "turret", ms: 10_000, max: 3 }, threat: 0.5, job: ["engineer"], learnLv: 30,
    difficulty: "high", icon: "bolt", desc: "주변 아군 공속 +30 · 쿨타임 회복 +25% (6초), 포탑 하나를 더 세웁니다.",
  },
  // 주술사 (서포터)
  spirit_totem: {
    name: "치유 토템", slot: "Q", category: "magical", targeting: "self", range: 0, cooldownMs: 12_000, cost: { mana: 18, stamina: 2 },
    summon: { pet: "totem_heal", ms: 12_000, max: 1 }, job: ["shaman"], learnLv: 30, icon: "heartPlus", desc: "12초 동안 주변 아군을 치유하고 디버프를 지우는 토템을 세웁니다.",
  },
  hex: {
    name: "변이 주술", slot: "W", category: "magical", targeting: "target", range: 165, cooldownMs: 13_000, cost: { mana: 18, stamina: 2 },
    effects: [{ id: "polymorph", ms: 1500 }], job: ["shaman"], learnLv: 30, icon: "seed", desc: "대상을 1.5초 동안 작은 동물로 바꿉니다.",
  },
  cleansing_wave: {
    name: "정화의 물결", slot: "E", category: "magical", targeting: "self", range: 0, radius: 128, cooldownMs: 10_000, cost: { mana: 20, stamina: 2 },
    heal: { base: 15, apRatio: 0.3, hpPct: 0.03 }, cleanse: true, threat: 0.5, job: ["shaman"], learnLv: 30, icon: "wave", desc: "주변 아군의 디버프를 지우고 치유합니다 (조상의 가호 보호막).",
  },
  storm_totem: {
    name: "폭풍 토템", slot: "R", category: "magical", targeting: "self", range: 0, cooldownMs: 80_000, cost: { mana: 50, stamina: 4 },
    summon: { pet: "totem_storm", ms: 15_000, max: 1 }, job: ["shaman"], learnLv: 30, difficulty: "high", icon: "bolt", desc: "15초 동안 주변 적에게 번개를 내리며 둔화시키는 토템.",
  },
  // 정령사 (서포터) — 「정령 친화」: 아군에게 거는 버프에 시전자 속성 효과가 붙음
  spirit_link: {
    name: "정령 연결", slot: "Q", category: "magical", targeting: "ally", range: 165, cooldownMs: 6000, cost: { mana: 14, stamina: 2 },
    heal: { base: 10, apRatio: 0.2, hpPct: 0.02, ms: 4000 }, threat: 0.5, job: ["spiritcaller"], learnLv: 30, icon: "chain", desc: "커서 근처 아군에게 정령을 붙여 4초 동안 치유합니다.",
  },
  wisp_guard: {
    name: "도깨비불 수호", slot: "W", category: "magical", targeting: "ally", range: 165, cooldownMs: 11_000, cost: { mana: 16, stamina: 2 },
    shield: { base: 25, apRatio: 0.4, hpPct: 0.06, ms: 4000 }, threat: 0.5, job: ["spiritcaller"], learnLv: 30, icon: "shield", desc: "커서 근처 아군에게 보호막을 씌웁니다.",
  },
  spirit_burst: {
    name: "정령 폭발", slot: "E", category: "magical", targeting: "skillshot", range: 185, width: 10, speed: 300, bounce: 2, cooldownMs: 7000, cost: { mana: 16, stamina: 2 },
    damage: { base: 30, atkRatio: 0, apRatio: 0.9 }, elementInherit: true, job: ["spiritcaller"], learnLv: 30, icon: "sparkle", desc: "정령탄이 근처 적에게 두 번 튕깁니다.",
  },
  spirit_ascension: {
    name: "정령 강림", slot: "R", category: "magical", targeting: "self", range: 0, radius: 160, cooldownMs: 90_000, cost: { mana: 55, stamina: 4 },
    heal: { base: 30, apRatio: 0.5, hpPct: 0.08 }, allyFx: [{ id: "power", ms: 6000, v: 0.15 }, { id: "tenacity", ms: 6000, v: 0.3 }], threat: 0.5, job: ["spiritcaller"], learnLv: 30,
    difficulty: "high", icon: "crown", desc: "정령이 강림해 주변 아군을 치유하고 6초 동안 공격력 +15% · 강인함 +30%.",
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
