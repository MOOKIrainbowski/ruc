import type { WebSocket } from "ws";
import { expToNext } from "../../../web/rpg/shared/character.ts";
import { CHANNEL_CAP, INPUT_CREDITS_MAX, INPUT_CREDITS_PER_TICK, SIM_MS, TICK_MS, type RoomKind } from "../../../web/rpg/shared/constants.ts";
import { FOREVER_MS } from "../../../web/rpg/shared/data/effects.ts";
import { rollDrops, type Item, type Rarity, type Special } from "../../../web/rpg/shared/data/items.ts";
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
import { loadItems } from "./db.ts";
import { makeUnit } from "./combat.ts";
import { refreshGear } from "./items.ts";
import { cast, fire, type Cast, type Shot } from "./skills.ts";

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
};

/** 저장된 캐릭터로 플레이어를 만듦 (아이템 · 성장 · 장비 스탯 반영, HP 가득) — main · 테스트 공용 */
export function buildPlayer(ws: WebSocket, discordId: string, char: CharacterRow, x: number, y: number): Player {
  const prog = loadProgress(char);
  const s = jobStats(char.level, prog.line, prog.pot);
  const u = makeUnit({ id: newId(), kind: "p", name: char.nickname, el: char.element as ElementId, lv: char.level, x, y, r: 7, base: s, mover: newMover(x, y, s) });
  const p: Player = Object.assign(u, {
    kind: "p" as const, mover: u.mover!, ws, discordId, char, inputs: [], credits: 0, lastSeq: -1, steps: 0, rtt: 0,
    room: null, out: [], respawnAt: 0, statsSent: "", ...playerState(loadItems(char.id), prog),
  });
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
  u.kind === "p" ? { id: u.id, name: u.name, ap: (u as Player).char.appearance, look: (u as Player).look, el: u.el, lv: u.lv, jb: (u as Player).prog.job ?? (u as Player).prog.line ?? "" } : { id: u.id, name: u.name, el: u.el, lv: u.lv, mob: (u as Mob).key, grade: (u as Mob).grade };

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
  ev: Ev[] = [];
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
  }

  get full() {
    return this.players.size >= CHANNEL_CAP[this.kind];
  }

  unit(id: number): Unit | undefined {
    return this.players.get(id) ?? this.mobs.get(id);
  }

  private broadcast(m: S2C, except?: Player) {
    const s = JSON.stringify(m);
    for (const o of this.players.values()) if (o !== except && o.ws.readyState === 1) o.ws.send(s);
  }

  add(p: Player) {
    this.broadcast({ t: "spawn", e: info(p) });
    this.players.set(p.id, p);
    p.room = this;
  }

  remove(p: Player) {
    this.players.delete(p.id);
    p.room = null;
    this.casts = this.casts.filter((c) => c.s.p !== p);
    p.charge = null;
    this.broadcast({ t: "despawn", id: p.id });
  }

  private addMob(z: Zone) {
    const m = spawnMob(this, newId(), z);
    if (!m) return;
    this.mobs.set(m.id, m);
    this.broadcast({ t: "spawn", e: info(m) });
  }

  // ── World ──────────────────────────────────────────────────────
  damaged(src: Unit, tgt: Unit, amount: number, threat: number, h?: HitSpec) {
    if (tgt.kind !== "m" || src.kind !== "p") return;
    const m = tgt as Mob;
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
    if (tgt.kind === "p") onTaken(this, tgt as Player, src, amount, h);
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
    if (u.kind === "m") {
      const m = u as Mob;
      m.removeAt = this.now + 1000;
      m.zone.alive--;
      m.zone.respawn.push(this.now + RESPAWN_MS);
      let best: Player | undefined;
      let bv = 0;
      for (const [id, v] of m.dmgBy) {
        const p = this.players.get(id);
        if (p && v > bv) { bv = v; best = p; }
      }
      if (best) {
        gainExp(this, best, mobExp(m.def, m.lv, m.grade, best.lv));
        const [lo, hi] = m.def.ruc;
        dropRuc(best, (lo + Math.floor(rand() * (hi - lo + 1))) * (1 + Object.keys(GRADES).indexOf(m.grade)), m.key);
      }
      if (by?.kind === "p") onKill(this, by as Player);
      // 숙련도: 막타를 친 스킬 +5
      const s = m.lastShot;
      if (s && s.sk.slot !== "A") gainMastery(s.p, s.mid, MASTERY.kill, m.grade);
      this.loot(m, best);
      return;
    }
    // 플레이어: 5초 뒤 광장 부활, 현재 레벨 필요 경험치의 3% 손실 (레벨은 안 내려감, §13-4)
    const p = u as Player;
    const loss = Math.min(p.char.exp, Math.floor(expToNext(p.char.level) * COMBAT.deathExpLoss));
    p.char.exp -= loss;
    saveProgress(p.char.id, p.char.level, p.char.exp);
    p.out.push(["xp", -loss, p.char.exp, p.char.level]);
    deathWear(p);
    p.respawnAt = this.now + COMBAT.respawnMs;
    this.casts = this.casts.filter((c) => c.s.p !== p);
    p.charge = null;
    p.out.push(["dead", COMBAT.respawnMs]);
  }

  push(u: Unit, dx: number, dy: number) {
    const m = u.mover ?? u;
    slide(m, this.map.collider, dx, dy);
    u.x = m.x;
    u.y = m.y;
  }

  /** 드롭 굴려서 몹 주변에 흩뿌림. 운은 처치 경험치를 받는 플레이어 것 */
  private loot(m: Mob, killer: Player | undefined) {
    const owners = new Set([...m.dmgBy.keys()].filter((id) => this.players.has(id)));
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
  shoot(owner: Unit, kind: string, el: string | null, dx: number, dy: number, speed: number, range: number, r: number, spec: HitSpec, seq: number, lag: number, pierce = 0, bounce = 0) {
    const len = Math.sqrt(dx * dx + dy * dy) || 1;
    const p: Proj = { id: newId(), owner, team: owner.kind, x: owner.x, y: owner.y, vx: (dx / len) * speed, vy: (dy / len) * speed, left: range, r, spec, lag, pierce, bounce, hits: new Set() };
    this.projs.push(p);
    this.ev.push(["p", p.id, owner.id, kind, el ?? "", Math.round(p.x), Math.round(p.y), Math.round(p.vx * 100) / 100, Math.round(p.vy * 100) / 100, range, seq]);
  }

  /** 지연 보상: 공격자 화면에 보였던 lag ms 전 위치 */
  posAt(m: Mob, lag: number) {
    if (lag <= 0) return m;
    const t = this.now - lag;
    let best: { x: number; y: number } = m;
    for (const [ht, x, y] of m.hist) if (ht <= t) best = { x, y };
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
      if (mv.dg) tryRoll(m, mv);
      if (mv.cs && SKILLS[p.slots[mv.cs] ?? ""]?.charge) p.charge = { slot: mv.cs, from: p.steps };
      if (mv.k) {
        const err = cast(this, p, mv);
        if (err) p.out.push(["cf", inp.seq, err]);
      }
    }
    step(m, mv, this.map.collider);
    p.x = m.x;
    p.y = m.y;
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
        const targets: Unit[] = pr.team === "p" ? [...this.mobs.values()] : [...this.players.values()];
        for (const t of targets) {
          if (t.dead || pr.hits.has(t.id)) continue;
          const q = t.kind === "m" ? this.posAt(t as Mob, pr.lag) : t;
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
    for (const u of [...this.players.values(), ...this.mobs.values()]) {
      tickEffects(this, u);
      regen(this, u, dt);
    }
    // 닌자 「그림자 걸음」: 3초 동안 전투하지 않으면 이속 +25%
    for (const p of this.players.values()) {
      if (p.job !== "ninja" || p.dead) continue;
      const idle = now - p.combat >= 3000;
      if (idle && !has(p, "shadow_step")) addEffect(this, p, { id: "shadow_step", ms: FOREVER_MS }, p);
      else if (!idle && has(p, "shadow_step")) removeEffect(this, p, "shadow_step");
    }
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
    this.snapshot(now);
  }

  private snapshot(now: number) {
    // ponytail: 방 전체를 매 틱 통째로 보냄 — §29 대역폭(10KB/s)은 P8 에서 AOI + 델타 + 바이너리로
    const rows: EntityRow[] = [];
    for (const p of this.players.values()) {
      const m = p.mover;
      const flags = (m.moving ? F_MOVING : 0) | (m.running ? F_RUNNING : 0) | (m.mv > 0 && m.ifr > 0 ? F_ROLL : 0) | (p.dead ? F_DEAD : 0) | (m.lock > 0 ? F_CAST : 0);
      rows.push([p.id, Math.round(m.x), Math.round(m.y), m.dir, flags, Math.round((p.hp / p.st.hp) * 1000), Math.round((p.mp / Math.max(1, p.st.mana)) * 1000)]);
    }
    for (const u of this.mobs.values()) {
      rows.push([u.id, Math.round(u.x), Math.round(u.y), u.dir, (u.moving ? F_MOVING : 0) | (u.dead ? F_DEAD : 0) | (u.wind ? F_CAST : 0), Math.round((u.hp / u.st.hp) * 1000), 0]);
    }
    for (const u of [...this.players.values(), ...this.mobs.values()]) {
      if (!u.fxDirty) continue;
      u.fxDirty = false;
      this.ev.push(["f", u.id, fxRows(this, u)]);
    }
    const e = JSON.stringify(rows);
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
      p.ws.send(`{"t":"s","st":${now},"ack":${JSON.stringify({ seq: p.lastSeq, m: p.mover })},"v":${JSON.stringify(v)},"e":${e}${ev}${pe}}`);
    }
  }
}

const dropRow = (d: Drop): DropRow => ["dr", d.id, d.tpl, d.rarity, d.qty, d.x, d.y];

/** 경험치 · 연속 레벨업 (§7). 레벨업하면 스탯 다시 계산 + 완전 회복. 연출은 P4 */
export function gainExp(room: Room, p: Player, amount: number) {
  const c = p.char;
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
