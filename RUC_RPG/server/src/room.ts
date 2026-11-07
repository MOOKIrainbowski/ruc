import type { WebSocket } from "ws";
import { baseStats, expToNext } from "../../../web/rpg/shared/character.ts";
import { castMs, cooldownMs } from "../../../web/rpg/shared/combat.ts";
import { CHANNEL_CAP, INPUT_CREDITS_MAX, INPUT_CREDITS_PER_TICK, SIM_MS, TICK_MS, type RoomKind } from "../../../web/rpg/shared/constants.ts";
import { mobExp } from "../../../web/rpg/shared/data/mobs.ts";
import { APPRENTICE_SLOTS, SKILLS, SLOTS, type Slot } from "../../../web/rpg/shared/data/skills.ts";
import { COMBAT } from "../../../web/rpg/shared/data/stats.ts";
import { prop, type GameMap } from "../../../web/rpg/shared/map.ts";
import { castMove, slide, step, tryRoll, type MoveInput, type Mover } from "../../../web/rpg/shared/movement.ts";
import { F_CAST, F_DEAD, F_MOVING, F_ROLL, F_RUNNING, type ChannelInfo, type EntityInfo, type Ev, type EntityRow, type S2C } from "../../../web/rpg/shared/protocol.ts";
import { addEffect, find, fxRows, healPerTick, hit, recalc, regen, shieldOf, tickEffects, type HitSpec, type Unit, type World } from "./combat.ts";
import { saveProgress, type CharacterRow } from "./db.ts";
import { mobTick, RESPAWN_MS, spawnMob, type Mob, type Zone } from "./mobs.ts";

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
  cd: Partial<Record<Slot, number>>;
  slots: Partial<Record<Slot, string>>;
  rtt: number;
  room: Room | null;
  /** 개인 이벤트 (다음 스냅샷에 실림) */
  out: Ev[];
  respawnAt: number;
  statsSent: string;
};

type Proj = { id: number; owner: Unit; team: "p" | "m"; x: number; y: number; vx: number; vy: number; left: number; r: number; spec: HitSpec; lag: number };
type Cast = { at: number; p: Player; sk: string; ax: number; ay: number; tid: number };

export const send = (p: Player, m: S2C) => p.ws.readyState === 1 && p.ws.send(JSON.stringify(m));
export const info = (u: Unit): EntityInfo =>
  u.kind === "p" ? { id: u.id, name: u.name, ap: (u as Player).char.appearance, el: u.el, lv: u.lv } : { id: u.id, name: u.name, el: u.el, lv: u.lv, mob: (u as Mob).key, grade: (u as Mob).grade };

const dist = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2);

