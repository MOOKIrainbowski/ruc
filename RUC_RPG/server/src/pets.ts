import { ENGINEER, PETS, type PetDef } from "../../../web/rpg/shared/data/pets.ts";
import { blocked, dir8, slide } from "../../../web/rpg/shared/movement.ts";
import type { EntityInfo } from "../../../web/rpg/shared/protocol.ts";
import { applyHeal, healPerTick, hit, makeUnit, rand, recalc, type HitSpec, type Unit } from "./combat.ts";
import { newId, type Player, type Room } from "./room.ts";
import { cleanse } from "./skills.ts";

/**
 * 소환수 · 설치물 (P9 D81 · P13 D95). 방의 pets 에 있고 스냅샷에 엔티티 줄로 실림.
 * 피해 · 치유는 주인의 스탯 + 소환수 계수로, 주인이 한 것으로 계산 (경험치 · 처치 기여도 주인).
 * P13: 전투 유닛(HP = 주인 최대 HP × def.hp) — 몹이 노리고 때릴 수 있음. 소환수가 준 피해는 그 소환수의 위협(× taunt)으로, 주인 위협은 30%만.
 */
export type Pet = Unit & { owner: Player; def: PetDef; key: string; dir: number; moving: boolean; until: number; next: number; ox: number; oy: number };

const dist = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y);

/** 엔티티 정보: 몹 그림으로 그림 (잔상은 주인 모습) */
export const petInfo = (q: Pet): EntityInfo =>
  q.key === "decoy"
    ? { id: q.id, name: q.owner.name, el: q.owner.el, lv: q.owner.lv, ap: q.owner.char.appearance, look: q.owner.look, pet: q.owner.id }
    : { id: q.id, name: q.def.name, el: q.owner.el, lv: q.owner.lv, mob: q.def.sprite, pet: q.owner.id };

/** 부르기: max 를 넘으면 오래된 것부터 없앰. 엔지니어 「정비」 = 설치물 지속 +30% */
export function summon(room: Room, p: Player, s: { pet: string; ms: number; max?: number; n?: number }) {
  const def = PETS[s.pet];
  if (!def) return;
  const life = s.ms * (p.job === "engineer" && !def.follow ? ENGINEER.life : 1);
  for (let i = 0; i < (s.n ?? 1); i++) {
    const mine = room.pets.filter((q) => q.owner === p && q.key === s.pet);
    if (mine.length >= (s.max ?? 1)) unsummon(room, mine[0]);
    const a = rand() * Math.PI * 2;
    const ox = Math.cos(a) * 24;
    const oy = Math.sin(a) * 16;
    const free = !blocked(room.map.collider, p.x + ox, p.y + oy);
    const u = makeUnit({ id: newId(), kind: "p", name: def.name, el: p.el, lv: p.lv, x: free ? p.x + ox : p.x, y: free ? p.y + oy : p.y, r: 6, base: { ...p.base, hp: Math.max(1, Math.round(p.st.hp * def.hp)) } });
    const q: Pet = Object.assign(u, { petOf: p.id, owner: p, def, key: s.pet, dir: p.mover.dir, moving: false, until: room.now + life, next: room.now + 400, ox, oy });
    recalc(q);
    q.hp = q.st.hp;
    room.pets.push(q);
    room.broadcast({ t: "spawn", e: petInfo(q) });
    // 잔상: 주인을 노리던 근처 몹이 잔상을 노림
    if (s.pet === "decoy") for (const m of room.mobs.values()) if (m.threat.has(p.id) && dist(m, q) <= 220) m.threat.set(q.id, m.threat.get(p.id)! * 2 + 50);
  }
}

export function unsummon(room: Room, q: Pet) {
  const i = room.pets.indexOf(q);
  if (i < 0) return;
  room.pets.splice(i, 1);
  room.broadcast({ t: "despawn", id: q.id });
}

/** 주인 · 그 주인과 싸우는 대상 중 소환수에서 가장 가까운 것 */
function nearestFoe(room: Room, q: Pet, range: number): Unit | undefined {
  let best: Unit | undefined;
  let bd = range;
  for (const u of room.foes(q.owner)) {
    const d = dist(u, q) - u.r;
    if (d <= bd && dist(u, q.owner) <= 220) { bd = d; best = u; }
  }
  return best;
}

const spec = (q: Pet): HitSpec => {
  const d = q.def;
  const el = d.el === "owner" ? q.owner.el : (d.el ?? null);
  return { ...d.damage!, cat: d.category ?? "physical", el, threat: 0.3, proc: !!el && el !== "none", fx: d.fx, melee: d.act === "melee", pet: q.id, taunt: d.taunt };
};

function moveTo(room: Room, q: Pet, tx: number, ty: number, stop: number, dt: number) {
  const d = dist(q, { x: tx, y: ty });
  if (d <= stop) return;
  if (d > 260) { q.x = tx; q.y = ty; return; } // 너무 멀어지면 주인 곁으로
  const s = Math.min(d - stop, q.owner.st.moveSpeed * 1.25 * dt);
  const dx = ((tx - q.x) / d) * s;
  const dy = ((ty - q.y) / d) * s;
  slide(q, room.map.collider, dx, dy);
  q.moving = true;
  q.dir = dir8(dx, dy);
}

/** 틱: 수명 · 따라가기 · 행동 */
export function petTick(room: Room, dt: number) {
  for (const q of [...room.pets]) {
    const o = q.owner;
    if (room.now >= q.until || o.dead || o.room !== room || q.dead) { unsummon(room, q); continue; }
    q.moving = false;
    const d = q.def;
    const tgt = d.act === "melee" || d.act === "shot" ? nearestFoe(room, q, d.follow ? 150 : d.range) : undefined;
    if (d.follow) {
      if (tgt && d.act === "melee") moveTo(room, q, tgt.x, tgt.y, d.range + tgt.r - 4, dt);
      else moveTo(room, q, o.x + q.ox, o.y + q.oy, 6, dt);
    }
    if (room.now < q.next || d.act === "decoy") continue;
    q.next = room.now + d.cdMs;
    if (d.act === "melee" && tgt && dist(q, tgt) <= d.range + tgt.r) hit(room, o, tgt, spec(q));
    else if (d.act === "shot" && tgt && dist(q, tgt) <= d.range + tgt.r) {
      const s = spec(q);
      room.shoot(o, q.key, s.el, tgt.x - q.x, tgt.y - q.y, 260, d.range + 20, 4, s, -1, 0, 0, 0, q);
    } else if (d.act === "aura") {
      const hits = room.foes(o).filter((u) => dist(u, q) <= d.range + u.r);
      for (const u of hits) hit(room, o, u, spec(q));
      if (hits.length) room.ev.push(["gx", Math.round(q.x), Math.round(q.y), d.range, spec(q).el ?? ""]);
    } else if (d.act === "heal" && d.heal) {
      const h = d.heal;
      for (const a of room.players.values()) {
        if (a.dead || dist(a, q) > d.range || room.hostile(o, a)) continue;
        applyHeal(room, o, a, healPerTick(h.base + o.st.ap * h.apRatio + a.st.hp * h.hpPct, o, a), true);
        if (d.cleanse) cleanse(room, o, a);
      }
    } else q.next = room.now + 200; // 대상이 없으면 곧 다시 봄
  }
}
