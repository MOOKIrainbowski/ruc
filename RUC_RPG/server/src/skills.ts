import { castMs } from "../../../web/rpg/shared/combat.ts";
import { SIM_MS } from "../../../web/rpg/shared/constants.ts";
import type { ElementId } from "../../../web/rpg/shared/data/elements.ts";
import { SKILLS, type SkillDef, type SkillFx } from "../../../web/rpg/shared/data/skills.ts";
import { castMove, type MoveInput } from "../../../web/rpg/shared/movement.ts";
import { MASTERY, skillNums } from "../../../web/rpg/shared/progress.ts";
import { effectDef } from "../../../web/rpg/shared/data/effects.ts";
import { JOBS, SPIRIT_BUFF } from "../../../web/rpg/shared/data/jobs.ts";
import { ENGINEER } from "../../../web/rpg/shared/data/pets.ts";
import { addEffect, applyHeal, healPerTick, hit, rand, removeEffect, type HitSpec, type Unit } from "./combat.ts";
import { summon } from "./pets.ts";
import type { Mob } from "./mobs.ts";
import { gainMastery, learnedOf } from "./progress.ts";
import type { Player, Room } from "./room.ts";

/**
 * 스킬 엔진 (§10-2): 시전 검증 → 움직임(castMove) → 발동. 반복(채널링 · 지속 장판) · 지연(바닥 경고) · 보조 스킬은 방의 casts 에 예약.
 * 숙련도(§10-3): 사용 +1 · 적중한 적 / 도운 아군마다 +2 (시전 한 번에 대상당 한 번) · 막타 +5 (room.killed).
 */

/** 시전 한 번 — 반복 · 투사체가 같은 것을 씀 */
export type Shot = {
  p: Player; sk: SkillDef; n: ReturnType<typeof skillNums>; seq: number; mul: number; tid: number; rep: number;
  /** 숙련도를 받을 스킬 (보조 스킬은 부모) */
  mid: string;
  /** 숙련도를 이미 준 대상 */
  hit: Set<number>;
};
export type Cast = { at: number; s: Shot; sx: number; sy: number; ax: number; ay: number };

const dist = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2);

/** 커서 근처(24px) · 사거리 안의 살아 있는 적 (몹 · 적대 플레이어) */
function enemyNear(room: Room, p: Player, ax: number, ay: number, range: number): Unit | undefined {
  let best: Unit | undefined;
  let bd = 24;
  for (const m of room.foes(p)) {
    const d = dist(m, { x: ax, y: ay });
    if (d <= bd + m.r && dist(m, p) <= range + m.r + 8) { bd = d; best = m; }
  }
  return best;
}

/** 커서 근처 아군 (없으면 자신). dead = 쓰러진 아군도 고름 (부활). 적대 플레이어는 아군이 아님 */
function allyNear(room: Room, p: Player, ax: number, ay: number, range: number, dead: boolean): Player {
  let best: Player = p;
  let bd = 24;
  for (const o of room.players.values()) {
    if (o === p || (o.dead && !dead) || room.hostile(p, o)) continue;
    const d = dist(o, { x: ax, y: ay });
    if (d <= bd + o.r && dist(o, p) <= range + 8) { bd = d; best = o; }
  }
  return best;
}

/** 시전 속성: 고정 → 보조(원소술사) → 주 속성. alternate 는 반복마다 주 · 보조 번갈아 */
function elementOf(s: Shot): ElementId | null {
  const { sk, p } = s;
  if (sk.el) return sk.el;
  if (sk.sub || (sk.special === "alternate" && s.rep % 2 === 1)) return p.prog.sub ?? p.el;
  return sk.elementInherit ? p.el : null;
}

const scaleFx = (list: SkillFx[] | undefined, mul: number) => list?.map((f) => ({ ...f, v: f.v !== undefined ? f.v * mul : undefined }));

function specOf(s: Shot): HitSpec {
  const { sk, n, p } = s;
  let el = elementOf(s);
  let d = sk.damage ?? { base: 0, atkRatio: 0, apRatio: 0 };
  let cat = sk.category;
  let proc = !!el;
  // 마법형 직업(나이트워커 · 마궁사)의 평타는 주문력 기반 (D80). 마궁사 「마력 화살촉」: 주 속성 + 30% 확률로 속성 효과
  if (sk.slot === "A" && p.job && JOBS[p.job]?.kind === "magic") {
    d = { base: d.base, atkRatio: 0, apRatio: d.atkRatio + d.apRatio };
    cat = "magical";
    if (p.job === "magic_archer") { el = p.el; proc = rand() < 0.3; }
  }
  return {
    ...d, cat, el, gradeMul: n.gradeMul, skillLv: n.lv, skill: sk.slot !== "A",
    melee: sk.targeting === "melee" || sk.targeting === "dash" || (sk.targeting === "self" && (sk.radius ?? 0) <= 72),
    threat: sk.threat, proc, fx: scaleFx(sk.effects, n.fx), basic: sk.slot === "A", cast: s, crit: sk.crit, execute: sk.execute, mul: s.mul,
    ranged: sk.targeting === "skillshot" && cat === "physical", reach: n.range,
  };
}


