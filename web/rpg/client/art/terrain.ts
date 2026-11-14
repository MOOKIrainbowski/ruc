import { Px } from "./px";

/**
 * 지형 타일 2배 그림 (32×32, 2026-11-14 피드백 2차 "픽셀을 더 많이 · 사실적으로 · 시점을 낮게").
 * 모든 타일은 이음매 없이 이어지도록 좌표를 32 로 감쌈(wrap). 광원 왼쪽 위, 시점 3/4(약 55°) —
 * 돌 · 벽돌은 윗면 + 앞면 두께(아래 2px 어두운 면)가 보이게 그려 "위에서 비스듬히 본" 느낌을 줌.
 * 변형(v 0~7): 정적 타일은 무늬 변형, 물은 애니메이션 프레임, 산울타리는 0~3 윗면 · 4~7 앞면 포함(남쪽이 트인 칸).
 */

const S = 32;
type Ramp = readonly [string, string, string, string, string, string]; // 하이라이트 → 깊은 그늘

const GRASS: Ramp = ["#d2ef7a", "#a9d957", "#8cc63f", "#74ad35", "#5a922b", "#41721f"];
const GRASS_D: Ramp = ["#b6dd62", "#8dc443", "#74ad35", "#5f962d", "#4a7c25", "#35601b"];
const DIRT: Ramp = ["#dcb889", "#c39a6b", "#a98055", "#8d6844", "#6f5034", "#503826"];
const SAND: Ramp = ["#fcf3dc", "#f1e2c0", "#e4cfa6", "#d0b78a", "#b59c70", "#8e7853"];
const COB: Ramp = ["#f0e6cf", "#ddcfb1", "#c6b693", "#ab9a78", "#8a7b60", "#665a46"];
const FLAG: Ramp = ["#ece3d0", "#d6cab3", "#bfb29b", "#a39580", "#857864", "#62584a"];
const WATER: Ramp = ["#effcff", "#b4ebfb", "#74d2f3", "#4db4e4", "#3391c9", "#22679e"];
const WOOD: Ramp = ["#f0c28a", "#d9a46c", "#bb8452", "#9b693f", "#7a5030", "#563620"];
const LEAF: Ramp = ["#b9e76e", "#8bcb4f", "#66ad3a", "#4c8f2f", "#386f25", "#24501a"];

