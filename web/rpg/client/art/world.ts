import { TILE } from "../../shared/constants";
import type { TiledObject } from "../../shared/map";
import { TILE_NAMES, type TileName } from "../../shared/tiles";
import { PROPS } from "./props";
import { TERRAIN } from "./terrain";
import { treeFrames } from "./trees";
import { fountainFrames2x } from "./fountain";
import { BUILDINGS } from "./buildings";
import { Px, fromCanvas, hash, scale2x, type C3 } from "./px";

/**
 * 광장 · 초원 타일 · 오브젝트 그림 (§18 팔레트: 사암 #E8D3A9 · 테라코타 #C8643B · 잔디 #8CC63F · 분수 물 #5EC8F0 · 가로등 #FFD27A).
 * 타일은 16×16 그대로 두고 그림을 세밀하게 (2026-11 개선): 풀잎 · 벽돌 결 · 자갈 명암 · 물결 8프레임.
 * 타일마다 8칸: 정적 타일은 무늬 변형 8종, 물 타일은 애니메이션 8프레임.
 */

export const VARIANTS = 8;
/**
 * 월드 그림 해상도 (2026-11-14 피드백 2차 "픽셀을 최대한 많이"): 1 월드 px = R 그림 px — 타일 하나 = 32×32 그림.
 * 이 파일의 그림 함수는 모두 R 배 크기 캔버스를 돌려주고, game.ts 가 해상도 R 텍스처로 올려 월드 크기는 그대로.
 * 아직 다시 그리지 않은 그림은 1배로 그린 뒤 Scale2x 로 키움(`up`) — 다시 그린 것은 HD 표에 등록.
 */
export const R = 2;
const up = (p: Px) => scale2x(p, true);
const upCanvas = (c: HTMLCanvasElement) => scale2x(fromCanvas(c)).toCanvas();
/** 2배로 다시 그린 타일 (없으면 1배 그림을 키움) */
const HD_TILES: Partial<Record<TileName, (v: number) => Px>> = TERRAIN;
/** 2배로 다시 그린 오브젝트 (없으면 1배 그림을 키움). 캔버스 크기 = (width + 12) × R, (height + 8) × R — 발밑 가운데 아래 기준 */
export const HD_OBJECTS: Record<string, (o: TiledObject) => HTMLCanvasElement[]> = { ...PROPS, ...BUILDINGS, tree: treeFrames, fountain: fountainFrames2x };
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
  const T = TILE * R;
  const a = new Px(T * TILE_NAMES.length, T * VARIANTS);
  TILE_NAMES.forEach((n, i) => { for (let v = 0; v < VARIANTS; v++) a.draw(HD_TILES[n]?.(v) ?? up(tile(n, v)), i * T, v * T); });
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

/** 오브젝트 하나의 그림 (R 배). 여러 장이면 애니메이션 프레임. 발밑 중심이 오브젝트 좌표. */
export function objectFrames(o: TiledObject): HTMLCanvasElement[] {
  return HD_OBJECTS[o.type]?.(o) ?? objectFrames1x(o).map(upCanvas);
}