/** 디버프 해제. 주술사 「조상의 가호」: 하나라도 지웠으면 1.5초 보호막(최대 HP 8%) */
export function cleanse(room: Room, src: Unit, a: Unit) {
  const bad = a.fx.filter((e) => !effectDef(e.id)?.buff);
  for (const e of bad) removeEffect(room, a, e.id);
  if (bad.length && src.job === "shaman") addEffect(room, a, { id: "shield", ms: 1500, v: Math.round(a.st.hp * 0.08) }, src);
}

/** 적 한 명에게: 피해(있으면) → 효과 · 넉백 · 숙련도 */
function strike(room: Room, s: Shot, t: Unit, from: { x: number; y: number }) {
  if (t.dead) return;
  const spec = specOf(s);
  if (s.sk.damage) hit(room, s.p, t, spec);
  else {
    for (const f of spec.fx ?? []) addEffect(room, t, f, s.p);
    room.damaged(s.p, t, 0, s.sk.threat);
    if (t.kind === "m") credit(s, t);
  }
  if (s.sk.knock && !t.dead) {
    const dx = t.x - from.x;
    const dy = t.y - from.y;
    const len = Math.sqrt(dx * dx + dy * dy) || 1;
    room.push(t, (dx / len) * s.sk.knock, (dy / len) * s.sk.knock);
  }
}

/** 숙련도 적중 · 도움 +2 (시전 한 번에 대상당 한 번, 몹 등급 배율) */
export function credit(s: Shot, t: Unit) {
  if (s.sk.slot === "A" || s.hit.has(t.id)) return;
  s.hit.add(t.id);
  gainMastery(s.p, s.mid, t.kind === "m" ? MASTERY.hit : MASTERY.support, t.kind === "m" ? (t as Mob).grade : undefined);
}

/** 아군 한 명에게: 부활 · 치유 · 보호막 · 버프 · 정화 */
function support(room: Room, s: Shot, a: Player, healIt = true) {
  const { sk, n, p } = s;
  if (sk.revive && a.dead) room.revive(a, sk.revive);
  if (a.dead) return;
  if (sk.heal && healIt) {
    const total = (sk.heal.base + p.st.ap * sk.heal.apRatio + a.st.hp * sk.heal.hpPct) * n.power;
    if (sk.heal.ms) {
      const ticks = sk.heal.ms / 500;
      addEffect(room, a, { id: "regen_hp", ms: sk.heal.ms, dot: healPerTick(total / ticks, p, a) }, p);
    } else applyHeal(room, p, a, healPerTick(total, p, a), true);
    room.healed(p, a, total * sk.threat);
  }
  if (sk.shield) addEffect(room, a, { id: "shield", ms: sk.shield.ms, v: Math.round((sk.shield.base + p.st.ap * sk.shield.apRatio + a.st.hp * sk.shield.hpPct) * n.power * (1 + p.st.healPower)) }, p);
  for (const f of scaleFx(sk.allyFx, n.fx) ?? []) addEffect(room, a, f, p);
  if (sk.cleanse) cleanse(room, p, a);
  const sb = p.job === "spiritcaller" && (sk.allyFx || sk.heal || sk.shield) ? SPIRIT_BUFF[p.el] : undefined;
  if (sb) addEffect(room, a, { id: sb.id, ms: sb.ms, v: sb.v, dot: sb.dot ? healPerTick(sb.dot + p.st.ap * 0.05, p, a) : undefined }, p);
  credit(s, a);
}

/**
 * 스킬 검증 (§27: 쿨 · 자원 · 상태 · 대상) → 받아들이면 움직임 + 발동 예약. 거부 이유를 돌려줌.
 * 차지 스킬(charge)은 입력의 cs 로 모으기 시작을 알리고, 떼는 입력(k)에서 모은 시간만큼 세짐 — 시간은 입력 시계로 잼 (D12).
 */