const wrap = (n: number) => ((n % S) + S) % S;
/** 잘 섞이는 해시 (px.ts hash 는 연속된 정수에서 대각선 무늬가 생김) → 0..1 */
function hash(a: number, b: number, c = 0) {
  let h = (Math.imul(a | 0, 0x27d4eb2d) ^ Math.imul(b | 0, 0x165667b1) ^ Math.imul(c | 0, 0x9e3779b9)) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
const put = (p: Px, x: number, y: number, c: string) => p.set(wrap(x), wrap(y), c);

/** 감싸지는 값 노이즈 (셀 크기 cell, 0..1) */
function vnoise(x: number, y: number, cell: number, seed: number) {
  const n = S / cell;
  const gx = x / cell;
  const gy = y / cell;
  const x0 = Math.floor(gx);
  const y0 = Math.floor(gy);
  const fx = gx - x0;
  const fy = gy - y0;
  const h = (i: number, j: number) => hash(((i % n) + n) % n, ((j % n) + n) % n, seed);
  const sm = (t: number) => t * t * (3 - 2 * t);
  const a = h(x0, y0), b = h(x0 + 1, y0), c = h(x0, y0 + 1), d = h(x0 + 1, y0 + 1);
  return (a + (b - a) * sm(fx)) * (1 - sm(fy)) + (c + (d - c) * sm(fx)) * sm(fy);
}

/** 바탕: 두 겹 노이즈로 램프 1~4 단을 고르고, 4×4 베이어 디더로 단 사이를 부드럽게 */
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map((v) => (v + 0.5) / 16);
function base(p: Px, r: Ramp, seed: number, lo = 1, hi = 4, contrast = 1) {
  for (let y = 0; y < S; y++)
    for (let x = 0; x < S; x++) {
      const n = (vnoise(x, y, 16, seed) * 0.6 + vnoise(x, y, 8, seed + 1) * 0.3 + vnoise(x, y, 4, seed + 2) * 0.1 - 0.5) * contrast + 0.5;
      const t = lo + (1 - Math.max(0, Math.min(1, n))) * (hi - lo);
      const i = Math.floor(t + (BAYER[(y % 4) * 4 + (x % 4)] - 0.5) * 0.9);
      p.set(x, y, r[Math.max(lo, Math.min(hi, Math.round(i)))]);
    }
}

/** 풀잎 한 가닥: 뿌리 쪽 그늘 → 끝 밝게, 살짝 기울어짐 */
function blade(p: Px, x: number, y: number, h: number, lean: number, r: Ramp) {
  for (let i = 0; i < h; i++) {
    const c = i === h - 1 ? r[0] : i >= h - 2 ? r[1] : i === 0 ? r[4] : r[3 - Math.min(1, Math.floor((i * 2) / h))];
    put(p, x + Math.round((lean * i) / h), y - i, c);
  }
  put(p, x + 1, y, r[5]); // 뿌리 그늘 (AO)
}

function grass(v: number, r: Ramp, seed: number): Px {
  const p = new Px(S, S);
  base(p, r, seed, 1, 4);
  const H = (i: number, s: number) => hash(i, v, seed * 31 + s);
  const n = 70;
  for (let i = 0; i < n; i++) blade(p, Math.floor(H(i, 1) * S), Math.floor(H(i, 2) * S), 3 + Math.floor(H(i, 3) * 4), Math.round((H(i, 4) - 0.5) * 2.4), r);
  // 풀 뭉치 (짙은 덩어리 + 빛나는 끝)
  for (let k = 0; k < 2; k++) {
    const cx = Math.floor(H(k, 9) * S);
    const cy = Math.floor(H(k, 10) * S);
    for (let j = 0; j < 7; j++) blade(p, cx + j - 3, cy + (j % 2), 5 + (j % 3), j - 3, r);
  }
  if (r === GRASS && v === 3) for (const [x, y] of [[8, 12], [11, 14], [22, 24]]) flower(p, x, y, "#ffffff", "#fff2a0");
  if (r === GRASS && v === 6) for (const [x, y] of [[6, 24], [24, 8]]) flower(p, x, y, "#ffe14d", "#fff8c8");
  if (v === 1) for (let k = 0; k < 5; k++) clover(p, 14 + Math.floor(H(k, 12) * 10), 14 + Math.floor(H(k, 13) * 10), r);
  return p;
}

/** 작은 꽃: 십자 꽃잎 + 가운데 + 줄기 */
function flower(p: Px, x: number, y: number, petal: string, mid: string) {
  put(p, x, y + 1, "#4f8a2b");
  put(p, x, y + 2, "#3f7222");
  for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) put(p, x + dx, y + dy, petal);
  put(p, x, y, mid);
  put(p, x + 1, y + 1, "#00000022");
}

function clover(p: Px, x: number, y: number, r: Ramp) {
  for (const [dx, dy] of [[0, 0], [1, 0], [0, 1], [1, 1], [-1, 1], [2, 1], [0, 2], [1, 2]]) put(p, x + dx, y + dy, dy === 0 ? r[1] : r[2]);
  put(p, x, y + 3, r[4]);
}

