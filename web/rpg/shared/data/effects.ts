import type { Mod } from "../combat.ts";

/**
 * 버프 · 디버프 (§11). 엔진 규칙(§11-3)은 서버 effects.ts 에 있고 여기는 정의만.
 * cat: hardCC 는 체감 · 강인함 적용, mental 은 정신력 저항 적용.
 * block: 이 효과가 있는 동안 막히는 행동. mods(v, 스택) = 스탯 보정. tick = 도트 · 지속 회복 간격(ms).
 * icon = art/icons.ts 의 글리프 이름. 특수 동작이 필요한 효과 중 쓰는 스킬이 아직 없는 것(부활 · 불사 · 은신 · 가시 · 집중 …)은
 * 정의만 있고, 그 효과를 주는 스킬이 생기는 단계(P3 아이템 · P4 직업)에서 엔진에 동작을 붙입니다.
 */

export type EffectCat = "hardCC" | "softCC" | "dot" | "hot" | "stat" | "shield" | "special";
export type Block = { move?: boolean; atk?: boolean; skill?: boolean };
export type EffectDef = {
  name: string;
  buff: boolean;
  cat: EffectCat;
  mental?: boolean;
  max?: number;
  tick?: number;
  mods?: (v: number, stacks: number) => Mod[];
  block?: Block;
  icon: string;
  color: string;
  desc: string;
  /** 쓰러져도 남음 (영약, P12) */
  keep?: boolean;
};

const ALL: Block = { move: true, atk: true, skill: true };

