import { TILE } from "../../shared/constants";
import type { TiledObject } from "../../shared/map";
import { TILE_NAMES, type TileName } from "../../shared/tiles";
import { Px, hash, type C3 } from "./px";

/**
 * 광장 · 초원 타일 · 오브젝트 그림 (§18 팔레트: 사암 #E8D3A9 · 테라코타 #C8643B · 잔디 #8CC63F · 분수 물 #5EC8F0 · 가로등 #FFD27A).
 * 타일은 16×16 그대로 두고 그림을 세밀하게 (2026-11 개선): 풀잎 · 벽돌 결 · 자갈 명암 · 물결 8프레임.
 * 타일마다 8칸: 정적 타일은 무늬 변형 8종, 물 타일은 애니메이션 8프레임.
 */

export const VARIANTS = 8;
/** 오브젝트 그림 여백 (나무 잎이 가장자리에서 잘리던 문제) */
const PAD_X = 6;
const PAD_TOP = 8;

function lerpHex(a: string, b: string, k: number) {
  const pa = parseInt(a.slice(1), 16);
  const pb = parseInt(b.slice(1), 16);
  const ch = (s: number) => Math.round(((pa >> s) & 255) * (1 - k) + ((pb >> s) & 255) * k);
  return `#${[16, 8, 0].map((s) => ch(s).toString(16).padStart(2, "0")).join("")}`;
}

/** 둥글게 명암 (왼쪽 위 빛) */
function ball(p: Px, cx: number, cy: number, rx: number, ry: number, c: C3) {
  for (let y = -ry; y <= ry; y++)
    for (let x = -rx; x <= rx; x++) {
      const nx = x / (rx + 0.5);
      const ny = y / (ry + 0.5);
      if (nx * nx + ny * ny > 1) continue;
      const l = -(nx * 0.6 + ny * 0.8);
      p.set(cx + x, cy + y, l > 0.42 ? c[0] : l < -0.3 ? c[2] : c[1]);
    }
}