/** 3/4 시점 돌: 윗면(왼쪽 위 밝게) + 아래 2px 앞면(어둡게) + 바닥 AO */
function pebble(p: Px, cx: number, cy: number, rx: number, ry: number, r: Ramp) {
  for (let y = -ry; y <= ry + 2; y++)
    for (let x = -rx; x <= rx; x++) {
      const top = (x * x) / (rx * rx + 0.5) + (y * y) / (ry * ry + 0.5) <= 1;
      const front = !top && y > 0 && (x * x) / (rx * rx + 0.5) + ((y - 2) * (y - 2)) / (ry * ry + 0.5) <= 1;
      if (top) {
        const l = -(x / (rx + 0.5)) * 0.6 - (y / (ry + 0.5)) * 0.8;
        put(p, cx + x, cy + y, l > 0.55 ? r[0] : l > 0.1 ? r[1] : l > -0.4 ? r[2] : r[3]);
      } else if (front) put(p, cx + x, cy + y, y > ry + 1 ? r[5] : r[4]);
    }
}

function dirt(v: number): Px {
  const p = new Px(S, S);
  base(p, DIRT, 3, 1, 4, 1.2);
  const H = (i: number, s: number) => hash(i, v, 300 + s);
  for (let i = 0; i < 9; i++) pebble(p, Math.floor(H(i, 1) * S), Math.floor(H(i, 2) * S), 1 + Math.floor(H(i, 3) * 2), 1, i % 3 ? DIRT : COB);
  for (let i = 0; i < 26; i++) put(p, Math.floor(H(i, 5) * S), Math.floor(H(i, 6) * S), i % 2 ? DIRT[0] : DIRT[5]); // 모래알
  if (v % 3 === 0) { // 마른 금
    let x = Math.floor(H(0, 7) * S);
    let y = Math.floor(H(0, 8) * S);
    for (let k = 0; k < 7; k++) { put(p, x, y, DIRT[4]); x += 1; y += hash(k, v, 9) > 0.5 ? 1 : 0; }
  }
  return p;
}

/** 사암 벽돌 포장 (광장): 줄 높이 8 = 윗면 6 + 앞면 2, 엇갈림 쌓기 */
function sand(v: number): Px {
  const p = new Px(S, S);
  const off = (v % 4) * 4;
  for (let row = 0; row < 4; row++) {
    const y0 = row * 8;
    const sx = off + (row % 2) * 8;
    for (let k = -1; k < 2; k++) {
      const x0 = sx + k * 16;
      const tone = hash(wrap(x0) + row * 7, v, 41);
      const r: Ramp = tone > 0.66 ? SAND : tone > 0.33 ? ["#fbf0d6", "#ede0be", "#dfcaa0", "#cab285", "#b0976b", "#8a7450"] : ["#f8eccf", "#e9d8b2", "#d8c296", "#c4aa7e", "#a98f65", "#86704d"];
      for (let x = 1; x < 16; x++) {
        for (let y = 0; y < 6; y++) {
          const n = vnoise(wrap(x0 + x), y0 + y, 4, 50 + row) - 0.5;
          put(p, x0 + x, y0 + y, y === 0 || x === 1 ? r[1] : n > 0.22 ? r[1] : n < -0.25 ? r[3] : r[2]);
        }
        put(p, x0 + x, y0 + 6, r[4]); // 앞면
        put(p, x0 + x, y0 + 7, r[5]);
      }
      put(p, x0 + 1, y0, r[0]);
      put(p, x0 + 2, y0, r[0]);
      put(p, x0, y0 + 6, SAND[5]);
      for (let y = 0; y < 8; y++) put(p, x0, y0 + y, "#9a8461"); // 세로 줄눈
      if (tone > 0.8) { put(p, x0 + 5, y0 + 3, r[3]); put(p, x0 + 6, y0 + 3, r[4]); } // 이 빠진 자국
      if (tone < 0.15) { put(p, x0 + 10, y0 + 2, r[0]); put(p, x0 + 11, y0 + 2, r[0]); }
    }
  }
  return p;
}

