import { PARTY, PING, PINGS, type PartyAd, type PartyVitals, type PartyView } from "../../../web/rpg/shared/data/party.ts";
import { TILE } from "../../../web/rpg/shared/constants.ts";
import { jobRes } from "../../../web/rpg/shared/data/jobs.ts";
import { online } from "./economy.ts";
import { notify, quest } from "./quests.ts";
import { hooks, send, type Player } from "./room.ts";

/**
 * 파티 (§21). 메모리에만 둠 — 게임 서버를 다시 켜면 풀림 (D57). 파티원은 캐릭터 id 로 들고 있고,
 * 접속이 끊긴 파티원은 1분 동안 자리를 지켜 줌(새로고침해도 유지). 파티장이 나가면 다음 사람이 파티장.
 */

export type Party = {
  id: number;
  leader: number;
  members: number[];
  open: boolean;
  note: string;
  /** 초대 · 가입 신청 → 만료 시각 */
  invites: Map<number, number>;
  requests: Map<number, { until: number; name: string; lv: number }>;
  /** 접속이 끊긴 파티원 → 끊긴 시각 */
  gone: Map<number, number>;
  /** 마지막으로 보낸 접속 상태 (바뀌면 다시 보냄) */
  seen: string;
};

const parties = new Map<number, Party>();
const byChar = new Map<number, Party>();
let seq = 1;

export const partyOf = (p: Player) => byChar.get(p.char.id);
export const partyById = (id: number) => parties.get(id);
const tell = (p: Player, msg: string) => send(p, { t: "error", msg });
const nick = (cid: number) => online.byChar(cid)?.char.nickname ?? "?";
/** 파티 진행 중인 던전 (dungeon.ts 가 채움 — 파티창에 '던전 중' 표시) */
export const partyHooks = { inDungeon: (_partyId: number) => false };

/** 같은 방에 있는 파티원 — 경험치 · RUC · 드롭 분배 (room.killed) */
hooks.mates = (p) => {
  const pt = byChar.get(p.char.id);
  if (!pt || !p.room) return { list: [p], leader: p.char.id };
  const list = pt.members.map((cid) => online.byChar(cid)).filter((q): q is Player => !!q && q.room === p.room);
  return { list, leader: pt.leader };
};

function view(pt: Party): PartyView {
  return {
    id: pt.id, leader: pt.leader, open: pt.open, note: pt.note, dungeon: partyHooks.inDungeon(pt.id),
    members: pt.members.map((cid) => {
      const q = online.byChar(cid);
      return { cid, name: q?.char.nickname ?? "(접속 끊김)", lv: q?.char.level ?? 0, jb: q ? (q.prog.job ?? q.prog.line ?? "") : "", online: !!q, eid: q?.id ?? 0, where: q?.room?.kind ?? "", ch: q?.room?.ch ?? 0 };
    }),
    requests: [...pt.requests].map(([cid, r]) => ({ cid, name: r.name, lv: r.lv })),
  };
}

/** 파티원 모두에게 지금 파티 상태 */
export function sync(pt: Party) {
  const v = view(pt);
  pt.seen = v.members.map((m) => `${m.cid}:${m.online}:${m.where}:${m.ch}:${m.lv}`).join();
  for (const cid of pt.members) {
    const q = online.byChar(cid);
    if (q) { q.party = pt.id; send(q, { t: "party", party: v }); }
  }
}

/** 접속했을 때: 파티가 남아 있으면 다시 붙임 */
export function rejoin(p: Player) {
  const pt = byChar.get(p.char.id);
  if (!pt) { p.party = 0; return send(p, { t: "party", party: null }); }
  pt.gone.delete(p.char.id);
  p.party = pt.id;
  sync(pt);
}

export function createParty(p: Player): Party {
  const pt: Party = { id: seq++, leader: p.char.id, members: [], open: false, note: "", invites: new Map(), requests: new Map(), gone: new Map(), seen: "" };
  parties.set(pt.id, pt);
  add(pt, p.char.id);
  return pt;
}

function add(pt: Party, cid: number) {
  pt.members.push(cid);
  byChar.set(cid, pt);
  pt.invites.delete(cid);
  pt.requests.delete(cid);
  // 다른 파티에 걸어 둔 신청은 지움
  for (const o of parties.values()) if (o !== pt) o.requests.delete(cid);
  const q = online.byChar(cid);
  if (q) { q.party = pt.id; quest(q, "party"); }
  sync(pt);
}

