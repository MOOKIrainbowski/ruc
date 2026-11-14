import type { TiledObject } from "../../shared/map";
import { Px } from "./px";

/**
 * 건물 · 천막 · 우물 · 바위 · 덤불 · 그루터기 · 돌기둥 · 석상 2배 그림 (2026-11-14 피드백 2차).
 * 3/4 시점(위에서 약 55°): 정면 벽은 넓게, 지붕 · 윗면은 위에서 비스듬히 보이는 경사면으로. 광원 왼쪽 위.
 * 건물 = 유럽 중세 반목조(하프팀버) 주택: 돌 기초 · 흰 회벽 + 짙은 나무 골조(X 가새) · 테라코타 기와 · 굴뚝 · 덧창 창 · 꽃 상자 · 아치 문.
 * 캔버스 = (width + 12)·2 × (height + 8)·2, 발밑 가운데 아래 = 오브젝트 좌표. 그림 안 좌표는 2배 px (OX = 왼쪽 여백 12, OY = 위 여백 16).
 */

type Ramp = readonly [string, string, string, string, string, string];
const PLASTER: Ramp = ["#fffaf0", "#f6ecd8", "#eadcc0", "#d3c19f", "#b09c7a", "#7d6c52"];
const TIMBER: Ramp = ["#9a6a44", "#7b5134", "#623f29", "#4c3020", "#382318", "#251710"];
const ROOF: Ramp = ["#f2a27c", "#de7f55", "#c8643b", "#a64c2d", "#7f3822", "#552517"];
const STONE: Ramp = ["#e6dfd2", "#cbc2b2", "#ada391", "#8c8372", "#6a6356", "#47423a"];
const GLASS: Ramp = ["#fbfdff", "#d6eef8", "#a9d6ea", "#79b4d0", "#4f86a8", "#2f5672"];
const WOOD: Ramp = ["#e7b47c", "#cc9358", "#a87440", "#855a31", "#5f4024", "#3d2918"];
const OUT = "#2a1d18";

const OX = 12;
const OY = 16;