function objectFrames1x(o: TiledObject): HTMLCanvasElement[] {
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
    case "barrel": {
      ball(p, 8, 9, 6, 6, ["#c98d58", "#8a5a33", "#5e3d22"]);
      p.rect(2, 5, 12, 1, "#3d3a40");
      p.rect(2, 10, 12, 1, "#3d3a40");
      p.rect(3, 2, 10, 2, "#e0b07a");
      p.ellipse(8, 3, 5, 1, "#b88a58");
      p.rect(5, 7, 1, 5, "#e0b07a");
      break;
    }
    case "crate": {
      p.part(1, 3, 14, 12, ["#d8a46c", "#b07a44", "#7d5230"]);
      p.rect(1, 3, 14, 2, "#e8bd88");
      p.rect(2, 4, 1, 10, "#7d5230");
      p.rect(13, 4, 1, 10, "#7d5230");
      for (let i = 0; i < 12; i++) p.set(2 + i, 4 + Math.floor(i * 0.8), "#8a5a33");
      p.set(3, 5, "#3d3a40");
      p.set(12, 13, "#3d3a40");
      break;
    }
    case "crate_stack": {
      p.part(0, 6, 15, 10, ["#d8a46c", "#b07a44", "#7d5230"]);
      p.part(16, 4, 15, 12, ["#c99a60", "#a06c3c", "#74482a"]);
      p.part(5, 0, 12, 8, ["#e0b078", "#b88650", "#84582f"]);
      p.rect(1, 7, 13, 1, "#7d5230");
      p.rect(17, 5, 13, 1, "#7d5230");
      p.rect(7, 2, 8, 1, "#7d5230");
      break;
    }
    case "flowerpot": {
      p.part(4, 9, 8, 7, ["#e8906a", "#C8643B", "#9c4a2a"]);
      p.rect(3, 8, 10, 2, "#b0502e");
      p.rect(7, 4, 2, 5, "#4f8a2b");
      ball(p, 5, 5, 2, 2, ["#6dae3e", "#4a8527", "#356b1d"]);
      ball(p, 11, 6, 2, 2, ["#6dae3e", "#4a8527", "#356b1d"]);
      for (const [x, y, c] of [[8, 2, "#ff6b6b"], [5, 4, "#ffd166"], [11, 4, "#ff9ec0"]] as const) { p.rect(x - 1, y, 3, 1, c); p.set(x, y - 1, c); p.set(x, y, "#fff4b0"); }
      break;
    }
    case "banner": {
      p.rect(0, 0, w, 2, IRON[1]);
      p.rect(w / 2 - 1, 0, 2, h - 6, WOOD[2]);
      p.part(2, 2, w - 4, h - 8, ["#e87a6a", "#C8433B", "#8e2a28"]);
      for (let y = 0; y < 4; y++) p.rect(2 + y, h - 6 + y, w - 4 - y * 2, 1, "#8e2a28");
      p.rect(w / 2 - 3, 8, 6, 1, "#F2C94C");
      p.rect(w / 2 - 1, 6, 2, 8, "#F2C94C");
      p.rect(w / 2 - 3, 12, 6, 1, "#F2C94C");
      break;
    }
    case "well": {
      p.part(2, h - 18, w - 4, 18, ["#e6dcc8", "#bfb19b", "#8f8470"]);
      for (let y = h - 16; y < h - 2; y += 4) p.rect(3, y, w - 6, 1, "#8f8470");
      p.ellipse(w / 2, h - 18, w / 2 - 4, 3, "#5EC8F0");
      p.ellipse(w / 2, h - 18, w / 2 - 7, 2, "#3b9bd0");
      p.part(3, 4, 3, h - 18, WOOD);
      p.part(w - 6, 4, 3, h - 18, WOOD);
      p.part(1, 0, w - 2, 6, TERRACOTTA);
      p.rect(w / 2, 6, 1, 8, "#5a4a3a");
      p.part(w / 2 - 2, 14, 5, 4, WOOD);
      break;
    }
    case "haystack": {
      ball(p, 8, 10, 7, 6, ["#f2d27a", "#d9b356", "#a8842a"]);
      ball(p, 22, 11, 8, 5, ["#f0cc70", "#d0a94c", "#9c7a26"]);
      for (let i = 0; i < 18; i++) p.set(2 + (i * 7) % 26, 6 + (i * 5) % 9, i % 2 ? "#a8842a" : "#fbe9a8");
      p.rect(12, 8, 1, 8, "#7d5230");
      break;
    }
    case "sack": {
      ball(p, 8, 10, 5, 5, ["#e8dcc0", "#c9b88f", "#9c8c66"]);
      p.rect(6, 4, 4, 2, "#c9b88f");
      p.rect(5, 5, 6, 1, "#6d513b");
      p.set(7, 9, "#9c8c66");
      p.set(9, 11, "#9c8c66");
      break;
    }
    case "log": {
      p.part(1, 5, w - 2, 9, ["#b07a44", "#85582c", "#5e3d22"]);
      for (let x = 4; x < w - 4; x += 5) p.rect(x, 7, 1, 5, "#5e3d22");
      ball(p, 3, 9, 3, 4, ["#f0c892", "#d8a870", "#a87c4c"]);
      p.ellipse(3, 9, 1, 2, "#a87c4c");
      p.set(w - 8, 4, "#6dae3e");
      p.set(w - 7, 3, "#8fcd5a");
      break;
    }
    case "fence": {
      for (let x = 1; x < w - 1; x += 5) { p.part(x, 3, 3, 13, WOOD); p.set(x + 1, 2, WOOD[0]); }
      p.part(0, 6, w, 2, ["#c98d58", "#a36a3c", "#7d4f2b"]);
      p.part(0, 11, w, 2, ["#c98d58", "#a36a3c", "#7d4f2b"]);
      break;
    }
    case "mushroom": {
      p.rect(7, 8, 2, 5, "#f2ead8");
      ball(p, 8, 7, 4, 3, ["#ff8a7a", "#E5484D", "#a02a30"]);
      p.set(6, 6, "#ffffff"); p.set(9, 7, "#ffffff"); p.set(8, 5, "#ffffff");
      ball(p, 13, 12, 2, 2, ["#ffd8a0", "#e0a060", "#a8703a"]);
      p.rect(13, 13, 1, 2, "#f2ead8");
      break;
    }
    case "pillar": {
      // 유적의 무너진 기둥 (P7): 이끼 낀 돌 기둥 · broken = 위가 부러짐
      const broken = o.properties?.find((x) => x.name === "broken")?.value === 1;
      const top = broken ? 18 : 6;
      p.part(1, h - 7, w - 2, 7, ["#d8d0c0", "#b0a690", "#7f7666"]);
      p.rect(1, h - 4, w - 2, 1, "#7f7666");
      p.part(3, top, w - 6, h - 7 - top, ["#e6dfcf", "#c4baa4", "#8f8573"]);
      for (let y = top + 3; y < h - 8; y += 4) p.rect(4, y, w - 8, 1, "#a89e88");
      if (broken) for (let x = 3; x < w - 3; x++) p.set(x, top - ((x * 7) % 3), "#c4baa4");
      else p.part(1, top - 4, w - 2, 5, ["#d8d0c0", "#b0a690", "#7f7666"]);
      for (let i = 0; i < 9; i++) p.set(3 + ((i * 5) % (w - 6)), h - 9 - ((i * 7) % 14), i % 2 ? "#6fae4a" : "#4f8a2b"); // 이끼
      p.rect(3, h - 8, 3, 1, "#5c9a33");
      break;
    }
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
    case "portal":
      return portalFrames(o);
    case "fountain":
      return fountainFrames();
  }
  // 외곽선이 그림 가장자리에서 잘리지 않게 좌우 6 · 위 8 여백을 둠 (발밑 기준 · anchor 는 그대로 가운데 아래)
  const padded = new Px(w + PAD_X * 2, h + PAD_TOP);
  padded.draw(p, PAD_X, PAD_TOP);
  padded.outline();
  return [padded.toCanvas()];
}