/** 방 = 맵 하나의 채널 하나 (§2-2). 광장 60명, 필드 40명이 차면 다음 채널. 전투 판정은 전부 여기서 (서버 권한). */
export class Room implements World {
  players = new Map<number, Player>();
  mobs = new Map<number, Mob>();
  projs: Proj[] = [];
  casts: Cast[] = [];
  zones: Zone[] = [];
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
    this.casts = this.casts.filter((c) => c.p !== p);
    this.broadcast({ t: "despawn", id: p.id });
  }

  private addMob(z: Zone) {
    const m = spawnMob(this, newId(), z);
    if (!m) return;
    this.mobs.set(m.id, m);
    this.broadcast({ t: "spawn", e: info(m) });
  }

  // ── World ──────────────────────────────────────────────────────
  damaged(src: Unit, tgt: Unit, amount: number, threat: number) {
    if (tgt.kind !== "m" || src.kind !== "p") return;
    const m = tgt as Mob;
    m.threat.set(src.id, (m.threat.get(src.id) ?? 0) + amount * threat);
    m.dmgBy.set(src.id, (m.dmgBy.get(src.id) ?? 0) + amount);
  }

  killed(u: Unit) {
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
      if (best) gainExp(this, best, mobExp(m.def, m.lv, m.grade, best.lv));
      return;
    }
    // 플레이어: 5초 뒤 광장 부활, 현재 레벨 필요 경험치의 3% 손실 (레벨은 안 내려감, §13-4)
    const p = u as Player;
    const loss = Math.min(p.char.exp, Math.floor(expToNext(p.char.level) * COMBAT.deathExpLoss));
    p.char.exp -= loss;
    saveProgress(p.char.id, p.char.level, p.char.exp);
    p.out.push(["xp", -loss, p.char.exp, p.char.level]);
    p.respawnAt = this.now + COMBAT.respawnMs;
    this.casts = this.casts.filter((c) => c.p !== p);
    p.out.push(["dead", COMBAT.respawnMs]);
  }

  push(u: Unit, dx: number, dy: number) {
    const m = u.mover ?? u;
    slide(m, this.map.collider, dx, dy);
    u.x = m.x;
    u.y = m.y;
  }

  /** 투사체 발사. lag = 지연 보상 되감기(ms) */
  shoot(owner: Unit, kind: string, el: string | null, dx: number, dy: number, speed: number, range: number, r: number, spec: HitSpec, seq: number, lag: number) {
    const len = Math.sqrt(dx * dx + dy * dy) || 1;
    const p: Proj = { id: newId(), owner, team: owner.kind, x: owner.x, y: owner.y, vx: (dx / len) * speed, vy: (dy / len) * speed, left: range, r, spec, lag };
    this.projs.push(p);
    this.ev.push(["p", p.id, owner.id, kind, el ?? "", Math.round(p.x), Math.round(p.y), Math.round(p.vx * 100) / 100, Math.round(p.vy * 100) / 100, range, seq]);
  }

  /** 지연 보상: 공격자 화면에 보였던 lag ms 전 위치 */
  private posAt(m: Mob, lag: number) {
    if (lag <= 0) return m;
    const t = this.now - lag;
    let best: { x: number; y: number } = m;
    for (const [ht, x, y] of m.hist) if (ht <= t) best = { x, y };
    return best;
  }

  private lagOf(p: Player) {
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
      if (mv.k) {
        const err = this.cast(p, mv);
        if (err) p.out.push(["cf", inp.seq, err]);
      }
    }
    step(m, mv, this.map.collider);
    p.x = m.x;
    p.y = m.y;
  }

  /** 스킬 검증 (§27: 쿨 · 자원 · 상태) → 받아들이면 움직임 효과 + 발동. 거부 이유를 돌려줌 */
  private cast(p: Player, inp: MoveInput): string | null {
    const sk = SKILLS[p.slots[inp.k!] ?? ""];
    if (!sk) return "아직 배우지 않은 슬롯입니다";
    if (this.kind === "plaza") return "광장은 안전지대라 공격 · 스킬을 쓸 수 없습니다";
    if (sk.slot === "A" ? p.block.atk : p.block.skill) return "지금은 쓸 수 없습니다";
    const m = p.mover;
    if (m.mv > 0 || m.lock > 0) return "다른 동작 중입니다";
    const ax = Number(inp.ax);
    const ay = Number(inp.ay);
    if (!Number.isFinite(ax) || !Number.isFinite(ay)) return "조준 오류";
    const sim = p.steps * SIM_MS;
    if (sim < (p.cd[sk.slot] ?? 0) - 1) return "재사용 대기 중입니다";
    if (p.mp < (sk.cost.mana ?? 0)) return "마나가 부족합니다";
    if (p.en < (sk.cost.energy ?? 0)) return "기력이 부족합니다";
    p.mp -= sk.cost.mana ?? 0;
    p.en -= sk.cost.energy ?? 0;
    p.cd[sk.slot] = sim + (sk.slot === "A" ? castMs(sk.cooldownMs, p.st.atkSpeed) : cooldownMs(sk.cooldownMs, p.st));
    const sx = m.x;
    const sy = m.y;
    castMove(m, sk, ax, ay);
    this.ev.push(["c", p.id, sk.id, Math.round(ax), Math.round(ay)]);
    if (sk.castMs) this.casts.push({ at: this.now + castMs(sk.castMs, p.st.atkSpeed), p, sk: sk.id, ax, ay, tid: 0 });
    else this.fire(p, sk.id, sx, sy, ax, ay, inp.seq);
    return null;
  }

  private fire(p: Player, skId: string, sx: number, sy: number, ax: number, ay: number, seq: number) {
    const sk = SKILLS[skId];
    const dx = ax - sx;
    const dy = ay - sy;
    const len = Math.sqrt(dx * dx + dy * dy) || 1;
    const ux = dx / len;
    const uy = dy / len;
    const spec: HitSpec = {
      ...(sk.damage ?? { base: 0, atkRatio: 0, apRatio: 0 }), cat: sk.category, el: sk.elementInherit ? p.el : null, skill: sk.slot !== "A",
      melee: sk.targeting === "melee" || sk.targeting === "dash", threat: sk.threat, proc: sk.elementInherit, fx: sk.effects, basic: sk.slot === "A",
    };
    const lag = this.lagOf(p);
    const live = [...this.mobs.values()].filter((m) => !m.dead);
    switch (sk.targeting) {
      case "skillshot":
        this.shoot(p, sk.id, spec.el, dx, dy, sk.speed! * (1 + p.st.projSpeed), sk.range, sk.width! / 2, spec, seq, lag);
        return;
      case "melee": {
        const cosHalf = Math.cos(((sk.arc ?? 90) / 2) * (Math.PI / 180));
        for (const m of live) {
          const q = this.posAt(m, lag);
          const d = dist(p, q);
          if (d > sk.range + m.r) continue;
          if (d > m.r && ((q.x - p.x) * ux + (q.y - p.y) * uy) / d < cosHalf) continue;
          hit(this, p, m, spec);
        }
        return;
      }
      case "dash":
        for (const m of live) {
          const q = this.posAt(m, lag);
          const t = Math.max(0, Math.min(sk.range, (q.x - sx) * ux + (q.y - sy) * uy));
          if (Math.sqrt((sx + ux * t - q.x) ** 2 + (sy + uy * t - q.y) ** 2) <= (sk.width ?? 16) / 2 + m.r) hit(this, p, m, spec);
        }
        return;
      case "ally": {
        let tgt: Unit = p;
        let bd = 24;
        for (const o of this.players.values()) {
          const d = dist(o, { x: ax, y: ay });
          if (!o.dead && d <= bd + o.r && dist(o, p) <= sk.range) { bd = d; tgt = o; }
        }
        const h = sk.heal!;
        const total = h.base + p.st.ap * h.apRatio + tgt.st.hp * h.hpPct;
        const ticks = h.ms / 500;
        addEffect(this, tgt, { id: "regen_hp", ms: h.ms, dot: healPerTick(total / ticks, p, tgt) }, p);
        this.healed(p, tgt, total * sk.threat);
        return;
      }
    }
  }

  /** 힐 위협: 그 아군과 싸우는 몹들이 치유한 쪽을 노림 (§13-2 힐량 × 0.5 — 스킬 threat 로 반영) */
  private healed(src: Player, tgt: Unit, amount: number) {
    for (const m of this.mobs.values()) if (m.threat.has(tgt.id)) m.threat.set(src.id, (m.threat.get(src.id) ?? 0) + amount);
  }

  private moveProjectiles(dt: number) {
    for (const pr of [...this.projs]) {
      const speed = Math.sqrt(pr.vx * pr.vx + pr.vy * pr.vy);
      const total = Math.min(pr.left, speed * dt);
      const n = Math.max(1, Math.ceil(total / 4));
      let done = false;
      for (let i = 0; i < n && !done; i++) {
        pr.x += (pr.vx / speed) * (total / n);
        pr.y += (pr.vy / speed) * (total / n);
        const targets: Unit[] = pr.team === "p" ? [...this.mobs.values()] : [...this.players.values()];
        for (const t of targets) {
          if (t.dead) continue;
          const q = t.kind === "m" ? this.posAt(t as Mob, pr.lag) : t;
          if (dist(pr, q) <= pr.r + t.r) {
            hit(this, pr.owner, t, pr.spec);
            done = true;
            break;
          }
        }
      }
      pr.left -= total;
      if (done || pr.left <= 0.01) {
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
      if (!c.p.dead && !c.p.block.skill && c.p.room === this) this.fire(c.p, c.sk, c.p.x, c.p.y, c.ax, c.ay, -1);
    }
    this.moveProjectiles(dt);
    for (const m of this.mobs.values()) {
      mobTick(this, m, dt);
      m.hist.push([now, m.x, m.y]);
      if (m.hist.length > 6) m.hist.shift();
    }
    for (const u of [...this.players.values(), ...this.mobs.values()]) {
      tickEffects(this, u);
      regen(this, u, dt);
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
      for (const k of SLOTS) v.push(Math.max(0, Math.round((p.cd[k] ?? 0) - sim)));
      const pe = p.out.length ? `,"pe":${JSON.stringify(p.out)}` : "";
      p.out = [];
      p.ws.send(`{"t":"s","st":${now},"ack":${JSON.stringify({ seq: p.lastSeq, m: p.mover })},"v":${JSON.stringify(v)},"e":${e}${ev}${pe}}`);
    }
  }
}

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
  p.base = baseStats(c.level);
  recalc(p);
  p.hp = p.st.hp;
  p.mp = p.st.mana;
  p.en = p.st.energy;
  p.mover.stamina = p.mover.staminaMax;
  room.ev.push(["lv", p.id, c.level]);
}

export const playerSlots = () => ({ ...APPRENTICE_SLOTS });

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
