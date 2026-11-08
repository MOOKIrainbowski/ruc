import { Px, hueShift, type C3 } from "./px";
import { overrides } from "../assets";

/**
 * 몹 32×32 · 8프레임 (§25 몹 규격). 오른쪽을 보는 그림만 그리고 왼쪽은 좌우 반전 (DECISIONS D14).
 * 발밑 중심 = (16, 29).
 */

export const MOB_SIZE = 32;

const GRASS: C3 = ["#b5f07a", "#5bcb4a", "#3d9a33"];
const MINT: C3 = ["#ffffff", "#dff7ee", "#a8e3cf"];
const GOBLIN: C3 = ["#b6e07f", "#7cb342", "#557a2a"];
const TUNIC: C3 = ["#b08a5a", "#806240", "#5a4430"];
const WOLF: C3 = ["#b9c9b2", "#8a9f84", "#5f725a"];

function slime(f: number, body: C3 = GRASS, flower?: string): Px {
  const p = new Px(32, 32);
  const GRASS_ = body;
  const ph = (f / 8) * Math.PI * 2;
  const w = Math.round(11 - Math.sin(ph) * 1.3);
  const h = Math.round(8 + Math.sin(ph) * 1.3);
  const lift = Math.max(0, Math.round(Math.sin(ph - 1.2) * 2.4));
  const cy = 29 - h - lift;
  p.ellipse(16, cy, w, h, GRASS_[2]);
  p.ellipse(15, cy - 1, w - 1, h - 1, GRASS_[1]);
  p.ellipse(12, cy - 3, 3, 2, GRASS_[0]);
  p.set(10, cy - 4, "#ffffff");
  for (const x of [13, 20]) { p.rect(x, cy, 2, 3, "#2b1d2e"); p.set(x, cy, "#ffffff"); }
  p.rect(16, cy + 4, 3, 1, "#2f6b2a");
  p.rect(18, cy - h - 1, 1, 2, "#7a4c2a"); // 새싹
  p.rect(19, cy - h - 2, 2, 1, GRASS[0]);
  if (flower) { p.rect(16, cy - h - 4, 3, 2, GRASS[1]); p.rect(20, cy - h - 4, 3, 3, flower); p.set(21, cy - h - 3, "#fff4b0"); }
  p.outline();
  return p;
}

// ── 던전 "고목의 유적" 몹 (P7) ──────────────────────────────────────────
const SPROUT: C3 = ["#d6f59a", "#8fd85a", "#4f9a35"];
const sproutSlime = (f: number) => slime(f, SPROUT, "#ff9ec0");

function shroomShaman(f: number): Px {
  const p = new Px(32, 32);
  const b = Math.round(Math.sin((f / 8) * Math.PI * 2));
  p.part(12, 18 + b, 9, 10, ["#f2ead8", "#d8ccb0", "#a89a78"]); // 몸통 (버섯 줄기)
  p.rect(13, 26, 3, 3, "#a89a78");
  p.rect(18, 26, 3, 3, "#a89a78");
  p.ellipse(16, 14 + b, 11, 6, "#7a2a8a"); // 갓
  p.ellipse(15, 13 + b, 10, 5, "#a845b8");
  for (const [x, y] of [[10, 12], [15, 10], [20, 12], [18, 15], [12, 15]]) p.rect(x, y + b, 2, 1, "#f4d8f8");
  p.rect(14, 20 + b, 2, 2, "#2b1d2e");
  p.rect(18, 20 + b, 2, 2, "#2b1d2e");
  p.part(24, 9 - b, 2, 18, ["#c98d58", "#a36a3c", "#7d4f2b"]); // 지팡이
  p.ellipse(25, 8 - b, 3, 3, f % 4 < 2 ? "#d9a0e0" : "#f4d8f8");
  p.outline();
  return p;
}

