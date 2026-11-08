import type { WebSocket } from "ws";
import { expToNext } from "../../../web/rpg/shared/character.ts";
import { AOI, CHANNEL_CAP, INPUT_CREDITS_MAX, INPUT_CREDITS_PER_TICK, SIM_MS, SNAP_EVERY, TICK_MS, type RoomKind } from "../../../web/rpg/shared/constants.ts";
import { diffRows, frame } from "../../../web/rpg/shared/snapshot.ts";
import { packMover } from "../../../web/rpg/shared/movement.ts";
import { FOREVER_MS } from "../../../web/rpg/shared/data/effects.ts";
import { GATHER, rollDrops, type GatherRow, type Item, type Rarity, type Special } from "../../../web/rpg/shared/data/items.ts";
import { GRADES, mobExp } from "../../../web/rpg/shared/data/mobs.ts";
import { SKILLS, SLOTS, type Slot } from "../../../web/rpg/shared/data/skills.ts";
import { COMBAT } from "../../../web/rpg/shared/data/stats.ts";
import { prop, type GameMap } from "../../../web/rpg/shared/map.ts";
import { blinkDest, blocked, slide, step, tryRoll, type MoveInput, type Mover } from "../../../web/rpg/shared/movement.ts";
import { MASTERY, type Progress } from "../../../web/rpg/shared/progress.ts";
import { F_CAST, F_DEAD, F_MOVING, F_ROLL, F_RUNNING, type ChannelInfo, type DropRow, type EntityInfo, type Ev, type EntityRow, type S2C } from "../../../web/rpg/shared/protocol.ts";
import { addEffect, find, fxRows, has, hit, rand, recalc, regen, removeEffect, shieldOf, tickEffects, type HitSpec, type Unit, type World } from "./combat.ts";
import { saveProgress, type CharacterRow } from "./db.ts";
import { dropRuc } from "./economy.ts";
import { deathWear, onDealt, onKill, onTaken, pickUp } from "./items.ts";
import { mobTick, RESPAWN_MS, spawnMob, type Mob, type Zone } from "./mobs.ts";
import { charBase, gainMastery, loadProgress, sendProg, syncSkills } from "./progress.ts";
import { jobStats } from "../../../web/rpg/shared/data/jobs.ts";
import { newMover } from "../../../web/rpg/shared/movement.ts";
import type { ElementId } from "../../../web/rpg/shared/data/elements.ts";
import { guildOf, loadItems, type QuestRow } from "./db.ts";
import { quest, reachTick } from "./quests.ts";
import { PARTY, partyExp, partyWeights, pickWeighted, splitWeighted } from "../../../web/rpg/shared/data/party.ts";
import { makeUnit } from "./combat.ts";
import { refreshGear } from "./items.ts";
import { cast, fire, type Cast, type Shot } from "./skills.ts";
import { petTick, summon, unsummon, type Pet } from "./pets.ts";

let idSeq = 1;
/** 플레이어 · 몹 · 투사체가 같이 쓰는 id */
export const newId = () => idSeq++;

export type Player = Unit & {
  kind: "p";
  mover: Mover;
  ws: WebSocket;
  discordId: string;
  char: CharacterRow;
  inputs: MoveInput[];
  credits: number;
  lastSeq: number;
  /** 처리한 입력 수 — 쿨타임 시계 (DECISIONS D12) */
  steps: number;
  /** 스킬 id → 쿨이 끝나는 입력 시계 (ms) */
  cd: Record<string, number>;
  slots: Partial<Record<Slot, string>>;
  // 성장 (§9 · §10)
  prog: Progress;
  progDirty: boolean;
  progAt: number;
  skillsDirty: Set<string>;
  /** 차지 스킬을 모으기 시작한 슬롯 · 입력 시계 */
  charge: { slot: Slot; from: number } | null;
  /** 베타 지갑 RUC (DB 가 원본, 이건 보여 주기용 사본) */
  ruc: number;
  /** 퀘스트 (P6): NPC 퀘스트 진행 · 받은 유저 퀘스트(id → 처치/진행 수) · 분수 둘레 지난 곳 비트 */
  quests: Map<string, QuestRow>;
  takes: Map<number, number>;
  reach: number;
  rtt: number;
  room: Room | null;
  /** 개인 이벤트 (다음 스냅샷에 실림) */
  out: Ev[];
  respawnAt: number;
  statsSent: string;
  // 아이템 (§14 · §15)
  items: Item[];
  /** 장비 발동 효과 (특수효과 · 세트) */
  procs: Special[];
  /** 옷 색이 바뀌는 장비 템플릿 */
  look: string[];
  /** 포션 공유 쿨이 끝나는 시각 · 최후의 보루 쿨 */
  potionAt: number;
  shieldAt: number;
  /** 적중 · 피격 · 평타 횟수 (내구도 · 5번째 평타) */
  dealt: number;
  taken: number;
  basics: number;
  // P7: 파티 · K/D/A · 칭호 · 결투 · 던전
  /** 파티 id (0 = 없음) */
  party: number;
  kda: [number, number, number];
  title: string | null;
  /** 나를 때리거나 디버프를 건 플레이어 → 시각 (어시스트, §13-3) */
  hitBy: Map<number, number>;
  /** 결투 id · 편(0/1) · 지금 싸우는 중(시작 뒤 · 패배 전) */
  duel: number;
  duelSide: number;
  duelOn: boolean;
  /** 던전: 이번 스테이지에 남은 포션 (null = 제한 없음) · 쓰러진 시각 */
  potionLeft: number | null;
  deadAt: number;
  /** 부활할 맵 (결투장에서 쓰러지면 결투장) */
  respawnKind: RoomKind;
  /** 이 사람에게 마지막으로 보낸 엔티티 줄 (스냅샷 델타, D71) — 방에 들어갈 때 비움 */
  sent: Map<number, EntityRow>;
  /** 접속 IP (D46) */
  ip: string;
  /** 길드 (P10, 이름표에 ‹이름›) */
  guild: { id: number; name: string } | null;
  /** 창고 확장 장수 (P12) */
  tabs: number;
};

