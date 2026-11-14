import { ITEMS, isGear, type Rarity } from "../../shared/data/items";
import { OUTLINE, Px } from "./px";
import { overrides } from "../assets";

/**
 * 아이템 아이콘 32×32 네이티브 픽셀아트. 장비 팔레트는 희귀도에 따라 유지 — 하급 녹슨 색 → 전설 금빛 + 반짝임.
 */

const METAL: Record<Rarity, [string, string, string]> = {
  poor: ["#8a6a4a", "#b08a64", "#5f4632"],
  common: ["#cfd6de", "#ffffff", "#8a939e"],
  rare: ["#7fd6a0", "#c8f5d8", "#3e9a63"],
  advanced: ["#7fa8f0", "#cfe0ff", "#3d64b8"],
  mythic: ["#b98ae8", "#ecd6ff", "#7a4fb0"],
  legendary: ["#FFD27A", "#fff4b0", "#d08a1a"],
};
const FIXED: Record<string, string> = { "#": OUTLINE, w: "#a0764c", W: "#6d513b", l: "#7a5636", o: "#8fd0ff", c: "#a0764c", g: "#e8f4ff" };
/** 장비가 아닌 아이템의 + * - 색 */
const OWN: Record<string, [string, string, string]> = {
  potion_hp: ["#E5484D", "#ff9a9e", "#a8323a"],
  potion_mp: ["#2F7BFF", "#8fc0ff", "#1f52b0"],
  potion_en: ["#FF8A1F", "#ffc48a", "#b85a10"],
  jelly: ["#9be564", "#d5f7a8", "#5fae3a"],
  fluff: ["#f6eef8", "#ffffff", "#d0bcd8"],
  coin: ["#F2C94C", "#fff1b0", "#b88a1a"],
  pelt: ["#6f8a4a", "#9bb86a", "#4b6030"],
  stone: ["#8a9ab8", "#c8d4ec", "#5a6680"],
  book: ["#9B5DE5", "#c8a0f0", "#6b3fa0"],
  spore: ["#d9a0e0", "#f4d8f8", "#9a5aa8"],
  moss: ["#6fae4a", "#b6e07f", "#3f6a26"],
  sap: ["#5a3a8a", "#9a70d0", "#2e1d4a"],
  bark: ["#a0825a", "#d8bc8a", "#6a5236"],
  leaf: ["#5bcb4a", "#c8f59a", "#2f7a2a"],
  // P12 소모품
  elixir_power: ["#ff6b3d", "#ffc8a0", "#b8401a"],
  elixir_luck: ["#2ECC71", "#a8f0c4", "#1a8a48"],
  elixir_iron: ["#9aa3ad", "#e2e8ee", "#5b636c"],
  feather: ["#fff8e0", "#ffffff", "#d8c8a0"],
  box: ["#c98d58", "#e8b880", "#7d4f2b"],
  ticket: ["#F2C94C", "#fff1b0", "#b88a1a"],
  scroll: ["#f6e9c8", "#ffffff", "#c9a97a"],
  // P13 채집물
  herb: ["#5bcb4a", "#b6f07a", "#2f7a2a"],
  blue_herb: ["#3BA7FF", "#a8dcff", "#1f62b0"],
  ore: ["#8a8f99", "#d8dee6", "#4f555e"],
};
const POTION = ["....####....", "....#cc#....", ".....##.....", "....#gg#....", "...#g**g#...", "..#g*+++#...", "..#*++++-#..", "..#+++++-#..", "..#++++--#..", "..#+++---#..", "...#----#...", "....####...."];

