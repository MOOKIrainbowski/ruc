import { TILE } from "../../shared/constants";
import type { TiledObject } from "../../shared/map";
import { TILE_NAMES, type TileName } from "../../shared/tiles";
import { Px, hash, type C3 } from "./px";

/**
 * 광장 타일 · 오브젝트 그림 (§18 팔레트: 사암 #E8D3A9 · 테라코타 #C8643B · 잔디 #8CC63F · 분수 물 #5EC8F0 · 가로등 #FFD27A).
 * 타일마다 4칸: 정적 타일은 무늬 변형 4종, 물 타일은 애니메이션 4프레임.
 */

export const VARIANTS = 4;

function tile(name: TileName, v: number): Px {
  const p = new Px(TILE, TILE);
  const dots = (base: string, cols: string[], n: number, seed: number) => {
    p.rect(0, 0, TILE, TILE, base);
    for (let i = 0; i < n; i++) p.set(Math.floor(hash(i, v, seed) * 16), Math.floor(hash(v, i, seed + 1) * 16), cols[i % cols.length]);
  };
  switch (name) {
    case "grass":
      dots("#8CC63F", ["#7ab535", "#9fd457", "#7ab535"], 14, 1);
      if (v === 3) { p.set(5, 6, "#fff4b0"); p.set(11, 11, "#ff9ec0"); }
      break;
    case "grass_dark":
      dots("#7ab535", ["#6aa42e", "#8CC63F"], 16, 2);
      break;
    case "dirt":
      dots("#a07850", ["#8c6642", "#b38a5f"], 18, 3);
      break;
    case "sand": {
      p.rect(0, 0, 16, 16, "#E8D3A9");
      const off = v % 2 ? 4 : 0;
      for (let y = 0; y < 16; y += 8) {
        p.rect(0, y + 7, 16, 1, "#d2b98a");
        for (let x = (y ? 8 : 0) + off; x < 16 + 8; x += 16) p.rect(x % 16, y, 1, 7, "#d2b98a");
        p.rect(0, y, 16, 1, "#f2e2c0");
      }
      break;
    }
    case "cobble":
      p.rect(0, 0, 16, 16, "#a8977c");
      for (const [x, y, w, h] of [[1, 1, 6, 5], [8, 0, 7, 6], [0, 7, 5, 4], [6, 7, 6, 4], [13, 7, 3, 4], [1, 12, 7, 4], [9, 12, 6, 4]]) {
        const s = hash(x + v, y, 9) > 0.5;
        p.part(x, y, w, h, s ? ["#e0cfae", "#cbb894", "#b19d7a"] : ["#d6c4a1", "#bfab86", "#a8946f"]);
      }
      break;
    case "stone_edge":
      p.rect(0, 0, 16, 16, "#9e917c");
      p.part(0, 0, 8, 8, ["#cfc2ab", "#b9ab95", "#a39580"]);
      p.part(8, 0, 8, 8, ["#c9bca5", "#b3a58f", "#9e907a"]);
      p.part(4, 8, 8, 8, ["#cfc2ab", "#b9ab95", "#a39580"]);
      p.part(-4, 8, 8, 8, ["#c9bca5", "#b3a58f", "#9e907a"]);
      p.part(12, 8, 8, 8, ["#c9bca5", "#b3a58f", "#9e907a"]);
      break;
    case "water":
    case "fountain_water": {
      const fountain = name === "fountain_water";
      p.rect(0, 0, 16, 16, fountain ? "#6fd2f5" : "#5EC8F0");
      for (let y = 2; y < 16; y += 5) {
        const sx = (v * 4 + y * 3) % 16;
        p.rect(sx, y, 5, 1, fountain ? "#b8ecff" : "#9ee0fa");
        p.rect((sx + 9) % 16, y + 2, 3, 1, fountain ? "#4fbfe8" : "#45afd9");
      }
      if (fountain && v % 2) p.set((v * 5) % 16, (v * 7) % 16, "#ffffff");
      break;
    }
    case "bridge":
      p.rect(0, 0, 16, 16, "#8a5a33");
      for (let y = 0; y < 16; y += 4) p.part(0, y, 16, 3, ["#d39a62", "#b07a4a", "#94633a"]);
      p.set(3 + v, 1, "#7a4c2a");
      break;
    case "flowers": {
      dots("#86c03c", ["#79b236"], 8, 4);
      const cols = ["#ff6b6b", "#ffd166", "#ffffff", "#ff9ec0", "#b39ddb"];
      for (let i = 0; i < 6; i++) {
        const x = 1 + Math.floor(hash(i, v, 5) * 13);
        const y = 1 + Math.floor(hash(v, i, 6) * 13);
        p.set(x, y + 1, "#4f8a2b");
        p.rect(x - 1, y, 3, 1, cols[(i + v) % cols.length]);
        p.set(x, y - 1, cols[(i + v) % cols.length]);
        p.set(x, y, "#fff4b0");
      }
      break;
    }
    case "fountain_rim":
      p.part(0, 0, 16, 16, ["#f2ebe0", "#ddd3c3", "#bdb2a1"]);
      p.rect(0, 7, 16, 1, "#c9bfae");
      break;
    case "hedge":
      dots("#4f8a2b", ["#3d6f20", "#63a336", "#3d6f20", "#5c9a33"], 40, 7);
      break;
    case "solid":
      break;
  }
  return p;
}