/** 저장된 캐릭터로 플레이어를 만듦 (아이템 · 성장 · 장비 스탯 반영, HP 가득) — main · 테스트 공용 */
export function buildPlayer(ws: WebSocket, discordId: string, char: CharacterRow, x: number, y: number): Player {
  const prog = loadProgress(char);
  const s = jobStats(char.level, prog.line, prog.pot, prog.job);
  const u = makeUnit({ id: newId(), kind: "p", name: char.nickname, el: char.element as ElementId, lv: char.level, x, y, r: 7, base: s, mover: newMover(x, y, s) });
  const p: Player = Object.assign(u, {
    kind: "p" as const, mover: u.mover!, ws, discordId, char, inputs: [], credits: 0, lastSeq: -1, steps: 0, rtt: 0,
    room: null, out: [], respawnAt: 0, statsSent: "", ...playerState(loadItems(char.id), prog),
  });
  p.title = char.title_id ?? null;
  const g = guildOf(char.id); // 방에 들어가기 전에 — 다른 사람에게 가는 spawn 정보에 길드 이름 (P10)
  p.guild = g && { id: g.id, name: g.name };
  p.tabs = char.storage_tabs ?? 0;
  syncSkills(p); // 견습 스킬 · 레벨 도달 스킬 (예전 캐릭터도) — 접속 때 안내는 안 띄움
  p.out = [];
  refreshGear(p);
  p.hp = p.st.hp;
  p.mp = p.st.mana;
  p.en = p.st.energy;
  return p;
}

/** 플레이어 아이템 · 성장 상태 초기값 */
export const playerState = (items: Item[], prog: Progress) => ({
  items, procs: [] as Special[], look: [] as string[], potionAt: 0, shieldAt: 0, dealt: 0, taken: 0, basics: 0,
  prog, progDirty: false, progAt: 0, skillsDirty: new Set<string>(), charge: null, cd: {} as Record<string, number>, slots: {} as Partial<Record<Slot, string>>, ruc: 0,
  quests: new Map<string, QuestRow>(), takes: new Map<number, number>(), reach: 0,
  party: 0, kda: [0, 0, 0] as [number, number, number], title: null as string | null, hitBy: new Map<number, number>(), duel: 0, duelSide: 0, duelOn: false,
  potionLeft: null as number | null, deadAt: 0, respawnKind: "plaza" as RoomKind, sent: new Map<number, EntityRow>(), ip: "",
  guild: null as { id: number; name: string } | null, tabs: 0,
});

/**
 * 바닥 아이템 (§20-2): 처치 기여자에게만 보이다가 30초 뒤 모두에게, 2분 뒤 사라짐 (D24).
 * 떨어지고 0.4초 뒤부터 주울 수 있음 — 같은 스냅샷에 생김 · 주움이 같이 실려 클라에 유령 아이템이 남지 않게 (마크도 줍기 지연이 있음)
 */
type Drop = { id: number; tpl: string; qty: number; rarity: Rarity; x: number; y: number; owners: Set<number> | null; pickAt: number; publicAt: number; until: number; told: Set<number> };
export const DROP = { pickMs: 400, ownMs: 30_000, lifeMs: 120_000, pickR: 18 };

type Proj = { id: number; owner: Unit; team: "p" | "m"; x: number; y: number; vx: number; vy: number; left: number; r: number; spec: HitSpec; lag: number; pierce: number; bounce: number; hits: Set<number> };
/** 적 투사체를 막는 벽 (성역의 방패) */
type Wall = { x1: number; y1: number; x2: number; y2: number; until: number };
const segDist = (w: Wall, x: number, y: number) => {
  const dx = w.x2 - w.x1;
  const dy = w.y2 - w.y1;
  const t = Math.max(0, Math.min(1, ((x - w.x1) * dx + (y - w.y1) * dy) / (dx * dx + dy * dy)));
  return Math.sqrt((w.x1 + dx * t - x) ** 2 + (w.y1 + dy * t - y) ** 2);
};

export const send = (p: Player, m: S2C) => p.ws.readyState === 1 && p.ws.send(JSON.stringify(m));
export const info = (u: Unit): EntityInfo =>
  u.kind === "p"
    ? { id: u.id, name: u.name, ap: (u as Player).char.appearance, look: (u as Player).look, el: u.el, lv: u.lv, jb: (u as Player).prog.job ?? (u as Player).prog.line ?? "", ...((u as Player).title ? { tt: (u as Player).title! } : {}), ...((u as Player).guild ? { gd: (u as Player).guild!.name } : {}) }
    : { id: u.id, name: u.name, el: u.el, lv: u.lv, mob: (u as Mob).key, grade: (u as Mob).grade };

/** 던전 인스턴스가 방에 거는 것 (dungeon.ts) */
export interface Inst {
  tick(now: number): void;
  killed(u: Unit, by: Unit | undefined): void;
}

/**
 * 다른 모듈이 채우는 연결점 — room 이 party · pvp 를 import 하지 않게 (순환 참조 방지).
 * mates = 같은 방에 있는 파티원(자기 포함) · 파티장 캐릭터 id, defeat = 결투 패배, pvpKill = 플레이어에게 쓰러짐, left = 방을 떠남
 */
