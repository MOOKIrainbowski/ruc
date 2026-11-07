import { castMs } from "./combat.ts";
import { SIM_MS, TILE } from "./constants.ts";
import type { SkillDef, Slot } from "./data/skills.ts";
import { MOVE, ROLL, STAMINA } from "./data/stats.ts";

/**
 * 이동 한 스텝 — 클라이언트 예측과 서버가 똑같이 돌립니다 (§2-2).
 * 같은 입력이면 같은 결과입니다 — JSON 은 double 을 정확히 왕복시키므로 서버 ack 값으로 그대로 이어서 재생해도 떨림이 없습니다.
 * 구르기 · 돌진 · 시전 고정 · 조준 방향도 여기서 다뤄 예측이 어긋나지 않게 합니다 (DECISIONS D12).
 * 결정성 때문에 sqrt 만 쓰고 hypot · cos 는 쓰지 않습니다 (sqrt 는 어디서나 같은 값).
 */

/** dg = 구르기, k = 스킬 슬롯(A = 평타), ax · ay = 조준 지점(월드 px, 정수), cs = 차지 스킬 모으기 시작한 슬롯 */
export type MoveInput = { seq: number; mx: number; my: number; run: boolean; dg?: 1; k?: Slot; ax?: number; ay?: number; cs?: Slot };

export type Mover = {
  x: number; // 발밑 중심 (px)
  y: number;
  dir: number; // DIRS 인덱스
  stamina: number;
  staminaMax: number;
  /** 스태미나를 마지막으로 쓴 뒤 지난 시간 (ms) */
  restMs: number;
  exhausted: boolean;
  moving: boolean;
  running: boolean;
  /** 최종 이동 속도 · 지구력 · 공격 속도 (서버가 버프 · 디버프를 반영해 채움) */
  spd: number;
  endu: number;
  aspd: number;
  /** 이동 불가 (속박 · 기절 · 사망 …) */
  root: boolean;
  /** 강제 이동(구르기 · 돌진) 남은 스텝과 스텝당 이동량 */
  mv: number;
  mvx: number;
  mvy: number;
  /** 무적 남은 스텝 (구르기 앞부분) · 다음 구르기까지 · 시전 고정 · 조준 방향 유지 */
  ifr: number;
  rollCd: number;
  lock: number;
  aim: number;
};

export type Collider = { w: number; h: number; solid: Uint8Array };

export function newMover(x: number, y: number, s: { stamina: number; moveSpeed: number; endurance: number; atkSpeed: number }): Mover {
  return {
    x, y, dir: 0, stamina: s.stamina, staminaMax: s.stamina, restMs: 0, exhausted: false, moving: false, running: false,
    spd: s.moveSpeed, endu: s.endurance, aspd: s.atkSpeed, root: false, mv: 0, mvx: 0, mvy: 0, ifr: 0, rollCd: 0, lock: 0, aim: 0,
  };
}

/** 이동 벡터 → 8방향 인덱스 (S=0, SE, E, NE, N, NW, W, SW). 화면 좌표계(y 아래). */
export function dir8(dx: number, dy: number): number {
  const deg = (Math.atan2(dy, dx) * 180) / Math.PI;
  return ((Math.round((90 - deg) / 45) % 8) + 8) % 8;
}
const D = Math.SQRT1_2;
/** 방향 인덱스 → 단위 벡터 */
export const DIR_VEC: [number, number][] = [[0, 1], [D, D], [1, 0], [D, -D], [0, -1], [-D, -D], [-1, 0], [-D, D]];

export function isSolidAt(c: Collider, px: number, py: number): boolean {
  const tx = Math.floor(px / TILE);
  const ty = Math.floor(py / TILE);
  if (tx < 0 || ty < 0 || tx >= c.w || ty >= c.h) return true;
  return c.solid[ty * c.w + tx] === 1;
}

/** 발밑 상자가 막힌 타일과 겹치는가 */
export function blocked(c: Collider, x: number, y: number): boolean {
  const l = x - MOVE.boxW / 2;
  const r = x + MOVE.boxW / 2 - 0.01;
  const t = y - MOVE.boxH;
  const b = y - 0.01;
  return isSolidAt(c, l, t) || isSolidAt(c, r, t) || isSolidAt(c, l, b) || isSolidAt(c, r, b);
}

/** 축을 나눠 움직여 벽을 따라 미끄러지게 합니다 */
export function slide(m: { x: number; y: number }, c: Collider, dx: number, dy: number) {
  const nx = m.x + dx;
  if (!blocked(c, nx, m.y)) m.x = nx;
  const ny = m.y + dy;
  if (!blocked(c, m.x, ny)) m.y = ny;
}

/** 스태미나 소모: 기본 × 100 / (100 + 지구력) (§6-3) */
export function spend(m: Mover, base: number) {
  if (!base) return;
  m.stamina = Math.max(0, m.stamina - (base * 100) / (100 + m.endu));
  m.restMs = 0;
  if (m.stamina === 0) m.exhausted = true;
}

export const canRoll = (m: Mover) => !m.root && !m.exhausted && m.stamina > 0 && m.mv === 0 && m.lock === 0 && m.rollCd === 0;