export function cast(room: Room, p: Player, inp: MoveInput): string | null {
  const slot = inp.k!;
  const sk = SKILLS[p.slots[slot] ?? ""];
  if (!sk) return slot === "R" ? "궁극기는 1차 전직(Lv10) 후 열립니다" : "스킬이 없는 슬롯입니다";
  if (room.kind === "plaza") return "광장은 안전지대라 공격 · 스킬을 쓸 수 없습니다";
  if (slot === "A" ? p.block.atk : p.block.skill) return "지금은 쓸 수 없습니다";
  const m = p.mover;
  if (m.mv > 0 || m.lock > 0) return "다른 동작 중입니다";
  const ax = Number(inp.ax);
  const ay = Number(inp.ay);
  if (!Number.isFinite(ax) || !Number.isFinite(ay)) return "조준 오류";
  const n = skillNums(sk, learnedOf(p, sk.id), slot === "A" ? 0 : p.st.cdr);
  if (sk.summon && p.job === "engineer") n.cooldownMs *= ENGINEER.cd; // 엔지니어 「정비」
  const sim = p.steps * SIM_MS;
  if (sim < (p.cd[sk.id] ?? 0) - 1) return "재사용 대기 중입니다";
  if (p.mp < n.cost.mana) return "마나가 부족합니다";
  if (p.en < n.cost.energy) return "기력이 부족합니다";
  let tid = p.id;
  let to: { x: number; y: number } | undefined;
  if (sk.targeting === "target") {
    const t = enemyNear(room, p, ax, ay, n.range);
    if (!t) return "대상이 없습니다";
    tid = t.id;
    if (sk.blinkTo) to = room.behind(p, t);
  } else if (sk.targeting === "ally") {
    const a = allyNear(room, p, ax, ay, n.range, !!sk.revive);
    tid = a.id;
    to = a;
  }
  let mul = 1;
  if (sk.charge) {
    const held = p.charge?.slot === slot ? Math.min(sk.charge.ms, (p.steps - p.charge.from) * SIM_MS) : 0;
    mul = 1 + ((sk.charge.mul - 1) * held) / sk.charge.ms;
    p.charge = null;
  }
  p.mp -= n.cost.mana;
  p.en -= n.cost.energy;
  if (sk.throw && p.job === "thrower") {
    // 투척수 「손재주」: 2회 충전 — "+" 키 = 둘 다 찰 때, 본 키 = 다음에 쓸 수 있을 때
    const full = Math.max(sim, p.cd[sk.id + "+"] ?? 0) + n.cooldownMs;
    p.cd[sk.id + "+"] = full;
    p.cd[sk.id] = Math.max(sim, full - n.cooldownMs);
  } else p.cd[sk.id] = sim + (slot === "A" ? castMs(sk.cooldownMs, p.st.atkSpeed) : n.cooldownMs);
  const sx = m.x;
  const sy = m.y;
  castMove(m, sk, ax, ay, room.map.collider, n.range, to);
  if (sk.blinkTo && to) { m.x = to.x; m.y = to.y; }
  p.x = m.x;
  p.y = m.y;
  room.ev.push(["c", p.id, sk.id, Math.round(ax), Math.round(ay)]);
  if (slot !== "A") gainMastery(p, sk.id, MASTERY.use);
  const s: Shot = { p, sk, n, seq: inp.seq, mul, tid, rep: 0, hit: new Set(), mid: sk.id };
  const delay = (sk.castMs ? castMs(sk.castMs, p.st.atkSpeed) : 0) + (sk.delayMs ?? 0);
  if (sk.targeting === "ground" && sk.delayMs) {
    const c = groundAt(s, sx, sy, ax, ay);
    room.ev.push(["w", "circle", Math.round(c.x), Math.round(c.y), 0, Math.round(n.radius), 0, delay, "p"]);
  }
  for (let i = 0; i < (sk.repeat?.n ?? 1); i++) {
    const r: Shot = { ...s, rep: i };
    const at = delay + i * (sk.repeat?.ms ?? 0);
    if (at <= 0) fire(room, r, sx, sy, ax, ay);
    else room.casts.push({ at: room.now + at, s: r, sx, sy, ax, ay });
  }
  if (sk.after) {
    const a = SKILLS[sk.after.skill];
    room.casts.push({ at: room.now + sk.after.ms, s: { ...s, sk: a, n: skillNums(a, learnedOf(p, sk.id), 0), seq: -1 }, sx, sy, ax, ay });
  }
  return null;
}