function mossGolem(f: number): Px {
  const p = new Px(32, 32);
  const s = Math.round(Math.sin((f / 8) * Math.PI * 2));
  const STONE: C3 = ["#b9b2a0", "#8a8475", "#5e594e"];
  p.part(8 + s, 22, 6, 8, STONE); // 다리
  p.part(18 - s, 22, 6, 8, STONE);
  p.part(6, 8, 20, 16, STONE); // 몸통
  p.part(1, 10 - s, 6, 12, STONE); // 팔
  p.part(25, 10 + s, 6, 12, STONE);
  p.part(11, 2, 10, 8, STONE); // 머리
  p.rect(13, 5, 2, 2, "#9be564");
  p.rect(17, 5, 2, 2, "#9be564");
  for (let i = 0; i < 16; i++) p.set(6 + ((i * 7) % 20), 8 + ((i * 5) % 9), i % 2 ? "#6fae4a" : "#4f8a2b"); // 이끼
  p.rect(6, 8, 20, 2, "#5c9a33");
  p.outline();
  return p;
}

function shadowVine(f: number): Px {
  const p = new Px(32, 32);
  const DARK: C3 = ["#6b4f8a", "#43305a", "#271a36"];
  for (let i = 0; i < 3; i++) {
    const ph = (f / 8) * Math.PI * 2 + i * 2;
    for (let y = 28; y > 6 + i * 3; y -= 2) {
      const x = 10 + i * 6 + Math.round(Math.sin(ph + y / 4) * 3);
      p.part(x, y - 2, 4, 3, DARK);
      if (y % 6 === 0) p.set(x + 4, y - 2, "#9a70d0"); // 가시
    }
  }
  p.ellipse(17, 10, 5, 4, DARK[1]);
  p.ellipse(17, 10, 3, 2, f % 4 < 3 ? "#e070ff" : "#ffffff");
  p.set(17, 10, "#2b1d2e");
  p.outline("#160e20");
  return p;
}

function treeKnight(f: number): Px {
  const p = new Px(32, 32);
  const step = Math.round(Math.sin((f / 8) * Math.PI * 2));
  const BARK: C3 = ["#b9a27a", "#8a7350", "#5e4c33"];
  const IRON: C3 = ["#c0c6cf", "#8a919b", "#5a6068"];
  p.part(11 - step, 22, 4, 8, BARK);
  p.part(17 + step, 22, 4, 8, BARK);
  p.part(9, 11, 14, 12, BARK); // 갑옷
  p.rect(9, 16, 14, 1, "#3f6a26");
  p.part(11, 3, 10, 9, IRON); // 투구
  p.rect(13, 7, 6, 1, "#2b1d2e");
  p.set(15, 7, "#9be564");
  p.set(17, 7, "#9be564");
  p.part(14, 0, 4, 3, ["#8fcd5a", "#5c9a33", "#3d7a22"]); // 잎 장식
  p.part(4, 12, 6, 10, ["#8fcd5a", "#5c9a33", "#3d7a22"]); // 나뭇잎 방패
  p.part(24, 4 - step, 3, 20, IRON); // 검
  p.rect(22, 18 - step, 7, 2, "#7d4f2b");
  p.outline();
  return p;
}

function twinWitch(f: number): Px {
  const p = new Px(32, 32);
  const b = Math.round(Math.sin((f / 8) * Math.PI * 2) * 1.5);
  const ROBE: C3 = ["#ffb3d1", "#e0609a", "#9a2f60"];
  p.part(10, 14 + b, 12, 14, ROBE); // 드레스
  p.rect(8, 26 + b, 16, 2, ROBE[2]);
  p.part(12, 6 + b, 8, 8, ["#ffe9d8", "#f6d0b0", "#d8a888"]); // 얼굴
  p.rect(14, 9 + b, 1, 2, "#2b1d2e");
  p.rect(17, 9 + b, 1, 2, "#2b1d2e");
  // 쌍둥이 꽃 (분홍 · 노랑)
  for (const [x, c] of [[9, "#ff6b9e"], [22, "#ffd84d"]] as const) {
    p.ellipse(x, 4 + b - (f % 4 < 2 ? 0 : 1), 4, 3, c);
    p.ellipse(x, 4 + b, 1, 1, "#fff4b0");
    p.rect(x, 7 + b, 1, 5, "#4f8a2b");
  }
  p.outline();
  return p;
}

