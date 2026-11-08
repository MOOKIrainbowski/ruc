// P12 미뤄 둔 것: 영약(쓰러져도 남음 · 경험치) · 부활 깃털 · 귀환 주문서 · 랜덤 상자 · 창고 확장 · 상점 잡화 · 선물
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";

process.env.RPG_DB_FILE = `test-consumables-${process.pid}.sqlite`;
const { loadMap } = await import("../../../web/rpg/shared/map.ts");
const { capOf, STORAGE } = await import("../../../web/rpg/shared/data/items.ts");
const { SHOP_GOODS } = await import("../../../web/rpg/shared/data/economy.ts");
const { createCharacter, db, listNotis, ruc } = await import("../src/db.ts");
const E = await import("../src/economy.ts");
const S = await import("../src/social.ts");
const { give, move, recallTick, use } = await import("../src/items.ts");
const { find, has, hit } = await import("../src/combat.ts");
const { Room, buildPlayer, gainExp } = await import("../src/room.ts");
test.after(() => {
  db.close();
  for (const ext of ["", "-wal", "-shm"]) rmSync(fileURLToPath(new URL(`../data/${process.env.RPG_DB_FILE}${ext}`, import.meta.url)), { force: true });
});
type Player = import("../src/room.ts").Player;

const map = (n: string) => loadMap(JSON.parse(readFileSync(new URL(`../../../web/rpg/shared/data/maps/${n}.json`, import.meta.url), "utf8")));
const plazaMap = map("plaza");
const fieldMap = map("field");
let now = 2_000_000;
const plaza = new Room("plaza", 1, plazaMap, now);
const field = new Room("field", 1, fieldMap, now);
const players: Player[] = [];
E.online.byChar = (id) => players.find((p) => p.char.id === id);
E.online.all = () => players;
const ap = { hair: 0, hairColor: 0, skin: 0, eyes: 0 };
let n = 0;
function mk(room = plaza) {
  const c = createCharacter(`cs${++n}`, `소모${n}`, "fire", ap)!;
  const p = buildPlayer({ readyState: 1, send: () => {} } as never, c.discord_id, c, room === plaza ? plazaMap.spawn.x : fieldMap.spawn.x, room === plaza ? plazaMap.spawn.y : fieldMap.spawn.y);
  room.add(p);
  players.push(p);
  E.welcome(p);
  return p;
}
const slotOf = (p: Player, tpl: string) => { const it = p.items.find((i) => i.tpl === tpl && i.loc !== "equipped")!; return [it.loc, it.slot] as [string, number]; };
const count = (p: Player, tpl: string) => p.items.filter((i) => i.tpl === tpl).reduce((a, i) => a + i.qty, 0);

test("영약: 30분 효과 · 쓰러져도 남음 · 행운의 영약 경험치 +10% / 부활 깃털: 쓰러지면 HP 30%로 한 번", () => {
  const p = mk(field);
  give(p, "elixir_power", 1, "rare", "test");
  give(p, "elixir_luck", 1, "rare", "test");
  const atk0 = p.st.atk;
  assert.equal(use(p, slotOf(p, "elixir_power")), null);
  assert.ok(p.st.atk > atk0 && find(p, "elixir_power")!.until - field.now === 1_800_000);
  assert.equal(count(p, "elixir_power"), 0, "한 병 씀");
  assert.equal(use(p, slotOf(p, "elixir_luck")), null);
  p.char.level = 30; // 레벨업으로 경험치가 넘어가지 않게
  const exp0 = p.char.exp;
  gainExp(field, p, 100);
  assert.equal(p.char.exp - exp0, 110);
  // 부활 깃털 → 치명타를 맞아도 HP 30%
  give(p, "revive_feather", 1, "advanced", "test");
  assert.equal(use(p, slotOf(p, "revive_feather")), null);
  const m = [...field.mobs.values()][0];
  hit(field, m, p, { base: 1e7, atkRatio: 0, apRatio: 0, cat: "physical", el: null, threat: 0 });
  assert.equal(p.dead, false);
  assert.equal(p.hp, Math.round(p.st.hp * 0.3));
  assert.ok(!has(p, "feather") && has(p, "invuln"));
  // 깃털이 없으면 쓰러지지만 영약은 남음
  field.now += 2000;
  p.fx = p.fx.filter((e) => e.id !== "invuln");
  hit(field, m, p, { base: 1e7, atkRatio: 0, apRatio: 0, cat: "physical", el: null, threat: 0 });
  assert.equal(p.dead, true);
  assert.ok(has(p, "elixir_power") && has(p, "elixir_luck"), "쓰러져도 영약은 남음");
});

