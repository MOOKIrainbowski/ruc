/** 픽셀 버퍼 — 코드로 픽셀 아트를 그리는 도구 (DECISIONS D8, §25). */

export type C3 = readonly [string, string, string]; // 밝은 면 · 기본 · 그늘 (광원 왼쪽 위)
export const OUTLINE = "#2b1d2e"; // 순수 검정 금지 (§25 아트 방향)

/** 색 밝게 · 어둡게 (k = 0~1) */
export function lighten(hex: string, k: number) {
  const n = parseInt(hex.slice(1, 7), 16);
  const c = [n >> 16, (n >> 8) & 255, n & 255].map((v) => Math.round(v + (255 - v) * k));
  return `#${c.map((v) => v.toString(16).padStart(2, "0")).join("")}`;
}
export function darken(hex: string, k: number) {
  const n = parseInt(hex.slice(1, 7), 16);
  const c = [n >> 16, (n >> 8) & 255, n & 255].map((v) => Math.round(v * (1 - k)));
  return `#${c.map((v) => v.toString(16).padStart(2, "0")).join("")}`;
}

/** 그림 전체 색조 돌리기 (외곽선 · 투명은 그대로) — 몹 변종 (P15). deg = 색상 회전, sat · light = 배율 */
export function hueShift(p: Px, deg: number, sat = 1, light = 1): Px {
  const ol = rgba(OUTLINE);
  for (let i = 0; i < p.d.length; i++) {
    const v = p.d[i];
    if (!(v >>> 24) || v === ol) continue;
    let r = (v & 255) / 255, g = ((v >>> 8) & 255) / 255, b = ((v >>> 16) & 255) / 255;
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
    let h = 0, s = 0;
    const l = (mx + mn) / 2;
    if (mx !== mn) {
      const d = mx - mn;
      s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
      h = mx === r ? (g - b) / d + (g < b ? 6 : 0) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
      h /= 6;
    }
    h = (((h + deg / 360) % 1) + 1) % 1;
    s = Math.min(1, s * sat);
    const L = Math.min(1, l * light);
    const q = L < 0.5 ? L * (1 + s) : L + s - L * s;
    const pp = 2 * L - q;
    const f = (t: number) => { t = ((t % 1) + 1) % 1; return t < 1 / 6 ? pp + (q - pp) * 6 * t : t < 0.5 ? q : t < 2 / 3 ? pp + (q - pp) * (2 / 3 - t) * 6 : pp; };
    [r, g, b] = s === 0 ? [L, L, L] : [f(h + 1 / 3), f(h), f(h - 1 / 3)];
    p.d[i] = ((v >>> 24) << 24 | Math.round(b * 255) << 16 | Math.round(g * 255) << 8 | Math.round(r * 255)) >>> 0;
  }
  return p;
}

const cache = new Map<string, number>();
/** "#rrggbb" / "#rrggbbaa" → ImageData Uint32 (리틀 엔디언 ABGR) */
export function rgba(hex: string): number {
  let v = cache.get(hex);
  if (v === undefined) {
    const n = parseInt(hex.slice(1, 7), 16);
    const a = hex.length > 7 ? parseInt(hex.slice(7, 9), 16) : 255;
    v = ((a << 24) | ((n & 0xff) << 16) | (n & 0xff00) | (n >> 16)) >>> 0;
    cache.set(hex, v);
  }
  return v;
}

export class Px {
  w: number;
  h: number;
  d: Uint32Array;
  constructor(w: number, h: number) {
    this.w = w;
    this.h = h;
    this.d = new Uint32Array(w * h);
  }
  set(x: number, y: number, c: string) {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    const i = y * this.w + x;
    const v = rgba(c);
    const a = v >>> 24;
    const old = this.d[i];
    // 반투명 색(#rrggbbaa)은 이미 있는 불투명 픽셀 위에 섞어 칠함 (하이라이트 · 그림자)
    if (a < 255 && old >>> 24 === 255) {
      const k = a / 255;
      const mix = (s: number) => Math.round(((v >> s) & 255) * k + ((old >> s) & 255) * (1 - k));
      this.d[i] = ((255 << 24) | (mix(16) << 16) | (mix(8) << 8) | mix(0)) >>> 0;
    } else this.d[i] = v;
  }
  rect(x: number, y: number, w: number, h: number, c: string) {
    for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) this.set(xx, yy, c);
  }
  /** 3단 명암 사각형: 왼쪽 · 위 밝게, 오른쪽 · 아래 어둡게 */
  part(x: number, y: number, w: number, h: number, c: C3) {
    if (w <= 0 || h <= 0) return;
    this.rect(x, y, w, h, c[1]);
    this.rect(x, y, 1, h, c[0]);
    this.rect(x, y, w, 1, c[0]);
    this.rect(x + w - 1, y, 1, h, c[2]);
    this.rect(x, y + h - 1, w, 1, c[2]);
  }
  ellipse(cx: number, cy: number, rx: number, ry: number, c: string) {
    for (let y = -ry; y <= ry; y++) for (let x = -rx; x <= rx; x++) if ((x * x) / (rx * rx) + (y * y) / (ry * ry) <= 1) this.set(cx + x, cy + y, c);
  }
  /** 비어 있는 칸 중 그림과 맞닿은 칸에 외곽선 */
  outline(c = OUTLINE) {
    const src = this.d.slice();
    const col = rgba(c);
    const at = (x: number, y: number) => x >= 0 && y >= 0 && x < this.w && y < this.h && src[y * this.w + x] >>> 24 > 0x80;
    for (let y = 0; y < this.h; y++)
      for (let x = 0; x < this.w; x++)
        if (!src[y * this.w + x] && (at(x - 1, y) || at(x + 1, y) || at(x, y - 1) || at(x, y + 1))) this.d[y * this.w + x] = col;
  }
  flipX() {
    for (let y = 0; y < this.h; y++) this.d.subarray(y * this.w, (y + 1) * this.w).reverse();
  }
  /** 다른 버퍼를 (ox, oy) 에 덮어 그림 (투명은 건너뜀) */
  draw(src: Px, ox: number, oy: number) {
    for (let y = 0; y < src.h; y++)
      for (let x = 0; x < src.w; x++) {
        const v = src.d[y * src.w + x];
        const tx = ox + x;
        const ty = oy + y;
        if (v && tx >= 0 && ty >= 0 && tx < this.w && ty < this.h) this.d[ty * this.w + tx] = v;
      }
  }
  toCanvas(): HTMLCanvasElement {
    const c = Object.assign(document.createElement("canvas"), { width: this.w, height: this.h });
    c.getContext("2d")!.putImageData(new ImageData(new Uint8ClampedArray(this.d.slice().buffer as ArrayBuffer), this.w, this.h), 0, 0);
    return c;
  }
}