function purifyOrb(f: number): Px {
  const p = new Px(32, 32);
  const b = Math.round(Math.sin((f / 8) * Math.PI * 2) * 2);
  p.ellipse(16, 18 + b, 8, 8, "#c8a43a");
  p.ellipse(16, 18 + b, 7, 7, "#ffe680");
  p.ellipse(14, 16 + b, 4, 4, "#fff8cc");
  p.ellipse(13, 15 + b, 1, 1, "#ffffff");
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 + f * 0.4;
    p.set(Math.round(16 + Math.cos(a) * 11), Math.round(18 + b + Math.sin(a) * 11), i % 2 ? "#fff4b0" : "#F2C94C");
  }
  p.outline("#7a5a10");
  return p;
}

/** 보스 64×64 — 성난 숲정령 페른 (풀 · 바람) */
function fern(f: number): Px {
  const p = new Px(64, 64);
  const ph = (f / 8) * Math.PI * 2;
  const b = Math.round(Math.sin(ph) * 2);
  const LEAF: C3 = ["#b5f07a", "#5bcb4a", "#2f7a2a"];
  // 바람 소용돌이 (발밑)
  for (let i = 0; i < 20; i++) {
    const a = (i / 20) * Math.PI * 2 + ph;
    p.rect(Math.round(32 + Math.cos(a) * 20), Math.round(56 + Math.sin(a) * 5), 2, 1, i % 2 ? "#dff7ee" : "#a8e3cf");
  }
  p.part(24, 30 + b, 16, 22, LEAF); // 몸통
  p.ellipse(32, 30 + b, 10, 4, LEAF[0]);
  for (const s of [-1, 1]) {
    for (let i = 0; i < 4; i++) p.part(32 + s * (10 + i * 4) - (s < 0 ? 4 : 0), 28 + b + i * 3 - Math.round(Math.sin(ph + i) * 2), 5, 4, LEAF); // 잎 팔
  }
  p.part(23, 10 + b, 18, 18, LEAF); // 머리
  for (let i = 0; i < 6; i++) p.part(22 + i * 4, 3 + b + (i % 2) * 3, 3, 8, ["#d6f59a", "#8fd85a", "#4f9a35"]); // 잎 왕관
  p.rect(27, 17 + b, 3, 4, "#ffffff");
  p.rect(35, 17 + b, 3, 4, "#ffffff");
  p.rect(28, 18 + b, 2, 2, f % 4 < 3 ? "#ff5a36" : "#ffd27a"); // 성난 눈
  p.rect(36, 18 + b, 2, 2, f % 4 < 3 ? "#ff5a36" : "#ffd27a");
  p.rect(29, 24 + b, 7, 1, "#1d4a1a");
  p.outline();
  return p;
}

/** 보스 64×64 — 고목왕 엘드라 */
function eldra(f: number): Px {
  const p = new Px(64, 64);
  const ph = (f / 8) * Math.PI * 2;
  const sway = Math.round(Math.sin(ph) * 1.5);
  const BARK: C3 = ["#a07a52", "#6d4f33", "#43301f"];
  const CROWN: C3 = ["#7fc04a", "#4a8527", "#2c5a18"];
  for (const [x, w] of [[14, 8], [26, 6], [40, 8]] as const) p.part(x, 54, w, 8, BARK); // 뿌리
  p.part(18, 24, 28, 32, BARK); // 줄기 몸통
  for (let y = 28; y < 54; y += 5) p.rect(22, y, 20, 1, BARK[2]);
  p.part(4, 26 + sway, 14, 6, BARK); // 가지 팔
  p.part(46, 26 - sway, 14, 6, BARK);
  p.part(2, 30 + sway, 6, 10, BARK);
  p.part(56, 30 - sway, 6, 10, BARK);
  p.ellipse(32, 14, 26, 13, CROWN[2]); // 잎 관
  p.ellipse(31, 12, 24, 11, CROWN[1]);
  p.ellipse(24, 8, 9, 5, CROWN[0]);
  for (let i = 0; i < 5; i++) p.part(14 + i * 9, 0, 3, 7, ["#ffe680", "#F2C94C", "#a8842a"]); // 금빛 왕관 가지
  p.ellipse(26, 34, 3, 3, "#2b1d2e");
  p.ellipse(38, 34, 3, 3, "#2b1d2e");
  p.ellipse(26, 34, 2, 2, f % 4 < 3 ? "#9be564" : "#ffffff"); // 빛나는 눈
  p.ellipse(38, 34, 2, 2, f % 4 < 3 ? "#9be564" : "#ffffff");
  p.rect(28, 42, 8, 2, "#2b1d2e");
  for (let i = 0; i < 10; i++) p.set(20 + ((i * 7) % 24), 26 + ((i * 11) % 26), "#6fae4a"); // 이끼
  p.outline();
  return p;
}