const ART: Record<string, string[]> = {
  dagger: ["............", "........##..", ".......#*#..", "......#*+#..", ".....#*+#...", "....#*+#....", "..#.#+-#....", "...###......", "..#ww#......", ".#ww#.......", ".##.........", "............"],
  sword: ["..........#.", ".........#*#", "........#*+#", ".......#*+#.", "......#*+#..", ".....#*+#...", "..#.#*+#....", "...#*-#.....", "...###......", "..#ww#......", ".#ww#.......", ".##........."],
  axe: ["..####......", ".#*++##.....", "#*+++-#w#...", "#*++-##w#...", ".#+-#.#w#...", "..##..#w#...", "......#w#...", "......#w#...", "......#w#...", "......#W#...", "......###...", "............"],
  bow: ["...###......", "..#ww#*.....", ".#w#..*.....", ".#w#...*....", "#w#....*....", "#W#....*....", "#W#....*....", "#w#....*....", ".#w#...*....", ".#w#..*.....", "..#ww#*.....", "...###......"],
  staff: ["........###.", ".......#*+-#", ".......#+o-#", "........#-#.", ".......#w#..", "......#w#...", ".....#w#....", "....#w#.....", "...#w#......", "..#w#.......", ".#W#........", ".##........."],
  wand: ["............", "........#o#.", ".......#o*o#", "........#o#.", ".......#+#..", "......#w#...", ".....#w#....", "....#w#.....", "...#w#......", "..#W#.......", "..##........", "............"],
  helmet: ["............", "....####....", "...#*++-#...", "..#*+++--#..", "..#*++++-#..", "..#++++--#..", "..########..", "..#-#..#-#..", "..#-#..#-#..", "..###..###..", "............", "............"],
  chest: ["............", "..##....##..", ".#*+#..#+-#.", ".#*++##++-#.", ".#*+++++--#.", "..#++++++#..", "..#*+ll+-#..", "..#*+ll+-#..", "..#++++--#..", "..#++++--#..", "..########..", "............"],
  legs: ["............", "..########..", "..#*++++-#..", "..#*+##+-#..", "..#*+##+-#..", "..#*+##+-#..", "..#*+##+-#..", "..#*+##+-#..", "..#++##--#..", "..#l#..#l#..", "..###..###..", "............"],
  boots: ["............", "...####.....", "...#*+#.....", "...#*+#.....", "...#*+#.....", "...#*+#.....", "...#*++###..", "...#*+++++#.", "...#+++++-#.", "...#llllll#.", "...########.", "............"],
  gloves: ["............", "....#.#.#...", "...#*#*#*#..", "...#*#*#+#..", "..##*++++#..", ".#*#*++++#..", ".#*++++++#..", "..#++++--#..", "...#+++-#...", "...######...", "...#ll#.....", "...####....."],
  cape: ["............", "...######...", "..#*++++-#..", "..#*+o++-#..", ".#*++++++-#.", ".#*++++++-#.", "#*+++++++--#", "#*+++++++--#", "#*++++++---#", "#++++++----#", "############", "............"],
  ring: ["............", ".....#o#....", "....#ooo#...", ".....###....", "...##*+##...", "..#*#..#-#..", "..#*#..#-#..", "..#+#..#-#..", "...##++##...", "....####....", "............", "............"],
  necklace: ["............", "..#......#..", "..#*....*#..", "...#*..*#...", "...#+..+#...", "....#++#....", ".....##.....", "....#oo#....", "....#oo#....", ".....##.....", "............", "............"],
  earring: ["............", ".....##.....", "....#..#....", "....#..#....", ".....#*#....", "......#.....", ".....#o#....", "....#ooo#...", "....#ooo#...", ".....#o#....", "......#.....", "............"],
  potion_hp: POTION,
  potion_mp: POTION,
  potion_en: POTION,
  jelly: ["............", "............", "....####....", "...#****#...", "..#**++++#..", "..#*+#+#+#..", "..#++++++#..", ".#+++++++-#.", ".#++++++--#.", ".#--------#.", "..########..", "............"],
  fluff: ["............", "....##.##...", "...#**#**#..", "..#*+*+**+#.", ".#**+++*++#.", ".#*++++++-#.", ".#*+++++--#.", "..#++++--#..", "...######...", "............", "............", "............"],
  coin: ["............", "....####....", "...#****#...", "..#**++++#..", "..#*+--++#..", "..#*+-+++#..", "..#*+--++#..", "..#*++++-#..", "...#+++-#...", "....####....", "............", "............"],
  pelt: ["............", ".##......##.", ".#*##..##+#.", "..#*++++-#..", "..#*+--+-#..", "..#*++++-#..", "..#*+--+-#..", "..#*++++-#..", ".#*++++++-#.", ".##..##..##.", "............", "............"],
  book: ["............", "..#########.", ".#++++++++#.", ".#+**+++++#.", ".#+*++*+++#.", ".#+++*++++#.", ".#++++++++#.", ".#++++++++#.", ".#--------#.", ".#gggggggg#.", "..#########.", "............"],
  stone: ["............", ".....##.....", "....#**#....", "...#*++*#...", "..#*+++o+#..", "..#*++o++#..", "..#*+o++-#..", "...#+++-#...", "....#--#....", ".....##.....", "............", "............"],
  leaf: ["............", "........##..", "......##*#..", ".....#**+#..", "....#*++-#..", "...#*+#+-#..", "...#*#+-#...", "..#*#+-#....", "..##+-#.....", ".#w###......", "#w#.........", "##.........."],
  bark: ["............", "..########..", ".#*+*++*+-#.", ".#*+-++*--#.", ".#++-+*+--#.", ".#*+-++*+-#.", ".#++-+*+--#.", ".#*+-++*+-#.", ".#++-+-+--#.", "..########..", "............", "............"],
};
ART.elixir_power = ART.elixir_luck = ART.elixir_iron = POTION;
ART.feather = ["..........#.", ".........#*#", "........#*+#", ".......#*+-#", "......#*+-#.", ".....#*+-#..", "....#*+-#...", "...#*+-#....", "..#*+-#.....", "..#+-#......", ".#w##.......", "#w#........."];
ART.box = ["............", ".##########.", ".#*+++o++-#.", ".#*+++o++-#.", ".##########.", ".#*++#o#+-#.", ".#*++#o#+-#.", ".#*+++o++-#.", ".#*+++o++-#.", ".#--------#.", ".##########.", "............"];
ART.ticket = ["............", "............", ".##########.", ".#*++++++-#.", ".#*+#++#+-#.", "#*++++++++-#", ".#*+#++#+-#.", ".#*++++++-#.", ".##########.", "............", "............", "............"];
ART.scroll ??= ["............", "..########..", ".#*++++++-#.", "..#+----+#..", "..#++++++#..", "..#+----+#..", "..#++++++#..", "..#+----+#..", ".#*++++++-#.", "..########..", "............", "............"];
ART.herb = ART.leaf;
ART.blue_herb = ART.leaf;
ART.ore = ["............", "............", "....###.....", "...#*++#....", "..#*+o++##..", "..#*++++*+#.", ".#*+o+++++#.", ".#++++o++-#.", ".#+++++---#.", "..#------#..", "...######...", "............"];
ART.spore = ART.jelly;