/** 감싸지는 보로노이 돌바닥: 셀마다 돌 하나 (윗면 밝게 · 아래쪽 앞면 · 줄눈) */
function stones(v: number, r: Ramp, cell: number, mortar: string, seed: number, moss = false): Px {
  const p = new Px(S, S);
  const n = S / cell;
  const pts: [number, number, number][] = [];
  for (let j = 0; j < n; j++)
    for (let i = 0; i < n; i++) pts.push([i * cell + cell * (0.25 + hash(i, j + v * 9, seed) * 0.5), j * cell + cell * (0.25 + hash(j, i + v * 9, seed + 1) * 0.5), hash(i, j, seed + v)]);
  for (let y = 0; y < S; y++)
    for (let x = 0; x < S; x++) {
      let d1 = 1e9, d2 = 1e9, best = pts[0];
      for (const q of pts)
        for (const [ox, oy] of [[0, 0], [S, 0], [-S, 0], [0, S], [0, -S], [S, S], [-S, -S], [S, -S], [-S, S]]) {
          const dx = x - (q[0] + ox);
          const dy = (y - (q[1] + oy)) * 1.25; // 3/4 시점: 세로로 납작
          const d = dx * dx + dy * dy;
          if (d < d1) { d2 = d1; d1 = d; best = q; } else if (d < d2) d2 = d;
        }
      const edge = Math.sqrt(d2) - Math.sqrt(d1);
      if (edge < 1.3) { p.set(x, y, mortar); continue; }
      const dx = x - best[0];
      const dy = y - best[1];
      // 줄눈 바로 위(돌 아래쪽 가장자리) = 앞면, 위쪽 가장자리 = 빛
      const below = edge < 3 && dy > 0;
      const above = edge < 2.6 && dy < 0;
      const l = -(dx * 0.5 + dy * 0.8) / cell + (best[2] - 0.5) * 0.6;
      let c = l > 0.35 ? r[1] : l > -0.05 ? r[2] : r[3];
      if (above) c = r[0];
      if (below) c = edge < 2 ? r[5] : r[4];
      p.set(x, y, c);
      if (moss && best[2] > 0.82 && edge < 3.5 && dy > 0) p.set(x, y, edge < 2.2 ? "#5d7a3a" : "#7f9a52");
    }
  return p;
}

function water(v: number): Px {
  const p = new Px(S, S);
  const ph = (v / 8) * Math.PI * 2;
  for (let y = 0; y < S; y++)
    for (let x = 0; x < S; x++) {
      const a = (x / S) * Math.PI * 2;
      const b = (y / S) * Math.PI * 2;
      const w = Math.sin(a * 2 + b * 3 + ph) * 0.45 + Math.sin(a * 3 - b * 2 - ph * 2) * 0.35 + Math.sin(a + b * 4 + ph) * 0.2;
      const deep = vnoise(x, y, 16, 77);
      const t = 2.6 - w * 1.1 + deep * 1.4;
      const i = Math.max(1, Math.min(5, Math.round(t + (BAYER[(y % 4) * 4 + (x % 4)] - 0.5) * 0.8)));
      p.set(x, y, WATER[i]);
      // 물결 마루 하이라이트 (가로로 긴 빛 줄)
      if (w > 0.78 && (x + y + v) % 3 !== 0) p.set(x, y, WATER[1]);
    }
  for (let i = 0; i < 4; i++) { // 반짝임
    const x = Math.floor(hash(i, 5, 81) * 28);
    const y = Math.floor(hash(i, 6, 81) * 28);
    if ((v + i * 3) % 8 < 2) { p.set(x, y, WATER[0]); p.set(x + 1, y, WATER[0]); p.set(x - 1, y, WATER[1]); p.set(x + 2, y, WATER[1]); }
  }
  return p;
}

