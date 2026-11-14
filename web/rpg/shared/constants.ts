/** 클라이언트 · 게임 서버 공용 상수. 밸런스 값은 data/ 에 있습니다. */

export const TILE = 16;
export const TICK_MS = 50; // 서버 틱 20Hz
/** 클라이언트 입력 · 이동 시뮬레이션 스텝 (DECISIONS D9). 서버도 같은 값으로 재생합니다. */
export const SIM_MS = 1000 / 60;
/** 이동 규칙(movement.ts)을 바꾸면 올릴 것 — 맵 충돌 칸과 함께 simHash 에 들어가 서버 · 클라 버전 차이를 잡음 */
export const SIM_VERSION = 2;
/** 스냅샷 바이너리 줄 형식(snapshot.ts) 버전 — 형식을 바꾸면 올릴 것 (simHash 에 들어감, Codex 리뷰) */
export const SNAP_VERSION = 2;
/** 서버가 틱마다 처리하는 입력 크레딧 (TICK_MS / SIM_MS) 과 상한 */
export const INPUT_CREDITS_PER_TICK = 3;
export const INPUT_CREDITS_MAX = 9;
export const INPUT_QUEUE_MAX = 30;
/** 스냅샷은 틱 2번에 한 번 (10Hz) — 시뮬레이션은 20Hz 그대로 (§29 대역폭, D71). 보간은 스냅샷 1.5개만큼 뒤 */
export const SNAP_EVERY = 2;
export const SNAP_MS = TICK_MS * SNAP_EVERY;
export const INTERP_DELAY_MS = 150;
/** 관심 영역 (AOI, §29): 내 위치에서 가로 · 세로 이 거리 안의 엔티티만 받음 (4K 화면 · 확대 ×2 보다 넓게) */
export const AOI = { w: 1000, h: 640 };

/** 캐릭터 프레임 (3등신, 2026-11 개선): 32×40, 발밑 = 위에서 34px */
export const CHAR_W = 32;
export const CHAR_H = 40;
export const CHAR_FEET = 34;

/** 시트 행 순서 (§25-4). 인덱스가 곧 방향 번호. */
export const DIRS = ["S", "SE", "E", "NE", "N", "NW", "W", "SW"] as const;
export type Dir = (typeof DIRS)[number];
export const DIR_KO = ["남", "남동", "동", "북동", "북", "북서", "서", "남서"];

/** 방 종류별 정원. 광장 · 필드 · 결투장은 채널, 던전은 파티마다 인스턴스 (P7) */
export const CHANNEL_CAP = { plaza: 60, field: 40, arena: 40, dungeon: 5, highland: 40 } as const;
export type RoomKind = keyof typeof CHANNEL_CAP;

export const WS_PORT = 2567;
