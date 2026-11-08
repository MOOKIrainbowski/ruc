import { CHAR_FEET, CHAR_H, CHAR_W } from "../../shared/constants";
import { EYES, HAIR_COLORS, SKINS, type Appearance } from "../../shared/data/appearance";
import { ITEMS } from "../../shared/data/items";
import { JOBS, LINES, type LineId } from "../../shared/data/jobs";
import { OUTLINE, Px, darken, lighten, type C3 } from "./px";

/**
 * 캐릭터 32×40 · 3등신 둥근 캐릭터 · 8방향 · 동작당 8프레임 (§8-2, 2026-11 그래픽 개선).
 * 머리(머리카락 포함) 10 : 몸 20 — 머리가 키의 1/3. 머리 · 손은 명암을 둥글게 칠함.
 * S · SE · E · NE · N 다섯 방향만 그리고 W 쪽 셋은 좌우 반전 (§25-2).
 * 시트: 행 = 방향(S, SE, E, NE, N, NW, W, SW), 열 = 동작 × 8프레임 (§25-4).
 * 장비 레이어 (§8-3 페이퍼돌, P11 · D90): 흉갑 · 바지 · 신발은 옷 색, 투구 · 장갑 · 망토 · 무기는 그 위에 그림.
 * 렌더 순서 = 그림자 → 망토(뒤) → 다리 · 신발 → 몸 · 팔(장갑) → 머리 → 헤어 → 투구 → 무기. 뒤를 볼 때는 무기가 몸 뒤, 망토가 몸 위.
 * 2차 전직(§9-1)은 문장(가슴 · 망토 등) + 망토 장비가 없으면 계열 색 망토.
 */

export type WeaponKind = "sword" | "axe" | "dagger" | "bow" | "staff" | "wand";
export type Outfit = {
  shirt: C3;
  pants: C3;
  shoe: string;
  helm?: { kind: "cap" | "helm"; c: C3 };
  gloves?: string;
  cape?: C3;
  weapon?: { kind: WeaponKind; c: C3; gem?: string };
  /** 2차 전직 문장 (계열) */
  emblem?: LineId;
};
export const APPRENTICE: Outfit = {
  shirt: ["#a8db74", "#7bb24a", "#5a8a35"],
  pants: ["#94735a", "#6d513b", "#523b2a"],
  shoe: "#4a3428",
};

const shades = (hex: string): C3 => [lighten(hex, 0.3), hex, darken(hex, 0.35)];
const WEAPONS = new Set<string>(["sword", "axe", "dagger", "bow", "staff", "wand"]);
const WOOD: C3 = ["#c98d58", "#a36a3c", "#7d4f2b"];
const GOLD: C3 = ["#fff4b0", "#FFE14D", "#b8860b"];
/** 문장 5×5 (계열): 방패 · 검 · 엇갈린 단검 · 마름모 별 · 화살 · 하트 */
const EMBLEM: Record<LineId, string[]> = {
  tank: [".###.", "#####", "#####", ".###.", "..#.."],
  warrior: ["..#..", "..#..", "..#..", ".###.", "..#.."],
  assassin: ["#...#", ".#.#.", "..#..", ".#.#.", "#...#"],
  mage: ["..#..", ".###.", "#####", ".###.", "..#.."],
  ranged: ["..#..", ".###.", "#.#.#", "..#..", "..#.."],
  support: [".#.#.", "#####", "#####", ".###.", "..#.."],
};

/** 입은 장비 템플릿(lookOf) + 직업(jb) → 외형 */
export function outfitOf(look: string[] = [], jb = ""): Outfit {
  const o: Outfit = { ...APPRENTICE };
  for (const id of look) {
    const t = ITEMS[id];
    if (!t?.look) continue;
    const c3 = Array.isArray(t.look) ? (t.look as C3) : null;
    const one = typeof t.look === "string" ? t.look : null;
    if (t.slot === "chest" && c3) o.shirt = c3;
    else if (t.slot === "legs" && c3) o.pants = c3;
    else if (t.slot === "boots" && one) o.shoe = one;
    else if (t.slot === "helmet" && c3) o.helm = { kind: t.shape === "cap" ? "cap" : "helm", c: c3 };
    else if (t.slot === "gloves" && one) o.gloves = one;
    else if (t.slot === "cape" && c3) o.cape = c3;
    else if (t.slot === "weapon" && c3 && WEAPONS.has(t.icon)) o.weapon = { kind: t.icon as WeaponKind, c: c3, gem: t.gem };
  }
  const j = Object.hasOwn(JOBS, jb) ? JOBS[jb] : undefined;
  if (j) {
    o.emblem = j.line;
    o.cape ??= shades(LINES[j.line].color);
  }
  return o;
}