function bridge(v: number): Px {
  const p = new Px(S, S);
  for (let row = 0; row < 4; row++) {
    const y0 = row * 8;
    const tone = hash(row, v, 51);
    for (let x = 0; x < S; x++) {
      for (let y = 0; y < 6; y++) {
        const grain = Math.sin(x * 0.7 + y * 2.3 + tone * 9) > 0.75;
        p.set(x, y0 + y, y === 0 ? WOOD[0] : grain ? WOOD[3] : tone > 0.5 ? WOOD[1] : WOOD[2]);
      }
      p.set(x, y0 + 6, WOOD[4]); // 판자 앞면
      p.set(x, y0 + 7, "#2e1d14"); // 틈 (아래 물이 어둡게)
    }
    for (const nx of [2, 29]) { p.set(nx, y0 + 2, "#4a3324"); p.set(nx, y0 + 1, "#cfd6de"); } // 못
    if (tone > 0.6) for (let x = 10; x < 14; x++) p.set(x + row, y0 + 3, WOOD[4]); // 옹이
  }
  return p;
}

function flowers(v: number): Px {
  const p = grass(v, GRASS, 4);
  const cols: [string, string][] = [["#ff6b6b", "#ffd0d0"], ["#ffd166", "#fff4c0"], ["#ffffff", "#fff2a0"], ["#ff9ec0", "#ffe0ec"], ["#b39ddb", "#ece0ff"]];
  for (let i = 0; i < 9; i++) {
    const x = 2 + Math.floor(hash(i, v, 61) * 28);
    const y = 2 + Math.floor(hash(v, i, 62) * 26);
    const [c, hi] = cols[(i + v) % cols.length];
    // 줄기 + 잎
    for (let k = 1; k <= 4; k++) put(p, x, y + k, k > 2 ? "#3f7222" : "#4f8a2b");
    put(p, x + 1, y + 3, "#5c9a33");
    // 꽃잎 다섯 장 (3/4 시점이라 세로로 납작)
    for (const [dx, dy] of [[-2, 0], [2, 0], [-1, -1], [1, -1], [0, -1], [-1, 1], [1, 1], [-1, 0], [1, 0]]) put(p, x + dx, y + dy, dy < 0 ? hi : c);
    put(p, x, y, "#ffcf3a");
    put(p, x + 2, y + 1, "#00000026");
  }
  return p;
}

/** 산울타리: 잎 덩어리를 빽빽하게 · front = 남쪽이 트인 칸 (아래 12px 이 잎 벽 앞면) */
function hedge(v: number, front: boolean): Px {
  const p = new Px(S, S);
  const topH = front ? 20 : S;
  p.rect(0, 0, S, S, LEAF[5]);
  const H = (i: number, s: number) => hash(i, v % 4, 70 + s);
  for (let i = 0; i < 46; i++) {
    const cx = Math.floor(H(i, 1) * S);
    const cy = Math.floor(H(i, 2) * (topH + 2)) - 1;
    const rr = 2 + Math.floor(H(i, 3) * 3);
    for (let y = -rr; y <= rr; y++)
      for (let x = -rr; x <= rr; x++) {
        if (x * x + y * y > rr * rr + 1) continue;
        if (front && cy + y >= topH) continue;
        const l = -(x * 0.6 + y * 0.8) / rr;
        put(p, cx + x, cy + y, l > 0.6 ? LEAF[0] : l > 0.15 ? LEAF[1] : l > -0.35 ? LEAF[2] : LEAF[3]);
      }
  }
  if (front) {
    // 앞면: 그늘진 잎 벽 (위 빛 테두리 → 아래로 어두워짐 · 맨 아래 흙 그림자)
    for (let y = topH; y < S; y++)
      for (let x = 0; x < S; x++) {
        const k = (y - topH) / (S - topH);
        const leaf = hash(Math.floor(x / 3), Math.floor((y + (x % 3)) / 3) + v * 7, 79); // 3px 잎 조각
        const c = leaf > 0.75 - k * 0.3 ? LEAF[2 + Math.min(2, Math.floor(k * 3))] : LEAF[3 + Math.min(2, Math.floor(k * 2.5))];
        p.set(x, y, (x + y) % 3 === 0 && leaf > 0.5 ? LEAF[Math.min(5, 4 + Math.floor(k * 2))] : c);
      }
    // 윗면 가장자리 잎이 앞으로 늘어짐
    for (let x = 0; x < S; x++) { const d = 1 + Math.floor(hash(x, v, 77) * 3); for (let y = 0; y < d; y++) p.set(x, topH + y, y === d - 1 ? LEAF[3] : LEAF[2]); }
    p.rect(0, S - 2, S, 1, LEAF[5]);
    p.rect(0, S - 1, S, 1, "#22301a");
  }
  return p;
}

