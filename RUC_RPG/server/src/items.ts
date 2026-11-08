import { randomUUID } from "node:crypto";
import {
  EQUIP_SLOTS, ITEMS, LOCS, POTION_CD_MS, RARITIES, STACK, bookGrade, durMaxOf, fits, gearOf, lookOf, rollSpecials, stackable,
  type Item, type ItemKind, type ItemPos, type Loc, type Rarity, type Template,
} from "../../../web/rpg/shared/data/items.ts";
import { addEffect, applyHeal, dotDamage, hit, rand, recalc, type HitSpec, type Unit, type World } from "./combat.ts";
import { inTx, loadItems, saveDurability, saveItems } from "./db.ts";
import { bookError, readBook, refreshSlots } from "./progress.ts";
import type { Player } from "./room.ts";

/**
 * 아이템 조작 (§14 · §15). 전부 서버가 검증 → 메모리 반영 → 트랜잭션 저장 + 감사 로그 (§14-3).
 * 저장이 실패하면 DB 를 다시 읽어 메모리를 맞춥니다 — 메모리와 DB 가 어긋나 복사되는 일이 없게.
 */

export type Owner = { char: { id: number; level: number }; items: Item[] };
type Ctx = { storage: boolean };

const at = (o: Owner, loc: Loc, slot: number) => o.items.find((i) => i.loc === loc && i.slot === slot);
const clone = (i: Item): Item => ({ ...i, sp: [...i.sp] });
const validPos = (p: unknown, auto = false): p is ItemPos =>
  Array.isArray(p) && typeof p[0] === "string" && Object.hasOwn(LOCS, p[0]) && Number.isInteger(p[1]) && p[1] >= (auto ? -1 : 0) && p[1] < LOCS[p[0] as Loc];
const same = (a: Item, b: Item) => a.tpl === b.tpl && a.rarity === b.rarity && stackable(ITEMS[a.tpl]);

function commit(o: Owner, action: string, origin: string, before: Item[], after: Item[]): string | null {
  const live = after.filter((i) => i.qty > 0);
  o.items = o.items.filter((i) => i.qty > 0);
  const removed = before.filter((b) => !live.some((a) => a.id === b.id)).map((b) => b.id);
  try {
    saveItems(o.char.id, live, removed, action, origin, before, live);
    return null;
  } catch (e) {
    if (inTx()) throw e; // 경제 조작 안이면 바깥 트랜잭션째 되돌림 (economy.ts)
    console.error("아이템 저장 실패", e);
    o.items = loadItems(o.char.id);
    return "저장에 실패했습니다. 다시 시도해 주세요";
  }
}

export { clone, freeSlot, same };

export function newItem(tpl: string, qty: number, rarity: Rarity, loc: Loc, slot: number): Item {
  const t = ITEMS[tpl];
  const durMax = durMaxOf(t, rarity);
  return { id: randomUUID(), tpl, loc, slot, qty, rarity, enh: 0, sp: rollSpecials(t, rarity, rand), dur: durMax, durMax };
}

/** 빈 칸 — 핫바 먼저 (마크처럼) */
function freeSlot(o: Owner, locs: Loc[], taken: Item[] = []): ItemPos | null {
  for (const loc of locs)
    for (let s = 0; s < LOCS[loc]; s++) if (!at(o, loc, s) && !taken.some((i) => i.loc === loc && i.slot === s)) return [loc, s];
  return null;
}

/** 장착할 칸: 반지는 빈 쪽 */
function equipSlot(o: Owner, t: Template): number {
  if (t.slot !== "ring") return t.slot ? EQUIP_SLOTS.indexOf(t.slot) : -1;
  const r1 = EQUIP_SLOTS.indexOf("ring1");
  return at(o, "equipped", r1) && !at(o, "equipped", r1 + 1) ? r1 + 1 : r1;
}

