import { MOBS, mobStats, type BossMove, type Grade, type MobDef } from "../../../web/rpg/shared/data/mobs.ts";
import { MOVE } from "../../../web/rpg/shared/data/stats.ts";
import { blocked, dir8, slide } from "../../../web/rpg/shared/movement.ts";
import { die, dotDamage, find, has, hit, makeUnit, rand, type HitSpec, type Unit } from "./combat.ts";
import type { Room } from "./room.ts";
import type { Shot } from "./skills.ts";

/**
 * 몹 AI (§20-4): 대기 → 순찰 → 추적 → 공격(선딜 · 바닥 경고) → 귀환(리쉬).
 * 위협 수치(§13-2)가 가장 높은 플레이어를 노리고, 도발이 걸리면 도발한 쪽만.
 * ponytail: 길찾기 없이 곧장 다가가며 벽을 따라 미끄러짐 — 던전(P7) 지형에서 끼면 A* 추가
 */

export type Zone = { mob: string; count: number; lv: [number, number]; grade: Grade; x: number; y: number; r: number; alive: number; respawn: number[] };

export type Mob = Unit & {
  key: string;
  def: MobDef;
  grade: Grade;
  zone: Zone;
  home: { x: number; y: number };
  dir: number;
  moving: boolean;
  state: "idle" | "patrol" | "leash";
  wait: number;
  tx: number;
  ty: number;
  threat: Map<number, number>;
  dmgBy: Map<number, number>;
  atkReady: number;
  spReady: number;
  swings: number;
  /** 선딜 중인 공격 */
  wind: { until: number; sp: boolean; x: number; y: number; ang: number; tgt: number } | null;
  /** 지연 보상용 최근 위치 [시각, x, y] */
  hist: [number, number, number][];
  removeAt: number;
  /** 마지막으로 맞힌 스킬 (막타 숙련도) */
  lastShot: Shot | null;
  /** 보스 (§20-4): 지금 페이즈 · 타임라인 위치 (전투가 끝나면 null) */
  phase: number;
  tl: { i: number; base: number } | null;
};

export const RESPAWN_MS = 15_000;

export function spawnMob(room: Room, id: number, z: Zone): Mob | null {
  const def = MOBS[z.mob];
  for (let i = 0; i < 12; i++) {
    const a = rand() * Math.PI * 2;
    const r = Math.sqrt(rand()) * z.r;
    const x = Math.round(z.x + Math.cos(a) * r);
    const y = Math.round(z.y + Math.sin(a) * r);
    if (blocked(room.map.collider, x, y)) continue;
    const lv = z.lv[0] + Math.floor(rand() * (z.lv[1] - z.lv[0] + 1));
    const u = makeUnit({ id, kind: "m", name: def.name, el: def.el, lv, x, y, r: def.r, base: mobStats(def, lv, z.grade) });
    z.alive++;
    return Object.assign(u, {
      key: z.mob, def, grade: z.grade, zone: z, home: { x, y }, dir: 0, moving: false, state: "idle" as const, wait: room.now + rand() * 3000,
      tx: x, ty: y, threat: new Map(), dmgBy: new Map(), atkReady: 0, spReady: 0, swings: 0, wind: null, hist: [], removeAt: 0, lastShot: null,
      phase: 0, tl: null,
    });
  }
  return null;
}

const dist = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2);

/** 목표로 이동. 도착하면 true */
function moveTo(room: Room, m: Mob, tx: number, ty: number, mul: number, dt: number): boolean {
  const dx = tx - m.x;
  const dy = ty - m.y;
  const d = Math.sqrt(dx * dx + dy * dy);
  if (d < 2) return true;
  if (m.block.move) return false;
  const s = Math.min(d, (m.st.moveSpeed / 100) * MOVE.pxPerSecAt100 * mul * dt);
  const ox = m.x;
  const oy = m.y;
  slide(m, room.map.collider, (dx / d) * s, (dy / d) * s);
  m.dir = dir8(dx, dy);
  m.moving = m.x !== ox || m.y !== oy;
  return false;
}

function topThreat(room: Room, m: Mob): Unit | undefined {
  let best: Unit | undefined;
  let bv = -1;
  for (const [id, v] of m.threat) {
    const p = room.combatant(id); // 플레이어 · 소환수 (P13)
    if (!p || p.dead) { m.threat.delete(id); continue; }
    if (has(p, "stealth") || room.now < (p.icd.get("decoy") ?? 0)) continue; // 은신 · 잔상(환영자객)은 놓침 (위협 수치는 남음)
    if (v > bv) { bv = v; best = p; }
  }
  return best;
}