/** 구르기 · 사망 · 피격은 시트 없이 스프라이트 회전 · 색으로 (game.ts) */
export const ACTIONS = ["idle", "walk", "run", "attack", "cast"] as const;
export type Action = (typeof ACTIONS)[number];
export const FRAMES = 8;
/** 동작별 재생 속도 — 프레임이 8장이라 예전(4장)의 두 배 (공격은 공속 비례 — game.ts 가 배속) */
export const ACTION_FPS: Record<Action, number> = { idle: 5, walk: 14, run: 20, attack: 20, cast: 12 };
export { FRAMES as CHAR_FRAMES };

const BLUSH = "#f4a3a3";
const MOUTH = "#b8505a";
const CX = 16;

/** 방향 → [그릴 방향, 반전] */
const VIEW: [number, boolean][] = [[0, false], [1, false], [2, false], [3, false], [4, false], [3, true], [2, true], [1, true]];

/** 둥글게 명암을 넣은 타원 (왼쪽 위에서 빛). half = 위쪽 반만 (투구 · 모자) */
function ball(p: Px, cx: number, cy: number, rx: number, ry: number, c: C3, half = false) {
  for (let y = -ry; y <= (half ? 0 : ry); y++)
    for (let x = -rx; x <= rx; x++) {
      const nx = x / (rx + 0.5);
      const ny = y / (ry + 0.5);
      if (nx * nx + ny * ny > 1) continue;
      const l = -(nx * 0.6 + ny * 0.8);
      p.set(cx + x, cy + y, l > 0.45 ? c[0] : l < -0.35 ? c[2] : c[1]);
    }
}

