import { DUEL, KDA } from "../../../web/rpg/shared/data/party.ts";
import { effectDef } from "../../../web/rpg/shared/data/effects.ts";
import { removeEffect } from "./combat.ts";
import { addKda } from "./db.ts";
import { online } from "./economy.ts";
import { partyOf } from "./party.ts";
import { quest } from "./quests.ts";
import { hooks, send, type Player, type Room } from "./room.ts";

/**
 * PvP (§13-3): 결투장(상시 PvP · 같은 파티 제외)과 필드 결투(1:1 · 파티 대 파티). 적대 판정은 Room.hostile.
 * 결투에서 진 사람은 쓰러지지 않고 체력 1로 빠짐 (페널티 없음). K/D/A 는 시즌 단위로 DB 에 쌓음.
 */

type Duel = { id: number; room: Room; sides: [Set<Player>, Set<Player>]; startAt: number; endAt: number; started: boolean };
type Ask = { id: number; from: Player; to: Player; party: boolean; until: number };
const duels = new Map<number, Duel>();
const asks = new Map<number, Ask>();
let seq = 1;

const tell = (p: Player, msg: string) => send(p, { t: "error", msg });

export function kda(p: Player, k: number, d: number, a: number) {
  p.kda = [p.kda[0] + k, p.kda[1] + d, p.kda[2] + a];
  addKda(p.char.id, KDA.season, k, d, a);
  send(p, { t: "kda", kda: p.kda });
}

/** 쓰러뜨림 기록: 처치 · 사망 · 어시스트(처치 전 10초 안에 피해 · 디버프를 준 다른 플레이어) */
function credit(room: Room, victim: Player, killer: Player | undefined) {
  if (killer) kda(killer, 1, 0, 0);
  kda(victim, 0, 1, 0);
  for (const [id, at] of victim.hitBy) {
    const q = room.players.get(id);
    if (q && q !== killer && room.now - at <= KDA.assistMs) kda(q, 0, 0, 1);
  }
  victim.hitBy.clear();
}

/** 결투장에서 쓰러짐 */
hooks.pvpKill = (room, p, by) => credit(room, p, by);

/** 결투 패배 (체력 1로 빠짐) */
hooks.defeat = (room, p, by) => {
  p.duelOn = false;
  credit(room, p, by);
  room.ev.push(["ann", `${p.char.nickname} 패배!`, 1500, p.id]);
};

/** 결투 중에 방을 떠나면 기권 */
hooks.left = (_room, p) => {
  if (!p.duel) return;
  p.duelOn = false;
  const d = duels.get(p.duel);
  if (d) for (const s of d.sides) s.delete(p);
  p.duel = 0;
};

export function duelOp(p: Player, m: { op?: unknown; name?: unknown; party?: unknown; id?: unknown }): string | null {
  const now = Date.now();
  if (m.op === "ask") {
    const room = p.room;
    if (!room || room.kind !== "field") return "결투는 햇살 초원에서 신청할 수 있습니다 (결투장은 언제나 PvP)";
    const name = String(m.name ?? "").trim().toLowerCase();
    const q = [...room.players.values()].find((o) => o.char.nickname.toLowerCase() === name);
    if (!q || q === p) return "같은 채널에 있는 모험가를 골라 주세요";
    if (p.duel || q.duel) return "이미 결투 중입니다";
    if (p.dead || q.dead) return "쓰러진 상태입니다";
    if (Math.hypot(p.x - q.x, p.y - q.y) > DUEL.range) return "상대에게 조금 더 가까이 가세요 (20타일 안)";
    const party = m.party === true;
    if (party) {
      const a = partyOf(p);
      const b = partyOf(q);
      if (!a || !b || a === b || a.leader !== p.char.id || b.leader !== q.char.id) return "파티 대 파티 결투는 서로 다른 파티의 파티장끼리 신청합니다";
    } else if (partyOf(p) && partyOf(p) === partyOf(q)) return "같은 파티원과는 결투할 수 없습니다";
    const ask: Ask = { id: seq++, from: p, to: q, party, until: now + DUEL.askMs };
    asks.set(ask.id, ask);
    send(q, { t: "ask", kind: "duel", id: ask.id, from: p.char.nickname, party });
    tell(p, `${q.char.nickname}님에게 ${party ? "파티 " : ""}결투를 신청했습니다`);
    return null;
  }
  const a = asks.get(Number(m.id));
  if (!a || a.to !== p) return null;
  asks.delete(a.id);
  if (m.op === "decline") { tell(a.from, `${p.char.nickname}님이 결투를 거절했습니다`); return null; }
  if (a.until < now) return "결투 신청이 만료되었습니다";
  const room = p.room;
  if (!room || a.from.room !== room || a.from.dead || p.dead || a.from.duel || p.duel) return "결투를 시작할 수 없습니다";
  const team = (x: Player) => {
    if (!a.party) return [x];
    const pt = partyOf(x);
    return pt ? pt.members.map((cid) => online.byChar(cid)).filter((o): o is Player => !!o && o.room === room && !o.dead && !o.duel) : [x];
  };
  const d: Duel = { id: seq++, room, sides: [new Set(team(a.from)), new Set(team(p))], startAt: room.now + DUEL.countdownMs, endAt: room.now + DUEL.countdownMs + DUEL.maxMs, started: false };
  duels.set(d.id, d);
  d.sides.forEach((s, i) => {
    const foes = [...d.sides[1 - i]].map((o) => o.id);
    for (const o of s) {
      o.duel = d.id;
      o.duelSide = i;
      o.duelOn = false;
      o.out.push(["duel", "start", foes, DUEL.countdownMs]);
    }
  });
  return null;
}

function end(d: Duel, win: number) {
  duels.delete(d.id);
  const all = [...d.sides[0], ...d.sides[1]];
  const ids = new Set(all.map((o) => o.id));
  for (const o of all) {
    if (o.duel !== d.id) continue;
    o.duel = 0;
    o.duelOn = false;
    // 상대가 건 디버프는 정리
    for (const e of [...o.fx]) if (ids.has(e.src) && !effectDef(e.id)?.buff) removeEffect(d.room, o, e.id);
    const side = d.sides[0].has(o) ? 0 : 1;
    const res = win < 0 ? "draw" : side === win ? "win" : "lose";
    o.out.push(["duel", "end", [], res]);
    if (res === "win") quest(o, "duel");
  }
}

/** 매 틱: 카운트다운 → 시작, 한쪽이 다 빠지면 끝, 3분이면 무승부 */
export function duelTick(now: number) {
  for (const [id, a] of asks) if (a.until < now) asks.delete(id);
  for (const d of [...duels.values()]) {
    if (!d.started && now >= d.startAt) {
      d.started = true;
      for (const s of d.sides) for (const o of s) if (o.duel === d.id && o.room === d.room && !o.dead) o.duelOn = true;
    }
    if (!d.started) continue;
    const left = d.sides.map((s) => [...s].filter((o) => o.duel === d.id && o.duelOn && !o.dead && o.room === d.room).length);
    if (!left[0] || !left[1]) end(d, left[0] ? 0 : left[1] ? 1 : -1);
    else if (now >= d.endAt) end(d, -1);
  }
}

/** 현황판 (Tab): 같은 방의 모험가 · K/D/A */
export function who(p: Player) {
  if (!p.room) return;
  const pt = partyOf(p);
  const list = [...p.room.players.values()].map((o) => ({ name: o.char.nickname, lv: o.char.level, jb: o.prog.job ?? o.prog.line ?? "", kda: o.kda, party: !!pt && pt.members.includes(o.char.id) }));
  send(p, { t: "who", list });
}
