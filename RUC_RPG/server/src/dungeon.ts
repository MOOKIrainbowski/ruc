import { randomUUID } from "node:crypto";
import { RUINS, legendaryChance, memberHp, type DungeonState, type Stage } from "../../../web/rpg/shared/data/dungeons.ts";
import { FOREVER_MS } from "../../../web/rpg/shared/data/effects.ts";
import { ITEMS, type Rarity } from "../../../web/rpg/shared/data/items.ts";
import { MOBS, type Grade } from "../../../web/rpg/shared/data/mobs.ts";
import { TITLES, partyWeights, splitWeighted } from "../../../web/rpg/shared/data/party.ts";
import { USE_RANGE, distToObj, prop, type GameMap } from "../../../web/rpg/shared/map.ts";
import { addEffect, die, rand, recalc, type Unit } from "./combat.ts";
import { broadcastExists, grantTitle, loadTitles, saveBroadcast, setTitle, tx } from "./db.ts";
import { mail, online, pay } from "./economy.ts";
import { newItem } from "./items.ts";
import { bossHooks, type Mob, type Zone } from "./mobs.ts";
import { createParty, partyById, partyHooks, partyOf, sync } from "./party.ts";
import { notify, quest } from "./quests.ts";
import { Room, send, type Inst, type Player } from "./room.ts";

/**
 * 던전 "고목의 유적" 인스턴스 (§20-3 · §20-4). 파티마다 방 하나 — 파티장이 광장 북쪽 포털에서 입장을 확인하면 생기고, 다 나가면 사라짐.
 * 스테이지: 몹이 유적 북쪽 광장(stage_area)에 나타남 → 다 잡으면 보상 정산 → 30초 정비 → 다음 스테이지 포털(target "next")이 열림.
 * 쓰러지면 관전 — 파티원 부활 스킬 또는 공용 부활(3회, 쓰러지고 10초 뒤). 전원이 쓰러지면 실패 → 광장.
 */

/** main.ts 가 채움: 방으로 옮기기 · 광장으로 돌려보내기(쓰러져 있으면 살려서) */
export const dgHooks = {
  place: (_p: Player, _room: Room, _x: number, _y: number) => {},
  toPlaza: (_p: Player) => {},
};

let map: GameMap;
export const setDungeonMap = (m: GameMap) => void (map = m);

const runs = new Map<number, Run>();
/** main 의 틱 루프가 돌릴 던전 방들 */
export const dungeonRooms = () => [...runs.values()].map((r) => r.room);
partyHooks.inDungeon = (id) => runs.has(id);

const obj = (type: string, target?: string) => map.objects.find((o) => o.type === type && (target === undefined || prop(o, "target") === target))!;
const start = () => obj("spawn");
const tell = (p: Player, msg: string) => send(p, { t: "error", msg });

/** 순간 이동 (같은 방 안 — 다시 들어가지 않고 보정으로 따라감) */
function warp(p: Player, x: number, y: number) {
  p.mover.x = p.x = x;
  p.mover.y = p.y = y;
  p.mover.mv = p.mover.lock = 0;
}

export class Run implements Inst {
  room: Room;
  party: number;
  key = randomUUID();
  n = 0;
  phase: DungeonState["phase"] = "fight";
  until = 0;
  revives = RUINS.revives;
  queue: { mob: string; grade: Grade }[] = [];
  bossId = 0;
  scale = 1;
  private sentAt = 0;
  private sent = "";

  constructor(room: Room, party: number) {
    this.room = room;
    this.party = party;
  }

  get stage(): Stage {
    return RUINS.stages[this.n - 1];
  }

  /** 스테이지 시작: 인원 보정(members = 들어올 인원) · 포션 수 초기화 · 몹 */
  begin(n: number, members = this.room.players.size) {
    const now = this.room.now;
    this.n = n;
    this.phase = "fight";
    this.until = this.stage.limitMs ? now + this.stage.limitMs : 0;
    this.bossId = 0;
    this.scale = memberHp(members);
    for (const p of this.room.players.values()) p.potionLeft = RUINS.potionsPerStage;
    this.queue = this.stage.groups.flatMap((g) => Array.from({ length: g.n }, () => ({ mob: g.mob, grade: g.grade })));
    if (this.stage.waves) this.spawn(this.queue.shift()!);
    else while (this.queue.length) this.spawn(this.queue.shift()!);
    this.room.ev.push(["ann", `${n}스테이지 · ${this.stage.name}`, 2500]);
    this.push(true);
  }

