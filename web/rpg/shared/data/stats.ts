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

/** §6-1 보조 스탯 기본값 (장비 · 버프로만 오름) + 속성 패시브용 항목 */
export const SECONDARY = {
  crit: 0.05, critDmg: 1.5, penPhys: 0, penMag: 0, cdr: 0, tenacity: 0, lifesteal: 0, spellVamp: 0,
  /** 주는 피해 +% · 받는 피해 −% · 받는 피해 +%(표식) · 스킬 피해 +% · 도트 피해 +% */
  dmgUp: 0, dmgDown: 0, dmgTakenUp: 0, skillDmg: 0, dotDmg: 0,
  /** 받는 근접 피해 −% (얼음 패시브) */
  meleeDown: 0,
  healTaken: 0, healPower: 0, projSpeed: 0, elPen: 0,
};

/** §6-3 상한 */
export const CAPS = { atkSpeed: 250, moveSpeed: 200, cdr: 0.4, tenacity: 0.5, luck: 200, dmgDown: 0.9 };

export const COMBAT = {
  /** 5초간 피해를 주고받지 않으면 비전투 */
  outOfCombatMs: 5000,
  regenPerPoint: 0.4,
  regenInCombatMul: 0.25,
  /** 마나 · 기력 초당 회복 (최대치 비율) */
  resPerSec: 0.015,
  resPerSecIdle: 0.03,
  /** 탈진 중 초당 최대 HP 감소 비율 (HP 1 아래로는 안 내려감) */
  exhaustDrain: 0.005,
  respawnMs: 5000,
  /** 사망 시 현재 레벨 필요 경험치의 3% 손실 (§13-4) */
  deathExpLoss: 0.03,
  /** hardCC 체감: 10초 안에 다시 받으면 50% → 25% → 면역, 끝난 뒤 0.5초 면역 (§11-3) */
  drWindowMs: 10_000,
  drSteps: [1, 0.5, 0.25, 0],
  ccImmuneMs: 500,
  /** 지연 보상 되감기 상한 (§2-2) */
  lagCompMaxMs: 150,
  maxLevel: 40,
};

/** 구르기 (§5): 0.3초에 56px, 앞 0.2초 무적. 단위는 이동 스텝(1/60초) */
export const ROLL = { steps: 18, dist: 56, iframeSteps: 12, cdSteps: 12 };