/** 채집 지점 그림 16×16 (P13): 약초 덤불 · 푸른 꽃 · 광석 바위. off = 캐 간 뒤(빈 덤불 · 깨진 바위) */
const nodeCache = new Map<string, HTMLCanvasElement>();
export function gatherNode(kind: string, off: boolean): HTMLCanvasElement {
  const key = kind + off;
  let c = nodeCache.get(key);
  if (c) return c;
  const p = new Px(16, 16);
  if (kind === "ore") {
    p.ellipse(8, 11, 6, 4, off ? "#5b636c" : "#6f7680");
    p.ellipse(7, 10, 4, 3, off ? "#6f7680" : "#9aa3ad");
    if (!off) { p.set(6, 9, "#8fd0ff"); p.set(9, 11, "#8fd0ff"); p.set(10, 9, "#ffffff"); p.set(5, 11, "#F2C94C"); }
  } else {
    const leaf = kind === "blue_herb" ? "#3f8a3a" : "#4b9a35";
    for (const [x, y] of [[4, 10], [6, 8], [8, 7], [10, 8], [12, 10], [7, 11], [9, 11]]) { p.rect(x, y, 2, 4, leaf); p.set(x, y, "#7fcf5a"); }
    if (!off) {
      const fl = kind === "blue_herb" ? ["#3BA7FF", "#a8dcff"] : ["#E5484D", "#ff9a9e"];
      for (const [x, y] of [[5, 7], [9, 5], [12, 8]]) { p.rect(x, y, 2, 2, fl[0]); p.set(x, y, fl[1]); }
    }
  }
  p.outline();
  c = p.toCanvas();
  nodeCache.set(key, c);
  return c;
}
ART.moss = ART.stone;
ART.sap = POTION;

const cache = new Map<string, HTMLCanvasElement>();

const blend = (hex: string, toward: string, k: number) => {
  const a = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  const b = [1, 3, 5].map((i) => parseInt(toward.slice(i, i + 2), 16));
  return `#${a.map((v, i) => Math.round(v + (b[i] - v) * k).toString(16).padStart(2, "0")).join("")}`;
};