export function mobTick(room: Room, m: Mob, dt: number) {
  m.moving = false;
  if (m.dead || m.def.passive) return;
  const now = room.now;
  if (m.block.move && m.block.atk) { m.wind = null; return; } // 기절 · 빙결 · 에어본 · 수면

  const fear = find(m, "fear");
  if (fear) {
    const s = room.unit(fear.src);
    if (s) moveTo(room, m, m.x * 2 - s.x, m.y * 2 - s.y, 0.6, dt);
    return;
  }
  if (m.state === "leash") {
    if (moveTo(room, m, m.home.x, m.home.y, 1.6, dt)) {
      m.state = "idle";
      m.evade = false;
      m.hp = m.st.hp;
      m.wait = now + 1000;
    }
    return;
  }

  const taunt = find(m, "taunt");
  let tgt = taunt ? room.players.get(taunt.src) : topThreat(room, m);
  if (tgt?.dead) tgt = undefined;
  if (!tgt && m.def.aggro) {
    let bd = m.def.aggro;
    for (const p of room.players.values()) {
      const d = dist(m, p);
      if (!p.dead && !has(p, "stealth") && room.now >= (p.icd.get("decoy") ?? 0) && d < bd) { bd = d; tgt = p; }
    }
    if (tgt) m.threat.set(tgt.id, 1);
  }
  if (!tgt) { m.wind = null; m.tl = null; wander(room, m, dt); return; }
  if (m.def.boss) bossTick(room, m, tgt);

  if (dist(m, m.zone) > m.zone.r + m.def.leash) {
    m.state = "leash";
    m.evade = true;
    m.threat.clear();
    m.dmgBy.clear();
    m.wind = null;
    return;
  }
  if (m.wind) {
    if (now >= m.wind.until) resolve(room, m);
    return;
  }

  const d = dist(m, tgt);
  const sp = m.def.special;
  if (sp?.cdMs && now >= m.spReady && !m.block.atk && d >= (sp.minRange ?? 0) && d <= (sp.maxRange ?? 1e9)) return startWind(room, m, tgt, true);
  const a = m.def.attack;
  const reach = a.range + tgt.r;
  if (d <= reach && now >= m.atkReady && !m.block.atk) {
    m.swings++;
    return startWind(room, m, tgt, !!sp?.every && m.swings % sp.every === 0);
  }
  if (d > (a.kind === "shot" ? a.range * 0.8 : reach * 0.7)) moveTo(room, m, tgt.x, tgt.y, 1, dt);
  else m.dir = dir8(tgt.x - m.x, tgt.y - m.y);
}

// ── 보스 패턴 (§20-4 JSON 타임라인) ─────────────────────────────────────

/** HP 비율로 페이즈를 고르고, 페이즈 타임라인을 loopMs 주기로 되풀이 */
function bossTick(room: Room, m: Mob, tgt: Unit) {
  const phases = m.def.boss!.phases;
  let ph = m.phase;
  while (ph + 1 < phases.length && m.hp / m.st.hp <= phases[ph + 1].hp) ph++;
  if (ph !== m.phase) room.ev.push(["bp", m.id, phases[ph].name]);
  if (ph !== m.phase || !m.tl) {
    m.phase = ph;
    m.tl = { i: 0, base: room.now };
  }
  const P = phases[ph];
  const tl = m.tl;
  for (let guard = 0; guard < P.timeline.length && room.now >= tl.base + P.timeline[tl.i].at; guard++) {
    bossMove(room, m, tgt, P.timeline[tl.i].move);
    if (++tl.i >= P.timeline.length) { tl.i = 0; tl.base += P.loopMs; }
  }
}

const shuffle = <T>(a: T[]) => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };

