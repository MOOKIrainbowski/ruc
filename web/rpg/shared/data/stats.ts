/** §6-2 · §6-3 초기 밸런스 값. 로직은 이 값을 읽기만 합니다. */

export const BASE_STATS = {
  hp: 200, stamina: 100, mana: 100, energy: 100,
  atk: 10, ap: 10, atkSpeed: 100, moveSpeed: 100,
  pdef: 10, mdef: 10, spirit: 10, regen: 5, endurance: 10,
  potentialPhys: 10, potentialMag: 10, luck: 5,
};

export const LEVEL_GROWTH = {
  hp: 20, mana: 8, energy: 8, atk: 2, ap: 2, pdef: 1.5, mdef: 1.5,
  spirit: 1, moveSpeed: 0.3, endurance: 0.1, stamina: 1,
};

export const MOVE = {
  /** 이동속도 100 = 초당 64px */
  pxPerSecAt100: 64,
  runMul: 1.6,
  speedCap: 200,
  exhaustedMul: 0.7,
  /** 캐릭터 발밑 충돌 상자 (px) */
  boxW: 14,
  boxH: 8,
};

export const STAMINA = {
  runPerSec: 12,
  dodge: 20,
  basicAttack: 3,
  regenDelayMs: 1500,
  regenPctPerSec: 0.15,
  /** 탈진 해제 기준 */
  recoverPct: 0.2,
};