function remove(pt: Party, cid: number) {
  pt.members = pt.members.filter((x) => x !== cid);
  byChar.delete(cid);
  pt.gone.delete(cid);
  const q = online.byChar(cid);
  if (q) { q.party = 0; send(q, { t: "party", party: null }); }
  if (!pt.members.length) { parties.delete(pt.id); return; }
  if (pt.leader === cid) pt.leader = pt.members.find((x) => online.byChar(x)) ?? pt.members[0];
  sync(pt);
}

const findOnline = (name: unknown) => {
  const n = String(name ?? "").trim().toLowerCase();
  return n ? online.all().find((q) => q.char.nickname.toLowerCase() === n) : undefined;
};

/** 파티 요청 처리 (§21-1). 반환 = 거절 이유 */
export function partyOp(p: Player, m: { op?: unknown; name?: unknown; id?: unknown; cid?: unknown; on?: unknown; note?: unknown }): string | null {
  const now = Date.now();
  const mine = partyOf(p);
  const leader = !!mine && mine.leader === p.char.id;
  switch (m.op) {
    case "create":
      if (mine) return "이미 파티에 있습니다";
      createParty(p);
      return null;
    case "invite": {
      const q = findOnline(m.name);
      if (!q) return "접속 중인 모험가가 아닙니다 (닉네임을 정확히)";
      if (q === p) return "자기 자신은 초대할 수 없습니다";
      if (byChar.has(q.char.id)) return `${q.char.nickname}님은 이미 파티에 있습니다`;
      if (mine && !leader) return "파티장만 초대할 수 있습니다";
      const pt = mine ?? createParty(p);
      if (pt.members.length >= PARTY.max) return `파티는 ${PARTY.max}명까지입니다`;
      pt.invites.set(q.char.id, now + PARTY.askMs);
      notify(q.char.id, "party_invite", `${p.char.nickname}님이 파티에 초대했어요`, { party: pt.id, from: p.char.nickname });
      tell(p, `${q.char.nickname}님에게 파티 초대를 보냈습니다`);
      return null;
    }
    case "accept": {
      const pt = parties.get(Number(m.id));
      if (!pt || (pt.invites.get(p.char.id) ?? 0) < now) return "초대가 만료되었거나 파티가 없어졌습니다";
      if (mine) return "이미 파티에 있습니다 — 먼저 나가 주세요";
      if (pt.members.length >= PARTY.max) return "파티가 가득 찼습니다";
      add(pt, p.char.id);
      notify(pt.leader, "party_accepted", `${p.char.nickname}님이 파티 초대를 받아들였어요`, { party: pt.id });
      return null;
    }
    case "decline": {
      const pt = parties.get(Number(m.id));
      if (pt?.invites.delete(p.char.id)) { const l = online.byChar(pt.leader); if (l) tell(l, `${p.char.nickname}님이 파티 초대를 거절했습니다`); }
      return null;
    }
    case "request": {
      const pt = m.id !== undefined ? parties.get(Number(m.id)) : (() => { const q = findOnline(m.name); return q && partyOf(q); })();
      if (!pt) return "파티를 찾을 수 없습니다";
      if (mine) return "이미 파티에 있습니다";
      if (pt.members.length >= PARTY.max) return "파티가 가득 찼습니다";
      pt.requests.set(p.char.id, { until: now + PARTY.askMs, name: p.char.nickname, lv: p.char.level });
      notify(pt.leader, "party_join_request", `${p.char.nickname}(Lv${p.char.level})님이 파티 가입을 신청했어요`, { party: pt.id, cid: p.char.id, name: p.char.nickname });
      sync(pt);
      tell(p, "가입 신청을 보냈습니다 — 파티장이 수락하면 들어가요");
      return null;
    }
    case "approve":
    case "reject": {
      if (!leader) return "파티장만 할 수 있습니다";
      const cid = Number(m.cid);
      const r = mine!.requests.get(cid);
      mine!.requests.delete(cid);
      if (m.op === "reject") { sync(mine!); return null; }
      if (!r || r.until < now) { sync(mine!); return "신청이 만료되었습니다"; }
      if (byChar.has(cid)) { sync(mine!); return "이미 다른 파티에 들어갔습니다"; }
      if (!online.byChar(cid)) { sync(mine!); return "신청한 모험가가 접속해 있지 않습니다"; }
      if (mine!.members.length >= PARTY.max) return "파티가 가득 찼습니다";
      add(mine!, cid);
      notify(cid, "party_accepted", `${p.char.nickname}님의 파티에 들어갔어요`, { party: mine!.id });
      return null;
    }
    case "kick": {
      if (!leader) return "파티장만 추방할 수 있습니다";
      const cid = Number(m.cid);
      if (cid === p.char.id || !mine!.members.includes(cid)) return "추방할 수 없습니다";
      remove(mine!, cid);
      notify(cid, "party_kicked", `${p.char.nickname}님의 파티에서 추방되었어요`, { party: mine!.id });
      return null;
    }
    case "promote": {
      if (!leader) return "파티장만 위임할 수 있습니다";
      const cid = Number(m.cid);
      if (!mine!.members.includes(cid) || cid === p.char.id) return "위임할 수 없습니다";
      mine!.leader = cid;
      sync(mine!);
      return null;
    }
    case "leave":
      if (!mine) return "파티에 있지 않습니다";
      remove(mine, p.char.id);
      return null;
    case "disband":
      if (!leader) return "파티장만 해산할 수 있습니다";
      for (const cid of [...mine!.members]) { if (cid !== p.char.id) notify(cid, "party_kicked", "파티가 해산되었어요", { party: mine!.id }); remove(mine!, cid); }
      return null;
    case "open":
      if (!leader) return "파티장만 모집을 바꿀 수 있습니다";
      mine!.open = m.on === true;
      mine!.note = String(m.note ?? "").replace(/\s+/g, " ").trim().slice(0, PARTY.noteMax);
      sync(mine!);
      return null;
    case "list":
      send(p, { t: "ads", list: ads() });
      return null;
  }
  return "알 수 없는 요청";
}