/** world.ts tileAtlas 가 쓰는 2배 타일. hedge 는 v 4~7 이 앞면 포함 */
export const TERRAIN: Record<string, (v: number) => Px> = {
  grass: (v) => grass(v, GRASS, 1),
  grass_dark: (v) => grass(v, GRASS_D, 2),
  dirt,
  sand,
  cobble: (v) => stones(v, COB, 8, "#6b5d48", 9),
  stone_edge: (v) => stones(v, FLAG, 16, "#5d5446", 17, true),
  water,
  bridge,
  flowers,
  hedge: (v) => hedge(v, v >= 4),
};

// ── 언덕 (2026-11-14 피드백 2차): 절벽 앞면 · 계단 — game.ts bakeGround 가 height 레이어를 보고 칸마다 그림 ──
const ROCK: Ramp = ["#e8d9b8", "#c8b38e", "#a58f6d", "#826e53", "#5f4f3d", "#3a2f25"];

/**
 * 절벽 앞면 한 칸 (32×32). 앞면은 위아래 2칸 — row 0 = 위(풀 가장자리가 걸쳐 늘어짐), row 1 = 아래(바닥 그늘 · 자갈).
 * tx = 칸 x (옆 칸과 지층 무늬가 이어지게), l · r = 왼쪽 · 오른쪽 끝(절벽 모서리), lv = 층(2층은 조금 더 밝고 차가운 돌).
 */
