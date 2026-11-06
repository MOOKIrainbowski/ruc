/** §12 속성. 상성 · 반응 수치는 P2 전투 공식이 읽습니다. */

export const ELEMENTS = {
  water:    { name: "물",   color: "#3BA7FF", passive: "받는 치유 +10%, 물 위 이속 감소 없음", strong: ["fire", "earth"], weak: ["grass", "electric"] },
  fire:     { name: "불",   color: "#FF5A36", passive: "스킬 피해 +6%", strong: ["grass", "ice", "iron"], weak: ["water", "earth"] },
  earth:    { name: "흙",   color: "#B07D48", passive: "물방 +8%, 넉백 저항", strong: ["fire", "electric", "poison"], weak: ["grass", "wind"] },
  grass:    { name: "풀",   color: "#5BCB4A", passive: "재생력 +20%", strong: ["water", "earth"], weak: ["fire", "poison", "iron"] },
  wind:     { name: "바람", color: "#BDF3E1", passive: "이속 +6%, 투사체 속도 +15%", strong: ["earth", "poison"], weak: ["iron", "electric"] },
  electric: { name: "전기", color: "#FFE14D", passive: "공속 +8", strong: ["water", "wind"], weak: ["earth", "grass"] },
  ice:      { name: "얼음", color: "#9EE7FF", passive: "받는 근접 피해 −5%, 공격자에게 짧은 둔화", strong: ["grass", "wind"], weak: ["fire", "iron"] },
  light:    { name: "빛",   color: "#FFF4B0", passive: "주는 치유 · 보호막 +10%", strong: ["dark"], weak: ["dark"] },
  dark:     { name: "어둠", color: "#6B3FA0", passive: "흡혈 +4%", strong: ["light"], weak: ["light"] },
  poison:   { name: "독",   color: "#9BE564", passive: "도트 피해 +15%", strong: ["grass", "water"], weak: ["earth", "iron"] },
  none:     { name: "무",   color: "#F2F2F2", passive: "모든 피해 +5%, 속성 방어 무시 10%", strong: [], weak: [] },
  iron:     { name: "철",   color: "#B8C2CC", passive: "방어 관통 +8%", strong: ["ice", "grass"], weak: ["fire", "electric"] },
} as const;

export type ElementId = keyof typeof ELEMENTS;
export const ELEMENT_IDS = Object.keys(ELEMENTS) as ElementId[];
