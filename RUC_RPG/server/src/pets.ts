import { ENGINEER, PETS, type PetDef } from "../../../web/rpg/shared/data/pets.ts";
import { blocked, dir8, slide } from "../../../web/rpg/shared/movement.ts";
import type { EntityInfo } from "../../../web/rpg/shared/protocol.ts";
import { applyHeal, healPerTick, hit, rand, type HitSpec, type Unit } from "./combat.ts";
import { newId, type Player, type Room } from "./room.ts";
import { cleanse } from "./skills.ts";

/**
 * 소환수 · 설치물 (P9, D81). 방의 pets 에 있고 스냅샷에 엔티티 줄로 실림 — 몹 · 플레이어가 아니라 맞지도 막지도 않음.
 * 피해 · 치유는 주인의 스탯 + 소환수 계수로, 주인이 한 것으로 계산 (경험치 · 위협 · 처치 기여도 주인).
 */
export type Pet = { id: number; owner: Player; def: PetDef; key: string; x: number; y: number; dir: number; moving: boolean; until: number; next: number; ox: number; oy: number };

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
    const q: Pet = { id: newId(), owner: p, def, key: s.pet, x: free ? p.x + ox : p.x, y: free ? p.y + oy : p.y, dir: p.mover.dir, moving: false, until: room.now + life, next: room.now + 400, ox, oy };
    room.pets.push(q);
    room.broadcast({ t: "spawn", e: petInfo(q) });
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
  return { ...d.damage!, cat: d.category ?? "physical", el, threat: 1, proc: !!el && el !== "none", fx: d.fx, melee: d.act === "melee" };
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
    if (room.now >= q.until || o.dead || o.room !== room) { unsummon(room, q); continue; }
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