function tile(name: TileName, v: number): Px {
  const p = new Px(TILE, TILE);
  const H = (i: number, s: number) => hash(i, v, s);
  /** 바탕색 + 부드러운 얼룩(2톤) + 점 */
  const ground = (base: string, dark: string, light: string, specks: number, seed: number) => {
    p.rect(0, 0, TILE, TILE, base);
    for (let i = 0; i < 5; i++) { // 얼룩
      const x = Math.floor(H(i, seed) * 14);
      const y = Math.floor(H(i, seed + 7) * 14);
      p.rect(x, y, 2 + (i % 3), 1 + (i % 2), i % 2 ? dark : light);
    }
    for (let i = 0; i < specks; i++) p.set(Math.floor(H(i, seed + 1) * 16), Math.floor(H(i, seed + 2) * 16), i % 3 ? dark : light);
  };
  switch (name) {
    case "grass": {
      ground("#8CC63F", "#7ab535", "#98d048", 6, 1);
      // 풀잎: 끝이 뾰족한 2~3px 세로 선 (밝은 끝)
      for (let i = 0; i < 9; i++) {
        const x = 1 + Math.floor(H(i, 11) * 14);
        const y = 3 + Math.floor(H(i, 12) * 12);
        const hgt = 2 + (i % 2);
        p.rect(x, y, 1, hgt, "#6aa42e");
        p.set(x, y - 1, "#b4e060");
        if (i % 3 === 0) { p.set(x + 1, y + 1, "#6aa42e"); p.set(x + 1, y, "#a5d84f"); }
      }
      if (v === 3) { p.set(5, 6, "#fff4b0"); p.set(4, 6, "#ffffff"); p.set(6, 6, "#ffffff"); p.set(5, 5, "#ffffff"); p.set(5, 7, "#ffffff"); p.set(11, 11, "#ff9ec0"); p.set(10, 11, "#ffd0e0"); }
      if (v === 6) { p.set(3, 12, "#ffe14d"); p.set(2, 12, "#fff6a8"); p.set(12, 4, "#c4a5f0"); p.set(11, 4, "#e6d6ff"); }
      break;
    }
    case "grass_dark":
      ground("#76b02f", "#639b27", "#86c03a", 8, 2);
      for (let i = 0; i < 7; i++) {
        const x = 1 + Math.floor(H(i, 21) * 14);
        const y = 3 + Math.floor(H(i, 22) * 12);
        p.rect(x, y, 1, 2 + (i % 2), "#58882a");
        p.set(x, y - 1, "#98cf55");
      }
      break;
    case "dirt":
      ground("#a07850", "#8c6642", "#b38a5f", 10, 3);
      for (let i = 0; i < 4; i++) { // 자갈
        const x = 1 + Math.floor(H(i, 31) * 12);
        const y = 1 + Math.floor(H(i, 32) * 12);
        p.rect(x, y, 3, 2, "#c4a07a");
        p.rect(x, y + 1, 3, 1, "#7c5a38");
        p.set(x, y, "#dcc09a");
      }
      break;
    case "sand": {
      // 사암 벽돌 바닥: 벽돌마다 살짝 다른 톤 · 위 왼쪽 밝게 · 아래 오른쪽 그림자 · 줄눈
      p.rect(0, 0, 16, 16, "#cdb68a");
      const off = v % 2 ? 4 : 0;
      for (let row = 0; row < 2; row++) {
        const y = row * 8;
        const sx = row ? (8 + off) % 16 : off;
        for (let k = -1; k < 2; k++) {
          const x0 = sx + k * 16;
          const tone = hash(x0 + v * 3, y, 41);
          const base = lerpHex("#e8d3a9", tone > 0.5 ? "#efdcb4" : "#ddc698", 0.7);
          for (let xx = Math.max(0, x0); xx < Math.min(16, x0 + 16); xx++) {
            for (let yy = y; yy < y + 7; yy++) p.set(xx, yy, base);
          }
          const a = Math.max(0, x0);
          const bnd = Math.min(16, x0 + 16);
          p.rect(a, y, bnd - a, 1, "#f6e9c6");
          p.rect(a, y + 6, bnd - a, 1, "#d2b98a");
          if (x0 >= 0) p.rect(x0, y, 1, 7, "#f6e9c6");
          if (x0 + 15 < 16) p.rect(x0 + 15, y, 1, 7, "#d2b98a");
          if (tone > 0.7) p.set(a + 4, y + 3, "#cfb888");
          if (tone < 0.25) p.set(a + 9, y + 2, "#f6e9c6");
        }
        p.rect(0, y + 7, 16, 1, "#bfa77a");
      }
      break;
    }
    case "cobble": {
      p.rect(0, 0, 16, 16, "#9a8a70");
      for (const [x, y, w, h] of [[1, 1, 6, 5], [8, 0, 7, 6], [0, 7, 5, 4], [6, 7, 6, 4], [13, 7, 3, 4], [1, 12, 7, 4], [9, 12, 6, 4]]) {
        const s = hash(x + v, y, 9);
        const c: C3 = s > 0.66 ? ["#eadcbd", "#d4c3a0", "#b6a37f"] : s > 0.33 ? ["#e0cfae", "#cbb894", "#b19d7a"] : ["#d6c4a1", "#bfab86", "#a8946f"];
        p.part(x, y, w, h, c);
        p.set(x + 1, y + 1, c[0]);
        p.set(x + w - 2, y + h - 2, c[2]);
        if (s > 0.8) p.set(x + 2, y + 2, "#9aa86a"); // 이끼
      }
      break;
    }
    case "stone_edge": {
      p.rect(0, 0, 16, 16, "#8c7f6a");
      const blocks: [number, number, number][] = [[0, 0, 8], [8, 0, 8], [4, 8, 8], [-4, 8, 8], [12, 8, 8]];
      blocks.forEach(([x, y, w], i) => {
        const s = hash(i + v, y, 17);
        p.part(x, y, w, 8, s > 0.5 ? ["#d6cab3", "#bfb19b", "#a39580"] : ["#cfc2ab", "#b9ab95", "#9e907a"]);
        p.rect(x + 2, y + 2, 2, 1, "#e6dcc8");
        if (s > 0.75) { p.set(x + 4, y + 4, "#8a7c68"); p.set(x + 5, y + 5, "#8a7c68"); }
        if (s < 0.2) p.rect(x + 1, y + 6, 3, 1, "#7f9a52");
      });
      break;
    }
    case "water":
    case "fountain_water": {
      const fountain = name === "fountain_water";
      const deep = fountain ? "#58c4ee" : "#4cb6e6";
      const mid = fountain ? "#6fd2f5" : "#5EC8F0";
      const hi = fountain ? "#b8ecff" : "#9ee0fa";
      const ph = (v / 8) * Math.PI * 2;
      for (let y = 0; y < 16; y++) {
        for (let x = 0; x < 16; x++) {
          const w1 = Math.sin(x * 0.55 + y * 0.9 + ph);
          const w2 = Math.sin(x * 0.9 - y * 0.5 - ph * 2);
          const s = w1 * 0.6 + w2 * 0.4;
          p.set(x, y, s > 0.55 ? hi : s > -0.1 ? mid : deep);
        }
      }
      for (let i = 0; i < 3; i++) { // 반짝임
        const x = Math.floor(hash(i, 5) * 14);
        const y = Math.floor(hash(i, 6) * 14);
        if ((v + i * 3) % 8 < 2) { p.set(x, y, "#ffffff"); p.set(x + 1, y, hi); }
      }
      break;
    }
    case "bridge": {
      p.rect(0, 0, 16, 16, "#6d4325");
      for (let y = 0; y < 16; y += 4) {
        const t = hash(y, v, 51);
        p.part(0, y, 16, 3, t > 0.5 ? ["#dba46c", "#b9824f", "#9b6b40"] : ["#d39a62", "#b07a4a", "#94633a"]);
        p.rect(3 + (y % 5), y + 1, 5, 1, "#a46f43"); // 나뭇결
        p.set(1, y + 1, "#5a3b22");
        p.set(14, y + 1, "#5a3b22"); // 못
      }
      break;
    }
    case "flowers": {
      ground("#86c03c", "#79b236", "#95cc48", 5, 4);
      const cols = ["#ff6b6b", "#ffd166", "#ffffff", "#ff9ec0", "#b39ddb"];
      for (let i = 0; i < 6; i++) {
        const x = 2 + Math.floor(H(i, 5) * 12);
        const y = 2 + Math.floor(H(i, 6) * 12);
        const c = cols[(i + v) % cols.length];
        p.set(x, y + 1, "#4f8a2b");
        p.set(x, y + 2, "#4f8a2b");
        p.set(x + 1, y + 2, "#5c9a33");
        p.rect(x - 1, y, 3, 1, c);
        p.set(x, y - 1, c);
        p.set(x, y + 0, "#fff4b0");
        p.set(x - 1, y, lerpHex(c, "#ffffff", 0.35));
      }
      break;
    }
    case "fountain_rim": {
      p.part(0, 0, 16, 16, ["#f6f0e6", "#e4dacb", "#bdb2a1"]);
      p.rect(0, 7, 16, 1, "#c9bfae");
      p.rect(0, 8, 16, 1, "#f0e9dc");
      p.rect(3 + (v % 4), 2, 4, 1, "#d6cbb9");
      p.rect(9, 11 + (v % 3), 4, 1, "#d6cbb9");
      p.set(1, 1, "#ffffff");
      break;
    }
    case "hedge": {
      p.rect(0, 0, 16, 16, "#3a6a1f");
      for (let i = 0; i < 14; i++) {
        const x = Math.floor(H(i, 71) * 13);
        const y = Math.floor(H(i, 72) * 13);
        ball(p, x + 1, y + 1, 2, 2, i % 2 ? ["#7ab94a", "#4f8a2b", "#356b1d"] : ["#8fcd5a", "#5c9a33", "#3d7a22"]);
      }
      break;
    }
    case "solid":
      break;
  }
  return p;
}

