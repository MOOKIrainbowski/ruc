import type { RoomKind } from "./constants.ts";
import type { Appearance } from "./data/appearance.ts";
import type { Mover } from "./movement.ts";

/** 네트워크 메시지 (§27). 베타는 JSON (DECISIONS D4). 필드 이름은 짧게. */

export type EntityInfo = { id: number; name: string; ap: Appearance; el: string; lv: number };
/** 스냅샷 한 줄: [id, x, y, dir, flags]  flags: 1 이동 · 2 달리기 */
export type EntityRow = [number, number, number, number, number];
export const F_MOVING = 1;
export const F_RUNNING = 2;

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
  ms: { moveSpeed: number; endurance: number };
};

export type ChannelInfo = { ch: number; n: number; cap: number };

export type C2S =
  | { t: "hello"; ticket: string }
  | { t: "create"; nickname: string; appearance: Appearance; element: string }
  | { t: "in"; seq: number; mx: number; my: number; run: boolean }
  | { t: "ping"; c: number }
  | { t: "settings"; data: Record<string, unknown> }
  | { t: "channel"; ch: number };

export type S2C =
  | { t: "needCreate"; defaultName: string }
  | { t: "createError"; msg: string }
  | { t: "joined"; you: You; room: { kind: RoomKind; ch: number }; me: Mover; players: EntityInfo[]; channels: ChannelInfo[] }
  | { t: "spawn"; e: EntityInfo }
  | { t: "despawn"; id: number }
  | { t: "s"; st: number; ack: { seq: number; m: Mover }; e: EntityRow[] }
  | { t: "pong"; c: number }
  | { t: "channels"; list: ChannelInfo[] }
  | { t: "kicked"; reason: "dup" | "rate" | "auth" | "server" }
  | { t: "error"; msg: string };
