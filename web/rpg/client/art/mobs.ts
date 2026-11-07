import { Px, type C3 } from "./px";

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

function slime(f: number): Px {
  const p = new Px(32, 32);
  const ph = (f / 8) * Math.PI * 2;
  const w = Math.round(11 - Math.sin(ph) * 1.3);
  const h = Math.round(8 + Math.sin(ph) * 1.3);
  const lift = Math.max(0, Math.round(Math.sin(ph - 1.2) * 2.4));
  const cy = 29 - h - lift;
  p.ellipse(16, cy, w, h, GRASS[2]);
  p.ellipse(15, cy - 1, w - 1, h - 1, GRASS[1]);
  p.ellipse(12, cy - 3, 3, 2, GRASS[0]);
  p.set(10, cy - 4, "#ffffff");
  for (const x of [13, 20]) { p.rect(x, cy, 2, 3, "#2b1d2e"); p.set(x, cy, "#ffffff"); }
  p.rect(16, cy + 4, 3, 1, "#2f6b2a");
  p.rect(18, cy - h - 1, 1, 2, "#7a4c2a"); // 새싹
  p.rect(19, cy - h - 2, 2, 1, GRASS[0]);
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

const PAINT: Record<string, (f: number) => Px> = { slime, rabbit, goblin, wolf };

/** [오른쪽 4프레임, 왼쪽 4프레임] */
export function mobFrames(key: string): [HTMLCanvasElement[], HTMLCanvasElement[]] {
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