/** 지면 스킬 중심: 커서, 사거리 밖이면 사거리 끝 */
function groundAt(s: Shot, sx: number, sy: number, ax: number, ay: number) {
  const dx = ax - sx;
  const dy = ay - sy;
  const len = Math.sqrt(dx * dx + dy * dy);
  const k = len > s.n.range ? s.n.range / len : 1;
  return { x: sx + dx * k, y: sy + dy * k };
}

/** 발동. sx · sy = 시전 시작 위치, ax · ay = 조준 */
export function fire(room: Room, s: Shot, sx: number, sy: number, ax: number, ay: number) {
  const { p, sk, n } = s;
  const dx = ax - sx;
  const dy = ay - sy;
  const len = Math.sqrt(dx * dx + dy * dy) || 1;
  const ux = dx / len;
  const uy = dy / len;
  const lag = room.lagOf(p);
  const live = room.foes(p);
  const allies = (x: number, y: number, r: number) => [...room.players.values()].filter((o) => !o.dead && (o === p || (dist(o, { x, y }) <= r && !room.hostile(p, o))));
  switch (sk.targeting) {
    case "skillshot": {
      const count = sk.count ?? 1;
      const base = Math.atan2(dy, dx);
      for (let i = 0; i < count; i++) {
        const a = base + ((i - (count - 1) / 2) * (sk.spread ?? 0) * Math.PI) / 180;
        room.shoot(p, sk.id, elementOf(s), Math.cos(a), Math.sin(a), sk.speed! * (1 + p.st.projSpeed), n.range, (sk.width ?? 4) / 2, specOf(s), s.seq, lag, sk.pierce ?? 0, sk.bounce ?? 0);
      }
      break;
    }
    case "melee": {
      const cosHalf = Math.cos(((sk.arc ?? 90) / 2) * (Math.PI / 180));
      for (const m of live) {
        const q = room.posAt(m, lag);
        const d = dist(p, q);
        if (d > n.range + m.r) continue;
        if (d > m.r && ((q.x - p.x) * ux + (q.y - p.y) * uy) / d < cosHalf) continue;
        strike(room, s, m, p);
      }
      break;
    }
    case "dash": {
      if (!sk.damage || !sk.width) break;
      const [vx, vy] = sk.back ? [-ux, -uy] : [ux, uy];
      for (const m of live) {
        const q = room.posAt(m, lag);
        const t = Math.max(0, Math.min(n.range, (q.x - sx) * vx + (q.y - sy) * vy));
        if (Math.sqrt((sx + vx * t - q.x) ** 2 + (sy + vy * t - q.y) ** 2) <= sk.width / 2 + m.r) strike(room, s, m, { x: sx, y: sy });
      }
      break;
    }
    case "self":
    case "blink": {
      const r = n.radius;
      if (r > 0) for (const m of live) if (dist(m, p) <= r + m.r) strike(room, s, m, p);
      for (const a of allies(p.x, p.y, r)) if (sk.allyFx || sk.heal || sk.shield || sk.cleanse) support(room, s, a);
      if (r > 0 || sk.damage) room.ev.push(["gx", Math.round(p.x), Math.round(p.y), Math.round(r), elementOf(s) ?? ""]);
      break;
    }
    case "target": {
      const t = room.unit(s.tid);
      if (t && !t.dead) strike(room, s, t, p);
      break;
    }
    case "ally": {
      const a = room.players.get(s.tid) ?? p;
      support(room, s, a);
      // 범위 치유 (부활의 기적): 주변 아군도
      if (sk.radius) for (const o of allies(p.x, p.y, n.radius)) if (o !== a) support(room, s, o);
      break;
    }
    case "ground": {
      const c = groundAt(s, sx, sy, ax, ay);
      for (const m of live) if (dist(m, c) <= n.radius + m.r) strike(room, s, m, c);
      if (sk.heal || sk.allyFx) for (const a of allies(c.x, c.y, n.radius)) if (a !== p || dist(p, c) <= n.radius) support(room, s, a);
      room.ev.push(["gx", Math.round(c.x), Math.round(c.y), Math.round(n.radius), sk.heal ? "heal" : elementOf(s) ?? ""]);
      break;
    }
  }
  if (s.rep === 0) {
    for (const f of scaleFx(sk.selfFx, n.fx) ?? []) addEffect(room, p, f, p);
    if (sk.selfFx) credit(s, p);
    if (sk.special === "wall") room.wall(p, ux, uy);
    if (sk.summon) summon(room, p, sk.summon);
  }
}