function paint(view: number, action: Action, f: number, ap: Appearance, o: Outfit): Px {
  const p = new Px(CHAR_W, CHAR_H);
  const skin = SKINS[ap.skin];
  const hair = HAIR_COLORS[ap.hairColor];
  const eye = EYES[ap.eyes];
  const front = view <= 1;
  const side = view === 2;
  const back = view >= 3;
  const three = view === 1 || view === 3; // 남동 · 북동(그리고 반전된 남서 · 북서)
  const ph = (f / FRAMES) * Math.PI * 2;
  const walking = action === "walk" || action === "run";
  const amp = action === "run" ? 3 : 2;
  const sw = walking ? Math.round(Math.sin(ph) * amp) : 0; // 다리 앞뒤 (px)
  const up = walking ? (Math.abs(Math.sin(ph)) > 0.62 ? (action === "run" ? 2 : 1) : 0) : 0;
  const breathe = action === "idle" ? [0, 0, 0, 1, 1, 1, 0, 0][f] : 0;
  const b = breathe - up; // 위쪽 몸 오르내림 (+ = 아래)
  const lean = action === "run" && side ? 1 : 0;
  const hop = (v: number) => Math.max(0, v); // 들리는 다리

  // 몸통 · 손 위치 (망토 · 무기가 같이 씀)
  const tw = side ? 6 : three ? 7 : 8;
  const tx = side ? CX - 3 + lean : three ? CX - 3 : CX - tw / 2;
  const torsoTop = 15 + b;
  const armPose = (side2: -1 | 1) => {
    // 걷기 · 달리기: 반대쪽 다리와 반대로 흔듦 / 공격 · 시전: 아래에서 오버라이드
    const swing = walking ? Math.round(Math.sin(ph + (side2 === 1 ? 0 : Math.PI)) * (action === "run" ? 3 : 2)) : 0;
    return swing;
  };
  const pose = armsFor(action, f, side);
  const armLen = (s: number) => (action === "cast" ? Math.max(3, 6 - pose.raise) : 6 - Math.max(0, s));
  const hand = side
    ? { x: CX + 1 + armPose(1) + pose.dx + lean, y: torsoTop + 1 + pose.dy + pose.len }
    : three
      ? { x: tx - 2, y: torsoTop + 1 + (action === "cast" || action === "attack" ? pose.dyL : 0) + armLen(armPose(-1)) }
      : { x: tx + tw, y: torsoTop + 1 + (action === "attack" ? pose.dy : action === "cast" ? pose.dyL : 0) + armLen(armPose(1)) };
  const swingNow = action === "attack" && f >= 2 && f <= 4;
  const flutter = walking ? Math.round(Math.sin(ph * 2)) : 0;
  const cape = o.cape;
  // ── 망토 (몸 뒤) — 앞 · 옆에서 볼 때 ──
  if (cape && !back) {
    const top = torsoTop + 1;
    if (side) {
      for (let y = top; y <= 31; y++) {
        const x1 = CX - 3 + lean - Math.round(((y - top) / (31 - top)) * 3) - (y > 27 ? flutter + (action === "run" ? 1 : 0) : 0);
        p.rect(x1, y, CX + 1 + lean - x1, 1, cape[1]);
        p.set(x1, y, cape[2]);
      }
    } else {
      p.rect(tx - 2, top, tw + 4, 31 - top + Math.max(0, flutter), cape[2]); // 안감
      p.rect(tx - 2, top, 1, 31 - top, cape[1]);
      p.rect(tx + tw + 1, top, 1, 31 - top, cape[1]);
    }
  }

  // ── 다리 · 신발 (y 25..33) ──
  const leg = (x: number, lift: number, c: C3, w = 4, shoeW = 5, shoeDx = 0) => {
    p.part(x, 25, w, 7 - lift, c);
    p.rect(x + shoeDx, 32 - lift, shoeW, 2, o.shoe);
    p.rect(x + shoeDx, 32 - lift, shoeW, 1, "#ffffff22");
  };
  if (side) {
    leg(CX - 3 - sw + lean, hop(sw), [o.pants[1], o.pants[2], o.pants[2]], 4, 6, 0);
    leg(CX - 1 + sw + lean, hop(-sw), o.pants, 4, 6, 0);
  } else if (three) {
    // 3/4: 안쪽(먼) 다리는 어둡고 살짝 가려지고, 앞다리는 겹쳐서 발끝이 진행 방향으로 나옴
    leg(CX - 3, hop(-sw), [o.pants[1], o.pants[2], o.pants[2]], 4, 5, 0);
    leg(CX - 1, hop(sw), o.pants, 4, 6, 1);
  } else {
    const x0 = CX - 4;
    leg(x0, hop(sw), o.pants);
    leg(x0 + 4, hop(-sw), o.pants);
  }

  // ── 뒷머리 (긴 머리 · 양갈래는 몸 뒤) ──
  const hy = 10 + b;
  const hx = CX + lean + (three ? 1 : 0);
  const behind = () => {
    if (ap.hair === 2) ball(p, hx, hy + 6, side ? 4 : 6, 6, hair);
    if (ap.hair === 5) { ball(p, hx - 7, hy + 4, 2, 5, hair); if (!side) ball(p, hx + 7, hy + 4, 2, 5, hair); }
    if (ap.hair === 3 && (side || back)) ball(p, hx - (side ? 6 : 0), hy + 5, 2, 5, hair);
  };
  behind();

  // ── 몸통 · 팔 (장갑) ──
  const sh = o.shirt;
  const arm = (x: number, y: number, h: number, c: C3) => {
    p.part(x, y, 2, h, c);
    p.rect(x, y + h, 2, 2, o.gloves ?? skin[1]);
    p.set(x, y + h, o.gloves ? lighten(o.gloves, 0.25) : skin[0]);
  };
  const drawTorso = () => {
    p.part(tx, torsoTop, tw, 10 - b, sh);
    p.rect(tx, 23, tw, 1, o.pants[2]); // 허리띠
    p.set(tx + tw - 2, 23, "#f2c94c");
    if (front) p.rect(CX - (three ? 0 : 1), torsoTop, 2, 1, skin[1]); // 목깃
    if (three) {
      // 돌아선 몸의 옆면: 오른쪽 2px 은 한 단계 어둡게, 앞면 쪽 가슴 주름
      p.rect(tx + tw - 2, torsoTop + 1, 2, 9 - b, sh[2]);
      p.rect(tx + tw - 2, 23, 2, 1, o.pants[2]);
      if (front) { p.rect(tx + 1, torsoTop + 3, 3, 1, sh[0]); p.rect(tx + 2, torsoTop + 5, 2, 1, sh[2]); }
      else p.rect(tx + 2, torsoTop + 2, 1, 6, sh[0]); // 등 솔기
    }
    // 2차 전직 문장: 가슴 배지 (계열 색 + 금색)
    if (o.emblem && front) {
      const ex = three ? tx + 1 : CX - 1;
      p.rect(ex, torsoTop + 3, 3, 3, LINES[o.emblem].color);
      p.set(ex + 1, torsoTop + 4, GOLD[1]);
    }
    if (cape && front) { p.set(tx, torsoTop, GOLD[1]); p.set(tx + tw - 1, torsoTop, GOLD[1]); } // 망토 걸쇠
  };
  // 뒤를 볼 때 무기는 몸 뒤
  if (o.weapon && back) weapon(p, o.weapon, hand.x, hand.y, 0, swingNow, false);
  if (side) arm(CX - 1 - armPose(-1) + lean, torsoTop + 1, 6, [sh[1], sh[2], sh[2]]); // 뒤팔
  if (three) arm(tx + tw - 1, torsoTop + 2 + Math.max(0, armPose(1)), 5, [sh[1], sh[2], sh[2]]); // 먼 팔: 몸통에 반쯤 가림
  drawTorso();

  if (side) {
    const y = torsoTop + 1 + pose.dy;
    arm(CX + 1 + armPose(1) + pose.dx + lean, y, pose.len, sh);
  } else if (three) {
    const sL = armPose(-1);
    arm(tx - 2, torsoTop + 1 + (action === "cast" || action === "attack" ? pose.dyL : 0), action === "cast" ? Math.max(3, 6 - pose.raise) : 6 - Math.max(0, sL), sh);
  } else {
    const sL = armPose(-1);
    const sR = armPose(1);
    arm(tx - 2, torsoTop + 1 + (action === "cast" || action === "attack" ? pose.dyL : 0), action === "cast" ? Math.max(3, 6 - pose.raise) : 6 - Math.max(0, sL), sh);
    arm(tx + tw, torsoTop + 1 + (action === "attack" ? pose.dy : action === "cast" ? pose.dyL : 0), action === "cast" ? Math.max(3, 6 - pose.raise) : 6 - Math.max(0, sR), sh);
  }

  // ── 망토 (등 위) — 뒤에서 볼 때 + 2차 전직 문장 ──
  if (cape && back) {
    const cx0 = tx + (view === 3 ? 0 : 0);
    p.part(cx0, torsoTop, tw, 31 - torsoTop + Math.max(0, flutter), cape);
    for (let x = cx0; x < cx0 + tw; x += 2) p.set(x, 31 + Math.max(0, flutter), cape[2]); // 밑단 주름
    if (o.emblem) EMBLEM[o.emblem].forEach((row, dy) => [...row].forEach((ch, dx) => { if (ch === "#") p.set(cx0 + Math.floor((tw - 5) / 2) + dx, torsoTop + 4 + dy, GOLD[1]); }));
  }

  // ── 머리 ──
  ball(p, hx, hy, 5, 4, skin);
  if (!back) {
    // 남동(3/4): 가까운 눈은 크게, 먼 눈은 가늘게, 입은 진행 방향으로 치우침
    const ex = side ? [CX + 2 + lean] : view === 1 ? [hx - 3, hx + 2] : [CX - 3, CX + 2];
    const eyeAt = (x: number, w = 2) => {
      p.rect(x, hy, w, 1, OUTLINE);
      p.rect(x, hy + 1, w, 2, eye);
      p.set(x, hy + 1, "#ffffff");
      if (w > 1) p.set(x + 1, hy + 2, "#ffffff55");
    };
    ex.forEach((x, i) => eyeAt(x, view === 1 && i === 1 ? 1 : 2));
    if (view === 1) {
      p.rect(hx - 4, hy + 3, 2, 1, BLUSH);
      p.rect(hx + 3, hy + 3, 1, 1, BLUSH);
      p.rect(hx, hy + 3, 2, 1, MOUTH);
      p.set(hx + 1, hy + 2, skin[2]); // 코 그림자
    } else if (!side) {
      p.rect(ex[0] - 1, hy + 3, 2, 1, BLUSH);
      p.rect(ex[1] + 1, hy + 3, 2, 1, BLUSH);
      p.rect(CX - 1, hy + 3, 2, 1, MOUTH);
    } else {
      p.rect(CX + 1 + lean, hy + 3, 1, 1, BLUSH);
      p.rect(CX + 4 + lean, hy + 3, 1, 1, MOUTH);
    }
  }

  // ── 머리카락 ──
  const capCy = hy - 2;
  if (back) {
    ball(p, hx, hy - 1, 6, 5, hair);
    if (ap.hair === 4) ball(p, hx, hy, 7, 6, hair);
    if (ap.hair === 2) p.part(hx - 6, hy + 2, 13, 8, hair);
    if (ap.hair === 3) { ball(p, hx, hy + 6, 2, 5, hair); p.rect(hx - 1, hy + 2, 3, 2, "#ff7eb6"); }
    if (view === 3) { p.rect(hx + 4, hy + 1, 2, 5, skin[2]); p.rect(hx + 4, hy + 1, 1, 2, skin[1]); } // 북동: 오른쪽 뺨 · 귀 쪽 살짝 보임
  } else {
    ball(p, hx, capCy, 6, 3, hair);
    // 앞머리
    if (front) {
      const fringe = [2, 3, 2, 3, 1, 3, 2, 3, 2, 3, 2];
      for (let x = -5; x <= 5; x++) p.rect(hx + x, hy - 2, 1, fringe[x + 5] ?? 2, hair[Math.abs(x) % 2 ? 1 : 0]);
      p.rect(hx - 6, hy - 1, 1, 5, hair[2]);
      p.rect(hx + 6, hy - 1, 1, 5, hair[2]);
    } else {
      for (let x = 0; x <= 5; x++) p.rect(hx + x, hy - 2, 1, [3, 3, 2, 2, 1, 1][x], hair[x % 2 ? 1 : 0]);
      p.part(hx - 6, hy - 2, 6, 8, hair);
    }
    if (ap.hair === 1 && !o.helm) for (const sx of [-4, -1, 2, 5]) { p.rect(hx + sx, capCy - 4, 3, 2, hair[0]); p.rect(hx + sx + 1, capCy - 5, 1, 1, hair[1]); }
    if (ap.hair === 3) { p.rect(hx + (side ? -7 : 5), capCy - 2, 3, 3, "#ff7eb6"); }
    if (ap.hair === 4) { ball(p, hx, capCy, 7, 4, hair); if (front) { p.rect(hx - 7, hy, 2, 4, hair[2]); p.rect(hx + 6, hy, 2, 4, hair[2]); } }
    if (ap.hair === 2 && front) { p.part(hx - 7, hy - 2, 2, 12, hair); p.part(hx + 6, hy - 2, 2, 12, hair); }
    if (ap.hair === 5) { p.rect(hx - 7, hy - 2, 2, 2, "#ff7eb6"); if (!side) p.rect(hx + 6, hy - 2, 2, 2, "#ff7eb6"); }
    // 머리 위 반짝 하이라이트
    p.rect(hx - 3, capCy - 2, 2, 1, "#ffffff55");
  }

  // ── 투구 · 모자 ──
  if (o.helm) {
    const c = o.helm.c;
    if (o.helm.kind === "cap") {
      ball(p, hx, hy - 2, 6, 4, c, true);
      if (front) p.rect(hx - 6, hy - 2, 13, 1, c[2]); // 챙
      else if (side) p.rect(hx + 1, hy - 2, 7, 1, c[2]);
    } else {
      ball(p, hx, hy - 1, 6, 5, c, true);
      p.rect(hx - 6, hy - 1, 13, 1, c[2]); // 테
      if (back) p.part(hx - 6, hy, 13, 4, c); // 뒤통수
      else if (side) p.part(hx - 6, hy - 1, 5, 5, c); // 목 가리개 (뒷머리를 덮음)
      else { p.part(hx - 6, hy - 1, 2, 4, c); p.part(hx + 5, hy - 1, 2, 4, c); } // 볼 가리개
      p.rect(hx - 1, hy - 7, 2, 2, c[0]); // 꼭대기 장식
    }
  }

  // 시전 · 공격 이펙트 손끝 반짝
  if (action === "cast" && f >= 3 && f <= 5 && !back) {
    p.set(tx - 1, torsoTop - 3, "#ffffff");
    p.set(tx + tw + 1, torsoTop - 3, "#ffffff");
  }
  // ── 무기 (맨 앞) ──
  if (o.weapon && !back) weapon(p, o.weapon, hand.x, hand.y, side ? 1 : 0, swingNow, action === "cast" && f >= 3 && f <= 5);
  p.outline();
  return p;
}