export const EFFECTS = {
  // ── 버프 (§11-1) ──
  haste: { name: "이동속도 증가", buff: true, cat: "stat", mods: (v) => [{ k: "moveSpeed", mul: v }], icon: "wing", color: "#3FC8E8", desc: "이동 속도 +{v}%" },
  atkspd: { name: "공격속도 증가", buff: true, cat: "stat", mods: (v) => [{ k: "atkSpeed", add: v }], icon: "bolt", color: "#F5C542", desc: "공격 속도 +{v}" },
  regen_hp: { name: "체력 회복", buff: true, cat: "hot", tick: 500, icon: "heartPlus", color: "#4CC764", desc: "지속 시간 동안 체력을 회복합니다" },
  regen_res: { name: "마나/기력 회복", buff: true, cat: "hot", tick: 500, icon: "drop", color: "#2F7BFF", desc: "지속 시간 동안 마나 · 기력을 회복합니다" },
  satiety: { name: "포만감", buff: true, cat: "stat", icon: "foot", color: "#C9A27A", desc: "스태미나 회복 +50%" },
  shield: { name: "보호막", buff: true, cat: "shield", icon: "shield", color: "#f2f2f2", desc: "피해를 {v} 흡수합니다" },
  immune: { name: "상태이상 면역", buff: true, cat: "special", icon: "ring", color: "#FFF4B0", desc: "디버프에 걸리지 않습니다" },
  revive: { name: "부활", buff: true, cat: "special", icon: "cross", color: "#FFF4B0", desc: "쓰러지면 한 번 되살아납니다" },
  undying: { name: "불사", buff: true, cat: "special", icon: "skull", color: "#FFD27A", desc: "체력이 1% 아래로 내려가지 않습니다" },
  power: { name: "공격력/주문력 증가", buff: true, cat: "stat", mods: (v) => [{ k: "atk", mul: v }, { k: "ap", mul: v }], icon: "sword", color: "#E5484D", desc: "공격력 · 주문력 +{v}%" },
  guard: { name: "방어력 증가", buff: true, cat: "stat", mods: (v) => [{ k: "pdef", add: v }, { k: "mdef", add: v }], icon: "shield", color: "#9AA3AD", desc: "물리 · 마법 방어력 +{v}" },
  critup: { name: "치명타 강화", buff: true, cat: "stat", mods: (v) => [{ k: "crit", add: v }, { k: "critDmg", add: v }], icon: "star", color: "#F2C94C", desc: "치명타 확률 · 피해 +{v}%" },
  vamp: { name: "흡혈", buff: true, cat: "stat", mods: (v) => [{ k: "lifesteal", add: v }], icon: "fang", color: "#E5484D", desc: "준 피해의 {v}% 만큼 회복" },
  thorns: { name: "가시", buff: true, cat: "special", icon: "thorn", color: "#5BCB4A", desc: "받은 근접 피해의 {v}% 반사" },
  stealth: { name: "은신", buff: true, cat: "special", icon: "eye", color: "#6B3FA0", desc: "적에게 보이지 않습니다" },
  tenacity: { name: "강인함", buff: true, cat: "stat", mods: (v) => [{ k: "tenacity", add: v }], icon: "fist", color: "#FF8A1F", desc: "군중 제어 시간 −{v}%" },
  unstoppable: { name: "저지 불가", buff: true, cat: "special", icon: "crown", color: "#FF8A1F", desc: "군중 제어에 걸리지 않습니다" },
  accel: { name: "가속", buff: true, cat: "special", icon: "clock", color: "#3FC8E8", desc: "쿨타임 회복 +{v}%" },
  dmgdown: { name: "피해 감소", buff: true, cat: "stat", mods: (v) => [{ k: "dmgDown", add: v }], icon: "shield", color: "#B39DDB", desc: "받는 모든 피해 −{v}%" },
  invuln: { name: "무적", buff: true, cat: "special", icon: "ring", color: "#ffffff", desc: "모든 피해 · 군중 제어 무시" },
  swift: { name: "신속", buff: true, cat: "special", icon: "wing", color: "#BDF3E1", desc: "구르기 · 달리기 스태미나 소모 0" },
  focus: { name: "집중", buff: true, cat: "special", icon: "sparkle", color: "#9B5DE5", desc: "다음 스킬 시전 시간 0" },
  bless: { name: "축복", buff: true, cat: "stat", mods: (v) => [{ k: "luck", add: v }], icon: "clover", color: "#2ECC71", desc: "경험치 +{v}%, 운 +{v}" },
  imbue: { name: "속성 부여", buff: true, cat: "special", icon: "sparkle", color: "#FFE14D", desc: "평타에 속성 추가 피해" },
  // P4 직업 스킬 · 패시브
  counter: { name: "반격 태세", buff: true, cat: "special", icon: "thorn", color: "#9AA3AD", desc: "근접 공격을 막고 되돌려 주며 공격자를 기절시킵니다" },
  venom: { name: "독 바르기", buff: true, cat: "special", icon: "drop", color: "#9BE564", desc: "평타가 독을 겁니다" },
  shadow_step: { name: "그림자 걸음", buff: true, cat: "stat", mods: () => [{ k: "moveSpeed", mul: 0.25 }], icon: "ghost", color: "#6B3FA0", desc: "전투 밖에서 이동 속도 +25%" },
  // P12 소모품: 영약(30분 · 쓰러져도 남음) · 부활 깃털
  elixir_power: { name: "용맹의 영약", buff: true, cat: "stat", keep: true, mods: (v) => [{ k: "atk", mul: v }, { k: "ap", mul: v }], icon: "sword", color: "#ff6b3d", desc: "공격력 · 주문력 +{v}%" },
  elixir_luck: { name: "행운의 영약", buff: true, cat: "stat", keep: true, mods: () => [{ k: "luck", add: 10 }], icon: "clover", color: "#2ECC71", desc: "경험치 +{v}% · 운 +10" },
  elixir_iron: { name: "강철의 영약", buff: true, cat: "stat", keep: true, mods: (v) => [{ k: "pdef", add: v }, { k: "mdef", add: v }], icon: "shield", color: "#9aa3ad", desc: "물리 · 마법 방어력 +{v}" },
  terr_bless: { name: "영지의 가호", buff: true, cat: "stat", mods: () => [{ k: "moveSpeed", mul: 0.05 }], icon: "crown", color: "#F2C94C", desc: "내 길드 · 국가의 영지: 경험치 +10% · 이동 속도 +5%" },
  feather: { name: "부활 깃털", buff: true, cat: "special", icon: "wing", color: "#fff8e0", desc: "쓰러지면 HP 30%로 일어납니다 (한 번)" },
  // P9 세부 직업 패시브 (§9-3)
  blood_rage: { name: "피의 광기", buff: true, cat: "stat", max: 10, mods: (_v, s) => [{ k: "lifesteal", add: 0.02 * s }, { k: "atkSpeed", mul: 0.03 * s }], icon: "fang", color: "#E5484D", desc: "잃은 HP 10%마다 흡혈 +2% · 공속 +3%" },
  earth_root: { name: "대지의 뿌리", buff: true, cat: "stat", mods: () => [{ k: "pdef", mul: 0.2 }, { k: "mdef", mul: 0.2 }], icon: "seed", color: "#B08A5A", desc: "정지 중 방어 +20% · 넉백 면역" },
  melody: { name: "선율", buff: true, cat: "stat", mods: (v) => [{ k: "atkSpeed", mul: v }, { k: "moveSpeed", mul: v }], icon: "wave", color: "#FF7EB6", desc: "공격 속도 · 이동 속도 +{v}%" },
  aim_focus: { name: "집중", buff: true, cat: "special", max: 5, icon: "target", color: "#F2C94C", desc: "멈춰 있는 동안 쌓임 — 다음 공격 피해 +10% × 중첩" },

  // ── 디버프 (§11-2) ──
  slow: { name: "둔화", buff: false, cat: "softCC", mods: (v) => [{ k: "moveSpeed", mul: -v }], icon: "arrowDown", color: "#3FC8E8", desc: "이동 속도 −{v}%" },
  poison: { name: "독", buff: false, cat: "dot", max: 5, tick: 1000, icon: "skull", color: "#9BE564", desc: "초당 피해 (최대 5중첩)" },
  bleed: { name: "출혈", buff: false, cat: "dot", tick: 1000, icon: "drop", color: "#E5484D", desc: "초당 피해 · 움직이면 2배" },
  burn: { name: "화상", buff: false, cat: "dot", tick: 1000, mods: () => [{ k: "healTaken", add: -0.3 }], icon: "flame", color: "#FF5A36", desc: "초당 피해 · 받는 치유 −30%" },
  airborne: { name: "에어본", buff: false, cat: "hardCC", block: ALL, icon: "wind", color: "#BDF3E1", desc: "공중에 떠 아무것도 못 합니다" },
  stun: { name: "기절", buff: false, cat: "hardCC", block: ALL, icon: "stars", color: "#F5C542", desc: "이동 · 공격 불가" },
  root: { name: "속박", buff: false, cat: "softCC", block: { move: true }, icon: "chain", color: "#5BCB4A", desc: "이동 불가" },
  sleep: { name: "수면", buff: false, cat: "hardCC", mental: true, block: ALL, icon: "zzz", color: "#B39DDB", desc: "피격 시 깨어납니다" },
  silence: { name: "침묵", buff: false, cat: "softCC", block: { atk: true, skill: true }, icon: "mute", color: "#9AA3AD", desc: "평타 · 스킬 사용 불가" },
  taunt: { name: "도발", buff: false, cat: "hardCC", mental: true, block: { skill: true }, icon: "fist", color: "#E5484D", desc: "도발한 대상에게 끌려갑니다" },
  fear: { name: "공포", buff: false, cat: "hardCC", mental: true, block: { atk: true, skill: true }, icon: "ghost", color: "#6B3FA0", desc: "시전자 반대쪽으로 달아납니다" },
  freeze: { name: "빙결", buff: false, cat: "hardCC", block: ALL, icon: "snow", color: "#9EE7FF", desc: "다음 받는 물리 피해 +30%" },
  chill: { name: "얼음 둔화", buff: false, cat: "softCC", max: 3, mods: (v, n) => [{ k: "moveSpeed", mul: -v * n }], icon: "snow", color: "#9EE7FF", desc: "3중첩이면 빙결" },
  shock: { name: "감전", buff: false, cat: "softCC", block: ALL, icon: "bolt", color: "#FFE14D", desc: "아주 짧은 기절" },
  blind: { name: "실명", buff: false, cat: "softCC", icon: "eye", color: "#3a2a1e", desc: "평타가 50% 빗나감" },
  disarm: { name: "무장해제", buff: false, cat: "softCC", block: { atk: true }, icon: "sword", color: "#9AA3AD", desc: "평타 불가 (스킬은 가능)" },
  confuse: { name: "혼란", buff: false, cat: "softCC", mental: true, icon: "swirl", color: "#FF7EB6", desc: "이동 방향이 반대로" },
  charm: { name: "매혹", buff: false, cat: "hardCC", mental: true, block: { atk: true, skill: true }, icon: "heart", color: "#FF7EB6", desc: "시전자에게 걸어갑니다" },
  polymorph: { name: "변이", buff: false, cat: "hardCC", block: { atk: true, skill: true }, mods: () => [{ k: "moveSpeed", mul: -0.5 }], icon: "swirl", color: "#f2f2f2", desc: "작은 동물로 변했습니다" },
  weaken: { name: "약화", buff: false, cat: "stat", mods: (v) => [{ k: "atk", mul: -v }, { k: "ap", mul: -v }], icon: "arrowDown", color: "#E5484D", desc: "공격력 · 주문력 −{v}%" },
  shatter: { name: "파쇄", buff: false, cat: "stat", mods: (v) => [{ k: "pdef", add: -v }, { k: "mdef", add: -v }], icon: "crack", color: "#9AA3AD", desc: "물리 · 마법 방어력 −{v}" },
  curse: { name: "저주", buff: false, cat: "stat", mods: () => [{ k: "healTaken", add: -0.5 }], icon: "skull", color: "#6B3FA0", desc: "받는 치유 · 보호막 −50%" },
  mark: { name: "표식", buff: false, cat: "stat", mods: (v) => [{ k: "dmgTakenUp", add: v }], icon: "target", color: "#E5484D", desc: "받는 피해 +{v}%" },
  /** 스태미나 탈진 (§6-3) — 이동 상태(mover.exhausted)를 HUD 가 이 아이콘으로 보여 줌 */
  exhaust: { name: "탈진", buff: false, cat: "special", icon: "foot", color: "#C9A27A", desc: "달리기 · 구르기 불가, 이속 −30%, 체력이 조금씩 줄어듭니다. 스태미나 20%에서 풀림" },
  wet: { name: "젖음", buff: false, cat: "stat", icon: "drop", color: "#3BA7FF", desc: "전기 피해 +30%, 얼음 둔화 2배, 화상 지속 −50%" },
} satisfies Record<string, EffectDef>;

export type EffectId = keyof typeof EFFECTS;
export const effectDef = (id: string): EffectDef | undefined => (EFFECTS as Record<string, EffectDef>)[id];

/** 툴팁 문구: {v} 자리에 값 (0~1 비율은 % 로) */
/** 패시브처럼 시간이 없는 효과 (남은 시간 표시 없음) */
export const FOREVER_MS = 1e9;

export function effectDesc(id: string, v: number): string {
  const d = effectDef(id);
  if (!d) return "";
  return d.desc.replaceAll("{v}", String(v > 0 && v < 1 ? Math.round(v * 100) : Math.round(v)));
}
