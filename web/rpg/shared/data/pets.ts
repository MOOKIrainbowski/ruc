import type { ElementId } from "./elements.ts";
import type { Amount, SkillFx } from "./skills.ts";

/**
 * 소환수 · 설치물 (P9, D81): 소환사(정령 · 골렘) · 헌터(늑대) · 엔지니어(포탑 · 수리 장치) · 주술사(토템) · 환영자객(잔상).
 * 피해 · 치유는 주인의 스탯으로 계산하고 주인이 한 것으로 침(경험치 · 처치 기여).
 * P13(D95): HP = 주인 최대 HP × hp, 몹이 노릴 수 있음 — 소환수가 준 피해 × taunt 만큼 몹의 위협이 소환수에게 쌓임(골렘 · 잔상은 어그로를 끔). 쓰러지면 사라짐.
 * act: melee 근접 · shot 투사체 · heal 주변 아군 치유 · aura 주변 적에게 효과(피해 선택) · decoy 아무것도 안 함(잔상)
 * sprite = 그림(몹 그림 키, "decoy" = 주인 모습을 반투명으로)
 */
export type PetDef = {
  name: string;
  sprite: string;
  /** 주인을 따라다님 (아니면 그 자리에 설치) */
  follow: boolean;
  act: "melee" | "shot" | "heal" | "aura" | "decoy";
  range: number;
  cdMs: number;
  damage?: { base: number; atkRatio: number; apRatio: number };
  category?: "physical" | "magical";
  /** 고정 속성 · "owner" = 주인 속성 */
  el?: ElementId | "owner";
  heal?: Amount;
  fx?: SkillFx[];
  allyFx?: SkillFx[];
  cleanse?: boolean;
  /** 주인 최대 HP 대비 HP · 준 피해당 위협 배율 (P13) */
  hp: number;
  taunt: number;
};

export const PETS: Record<string, PetDef> = {
  pet_spirit: { name: "계약 정령", sprite: "pet_spirit", follow: true, act: "shot", range: 170, cdMs: 1200, damage: { base: 10, atkRatio: 0, apRatio: 0.6 }, category: "magical", el: "owner", hp: 0.2, taunt: 0.4 },
  pet_golem: { name: "바위 골렘", sprite: "moss_golem", follow: true, act: "melee", range: 30, cdMs: 1600, damage: { base: 18, atkRatio: 0, apRatio: 0.6 }, category: "magical", el: "earth", fx: [{ id: "slow", ms: 1200, v: 0.25 }], hp: 0.6, taunt: 3 },
  pet_wolf: { name: "사냥개", sprite: "pet_wolf", follow: true, act: "melee", range: 26, cdMs: 1100, damage: { base: 8, atkRatio: 0.25, apRatio: 0 }, category: "physical", fx: [{ id: "bleed", ms: 3000, dot: 0.1, chance: 0.3 }], hp: 0.35, taunt: 1 },
  turret: { name: "포탑", sprite: "turret", follow: false, act: "shot", range: 210, cdMs: 900, damage: { base: 8, atkRatio: 0.25, apRatio: 0.25 }, category: "physical", el: "iron", hp: 0.4, taunt: 0.6 },
  mend_station: { name: "수리 장치", sprite: "mend_station", follow: false, act: "heal", range: 96, cdMs: 1000, heal: { base: 8, apRatio: 0.15, hpPct: 0.02 }, hp: 0.3, taunt: 0 },
  totem_heal: { name: "치유 토템", sprite: "totem", follow: false, act: "heal", range: 112, cdMs: 1000, heal: { base: 6, apRatio: 0.12, hpPct: 0.015 }, cleanse: true, hp: 0.3, taunt: 0 },
  totem_storm: { name: "폭풍 토템", sprite: "totem", follow: false, act: "aura", range: 100, cdMs: 800, damage: { base: 8, atkRatio: 0, apRatio: 0.3 }, category: "magical", el: "electric", fx: [{ id: "slow", ms: 1000, v: 0.3 }], hp: 0.3, taunt: 0.5 },
  decoy: { name: "잔상", sprite: "decoy", follow: false, act: "decoy", range: 0, cdMs: 1e9, hp: 0.15, taunt: 0 },
};

/** 엔지니어 「정비」: 설치물 지속 +30% · 설치 스킬 쿨 −15% */
export const ENGINEER = { life: 1.3, cd: 0.85 };