  private spawn(s: { mob: string; grade: Grade }) {
    const a = obj("stage_area");
    const z: Zone = { mob: s.mob, count: 0, lv: [this.stage.lv, this.stage.lv], grade: s.grade, x: a.x, y: a.y - a.height / 2, r: a.width / 2, alive: 0, respawn: [] };
    const m = this.room.addMob(z);
    if (m) this.prep(m);
  }

  /** 인원 보정 (§20-3 몹 HP × (1 + 0.6 × (인원 − 1))) · 보스는 군중 제어 면역 */
  prep(m: Mob) {
    m.base = { ...m.base, hp: Math.round(m.base.hp * this.scale) };
    recalc(m);
    m.hp = m.st.hp;
    if (MOBS[m.key].boss) {
      addEffect(this.room, m, { id: "unstoppable", ms: FOREVER_MS }, m);
      this.bossId = m.id;
    }
  }

  killed(u: Unit) {
    if (u.kind !== "m" || u.id !== this.bossId) return;
    // 보스가 쓰러지면 졸개 · 구슬도 정리
    for (const m of [...this.room.mobs.values()]) if (!m.dead && m !== u) die(this.room, m, undefined);
  }

  tick(now: number) {
    const players = [...this.room.players.values()];
    // 파티를 나갔거나 추방된 사람은 광장으로
    for (const p of players) if (p.party !== this.party) dgHooks.toPlaza(p);
    if (!this.room.players.size) { runs.delete(this.party); return; }
    const live = [...this.room.mobs.values()].filter((m) => !m.dead);
    if (this.phase === "fight") {
      if (players.every((p) => p.dead)) this.fail("파티가 전멸했습니다…");
      else if (this.until && now >= this.until) this.fail("제한 시간이 지났습니다…");
      else if (!live.length && this.queue.length) this.spawn(this.queue.shift()!);
      else if (!live.length) this.clearStage();
    } else if (this.phase === "rest" && now >= this.until) {
      this.phase = "open";
      this.room.ev.push(["ann", "다음 스테이지 포털이 열렸습니다 (북쪽)", 2500]);
    } else if ((this.phase === "clear" || this.phase === "fail") && now >= this.until) {
      for (const p of players) dgHooks.toPlaza(p);
      return;
    }
    this.push(now - this.sentAt >= 500);
  }

  private clearStage() {
    const n = this.n;
    const present = [...this.room.players.values()];
    const pt = partyById(this.party);
    this.room.ev.push(["ann", `${n}스테이지 정화!`, 2500]);
    // 스테이지 보상 RUC — 파티장 1.5 : 1 (§21-2)
    const shares = splitWeighted(this.stage.ruc, partyWeights(present.map((p) => p.char.id), pt?.leader ?? 0));
    present.forEach((p, i) => {
      if (shares[i] > 0) {
        try { pay(p, shares[i], "dungeon_stage", `ruins:${n}`, `dg:${this.key}:${n}:${p.char.id}`); p.out.push(["ruc", shares[i]]); send(p, { t: "ruc", ruc: p.ruc }); } catch (e) { console.error("던전 보상 실패", e); }
      }
      quest(p, "stage", "ruins", n);
    });
    if (n >= RUINS.stages.length) return this.finish(present);
    this.phase = "rest";
    this.until = this.room.now + RUINS.restMs;
  }