export function bossMove(room: Room, m: Mob, tgt: Unit, mv: BossMove) {
  const alive = [...room.players.values()].filter((p) => !p.dead);
  const spec = (mul: number, fx?: { id: string; ms: number; v?: number }): HitSpec => ({ base: 0, atkRatio: mul, apRatio: 0, cat: "physical", el: m.el, threat: 0, melee: false, basic: false, fx: fx ? [fx] : undefined });
  const circle = (x: number, y: number, r: number, ms: number, mul: number, fx?: { id: string; ms: number; v?: number }) => {
    room.ev.push(["w", "circle", Math.round(x), Math.round(y), 0, r, 0, ms]);
    room.later(ms, () => { if (!m.dead) for (const p of room.players.values()) if (!p.dead && dist(p, { x, y }) <= r + p.r) hit(room, m, p, spec(mul, fx)); });
  };
  switch (mv.kind) {
    case "slam":
      for (const t of (mv.count ? shuffle(alive).slice(0, mv.count) : [tgt])) circle(t.x, t.y, mv.r, mv.windMs, mv.mul, mv.fx);
      return;
    case "nova":
      return circle(m.x, m.y, mv.r, mv.windMs, mv.mul, mv.fx);
    case "line": {
      const ang = Math.atan2(tgt.y - m.y, tgt.x - m.x);
      room.ev.push(["w", "line", Math.round(m.x), Math.round(m.y), Math.round(ang * 1000) / 1000, mv.len, mv.width, mv.windMs]);
      m.wind = null;
      room.later(mv.windMs, () => {
        if (m.dead) return;
        const ux = Math.cos(ang);
        const uy = Math.sin(ang);
        const sx = m.x;
        const sy = m.y;
        if (mv.lunge) for (let i = 0; i < 10; i++) slide(m, room.map.collider, (ux * mv.len) / 10, (uy * mv.len) / 10);
        for (const p of room.players.values()) {
          if (p.dead) continue;
          const t = Math.max(0, Math.min(mv.len, (p.x - sx) * ux + (p.y - sy) * uy));
          if (Math.hypot(sx + ux * t - p.x, sy + uy * t - p.y) <= mv.width / 2 + p.r) hit(room, m, p, spec(mv.mul, mv.fx));
        }
      });
      return;
    }
    case "summon":
      for (let i = 0; i < mv.n; i++) {
        const a = room.addMob({ mob: mv.mob, count: 0, lv: [m.lv, m.lv], grade: mv.grade, x: m.x, y: m.y, r: 48, alive: 0, respawn: [] });
        if (a) { a.threat.set(tgt.id, 1); summoned(room, a); }
      }
      return;
    case "spread":
      // 분산: 모든 플레이어 발밑 원 — 터질 때 다른 플레이어가 원 안에 있으면 그 수만큼 더 아픔
      for (const p of alive) room.ev.push(["w", "circle", Math.round(p.x), Math.round(p.y), 0, mv.r, 0, mv.windMs]);
      room.later(mv.windMs, () => {
        if (m.dead) return;
        const now = [...room.players.values()].filter((p) => !p.dead);
        for (const p of now) hit(room, m, p, spec(mv.mul * (1 + now.filter((o) => o !== p && dist(o, p) <= mv.r).length)));
      });
      return;
    case "stack": {
      // 집결: 한 곳에 큰 원 — 안에 든 사람 수로 피해를 나눔, 아무도 없으면 전원이 절반씩
      const t = alive[Math.floor(rand() * alive.length)] ?? tgt;
      const at = { x: t.x, y: t.y };
      room.ev.push(["w", "circle", Math.round(at.x), Math.round(at.y), 0, mv.r, 0, mv.windMs]);
      room.ev.push(["wp", Math.round(at.x), Math.round(at.y), mv.r, mv.windMs]);
      room.later(mv.windMs, () => {
        if (m.dead) return;
        const now = [...room.players.values()].filter((p) => !p.dead);
        const inside = now.filter((p) => dist(p, at) <= mv.r + p.r);
        if (inside.length) for (const p of inside) hit(room, m, p, spec(mv.mul / inside.length));
        else for (const p of now) hit(room, m, p, spec(mv.mul / 2));
      });
      return;
    }
    case "orbs": {
      // 전멸기: 정화의 구슬을 ms 안에 다 부수지 못하면 남은 구슬마다 최대 체력의 pct (방어 무시)
      room.ev.push(["ann", "정화의 구슬을 모두 부수세요!", mv.ms]);
      const orbs: Mob[] = [];
      for (let i = 0; i < mv.n; i++) {
        const a = (i / mv.n) * Math.PI * 2 + rand();
        const o = room.addMob({ mob: "purify_orb", count: 0, lv: [m.lv, m.lv], grade: "normal", x: Math.round(m.x + Math.cos(a) * 96), y: Math.round(m.y + Math.sin(a) * 80), r: 12, alive: 0, respawn: [] });
        if (o) { orbs.push(o); summoned(room, o); }
      }
      room.later(mv.ms, () => {
        const left = orbs.filter((o) => !o.dead);
        if (!left.length || m.dead) return;
        for (const o of left) die(room, o, undefined);
        room.ev.push(["ann", `정화 실패! (남은 구슬 ${left.length}개)`, 2500]);
        for (const p of room.players.values()) if (!p.dead) dotDamage(room, m, p, p.st.hp * mv.pct * left.length);
      });
      return;
    }
  }
}

