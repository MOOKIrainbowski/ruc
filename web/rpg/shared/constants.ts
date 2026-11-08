/** 클라이언트 · 게임 서버 공용 상수. 밸런스 값은 data/ 에 있습니다. */

export const TILE = 16;
export const TICK_MS = 50; // 서버 틱 20Hz
/** 클라이언트 입력 · 이동 시뮬레이션 스텝 (DECISIONS D9). 서버도 같은 값으로 재생합니다. */
export const SIM_MS = 1000 / 60;
/** 서버가 틱마다 처리하는 입력 크레딧 (TICK_MS / SIM_MS) 과 상한 */
export const INPUT_CREDITS_PER_TICK = 3;
export const INPUT_CREDITS_MAX = 9;
export const INPUT_QUEUE_MAX = 30;
export const INTERP_DELAY_MS = 100;

/** 캐릭터 프레임 (3등신, 2026-11 개선): 32×40, 발밑 = 위에서 34px */
export const CHAR_W = 32;
export const CHAR_H = 40;
export const CHAR_FEET = 34;

/** 시트 행 순서 (§25-4). 인덱스가 곧 방향 번호. */
export const DIRS = ["S", "SE", "E", "NE", "N", "NW", "W", "SW"] as const;
export type Dir = (typeof DIRS)[number];
export const DIR_KO = ["남", "남동", "동", "북동", "북", "북서", "서", "남서"];

/** 방 종류별 정원. 광장 · 필드 · 결투장은 채널, 던전은 파티마다 인스턴스 (P7) */
export const CHANNEL_CAP = { plaza: 60, field: 40, arena: 40, dungeon: 5 } as const;
export type RoomKind = keyof typeof CHANNEL_CAP;

export const WS_PORT = 2567;