  /** 완전 클리어 (§20-3): 우편으로 신화 장비(전설 5% + 운) · 강화석 · 축복 강화석 · RUC(파티 총 5,000 가중치) + 칭호, 서버 최초면 공지 */
  private finish(present: Player[]) {
    this.phase = "clear";
    this.until = this.room.now + RUINS.returnMs * 2;
    const C = RUINS.clear;
    const pt = partyById(this.party);
    const shares = splitWeighted(C.ruc, partyWeights(present.map((p) => p.char.id), pt?.leader ?? 0));
    const first = !broadcastExists("first_clear_ruins");
    present.forEach((p, i) => {
      const tpl = C.gear[Math.floor(rand() * C.gear.length)];
      const r: Rarity = rand() < legendaryChance(p.st.luck) ? "legendary" : "mythic";
      try {
        tx(() => mail(p.char.id, {
          sender: RUINS.name, subject: "고목왕을 쓰러뜨린 보상", reason: "reward", ruc: shares[i],
          body: `균형을 되찾은 숲이 감사의 뜻을 전합니다. ${r === "legendary" ? "전설" : "신화"} 장비 「${ITEMS[tpl].name}」`,
          items: [newItem(tpl, 1, r, "inventory", 0), ...C.items.map(([t, q]) => newItem(t, q, (ITEMS[t].rarity ?? "common") as Rarity, "inventory", 0))],
        }));
      } catch (e) { console.error("클리어 보상 우편 실패", p.char.id, e); }
      giveTitle(p, C.title);
      if (first) giveTitle(p, C.firstTitle);
      notify(p.char.id, "quest_complete", "고목의 유적 완전 정화! 보상은 우편함으로 보냈어요", { dungeon: "ruins" });
    });
    this.room.ev.push(["ann", "고목왕 엘드라를 쓰러뜨렸습니다! 보상은 우편함으로", 5000]);
    if (first) {
      const text = `${present.map((p) => p.char.nickname).join(", ")} 파티가 서버 최초로 고목의 유적을 정화했습니다!`;
      saveBroadcast("first_clear_ruins", text);
      for (const o of online.all()) { send(o, { t: "notice", text }); notify(o.char.id, "system", text); }
    }
  }

  private fail(why: string) {
    this.phase = "fail";
    this.until = this.room.now + RUINS.returnMs;
    this.room.ev.push(["ann", `${why} 곧 광장으로 돌아갑니다`, RUINS.returnMs]);
  }

  /** 다음 스테이지 포털 (F) */
  next(p: Player): string | null {
    if (this.phase === "rest") return `정비 중입니다 (${Math.ceil((this.until - this.room.now) / 1000)}초 뒤 열림)`;
    if (this.phase !== "open") return "아직 열리지 않았습니다";
    const s = start();
    for (const q of this.room.players.values()) if (!q.dead) warp(q, s.x, s.y);
    this.begin(this.n + 1);
    return null;
  }

  /** 공용 부활 (§20-4): 쓰러지고 10초 뒤, 입구에서 HP 50% */
  revive(p: Player): string | null {
    if (!p.dead) return null;
    if (this.phase === "clear" || this.phase === "fail") return "던전이 끝났습니다";
    if (this.revives <= 0) return "공용 부활 횟수를 다 썼습니다";
    if (this.room.now - p.deadAt < RUINS.reviveDelayMs) return `${Math.ceil((RUINS.reviveDelayMs - (this.room.now - p.deadAt)) / 1000)}초 뒤에 쓸 수 있습니다`;
    this.revives--;
    this.room.revive(p, RUINS.revivePct);
    const s = start();
    warp(p, s.x, s.y);
    this.push(true);
    return null;
  }

  state(): DungeonState {
    const boss = this.bossId ? this.room.mobs.get(this.bossId) : undefined;
    const ph = boss && !boss.dead ? MOBS[boss.key].boss?.phases[boss.phase] : undefined;
    return {
      stage: this.n, total: RUINS.stages.length, name: this.stage.name, phase: this.phase,
      left: [...this.room.mobs.values()].filter((m) => !m.dead).length + this.queue.length,
      ms: this.until ? Math.max(0, this.until - this.room.now) : 0, revives: this.revives, potions: 0,
      ...(boss && !boss.dead ? { boss: { id: boss.id, name: boss.name, phase: ph?.name ?? "" } } : {}),
    };
  }

  /** 상태 보내기 — 바뀌었거나 0.5초마다 (남은 시간) */
  private push(force: boolean) {
    const s = this.state();
    const key = JSON.stringify({ ...s, ms: 0 });
    if (!force && key === this.sent) return;
    this.sent = key;
    this.sentAt = this.room.now;
    for (const p of this.room.players.values()) send(p, { t: "dg", s: { ...s, potions: p.potionLeft ?? 0 } });
  }
}

bossHooks.summoned = (room, m) => {
  const run = room.inst as Run | null;
  if (run) run.prep(m);
};

// ── 입장 · 합류 · 요청 ─────────────────────────────────────────────

/** 광장 북쪽 포털 (F): 파티 던전이 진행 중이면 합류, 파티장이면 입장 확인 창 */
export function usePortal(p: Player): string | null {
  const pt = partyOf(p);
  const run = pt && runs.get(pt.id);
  if (run) {
    if (run.phase === "clear" || run.phase === "fail") return "파티의 던전이 끝나는 중입니다";
    if (run.room.full) return "던전 정원이 가득 찼습니다";
    const s = start();
    dgHooks.place(p, run.room, s.x, s.y);
    return null;
  }
  if (pt && pt.leader !== p.char.id) return "파티장이 문 앞에서 입장을 확인해야 합니다";
  const members = pt ? pt.members.map((cid) => online.byChar(cid)).filter((q): q is Player => !!q && q.room?.kind === "plaza" && !q.dead).map((q) => q.char.nickname) : [p.char.nickname];
  send(p, { t: "ask", kind: "dungeon", members, recommend: RUINS.recommend });
  return null;
}