/** 지급 (줍기 · 개발용): 같은 묶음을 먼저 채우고 남으면 빈 칸. 다 안 들어가면 아무것도 안 바뀜 */
export function give(o: Owner, tpl: string, qty: number, rarity: Rarity, origin: string): string | null {
  const t = ITEMS[tpl];
  if (!t || !Number.isInteger(qty) || qty < 1) return "없는 아이템입니다";
  const locs: Loc[] = ["hotbar", "inventory"];
  const stacks = stackable(t)
    ? o.items.filter((i) => locs.includes(i.loc) && i.tpl === tpl && i.rarity === rarity && i.qty < STACK).sort((a, b) => locs.indexOf(a.loc) - locs.indexOf(b.loc) || a.slot - b.slot)
    : [];
  const plan: [Item, number][] = [];
  let left = qty;
  for (const i of stacks) {
    if (!left) break;
    const n = Math.min(left, STACK - i.qty);
    plan.push([i, n]);
    left -= n;
  }
  const created: Item[] = [];
  while (left > 0) {
    const pos = freeSlot(o, locs, created);
    if (!pos) return "인벤토리가 가득 찼습니다";
    const n = stackable(t) ? Math.min(left, STACK) : 1;
    created.push(newItem(tpl, n, rarity, pos[0], pos[1]));
    left -= n;
  }
  const before = plan.map(([i]) => clone(i));
  for (const [i, n] of plan) i.qty += n;
  o.items.push(...created);
  return commit(o, "gain", origin, before, [...plan.map(([i]) => i), ...created]);
}

/**
 * 옮기기: 빈 칸 → 이동(n 이 적으면 나누기), 같은 묶음 → 합치기, 다른 아이템 → 맞바꾸기.
 * b 의 칸이 −1 이면 알아서(장비 칸 = 맞는 칸, 그 밖 = 다 들어가는 묶음 → 빈 칸).
 */
export function move(o: Owner, a: unknown, b: unknown, n: unknown, ctx: Ctx): string | null {
  if (!validPos(a) || !validPos(b, true)) return "잘못된 칸입니다";
  if ((a[0] === "storage" || b[0] === "storage") && !ctx.storage) return "창고는 광장에서만 열 수 있습니다";
  const src = at(o, a[0], a[1]);
  if (!src) return "아이템이 없습니다";
  const qty = n === undefined || n === null ? src.qty : Number(n);
  if (!Number.isInteger(qty) || qty < 1 || qty > src.qty) return "수량이 올바르지 않습니다";
  const t = ITEMS[src.tpl];
  let to = b;
  if (to[1] === -1) {
    if (to[0] === "equipped") {
      if (!t.slot) return "장착할 수 없는 아이템입니다";
      to = ["equipped", equipSlot(o, t)];
    } else {
      const loc = to[0];
      const stack = stackable(t) && o.items.find((i) => i.loc === loc && i !== src && same(i, src) && i.qty + qty <= STACK);
      const pos = stack ? ([stack.loc, stack.slot] as ItemPos) : freeSlot(o, [loc]);
      if (!pos) return loc === "storage" ? "창고가 가득 찼습니다" : "자리가 없습니다";
      to = pos;
    }
  }
  const dst = at(o, to[0], to[1]);
  if (dst === src) return null;
  if (to[0] === "equipped") {
    const e = fits(t, to[1], o.char.level);
    if (e) return e;
  }
  const before = [src, ...(dst ? [dst] : [])].map(clone);
  if (!dst) {
    if (qty === src.qty) {
      src.loc = to[0];
      src.slot = to[1];
      return commit(o, "move", "", before, [src]);
    }
    const part: Item = { ...clone(src), id: randomUUID(), loc: to[0], slot: to[1], qty };
    src.qty -= qty;
    o.items.push(part);
    return commit(o, "split", `split:${src.id}`, before, [src, part]);
  }
  if (same(dst, src) && dst.qty < STACK) {
    const m = Math.min(qty, STACK - dst.qty);
    dst.qty += m;
    src.qty -= m;
    return commit(o, "merge", "", before, [src, dst]);
  }
  if (qty !== src.qty) return "다른 아이템이 있는 칸에는 나눠 놓을 수 없습니다";
  if (a[0] === "equipped") {
    const e = fits(ITEMS[dst.tpl], a[1], o.char.level);
    if (e) return e;
  }
  [src.loc, src.slot, dst.loc, dst.slot] = [dst.loc, dst.slot, src.loc, src.slot];
  return commit(o, "swap", "", before, [src, dst]);
}