export const hooks = {
  mates: (p: Player): { list: Player[]; leader: number } => ({ list: [p], leader: p.char.id }),
  defeat: (_room: Room, _p: Player, _by: Player | undefined) => {},
  pvpKill: (_room: Room, _p: Player, _by: Player) => {},
  left: (_room: Room, _p: Player) => {},
};

const dist = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2);

/** 방 = 맵 하나의 채널 하나 (§2-2). 광장 60명, 필드 40명이 차면 다음 채널. 전투 판정은 전부 여기서 (서버 권한). */
export class Room implements World {
  players = new Map<number, Player>();
  mobs = new Map<number, Mob>();
  projs: Proj[] = [];
  casts: Cast[] = [];
  zones: Zone[] = [];
  drops = new Map<number, Drop>();
  walls: Wall[] = [];
  /** 소환수 · 설치물 (P9) */
  pets: Pet[] = [];
  /** 채집 지점 (P13) */
  nodes: { id: number; kind: string; x: number; y: number; readyAt: number }[] = [];
  ev: Ev[] = [];
  /** 던전 인스턴스 (없으면 일반 채널) · 예약 실행 (보스 패턴의 경고 → 발동) */
  inst: Inst | null = null;
  timers: { at: number; fn: () => void }[] = [];
  now = 0;
  kind: RoomKind;
  ch: number;
  map: GameMap;
  // 매개변수 프로퍼티(readonly x)는 Node 타입 제거 모드에서 못 씁니다
  constructor(kind: RoomKind, ch: number, map: GameMap, now = Date.now()) {
    this.kind = kind;
    this.ch = ch;
    this.map = map;
    this.now = now;
    for (const o of map.objects) {
      if (o.type !== "spawn_zone") continue;
      const [a, b] = String(prop(o, "lv") ?? "1-1").split("-").map(Number);
      this.zones.push({ mob: String(prop(o, "mob")), count: Number(prop(o, "count") ?? 5), lv: [a, b || a], grade: (prop(o, "grade") as Mob["grade"]) || "normal", x: o.x, y: o.y - o.height / 2, r: o.width / 2, alive: 0, respawn: [] });
    }
    for (const z of this.zones) for (let i = 0; i < z.count; i++) this.addMob(z);
    // 채집 지점 (P13): 필드 구역마다 3곳 (구역 반지름 1.3배 안, 막힌 곳 제외)
    if (kind === "field") {
      const total = Object.values(GATHER).reduce((a, g) => a + g.w, 0);
      for (const z of this.zones)
        for (let i = 0; i < 3; i++) {
          let r = rand() * total;
          const k = Object.keys(GATHER).find((g) => (r -= GATHER[g].w) < 0) ?? "herb";
          for (let t = 0; t < 12; t++) {
            const a = rand() * Math.PI * 2;
            const d = Math.sqrt(rand()) * z.r * 1.3;
            const x = Math.round(z.x + Math.cos(a) * d);
            const y = Math.round(z.y + Math.sin(a) * d);
            if (blocked(map.collider, x, y)) continue;
            this.nodes.push({ id: newId(), kind: k, x, y, readyAt: 0 });
            break;
          }
        }
    }
  }

  /** 채집 지점 목록 (입장 때) */
  nodeRows(): GatherRow[] {
    return this.nodes.map((n) => [n.id, n.kind, n.x, n.y, this.now >= n.readyAt ? 1 : 0]);
  }

  /** 채집 (P13): 가까이 · 다시 생긴 지점 · 0.6초에 한 번 → 재료 1개, collect 퀘스트 */
  gather(p: Player, id: number): string | null {
    const n = this.nodes.find((x) => x.id === id);
    if (!n || p.dead) return "채집할 수 없습니다";
    if (this.now < n.readyAt) return "이미 누가 캐 갔어요 — 잠시 뒤에 다시 생깁니다";
    if (dist(p, n) > 26) return "조금 더 가까이 가세요";
    if (this.now < (p.icd.get("gather") ?? 0)) return null;
    p.icd.set("gather", this.now + 600);
    const g = GATHER[n.kind];
    const err = pickUp(p, g.item, 1, "common", `gather:${this.kind}`);
    if (err) return err;
    n.readyAt = this.now + g.respawnMs;
    this.ev.push(["gn", n.id, 0, p.id]);
    quest(p, "collect", g.item);
    return null;
  }

  /** 몹이 노릴 수 있는 대상: 플레이어 · 소환수 (P13) */
  combatant(id: number): Unit | undefined {
    return this.players.get(id) ?? this.pets.find((q) => q.id === id);
  }

  get full() {
    return this.players.size >= CHANNEL_CAP[this.kind];
  }

  unit(id: number): Unit | undefined {
    return this.players.get(id) ?? this.mobs.get(id);
  }

  broadcast(m: S2C, except?: Player) {
    const s = JSON.stringify(m);
    for (const o of this.players.values()) if (o !== except && o.ws.readyState === 1) o.ws.send(s);
  }

  add(p: Player) {
    this.broadcast({ t: "spawn", e: info(p) });
    this.players.set(p.id, p);
    p.room = this;
  }

  remove(p: Player) {
    hooks.left(this, p);
    this.players.delete(p.id);
    p.room = null;
    this.casts = this.casts.filter((c) => c.s.p !== p);
    p.charge = null;
    this.broadcast({ t: "despawn", id: p.id });
  }