function armorPalette(t: (typeof ITEMS)[string], rarity: Rarity): [string, string, string] {
  const fallback = METAL[rarity];
  if (Array.isArray(t.look)) return [t.look[1], t.look[0], t.look[2]];
  if (typeof t.look === "string") return [t.look, blend(t.look, "#ffffff", 0.28), blend(t.look, "#000000", 0.28)];
  return fallback;
}

/** 굵은 대각선 픽셀 선. (x0,y0)→(x1,y1) 방향의 수직으로 두께를 냅니다. */
function thickLine(p: Px, x0: number, y0: number, x1: number, y1: number, radius: number, color: string) {
  const n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0));
  const slope = Math.sign((x1 - x0) * (y1 - y0));
  for (let i = 0; i <= n; i++) {
    const x = Math.round(x0 + (x1 - x0) * i / n), y = Math.round(y0 + (y1 - y0) * i / n);
    for (let d = -radius; d <= radius; d++) p.set(x + d, y - d * (slope || 1), color);
  }
}

function weaponArt(p: Px, icon: string, rarity: Rarity, t: (typeof ITEMS)[string]) {
  const [blade, shine, shade] = METAL[rarity];
  const wood = Array.isArray(t.look) ? t.look[1] : typeof t.look === "string" ? t.look : "#8a6440";
  if (icon === "staff" || icon === "wand") {
    const short = icon === "wand";
    const x0 = short ? 8 : 7, y0 = 28, x1 = short ? 23 : 24, y1 = short ? 6 : 3;
    thickLine(p, x0, y0, x1, y1, 3, OUTLINE);
    thickLine(p, x0, y0, x1, y1, 2, wood);
    thickLine(p, x0 + 1, y0 - 1, x1 + 1, y1 - 1, 0, blend(wood, "#ffffff", 0.34));
    p.ellipse(x1, y1 + 1, short ? 5 : 6, short ? 5 : 6, OUTLINE);
    p.ellipse(x1 - 1, y1, short ? 3 : 4, short ? 3 : 4, t.gem ?? shine);
    p.set(x1 - 2, y1 - 2, "#ffffff");
    p.rect(x0 - 3, y0 - 2, 7, 3, shade);
  } else {
    const dagger = icon === "dagger";
    const x0 = dagger ? 9 : 5, y0 = dagger ? 23 : 27, x1 = dagger ? 27 : 27, y1 = dagger ? 5 : 5;
    thickLine(p, x0, y0, x1, y1, dagger ? 2 : 3, OUTLINE);
    thickLine(p, x0, y0, x1, y1, dagger ? 1 : 2, blade);
    thickLine(p, x0 + 1, y0 - 1, x1 + 1, y1 - 1, 0, shine);
    const hx = dagger ? 6 : 3, hy = dagger ? 26 : 29, tx = dagger ? 11 : 10, ty = dagger ? 21 : 22;
    thickLine(p, hx, hy, tx, ty, 2, OUTLINE);
    thickLine(p, hx, hy, tx, ty, 1, wood);
    p.ellipse(hx, hy, 2, 2, shade);
    // 코등이: 칼날과 직각으로 짧게 뻗는 보호대
    thickLine(p, x0 - 3, y0 - 3, x0 + 3, y0 + 3, 1, OUTLINE);
    thickLine(p, x0 - 2, y0 - 3, x0 + 2, y0 + 3, 0, shine);
  }
  p.outline();
}

