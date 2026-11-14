import type { TiledObject } from "../../shared/map";
import { Px } from "./px";

/**
 * 나무 2배 그림 (2026-11-14 피드백 2차: "나무 · 건물도 전형적인 디자인을 참고해 최대한 많은 픽셀로 사실적으로").
 * 3/4 시점(위에서 약 55°): 줄기 아래쪽과 뿌리가 보이고, 잎은 둥근 덩어리 여러 개가 뒤(위) → 앞(아래) 순서로 겹친 돔.
 * 덩어리마다 왼쪽 위 빛 6단 + 잎 결(작은 잎 뭉치) + 아래쪽 그늘(AO) + 짙은 초록 외곽선. 줄기는 잎 그늘이 드리움.
 * 맵마다 수종: 광장 · 초원 · 결투장 = 활엽수(참나무 · 사과나무 · 자작나무), 고원 = 가문비(침엽수), 던전 = 이끼 낀 고목.
 * 같은 수종 안에서 6가지 변형을 캐시 (텍스처 수 · 메모리 절약).
 */

type Ramp = readonly [string, string, string, string, string, string];
const OAK: Ramp = ["#dcf58a", "#a8dc5c", "#7cc244", "#5aa035", "#3f7d2a", "#2a571f"];
const OAK2: Ramp = ["#e4f29a", "#b6d860", "#8abd45", "#669c38", "#4a7a2c", "#30561f"];
const BIRCH: Ramp = ["#f2f7a8", "#cfe679", "#a9d158", "#86b345", "#618c35", "#3f6526"];
const PINE: Ramp = ["#a8dcb0", "#6fb88a", "#4b9a72", "#357c5f", "#24604b", "#173f33"];
const OLD: Ramp = ["#b9d48a", "#8cb062", "#6a9049", "#4f7238", "#38552b", "#24381e"];
const BARK: Ramp = ["#c99a6c", "#a87a50", "#86603e", "#684a31", "#4a3424", "#2e2018"];
const BIRCH_BARK: Ramp = ["#ffffff", "#ece8df", "#d6d0c3", "#b3ab9b", "#6b645a", "#2f2b27"];

let biome = "plaza";
/** game.ts 가 맵을 만들기 전에 부름 */
export const setTreeBiome = (kind: string) => void (biome = kind);