// ── 바닥 데칼: 잔디 위 풀 뭉치 · 자갈 · 낙엽 · 버섯 · 잡초, 돌 위 금 · 이끼 (맵을 구울 때 타일 위에 흩뿌림) ──
export const DECAL_KINDS = ["tuft", "pebbles", "leaves", "mushroom", "weeds", "cracks", "moss", "puddle"] as const;
export type DecalKind = (typeof DECAL_KINDS)[number];
export const DECAL_VARIANTS = 4;

function decal(kind: DecalKind, v: number): Px {
  const p = new Px(TILE, TILE);
  const H = (i: number, sd: number) => hash(i + v * 7, v, sd + kind.length);
  switch (kind) {
    case "tuft":
      for (let i = 0; i < 5; i++) {
        const x = 3 + Math.floor(H(i, 1) * 10);
        const y = 6 + Math.floor(H(i, 2) * 7);
        p.rect(x, y, 1, 4, "#5c9a33");
        p.rect(x + 1, y + 1, 1, 3, "#76b02f");
        p.set(x, y - 1, "#9fd457");
        p.set(x - 1, y + 1, "#4f8a2b");
      }
      break;
    case "pebbles":
      for (let i = 0; i < 3 + (v % 2); i++) {
        const x = 2 + Math.floor(H(i, 3) * 11);
        const y = 3 + Math.floor(H(i, 4) * 10);
        p.rect(x, y, 2, 2, "#b9ab95");
        p.set(x, y, "#e0d6c6");
        p.rect(x, y + 2, 2, 1, "#5e554a66");
      }
      break;
    case "leaves":
      for (let i = 0; i < 4; i++) {
        const x = 2 + Math.floor(H(i, 5) * 11);
        const y = 3 + Math.floor(H(i, 6) * 10);
        const c = ["#c8a23a", "#d98a2a", "#a86a2a", "#8aa83a"][(i + v) % 4];
        p.rect(x, y, 3, 2, c);
        p.set(x + 1, y - 1, c);
        p.set(x + 3, y + 1, "#00000022");
      }
      break;
    case "mushroom":
      p.rect(7, 9, 2, 4, "#f2ead8");
      p.rect(5, 6, 6, 3, v % 2 ? "#E5484D" : "#d9a066");
      p.rect(6, 5, 4, 1, v % 2 ? "#E5484D" : "#d9a066");
      p.set(6, 7, "#ffffff"); p.set(9, 6, "#ffffff");
      p.rect(6, 13, 4, 1, "#00000022");
      break;
    case "weeds":
      for (let i = 0; i < 4; i++) {
        const x = 2 + Math.floor(H(i, 7) * 11);
        const y = 4 + Math.floor(H(i, 8) * 8);
        p.rect(x, y, 1, 5, "#4f8a2b");
        p.rect(x + 1, y + 1, 1, 3, "#6aa42e");
        p.rect(x - 1, y + 2, 1, 2, "#6aa42e");
        p.set(x, y - 1, "#d8e07a");
      }
      break;
    case "cracks":
      p.rect(3 + v, 4, 1, 3, "#6e6455"); p.rect(4 + v, 7, 2, 1, "#6e6455"); p.rect(6 + v, 8, 1, 4, "#6e6455"); p.rect(5 + v, 12, 2, 1, "#6e6455");
      p.rect(4 + v, 4, 1, 3, "#ffffff22");
      break;
    case "moss":
      for (let i = 0; i < 9; i++) p.rect(1 + Math.floor(H(i, 9) * 13), 8 + Math.floor(H(i, 10) * 7), 2, 1, i % 2 ? "#7f9a52" : "#9ab466");
      break;
    case "puddle":
      p.ellipse(8, 10, 5, 2, "#7fb4d066");
      p.ellipse(7, 9, 3, 1, "#cfe8f588");
      break;
  }
  return p;
}