/** 모집 중인 파티 (파티창 모집 탭 — §21-1 파티 모집 게시판) */
function ads(): PartyAd[] {
  return [...parties.values()]
    .filter((pt) => pt.open && pt.members.length < PARTY.max)
    .map((pt) => ({ id: pt.id, leader: nick(pt.leader), lv: online.byChar(pt.leader)?.char.level ?? 0, n: pt.members.length, note: pt.note }))
    .slice(0, 50);
}

// ── 핑 (§21-3) ───────────────────────────────────────────────────────
const marks = new Map<number, number[]>();
export function markOp(p: Player, m: { k?: unknown; x?: unknown; y?: unknown }): string | null {
  const pt = partyOf(p);
  if (!pt || !p.room) return "핑은 파티 중에만 쓸 수 있습니다";
  if (typeof m.k !== "string" || !Object.hasOwn(PINGS, m.k)) return null;
  const x = Math.round(Number(m.x));
  const y = Math.round(Number(m.y));
  if (!Number.isFinite(x) || !Number.isFinite(y) || x < 0 || y < 0 || x > p.room.map.w * TILE || y > p.room.map.h * TILE) return null;
  const now = Date.now();
  const log = (marks.get(p.char.id) ?? []).filter((t) => now - t < PING.windowMs);
  if (log.length >= PING.burst) return "핑은 5초에 3번까지 찍을 수 있습니다";
  log.push(now);
  marks.set(p.char.id, log);
  for (const q of hooks.mates(p).list) send(q, { t: "mark", k: m.k as keyof typeof PINGS, x, y, from: p.char.nickname });
  return null;
}

/** 1초마다: 만료된 초대 · 신청, 오래 끊긴 파티원 정리, 접속 상태가 바뀌면 다시 보냄 */
export function partyTick(now: number) {
  for (const pt of [...parties.values()]) {
    for (const [cid, t] of pt.invites) if (t < now) pt.invites.delete(cid);
    let changed = false;
    for (const [cid, r] of pt.requests) if (r.until < now) { pt.requests.delete(cid); changed = true; }
    for (const cid of [...pt.members]) {
      if (online.byChar(cid)) { pt.gone.delete(cid); continue; }
      if (!pt.gone.has(cid)) pt.gone.set(cid, now);
      else if (now - pt.gone.get(cid)! > PARTY.offlineMs) { remove(pt, cid); changed = false; }
    }
    if (!parties.has(pt.id)) continue;
    const v = view(pt);
    if (changed || v.members.map((m) => `${m.cid}:${m.online}:${m.where}:${m.ch}:${m.lv}`).join() !== pt.seen) sync(pt);
  }
}

/** 2Hz: 파티원 HP · 자원 · 위치 (파티 프레임 · 미니맵 초록 점) */
export function partyVitals() {
  for (const pt of parties.values()) {
    const rows: PartyVitals[] = [];
    for (const cid of pt.members) {
      const q = online.byChar(cid);
      if (!q?.room) continue;
      const res = jobRes(q.prog.line, q.prog.job) === "energy" ? q.en / Math.max(1, q.st.energy) : q.mp / Math.max(1, q.st.mana);
      rows.push([cid, Math.round((q.hp / q.st.hp) * 1000), Math.round(res * 1000), Math.round(q.x), Math.round(q.y), q.room.kind, q.room.ch, q.dead ? 1 : 0]);
    }
    for (const cid of pt.members) { const q = online.byChar(cid); if (q) send(q, { t: "pv", v: rows }); }
  }
}