function rabbit(f: number): Px {
  const p = new Px(32, 32);
  const hop = -Math.round(Math.sin((f / 8) * Math.PI) * 3);
  const by = 23 + hop;
  p.ellipse(15, by, 7, 5, MINT[2]);
  p.ellipse(14, by - 1, 6, 4, MINT[1]);
  p.ellipse(8, by - 2, 2, 2, MINT[0]); // 꼬리
  p.ellipse(21, by - 6, 4, 4, MINT[1]);
  p.part(18, by - 16, 2, 8, MINT); // 귀
  p.part(21, by - 15, 2, 7, MINT);
  p.rect(18, by - 14, 1, 5, "#ffb3c6");
  p.rect(21, by - 13, 1, 4, "#ffb3c6");
  p.rect(23, by - 7, 2, 2, "#3BA7FF");
  p.set(23, by - 7, "#ffffff");
  p.set(25, by - 5, "#ff9ec0");
  const leg = f % 4 < 2 ? 1 : 0;
  p.rect(11 - leg, by + 4, 3, 2, MINT[2]);
  p.rect(18 + leg, by + 4, 3, 2, MINT[2]);
  p.outline("#4a8f7d");
  return p;
}

function goblin(f: number): Px {
  const p = new Px(32, 32);
  const step = Math.round(Math.sin((f / 8) * Math.PI * 2));
  const b = Math.abs(Math.sin((f / 8) * Math.PI * 2)) > 0.7 ? -1 : 0;
  p.part(13 - step, 24, 3, 5, TUNIC); // 다리
  p.part(18 + step, 24, 3, 5, TUNIC);
  p.part(12, 16 + b, 10, 9, TUNIC); // 몸
  p.rect(12, 21 + b, 10, 1, "#3a2a1e");
  p.part(12, 6 + b, 11, 10, GOBLIN); // 머리
  p.part(8, 9 + b, 4, 3, GOBLIN); // 귀
  p.part(23, 9 + b, 4, 3, GOBLIN);
  p.rect(18, 10 + b, 2, 2, "#ffe14d");
  p.rect(21, 10 + b, 1, 2, "#ffe14d");
  p.rect(18, 14 + b, 4, 1, "#3a2a1e");
  p.part(23, 13 + b - step, 3, 3, GOBLIN); // 손
  p.part(24, 3 + b - step, 3, 11, ["#c98d58", "#a36a3c", "#7d4f2b"]); // 몽둥이
  p.outline();
  return p;
}

function wolf(f: number): Px {
  const p = new Px(32, 32);
  const sn = Math.sin((f / 8) * Math.PI * 2);
  const lg = [Math.round(1 + sn), Math.round(1 - sn)];
  for (const [x, i] of [[8, 0], [11, 1], [19, 1], [22, 0]] as const) p.part(x, 22, 2, 6 - lg[i], WOLF);
  p.ellipse(15, 19, 10, 5, WOLF[2]);
  p.ellipse(15, 18, 9, 4, WOLF[1]);
  p.rect(10, 15, 10, 1, WOLF[0]);
  p.part(23, 12, 6, 6, WOLF); // 머리
  p.part(28, 15, 3, 3, WOLF); // 주둥이
  p.set(30, 15, "#2b1d2e");
  p.part(23, 9, 2, 3, WOLF); // 귀
  p.set(26, 14, "#ffe14d");
  p.part(2, 13 - (sn > 0 ? 1 : 0), 5, 3, WOLF); // 꼬리
  for (const [x, y] of [[9, 14], [13, 13], [17, 14], [21, 13], [6, 12]]) { p.set(x, y, GRASS[1]); p.set(x + 1, y, GRASS[0]); p.set(x, y - 1, GRASS[2]); }
  p.outline();
  return p;
}

