/** 픽셀 버퍼 — 코드로 픽셀 아트를 그리는 도구 (DECISIONS D8, §25). */

export type C3 = readonly [string, string, string]; // 밝은 면 · 기본 · 그늘 (광원 왼쪽 위)
export const OUTLINE = "#2b1d2e"; // 순수 검정 금지 (§25 아트 방향)

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
    if (x >= 0 && y >= 0 && x < this.w && y < this.h) this.d[y * this.w + x] = rgba(c);
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