/** 구르기: 누르고 있는 방향, 없으면 바라보는 방향으로 */
export function tryRoll(m: Mover, input: MoveInput) {
  if (!canRoll(m)) return;
  const mx = Math.sign(input.mx);
  const my = Math.sign(input.my);
  const d = mx || my ? dir8(mx, my) : m.dir;
  const [vx, vy] = DIR_VEC[d];
  spend(m, STAMINA.dodge);
  m.dir = d;
  m.mv = ROLL.steps;
  m.mvx = (vx * ROLL.dist) / ROLL.steps;
  m.mvy = (vy * ROLL.dist) / ROLL.steps;
  m.ifr = ROLL.iframeSteps;
  m.rollCd = ROLL.steps + ROLL.cdSteps;
  m.aim = 0;
}

/** 시전 0.5초 뒤까지 마우스 쪽을 봄 (§5) */
const AIM_HOLD = Math.round(500 / SIM_MS);

/** 순간이동 도착점: 조준 쪽 range 안, 막힌 곳이면 4px 씩 당겨 옴 (벽은 넘을 수 있음) */
export function blinkDest(c: Collider, x: number, y: number, ax: number, ay: number, range: number): { x: number; y: number } {
  const dx = ax - x;
  const dy = ay - y;
  const len = Math.sqrt(dx * dx + dy * dy);
  if (!len) return { x, y };
  for (let t = Math.min(len, range); t > 0; t -= 4) {
    const nx = x + (dx / len) * t;
    const ny = y + (dy / len) * t;
    if (!blocked(c, nx, ny)) return { x: nx, y: ny };
  }
  return { x, y };
}

/**
 * 스킬이 받아들여졌을 때 움직임 쪽 효과 — 서버는 검증 뒤, 클라이언트는 예측 때 똑같이 부릅니다.
 * range = 등급 반영 사거리, to = 돌진 목표(아군 돌진은 서버가 아군 위치로 — 클라는 커서로 예측하고 보정받음)
 */
export function castMove(m: Mover, sk: SkillDef, ax: number, ay: number, c: Collider, range = sk.range, to?: { x: number; y: number }) {
  spend(m, sk.cost.stamina ?? 0);
  const dx = ax - m.x;
  const dy = ay - m.y;
  if (dx || dy) m.dir = dir8(dx, dy);
  m.lock = Math.max(sk.castMs ? Math.round(castMs(sk.castMs, m.aspd) / SIM_MS) : 0, sk.lockMs ? Math.round(sk.lockMs / SIM_MS) : 0);
  m.aim = m.lock + AIM_HOLD;
  if (sk.dashSteps && (sk.targeting === "dash" || sk.targeting === "ally")) {
    const tx = (to?.x ?? ax) - m.x;
    const ty = (to?.y ?? ay) - m.y;
    const len = Math.sqrt(tx * tx + ty * ty);
    let [ux, uy] = len ? [tx / len, ty / len] : DIR_VEC[m.dir];
    if (sk.back) [ux, uy] = [-ux, -uy];
    // 아군 돌진은 아군 앞(12px)까지만
    const dist = sk.targeting === "ally" ? Math.max(0, Math.min(range, len - 12)) : range;
    m.mv = sk.dashSteps;
    m.mvx = (ux * dist) / sk.dashSteps;
    m.mvy = (uy * dist) / sk.dashSteps;
  }
  if (sk.targeting === "blink") {
    const d = blinkDest(c, m.x, m.y, ax, ay, range);
    m.x = d.x;
    m.y = d.y;
  }
}

export function step(m: Mover, input: MoveInput, c: Collider): void {
  if (m.rollCd > 0) m.rollCd--;
  if (m.ifr > 0) m.ifr--;
  if (m.aim > 0) m.aim--;
  const forced = m.mv > 0;
  const free = !forced && m.lock === 0 && !m.root;
  if (m.lock > 0) m.lock--;
  const mx = free ? Math.sign(input.mx) : 0;
  const my = free ? Math.sign(input.my) : 0;
  const moving = mx !== 0 || my !== 0;
  const running = moving && input.run && !m.exhausted && m.stamina > 0;

  // 스태미나 (§6-3)
  if (running) {
    m.stamina = Math.max(0, m.stamina - (STAMINA.runPerSec * (SIM_MS / 1000) * 100) / (100 + m.endu));
    m.restMs = 0;
    if (m.stamina === 0) m.exhausted = true;
  } else {
    m.restMs = Math.min(m.restMs + SIM_MS, 60_000);
    if (m.restMs >= STAMINA.regenDelayMs) {
      m.stamina = Math.min(m.staminaMax, m.stamina + m.staminaMax * STAMINA.regenPctPerSec * (SIM_MS / 1000));
    }
    if (m.exhausted && m.stamina >= m.staminaMax * STAMINA.recoverPct) m.exhausted = false;
  }

  m.moving = moving || forced;
  m.running = running;
  if (forced) {
    m.mv--;
    slide(m, c, m.mvx, m.mvy);
    return;
  }
  if (!moving) return;

  if (m.aim === 0) m.dir = dir8(mx, my);
  const speed = Math.min(m.spd, MOVE.speedCap) * (running ? MOVE.runMul : 1) * (m.exhausted ? MOVE.exhaustedMul : 1);
  let dist = (speed / 100) * MOVE.pxPerSecAt100 * (SIM_MS / 1000);
  if (mx !== 0 && my !== 0) dist *= Math.SQRT1_2;
  slide(m, c, mx * dist, my * dist);
}