// ── P15 황혼 고원 몹: 기존 그림의 색조 변종 + 하피 · 비룡 날개 ──
/** 서리 하피: 날개를 퍼덕이는 새 몸통 */
function harpy(f: number): Px {
  const p = new Px(32, 32);
  const up = Math.round(Math.sin((f / 8) * Math.PI * 2) * 3);
  const W: C3 = ["#e8faff", "#9ee7ff", "#4a9ac0"];
  for (let i = 0; i < 9; i++) { p.rect(4 + i, 14 - up + Math.abs(4 - i) / 2, 1, 4, W[i % 2 ? 1 : 0]); p.rect(19 + i, 14 - up + Math.abs(4 - i) / 2, 1, 4, W[i % 2 ? 1 : 0]); }
  p.ellipse(16, 18, 5, 6, W[2]);
  p.ellipse(16, 17, 4, 5, W[1]);
  p.ellipse(16, 11, 4, 4, "#f6e9c8");
  p.set(14, 11, "#2b1d2e");
  p.set(18, 11, "#2b1d2e");
  p.rect(15, 13, 2, 1, "#F2C94C");
  for (const x of [13, 18]) p.rect(x, 24, 1, 4, "#F2C94C");
  p.outline();
  return p;
}
/** 멧돼지 엄니 · 비룡 날개 덧그리기 */
function tusks(p: Px): Px {
  p.set(29, 17, "#fffaf0"); p.set(30, 18, "#fffaf0"); p.set(29, 18, "#fffaf0");
  return p;
}
function drakeWings(p: Px, f: number): Px {
  const up = Math.round(Math.sin((f / 8) * Math.PI * 2) * 3);
  for (let i = 0; i < 8; i++) p.rect(10 + i, 4 + up + i, 1, Math.max(1, 8 - i), i % 2 ? "#fff4b0" : "#F2C94C");
  return p;
}

// ── P9 소환수 · 설치물 (data/pets.ts) ──
function spirit(f: number): Px {
  const p = new Px(32, 32);
  const b = Math.round(Math.sin((f / 8) * Math.PI * 2) * 2);
  for (let i = 0; i < 3; i++) p.set(16 + Math.round(Math.sin(f * 0.8 + i * 2) * 2), 23 + b + i, i ? "#7fd3ff" : "#c8f0ff"); // 꼬리
  p.ellipse(16, 17 + b, 6, 6, "#7fd3ff");
  p.ellipse(16, 16 + b, 4, 4, "#c8f0ff");
  p.ellipse(15, 15 + b, 1, 1, "#ffffff");
  p.set(14, 17 + b, "#1b4a6b");
  p.set(18, 17 + b, "#1b4a6b");
  p.outline("#2a6a9a");
  return p;
}

function turret(f: number): Px {
  const p = new Px(32, 32);
  p.part(9, 23, 14, 5, ["#9aa3ad", "#6b7480", "#474e57"]); // 받침
  p.rect(14, 19, 4, 4, "#474e57");
  p.part(10, 12, 12, 8, ["#c9d1d9", "#8a949e", "#5b636c"]); // 몸통
  p.part(21 - (f % 4 === 0 ? 1 : 0), 14, 7, 3, ["#e2e8ee", "#9aa3ad", "#5b636c"]); // 포신 (쏠 때 뒤로)
  p.set(13, 14, f % 2 ? "#ff5a36" : "#ffd27a"); // 표시등
  p.outline();
  return p;
}