/** 버리기 = 영구 삭제 (D21) */
export function discard(o: Owner, a: unknown, ctx: Ctx): string | null {
  if (!validPos(a)) return "잘못된 칸입니다";
  if (a[0] === "storage" && !ctx.storage) return "창고는 광장에서만 열 수 있습니다";
  const it = at(o, a[0], a[1]);
  if (!it) return "아이템이 없습니다";
  const before = [clone(it)];
  it.qty = 0;
  return commit(o, "discard", "", before, [it]);
}

const KIND_ORDER: ItemKind[] = ["weapon", "armor", "accessory", "potion", "book", "material"];
/** 정렬: 종류 → 이름 → 높은 희귀도 순, 같은 묶음은 합침 */
export function sort(o: Owner, loc: unknown, ctx: Ctx): string | null {
  if (loc !== "inventory" && loc !== "storage") return "잘못된 칸입니다";
  if (loc === "storage" && !ctx.storage) return "창고는 광장에서만 열 수 있습니다";
  const list = o.items.filter((i) => i.loc === loc);
  const before = list.map(clone);
  list.sort((x, y) =>
    KIND_ORDER.indexOf(ITEMS[x.tpl].kind) - KIND_ORDER.indexOf(ITEMS[y.tpl].kind) || x.tpl.localeCompare(y.tpl) ||
    RARITIES.indexOf(y.rarity) - RARITIES.indexOf(x.rarity) || y.qty - x.qty);
  for (let i = 0; i < list.length; i++)
    for (let j = i + 1; j < list.length && same(list[i], list[j]) && list[i].qty < STACK; j++) {
      const m = Math.min(list[j].qty, STACK - list[i].qty);
      list[i].qty += m;
      list[j].qty -= m;
    }
  let s = 0;
  for (const i of list) if (i.qty > 0) i.slot = s++;
  return commit(o, "sort", "", before, list);
}

/** 사용: 장비 = 장착 · 해제(맞바꿈), 포션 = 회복 (공유 쿨 8초) */
export function use(p: Player, a: unknown): string | null {
  if (!validPos(a)) return "잘못된 칸입니다";
  const ctx = { storage: p.room?.kind === "plaza" };
  const it = at(p, a[0], a[1]);
  if (!it) return "아이템이 없습니다";
  const t = ITEMS[it.tpl];
  if (t.slot) return a[0] === "equipped" ? move(p, a, ["inventory", -1], undefined, ctx) && move(p, a, ["hotbar", -1], undefined, ctx) : move(p, a, ["equipped", -1], undefined, ctx);
  if (t.skill) {
    // 스킬북: 배울 수 있는지 먼저 보고, 한 권 쓴 뒤 배움 (§10-3 · §10-4)
    const grade = bookGrade(it.rarity);
    const e = bookError(p, t.skill, grade);
    if (e) return e;
    const before = [clone(it)];
    it.qty--;
    return commit(p, "read", "", before, [it]) ?? readBook(p, t.skill, grade);
  }
  if (!t.heal) return "사용할 수 없는 아이템입니다";
  if (a[0] === "storage") return "창고에서 꺼낸 뒤 쓰세요";
  if (p.dead) return "쓰러진 상태입니다";
  const now = p.room?.now ?? Date.now();
  if (now < p.potionAt) return "포션 재사용 대기 중입니다";
  if (p.potionLeft !== null && p.potionLeft <= 0) return "이번 스테이지에서는 포션을 더 쓸 수 없습니다 (던전 회복 제한)";
  const before = [clone(it)];
  it.qty--;
  const err = commit(p, "use", "", before, [it]);
  if (err) return err;
  p.potionAt = now + POTION_CD_MS;
  if (p.potionLeft !== null) p.potionLeft--;
  if (t.heal.hp && p.room) applyHeal(p.room, p, p, t.heal.hp, false);
  if (t.heal.mp) p.mp = Math.min(p.st.mana, p.mp + t.heal.mp);
  if (t.heal.en) p.en = Math.min(p.st.energy, p.en + t.heal.en);
  return null;
}

// ── 장비 → 캐릭터 ─────────────────────────────────────────────────

/** 장비가 바뀌면: 스탯 · 발동 효과 · 평타 · 옷 색 */
export function refreshGear(p: Player) {
  const g = gearOf(p.items);
  p.gear = g.mods;
  p.procs = g.procs;
  refreshSlots(p);
  recalc(p);
  const look = lookOf(p.items);
  if (look.join() !== p.look.join()) {
    p.look = look;
    p.room?.ev.push(["eq", p.id, look]);
  }
}