/** 데칼 시트: 가로 = 변형, 세로 = 종류 */
export function decalSheet(): HTMLCanvasElement {
  const T = TILE * R;
  const a = new Px(T * DECAL_VARIANTS, T * DECAL_KINDS.length);
  DECAL_KINDS.forEach((k, ki) => { for (let v = 0; v < DECAL_VARIANTS; v++) a.draw(HD_DECALS[k]?.(v) ?? scale2x(decal(k, v)), v * T, ki * T); });
  return a.toCanvas();
}
/** 2배로 다시 그린 데칼 */
const HD_DECALS: Partial<Record<DecalKind, (v: number) => Px>> = {};

/** 물체 밑 부드러운 접촉 그림자 (타원, 가운데 진하고 가장자리 투명) */
export function contactShadow(): HTMLCanvasElement {
  const c = Object.assign(document.createElement("canvas"), { width: 64, height: 24 });
  const g = c.getContext("2d")!;
  const gr = g.createRadialGradient(32, 12, 1, 32, 12, 32);
  gr.addColorStop(0, "rgba(20,14,8,0.55)");
  gr.addColorStop(0.6, "rgba(20,14,8,0.28)");
  gr.addColorStop(1, "rgba(20,14,8,0)");
  g.save();
  g.scale(1, 0.375);
  g.fillStyle = gr;
  g.fillRect(0, 0, 64, 64);
  g.restore();
  return c;
}

// ── 분수 (2026-11-14 베타 피드백: "물도 없고 분수인지 모르겠다") ──────────────────────
// 서양식(이탈리아 · 신고전) 3단 분수: 장식 테두리의 둥근 수반 → 발루스터(배 모양) 기둥 → 가운데 · 위 접시(타차) 두 단 →
// 도토리 모양 꼭지 장식. 꼭지에서 물이 솟아 위 접시 → 가운데 접시 → 수반으로 단마다 넘쳐 떨어짐. 8프레임.
// 바닥 발자국 = 가로 반지름 60 · 세로 48 타원 (plaza.json 충돌과 같음), 테두리 높이 12. 그림 아래 끝 = 오브젝트 y.

const FW = 136;
const FH = 192;
const FCX = 68;
/** 바닥 타원 중심 (그림 좌표) */
const FGY = FH - 52;
const ST = { hi: "#fbf5e8", lt: "#eadfca", md: "#d3c4a8", dk: "#a99878", dd: "#7c6c54", mortar: "#b9aa8e" };
const WT = { deep: "#1d5f99", dk: "#2f86c2", md: "#4cb0e3", lt: "#8fd8f6", hi: "#d4f4ff" };

/** 돌 명암: 왼쪽 위 빛 — k = -1(그늘) .. 1(빛) */
const stoneAt = (k: number) => (k > 0.55 ? ST.hi : k > 0.15 ? ST.lt : k > -0.3 ? ST.md : k > -0.7 ? ST.dk : ST.dd);

