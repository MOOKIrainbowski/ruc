import { unpackMover } from "./movement.ts";
import type { EntityRow, S2C } from "./protocol.ts";

/**
 * 스냅샷 프레임 (§2-2 바이너리 · 델타, DECISIONS D71). 웹소켓 바이너리 프레임 하나:
 *   [u32 JSON 길이][JSON: t · st · ack · v · ev · pe][엔티티 레코드 …]
 * 레코드는 받는 사람마다 "지난번에 보낸 줄"과 비교한 델타 (시야 AOI 안의 엔티티만):
 *   1 전체   [u8][u32 id][u16 x][u16 y][u8 방향][u8 플래그][u16 HP‰][u16 마나‰][u16 기력‰][u16 최대 HP]  19바이트
 *   2 이동만 [u8][u32 id][i8 dx][i8 dy]                                          7바이트
 *   3 시야 밖 [u8][u32 id]                                                         5바이트
 * 바뀐 게 없는 엔티티는 아무것도 안 보냄 — 클라는 마지막 줄을 그대로 씀.
 */
const FULL = 1;
const MOVE = 2;
const GONE = 3;

/** 이번에 보낼 줄(rows)과 지난번에 보낸 줄(sent)의 차이 → 레코드. sent 는 보낸 것으로 갱신 */
export function diffRows(sent: Map<number, EntityRow>, rows: EntityRow[]): Uint8Array {
  const v = new DataView(new ArrayBuffer(rows.length * 19 + sent.size * 5));
  let o = 0;
  const seen = new Set<number>();
  for (const r of rows) {
    seen.add(r[0]);
    const old = sent.get(r[0]);
    const same = !!old && r.every((x, i) => i < 3 || old[i] === x); // 위치 말고는 그대로
    if (same && old[1] === r[1] && old[2] === r[2]) continue;
    const dx = old ? r[1] - old[1] : 999;
    const dy = old ? r[2] - old[2] : 999;
    if (same && Math.abs(dx) <= 127 && Math.abs(dy) <= 127) {
      v.setUint8(o, MOVE); v.setUint32(o + 1, r[0]); v.setInt8(o + 5, dx); v.setInt8(o + 6, dy);
      o += 7;
    } else {
      v.setUint8(o, FULL); v.setUint32(o + 1, r[0]); v.setUint16(o + 5, r[1]); v.setUint16(o + 7, r[2]);
      v.setUint8(o + 9, r[3]); v.setUint8(o + 10, r[4]); v.setUint16(o + 11, r[5]); v.setUint16(o + 13, r[6]);
      v.setUint16(o + 15, r[7]); v.setUint16(o + 17, Math.min(65535, r[8]));
      o += 19;
    }
    sent.set(r[0], r);
  }
  for (const id of sent.keys()) {
    if (seen.has(id)) continue;
    v.setUint8(o, GONE); v.setUint32(o + 1, id);
    o += 5;
    sent.delete(id);
  }
  return new Uint8Array(v.buffer, 0, o);
}

const enc = new TextEncoder();
const dec = new TextDecoder();

/** JSON 부분 + 레코드 → 프레임 한 장 */
export function frame(json: string, recs: Uint8Array): Uint8Array {
  const j = enc.encode(json);
  const out = new Uint8Array(4 + j.length + recs.length);
  new DataView(out.buffer).setUint32(0, j.length);
  out.set(j, 4);
  out.set(recs, 4 + j.length);
  return out;
}

/**
 * 프레임 읽기: JSON 부분과, 레코드를 state(엔티티 id → 지금 줄)에 적용한 결과.
 * rows = 이번에 바뀐 엔티티의 지금 줄(절대 좌표), gone = 시야 밖으로 나간 id
 */
export function readFrame(data: ArrayBuffer | Uint8Array, state: Map<number, EntityRow>): { json: Record<string, unknown>; rows: EntityRow[]; gone: number[] } {
  const u8 = data instanceof Uint8Array ? data : new Uint8Array(data);
  const v = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  const n = v.getUint32(0);
  const json = JSON.parse(dec.decode(u8.subarray(4, 4 + n)));
  // 전체 줄 크기: 새 서버는 rv = 19 를 보냄. 없으면 옛 서버(15바이트, 기력 · 최대 HP 없음) — 배포 순서가 어긋나도 깨지지 않게 (Codex 최종 확인)
  const full = json.rv === 19 ? 19 : 15;
  const rows: EntityRow[] = [];
  const gone: number[] = [];
  let o = 4 + n;
  while (o < u8.byteLength) {
    const kind = v.getUint8(o);
    const id = v.getUint32(o + 1);
    if (kind === FULL) {
      const r: EntityRow = [id, v.getUint16(o + 5), v.getUint16(o + 7), v.getUint8(o + 9), v.getUint8(o + 10), v.getUint16(o + 11), v.getUint16(o + 13), full === 19 ? v.getUint16(o + 15) : 1000, full === 19 ? v.getUint16(o + 17) : 0];
      state.set(id, r);
      rows.push(r);
      o += full;
    } else if (kind === MOVE) {
      const old = state.get(id);
      if (old) {
        const r: EntityRow = [id, old[1] + v.getInt8(o + 5), old[2] + v.getInt8(o + 6), old[3], old[4], old[5], old[6], old[7], old[8]];
        state.set(id, r);
        rows.push(r);
      }
      o += 7;
    } else {
      state.delete(id);
      gone.push(id);
      o += 5;
    }
  }
  return { json, rows, gone };
}

/** 프레임 → 스냅샷 메시지 (클라이언트 Net · 테스트 공용). state = 이 연결이 지금까지 받은 줄 */
export function decodeSnapshot(data: ArrayBuffer | Uint8Array, state: Map<number, EntityRow>): Extract<S2C, { t: "s" }> {
  const { json: j, rows, gone } = readFrame(data, state);
  const ack = j.ack as { seq: number; m: number[] };
  return { t: "s", st: j.st as number, ack: { seq: ack.seq, m: unpackMover(ack.m) }, v: j.v as number[], e: rows, g: gone, ...(j.ev ? { ev: j.ev as never } : {}), ...(j.pe ? { pe: j.pe as never } : {}) };
}