  addMob(z: Zone): Mob | null {
    const m = spawnMob(this, newId(), z);
    if (!m) return null;
    this.mobs.set(m.id, m);
    this.broadcast({ t: "spawn", e: info(m) });
    return m;
  }

  /** ms 뒤에 실행 (보스 패턴) */
  later(ms: number, fn: () => void) {
    this.timers.push({ at: this.now + ms, fn });
  }

  /**
   * 적대 관계 (§13-3): 플레이어 ↔ 몹은 항상. 플레이어끼리는 결투장(같은 파티 제외) · 결투 중인 상대만.
   * 광장 · 필드 · 던전은 서로 못 때림.
   */
  hostile(a: Unit, b: Unit): boolean {
    if (a === b) return false;
    if (a.kind !== b.kind) return true;
    if (a.kind === "m") return false;
    const p = a as Player;
    const q = b as Player;
    if (this.kind === "arena") return !(p.party && p.party === q.party);
    return p.duelOn && q.duelOn && p.duel === q.duel && p.duelSide !== q.duelSide;
  }

  /** p 가 공격할 수 있는 살아 있는 대상 (몹 + 적대 플레이어) */
  foes(p: Unit): Unit[] {
    const out: Unit[] = [];
    for (const m of this.mobs.values()) if (!m.dead) out.push(m);
    if (p.kind === "p" && (this.kind === "arena" || (p as Player).duelOn)) for (const o of this.players.values()) if (!o.dead && this.hostile(p, o)) out.push(o);
    return out;
  }

  /** 결투 패배: 쓰러지는 대신 체력 1로 결투에서 빠짐 */
  spare(src: Unit | undefined, u: Unit): boolean {
    if (u.kind !== "p") return false;
    const p = u as Player;
    if (!p.duelOn || (src && (src.kind !== "p" || (src as Player).duel !== p.duel))) return false;
    p.hp = 1;
    hooks.defeat(this, p, src as Player | undefined);
    return true;
  }

  // ── World ──────────────────────────────────────────────────────
  damaged(src: Unit, tgt: Unit, amount: number, threat: number, h?: HitSpec) {
    if (src.kind === "p" && tgt.kind === "p" && !tgt.petOf) (tgt as Player).hitBy.set(src.id, this.now);
    if (tgt.kind !== "m" || src.kind !== "p") return;
    const m = tgt as Mob;
    if (h?.pet) m.threat.set(h.pet, (m.threat.get(h.pet) ?? 0) + amount * (h.taunt ?? 0.5)); // 소환수 위협 (P13)
    m.lastShot = (h?.cast as Shot | undefined) ?? null;
    m.threat.set(src.id, (m.threat.get(src.id) ?? 0) + amount * threat);
    m.dmgBy.set(src.id, (m.dmgBy.get(src.id) ?? 0) + amount);
  }

  struck(src: Unit, tgt: Unit, amount: number, h: HitSpec) {
    if (src.kind === "p") {
      onDealt(this, src as Player, tgt, amount, h);
      // 숙련도: 적중한 적마다 (시전 한 번에 대상당 한 번)
      const s = h.cast as Shot | undefined;
      if (s && s.sk.slot !== "A" && !s.hit.has(tgt.id) && tgt.kind === "m") {
        s.hit.add(tgt.id);
        gainMastery(s.p, s.mid, MASTERY.hit, (tgt as Mob).grade);
      }
      // 독 바르기: 평타가 독을 검
      if (h.basic && has(src, "venom") && !tgt.dead) addEffect(this, tgt, { id: "poison", ms: 4000, dot: Math.max(1, amount * 0.15) }, src);
    }
    if (tgt.kind === "p" && !tgt.petOf) onTaken(this, tgt as Player, src, amount, h);
  }

  around(x: number, y: number, r: number, kind: "p" | "m"): Unit[] {
    const list: Unit[] = kind === "p" ? [...this.players.values()] : [...this.mobs.values()];
    return list.filter((u) => !u.dead && dist(u, { x, y }) <= r + u.r);
  }

  /** 부활 (§11-1 · 부활의 기적): 쓰러진 자리에서 HP 비율로 */
  revive(p: Player, pct: number) {
    if (!p.dead) return;
    p.dead = false;
    p.respawnAt = 0;
    p.deadAt = 0;
    recalc(p);
    p.hp = Math.max(1, Math.round(p.st.hp * pct));
    this.ev.push(["rv", p.id]);
  }

  /** 대상 뒤 (시전자 반대편) 16px — 막혀 있으면 대상 옆 */
  behind(p: Player, t: Unit) {
    const dx = t.x - p.x;
    const dy = t.y - p.y;
    const len = Math.sqrt(dx * dx + dy * dy) || 1;
    return blinkDest(this.map.collider, t.x, t.y, t.x + (dx / len) * (t.r + 12), t.y + (dy / len) * (t.r + 12), t.r + 12);
  }

  /** 성역의 방패: 바라보는 쪽 28px 앞에 길이 56px 벽 5초 */
  wall(p: Player, ux: number, uy: number) {
    const cx = p.x + ux * 28;
    const cy = p.y - 6 + uy * 28;
    const w: Wall = { x1: cx - uy * 28, y1: cy + ux * 28, x2: cx + uy * 28, y2: cy - ux * 28, until: this.now + 5000 };
    this.walls.push(w);
    this.ev.push(["wl", Math.round(w.x1), Math.round(w.y1), Math.round(w.x2), Math.round(w.y2), 5000]);
  }