export const sendInv = (p: Player) => p.ws.readyState === 1 && p.ws.send(JSON.stringify({ t: "inv", items: p.items }));

/** 클라이언트 요청 처리. 실패해도 현재 상태를 다시 보내 화면을 맞춤 */
export function itemOp(p: Player, m: { op?: unknown; a?: unknown; b?: unknown; n?: unknown; loc?: unknown }): string | null {
  const ctx = { storage: p.room?.kind === "plaza" };
  const err =
    m.op === "move" ? move(p, m.a, m.b, m.n, ctx) :
    m.op === "use" ? use(p, m.a) :
    m.op === "drop" ? discard(p, m.a, ctx) :
    m.op === "sort" ? sort(p, m.loc, ctx) : "알 수 없는 요청";
  refreshGear(p);
  sendInv(p);
  return err;
}

/** 줍기 */
export function pickUp(p: Player, tpl: string, qty: number, rarity: Rarity, origin: string): string | null {
  const err = give(p, tpl, qty, rarity, origin);
  if (err) return err;
  p.out.push(["get", tpl, qty, rarity]);
  sendInv(p);
  return null;
}

// ── 내구도 · 발동 효과 (§14-4 · §14-5 · §14-6) ─────────────────────

/** 적중 · 피격 몇 번마다 내구도 −1 (D23) */
export const WEAR_EVERY = 5;
const worn = (p: Player, kinds: ItemKind[]) => p.items.filter((i) => i.loc === "equipped" && i.durMax > 0 && i.dur > 0 && kinds.includes(ITEMS[i.tpl].kind));

function wear(p: Player, it: Item, n: number) {
  it.dur = Math.max(0, it.dur - n);
  saveDurability(p.char.id, it.id, it.dur);
  p.out.push(["du", it.id, it.dur]);
  if (it.dur === 0) refreshGear(p); // 0 이면 파괴되지 않고 성능만 꺼짐
}

/** 내가 때림 (방의 damaged): 무기 내구도 · 평타 발동 효과 */
export function onDealt(w: World, p: Player, tgt: Unit, dmg: number, h: HitSpec) {
  if (++p.dealt % WEAR_EVERY === 0) for (const it of worn(p, ["weapon"])) wear(p, it, 1);
  if (!h.basic || tgt.dead) return;
  p.basics++;
  for (const s of p.procs) {
    if (s.id === "burn_touch" && rand() < s.v) addEffect(w, tgt, { id: "burn", ms: 3000, dot: Math.max(1, dmg * 0.15) }, p);
    if (s.id === "fifth_bolt" && p.basics % 5 === 0 && !tgt.dead) hit(w, p, tgt, { base: 0, atkRatio: s.v, apRatio: 0, cat: "magical", el: "electric", threat: 1 });
  }
}

/** 내가 맞음: 방어구 내구도 · 보호막 · 가시 */
export function onTaken(w: World, p: Player, src: Unit, dmg: number, h: HitSpec) {
  if (++p.taken % WEAR_EVERY === 0) for (const it of worn(p, ["armor"])) wear(p, it, 1);
  if (p.dead) return;
  for (const s of p.procs) {
    if (s.id === "low_shield" && p.hp < p.st.hp * 0.3 && w.now >= p.shieldAt) {
      p.shieldAt = w.now + 60_000;
      addEffect(w, p, { id: "shield", ms: 5000, v: Math.round(p.st.hp * s.v) }, p);
    }
    if (s.id === "vine_shield" && rand() < 0.1) addEffect(w, p, { id: "shield", ms: 2000, v: Math.round(p.st.hp * s.v) }, p);
    if (s.id === "thorns" && h.melee && !src.dead) dotDamage(w, p, src, dmg * s.v);
  }
}

export function onKill(w: World, p: Player) {
  for (const s of p.procs) if (s.id === "kill_haste") addEffect(w, p, { id: "haste", ms: 2000, v: s.v }, p);
}

/** 사망: 입은 장비 내구도 −5% (§13-4) */
export function deathWear(p: Player) {
  for (const it of worn(p, ["weapon", "armor"])) wear(p, it, Math.ceil(it.durMax * 0.05));
}
