import type { Mod } from "../combat.ts";

/**
 * §12 속성. strong = 이 속성으로 때리면 ×1.25, weak = ×0.8 (공격 기준, §12-2).
 * 빛 · 어둠은 서로에게만 강함 — 표의 "(어둠에게만 약함)" 은 방어 쪽 설명이라 weak 은 비워 둠 (DECISIONS D16).
 * mods = 선택 시 패시브 (§12-1). 물 위 이속 · 넉백 저항처럼 아직 쓰일 곳이 없는 효과는 문구만 있습니다.
 */
export const ELEMENTS = {
  water:    { name: "물",   color: "#3BA7FF", passive: "받는 치유 +10%, 물 위 이속 감소 없음", strong: ["fire", "earth"], weak: ["grass", "electric"], mods: [{ k: "healTaken", add: 0.1 }] },
  fire:     { name: "불",   color: "#FF5A36", passive: "스킬 피해 +6%", strong: ["grass", "ice", "iron"], weak: ["water", "earth"], mods: [{ k: "skillDmg", add: 0.06 }] },
  earth:    { name: "흙",   color: "#B07D48", passive: "물방 +8%, 넉백 저항", strong: ["fire", "electric", "poison"], weak: ["grass", "wind"], mods: [{ k: "pdef", mul: 0.08 }] },
  grass:    { name: "풀",   color: "#5BCB4A", passive: "재생력 +20%", strong: ["water", "earth"], weak: ["fire", "poison", "iron"], mods: [{ k: "regen", mul: 0.2 }] },
  wind:     { name: "바람", color: "#BDF3E1", passive: "이속 +6%, 투사체 속도 +15%", strong: ["earth", "poison"], weak: ["iron", "electric"], mods: [{ k: "moveSpeed", mul: 0.06 }, { k: "projSpeed", add: 0.15 }] },
  electric: { name: "전기", color: "#FFE14D", passive: "공속 +8", strong: ["water", "wind"], weak: ["earth", "grass"], mods: [{ k: "atkSpeed", add: 8 }] },
  ice:      { name: "얼음", color: "#9EE7FF", passive: "받는 근접 피해 −5%, 공격자에게 짧은 둔화", strong: ["grass", "wind"], weak: ["fire", "iron"], mods: [{ k: "meleeDown", add: 0.05 }] },
  light:    { name: "빛",   color: "#FFF4B0", passive: "주는 치유 · 보호막 +10%", strong: ["dark"], weak: [], mods: [{ k: "healPower", add: 0.1 }] },
  dark:     { name: "어둠", color: "#6B3FA0", passive: "흡혈 +4%", strong: ["light"], weak: [], mods: [{ k: "lifesteal", add: 0.04 }] },
  poison:   { name: "독",   color: "#9BE564", passive: "도트 피해 +15%", strong: ["grass", "water"], weak: ["earth", "iron"], mods: [{ k: "dotDmg", add: 0.15 }] },
  none:     { name: "무",   color: "#F2F2F2", passive: "모든 피해 +5%, 속성 방어 무시 10%", strong: [], weak: [], mods: [{ k: "dmgUp", add: 0.05 }, { k: "elPen", add: 0.1 }] },
  iron:     { name: "철",   color: "#B8C2CC", passive: "방어 관통 +8%", strong: ["ice", "grass"], weak: ["fire", "electric"], mods: [{ k: "penPhys", add: 0.08 }, { k: "penMag", add: 0.08 }] },
} as const satisfies Record<string, { name: string; color: string; passive: string; strong: readonly string[]; weak: readonly string[]; mods: readonly Mod[] }>;

export type ElementId = keyof typeof ELEMENTS;
export const ELEMENT_IDS = Object.keys(ELEMENTS) as ElementId[];

/**
 * 속성을 물려받는 스킬(elementInherit)이 맞혔을 때 붙는 부가 효과 (§12-1 표 오른쪽 열).
 * dot = 맞힌 피해의 몇 %를 초당 도트로, knock = 넉백 px, chance 없으면 항상.
 */
export type ElementProc = { fx?: { id: string; ms: number; v?: number; dot?: number; chance?: number }[]; knock?: number; power?: number };
export const ELEMENT_PROC: Record<ElementId, ElementProc> = {
  water: { fx: [{ id: "wet", ms: 4000 }], knock: 8 },
  fire: { fx: [{ id: "burn", ms: 3000, dot: 0.15 }] },
  earth: { fx: [{ id: "slow", ms: 1500, v: 0.25 }] },
  grass: { fx: [{ id: "root", ms: 800, chance: 0.25 }] },
  wind: { fx: [{ id: "airborne", ms: 500, chance: 0.15 }], knock: 20 },
  electric: { fx: [{ id: "shock", ms: 300, chance: 0.3 }] },
  ice: { fx: [{ id: "chill", ms: 2500, v: 0.15 }] },
  light: { fx: [{ id: "blind", ms: 2000, chance: 0.3 }] },
  dark: { fx: [{ id: "curse", ms: 4000 }, { id: "fear", ms: 800, chance: 0.1 }] },
  poison: { fx: [{ id: "poison", ms: 4000, dot: 0.08 }] },
  none: { power: 0.08 },
  iron: { fx: [{ id: "bleed", ms: 3000, dot: 0.12 }] },
};

/** §12-3 원소 반응 — 데이터만 (구현은 2단계 이후) */
export const REACTIONS = [
  { a: "wet", b: "electric", name: "과전류", desc: "주변 3m 연쇄 피해 + 감전" },
  { a: "wet", b: "ice", name: "결빙", desc: "즉시 빙결 1.5초" },
  { a: "burn", b: "wind", name: "화염 폭풍", desc: "화상이 주변으로 퍼짐" },
  { a: "burn", b: "ice", name: "융해", desc: "해당 피해 ×1.5" },
  { a: "root", b: "fire", name: "연소", desc: "범위 화상 장판" },
  { a: "poison", b: "fire", name: "독무 폭발", desc: "독 스택 수 × 추가 피해" },
  { a: "light", b: "dark", name: "일식", desc: "양쪽 모두 0.5초 기절 (시전자 쿨 공유)" },
] as const;