  killed(u: Unit, by: Unit | undefined) {
    if (u.petOf) return unsummon(this, u as Pet); // 소환수가 쓰러짐 (P13)
    if (u.kind === "m") {
      const m = u as Mob;
      m.removeAt = this.now + 1000;
      m.zone.alive--;
      if (m.zone.count) m.zone.respawn.push(this.now + RESPAWN_MS);
      let best: Player | undefined;
      let bv = 0;
      for (const [id, v] of m.dmgBy) {
        const p = this.players.get(id);
        if (p && v > bv) { bv = v; best = p; }
      }
      // 파티 분배 (§21-2): 경험치는 반경 20타일 안 파티원에게 균등 + 인원당 5%, RUC · 드롭은 같은 방 파티원에게 파티장 1.5 : 1
      const party = best ? hooks.mates(best) : null;
      if (best && party) {
        const near = party.list.filter((q) => !q.dead && (q === best || Math.hypot(q.x - m.x, q.y - m.y) <= PARTY.expRange));
        for (const q of near) {
          gainExp(this, q, partyExp(mobExp(m.def, m.lv, m.grade, q.lv), near.length));
          quest(q, "kill", m.key);
        }
        const [lo, hi] = m.def.ruc;
        const total = (lo + Math.floor(rand() * (hi - lo + 1))) * (1 + Object.keys(GRADES).indexOf(m.grade));
        const shares = splitWeighted(total, partyWeights(party.list.map((q) => q.char.id), party.leader));
        party.list.forEach((q, i) => dropRuc(q, shares[i], m.key));
      }
      if (by?.kind === "p") onKill(this, by as Player);
      // 숙련도: 막타를 친 스킬 +5
      const s = m.lastShot;
      if (s && s.sk.slot !== "A") gainMastery(s.p, s.mid, MASTERY.kill, m.grade);
      this.loot(m, best, party);
      this.inst?.killed(u, by);
      return;
    }
    // 플레이어: 5초 뒤 광장 부활, 현재 레벨 필요 경험치의 3% 손실 (레벨은 안 내려감, §13-4)
    const p = u as Player;
    this.casts = this.casts.filter((c) => c.s.p !== p);
    p.charge = null;
    p.deadAt = this.now;
    const pvp = by?.kind === "p" && by !== p;
    if (pvp) hooks.pvpKill(this, p, by as Player);
    this.inst?.killed(u, by);
    // 던전: 관전 — 파티원이 부활시키거나 공용 부활 (§20-4)
    if (this.inst) return void p.out.push(["dead", 0, "dungeon"]);
    // 결투장 · 다른 플레이어에게 쓰러지면 페널티 없음, 결투장에서는 결투장으로 부활
    if (!pvp && this.kind !== "arena") {
      const loss = Math.min(p.char.exp, Math.floor(expToNext(p.char.level) * COMBAT.deathExpLoss));
      p.char.exp -= loss;
      saveProgress(p.char.id, p.char.level, p.char.exp);
      p.out.push(["xp", -loss, p.char.exp, p.char.level]);
      deathWear(p);
    }
    p.respawnKind = this.kind === "arena" ? "arena" : "plaza";
    p.respawnAt = this.now + COMBAT.respawnMs;
    p.out.push(["dead", COMBAT.respawnMs, p.respawnKind]);
  }

  push(u: Unit, dx: number, dy: number) {
    if (has(u, "earth_root")) return; // 대지수호자: 정지 중 넉백 면역
    const m = u.mover ?? u;
    slide(m, this.map.collider, dx, dy);
    u.x = m.x;
    u.y = m.y;
  }

  /** 드롭 굴려서 몹 주변에 흩뿌림. 운은 처치 경험치를 받는 플레이어 것. 파티면 아이템마다 가중치 추첨으로 주인 한 명 (§21-2) */
  private loot(m: Mob, killer: Player | undefined, party: { list: Player[]; leader: number } | null) {
    const hitters = new Set([...m.dmgBy.keys()].filter((id) => this.players.has(id)));
    const team = party && party.list.length > 1 ? party.list : null;
    const weights = team ? partyWeights(team.map((q) => q.char.id), party!.leader) : [];
    const gi = Object.keys(GRADES).indexOf(m.grade);
    for (const r of rollDrops(m.def.drops, gi, killer?.st.luck ?? 0, rand)) {
      let x = m.x;
      let y = m.y;
      for (let i = 0; i < 6; i++) {
        const a = rand() * Math.PI * 2;
        const d = 6 + rand() * 12;
        const tx = Math.round(m.x + Math.cos(a) * d);
        const ty = Math.round(m.y + Math.sin(a) * d);
        if (!blocked(this.map.collider, tx, ty)) { x = tx; y = ty; break; }
      }
      let owners = hitters;
      if (team) {
        const win = team[pickWeighted(weights, rand())];
        owners = new Set([win.id]);
        for (const q of team) q.out.push(["pl", r.tpl, r.rarity, win.char.nickname]);
      }
      const d: Drop = { id: newId(), ...r, x, y, owners: owners.size ? owners : null, pickAt: this.now + DROP.pickMs, publicAt: this.now + DROP.ownMs, until: this.now + DROP.lifeMs, told: new Set() };
      this.drops.set(d.id, d);
      if (d.owners) for (const id of d.owners) this.players.get(id)!.out.push(dropRow(d));
      else this.ev.push(dropRow(d));
    }
  }

  /** 이 플레이어에게 보이는 바닥 아이템 */
  visibleDrops(p: Player): DropRow[] {
    return [...this.drops.values()].filter((d) => !d.owners || d.owners.has(p.id)).map(dropRow);
  }