/** 좌표 해시 → 0..1 (타일 무늬 변형용, 결정적) */
export function hash(x: number, y: number, s = 0) {
  let h = (x * 374761393 + y * 668265263 + s * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/**
 * 16×16 그림 → 32×32 세밀한 아이콘 (스킬 · 아이템 · 스탯 · 효과 아이콘 공통).
 * ① Scale2x 로 모서리를 매끈하게 두 배 ② 위쪽은 밝게 · 아래쪽은 어둡게 세로 명암
 * ③ 왼쪽 위 테두리 반사광 · 오른쪽 아래 그늘 ④ 안쪽 결(디더)로 재질감 ⑤ 바깥 1px 부드러운 그림자
 */
export function refine32(src: Px): Px {
  const w = src.w;
  const h = src.h;
  const out = new Px(w * 2, h * 2);
  const at = (x: number, y: number) => (x < 0 || y < 0 || x >= w || y >= h ? 0 : src.d[y * w + x]);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const P = at(x, y);
      const A = at(x, y - 1);
      const B = at(x + 1, y);
      const C = at(x - 1, y);
      const D = at(x, y + 1);
      const e0 = C === A && C !== D && A !== B ? A : P;
      const e1 = A === B && A !== C && B !== D ? B : P;
      const e2 = D === C && D !== B && C !== A ? C : P;
      const e3 = B === D && B !== A && D !== C ? D : P;
      out.d[y * 2 * out.w + x * 2] = e0;
      out.d[y * 2 * out.w + x * 2 + 1] = e1;
      out.d[(y * 2 + 1) * out.w + x * 2] = e2;
      out.d[(y * 2 + 1) * out.w + x * 2 + 1] = e3;
    }
  const ow = out.w;
  const oh = out.h;
  const solid = (x: number, y: number) => x >= 0 && y >= 0 && x < ow && y < oh && out.d[y * ow + x] >>> 24 > 0x80;
  const src2 = out.d.slice();
  const shift = (v: number, k: number) => {
    const r = Math.max(0, Math.min(255, (v & 255) + k));
    const g = Math.max(0, Math.min(255, ((v >> 8) & 255) + k));
    const b = Math.max(0, Math.min(255, ((v >> 16) & 255) + k));
    return ((v & 0xff000000) | (b << 16) | (g << 8) | r) >>> 0;
  };
  for (let y = 0; y < oh; y++)
    for (let x = 0; x < ow; x++) {
      const v = src2[y * ow + x];
      if (v >>> 24 < 0x80) continue;
      let k = Math.round(12 - (y / oh) * 28); // 위 +12 → 아래 −16
      if (!solid(x - 1, y - 1) || !solid(x, y - 1) || !solid(x - 1, y)) k += 14; // 왼쪽 위 테두리 반사광
      if (!solid(x + 1, y + 1) || !solid(x + 1, y) || !solid(x, y + 1)) k -= 10; // 오른쪽 아래 그늘
      if ((x + y) % 4 === 0) k += 3; // 결
      out.d[y * ow + x] = shift(v, k);
    }
  // 바깥 부드러운 그림자 (아래 오른쪽으로 1px, 반투명)
  for (let y = 1; y < oh; y++)
    for (let x = 1; x < ow; x++) if (!out.d[y * ow + x] && solid(x - 1, y - 1)) out.d[y * ow + x] = 0x44000000;
  return out;
}