export function cliff(tx: number, row: number, l: boolean, r: boolean, lv: number): Px {
  const p = new Px(S, S);
  const rk: Ramp = lv > 1 ? ["#e9e2cc", "#cbc0a2", "#a99d80", "#877b62", "#655b48", "#3f382d"] : ROCK;
  // 바위 덩어리 (가로로 넓은 보로노이, 칸을 넘어 이어짐): 덩어리마다 윗면에 빛 · 아래 틈은 깊은 그늘
  const C = 12;
  for (let y = 0; y < S; y++)
    for (let x = 0; x < S; x++) {
      const ax = tx * S + x;
      const ay = row * S + y; // 앞면 위 끝부터 0..63
      let d1 = 1e9, d2 = 1e9, bx = 0, by = 0, bs = 0;
      const gx = Math.floor(ax / C), gy = Math.floor(ay / (C * 0.75));
      for (let j = gy - 1; j <= gy + 1; j++)
        for (let i = gx - 1; i <= gx + 1; i++) {
          const qx = (i + 0.2 + hash(i, j, 41 + lv) * 0.6) * C;
          const qy = (j + 0.2 + hash(j, i, 42 + lv) * 0.6) * C * 0.75;
          const dx = ax - qx, dy = (ay - qy) * 1.35;
          const d = dx * dx + dy * dy;
          if (d < d1) { d2 = d1; d1 = d; bx = qx; by = qy; bs = hash(i, j, 43); } else if (d < d2) d2 = d;
        }
      const edge = Math.sqrt(d2) - Math.sqrt(d1);
      const dx = (ax - bx) / C, dy = (ay - by) / C;
      let i = edge < 1.2 ? 5 : edge < 2.4 && dy < 0 ? 1 : edge < 2.2 && dy > 0 ? 4 : -(dx * 0.5 + dy * 0.9) + (bs - 0.5) * 0.5 > 0.25 ? 1 : -(dx * 0.5 + dy * 0.9) > -0.2 ? 2 : 3;
      if (edge < 2.4 && dy < 0 && edge >= 1.2 && bs > 0.6) i = 0;
      if (i < 5) i += ay > 44 ? 1 : 0; // 아래쪽은 그늘
      if (i === 2 && (ax * 7 + ay * 3) % 11 === 0) i = 3; // 돌 결
      p.set(x, y, rk[Math.max(0, Math.min(5, i))]);
    }
  if (row === 0) {
    // 위 가장자리: 풀이 절벽 위로 걸쳐 늘어짐 (1~6px)
    for (let x = 0; x < S; x++) {
      const ax = tx * S + x;
      const d = 2 + Math.floor(hash(ax, 7, 31) * 3) + (hash(Math.floor(ax / 3), 9, 32) > 0.7 ? 3 : 0);
      for (let y = 0; y < d; y++) p.set(x, y, y === d - 1 ? GRASS[4] : y === 0 ? GRASS[1] : GRASS[2 + (y % 2)]);
      p.set(x, d, rk[5]); // 풀 아래 그늘
    }
    // 이끼 · 덩굴
    for (let k = 0; k < 3; k++) {
      const x = Math.floor(hash(tx, k, 33) * 28);
      const len = 4 + Math.floor(hash(k, tx, 34) * 9);
      for (let y = 4; y < 4 + len; y++) { p.set(x + ((y >> 2) % 2), y, y % 3 ? "#5d8a34" : "#7fae45"); }
    }
  } else {
    // 아래: 바닥과 닿는 곳 그늘 + 굴러 떨어진 자갈
    for (let y = S - 4; y < S; y++) for (let x = 0; x < S; x++) p.set(x, y, y >= S - 2 ? "#2e2822" : rk[5]);
    for (let k = 0; k < 3; k++) pebble(p, 3 + Math.floor(hash(tx, k, 35) * 26), S - 3, 2, 1, rk);
  }
  // 모서리: 끝은 둥글게 어두워짐 (옆면이 살짝 보임)
  const edge = (side: number) => {
    for (let y = 0; y < S; y++) for (let k = 0; k < 4; k++) {
      const x = side ? S - 1 - k : k;
      p.set(x, y, k === 0 ? rk[5] : k === 1 ? rk[4] : p.d[y * S + x] ? rk[3] : rk[3]);
    }
  };
  if (l) edge(0);
  if (r) edge(1);
  return p;
}

/** 돌계단 한 칸 (32×32): 8px 마다 디딤판(밝게) + 챌판(어둡게). top = 맨 위 칸(위쪽 반은 풀로 이어짐), l · r = 옆 벽 */
export function steps(v: number, top: boolean, l: boolean, r: boolean): Px {
  const p = new Px(S, S);
  for (let y = 0; y < S; y++)
    for (let x = 0; x < S; x++) {
      const s = y % 8;
      const n = hash(x >> 2, (y >> 3) + v * 5, 61);
      p.set(x, y, s < 4 ? (s === 0 ? COB[0] : n > 0.7 ? COB[2] : COB[1]) : s === 7 ? COB[5] : COB[3 + (n > 0.6 ? 1 : 0)]);
    }
  if (top) for (let y = 0; y < 12; y++) for (let x = 0; x < S; x++) if (y < 10 - (hash(x, v, 62) > 0.5 ? 2 : 0)) p.set(x, y, GRASS[2 + ((x + y) % 3 === 0 ? 1 : 0)]);
  const wall = (side: number) => {
    for (let y = 0; y < S; y++) for (let k = 0; k < 5; k++) p.set(side ? S - 1 - k : k, y, k === 4 ? ROCK[5] : k === 0 ? ROCK[1] : ROCK[2 + ((y >> 2) % 2)]);
  };
  if (l) wall(0);
  if (r) wall(1);
  return p;
}