function rnd(a: number, b: number, c = 0) {
  let h = (Math.imul(a | 0, 0x27d4eb2d) ^ Math.imul(b | 0, 0x165667b1) ^ Math.imul(c | 0, 0x9e3779b9)) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** 명암 사각형: 왼쪽 · 위 밝은 테, 오른쪽 · 아래 그늘 테 */
function bevel(p: Px, x: number, y: number, w: number, h: number, r: Ramp, base = 2) {
  p.rect(x, y, w, h, r[base]);
  p.rect(x, y, w, 1, r[base - 1]);
  p.rect(x, y, 1, h, r[base - 1]);
  p.rect(x + w - 1, y, 1, h, r[base + 1]);
  p.rect(x, y + h - 1, w, 1, r[base + 2]);
}

function outline(p: Px, col = OUT) {
  const src = p.d.slice();
  const at = (x: number, y: number) => x >= 0 && y >= 0 && x < p.w && y < p.h && src[y * p.w + x] >>> 24 > 0x80;
  for (let y = 0; y < p.h; y++) for (let x = 0; x < p.w; x++) if (!src[y * p.w + x] && (at(x - 1, y) || at(x + 1, y) || at(x, y - 1) || at(x, y + 1))) p.set(x, y, col);
}

/** 창: 나무 테 · 십자 창살 · 유리 반사 · 양쪽 덧창 · 아래 꽃 상자 */
function windowAt(p: Px, x: number, y: number, w: number, h: number, seed: number) {
  bevel(p, x - 5, y, 5, h, ["#7fae5a", "#5f9142", "#4a7a33", "#38602a", "#284620", "#1a3015"], 2); // 덧창 (초록)
  bevel(p, x + w, y, 5, h, ["#7fae5a", "#5f9142", "#4a7a33", "#38602a", "#284620", "#1a3015"], 2);
  for (let k = 1; k < h; k += 3) { p.rect(x - 4, y + k, 3, 1, "#38602a"); p.rect(x + w + 1, y + k, 3, 1, "#38602a"); }
  p.rect(x - 1, y - 1, w + 2, h + 2, TIMBER[3]);
  for (let yy = 0; yy < h; yy++) for (let xx = 0; xx < w; xx++) {
    const refl = xx + yy * 0.6 < w * 0.45 && xx + yy * 0.6 > w * 0.2;
    p.set(x + xx, y + yy, refl ? GLASS[0] : yy < h * 0.3 ? GLASS[2] : GLASS[3]);
  }
  p.rect(x + Math.floor(w / 2), y, 1, h, TIMBER[2]);
  p.rect(x, y + Math.floor(h / 2), w, 1, TIMBER[2]);
  p.rect(x - 1, y + h + 1, w + 2, 2, STONE[1]); // 창턱
  // 꽃 상자
  bevel(p, x - 2, y + h + 3, w + 4, 4, WOOD, 2);
  for (let k = 0; k < w + 2; k += 2) {
    const c = ["#ff6b6b", "#ffd166", "#ff9ec0", "#ffffff"][(k + seed) % 4];
    p.set(x - 1 + k, y + h + 1 + (k % 4 === 0 ? 0 : 1), c);
    p.set(x + k, y + h + 2, "#4f8a2b");
  }
}

/** 반목조 주택 */
function house(o: TiledObject): Px {
  const W = (o.width + 12) * 2, H = (o.height + 8) * 2;
  const p = new Px(W, H);
  const bw = o.width * 2, bh = o.height * 2;
  const x0 = OX, y0 = OY;
  const seed = Math.floor(rnd(o.x, o.y) * 1000);
  const roofH = Math.round(bh * 0.46); // 지붕 경사면 (위에서 보임)
  const wallTop = y0 + roofH;
  const wallBot = y0 + bh - 2;
  const foundH = 10;
  // 벽 (회벽 + 미세한 얼룩)
  for (let y = wallTop; y < wallBot - foundH; y++)
    for (let x = x0 + 4; x < x0 + bw - 4; x++) {
      const n = rnd(x >> 2, y >> 2, seed);
      const left = x < x0 + 10 ? 1 : x > x0 + bw - 12 ? 3 : 2; // 왼쪽 빛 · 오른쪽 그늘
      p.set(x, y, PLASTER[n > 0.85 ? left + 1 : left]);
    }
  // 나무 골조: 테두리 기둥 · 가로 보 · 칸마다 X 가새
  const cols = Math.max(3, Math.round(bw / 40));
  const beamY = [wallTop, wallTop + Math.round((wallBot - foundH - wallTop) * 0.5), wallBot - foundH - 3];
  for (const by of beamY) { p.rect(x0 + 3, by, bw - 6, 4, TIMBER[2]); p.rect(x0 + 3, by, bw - 6, 1, TIMBER[0]); p.rect(x0 + 3, by + 3, bw - 6, 1, TIMBER[4]); }
  for (let c = 0; c <= cols; c++) {
    const x = Math.round(x0 + 4 + ((bw - 12) * c) / cols);
    p.rect(x, wallTop, 4, wallBot - foundH - wallTop, TIMBER[2]);
    p.rect(x, wallTop, 1, wallBot - foundH - wallTop, TIMBER[0]);
    p.rect(x + 3, wallTop, 1, wallBot - foundH - wallTop, TIMBER[4]);
  }
  // 위층 칸에 X 가새
  for (let c = 0; c < cols; c++) {
    if ((c + seed) % 2) continue;
    const xa = Math.round(x0 + 8 + ((bw - 12) * c) / cols), xb = Math.round(x0 + 4 + ((bw - 12) * (c + 1)) / cols);
    const ya = beamY[0] + 4, yb = beamY[1];
    for (let t = 0; t <= 1; t += 1 / Math.max(xb - xa, yb - ya)) {
      const x = Math.round(xa + (xb - xa) * t);
      p.rect(x, Math.round(ya + (yb - ya) * t), 3, 2, TIMBER[3]);
      p.rect(x, Math.round(yb - (yb - ya) * t), 3, 2, TIMBER[3]);
    }
  }
  // 돌 기초: 크기가 다른 돌을 엇갈려 쌓음
  for (let r = 0; r < 2; r++) {
    let x = x0 + 2 + (r ? 6 : 0);
    while (x < x0 + bw - 2) {
      const sw = 10 + Math.floor(rnd(x, r, seed) * 8);
      bevel(p, x, wallBot - foundH + r * 5, Math.min(sw, x0 + bw - 2 - x), 5, STONE, 2 + (rnd(x, r + 9, seed) > 0.6 ? 1 : 0));
      x += sw;
    }
  }
  p.rect(x0 + 2, wallBot, bw - 4, 2, STONE[5]);
  // 문: 아치 나무문 + 돌 문틀 + 손잡이 + 계단
  const dw = 22, dh = Math.round((wallBot - wallTop) * 0.55);
  const dx = Math.round(x0 + bw / 2 - dw / 2), dy = wallBot - dh;
  for (let y = 0; y < dh + 3; y++) for (let x = -3; x < dw + 3; x++) {
    const arch = y < 8 && (x - dw / 2) ** 2 / ((dw / 2 + 3) ** 2) + ((8 - y) ** 2) / 64 > 1;
    if (!arch) p.set(dx + x, dy - 3 + y, STONE[(x < 0 ? 1 : x >= dw ? 3 : 2)]);
  }
  for (let y = 0; y < dh; y++) for (let x = 0; x < dw; x++) {
    const arch = y < 6 && (x - dw / 2 + 0.5) ** 2 / ((dw / 2) ** 2) + ((6 - y) ** 2) / 36 > 1;
    if (arch) continue;
    const plank = x % 6 === 0;
    p.set(dx + x, dy + y, plank ? WOOD[4] : x < 3 ? WOOD[1] : WOOD[2 + (rnd(x, y >> 3, seed) > 0.8 ? 1 : 0)]);
  }
  for (const yy of [dy + 8, dy + dh - 8]) p.rect(dx + 1, yy, dw - 2, 2, "#4a4a52"); // 쇠 띠
  p.rect(dx + dw - 6, dy + Math.round(dh / 2), 2, 3, "#f2c94c");
  bevel(p, dx - 4, wallBot - 2, dw + 8, 4, STONE, 1); // 문 앞 디딤돌
  // 창: 위층 두 개 · 아래층 문 옆 두 개
  const ww = 14, wh = 16;
  const upY = beamY[0] + 10;
  for (const fx of [0.25, 0.75]) windowAt(p, Math.round(x0 + bw * fx - ww / 2), upY, ww, wh, seed);
  const lowY = beamY[1] + 9;
  for (const fx of [0.17, 0.83]) windowAt(p, Math.round(x0 + bw * fx - ww / 2), lowY, ww, wh - 2, seed + 1);
  // 지붕: 위에서 비스듬히 본 경사면 (아래로 갈수록 넓은 사다리꼴) + 기와 줄 + 처마 그늘
  const eave = 6;
  for (let y = 0; y < roofH + 4; y++) {
    const k = y / (roofH + 4);
    const inset = Math.round((1 - k) * 14);
    for (let x = x0 - eave + inset; x < x0 + bw + eave - inset; x++) {
      const row = Math.floor((y + 2) / 6);
      const off = row % 2 ? 4 : 0;
      const tileEdge = (x + off) % 8 === 0;
      const lip = (y + 2) % 6 >= 4;
      const side = x < x0 + 6 ? -1 : x > x0 + bw - 8 ? 1 : 0;
      let i = lip ? 3 : tileEdge ? 3 : 2;
      if (!lip && (y + 2) % 6 === 0) i = 1; // 기와 윗면 빛
      if (side < 0) i -= 1;
      if (side > 0) i += 1;
      if (y < 3) i = 1; // 용마루
      if (rnd(x >> 3, row, seed + 3) > 0.9 && !lip) i += 1; // 색 다른 기와
      p.set(x, y0 + y, ROOF[Math.max(0, Math.min(5, i))]);
    }
  }
  p.rect(x0 + 8, y0, bw - 16, 2, ROOF[0]); // 용마루 빛
  for (let x = x0 - eave; x < x0 + bw + eave; x++) { p.set(x, y0 + roofH + 4, ROOF[5]); p.set(x, y0 + roofH + 5, "#00000044"); } // 처마 끝 · 벽 위 그늘
  for (let x = x0 + 4; x < x0 + bw - 4; x++) for (let y = 0; y < 4; y++) p.set(x, wallTop + 4 + y, "#3a2a1a33");
  // 굴뚝 (돌, 지붕 위로)
  const cx = x0 + bw - 34;
  for (let y = 0; y < 26; y++) for (let x = 0; x < 12; x++) p.set(cx + x, y0 - 10 + y, STONE[x < 3 ? 1 : x > 9 ? 4 : (y + (x >> 2)) % 5 === 0 ? 3 : 2]);
  p.rect(cx - 1, y0 - 12, 14, 3, STONE[3]);
  p.rect(cx + 2, y0 - 12, 8, 2, "#2a2420");
  // 지붕창 (도머)
  const dxm = Math.round(x0 + bw * 0.3);
  bevel(p, dxm, y0 + roofH - 26, 18, 16, PLASTER, 2);
  for (let y = 0; y < 8; y++) for (let x = -y; x <= 18 + y; x++) p.set(dxm + x, y0 + roofH - 34 + y, ROOF[y < 2 ? 1 : 3]);
  p.rect(dxm + 4, y0 + roofH - 22, 10, 9, GLASS[3]);
  p.rect(dxm + 5, y0 + roofH - 21, 3, 4, GLASS[0]);
  outline(p);
  return p;
}

/** 시장 천막: 위에서 비스듬히 본 줄무늬 지붕(꼭대기 · 처마 물결) + 기둥 + 진열대와 물건 */
function tent(o: TiledObject): Px {
  const W = (o.width + 12) * 2, H = (o.height + 8) * 2;
  const p = new Px(W, H);
  const shop = o.type === "tent_shop";
  const [a, b] = shop ? [["#ffc08a", "#ff9f43", "#e0822a", "#b8621a"], ["#fffaf0", "#fff1d6", "#ead8b4", "#c9b48c"]] : [["#7fe0d6", "#1fb5a8", "#16968b", "#0f6f67"], ["#ffffff", "#f4fbfa", "#d8ece9", "#b0cfcb"]];
  const bw = o.width * 2;
  const x0 = OX, top = OY;
  const cx = x0 + bw / 2;
  const roofBot = top + Math.round(o.height * 2 * 0.52);
  // 기둥 · 뒤 휘장
  for (const px of [x0 + 4, x0 + bw - 8]) bevel(p, px, roofBot - 4, 4, H - roofBot - 2, WOOD, 2);
  for (let y = roofBot; y < H - 22; y++) for (let x = x0 + 8; x < x0 + bw - 8; x++) p.set(x, y, ((x - x0) >> 3) % 2 ? b[3] : a[3]);
  // 진열대 (앞)
  const ty = H - 26;
  bevel(p, x0 + 4, ty, bw - 8, 6, WOOD, 1);
  bevel(p, x0 + 6, ty + 6, bw - 12, 16, WOOD, 2);
  for (let x = x0 + 8; x < x0 + bw - 8; x += 6) p.rect(x, ty + 7, 1, 14, WOOD[4]);
  // 물건: 사과 · 병 · 천 두루마리 / 보석 · 책
  const goods = shop ? ["#e5484d", "#4cc764", "#f2c94c", "#ff9a3d"] : ["#9b5de5", "#2f7bff", "#f2c94c", "#e5484d"];
  for (let i = 0; i < Math.floor((bw - 16) / 7); i++) {
    const gx = x0 + 9 + i * 7, c = goods[i % goods.length];
    if (i % 3 === 0) { p.rect(gx, ty - 6, 4, 6, c); p.rect(gx + 1, ty - 8, 2, 2, "#d8d0c0"); p.set(gx, ty - 6, "#ffffffaa"); }
    else { p.ellipse(gx + 2, ty - 3, 3, 2, c); p.set(gx + 1, ty - 4, "#ffffffbb"); }
  }
  // 지붕: 꼭대기에서 네 귀퉁이로 내려오는 피라미드 — 3/4 시점이라 앞 경사면이 넓고 꼭대기는 위쪽
  const apexY = top + 2;
  for (let y = apexY; y <= roofBot; y++) {
    const k = (y - apexY) / (roofBot - apexY);
    const half = 6 + (bw / 2 + 6 - 6) * Math.pow(k, 0.85);
    for (let x = Math.round(cx - half); x <= cx + half; x++) {
      // 줄무늬는 꼭대기에서 퍼져 나가는 방사선
      const u = (x - cx) / Math.max(1, half);
      const stripe = Math.floor((u + 1) * 4.5) % 2;
      const r = stripe ? b : a;
      let i = u < -0.55 ? 0 : u < 0.2 ? 1 : u < 0.7 ? 2 : 3;
      if (k > 0.9) i = Math.min(3, i + 1);
      p.set(x, y, r[i]);
    }
  }
  // 처마 물결 장식
  for (let x = Math.round(cx - bw / 2 - 6); x <= cx + bw / 2 + 6; x++) {
    const seg = Math.floor((x - cx + 200) / 8) % 2;
    const d = 3 + Math.round(2 * Math.sin(((x - cx + 200) % 8) / 8 * Math.PI));
    for (let y = 0; y < d; y++) p.set(x, roofBot + 1 + y, (seg ? b : a)[y === d - 1 ? 3 : 2]);
  }
  // 꼭대기 장식 + 깃발
  p.rect(cx - 1, apexY - 10, 2, 12, WOOD[3]);
  p.ellipse(cx, apexY - 11, 2, 2, "#f2c94c");
  for (let y = 0; y < 6; y++) for (let x = 0; x < 10 - y; x++) p.set(cx + 1 + x, apexY - 9 + y, shop ? "#e5484d" : "#f2c94c");
  outline(p);
  return p;
}

/** 우물: 원통 돌담(위 타원 1:0.6) + 안쪽 어둠 · 물 + 나무 지붕 틀 + 도르래 · 두레박 */
function well(o: TiledObject): Px {
  const W = (o.width + 12) * 2, H = (o.height + 8) * 2;
  const p = new Px(W, H);
  const cx = W / 2, rx = o.width - 2, ry = Math.round(rx * 0.6);
  const by = H - 4 - ry, wall = 14, ty = by - wall;
  // 지붕 기둥 (뒤)
  for (const px of [cx - rx + 4, cx + rx - 8]) bevel(p, Math.round(px), 8, 4, ty - 4, WOOD, 2);
  // 담 윗면 + 안쪽
  for (let y = -ry; y <= ry; y++) for (let x = -rx; x <= rx; x++) {
    const d = (x / rx) ** 2 + (y / ry) ** 2;
    if (d > 1) continue;
    const inner = (x / (rx - 6)) ** 2 + (y / (ry - 4)) ** 2 <= 1;
    p.set(Math.round(cx + x), ty + y, inner ? (y > ry * 0.2 ? "#2f5672" : "#16120e") : STONE[(x < -rx * 0.3 ? 1 : x > rx * 0.4 ? 3 : 2) + ((Math.round(Math.atan2(y, x) * 4) & 1) && d > 0.8 ? 1 : 0)]);
  }
  // 앞 담 (원통)
  for (let x = -rx; x <= rx; x++) {
    const yt = Math.round(ty + ry * Math.sqrt(1 - (x / rx) ** 2));
    const th = Math.asin(x / rx);
    for (let y = 0; y <= wall; y++) {
      const joint = Math.abs(((th + (y > wall / 2 ? 0.2 : 0)) % 0.4 + 0.4) % 0.4) < 0.05 || y === Math.round(wall / 2);
      p.set(Math.round(cx + x), yt + y, STONE[Math.min(5, (x < -rx * 0.4 ? 1 : x > rx * 0.4 ? 3 : 2) + (joint ? 2 : 0) + (y > wall - 3 ? 1 : 0))]);
    }
  }
  // 지붕: 작은 박공 (위에서 비스듬히)
  for (let y = 0; y < 14; y++) { const half = 6 + y * 1.4; for (let x = -half; x <= half; x++) p.set(Math.round(cx + x), 2 + y, ROOF[x < -half * 0.4 ? 1 : x > half * 0.5 ? 3 : 2] ); }
  p.rect(Math.round(cx - 20), 16, 40, 2, ROOF[4]);
  // 도르래 줄 · 두레박
  p.rect(Math.round(cx - 8), 18, 16, 3, WOOD[3]);
  p.rect(Math.round(cx), 21, 1, ty - 24, "#d8c8a0");
  bevel(p, Math.round(cx - 4), ty - 6, 8, 7, WOOD, 2);
  p.rect(Math.round(cx - 4), ty - 4, 8, 1, "#4a4a52");
  outline(p);
  return p;
}

/** 바위: 각진 덩어리 2~3개 (윗면 밝게 · 옆면 그늘 · 이끼) */
function rock(o: TiledObject): Px {
  const W = (o.width + 12) * 2, H = (o.height + 8) * 2;
  const p = new Px(W, H);
  const s = Math.floor(rnd(o.x, o.y) * 100);
  const n = o.width > 20 ? 3 : 2;
  for (let k = 0; k < n; k++) {
    const rx = Math.round((o.width * 2 * (k === 0 ? 0.42 : 0.26)) / (n > 2 ? 1.1 : 1));
    const ry = Math.round(rx * 0.75);
    const cx = Math.round(W / 2 + (k === 0 ? 0 : (k % 2 ? -1 : 1) * rx * 1.3));
    const cy = H - 4 - ry + (k ? 2 : 0);
    for (let y = -ry - 4; y <= ry; y++) for (let x = -rx; x <= rx; x++) {
      const facet = Math.abs(x) / rx + Math.max(0, -y) / (ry + 4) * 1.15;
      if (facet > 1.05 || (x / rx) ** 2 + (y / ry) ** 2 > 1.15) continue;
      const topFace = y < -ry * 0.25 + (x / rx) * 2;
      const l = topFace ? (x < 0 ? 1 : 2) : x < -rx * 0.3 ? 2 : x < rx * 0.35 ? 3 : 4;
      p.set(cx + x, cy + y, STONE[l + (rnd(cx + x >> 2, cy + y >> 2, s) > 0.88 ? 1 : 0)]);
      if (topFace && rnd(x, y, s + k) > 0.93) p.set(cx + x, cy + y, "#7f9a52");
    }
  }
  outline(p, "#2e2a24");
  return p;
}

/** 덤불: 작은 잎 덩어리 여럿 + 열매 가끔 */
function bush(o: TiledObject): Px {
  const W = (o.width + 12) * 2, H = (o.height + 8) * 2;
  const p = new Px(W, H);
  const s = Math.floor(rnd(o.x, o.y) * 100);
  const G: Ramp = ["#c4ec7a", "#93cf55", "#6cb33f", "#4f9132", "#386f26", "#244e1b"];
  const cl = [[0, -6, 9], [-9, -2, 8], [9, -2, 8], [-4, 2, 8], [5, 3, 8], [0, -12, 6]];
  for (const [dx, dy, r] of cl.sort((a, b) => a[1] - b[1])) {
    const cx = Math.round(W / 2 + dx), cy = H - 12 + dy;
    for (let y = -r; y <= r; y++) for (let x = -r; x <= r; x++) {
      const d = (x * x + y * y) / (r * r);
      if (d > 1) continue;
      let l = -(x * 0.55 + y * 0.85) / r + (rnd((cx + x) >> 1, (cy + y) >> 1, s) - 0.5) * 0.6 - (dy > 0 ? 0.25 : 0);
      if (d > 0.75 && y > 0) l -= 0.4;
      p.set(cx + x, cy + y, G[l > 0.55 ? 0 : l > 0.2 ? 1 : l > -0.15 ? 2 : l > -0.5 ? 3 : l > -0.85 ? 4 : 5]);
    }
  }
  if (s % 3 === 0) for (let k = 0; k < 5; k++) { const x = Math.round(W / 2 - 10 + rnd(k, s) * 20), y = H - 22 + Math.round(rnd(s, k) * 12); p.rect(x, y, 2, 2, "#d8343b"); p.set(x, y, "#ffb0b0"); }
  outline(p, "#1e3a14");
  return p;
}

/** 그루터기: 나이테 윗면(타원) + 껍질 옆면 + 뿌리 */
function stump(o: TiledObject): Px {
  const W = (o.width + 12) * 2, H = (o.height + 8) * 2;
  const p = new Px(W, H);
  const cx = W / 2, rx = 11, ry = 7, ty = H - 20;
  // 옆면 (껍질): 윗면 앞 호에서 12px 아래로, 아래쪽은 뿌리로 퍼짐
  for (let x = -rx - 4; x <= rx + 4; x++) {
    const half = Math.abs(x) <= rx ? 0 : 1;
    const yt = Math.abs(x) <= rx ? Math.round(ty + ry * Math.sqrt(1 - (x / rx) ** 2)) : ty + ry + 6;
    for (let y = yt; y < ty + ry + 12 - half; y++) {
      const i = (x < -rx * 0.4 ? 2 : x > rx * 0.4 ? 4 : 3) + ((x + 40) % 4 === 0 ? 1 : 0);
      p.set(Math.round(cx + x), y, WOOD[Math.min(5, i)]);
    }
  }
  for (let y = -ry; y <= ry; y++) for (let x = -rx; x <= rx; x++) {
    const d = Math.sqrt((x / rx) ** 2 + (y / ry) ** 2);
    if (d > 1) continue;
    p.set(Math.round(cx + x), ty + y, d > 0.85 ? WOOD[3] : Math.floor(d * 5) % 2 ? "#e6c08c" : "#d2a774");
  }
  p.set(Math.round(cx), ty, WOOD[3]);
  outline(p, "#2a1a10");
  return p;
}

/** 돌기둥 (결투장 · 던전): 둥근 기둥 + 홈 + 주두 · 받침 */
function pillar(o: TiledObject): Px {
  const W = (o.width + 12) * 2, H = (o.height + 8) * 2;
  const p = new Px(W, H);
  const cx = Math.round(W / 2), half = Math.round(o.width * 0.8), top = OY + 8, bot = H - 10;
  for (let y = top; y < bot; y++) for (let x = -half; x <= half; x++) {
    const k = x / half;
    const flute = (x + half) % 5 === 0;
    p.set(cx + x, y, STONE[(k < -0.5 ? 1 : k < 0.2 ? 2 : k < 0.65 ? 3 : 4) + (flute ? 1 : 0)]);
  }
  bevel(p, cx - half - 4, top - 8, half * 2 + 9, 8, STONE, 1);
  bevel(p, cx - half - 5, bot, half * 2 + 11, 8, STONE, 2);
  for (let k = 0; k < 4; k++) p.set(cx - half + Math.floor(rnd(o.x, k) * half * 2), top + 10 + Math.floor(rnd(k, o.y) * (bot - top - 20)), "#7f9a52");
  outline(p, "#2e2a24");
  return p;
}

const cache = new Map<string, HTMLCanvasElement[]>();
const once = (key: string, f: () => Px) => { let c = cache.get(key); if (!c) { c = [f().toCanvas()]; cache.set(key, c); } return c; };

export const BUILDINGS: Record<string, (o: TiledObject) => HTMLCanvasElement[]> = {
  building: (o) => [house(o).toCanvas()],
  tent_shop: (o) => once(`ts${o.width}x${o.height}`, () => tent(o)),
  tent_market: (o) => once(`tm${o.width}x${o.height}`, () => tent(o)),
  well: (o) => [well(o).toCanvas()],
  rock: (o) => once(`r${o.width}:${Math.floor(rnd(o.x, o.y) * 5)}`, () => rock(o)),
  bush: (o) => once(`b${o.width}:${Math.floor(rnd(o.x, o.y) * 5)}`, () => bush(o)),
  stump: (o) => once(`s${o.width}`, () => stump(o)),
  pillar: (o) => once(`p${o.width}x${o.height}:${Math.floor(rnd(o.x, o.y) * 3)}`, () => pillar(o)),
};