/**
 * 손(x, y = 손 왼쪽 위)에 든 무기. dir 1 = 오른쪽을 봄(옆), 0 = 앞 · 뒤.
 * swing = 공격 휘두름 프레임 (칼 · 도끼는 앞으로 뻗음), glow = 시전 (지팡이 · 완드 보석이 빛남)
 */
function weapon(p: Px, w: NonNullable<Outfit["weapon"]>, x: number, y: number, dir: 0 | 1, swing: boolean, glow: boolean) {
  const c = w.c;
  switch (w.kind) {
    case "sword":
    case "dagger": {
      const len = w.kind === "sword" ? 9 : 4;
      if (swing && dir) {
        p.rect(x + 2, y, len, 1, c[0]);
        p.rect(x + 2, y + 1, len, 1, c[1]);
        p.set(x + len + 2, y + 1, c[0]);
        p.rect(x + 1, y - 1, 1, 4, GOLD[2]); // 가드
      } else if (swing) {
        for (let i = 1; i <= len; i++) { p.set(x + 1 + i, y - i, c[0]); p.set(x + 2 + i, y - i, c[1]); }
        p.rect(x + 1, y, 2, 1, GOLD[2]);
      } else {
        p.rect(x, y - len - 1, 1, len, c[0]);
        p.rect(x + 1, y - len - 1, 1, len, c[1]);
        p.set(x, y - len - 2, c[0]);
        p.rect(x - 1, y - 1, 4, 1, GOLD[2]); // 가드
        p.rect(x, y + 2, 2, 1, WOOD[2]); // 손잡이 끝
      }
      return;
    }
    case "axe": {
      if (swing && dir) {
        p.rect(x + 2, y + 1, 8, 1, WOOD[1]);
        p.part(x + 8, y - 2, 3, 4, c);
      } else if (swing) {
        for (let i = 1; i <= 6; i++) p.set(x + 1 + i, y - i, WOOD[1]);
        p.part(x + 6, y - 9, 3, 3, c);
      } else {
        p.rect(x, y - 7, 1, 10, WOOD[1]);
        p.part(x + 1, y - 8, 3, 4, c);
        p.rect(x + 3, y - 8, 1, 4, c[0]); // 날
      }
      return;
    }
    case "bow": {
      const s = dir ? 1 : 1;
      p.rect(x + 1 + (swing ? -2 : 0), y - 6, 1, 13, "#efe6d2"); // 시위 (당기면 몸 쪽)
      for (let i = -6; i <= 6; i++) p.set(x + 2 + s * Math.round(2.5 * Math.cos((i / 6) * (Math.PI / 2))), y + i, i % 3 === 0 ? c[0] : c[1]);
      return;
    }
    case "staff":
    case "wand": {
      const long = w.kind === "staff";
      const gem = w.gem ?? (long ? "#7fd3ff" : "#ffe14d");
      const top = long ? y - 13 : y - 6;
      p.rect(x, top, 1, long ? 18 : 7, c[1]);
      p.rect(x + 1, top + 1, 1, long ? 16 : 5, c[2]);
      p.rect(x - 1, top - 3, 3, 3, gem);
      p.set(x - 1, top - 3, "#ffffff");
      if (glow) for (const [dx, dy] of [[-2, -2], [2, -2], [0, -5], [0, 1]]) p.set(x + dx, top + dy, "#ffffffcc");
      return;
    }
  }
}

/** 공격(8프레임: 준비 0~1 · 휘두름 2~4 · 회수 5~7) · 시전(두 팔 들기) 팔 값 */
function armsFor(action: Action, f: number, side: boolean) {
  const out = { dx: 0, dy: 0, len: 6, raise: 0, dyL: 0 };
  if (action === "attack") {
    const s = [0, -1, 1, 3, 4, 3, 1, 0][f];
    if (side) { out.dx = s; out.dy = f >= 2 && f <= 4 ? 0 : 1; out.len = f >= 2 && f <= 4 ? 4 : 6; }
    else { out.dy = f >= 2 && f <= 4 ? -2 : 0; }
  }
  if (action === "cast") {
    out.raise = [0, 1, 2, 3, 3, 3, 2, 1][f];
    out.dyL = -out.raise;
    if (side) { out.dy = -out.raise; out.len = 6 - out.raise; }
  }
  return out;
}

/** 외형 하나의 전체 시트 (320 × 640) */
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
  const p = new Px(16, 6);
  p.ellipse(8, 3, 7, 2, "#00000044");
  p.ellipse(8, 3, 4, 1, "#00000033");
  return p.toCanvas();
}

export { CHAR_FEET };