/** 타원 접시(타차): 아래로 오목한 몸통 + 앞 가장자리 가리비 장식 + 테두리 윗면 + 물낯 */
function tazza(p: Px, cx: number, cy: number, rx: number, ry: number, depth: number, water: (x: number, y: number) => string) {
  for (let y = 0; y <= depth; y++) {
    const half = Math.round(rx * Math.sqrt(Math.max(0, 1 - (y / (depth + 1)) ** 2)) * (1 - y / (depth * 3)));
    for (let x = -half; x <= half; x++) p.set(cx + x, cy + ry + y, stoneAt((-x / (half + 1)) * 0.7 - (y / depth) * 0.6 - 0.1));
  }
  for (let x = -rx + 2; x <= rx - 2; x++) if ((x + rx) % 6 < 3) p.set(cx + x, cy + Math.round(ry * Math.sqrt(1 - (x / rx) ** 2)) + 1, ST.lt);
  for (let y = -ry; y <= ry; y++)
    for (let x = -rx; x <= rx; x++) {
      if ((x / rx) ** 2 + (y / ry) ** 2 > 1) continue;
      if ((x / (rx - 3)) ** 2 + (y / (ry - 1.5)) ** 2 <= 1) {
        // 안쪽: 물 (위쪽 가장자리는 안벽 그늘)
        const wallShade = y < 0 && (x / (rx - 3)) ** 2 + ((y + 1.5) / (ry - 1.5)) ** 2 > 1;
        p.set(cx + x, cy + y, wallShade ? ST.dk : water(x, y));
      } else p.set(cx + x, cy + y, stoneAt(-(x / rx) * 0.6 - (y / ry) * 0.9 + 0.2));
    }
}

/** 기둥 (발루스터): 아래에서부터 높이별 반폭 */
function column(p: Px, cx: number, yBottom: number, profile: number[]) {
  profile.forEach((half, i) => {
    const y = yBottom - i;
    for (let x = -half; x <= half; x++) p.set(cx + x, y, stoneAt((-x / (half + 0.5)) * 0.9 + 0.15));
    if (half >= 2) p.set(cx - half, y, ST.hi);
  });
}

/** 물줄기 한 가닥: (x, y0) → (x, y1) 반투명 + 아래로 흐르는 밝은 마디 + 떨어진 곳 물보라 */
function stream(p: Px, x: number, y0: number, y1: number, f: number, seed: number) {
  for (let y = y0; y <= y1; y++) {
    const band = (((y - y0 - f * 2 + seed * 3) % 6) + 6) % 6;
    p.set(x, y, band > 1 ? "#8fd8f6cc" : "#e8fbffee");
  }
  const sp = (f + seed) % 4;
  p.set(x - 1, y1 - (sp < 2 ? 1 : 0), "#ffffffcc");
  p.set(x + 1, y1 - (sp >= 2 ? 1 : 0), "#ffffffcc");
}