/** 타일 아틀라스: 가로 = 타일, 세로 = 변형/프레임 8 */
export function tileAtlas(): HTMLCanvasElement {
  const a = new Px(TILE * TILE_NAMES.length, TILE * VARIANTS);
  TILE_NAMES.forEach((n, i) => { for (let v = 0; v < VARIANTS; v++) a.draw(tile(n, v), i * TILE, v * TILE); });
  return a.toCanvas();
}

/** 미니맵 · 전체 지도용 타일 대표색 */
export const TILE_COLOR: Record<TileName, string> = {
  grass: "#8CC63F", grass_dark: "#7ab535", sand: "#E8D3A9", cobble: "#bfab86", water: "#5EC8F0", stone_edge: "#b9ab95",
  bridge: "#b07a4a", flowers: "#d9a0c0", fountain_rim: "#ddd3c3", fountain_water: "#6fd2f5", hedge: "#4f8a2b", dirt: "#a07850", solid: "#000000",
};

// ── 오브젝트 ──────────────────────────────────────────────────────

const TERRACOTTA: C3 = ["#e8906a", "#C8643B", "#9c4a2a"];
const WOOD: C3 = ["#d49a64", "#a36a3c", "#7d4f2b"];
const IRON: C3 = ["#8a919b", "#5a6068", "#383c43"];
const STONE: C3 = ["#f6f0e6", "#e0d6c6", "#bdb2a1"];

