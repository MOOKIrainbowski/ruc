import { CHAR_H, CHAR_W } from "../../shared/constants";
import { EYES, HAIR_COLORS, SKINS, type Appearance } from "../../shared/data/appearance";
import { OUTLINE, Px, type C3 } from "./px";

/**
 * 캐릭터 48×64 · 8방향 · 동작당 4프레임 (§8-2).
 * S · SE · E · NE · N 다섯 방향만 그리고 W 쪽 셋은 좌우 반전 (§25-2 — 대칭이라 가능).
 * 시트: 행 = 방향(S, SE, E, NE, N, NW, W, SW), 열 = 동작 × 4프레임 (§25-4).
 * 레이어(§8-3)는 P3 장비에서 나눕니다 — 지금은 견습 옷을 한 번에 그립니다.
 */

export type Outfit = { shirt: C3; pants: C3; shoe: string };
export const APPRENTICE: Outfit = {
  shirt: ["#a8db74", "#7bb24a", "#5a8a35"],
  pants: ["#94735a", "#6d513b", "#523b2a"],
  shoe: "#4a3428",
};

export const ACTIONS = ["idle", "walk", "run"] as const;
export type Action = (typeof ACTIONS)[number];
export const FRAMES = 4;
/** 동작별 재생 속도 (§8-2: 걷기 8fps · 달리기 12fps) */
export const ACTION_FPS: Record<Action, number> = { idle: 3, walk: 8, run: 12 };

const BLUSH = "#f2a0a0";
const MOUTH = "#b8505a";

/** 방향 → [그릴 방향, 반전] */
const VIEW: [number, boolean][] = [[0, false], [1, false], [2, false], [3, false], [4, false], [3, true], [2, true], [1, true]];

