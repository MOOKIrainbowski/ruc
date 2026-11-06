import { SIM_MS, TILE } from "./constants.ts";
import { MOVE, STAMINA } from "./data/stats.ts";

/**
 * 이동 한 스텝 — 클라이언트 예측과 서버가 똑같이 돌립니다 (§2-2).
 * 같은 입력이면 같은 결과입니다 — JSON 은 double 을 정확히 왕복시키므로 서버 ack 값으로 그대로 이어서 재생해도 떨림이 없습니다.
 */

export type MoveInput = { seq: number; mx: number; my: number; run: boolean };

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
};

export type Collider = { w: number; h: number; solid: Uint8Array };

export type MoveStats = { moveSpeed: number; endurance: number };

/** 이동 벡터 → 8방향 인덱스 (S=0, SE, E, NE, N, NW, W, SW). 화면 좌표계(y 아래). */
export function dir8(dx: number, dy: number): number {
  const deg = (Math.atan2(dy, dx) * 180) / Math.PI;
  return ((Math.round((90 - deg) / 45) % 8) + 8) % 8;
}

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

export function step(m: Mover, input: MoveInput, stats: MoveStats, c: Collider): void {
  const mx = Math.sign(input.mx);
  const my = Math.sign(input.my);
  const moving = mx !== 0 || my !== 0;
  const running = moving && input.run && !m.exhausted && m.stamina > 0;

  // 스태미나 (§6-3)
  if (running) {
    m.stamina = Math.max(0, m.stamina - (STAMINA.runPerSec * (SIM_MS / 1000) * 100) / (100 + stats.endurance));
    m.restMs = 0;
    if (m.stamina === 0) m.exhausted = true;
  } else {
    m.restMs = Math.min(m.restMs + SIM_MS, 60_000);
    if (m.restMs >= STAMINA.regenDelayMs) {
      m.stamina = Math.min(m.staminaMax, m.stamina + m.staminaMax * STAMINA.regenPctPerSec * (SIM_MS / 1000));
    }
    if (m.exhausted && m.stamina >= m.staminaMax * STAMINA.recoverPct) m.exhausted = false;
  }

  m.moving = moving;
  m.running = running;
  if (!moving) return;

  m.dir = dir8(mx, my);
  const speed = Math.min(stats.moveSpeed, MOVE.speedCap) * (running ? MOVE.runMul : 1) * (m.exhausted ? MOVE.exhaustedMul : 1);
  let dist = (speed / 100) * MOVE.pxPerSecAt100 * (SIM_MS / 1000);
  if (mx !== 0 && my !== 0) dist *= Math.SQRT1_2;

  // 축을 나눠 움직여 벽을 따라 미끄러지게 합니다
  const nx = m.x + mx * dist;
  if (!blocked(c, nx, m.y)) m.x = nx;
  const ny = m.y + my * dist;
  if (!blocked(c, m.x, ny)) m.y = ny;
}