/** 타일 아틀라스: 가로 = 타일, 세로 = 변형/프레임 4 */
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

const TERRACOTTA: C3 = ["#e0805a", "#C8643B", "#9c4a2a"];
const WOOD: C3 = ["#c98d58", "#a36a3c", "#7d4f2b"];
const IRON: C3 = ["#6f7680", "#4f555e", "#383c43"];
const STONE: C3 = ["#f2ebe0", "#ddd3c3", "#bdb2a1"];

function stripes(p: Px, x0: number, y0: number, w: number, h: number, a: string, b: string, peak: boolean) {
  for (let y = 0; y < h; y++) {
    const inset = peak ? Math.floor(((h - y) * w) / (2.2 * h)) : 0;
    for (let x = inset; x < w - inset; x++) p.set(x0 + x, y0 + y, Math.floor(x / 4) % 2 ? b : a);
  }
}

/** 오브젝트 하나의 그림. 여러 장이면 애니메이션 프레임. 발밑 중심이 오브젝트 좌표. */
export function objectFrames(o: TiledObject): HTMLCanvasElement[] {
  const w = o.width;
  const h = o.height;
  const p = new Px(w, h);
  switch (o.type) {
    case "tree": {
      p.part(w / 2 - 3, h - 18, 6, 18, WOOD);
      const greens: C3 = hash(o.x, o.y) > 0.5 ? ["#8fd45a", "#5fae3a", "#3f8a2a"] : ["#a3d95f", "#6fb840", "#4b902f"];
      p.ellipse(w / 2, h - 34, 15, 15, greens[2]);
      p.ellipse(w / 2 - 1, h - 36, 13, 13, greens[1]);
      p.ellipse(w / 2 - 4, h - 40, 7, 6, greens[0]);
      for (let i = 0; i < 6; i++) p.set(4 + Math.floor(hash(i, o.x) * 24), h - 46 + Math.floor(hash(o.y, i) * 22), greens[2]);
      break;
    }
    case "lamp":
      p.part(6, 8, 4, h - 8, IRON);
      p.rect(4, h - 3, 8, 3, IRON[2]);
      p.part(3, 1, 10, 8, ["#fff1c4", "#FFD27A", "#e0a94a"]);
      p.rect(2, 0, 12, 2, IRON[1]);
      break;
    case "bench":
      p.part(1, 3, w - 2, 6, WOOD);
      p.part(1, 9, w - 2, 3, WOOD);
      p.rect(3, 12, 2, 4, IRON[2]);
      p.rect(w - 5, 12, 2, 4, IRON[2]);
      break;
    case "tent_shop":
    case "tent_market": {
      const [a, b2] = o.type === "tent_shop" ? ["#FF9F43", "#FFF1D6"] : ["#1FB5A8", "#FFFFFF"];
      stripes(p, 0, 0, w, 22, a, b2, true);
      stripes(p, 2, 22, w - 4, h - 24, a, b2, false);
      p.rect(w / 2 - 6, h - 16, 12, 16, "#5a3b2a"); // 입구
      p.part(w / 2 - 5, h - 15, 10, 4, o.type === "tent_shop" ? ["#ffe0a0", "#ffc860", "#e0a040"] : ["#b8f0ea", "#7fdcd2", "#4fb8ac"]); // 진열대
      p.rect(0, 21, w, 2, o.type === "tent_shop" ? "#d9772a" : "#168f85");
      break;
    }
    case "building": {
      const roofH = Math.floor(h * 0.45);
      p.part(4, roofH - 2, w - 8, h - roofH + 2, ["#f2e2c0", "#E8D3A9", "#c9b28a"]);
      for (let y = roofH + 6; y < h - 2; y += 8) p.rect(5, y, w - 10, 1, "#d2b98a");
      for (let y = 0; y < roofH; y++) {
        const inset = Math.floor(((roofH - y) * 10) / roofH);
        p.rect(inset, y, w - inset * 2, 1, y % 4 === 3 ? TERRACOTTA[2] : y < 3 ? TERRACOTTA[0] : TERRACOTTA[1]);
      }
      p.part(w / 2 - 8, h - 24, 16, 24, WOOD); // 문
      p.set(w / 2 + 4, h - 12, "#FFD27A");
      for (const x of [14, w - 30]) { p.part(x, roofH + 8, 16, 14, ["#fff4c4", "#bfe4f2", "#8cc0d8"]); p.rect(x + 7, roofH + 8, 2, 14, WOOD[2]); }
      break;
    }
    case "anvil":
      p.part(4, 2, w - 8, 6, IRON);
      p.part(w / 2 - 4, 8, 8, 8, IRON);
      p.set(8, 3, "#ffb347");
      break;
    case "mailbox":
      p.part(6, 14, 4, h - 14, WOOD);
      p.part(1, 2, 14, 13, ["#7fb0ff", "#3b6fd6", "#2a4f9e"]);
      p.rect(3, 6, 10, 2, "#1d3870");
      p.rect(11, 0, 2, 6, "#ff5a5a");
      break;
    case "board":
      p.part(3, h - 10, 3, 10, WOOD);
      p.part(w - 6, h - 10, 3, 10, WOOD);
      p.part(0, 0, w, h - 8, WOOD);
      for (const [x, y] of [[5, 4], [18, 3], [31, 5], [10, 12], [25, 13]]) p.part(x, y, 10, 8, ["#ffffff", "#f6efdc", "#ddd2b5"]);
      break;
    case "workbench":
      p.part(0, 10, w, 8, WOOD);
      p.rect(3, 18, 3, h - 18, WOOD[2]);
      p.rect(w - 6, 18, 3, h - 18, WOOD[2]);
      for (const [x, c] of [[6, "#9B5DE5"], [18, "#4CC764"], [30, "#ff6b6b"]] as const) { p.part(x, 2, 7, 9, ["#ffffff", c, c]); p.rect(x + 2, 0, 3, 2, WOOD[1]); }
      break;
    case "sign":
      p.part(7, 8, 2, 8, WOOD);
      p.part(1, 1, 14, 8, WOOD);
      p.rect(3, 4, 10, 1, WOOD[2]);
      break;
    case "statue":
      p.part(6, h - 10, w - 12, 10, STONE);
      p.part(11, 12, 10, h - 22, STONE);
      p.ellipse(16, 9, 6, 6, STONE[1]);
      p.part(3, 16, 8, 4, STONE);
      p.part(21, 14, 8, 4, STONE);
      p.set(14, 8, "#9ee7ff");
      p.set(18, 8, "#9ee7ff");
      break;
    case "rock":
      p.ellipse(8, 10, 7, 5, STONE[2]);
      p.ellipse(7, 9, 6, 4, "#c9bfae");
      p.rect(4, 7, 3, 1, STONE[0]);
      break;
    case "stump":
      p.part(3, 6, 10, 9, WOOD);
      p.ellipse(8, 6, 5, 2, "#e0b07a");
      p.ellipse(8, 6, 2, 1, WOOD[1]);
      break;
    case "bush":
      p.ellipse(8, 10, 7, 5, "#3d6f20");
      p.ellipse(7, 9, 6, 4, "#5c9a33");
      p.set(5, 7, "#ff6b6b");
      p.set(10, 9, "#ff6b6b");
      break;
    case "campfire": {
      const frames: HTMLCanvasElement[] = [];
      for (let f = 0; f < 4; f++) {
        const q = new Px(w, h);
        q.part(1, 12, 14, 3, WOOD);
        q.part(3, 10, 10, 2, ["#c98d58", "#8a5a33", "#6d4325"]);
        const fl = [0, 1, 2, 1][f];
        q.ellipse(8, 8 - fl / 2, 4, 4 + fl / 2, "#FF5A36");
        q.ellipse(8, 9, 2, 2 + fl / 2, "#FFD27A");
        q.set(6 + (f % 3), 2 - (f % 2), "#ffb347");
        q.outline();
        frames.push(q.toCanvas());
      }
      return frames;
    }
    case "portal": {
      const col = o.properties?.find((x) => x.name === "target")?.value;
      const c: C3 = col === "dungeon" ? ["#d6b3ff", "#9B5DE5", "#5a2f99"] : col === "arena" ? ["#ffb3b3", "#E5484D", "#99262a"] : ["#c8ffb3", "#4CC764", "#2a7a3a"];
      const frames: HTMLCanvasElement[] = [];
      for (let f = 0; f < 4; f++) {
        const q = new Px(w, h);
        q.part(4, h - 10, w - 8, 10, STONE);
        q.ellipse(w / 2, h / 2 - 2, w / 2 - 6, h / 2 - 8, c[2]);
        for (let i = 0; i < 24; i++) {
          const a = (i / 24) * Math.PI * 2 + f * 0.4;
          const r = (i % 3) * 5 + 6;
          q.rect(Math.round(w / 2 + Math.cos(a) * r), Math.round(h / 2 - 2 + Math.sin(a) * r * 0.9), 2, 2, i % 2 ? c[0] : c[1]);
        }
        q.outline();
        frames.push(q.toCanvas());
      }
      return frames;
    }
  }
  p.outline();
  return [p.toCanvas()];
}