/** 던전이 소환된 몹에게 인원 보정 등을 거는 곳 (dungeon.ts 가 채움) */
export const bossHooks = { summoned: (_room: Room, _m: Mob) => {} };
const summoned = (room: Room, m: Mob) => bossHooks.summoned(room, m);

function wander(room: Room, m: Mob, dt: number) {
  const now = room.now;
  if (m.state === "patrol") {
    const ox = m.x;
    const oy = m.y;
    const done = moveTo(room, m, m.tx, m.ty, 0.5, dt);
    if (done || now > m.wait || (m.x === ox && m.y === oy)) { m.state = "idle"; m.moving = false; m.wait = now + 2000 + rand() * 3000; }
    return;
  }
  if (now < m.wait) return;
  const a = rand() * Math.PI * 2;
  const r = Math.sqrt(rand()) * m.zone.r;
  m.tx = m.zone.x + Math.cos(a) * r;
  m.ty = m.zone.y + Math.sin(a) * r;
  m.state = "patrol";
  m.wait = now + 6000;
}

function startWind(room: Room, m: Mob, tgt: Unit, special: boolean) {
  const now = room.now;
  const ang = Math.atan2(tgt.y - m.y, tgt.x - m.x);
  const sp = m.def.special;
  const ms = special && sp ? sp.windMs : m.def.attack.windMs;
  let x = tgt.x;
  let y = tgt.y;
  if (special && sp) {
    x = sp.shape === "circle" ? m.x + Math.cos(ang) * 14 : m.x;
    y = sp.shape === "circle" ? m.y + Math.sin(ang) * 14 : m.y;
    room.ev.push(["w", sp.shape, Math.round(x), Math.round(y), Math.round(ang * 1000) / 1000, sp.size, sp.width ?? 0, ms]);
    if (sp.cdMs) m.spReady = now + sp.cdMs;
  }
  m.wind = { until: now + ms, sp: special, x, y, ang, tgt: tgt.id };
  m.dir = dir8(tgt.x - m.x, tgt.y - m.y);
  m.atkReady = now + ms + m.def.attack.cdMs;
  room.ev.push(["c", m.id, special ? "sp" : "atk", Math.round(tgt.x), Math.round(tgt.y)]);
}

function resolve(room: Room, m: Mob) {
  const w = m.wind!;
  m.wind = null;
  const a = m.def.attack;
  const base: HitSpec = { base: 0, atkRatio: 1, apRatio: 0, cat: "physical", el: m.el, threat: 0, melee: a.kind === "melee", basic: true };
  if (!w.sp) {
    const t = room.combatant(w.tgt);
    if (!t || t.dead) return;
    if (a.kind === "shot") room.shoot(m, `mob:${m.key}`, m.el, t.x - m.x, t.y - m.y, a.speed ?? 150, a.range * 1.3, 5, { ...base, cat: "magical", melee: false }, -1, 0);
    else if (dist(m, t) <= a.range + t.r + 6) hit(room, m, t, { ...base, fx: a.fx ? [a.fx] : undefined });
    return;
  }
  const sp = m.def.special!;
  const spec: HitSpec = { ...base, atkRatio: sp.mul, basic: false, fx: sp.fx ? [sp.fx] : undefined };
  if (sp.shape === "circle") {
    for (const p of room.players.values()) if (!p.dead && dist(p, w) <= sp.size + p.r) hit(room, m, p, spec);
    return;
  }
  // 직선 돌진: 경고선을 따라 달려가며 닿은 플레이어를 침
  const ux = Math.cos(w.ang);
  const uy = Math.sin(w.ang);
  const sx = m.x;
  const sy = m.y;
  if (sp.lunge) for (let i = 0; i < 10; i++) slide(m, room.map.collider, (ux * sp.size) / 10, (uy * sp.size) / 10);
  for (const p of room.players.values()) {
    if (p.dead) continue;
    const t = Math.max(0, Math.min(sp.size, (p.x - sx) * ux + (p.y - sy) * uy));
    if (Math.sqrt((sx + ux * t - p.x) ** 2 + (sy + uy * t - p.y) ** 2) <= (sp.width ?? 16) / 2 + p.r) hit(room, m, p, spec);
  }
}