  /** 소유권 해제 · 사라짐 · 자동 줍기 (마크처럼 가까이 가면) */
  private tickDrops() {
    for (const d of [...this.drops.values()]) {
      if (this.now >= d.until) {
        this.drops.delete(d.id);
        this.ev.push(["dx", d.id, 0]);
        continue;
      }
      if (d.owners && this.now >= d.publicAt) {
        d.owners = null;
        this.ev.push(dropRow(d));
      }
      if (this.now < d.pickAt) continue;
      for (const p of this.players.values()) {
        if (p.dead || (d.owners && !d.owners.has(p.id)) || dist(p, d) > DROP.pickR) continue;
        const err = pickUp(p, d.tpl, d.qty, d.rarity, `drop:${this.kind}`);
        if (err) {
          if (!d.told.has(p.id)) { d.told.add(p.id); send(p, { t: "error", msg: err }); }
          continue;
        }
        this.drops.delete(d.id);
        this.ev.push(["dx", d.id, p.id]);
        break;
      }
    }
  }

  /** 투사체 발사. lag = 지연 보상 되감기(ms), pierce = 꿰뚫는 수, bounce = 다른 적에게 튕기는 수 */
  shoot(owner: Unit, kind: string, el: string | null, dx: number, dy: number, speed: number, range: number, r: number, spec: HitSpec, seq: number, lag: number, pierce = 0, bounce = 0, from: { x: number; y: number } = owner) {
    const len = Math.sqrt(dx * dx + dy * dy) || 1;
    const p: Proj = { id: newId(), owner, team: owner.kind, x: from.x, y: from.y, vx: (dx / len) * speed, vy: (dy / len) * speed, left: range, r, spec, lag, pierce, bounce, hits: new Set() };
    this.projs.push(p);
    this.ev.push(["p", p.id, owner.id, kind, el ?? "", Math.round(p.x), Math.round(p.y), Math.round(p.vx * 100) / 100, Math.round(p.vy * 100) / 100, range, seq]);
  }

  /** 지연 보상: 공격자 화면에 보였던 lag ms 전 위치 (몹만 — 플레이어는 지금 위치) */
  posAt(u: Unit, lag: number) {
    if (lag <= 0 || u.kind !== "m") return u;
    const t = this.now - lag;
    let best: { x: number; y: number } = u;
    for (const [ht, x, y] of (u as Mob).hist) if (ht <= t) best = { x, y };
    return best;
  }

  lagOf(p: Player) {
    return Math.min(COMBAT.lagCompMaxMs, p.rtt / 2 + 100);
  }

  // ── 입력 ───────────────────────────────────────────────────────
  private input(p: Player, inp: MoveInput) {
    p.steps++;
    p.lastSeq = inp.seq;
    const m = p.mover;
    let mv = inp;
    // 강제 이동 디버프 (예측하지 않음 — 서버 보정으로 맞춤, DECISIONS D13)
    const force = find(p, "fear") ?? find(p, "taunt") ?? find(p, "charm");
    if (force) {
      const s = this.unit(force.src);
      if (s) {
        const sign = force.id === "fear" ? -1 : 1;
        mv = { ...inp, mx: Math.sign(s.x - p.x) * sign, my: Math.sign(s.y - p.y) * sign, run: false, dg: undefined, k: undefined };
      }
    } else if (find(p, "confuse")) mv = { ...inp, mx: -inp.mx, my: -inp.my };
    if (!p.dead) {
      if (mv.dg) {
        const rolling = m.mv > 0;
        tryRoll(m, mv);
        if (!rolling && m.mv > 0) {
          quest(p, "roll");
          // 환영자객 「잔상」: 구르면 2초 동안 분신이 남고 몹이 나를 놓침
          if (p.job === "phantom") { summon(this, p, { pet: "decoy", ms: 2000 }); p.icd.set("decoy", this.now + 2000); }
        }
      }
      if (mv.cs && SKILLS[p.slots[mv.cs] ?? ""]?.charge) p.charge = { slot: mv.cs, from: p.steps };
      if (mv.k) {
        const err = cast(this, p, mv);
        if (err) p.out.push(["cf", inp.seq, err]);
        else quest(p, "cast", mv.k);
      }
    }
    step(m, mv, this.map.collider);
    p.x = m.x;
    p.y = m.y;
    if (p.steps % 10 === 0) reachTick(p);
  }

  /** 힐 위협: 그 아군과 싸우는 몹들이 치유한 쪽을 노림 (§13-2 힐량 × 0.5 — 스킬 threat 로 반영) */
  healed(src: Player, tgt: Unit, amount: number) {
    for (const m of this.mobs.values()) if (m.threat.has(tgt.id)) m.threat.set(src.id, (m.threat.get(src.id) ?? 0) + amount);
  }