const GEM_COLORS: Record<string, string> = {
  ench_atk: "#ed5949", ench_ap: "#a05ddd", ench_def: "#4d9be8", ench_hp: "#56bd69",
  ench_speed: "#54d5d2", ench_crit: "#ef4774", ench_eldef: "#7d7ee8", ench_vamp: "#a83256",
};
function materialArt(p: Px, tpl: string) {
  if (tpl === "enhance_stone" || tpl === "blessed_stone") {
    const gold = tpl === "blessed_stone";
    const edge = gold ? "#efb849" : "#515b70", body = gold ? "#f7d36d" : "#8997b2", light = gold ? "#fff0a6" : "#e4edff", deep = gold ? "#b87527" : "#46516a";
    for (let y = 5; y <= 27; y++) {
      const half = Math.floor((y < 16 ? y - 4 : 28 - y) * 0.72);
      p.rect(16 - half - 1, y, half * 2 + 3, 1, edge);
      p.rect(16 - half, y, Math.max(1, half * 2 + 1), 1, y < 13 ? light : y > 21 ? deep : body);
    }
    p.rect(15, 9, 3, 13, gold ? "#fff0a6" : "#b8c7df"); p.rect(10, 16, 12, 2, gold ? "#fff0a6" : "#b8c7df");
    p.set(16, 15, gold ? "#ffffff" : "#d8e8ff");
    if (gold) { p.set(6, 9, "#fff0a6"); p.set(25, 10, "#fff0a6"); p.set(8, 23, "#efb849"); p.set(24, 22, "#efb849"); }
    p.outline();
    return true;
  }
  const color = GEM_COLORS[tpl];
  if (!color) return false;
  const light = blend(color, "#ffffff", 0.5), deep = blend(color, "#171323", 0.45);
  const rows = [3, 7, 11, 13, 13, 11, 7, 3];
  rows.forEach((ww, i) => p.rect(16 - Math.floor(ww / 2), 5 + i * 3, ww, 3, i < 2 ? light : i > 5 ? deep : color));
  p.outline();
  const glyph = tpl === "ench_atk" ? "slash" : tpl === "ench_ap" ? "star" : tpl === "ench_def" ? "shield" : tpl === "ench_hp" ? "heart" : tpl === "ench_speed" ? "wind" : tpl === "ench_crit" ? "cross" : tpl === "ench_eldef" ? "hex" : "drop";
  if (glyph === "slash") { p.rect(11, 17, 2, 8, "#fff0d5"); p.rect(13, 14, 2, 3, "#fff0d5"); p.rect(9, 23, 6, 2, "#fff0d5"); }
  else if (glyph === "star") { p.rect(15, 8, 3, 16, "#fff0d5"); p.rect(9, 14, 15, 3, "#fff0d5"); p.set(12, 11, "#fff0d5"); p.set(20, 20, "#fff0d5"); }
  else if (glyph === "shield") { p.rect(12, 12, 9, 2, "#fff0d5"); p.rect(13, 14, 7, 6, "#fff0d5"); p.rect(14, 20, 5, 2, "#fff0d5"); p.rect(15, 22, 3, 2, "#fff0d5"); }
  else if (glyph === "heart") { p.rect(11, 12, 5, 5, "#fff0d5"); p.rect(17, 12, 5, 5, "#fff0d5"); p.rect(12, 17, 9, 3, "#fff0d5"); p.rect(14, 20, 5, 2, "#fff0d5"); p.set(16, 22, "#fff0d5"); }
  else if (glyph === "wind") { p.rect(9, 12, 13, 2, "#fff0d5"); p.rect(12, 17, 12, 2, "#fff0d5"); p.rect(8, 22, 11, 2, "#fff0d5"); }
  else if (glyph === "cross") { p.rect(15, 9, 3, 15, "#fff0d5"); p.rect(9, 15, 15, 3, "#fff0d5"); }
  else if (glyph === "hex") { p.rect(13, 11, 7, 2, "#fff0d5"); p.rect(11, 13, 2, 7, "#fff0d5"); p.rect(20, 13, 2, 7, "#fff0d5"); p.rect(13, 20, 7, 2, "#fff0d5"); }
  else { p.ellipse(16, 16, 5, 8, "#fff0d5"); p.set(16, 5, "#fff0d5"); }
  return true;
}