function fountainFrames(): HTMLCanvasElement[] {
  const frames: HTMLCanvasElement[] = [];
  const RX = 60;
  const RY = 48;
  const RIM = 12;
  const top = FGY - RIM; // 테두리 윗면 타원 중심 y
  for (let f = 0; f < 8; f++) {
    const p = new Px(FW, FH);
    const ph = (f / 8) * Math.PI * 2;
    // ① 수반 앞벽: 돌 블록 · 엇갈린 줄눈 · 위 몰딩 빛 · 바닥 그늘
    for (let x = -RX; x <= RX; x++) {
      const yEdge = top + Math.round(RY * Math.sqrt(1 - (x / RX) ** 2));
      for (let d = 0; d <= RIM; d++) {
        let c = stoneAt(-(x / RX) * 0.9 - 0.15 - (d > RIM - 3 ? 0.35 : 0));
        if (d === Math.floor(RIM / 2)) c = ST.mortar;
        else if ((x + RX + (d > RIM / 2 ? 7 : 0)) % 14 === 0) c = ST.mortar;
        if (d === 1) c = ST.hi;
        if (d === RIM) c = ST.dd;
        p.set(FCX + x, yEdge + d, c);
      }
    }
    // ② 수반 테두리 윗면 (바깥 몰딩 · 장식 홈) + 안벽 + 물낯 (퍼지는 물결 고리 · 가장자리 깊은 색 · 반짝임)
    const wRX = RX - 6;
    const wRY = RY - 5;
    for (let y = -RY; y <= RY; y++)
      for (let x = -RX; x <= RX; x++) {
        if ((x / RX) ** 2 + (y / RY) ** 2 > 1) continue;
        if ((x / wRX) ** 2 + (y / wRY) ** 2 > 1) {
          const a = Math.atan2(y / RY, x / RX);
          const outer = (x / (RX - 1.2)) ** 2 + (y / (RY - 1.2)) ** 2 > 1;
          const notch = !outer && Math.round(((a + Math.PI) / (Math.PI * 2)) * 32) % 2 === 0 && (x / (RX - 3)) ** 2 + (y / (RY - 3)) ** 2 > 1;
          let c = stoneAt(-(x / RX) * 0.55 - (y / RY) * 0.85 + 0.25);
          if (outer) c = y < 0 ? ST.hi : ST.lt;
          if (notch) c = ST.dk;
          p.set(FCX + x, top + y, c);
          continue;
        }
        if (y < 0 && (x / wRX) ** 2 + ((y - 4) / wRY) ** 2 > 1) { p.set(FCX + x, top + y, y < -wRY + 2 ? ST.dd : ST.dk); continue; }
        const r = Math.sqrt((x / wRX) ** 2 + ((y - 2) / wRY) ** 2);
        const ring = Math.sin(r * 22 - ph * 2);
        let c = r > 0.86 ? WT.dk : WT.md;
        if (ring > 0.82 && r > 0.18) c = r > 0.8 ? WT.md : WT.lt;
        if (r > 0.93) c = WT.deep;
        if (y > wRY * 0.55 && ring > 0.5) c = WT.lt;
        if (hash(x, y, f) > 0.992) c = "#ffffff";
        p.set(FCX + x, top + y, c);
      }
    // 가운데 접시에서 떨어진 물이 닿는 고리 — 물거품 (뒤쪽은 기둥에 가림)
    for (let i = 0; i < 40; i++) {
      const a = (i / 40) * Math.PI * 2 + ph * 0.25;
      if (Math.sin(a) < -0.1) continue;
      const r = 31 + Math.round(Math.sin(ph * 2 + i) * 1.2);
      if ((i + f) % 3 === 0) p.set(FCX + Math.round(Math.cos(a) * r), top + 4 + Math.round(Math.sin(a) * r * 0.4), "#ffffff");
    }
    // ③ 아래 기둥 (발루스터: 받침 → 배 → 목 → 접시 받침)
    const midY = top - 34;
    column(p, FCX, top + 4, [7, 7, 6, 5, 5, 5, 6, 6, 7, 7, 7, 6, 6, 5, 4, 4, 3, 3, 3, 3, 3, 4, 4, 5, 6, 7]);
    // ④ 가운데 접시
    tazza(p, FCX, midY, 30, 10, 9, (x, y) => {
      const r = Math.sqrt((x / 27) ** 2 + (y / 8.5) ** 2);
      return Math.sin(r * 9 - ph * 2) > 0.7 ? WT.lt : r > 0.85 ? WT.dk : WT.md;
    });
    // ⑤ 위 기둥 + 위 접시
    const upY = midY - 26;
    column(p, FCX, midY - 1, [5, 4, 3, 3, 2, 2, 2, 3, 3, 2, 2, 2, 2, 3, 3, 3, 4, 4, 5, 5, 5, 4, 4, 4, 4]);
    tazza(p, FCX, upY, 16, 6, 6, (x, y) => (Math.sin(Math.sqrt(x * x + y * y * 4) * 1.2 - ph * 2) > 0.6 ? WT.lt : WT.md));
    // ⑥ 꼭지 장식 (도토리)
    column(p, FCX, upY - 1, [2, 2, 3]);
    ball(p, FCX, upY - 7, 3, 4, [ST.hi, ST.md, ST.dk]);
    p.rect(FCX - 3, upY - 9, 7, 1, ST.dk);
    p.set(FCX, upY - 12, ST.lt);
    p.outline();

    // ⑦ 넘쳐 떨어지는 물줄기 (외곽선 없이): 위 접시 → 가운데 접시, 가운데 접시 → 수반
    [-13, -8, -3, 3, 8, 13].forEach((x, i) => {
      const y0 = upY + Math.round(6 * Math.sqrt(1 - (x / 16) ** 2)) + 3;
      stream(p, FCX + x, y0, midY + Math.round(9 * Math.sqrt(Math.max(0, 1 - (x / 27) ** 2))) - 1, f, i);
    });
    [-29, -24, -17, -9, 0, 9, 17, 24, 29].forEach((x, i) => {
      const y0 = midY + Math.round(10 * Math.sqrt(Math.max(0, 1 - (x / 30) ** 2))) + (Math.abs(x) > 26 ? 2 : 6);
      stream(p, FCX + x, y0, top + 4 + Math.round(13 * Math.sqrt(Math.max(0, 1 - (x / 32) ** 2))), f, i + 2);
    });
    // ⑧ 꼭지에서 솟는 물기둥 + 네 갈래 포물선 물방울 (프레임마다 흘러감)
    const jetTop = upY - 34 + Math.round(Math.sin(ph) * 1.5);
    for (let y = jetTop; y <= upY - 12; y++) {
      p.set(FCX, y, (y + f * 2) % 5 < 2 ? "#ffffffee" : "#bfeeffdd");
      if (y > jetTop + 3) p.set(FCX - 1 + ((y + f) % 2) * 2, y, "#8fd8f699");
    }
    p.set(FCX - 1, jetTop, "#ffffffcc");
    p.set(FCX + 1, jetTop, "#ffffffcc");
    for (const [dx, dy] of [[-1, 0], [1, 0], [-0.55, 0.45], [0.55, 0.45]] as const) {
      for (let k = 0; k < 7; k++) {
        const t = (k / 7 + f / 16) % 1;
        const x = FCX + dx * 15 * t;
        const y = jetTop + (upY + 2 + dy * 4 - jetTop) * (t * t) - 10 * t * (1 - t) + dy * 3 * t;
        p.set(Math.round(x), Math.round(y), k % 2 ? "#e8fbffee" : "#8fd8f6dd");
      }
    }
    for (let i = 0; i < 6; i++) {
      const a = hash(i, f, 9) * Math.PI * 2;
      const r = 8 + hash(i, f, 10) * 40;
      p.set(FCX + Math.round(Math.cos(a) * r), top - 40 + Math.round(hash(i, f, 11) * 60), "#ffffffaa");
    }
    frames.push(p.toCanvas());
  }
  return frames;
}