function rnd(a: number, b: number, c = 0) {
  let h = (Math.imul(a | 0, 0x27d4eb2d) ^ Math.imul(b | 0, 0x165667b1) ^ Math.imul(c | 0, 0x9e3779b9)) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** 줄기 + 뿌리: 아래가 넓고 위로 가늘어짐, 왼쪽 빛 · 오른쪽 그늘, 세로 껍질 결 */
function trunk(p: Px, cx: number, base: number, top: number, w0: number, b: Ramp, seed: number, birch = false) {
  for (let y = top; y <= base; y++) {
    const t = (y - top) / (base - top);
    const flare = t > 0.78 ? ((t - 0.78) / 0.22) ** 2 * w0 * 0.9 : 0; // 뿌리 퍼짐
    const half = w0 * (0.55 + 0.45 * t) + flare;
    for (let x = Math.round(-half); x <= Math.round(half); x++) {
      const k = x / (half + 0.5); // -1 왼쪽 .. 1 오른쪽
      const streak = rnd(Math.floor((x + 40) / 2), Math.floor(y / 5), seed) > 0.72;
      let i = k < -0.55 ? 1 : k < 0.1 ? 2 : k < 0.6 ? 3 : 4;
      if (streak && !birch) i = Math.min(5, i + 1);
      if (birch && rnd(x + 40, Math.floor(y / 3), seed) > 0.86) i = 5; // 자작나무 검은 무늬
      p.set(cx + x, y, b[i]);
    }
  }
  // 뿌리 사이 그늘 · 바닥과 닿는 곳
  for (let x = -w0 * 1.6; x <= w0 * 1.6; x++) p.set(Math.round(cx + x), base, b[5]);
}

/** 돔 전체의 위 · 아래 (아래로 갈수록 그늘 — 덩어리 하나하나가 아니라 나무 전체의 입체감) */
let domeTop = 0;
let domeBottom = 1;
/** 잎 덩어리 하나: 구 명암 + 잎 결 (작은 잎 뭉치) */
function cluster(p: Px, cx: number, cy: number, r: number, g: Ramp, seed: number, dark = 0) {
  const ry = r * 0.86;
  for (let y = Math.floor(-ry); y <= ry; y++)
    for (let x = Math.floor(-r); x <= r; x++) {
      // 가장자리가 잎 모양으로 들쭉날쭉
      const ang = Math.atan2(y, x);
      const wob = 1 + 0.09 * Math.sin(ang * 7 + seed) + 0.05 * Math.sin(ang * 13 + seed * 2);
      const nx = x / (r * wob), ny = y / (ry * wob);
      const d = nx * nx + ny * ny;
      if (d > 1) continue;
      const gy = Math.max(0, Math.min(1, (cy + y - domeTop) / (domeBottom - domeTop)));
      let l = -(nx * 0.55 + ny * 0.85) * 0.85 + (1 - d) * 0.15 - 0.22 - gy * 0.5;
      // 잎 결: 3×2 잎 뭉치마다 위는 밝고 아래는 어둡게
      const lx = Math.floor((cx + x + 60) / 3), ly = Math.floor((cy + y + 60 + (lx % 2)) / 2);
      const leaf = rnd(lx, ly, seed + 5);
      if ((cy + y + (lx % 2)) % 2 === 0) l += 0.12; else l -= 0.1;
      l += (leaf - 0.5) * 0.35;
      let i = l > 0.62 ? 0 : l > 0.32 ? 1 : l > 0.02 ? 2 : l > -0.3 ? 3 : l > -0.62 ? 4 : 5;
      if (d > 0.78 && ny > 0.05) i = Math.max(i, d > 0.92 ? 5 : 4); // 아래 가장자리 그늘 (덩어리 사이 경계)
      i = Math.min(5, i + dark);
      p.set(cx + x, cy + y, g[i]);
    }
}

function outline(p: Px, col: string) {
  const src = p.d.slice();
  const at = (x: number, y: number) => x >= 0 && y >= 0 && x < p.w && y < p.h && src[y * p.w + x] >>> 24 > 0x80;
  for (let y = 0; y < p.h; y++)
    for (let x = 0; x < p.w; x++) if (!src[y * p.w + x] && (at(x - 1, y) || at(x + 1, y) || at(x, y - 1) || at(x, y + 1))) p.set(x, y, col);
}

/** 활엽수: 돔 모양으로 덩어리 배치 — 뒤(위) 먼저, 앞(아래) 나중 */
function broadleaf(p: Px, v: number, g: Ramp, bark: Ramp, birch: boolean, fruit: string | null) {
  const W = p.w, H = p.h;
  const cx = W / 2 + Math.round((rnd(v, 1) - 0.5) * 4);
  const base = H - 3;
  const canopyBottom = base - (birch ? 46 : 40);
  const R = (birch ? 24 : 28) + Math.floor(rnd(v, 11) * 7); // 돔 반지름 (변형마다 다르게)
  const domeCy = canopyBottom - R * 0.75;
  trunk(p, Math.round(cx), base, canopyBottom - 14, birch ? 4 : 6, bark, v, birch);
  // 가지 두 개가 잎 속으로
  for (const s of [-1, 1]) for (let k = 0; k < 12; k++) { const x = Math.round(cx + s * (3 + k * 0.9)); const y = canopyBottom - 6 - k; p.set(x, y, bark[3]); p.set(x, y + 1, bark[4]); }
  const cl: [number, number, number][] = [];
  const n = (birch ? 7 : 9) + Math.floor(rnd(v, 12) * 5);
  for (let i = 0; i < n; i++) {
    const a = Math.PI * (1.05 + (i / (n - 1)) * 0.9) + (rnd(v, i, 3) - 0.5) * 0.35; // 위쪽 반원 둘레
    const rr = R * (0.55 + rnd(v, i, 4) * 0.35);
    cl.push([cx + Math.cos(a) * rr * (0.8 + rnd(v, i, 13) * 0.3), domeCy + Math.sin(a) * rr * (0.6 + rnd(i, v, 14) * 0.25), R * (0.36 + rnd(i, v, 5) * 0.26)]);
  }
  for (let i = 0; i < 5; i++) cl.push([cx + (i - 2) * R * 0.38 + (rnd(v, i, 6) - 0.5) * 6, domeCy + R * 0.32 + (rnd(v, i, 7) - 0.5) * 6, R * (0.4 + rnd(i, v, 8) * 0.12)]); // 앞 아래 줄
  cl.push([cx, domeCy - 2, R * 0.55]);
  cl.sort((a, b) => a[1] - b[1]); // 뒤(위) → 앞(아래)
  domeTop = Math.min(...cl.map(([, y, r]) => y - r));
  domeBottom = Math.max(...cl.map(([, y, r]) => y + r * 0.86));
  // 뒤쪽 덩어리는 한 단 어둡게 (깊이)
  cl.forEach(([x, y, r], i) => cluster(p, Math.round(x), Math.round(y), Math.round(r), g, v * 13 + i, i < cl.length * 0.35 ? 1 : 0));
  // 잎 아래 그늘이 줄기에 드리움
  for (let y = canopyBottom - 2; y < canopyBottom + 6; y++) for (let x = -6; x <= 6; x++) {
    if (p.d[y * W + Math.round(cx + x)] >>> 24 === 255) p.set(Math.round(cx + x), y, "#1a120c55");
  }
  if (fruit) for (let i = 0; i < 9; i++) {
    const [x, y, r] = cl[cl.length - 1 - (i % cl.length)];
    const fx = Math.round(x + (rnd(v, i, 9) - 0.5) * r), fy = Math.round(y + (rnd(i, v, 10) - 0.2) * r * 0.8);
    p.rect(fx, fy, 3, 3, fruit); p.set(fx, fy, "#ffd0c8"); p.set(fx + 2, fy + 2, "#7a1d1d");
  }
  outline(p, birch ? "#2c4a1c" : "#22401a");
}

/** 가문비: 아래로 갈수록 넓은 가지 층 6개, 끝이 처진 톱니 · 층마다 위 밝고 아래 짙은 그늘 */
function spruce(p: Px, v: number) {
  const W = p.w, H = p.h;
  const cx = Math.round(W / 2 + (rnd(v, 1) - 0.5) * 3);
  const base = H - 3;
  trunk(p, cx, base, base - 26, 4, BARK, v);
  const top = 6 + Math.floor(rnd(v, 2) * 6);
  const bottom = base - 12;
  const tiers = 6;
  for (let t = 0; t < tiers; t++) {
    const y0 = top + ((bottom - top) * t) / tiers - 2;
    const y1 = top + ((bottom - top) * (t + 1)) / tiers + 6;
    const half = 8 + ((W / 2 - 6) - 8) * ((t + 1) / tiers);
    for (let y = Math.floor(y0); y <= y1; y++) {
      const k = (y - y0) / (y1 - y0);
      const hw = 3 + (half - 3) * k;
      for (let x = Math.round(-hw); x <= hw; x++) {
        const sag = Math.abs(x) / hw;
        const tooth = (Math.abs(x) + t * 3) % 6 < 3 ? 2 : 0; // 처진 가지 끝 톱니
        if (k > 0.82 && sag > 0.25 && y > y1 - tooth - 1) continue;
        let l = -(x / hw) * 0.5 - (k - 0.45) * 1.2 + (rnd(Math.floor((x + 50) / 2), y, v) - 0.5) * 0.5;
        if ((x + y) % 3 === 0) l -= 0.15; // 바늘 결
        const i = l > 0.55 ? 0 : l > 0.25 ? 1 : l > -0.05 ? 2 : l > -0.35 ? 3 : l > -0.65 ? 4 : 5;
        p.set(cx + x, y, PINE[i]);
      }
    }
  }
  outline(p, "#10291f");
}

const cache = new Map<string, HTMLCanvasElement>();

/** 나무 오브젝트 그림 (world.ts HD_OBJECTS.tree) — 캔버스 (w+12)×2 by (h+8)×2 */
export function treeFrames(o: TiledObject): HTMLCanvasElement[] {
  const W = (o.width + 12) * 2;
  const H = (o.height + 8) * 2;
  const r = rnd(Math.floor(o.x), Math.floor(o.y), 7);
  const v = Math.floor(r * 6);
  const kind = biome === "highland" ? (r < 0.8 ? "spruce" : "birch")
    : biome === "dungeon" ? "old"
    : biome === "field" ? (r < 0.15 ? "birch" : r < 0.3 ? "apple" : "oak")
    : r < 0.2 ? "oak2" : "oak";
  const key = `${kind}:${v}:${W}x${H}`;
  let c = cache.get(key);
  if (!c) {
    const p = new Px(W, H);
    if (kind === "spruce") spruce(p, v);
    else if (kind === "birch") broadleaf(p, v, BIRCH, BIRCH_BARK, true, null);
    else if (kind === "old") broadleaf(p, v, OLD, ["#9a8a6a", "#7a6a4e", "#5e503b", "#463b2c", "#30281e", "#1e1913"], false, null);
    else broadleaf(p, v, kind === "oak2" ? OAK2 : OAK, BARK, false, kind === "apple" ? "#d8343b" : null);
    c = p.toCanvas();
    cache.set(key, c);
  }
  return [c];
}