/** 음식 8종은 서로 다른 실루엣과 1px 재료 디테일로 직접 그립니다. */
function foodArt(p: Px, tpl: string) {
  if (tpl === "meadow_bread") {
    p.ellipse(16, 18, 12, 9, OUTLINE); p.ellipse(16, 16, 10, 7, "#d89a52"); p.ellipse(15, 14, 7, 4, "#f3d58d");
    p.rect(10, 12, 2, 3, "#fff0bc"); p.rect(14, 10, 2, 4, "#fff0bc"); p.rect(18, 12, 2, 3, "#fff0bc"); p.rect(8, 19, 16, 2, "#92542f");
  } else if (tpl === "sun_apple") {
    p.ellipse(15, 18, 10, 10, OUTLINE); p.ellipse(14, 17, 8, 8, "#d84550"); p.ellipse(11, 14, 3, 3, "#ff9a9e");
    p.set(15, 8, "#70452e"); p.set(16, 7, "#70452e"); p.rect(17, 7, 6, 3, "#5b9d45"); p.set(18, 6, "#a7d86a"); p.set(22, 8, "#3f7838");
  } else if (tpl === "roast_skewer") {
    for (let i = 0; i < 7; i++) p.set(5 + i * 3, 25 - i * 3, "#b6783e");
    for (const [x, y, c] of [[8, 21, "#b94f37"], [14, 15, "#d88b45"], [20, 9, "#b94f37"]] as [number, number, string][]) {
      p.rect(x - 3, y - 3, 7, 7, OUTLINE); p.rect(x - 2, y - 3, 5, 5, c); p.set(x - 1, y - 3, "#ffd084");
    }
  } else if (tpl === "river_trout") {
    p.ellipse(15, 17, 11, 7, OUTLINE); p.ellipse(14, 16, 9, 5, "#d88958"); p.set(4, 17, OUTLINE); p.set(3, 16, OUTLINE); p.set(3, 18, OUTLINE);
    p.rect(9, 14, 2, 2, "#ffd79b"); p.rect(14, 13, 2, 2, "#ffd79b"); p.set(22, 15, OUTLINE); p.set(23, 16, "#fff0c2");
    p.rect(11, 20, 3, 1, "#8d593d"); p.rect(16, 20, 3, 1, "#8d593d");
  } else if (tpl === "root_soup") {
    p.rect(6, 16, 20, 8, OUTLINE); p.rect(7, 16, 18, 7, "#b65f47"); p.rect(9, 13, 14, 5, "#f1d68b");
    p.rect(10, 24, 12, 3, OUTLINE); p.rect(12, 26, 8, 2, "#8b513d"); p.rect(11, 14, 4, 2, "#8fc05a"); p.set(18, 15, "#e96c4a"); p.set(20, 17, "#e96c4a");
    p.set(12, 7, "#8fd0ff"); p.set(11, 5, "#8fd0ff"); p.set(19, 6, "#8fd0ff"); p.set(20, 4, "#8fd0ff");
  } else if (tpl === "berry_pie") {
    p.ellipse(16, 18, 12, 9, OUTLINE); p.ellipse(16, 17, 10, 7, "#bb713c"); p.ellipse(16, 16, 8, 5, "#f0c879");
    p.rect(9, 15, 14, 2, "#fff0b8"); p.rect(11, 12, 2, 8, "#fff0b8"); p.rect(16, 12, 2, 8, "#fff0b8"); p.rect(21, 12, 2, 8, "#fff0b8");
    p.set(11, 11, "#c74b70"); p.set(17, 10, "#c74b70"); p.set(22, 13, "#c74b70"); p.set(15, 10, "#f4a1b5");
  } else if (tpl === "honey_tteok") {
    p.rect(7, 17, 18, 8, OUTLINE); p.rect(9, 13, 16, 8, "#fff1d1"); p.rect(7, 19, 16, 5, "#f4dfb7"); p.rect(10, 11, 13, 3, "#fff7df");
    p.rect(12, 15, 2, 3, "#fff7df"); p.rect(18, 16, 2, 3, "#fff7df"); p.rect(14, 9, 8, 2, "#e7a638"); p.rect(20, 11, 3, 5, "#c98525"); p.set(21, 16, "#f7c75f");
  } else {
    p.rect(5, 10, 22, 17, OUTLINE); p.rect(7, 12, 18, 13, "#c88750"); p.rect(8, 13, 7, 10, "#f4e1b7");
    p.rect(16, 13, 8, 4, "#e5a64d"); p.rect(16, 18, 8, 5, "#9bc96a"); p.rect(10, 15, 3, 2, "#ffffff");
    p.rect(18, 14, 4, 2, "#ffdc75"); p.set(18, 19, "#f47759"); p.set(21, 20, "#f47759"); p.rect(8, 25, 16, 2, "#8b573b");
  }
  p.outline();
}