function paint(view: number, action: Action, f: number, ap: Appearance, o: Outfit): Px {
  const p = new Px(CHAR_W, CHAR_H);
  const skin = SKINS[ap.skin];
  const hair = HAIR_COLORS[ap.hairColor];
  const eye = EYES[ap.eyes];
  const cyc = action === "idle" ? 0 : [0, 1, 0, -1][f] * (action === "run" ? 2 : 1);
  const b = action === "idle" ? (f >= 2 ? 1 : 0) : f % 2 ? (action === "run" ? -2 : -1) : 0;
  const lean = action === "run" && view === 2 ? 1 : 0;
  const front = view <= 1;
  const side = view === 2;

  // ── 다리 · 신발 ──
  const leg = (x: number, lift: number, c: C3) => {
    p.part(x, 50, 4, 8 - lift, c);
    p.rect(x, 58 - lift, side ? 5 : 4, 2, o.shoe);
  };
  if (side) {
    leg(22 - cyc, 0, [o.pants[1], o.pants[2], o.pants[2]]);
    leg(23 + cyc, 0, o.pants);
  } else {
    const lx = view === 1 ? 20 : 19;
    leg(lx, Math.max(0, cyc), o.pants);
    leg(lx + 6, Math.max(0, -cyc), o.pants);
  }

  // ── 뒷머리(긴 머리 · 양갈래는 몸 뒤) ──
  const hairBehind = () => {
    if (ap.hair === 2 && !front) p.part(side ? 13 + lean : 13, 34 + b, side ? 8 : 22, 12, hair);
    if (ap.hair === 5) {
      p.part(side ? 9 + lean : 8, 21 + b, 5, 18, hair);
      if (!side) p.part(35, 21 + b, 5, 18, hair);
    }
    if (ap.hair === 3 && side) p.part(8 + lean, 25 + b, 5, 13, hair);
  };
  hairBehind();

  // ── 팔(뒤) · 몸통 · 팔(앞) ──
  const sh = o.shirt;
  const arm = (x: number, dy: number, w = 3, c: C3 = sh) => {
    p.part(x, 40 + b + dy, w, 7, c);
    p.rect(x, 47 + b + dy, w, 2, skin[1]);
  };
  if (side) arm(20 - cyc + lean, 0, 3, [sh[1], sh[2], sh[2]]);
  const tx = side ? 19 + lean : view === 1 ? 18 : 17;
  const tw = side ? 11 : view === 1 ? 13 : 14;
  p.part(tx, 39 + b, tw, 11 - b, sh);
  p.rect(tx, 48, tw, 1, o.pants[2]); // 허리띠
  if (front) p.rect(view === 1 ? 23 : 22, 39 + b, 4, 2, skin[1]); // 목깃
  if (side) arm(24 + cyc + lean, 0);
  else {
    const a = Math.sign(cyc);
    arm(view === 1 ? 15 : 14, a);
    arm(view === 1 ? 31 : 31, -a, view === 1 ? 2 : 3);
  }

  // ── 머리 ──
  const hx = 14 + lean;
  const hy = 17 + b;
  p.part(hx, hy, 20, 22, skin);
  if (front || side) {
    const e = (x: number, w: number) => {
      p.rect(x, hy + 11, w, 4, OUTLINE);
      p.rect(x, hy + 13, w, 2, eye);
      p.set(x, hy + 11, "#ffffff");
    };
    if (view === 0) { e(18, 3); e(27, 3); p.rect(16, hy + 16, 2, 1, BLUSH); p.rect(30, hy + 16, 2, 1, BLUSH); p.rect(23, hy + 17, 2, 1, MOUTH); }
    if (view === 1) { e(20, 3); e(28, 2); p.rect(18, hy + 16, 2, 1, BLUSH); p.rect(31, hy + 16, 1, 1, BLUSH); p.rect(26, hy + 17, 2, 1, MOUTH); }
    if (side) { e(28 + lean, 3); p.rect(26 + lean, hy + 16, 2, 1, BLUSH); p.rect(31 + lean, hy + 17, 2, 1, MOUTH); }
  }

  // ── 머리카락 ──
  const cap = () => p.part(hx - 1, hy - 2, 22, 9, hair);
  const bangs = (x0: number, x1: number) => {
    for (let x = x0; x <= x1; x++) p.rect(x, hy + 7, 1, [2, 3, 1, 3, 2, 1][x % 6], hair[x % 3 === 0 ? 0 : 1]);
  };
  const spikes = () => { for (const sx of [0, 5, 10, 15]) { p.rect(hx + sx + 1, hy - 4, 3, 2, hair[0]); p.rect(hx + sx + 2, hy - 6, 1, 2, hair[1]); } };

  if (view === 4 || view === 3) {
    // 뒤 · 뒤 사선: 머리 대부분이 머리카락
    p.part(hx - 1 - (ap.hair === 4 ? 1 : 0), hy - 2, ap.hair === 4 ? 24 : 22, ap.hair === 4 ? 23 : 21, hair);
    if (view === 3) p.rect(hx + 17, hy + 10, 2, 8, skin[2]); // 오른뺨
    if (ap.hair === 3) { p.rect(hx + 7, hy + 9, 6, 3, "#ff7eb6"); p.part(hx + 7, hy + 12, 6, 14, hair); }
    if (ap.hair === 2) p.part(hx - 1, hy + 19, 22, 10, hair);
  } else if (side) {
    cap();
    p.part(hx - 1, hy + 7, 9, 10, hair);
    bangs(hx + 10, hx + 19);
    if (ap.hair === 4) p.part(hx - 1, hy + 7, 11, 13, hair);
    if (ap.hair === 3) p.rect(hx - 3, hy + 5, 3, 3, "#ff7eb6");
  } else {
    cap();
    const lw = view === 1 ? 4 : 3;
    p.part(hx - 1, hy + 7, lw, view === 1 ? 8 : 6, hair);
    p.part(hx + 18, hy + 7, view === 1 ? 2 : 3, view === 1 ? 4 : 6, hair);
    bangs(hx + 2, hx + 17);
    if (ap.hair === 2) { p.part(hx - 2, hy + 7, 4, 22, hair); p.part(hx + 18, hy + 7, 4, 22, hair); }
    if (ap.hair === 4) { p.part(hx - 2, hy + 7, 4, 13, hair); p.part(hx + 18, hy + 7, 4, 13, hair); }
    if (ap.hair === 3) p.part(hx + 17, hy - 5, 4, 4, hair);
  }
  if (ap.hair === 1) spikes();
  if (ap.hair === 5) { p.rect(side ? 10 + lean : 10, 21 + b, 2, 2, "#ff7eb6"); if (!side) p.rect(36, 21 + b, 2, 2, "#ff7eb6"); }

  p.outline();
  return p;
}

/** 외형 하나의 전체 시트 (576 × 512) */
export function characterSheet(ap: Appearance, outfit: Outfit = APPRENTICE): HTMLCanvasElement {
  const cols = ACTIONS.length * FRAMES;
  const sheet = new Px(CHAR_W * cols, CHAR_H * 8);
  for (let dir = 0; dir < 8; dir++) {
    const [view, flip] = VIEW[dir];
    ACTIONS.forEach((action, ai) => {
      for (let f = 0; f < FRAMES; f++) {
        const fr = paint(view, action, f, ap, outfit);
        if (flip) fr.flipX();
        sheet.draw(fr, (ai * FRAMES + f) * CHAR_W, dir * CHAR_H);
      }
    });
  }
  return sheet.toCanvas();
}

/** 발밑 그림자 (설정에서 끌 수 있게 따로) */
export function shadowCanvas(): HTMLCanvasElement {
  const p = new Px(20, 6);
  p.ellipse(10, 3, 9, 2, "#00000044");
  return p.toCanvas();
}
