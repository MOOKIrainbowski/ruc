/** §8-1 캐릭터 외형 선택지. 색은 [밝은 면, 기본, 그늘] 3단계 (§25 아트 방향). */

export const HAIR_STYLES = ["짧은 머리", "삐죽 머리", "긴 머리", "포니테일", "단발", "양갈래"];

export const HAIR_COLORS: [string, string, string][] = [
  ["#6b4a33", "#4e3423", "#36231a"], // 갈색
  ["#3a3240", "#26212c", "#18141d"], // 흑발
  ["#f2d27a", "#d9b356", "#b08a38"], // 금발
  ["#e0703f", "#c0522a", "#8e3a1f"], // 주황
  ["#f29ab8", "#d9779a", "#b0567a"], // 분홍
  ["#7fb6f0", "#5b92d1", "#3f6ca6"], // 하늘
  ["#9be06b", "#76bf4b", "#548f33"], // 연두
  ["#e8e4ee", "#c7c1d1", "#9e97ab"], // 은발
];

export const SKINS: [string, string, string][] = [
  ["#ffe3cf", "#f7cdb0", "#e0a988"],
  ["#f6d0a8", "#e8b48a", "#c98f68"],
  ["#d9a679", "#c08a5d", "#9a6a44"],
  ["#a8714c", "#8c5a3a", "#6b432b"],
];

export const EYES = ["#3b6fd6", "#3f8f4a", "#7a4a2a", "#8a3fb0"];

export type Appearance = { hair: number; hairColor: number; skin: number; eyes: number };

export function validAppearance(a: unknown): a is Appearance {
  const v = a as Appearance;
  const ok = (n: unknown, max: number) => Number.isInteger(n) && (n as number) >= 0 && (n as number) < max;
  return !!v && ok(v.hair, HAIR_STYLES.length) && ok(v.hairColor, HAIR_COLORS.length) && ok(v.skin, SKINS.length) && ok(v.eyes, EYES.length);
}