/** 템플릿 · 희귀도 → 32×32 캔버스 (희귀도는 장비만 색이 바뀜) */
export function itemIcon(tpl: string, rarity: Rarity): HTMLCanvasElement {
  const o = overrides.items.get(tpl); // 진짜 그림 (P17)
  if (o) return o;
  const t = ITEMS[tpl];
  const gear = !!t && isGear(t);
  const unique = t?.use?.food || t?.kind === "armor" || tpl === "enhance_stone" || tpl === "blessed_stone" || !!GEM_COLORS[tpl];
  const key = `${unique ? tpl : t?.icon}:${gear ? rarity : ""}`;
  let c = cache.get(key);
  if (!c) {
    const p = new Px(32, 32);
    if (t?.use?.food) {
      foodArt(p, tpl);
      c = p.toCanvas();
      cache.set(key, c);
      return c;
    }
    if (materialArt(p, tpl)) { c = p.toCanvas(); cache.set(key, c); return c; }
    if (t?.kind === "weapon" && ["dagger", "sword", "staff", "wand"].includes(t.icon)) {
      weaponArt(p, t.icon, rarity, t);
      c = p.toCanvas(); cache.set(key, c); return c;
    }
    const [main, light, shade] = t?.kind === "armor" ? armorPalette(t, rarity) : gear ? METAL[rarity] : OWN[t?.icon ?? ""] ?? METAL.common;
    const pal: Record<string, string> = { ...FIXED, "+": main, "*": light, "-": shade };
    (ART[t?.icon ?? ""] ?? ART.stone).forEach((row, y) => [...row].forEach((ch, x) => {
      if (ch === ".") return;
      const px = 4 + x * 2, py = 4 + y * 2;
      if (ch === "#") p.rect(px, py, 2, 2, OUTLINE);
      else if (ch === "*" && t?.kind === "armor") p.rect(px, py, 2, 2, light);
      else if (ch === "*") { p.set(px, py, "#ffffff"); p.set(px + 1, py, light); p.set(px, py + 1, light); p.set(px + 1, py + 1, main); }
      else if (ch === "+") { p.set(px, py, light); p.set(px + 1, py, main); p.set(px, py + 1, main); p.set(px + 1, py + 1, shade); }
      else if (ch === "-") { p.set(px, py, main); p.set(px + 1, py, shade); p.set(px, py + 1, shade); p.set(px + 1, py + 1, shade); }
      else { p.rect(px, py, 2, 2, pal[ch]); p.set(px, py, ch === "g" ? "#ffffff" : pal[ch]); }
    }));
    p.outline();
    // 1px 재질 디테일은 확대 과정 없이 최종 32px 버퍼에 바로 찍는다.
    if (["dagger", "sword", "axe"].includes(t?.icon ?? "")) {
      for (let i = 0; i < 9; i++) p.set(24 - i * 2, 8 + i * 2, light);
      p.set(25, 7, "#ffffff");
    } else if (["bow", "staff", "wand"].includes(t?.icon ?? "")) {
      p.set(10, 13, light); p.set(13, 10, light); p.set(17, 8, "#ffffff");
    } else if (["helmet", "chest", "legs", "boots", "gloves", "cape"].includes(t?.icon ?? "")) {
      p.set(10, 11, light); p.set(12, 10, t?.kind === "armor" ? light : "#ffffff"); p.set(21, 23, shade); p.set(23, 25, shade);
    } else if (["ring", "necklace", "earring"].includes(t?.icon ?? "")) {
      p.rect(16, 15, 2, 2, "#ffffff"); p.set(17, 14, light);
    } else if (["potion_hp", "potion_mp", "potion_en", "elixir_power", "elixir_luck", "elixir_iron", "sap"].includes(t?.icon ?? "")) {
      p.set(14, 13, "#ffffff"); p.set(16, 12, light); p.set(18, 17, shade);
    } else {
      p.set(11, 12, light); p.set(13, 10, "#ffffff"); p.set(21, 22, shade);
    }
    if (t?.kind === "armor") {
      const jewel = METAL[rarity][0];
      const mark: Record<string, [number, number]> = { helmet: [16, 8], chest: [16, 15], legs: [16, 15], boots: [21, 22], gloves: [16, 17], cape: [16, 15] };
      const [mx, my] = mark[t.icon] ?? [16, 15];
      p.rect(mx - 1, my, 3, 2, jewel); p.set(mx, my - 1, METAL[rarity][1]);
      if (rarity === "legendary") { p.set(26, 3, "#ffffff"); p.set(24, 5, "#fff4b0"); p.set(28, 5, "#fff4b0"); p.set(26, 7, "#fff4b0"); }
    } else if (gear && rarity === "legendary") { p.set(26, 3, "#ffffff"); p.set(24, 5, "#fff4b0"); p.set(28, 5, "#fff4b0"); p.set(26, 7, "#fff4b0"); }
    c = p.toCanvas();
    cache.set(key, c);
  }
  return c;
}