test("귀환 주문서: 3초 뒤 (주문서 1장 씀) · 움직이면 취소 · 광장 · 던전에서는 못 씀", () => {
  const p = mk(field);
  give(p, "return_scroll", 2, "common", "test");
  assert.equal(use(p, slotOf(p, "return_scroll")), null);
  assert.equal(recallTick(p, field.now + 1000), false);
  assert.equal(recallTick(p, field.now + 3000), true);
  assert.equal(count(p, "return_scroll"), 1);
  // 움직이면 취소 (주문서는 그대로)
  assert.equal(use(p, slotOf(p, "return_scroll")), null);
  p.mover.moving = true;
  assert.equal(recallTick(p, field.now + 3000), false);
  p.mover.moving = false;
  assert.equal(recallTick(p, field.now + 4000), false, "취소된 귀환");
  assert.equal(count(p, "return_scroll"), 1);
  const q = mk(plaza);
  give(q, "return_scroll", 1, "common", "test");
  assert.match(use(q, slotOf(q, "return_scroll"))!, /이미 광장/);
});

test("랜덤 상자 · 창고 확장권 (두 장까지 · 잠긴 칸) · 상점 잡화(늘 팖 · 저장은 회차 진열만)", () => {
  const p = mk(plaza);
  give(p, "random_box", 3, "rare", "test");
  const before = p.items.length;
  assert.equal(use(p, slotOf(p, "random_box")), null);
  assert.equal(count(p, "random_box"), 2);
  assert.ok(p.items.length >= before, "무언가 나옴");
  // 창고: 기본 54칸 → 잠긴 칸으로 못 옮김 → 확장권 → 81칸
  give(p, "slime_jelly", 1, "poor", "test");
  assert.match(move(p, slotOf(p, "slime_jelly"), ["storage", 60], undefined, { storage: true })!, /잠긴 창고/);
  give(p, "storage_ticket", 3, "mythic", "test");
  assert.equal(use(p, slotOf(p, "storage_ticket")), null);
  assert.equal(p.tabs, 1);
  assert.equal(capOf("storage", p.tabs), STORAGE.base + STORAGE.tab);
  assert.equal(move(p, slotOf(p, "slime_jelly"), ["storage", 60], undefined, { storage: true }), null);
  assert.equal(use(p, slotOf(p, "storage_ticket")), null);
  assert.match(use(p, slotOf(p, "storage_ticket"))!, /더 넓힐 수 없/);
  assert.equal(count(p, "storage_ticket"), 1, "못 쓰면 남음");
  // 상점: 회차 진열 + 잡화, 잡화를 사도 다음에 겹치지 않음
  ruc(p.char.id, 5000, "test", null, `test-ruc:${p.char.id}`);
  p.ruc += 5000;
  const v = E.shopView(p);
  assert.equal(v.slots.length, v.rolled + SHOP_GOODS.length);
  const i = v.slots.findIndex((s) => s.tpl === "return_scroll");
  assert.ok(i >= v.rolled);
  assert.equal(E.shopBuy(p, v.cycle, i, 2, "rid-1"), null);
  const v2 = E.shopView(p);
  assert.equal(v2.slots.length, v.slots.length, "잡화가 두 번 붙지 않음");
  assert.equal(v2.slots[i].left, 97);
});

test("선물: 친구에게만 · 일부 수량 · 받는 사람 우편 + 알림", () => {
  const a = mk(plaza);
  const b = mk(plaza);
  const c = mk(plaza);
  give(a, "hp_potion_s", 10, "common", "test");
  assert.match(S.giftOp(a, { cid: b.char.id, a: slotOf(a, "hp_potion_s"), n: 3 })!, /친구에게만/);
  S.friendOp(a, { op: "request", name: b.char.nickname });
  S.friendOp(b, { op: "accept", cid: a.char.id });
  assert.equal(S.giftOp(a, { cid: b.char.id, a: slotOf(a, "hp_potion_s"), n: 3 }), null);
  assert.equal(count(a, "hp_potion_s"), 7);
  const mail = E.mailView(b).find((m) => m.reason === "gift")!;
  assert.equal(mail.items[0].tpl, "hp_potion_s");
  assert.equal(mail.items[0].qty, 3);
  assert.ok(listNotis(b.char.id).some((x) => x.kind === "gift"));
  assert.match(S.giftOp(a, { cid: c.char.id, a: slotOf(a, "hp_potion_s") })!, /친구에게만/);
  assert.match(S.giftOp(a, { cid: b.char.id, a: slotOf(a, "hp_potion_s"), n: 99 })!, /수량/);
});