function mendStation(f: number): Px {
  const p = new Px(32, 32);
  const g = Math.round(Math.sin((f / 8) * Math.PI * 2) * 1.5);
  p.rect(15, 12 + g, 2, 6, "#9be564"); // 안테나
  p.ellipse(16, 11 + g, 2, 2, "#d6f59a");
  p.part(9, 18, 14, 10, ["#e8eef2", "#b8c2cc", "#7f8a95"]);
  p.rect(15, 20, 2, 6, "#4cc764"); // 십자
  p.rect(13, 22, 6, 2, "#4cc764");
  p.outline();
  return p;
}

function totem(f: number): Px {
  const p = new Px(32, 32);
  p.part(12, 8, 8, 20, ["#c98d58", "#a36a3c", "#7d4f2b"]);
  p.rect(13, 11, 2, 2, "#ffe14d"); // 눈
  p.rect(17, 11, 2, 2, "#ffe14d");
  p.rect(14, 15, 4, 1, "#3a2a1e"); // 입
  p.rect(11, 19, 10, 2, "#5bcb4a"); // 띠
  const c = f % 4 < 2 ? "#7fd3ff" : "#c8f0ff"; // 머리 위 정령 빛
  p.set(16, 4, c);
  p.set(15, 5, c);
  p.set(17, 5, c);
  p.outline();
  return p;
}

const PAINT: Record<string, (f: number) => Px> = {
  dusk_imp: (f) => hueShift(goblin(f), 150, 1.1, 0.85), stone_boar: (f) => tusks(hueShift(wolf(f), -80, 0.4, 0.95)), frost_harpy: harpy,
  ember_golem: (f) => hueShift(mossGolem(f), -95, 1.4, 1.05), shade_knight: (f) => hueShift(treeKnight(f), 230, 0.7, 0.6), storm_drake: (f) => drakeWings(hueShift(wolf(f), -60, 1.6, 1.1), f),
  slime: (f) => slime(f), rabbit, goblin, wolf, pet_wolf: wolf, pet_spirit: spirit, turret, mend_station: mendStation, totem,
  sprout_slime: sproutSlime, shroom_shaman: shroomShaman, moss_golem: mossGolem, shadow_vine: shadowVine, tree_knight: treeKnight, twin_witch: twinWitch,
  purify_orb: purifyOrb, fern, eldra,
};

/** 네임 플레이트 높이 (발밑에서 머리 위 px) — 보스는 64px 그림 */
export const MOB_PLATE: Record<string, number> = {
  dusk_imp: 29, stone_boar: 23, frost_harpy: 26, ember_golem: 31, shade_knight: 33, storm_drake: 28,
  slime: 21, rabbit: 27, goblin: 29, wolf: 23, pet_wolf: 23, pet_spirit: 24, turret: 22, mend_station: 22, totem: 27, sprout_slime: 25, shroom_shaman: 27, moss_golem: 31, shadow_vine: 26, tree_knight: 33, twin_witch: 30, purify_orb: 24, fern: 60, eldra: 64,
};

/** [오른쪽 4프레임, 왼쪽 4프레임] */
export function mobFrames(key: string): [HTMLCanvasElement[], HTMLCanvasElement[]] {
  // 진짜 그림 (P17): 가로 띠 — 프레임 크기 = 높이, 오른쪽을 보는 그림 → 왼쪽은 좌우 반전
  const strip = overrides.mobs.get(key);
  if (strip) {
    const n = Math.max(1, Math.floor(strip.width / strip.height));
    const cut = (flip: boolean) => Array.from({ length: 8 }, (_, f) => {
      const c = document.createElement("canvas");
      c.width = c.height = strip.height;
      const g = c.getContext("2d")!;
      if (flip) { g.translate(c.width, 0); g.scale(-1, 1); }
      g.drawImage(strip, (f % n) * strip.height, 0, strip.height, strip.height, 0, 0, strip.height, strip.height);
      return c;
    });
    return [cut(false), cut(true)];
  }
  const paint = PAINT[key] ?? slime;
  const r: HTMLCanvasElement[] = [];
  const l: HTMLCanvasElement[] = [];
  for (let f = 0; f < 8; f++) {
    const a = paint(f);
    r.push(a.toCanvas());
    a.flipX();
    l.push(a.toCanvas());
  }
  return [r, l];
}
