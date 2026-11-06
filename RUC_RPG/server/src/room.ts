import type { WebSocket } from "ws";
import { CHANNEL_CAP, INPUT_CREDITS_MAX, INPUT_CREDITS_PER_TICK, type RoomKind } from "../../../web/rpg/shared/constants.ts";
import type { GameMap } from "../../../web/rpg/shared/map.ts";
import { step, type MoveInput, type Mover } from "../../../web/rpg/shared/movement.ts";
import { F_MOVING, F_RUNNING, type ChannelInfo, type EntityInfo, type S2C } from "../../../web/rpg/shared/protocol.ts";
import type { CharacterRow } from "./db.ts";

export type Player = {
  id: number;
  ws: WebSocket;
  discordId: string;
  char: CharacterRow;
  mover: Mover;
  ms: { moveSpeed: number; endurance: number };
  inputs: MoveInput[];
  credits: number;
  lastSeq: number;
  room: Room | null;
};

export const send = (p: Player, m: S2C) => p.ws.readyState === 1 && p.ws.send(JSON.stringify(m));
export const info = (p: Player): EntityInfo => ({ id: p.id, name: p.char.nickname, ap: p.char.appearance, el: p.char.element, lv: p.char.level });

/** 방 = 맵 하나의 채널 하나 (§2-2). 광장 60명, 필드 40명이 차면 다음 채널. */
export class Room {
  players = new Map<number, Player>();
  kind: RoomKind;
  ch: number;
  map: GameMap;
  // 매개변수 프로퍼티(readonly x)는 Node 타입 제거 모드에서 못 씁니다
  constructor(kind: RoomKind, ch: number, map: GameMap) {
    this.kind = kind;
    this.ch = ch;
    this.map = map;
  }

  get full() {
    return this.players.size >= CHANNEL_CAP[this.kind];
  }

  add(p: Player) {
    for (const o of this.players.values()) send(o, { t: "spawn", e: info(p) });
    this.players.set(p.id, p);
    p.room = this;
  }

  remove(p: Player) {
    this.players.delete(p.id);
    p.room = null;
    for (const o of this.players.values()) send(o, { t: "despawn", id: p.id });
  }

  tick(now: number) {
    for (const p of this.players.values()) {
      p.credits = Math.min(p.credits + INPUT_CREDITS_PER_TICK, INPUT_CREDITS_MAX);
      while (p.inputs.length && p.credits >= 1) {
        const inp = p.inputs.shift()!;
        step(p.mover, inp, p.ms, this.map.collider);
        p.lastSeq = inp.seq;
        p.credits--;
      }
    }
    // ponytail: 방 전체를 매 틱 통째로 보냄 — §29 대역폭(10KB/s)은 P8 에서 AOI + 델타로
    const rows = [...this.players.values()].map((p) => {
      const m = p.mover;
      return [p.id, Math.round(m.x), Math.round(m.y), m.dir, (m.moving ? F_MOVING : 0) | (m.running ? F_RUNNING : 0)];
    });
    const e = JSON.stringify(rows);
    for (const p of this.players.values()) {
      if (p.ws.readyState !== 1) continue;
      p.ws.send(`{"t":"s","st":${now},"ack":${JSON.stringify({ seq: p.lastSeq, m: p.mover })},"e":${e}}`);
    }
  }
}

/** 종류별 채널 목록 */
export class Channels {
  rooms: Room[] = [];
  kind: RoomKind;
  map: GameMap;
  constructor(kind: RoomKind, map: GameMap) {
    this.kind = kind;
    this.map = map;
  }

  /** 빈 자리가 있는 가장 낮은 채널, 없으면 새 채널 */
  pick(): Room {
    const r = this.rooms.find((x) => !x.full);
    if (r) return r;
    const room = new Room(this.kind, this.rooms.length + 1, this.map);
    this.rooms.push(room);
    return room;
  }

  get(ch: number) {
    return this.rooms.find((r) => r.ch === ch);
  }

  list(): ChannelInfo[] {
    return this.rooms.map((r) => ({ ch: r.ch, n: r.players.size, cap: CHANNEL_CAP[this.kind] }));
  }

  /** 맨 끝의 빈 채널은 닫습니다 (1채널은 유지) */
  trim() {
    while (this.rooms.length > 1 && this.rooms[this.rooms.length - 1].players.size === 0) this.rooms.pop();
  }
}