  /** 투사체: 4px 씩 나아가며 판정. 적 투사체는 벽에 막힘, 관통은 다음 적으로, 튕김은 근처(80px) 다른 적 쪽으로 새 투사체 */
  private moveProjectiles(dt: number) {
    for (const pr of [...this.projs]) {
      const speed = Math.sqrt(pr.vx * pr.vx + pr.vy * pr.vy);
      const total = Math.min(pr.left, speed * dt);
      const n = Math.max(1, Math.ceil(total / 4));
      let end = false;
      let turned = false;
      for (let i = 0; i < n && !end && !turned; i++) {
        pr.x += (pr.vx / speed) * (total / n);
        pr.y += (pr.vy / speed) * (total / n);
        pr.left -= total / n;
        if (pr.team === "m" && this.walls.some((w) => segDist(w, pr.x, pr.y) <= pr.r + 3)) { end = true; break; }
        const targets: Unit[] = pr.team === "p" ? this.foes(pr.owner) : [...this.players.values(), ...this.pets];
        for (const t of targets) {
          if (t.dead || pr.hits.has(t.id)) continue;
          const q = this.posAt(t, pr.lag);
          if (dist(pr, q) > pr.r + t.r) continue;
          hit(this, pr.owner, t, pr.spec);
          pr.hits.add(t.id);
          const next = pr.bounce > 0 ? targets.filter((o) => !o.dead && !pr.hits.has(o.id) && dist(o, t) <= 80).sort((a, b) => dist(a, t) - dist(b, t))[0] : undefined;
          if (next) {
            pr.bounce--;
            const len = dist(next, t) || 1;
            pr.vx = ((next.x - t.x) / len) * speed;
            pr.vy = ((next.y - t.y) / len) * speed;
            pr.left = len + 16;
            // 클라는 방향이 바뀐 투사체를 새것으로 그림
            this.ev.push(["px", pr.id, Math.round(pr.x), Math.round(pr.y)]);
            pr.id = newId();
            this.ev.push(["p", pr.id, pr.owner.id, "bounce", pr.spec.el ?? "", Math.round(pr.x), Math.round(pr.y), Math.round(pr.vx * 100) / 100, Math.round(pr.vy * 100) / 100, Math.round(pr.left), -1]);
            turned = true;
            break;
          }
          if (pr.pierce > 0) { pr.pierce--; continue; }
          end = true;
          break;
        }
      }
      if (end || pr.left <= 0.01) {
        this.projs.splice(this.projs.indexOf(pr), 1);
        this.ev.push(["px", pr.id, Math.round(pr.x), Math.round(pr.y)]);
      }
    }
  }

  // ── 틱 ─────────────────────────────────────────────────────────
  tick(now: number) {
    this.now = now;
    const dt = TICK_MS / 1000;
    for (const p of this.players.values()) {
      p.credits = Math.min(p.credits + INPUT_CREDITS_PER_TICK, INPUT_CREDITS_MAX);
      while (p.inputs.length && p.credits >= 1) {
        this.input(p, p.inputs.shift()!);
        p.credits--;
      }
    }
    for (const c of [...this.casts]) {
      if (now < c.at) continue;
      this.casts.splice(this.casts.indexOf(c), 1);
      const p = c.s.p;
      // 시전 · 채널링 중 기절 등으로 막히면 취소
      if (!p.dead && !(c.s.sk.slot === "A" ? p.block.atk : p.block.skill) && p.room === this) fire(this, c.s, c.sx, c.sy, c.ax, c.ay);
    }
    this.walls = this.walls.filter((w) => now < w.until);
    this.moveProjectiles(dt);
    this.tickDrops();
    for (const m of this.mobs.values()) {
      mobTick(this, m, dt);
      m.hist.push([now, m.x, m.y]);
      if (m.hist.length > 6) m.hist.shift();
    }
    if (this.pets.length) petTick(this, dt);
    for (const u of [...this.players.values(), ...this.mobs.values(), ...this.pets]) {
      tickEffects(this, u);
      regen(this, u, dt);
    }
    // 채집 지점 다시 생김 (P13)
    for (const n of this.nodes) if (n.readyAt && now >= n.readyAt) { n.readyAt = 0; this.ev.push(["gn", n.id, 1, 0]); }
    for (const p of this.players.values()) if (p.job && !p.dead) this.passive(p, now);
    for (const m of [...this.mobs.values()]) {
      if (m.dead && now >= m.removeAt) {
        this.mobs.delete(m.id);
        this.broadcast({ t: "despawn", id: m.id });
      }
    }
    for (const z of this.zones) {
      const due = z.respawn.filter((t) => now >= t);
      if (!due.length) continue;
      z.respawn = z.respawn.filter((t) => now < t);
      for (let i = 0; i < due.length && z.alive < z.count; i++) this.addMob(z);
    }
    if (this.timers.length) {
      const due = this.timers.filter((t) => now >= t.at);
      this.timers = this.timers.filter((t) => now < t.at);
      for (const t of due) t.fn();
    }
    this.inst?.tick(now);
    this.snapshot(now);
  }

  /** 틱마다 도는 직업 패시브 (§9-3) */
  private passive(p: Player, now: number) {
    const toggle = (id: string, on: boolean) => {
      if (on && !has(p, id)) addEffect(this, p, { id, ms: FOREVER_MS }, p);
      else if (!on && has(p, id)) removeEffect(this, p, id);
    };
    const every = (key: string, ms: number) => {
      if (now < (p.icd.get(key) ?? 0)) return false;
      p.icd.set(key, now + ms);
      return true;
    };
    switch (p.job) {
      case "ninja": // 그림자 걸음: 3초 동안 전투하지 않으면 이속 +25%
        return toggle("shadow_step", now - p.combat >= 3000);
      case "earthwarden": // 대지의 뿌리: 정지 중 방어 +20% · 넉백 면역
        return toggle("earth_root", !p.mover.moving && p.mover.mv <= 0);
      case "berserker": { // 피의 광기: 잃은 HP 10%마다 1중첩
        const n = Math.min(10, Math.floor((1 - p.hp / p.st.hp) * 10));
        toggle("blood_rage", n > 0);
        const e = find(p, "blood_rage");
        if (e && e.stacks !== n) { e.stacks = n; p.fxDirty = true; recalc(p); }
        return;
      }
      case "sniper": { // 집중: 1.5초 정지할 때마다 +1중첩 (최대 5)
        if (p.mover.moving) return void p.icd.set("still", now + 1500);
        if (every("still", 1500)) addEffect(this, p, { id: "aim_focus", ms: FOREVER_MS }, p);
        return;
      }
      case "bard": // 선율: 주변 10칸 아군 공속 · 이속 +5%
        if (every("aura", 1000)) for (const a of this.around(p.x, p.y, 160, "p")) if (!this.hostile(p, a)) addEffect(this, a, { id: "melody", ms: 2500, v: 0.05 }, p);
        return;
      case "scout": { // 매의 눈: 주변 25칸에서 본 몹을 파티원 미니맵에 공유 (클라가 5초 표시)
        if (!p.party || !every("spot", 1000)) return;
        const seen = this.around(p.x, p.y, 400, "m").flatMap((m) => [Math.round(m.x), Math.round(m.y)]);
        if (seen.length) for (const q of hooks.mates(p).list) if (q !== p) q.out.push(["sp", seen]);
        return;
      }
    }
  }