function stripes(p: Px, x0: number, y0: number, w: number, h: number, a: string, b: string, peak: boolean) {
  for (let y = 0; y < h; y++) {
    const inset = peak ? Math.floor(((h - y) * w) / (2.2 * h)) : 0;
    for (let x = inset; x < w - inset; x++) {
      const c = Math.floor(x / 4) % 2 ? b : a;
      p.set(x0 + x, y0 + y, y % 5 === 4 ? lerpHex(c, "#000000", 0.12) : x % 4 === 0 ? lerpHex(c, "#ffffff", 0.18) : c);
    }
  }
}

/** 오브젝트 하나의 그림. 여러 장이면 애니메이션 프레임. 발밑 중심이 오브젝트 좌표. */
export function objectFrames(o: TiledObject): HTMLCanvasElement[] {
  const w = o.width;
  const h = o.height;
  const p = new Px(w, h);
  switch (o.type) {
    case "tree": {
      const seed = hash(o.x, o.y);
      const greens: C3[] = [["#9ee06a", "#62b03e", "#3f8a2a"], ["#b0e270", "#74bd45", "#4b9030"], ["#8fd45a", "#5fae3a", "#37772a"]];
      const g = greens[Math.floor(seed * 3)];
      // 줄기: 뿌리 퍼짐 + 나무껍질 줄무늬
      p.part(w / 2 - 3, h - 18, 6, 18, WOOD);
      p.rect(w / 2 - 5, h - 3, 3, 3, WOOD[1]);
      p.rect(w / 2 + 2, h - 3, 3, 3, WOOD[2]);
      for (let y = h - 17; y < h - 3; y += 3) p.rect(w / 2 - 1 + (y % 2), y, 1, 2, WOOD[2]);
      p.rect(w / 2 - 2, h - 16, 1, 10, WOOD[0]);
      // 잎: 겹친 덩어리 여러 개 (뒤 → 앞) + 하이라이트 + 잎 결
      ball(p, w / 2, h - 32, 15, 14, [g[1], g[2], g[2]]);
      ball(p, w / 2 - 8, h - 30, 8, 8, g);
      ball(p, w / 2 + 8, h - 29, 8, 8, g);
      ball(p, w / 2, h - 38, 10, 9, g);
      ball(p, w / 2 - 4, h - 41, 5, 4, [g[0], g[0], g[1]]);
      for (let i = 0; i < 14; i++) {
        const x = 4 + Math.floor(hash(i, o.x) * (w - 8));
        const y = h - 48 + Math.floor(hash(o.y, i) * 26);
        p.set(x, y, i % 3 ? g[2] : g[0]);
        p.set(x + 1, y, i % 3 ? g[2] : g[1]);
      }
      if (seed > 0.8) { p.set(w / 2 + 6, h - 36, "#ff6b6b"); p.set(w / 2 - 6, h - 28, "#ff6b6b"); p.set(w / 2 + 1, h - 31, "#ff6b6b"); } // 열매
      break;
    }
    case "lamp":
      p.part(6, 9, 4, h - 9, IRON);
      p.rect(7, 10, 1, h - 12, IRON[0]);
      p.part(4, h - 4, 8, 4, IRON);
      p.rect(2, 5, 12, 2, IRON[1]);
      p.part(3, 0, 10, 8, ["#fffbe0", "#FFD27A", "#e0a94a"]);
      p.rect(5, 2, 2, 2, "#ffffff");
      p.rect(2, 0, 12, 1, IRON[1]);
      p.rect(6, 7, 4, 1, IRON[2]);
      break;
    case "bench":
      p.part(1, 3, w - 2, 3, WOOD);
      p.part(1, 6, w - 2, 3, WOOD);
      p.part(1, 9, w - 2, 3, ["#c98d58", "#8a5a33", "#6d4325"]);
      p.rect(2, 12, 2, 4, IRON[2]);
      p.rect(w - 4, 12, 2, 4, IRON[2]);
      p.rect(2, 1, 2, 3, IRON[1]);
      p.rect(w - 4, 1, 2, 3, IRON[1]);
      p.rect(4, 4, w - 8, 1, WOOD[0]);
      break;
    case "tent_shop":
    case "tent_market": {
      const shop = o.type === "tent_shop";
      const [a, b2] = shop ? ["#FF9F43", "#FFF1D6"] : ["#1FB5A8", "#FFFFFF"];
      stripes(p, 0, 0, w, 22, a, b2, true);
      stripes(p, 2, 22, w - 4, h - 24, a, b2, false);
      // 지붕 끝 물결 장식 + 깃발
      for (let x = 0; x < w; x += 4) p.rect(x, 21, 4, 3, Math.floor(x / 4) % 2 ? b2 : a);
      p.rect(0, 21, w, 1, shop ? "#d9772a" : "#168f85");
      p.rect(w / 2 - 1, 0, 2, 4, "#7d4f2b");
      p.part(w / 2 + 1, 0, 5, 3, shop ? ["#ff7a7a", "#E5484D", "#a8323a"] : ["#ffe28a", "#F2C94C", "#b88a1a"]);
      p.rect(w / 2 - 6, h - 16, 12, 16, "#4a2f20"); // 입구
      p.part(w / 2 - 6, h - 16, 12, 2, WOOD);
      p.part(w / 2 - 5, h - 14, 10, 4, shop ? ["#ffe0a0", "#ffc860", "#e0a040"] : ["#b8f0ea", "#7fdcd2", "#4fb8ac"]); // 진열대
      p.rect(w / 2 - 4, h - 17, 2, 2, shop ? "#E5484D" : "#9B5DE5"); // 진열품
      p.rect(w / 2 + 1, h - 17, 2, 2, shop ? "#4CC764" : "#F2C94C");
      p.part(2, h - 8, 3, 8, WOOD);
      p.part(w - 5, h - 8, 3, 8, WOOD);
      break;
    }
    case "building": {
      const roofH = Math.floor(h * 0.45);
      p.part(4, roofH - 2, w - 8, h - roofH + 2, ["#f6e8c8", "#E8D3A9", "#c9b28a"]);
      for (let y = roofH + 6; y < h - 2; y += 8) {
        p.rect(5, y, w - 10, 1, "#d2b98a");
        for (let x = 6 + ((y / 8) % 2) * 6; x < w - 8; x += 12) p.rect(x, y - 7, 1, 7, "#d9c298");
      }
      for (let y = 0; y < roofH; y++) { // 기와: 줄마다 어긋난 무늬
        const inset = Math.floor(((roofH - y) * 10) / roofH);
        p.rect(inset, y, w - inset * 2, 1, y % 4 === 3 ? TERRACOTTA[2] : y < 3 ? TERRACOTTA[0] : TERRACOTTA[1]);
        for (let x = inset + (y % 8 < 4 ? 0 : 3); x < w - inset; x += 6) p.set(x, y, TERRACOTTA[2]);
      }
      p.rect(w - 12, 0, 5, 7, "#8a8f99"); // 굴뚝
      p.rect(w - 13, 0, 7, 2, IRON[1]);
      p.part(w / 2 - 8, h - 24, 16, 24, WOOD); // 문
      p.rect(w / 2 - 1, h - 24, 2, 24, WOOD[2]);
      p.set(w / 2 + 4, h - 12, "#FFD27A");
      p.rect(w / 2 - 10, h - 26, 20, 2, STONE[2]);
      for (const x of [14, w - 30]) {
        p.part(x, roofH + 8, 16, 14, ["#fff4c4", "#bfe4f2", "#8cc0d8"]);
        p.rect(x + 7, roofH + 8, 2, 14, WOOD[2]);
        p.rect(x, roofH + 14, 16, 1, WOOD[2]);
        p.rect(x - 1, roofH + 22, 18, 2, WOOD[1]);
        p.rect(x - 3, roofH + 8, 2, 14, WOOD[1]);
        p.rect(x + 17, roofH + 8, 2, 14, WOOD[1]);
      }
      break;
    }
    case "anvil":
      p.part(3, 2, w - 6, 5, IRON);
      p.rect(w - 5, 3, 3, 2, IRON[1]);
      p.part(w / 2 - 4, 7, 8, 5, IRON);
      p.part(w / 2 - 6, 12, 12, 4, ["#6d513b", "#523b2a", "#3a2a1e"]);
      p.rect(5, 3, 4, 1, "#c8ced6");
      p.set(8, 2, "#ffb347");
      p.set(10, 1, "#ff7a3a");
      break;
    case "mailbox":
      p.part(6, 14, 4, h - 14, WOOD);
      p.part(1, 3, 14, 12, ["#8ec0ff", "#3b6fd6", "#2a4f9e"]);
      p.ellipse(8, 3, 7, 2, "#3b6fd6");
      p.rect(3, 7, 10, 2, "#1d3870");
      p.rect(3, 6, 10, 1, "#c8e0ff");
      p.rect(12, 0, 2, 6, "#ff5a5a");
      p.rect(12, 0, 3, 2, "#ff8a8a");
      break;
    case "board":
      p.part(3, h - 10, 3, 10, WOOD);
      p.part(w - 6, h - 10, 3, 10, WOOD);
      p.part(0, 0, w, h - 8, WOOD);
      p.rect(1, 1, w - 2, h - 10, "#b88a58");
      for (const [x, y, c] of [[5, 3, "#ffffff"], [18, 2, "#fff4b0"], [31, 4, "#ffd0e0"], [10, 11, "#d6f0ff"], [25, 12, "#ffffff"]] as const) {
        p.part(x, y, 10, 8, [lerpHex(c, "#ffffff", 0.4), c, lerpHex(c, "#000000", 0.18)]);
        p.rect(x + 2, y + 2, 6, 1, "#8c7a5a");
        p.rect(x + 2, y + 4, 4, 1, "#8c7a5a");
        p.set(x + 5, y, "#E5484D");
      }
      break;
    case "workbench":
      p.part(0, 10, w, 8, WOOD);
      p.rect(0, 10, w, 1, WOOD[0]);
      p.rect(3, 18, 3, h - 18, WOOD[2]);
      p.rect(w - 6, 18, 3, h - 18, WOOD[2]);
      for (const [x, c] of [[6, "#9B5DE5"], [18, "#4CC764"], [30, "#ff6b6b"]] as const) {
        p.part(x, 2, 7, 9, ["#ffffff", c, lerpHex(c, "#000000", 0.3)]);
        p.rect(x + 2, 0, 3, 2, WOOD[1]);
        p.rect(x + 1, 4, 2, 2, "#ffffffaa");
      }
      break;
    case "sign":
      p.part(7, 8, 2, 8, WOOD);
      p.part(1, 1, 14, 8, WOOD);
      p.rect(3, 3, 10, 1, WOOD[0]);
      p.rect(3, 5, 10, 1, WOOD[2]);
      p.set(2, 2, "#4a2f20");
      p.set(13, 2, "#4a2f20");
      break;
    case "statue":
      p.part(4, h - 10, w - 8, 10, STONE);
      p.rect(4, h - 5, w - 8, 1, STONE[2]);
      p.part(10, 12, 12, h - 22, STONE);
      ball(p, 16, 9, 6, 6, STONE);
      p.part(2, 16, 9, 4, STONE);
      p.part(21, 14, 9, 4, STONE);
      p.set(14, 8, "#9ee7ff");
      p.set(18, 8, "#9ee7ff");
      p.set(14, 9, "#5EC8F0");
      p.set(18, 9, "#5EC8F0");
      p.rect(15, 11, 2, 1, STONE[2]);
      break;
    case "rock":
      ball(p, 8, 10, 7, 5, ["#e0d6c6", "#bdb2a1", "#8f857a"]);
      p.rect(4, 7, 3, 1, STONE[0]);
      p.rect(9, 11, 3, 1, "#8f857a");
      p.set(11, 8, "#7f9a52");
      break;
    case "stump":
      p.part(3, 6, 10, 9, WOOD);
      ball(p, 8, 6, 5, 2, ["#f0c892", "#e0b07a", "#c89660"]);
      p.ellipse(8, 6, 3, 1, "#c89660");
      p.ellipse(8, 6, 1, 0, WOOD[1]);
      p.rect(5, 9, 1, 5, WOOD[2]);
      break;
    case "bush":
      ball(p, 8, 10, 7, 5, ["#6dae3e", "#4a8527", "#356b1d"]);
      ball(p, 6, 8, 4, 3, ["#8fcd5a", "#5c9a33", "#3d7a22"]);
      p.set(5, 7, "#ff6b6b");
      p.set(10, 9, "#ff6b6b");
      p.set(8, 11, "#ff9ec0");
      break;
    case "campfire": {
      const frames: HTMLCanvasElement[] = [];
      for (let f = 0; f < 8; f++) {
        const q = new Px(w, h);
        const ph = (f / 8) * Math.PI * 2;
        q.part(1, 12, 14, 3, WOOD);
        q.part(3, 10, 10, 2, ["#c98d58", "#8a5a33", "#6d4325"]);
        const fl = Math.round(Math.sin(ph) + Math.sin(ph * 2) * 0.6) + 1;
        ball(q, 8, 8 - Math.floor(fl / 2), 4, 4 + Math.floor(fl / 2), ["#ff9a5a", "#FF5A36", "#c0361a"]);
        q.ellipse(8, 9, 2, 2 + Math.floor(fl / 2), "#FFD27A");
        q.ellipse(8, 10, 1, 1, "#ffffff");
        q.set(6 + Math.round(Math.sin(ph) * 2), 2 - (f % 3), "#ffb347");
        q.set(10 - Math.round(Math.cos(ph) * 2), 4 - (f % 2), "#ffd27a");
        q.outline();
        frames.push(q.toCanvas());
      }
      return frames;
    }
    case "portal": {
      const col = o.properties?.find((x) => x.name === "target")?.value;
      const c: C3 = col === "dungeon" ? ["#e6ccff", "#9B5DE5", "#5a2f99"] : col === "arena" ? ["#ffc4c4", "#E5484D", "#99262a"] : ["#d4ffc4", "#4CC764", "#2a7a3a"];
      const frames: HTMLCanvasElement[] = [];
      for (let f = 0; f < 8; f++) {
        const q = new Px(w, h);
        q.part(4, h - 10, w - 8, 10, STONE);
        q.rect(4, h - 6, w - 8, 1, STONE[2]);
        ball(q, w / 2, h / 2 - 2, w / 2 - 6, h / 2 - 8, [c[1], c[2], c[2]]);
        for (let i = 0; i < 28; i++) {
          const a = (i / 28) * Math.PI * 2 + f * 0.26;
          const r = (i % 3) * 5 + 6;
          q.rect(Math.round(w / 2 + Math.cos(a) * r), Math.round(h / 2 - 2 + Math.sin(a) * r * 0.9), 2, 2, i % 2 ? c[0] : c[1]);
        }
        q.ellipse(w / 2, h / 2 - 2, 3 + (f % 4 < 2 ? 0 : 1), 3, c[0]);
        q.outline();
        frames.push(q.toCanvas());
      }
      return frames;
    }
  }
  // 외곽선이 그림 가장자리에서 잘리지 않게 좌우 6 · 위 8 여백을 둠 (발밑 기준 · anchor 는 그대로 가운데 아래)
  const padded = new Px(w + PAD_X * 2, h + PAD_TOP);
  padded.draw(p, PAD_X, PAD_TOP);
  padded.outline();
  return [padded.toCanvas()];
}