// ── 포털 (2026-11-14: 단색 평면 → 돌 아치 + 깊이 있는 소용돌이) ──────────────────────
// 돌 아치(쐐기돌 · 줄눈 · 왼쪽 위 빛) 안에, 가장자리는 어둡고 가운데로 갈수록 밝아지는 나선 소용돌이(터널처럼 깊어 보이게),
// 입구 테두리 · 위쪽 그늘, 기둥의 차례로 빛나는 룬, 계단에 비친 빛, 안으로 빨려 드는 빛 알갱이. 8프레임.
function portalFrames(o: TiledObject): HTMLCanvasElement[] {
  const w = o.width;
  const h = o.height;
  const col = o.properties?.find((x) => x.name === "target")?.value;
  const c: C3 = col === "dungeon" ? ["#e6ccff", "#9B5DE5", "#5a2f99"] : col === "arena" ? ["#ffc4c4", "#E5484D", "#99262a"] : col === "next" ? ["#fff4b0", "#F2C94C", "#a8842a"] : ["#d4ffc4", "#4CC764", "#2a7a3a"];
  const deep = lerpHex(c[2], "#0b0614", 0.65);
  const pal = [deep, lerpHex(c[2], deep, 0.4), c[2], c[1], lerpHex(c[1], c[0], 0.5), c[0], "#ffffff"];
  const cx = w / 2;
  const archCy = 30;
  const Ro = 27;
  const Ri = 19;
  const baseY = h - 9;
  const SP: C3 = ["#d9d2c6", "#a79d8e", "#6f675c"];
  const inside = (x: number, y: number) => y < baseY && (y >= archCy ? Math.abs(x - cx + 0.5) <= Ri : (x - cx + 0.5) ** 2 + (y - archCy) ** 2 <= Ri * Ri);
  const frames: HTMLCanvasElement[] = [];
  for (let f = 0; f < 8; f++) {
    const q = new Px(w, h);
    const ph = (f / 8) * Math.PI * 2;
    // 계단 2단 + 계단에 비친 포털 빛
    q.part(2, baseY + 4, w - 4, 5, SP);
    q.part(6, baseY, w - 12, 5, SP);
    q.rect(7, baseY, w - 14, 1, SP[0]);
    for (let x = cx - 14; x <= cx + 14; x++) q.set(x, baseY + 1, `${c[0]}${Math.abs(x - cx) < 8 ? "aa" : "55"}`);
    // 아치 돌: 위 반원은 방사형 줄눈(쐐기돌 블록), 기둥은 가로 줄눈 · 엇갈린 세로 줄눈, 왼쪽 위 빛
    for (let y = 0; y < baseY; y++)
      for (let x = 0; x < w; x++) {
        const dx = x - cx + 0.5;
        const dy = y - archCy;
        const arch = y < archCy ? dx * dx + dy * dy <= Ro * Ro : Math.abs(dx) <= Ro;
        if (!arch || inside(x, y)) continue;
        let k: number;
        let joint: boolean;
        if (y < archCy) {
          const a = Math.atan2(dy, dx);
          const r = Math.sqrt(dx * dx + dy * dy);
          const seg = ((a + Math.PI) / Math.PI) * 9;
          joint = Math.abs(seg - Math.round(seg)) < 0.07;
          k = -Math.cos(a + 0.6) * 0.5 + (r > Ro - 1.5 ? 0.4 : r < Ri + 1.5 ? -0.5 : 0);
        } else {
          joint = (y - archCy) % 7 === 0 || (Math.abs(dx) === Ri + 4 && Math.floor((y - archCy) / 7) % 2 === 0);
          k = (dx < 0 ? 0.25 : -0.35) + (Math.abs(dx) > Ro - 2 ? -0.3 : Math.abs(dx) < Ri + 2 ? (dx < 0 ? -0.4 : 0.1) : 0);
        }
        q.set(x, y, joint ? SP[2] : k > 0.3 ? SP[0] : k < -0.3 ? SP[2] : SP[1]);
      }
    // 쐐기돌 (맨 위 가운데) — 포털 색 보석
    q.part(cx - 4, archCy - Ro - 1, 8, 9, SP);
    q.rect(cx - 2, archCy - Ro + 2, 4, 4, c[1]);
    q.set(cx - 2, archCy - Ro + 2, c[0]);
    q.rect(cx - 1, archCy - Ro + 3, 2, 2, f % 4 < 2 ? c[0] : "#ffffff");
    // 소용돌이: 가장자리 어둡게 → 가운데 밝게 + 나선 팔 3개가 돎 + 입구 테두리 · 위쪽 그늘
    const vx = cx - 0.5;
    const vy = archCy + 6;
    for (let y = 0; y < baseY; y++)
      for (let x = 0; x < w; x++) {
        if (!inside(x, y)) continue;
        const dx = (x - vx) / Ri;
        const dy = (y - vy) / (Ri + 6);
        const d = Math.min(1, Math.sqrt(dx * dx + dy * dy));
        const a = Math.atan2(dy, dx);
        let lv = (1 - d) * 5.2 + Math.sin(a * 3 + d * 9 - ph * 1.5) * 0.9 - 0.2;
        const edge = y < archCy ? Ri - Math.sqrt((x - cx + 0.5) ** 2 + (y - archCy) ** 2) : Ri - Math.abs(x - cx + 0.5);
        if (edge < 2.5) lv -= 1.6;
        if (y < archCy - Ri * 0.5) lv -= 0.7;
        q.set(x, y, pal[Math.max(0, Math.min(pal.length - 1, Math.round(lv)))]);
      }
    // 빨려 들어가는 빛 알갱이
    for (let i = 0; i < 10; i++) {
      const t = (i / 10 + f / 8) % 1;
      const a = hash(i, 3, 7) * Math.PI * 2 + t * 2.5;
      const r = (1 - t) * (Ri - 2);
      const x = Math.round(vx + Math.cos(a) * r);
      const y = Math.round(vy + Math.sin(a) * r * 1.2);
      if (inside(x, y)) q.set(x, y, t > 0.6 ? "#ffffff" : c[0]);
    }
    // 기둥 룬 (차례로 빛남)
    for (let i = 0; i < 3; i++) {
      const on = (f + i * 3) % 8 < 3;
      for (const sx of [cx - Ri - 6, cx + Ri + 4]) {
        const y = archCy + 6 + i * 8;
        q.rect(sx, y, 2, 1, on ? c[0] : c[2]);
        q.set(sx + (i % 2), y + 1, on ? "#ffffff" : c[2]);
        q.rect(sx, y + 2, 2, 1, on ? c[0] : c[2]);
      }
    }
    q.outline();
    frames.push(q.toCanvas());
  }
  return frames;
}