  /** 스냅샷 (§2-2 · §29, D71): 10Hz · 받는 사람마다 시야(AOI) 안 엔티티를 지난번 보낸 것과의 델타로 · 바이너리 프레임 */
  private snapN = 0;
  private snapshot(now: number) {
    if (++this.snapN % SNAP_EVERY) return; // 이벤트 · 개인 이벤트는 다음 스냅샷에 모아서
    const rows: EntityRow[] = [];
    for (const p of this.players.values()) {
      const m = p.mover;
      const flags = (m.moving ? F_MOVING : 0) | (m.running ? F_RUNNING : 0) | (m.mv > 0 && m.ifr > 0 ? F_ROLL : 0) | (p.dead ? F_DEAD : 0) | (m.lock > 0 ? F_CAST : 0);
      rows.push([p.id, Math.round(m.x), Math.round(m.y), m.dir, flags, Math.round((p.hp / p.st.hp) * 1000), Math.round((p.mp / Math.max(1, p.st.mana)) * 1000)]);
    }
    for (const u of this.mobs.values()) {
      rows.push([u.id, Math.round(u.x), Math.round(u.y), u.dir, (u.moving ? F_MOVING : 0) | (u.dead ? F_DEAD : 0) | (u.wind ? F_CAST : 0), Math.round((u.hp / u.st.hp) * 1000), 0]);
    }
    for (const q of this.pets) rows.push([q.id, Math.round(q.x), Math.round(q.y), q.dir, q.moving ? F_MOVING : 0, Math.round((q.hp / q.st.hp) * 1000), 0]);
    for (const u of [...this.players.values(), ...this.mobs.values()]) {
      if (!u.fxDirty) continue;
      u.fxDirty = false;
      this.ev.push(["f", u.id, fxRows(this, u)]);
    }
    const ev = this.ev.length ? `,"ev":${JSON.stringify(this.ev)}` : "";
    this.ev = [];
    for (const p of this.players.values()) {
      if (p.ws.readyState !== 1) continue;
      if (p.statsDirty) {
        p.statsDirty = false;
        const s = JSON.stringify(p.st);
        if (s !== p.statsSent) { p.statsSent = s; p.ws.send(`{"t":"stats","s":${s}}`); }
      }
      const sim = p.steps * SIM_MS;
      const v = [p.hp, p.st.hp, p.mp, p.st.mana, p.en, p.st.energy, shieldOf(p)].map(Math.round);
      for (const k of SLOTS) v.push(Math.max(0, Math.round((p.cd[p.slots[k] ?? ""] ?? 0) - sim)));
      v.push(Math.max(0, Math.round(p.potionAt - now)));
      if (p.progDirty && now - p.progAt >= 1000) { p.progAt = now; sendProg(p); }
      const pe = p.out.length ? `,"pe":${JSON.stringify(p.out)}` : "";
      p.out = [];
      const aoi = rows.filter((r) => r[0] !== p.id && Math.abs(r[1] - p.x) <= AOI.w && Math.abs(r[2] - p.y) <= AOI.h);
      const f = frame(`{"t":"s","st":${now},"ack":{"seq":${p.lastSeq},"m":${JSON.stringify(packMover(p.mover))}},"v":${JSON.stringify(v)}${ev}${pe}}`, diffRows(p.sent, aoi));
      p.ws.send(Buffer.from(f.buffer, f.byteOffset, f.byteLength));
    }
  }
}

const dropRow = (d: Drop): DropRow => ["dr", d.id, d.tpl, d.rarity, d.qty, d.x, d.y];

/** 경험치 · 연속 레벨업 (§7). 레벨업하면 스탯 다시 계산 + 완전 회복. 연출은 P4 */
export function gainExp(room: Room, p: Player, amount: number) {
  const c = p.char;
  const lucky = find(p, "elixir_luck"); // 행운의 영약 (P12)
  if (lucky && amount > 0) amount = Math.round(amount * (1 + lucky.v));
  c.exp += amount;
  let up = false;
  while (c.level < COMBAT.maxLevel && c.exp >= expToNext(c.level)) {
    c.exp -= expToNext(c.level);
    c.level++;
    up = true;
  }
  if (c.level >= COMBAT.maxLevel) c.exp = Math.min(c.exp, expToNext(c.level));
  p.out.push(["xp", amount, c.exp, c.level]);
  saveProgress(c.id, c.level, c.exp);
  if (!up) return;
  p.lv = c.level;
  p.base = charBase(p);
  syncSkills(p);
  recalc(p);
  p.hp = p.st.hp;
  p.mp = p.st.mana;
  p.en = p.st.energy;
  p.mover.stamina = p.mover.staminaMax;
  room.ev.push(["lv", p.id, c.level]);
  quest(p, "level");
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
