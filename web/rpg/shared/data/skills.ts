/**
 * 스킬 (§10-6 스키마를 따름, 거리는 px · 시간은 ms).
 * 견습 모험가 공통 스킬 (§9-1): 대시 베기 · 마력 화살 · 응급 처치 + 구르기(Space, ROLL).
 * 슬롯 배치는 DECISIONS D15. 시전 형태는 지금 쓰는 것만 — target(적) · ground · channel · charge 는 P4 직업 스킬과 함께.
 */

export type Slot = "A" | "Q" | "W" | "E" | "R";
export const SLOTS: Slot[] = ["A", "Q", "W", "E", "R"];

export type SkillDef = {
  id: string;
  name: string;
  slot: Slot;
  category: "physical" | "magical" | "hybrid";
  /** melee = 앞쪽 부채꼴 · skillshot = 투사체 · dash = 마우스 쪽으로 돌진하며 경로 타격 · ally = 커서 근처 아군(없으면 자신) */
  targeting: "melee" | "skillshot" | "dash" | "ally";
  range: number;
  /** 부채꼴 각도(도) · 투사체 / 돌진 판정 폭 */
  arc?: number;
  width?: number;
  speed?: number;
  /** 돌진 시간 (이동 스텝 수) */
  dashSteps?: number;
  castMs: number;
  cooldownMs: number;
  cost: { stamina?: number; mana?: number; energy?: number };
  damage?: { base: number; atkRatio: number; apRatio: number };
  /** 지속 회복: base + 주문력 × apRatio + 최대 HP × hpPct 를 ms 동안 나눠서 */
  heal?: { base: number; apRatio: number; hpPct: number; ms: number };
  elementInherit: boolean;
  effects?: { id: string; v?: number; ms: number; chance?: number }[];
  threat: number;
  icon: string;
  desc: string;
  difficulty: "low" | "mid" | "high" | "transcendent";
};

export const SKILLS: Record<string, SkillDef> = {
  punch: {
    id: "punch", name: "맨손 평타", slot: "A", category: "physical", targeting: "melee",
    range: 26, arc: 110, castMs: 0, cooldownMs: 500, cost: { stamina: 3 },
    damage: { base: 0, atkRatio: 1, apRatio: 0 }, elementInherit: false, threat: 1,
    icon: "punch", desc: "앞쪽을 주먹으로 칩니다. 무기를 들면 무기 평타로 바뀝니다.", difficulty: "low",
  },
  magic_arrow: {
    id: "magic_arrow", name: "마력 화살", slot: "Q", category: "magical", targeting: "skillshot",
    range: 176, width: 6, speed: 240, castMs: 0, cooldownMs: 1500, cost: { mana: 8, stamina: 2 },
    damage: { base: 18, atkRatio: 0, apRatio: 0.9 }, elementInherit: true, threat: 1,
    icon: "magic_arrow", desc: "마우스 쪽으로 정령의 힘을 담은 화살을 쏩니다. 속성에 따라 부가 효과가 붙습니다.", difficulty: "low",
  },
  dash_slash: {
    id: "dash_slash", name: "대시 베기", slot: "W", category: "physical", targeting: "dash",
    range: 80, width: 22, dashSteps: 10, castMs: 0, cooldownMs: 12_000, cost: { energy: 15, stamina: 8 },
    damage: { base: 25, atkRatio: 1.2, apRatio: 0 }, elementInherit: true, threat: 1.2,
    icon: "dash_slash", desc: "마우스 쪽으로 5칸 돌진하며 지나가는 적을 벱니다. 위험할 때 빠져나가는 데도 씁니다.", difficulty: "low",
  },
  first_aid: {
    id: "first_aid", name: "응급 처치", slot: "E", category: "magical", targeting: "ally",
    range: 160, castMs: 400, cooldownMs: 8000, cost: { mana: 15, stamina: 4 },
    heal: { base: 20, apRatio: 0.5, hpPct: 0.06, ms: 3000 }, elementInherit: false, threat: 0.5,
    icon: "first_aid", desc: "커서 근처 아군(없으면 자신)을 3초 동안 치료합니다. 시전 중에는 움직일 수 없습니다.", difficulty: "low",
  },
};

/** 견습 모험가 슬롯 — R(궁극기)은 1차 전직(Lv10) 후 */
export const APPRENTICE_SLOTS: Partial<Record<Slot, string>> = { A: "punch", Q: "magic_arrow", W: "dash_slash", E: "first_aid" };
