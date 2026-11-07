import type { FullStats } from "./combat.ts";
import type { RoomKind } from "./constants.ts";
import type { Appearance } from "./data/appearance.ts";
import type { Item, ItemPos, Rarity } from "./data/items.ts";
import type { Grade } from "./data/mobs.ts";
import type { Slot } from "./data/skills.ts";
import type { MoveInput, Mover } from "./movement.ts";

/** 네트워크 메시지 (§27). 베타는 JSON (DECISIONS D4). 필드 이름은 짧게. */

/** 플레이어는 ap(외형) · look(옷 색을 바꾸는 장비 템플릿 id), 몹은 mob(종류) · grade */
export type EntityInfo = { id: number; name: string; el: string; lv: number; ap?: Appearance; look?: string[]; mob?: string; grade?: Grade };
/** 스냅샷 한 줄: [id, x, y, dir, flags, HP 천분율, 마나 또는 기력 천분율] */
export type EntityRow = [number, number, number, number, number, number, number];
export const F_MOVING = 1;
export const F_RUNNING = 2;
export const F_ROLL = 4;
export const F_DEAD = 8;
export const F_CAST = 16;

/** 내 상태: [HP, 최대, 마나, 최대, 기력, 최대, 보호막, SLOTS 순서(A Q W E R)로 ack 시점의 남은 쿨(ms), 포션 공유 쿨(ms)] */
export type Vitals = number[];
/** 걸린 효과 한 줄: [효과 id, 남은 ms, 스택, 전체 ms, 값] */
export type FxRow = [string, number, number, number, number];

/** 피해 표시 플래그 */
export const H_CRIT = 1;
export const H_HEAL = 2;
export const H_MISS = 4;
export const H_IMMUNE = 8;
export const H_DOT = 16;
export const H_RESIST = 32;

/**
 * 방 이벤트 (모두에게):
 *  ["h", 때린 id, 맞은 id, 양, 플래그, 속성]      피해 · 치유
 *  ["c", id, 스킬 id, 조준 x, y]                   시전 · 몹 공격 모션
 *  ["p", 투사체 id, 주인 id, 종류, 속성, x, y, 초당 vx, vy, 사거리, 입력 seq]
 *  ["px", 투사체 id]                               투사체 소멸
 *  ["w", "circle"|"line", x, y, 각도(rad), 크기, 폭, ms]   바닥 경고 (§10-2)
 *  ["f", id, FxRow[]]                              효과 목록 바뀜
 *  ["d", id]                                       쓰러짐
 *  ["lv", id, 레벨]
 *  ["dr", 드롭 id, 템플릿, 희귀도, 개수, x, y]     바닥 아이템 (처치 기여자에게는 개인 이벤트로 먼저, 30초 뒤 모두에게)
 *  ["dx", 드롭 id, 주운 id(0 = 사라짐)]
 *  ["eq", id, look[]]                               옷 색이 바뀌는 장비를 바꿔 입음
 * 개인 이벤트:
 *  ["cf", seq, 이유]                               시전 거부 → 예측 취소
 *  ["xp", 얻은 양, 현재 경험치, 레벨]
 *  ["dead", 부활까지 ms]
 *  ["get", 템플릿, 개수, 희귀도]                    주움
 *  ["du", 아이템 id, 내구도]                         내구도 바뀜
 */
export type Ev = (string | number | FxRow[] | string[])[];
export type DropRow = ["dr", number, string, Rarity, number, number, number];

export type You = {
  id: number;
  nickname: string;
  level: number;
  exp: number;
  element: string;
  appearance: Appearance;
  ruc: number;
  kda: [number, number, number];
  settings: Record<string, unknown> | null;
  slots: Partial<Record<Slot, string>>;
};

export type ChannelInfo = { ch: number; n: number; cap: number };

export type C2S =
  | { t: "hello"; ticket: string }
  | { t: "create"; nickname: string; appearance: Appearance; element: string }
  | ({ t: "in" } & MoveInput)
  | { t: "ping"; c: number; r?: number }
  | { t: "settings"; data: Record<string, unknown> }
  | { t: "channel"; ch: number }
  /** 상호작용(F): 포털 등 맵 오브젝트 id */
  | { t: "use"; oid: number }
  /** 아이템 (§15): 옮기기(n = 나눌 개수) · 사용/장착 · 버리기 · 정렬 */
  | { t: "item"; op: "move" | "use" | "drop" | "sort"; a?: ItemPos; b?: ItemPos; n?: number; loc?: "inventory" | "storage" }
  /** 개발 모드 전용: 순간이동 · 아이템 받기 */
  | { t: "dev"; map?: RoomKind; x?: number; y?: number; give?: string; rarity?: Rarity; n?: number };

export type S2C =
  | { t: "needCreate"; defaultName: string }
  | { t: "createError"; msg: string }
  | {
      t: "joined"; you: You; room: { kind: RoomKind; ch: number }; me: Mover; ents: EntityInfo[]; fx: [number, FxRow[]][];
      channels: ChannelInfo[]; stats: FullStats; items: Item[]; drops: DropRow[];
    }
  | { t: "spawn"; e: EntityInfo }
  | { t: "despawn"; id: number }
  | { t: "s"; st: number; ack: { seq: number; m: Mover }; v: Vitals; e: EntityRow[]; ev?: Ev[]; pe?: Ev[] }
  | { t: "stats"; s: FullStats }
  | { t: "inv"; items: Item[] }
  | { t: "pong"; c: number }
  | { t: "channels"; list: ChannelInfo[] }
  | { t: "kicked"; reason: "dup" | "rate" | "auth" | "server" }
  | { t: "error"; msg: string };