/** 파티장이 입장 확인: 인스턴스를 만들고 광장에 있는 파티원을 데려감 (파티가 없으면 혼자 파티를 만듦) */
export function enter(p: Player): string | null {
  const portal = p.room?.kind === "plaza" ? p.room.map.objects.find((o) => o.type === "portal" && prop(o, "target") === "dungeon") : undefined;
  if (!portal || distToObj(portal, p.x, p.y) > USE_RANGE + 24) return "광장 북쪽 '고대 유적의 문' 앞에서 입장하세요";
  if (p.dead) return "쓰러진 상태입니다";
  const pt = partyOf(p) ?? createParty(p);
  if (pt.leader !== p.char.id) return "파티장만 입장을 확인할 수 있습니다";
  if (runs.has(pt.id)) return usePortal(p);
  const room = new Room("dungeon", pt.id, map);
  const run = new Run(room, pt.id);
  room.inst = run;
  runs.set(pt.id, run);
  const s = start();
  const go = pt.members.map((cid) => online.byChar(cid)).filter((q): q is Player => !!q && q.room?.kind === "plaza" && !q.dead).slice(0, 5);
  run.begin(1, go.length); // 몹이 먼저 있어야 들어가는 사람 화면에 바로 보임
  for (const q of go) dgHooks.place(q, room, s.x, s.y);
  for (const cid of pt.members) {
    const q = online.byChar(cid);
    if (q && !go.includes(q)) tell(q, "파티가 고목의 유적에 들어갔습니다 — 광장 북쪽 포털로 합류할 수 있어요");
  }
  sync(pt);
  return null;
}

export function dungeonOp(p: Player, op: unknown): string | null {
  const run = p.room?.inst as Run | null | undefined;
  if (op === "enter") return enter(p);
  if (!run) return "던전 안이 아닙니다";
  if (op === "revive") return run.revive(p);
  if (op === "leave") { dgHooks.toPlaza(p); return null; }
  return null;
}

/** 던전 안 포털: 다음 스테이지 · 나가기 */
export function dungeonPortal(p: Player, target: string): string | null {
  const run = p.room?.inst as Run | null | undefined;
  if (!run) return null;
  if (target === "next") return run.next(p);
  dgHooks.toPlaza(p);
  return null;
}

/** 개발용: 지금 스테이지를 끝냄 (몹 정리). to = 그 스테이지로 바로 건너뜀 (보상 없음) */
export function devStage(p: Player, to?: number) {
  const run = p.room?.inst as Run | null | undefined;
  if (!run) return;
  run.queue = [];
  const jump = Number.isInteger(to) && to! >= 1 && to! <= RUINS.stages.length && to !== 1;
  for (const m of [...run.room.mobs.values()]) if (!m.dead) { if (jump) { m.dead = true; m.removeAt = 0; } else die(run.room, m, p); }
  if (jump) run.begin(to!);
}

// ── 칭호 ───────────────────────────────────────────────────────────

/** 칭호를 줌. 처음 받는 칭호이고 걸고 있는 게 없으면 바로 검 */
export function giveTitle(p: Player, id: string) {
  if (!grantTitle(p.char.id, id)) return;
  if (!p.title) setOwnTitle(p, id);
  sendTitles(p);
  send(p, { t: "error", msg: `칭호 「${TITLES[id]}」을(를) 얻었습니다!` });
}

function setOwnTitle(p: Player, id: string | null) {
  p.title = id;
  p.char.title_id = id;
  setTitle(p.char.id, id);
  p.room?.ev.push(["tt", p.id, id ?? ""]);
}

export const sendTitles = (p: Player) => send(p, { t: "titles", list: loadTitles(p.char.id), on: p.title });

export function titleOp(p: Player, id: unknown) {
  if (id !== null && (typeof id !== "string" || !loadTitles(p.char.id).includes(id))) return "가지고 있는 칭호가 아닙니다";
  setOwnTitle(p, id as string | null);
  sendTitles(p);
  return null;
}
