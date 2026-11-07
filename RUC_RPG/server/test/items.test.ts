// 아이템 (§14 · §15): 인벤토리 조작 검증 · 복사 방지(무작위 조작 뒤에도 개수 보존 · DB = 메모리) · 드롭 → 줍기 → 장착 → 스탯 · 포션 · 내구도
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";

process.env.RPG_DB_FILE = `test-items-${process.pid}.sqlite`;
const { TICK_MS } = await import("../../../web/rpg/shared/constants.ts");
const { EQUIP_SLOTS, ITEMS, LOCS, POTION_CD_MS, STACK, fits } = await import("../../../web/rpg/shared/data/items.ts");
const { loadMap } = await import("../../../web/rpg/shared/map.ts");
const { hit, setRandom } = await import("../src/combat.ts");
const { createCharacter, db, loadItems } = await import("../src/db.ts");
const { discard, give, itemOp, move, sort } = await import("../src/items.ts");
const { Room, buildPlayer } = await import("../src/room.ts");
test.after(() => {
  db.close();
  for (const ext of ["", "-wal", "-shm"]) rmSync(fileURLToPath(new URL(`../data/${process.env.RPG_DB_FILE}${ext}`, import.meta.url)), { force: true });
});
type Item = import("../../../web/rpg/shared/data/items.ts").Item;

const ap = { hair: 0, hairColor: 0, skin: 0, eyes: 0 };
const byId = (a: Item, b: Item) => a.id.localeCompare(b.id);
const plaza = { storage: true };
const field = { storage: false };

function owner(name: string) {
  const c = createCharacter(name, name, "fire", ap)!;
  return { char: { id: c.id, level: 1 }, items: [] as Item[] };
}

/** 칸이 겹치지 않고 범위 안 · 수량 1~64 · 장비 칸 조건 */
function checkShape(items: Item[], level: number) {
  const seen = new Set<string>();
  for (const i of items) {
    const k = `${i.loc}:${i.slot}`;
    assert.ok(!seen.has(k), `칸 겹침 ${k}`);
    seen.add(k);
    assert.ok(i.slot >= 0 && i.slot < LOCS[i.loc], k);
    assert.ok(i.qty >= 1 && i.qty <= STACK, `${i.tpl} ${i.qty}`);
    if (i.loc === "equipped") assert.equal(fits(ITEMS[i.tpl], i.slot, level), null, `${i.tpl} → ${EQUIP_SLOTS[i.slot]}`);
  }
}
const totals = (items: Item[]) => {
  const m = new Map<string, number>();
  for (const i of items) m.set(i.tpl, (m.get(i.tpl) ?? 0) + i.qty);
  return m;
};

test("지급 · 옮기기 · 나누기 · 합치기 · 맞바꾸기 · 장착 조건 · 창고는 광장만", () => {
  const o = owner("인벤1");
  assert.equal(give(o, "slime_jelly", 70, "poor", "test"), null);
  assert.deepEqual(o.items.map((i) => [i.loc, i.slot, i.qty]).sort(), [["hotbar", 0, 64], ["hotbar", 1, 6]], "핫바 먼저 · 64개씩");
  assert.equal(give(o, "slime_jelly", 3, "poor", "test"), null);
  assert.equal(o.items.find((i) => i.slot === 1)!.qty, 9, "같은 묶음에 먼저");
  assert.equal(give(o, "wood_sword", 1, "rare", "test"), null);
  const sword = o.items.find((i) => i.tpl === "wood_sword")!;
  assert.equal(sword.durMax, 150);
  // 나누기 → 합치기
  assert.equal(move(o, ["hotbar", 0], ["inventory", 5], 10, field), null);
  assert.equal(o.items.find((i) => i.loc === "inventory" && i.slot === 5)!.qty, 10);
  assert.equal(move(o, ["inventory", 5], ["hotbar", 1], undefined, field), null);
  assert.equal(o.items.find((i) => i.loc === "hotbar" && i.slot === 1)!.qty, 19);
  // 장착 · 잘못된 칸 · 레벨
  assert.equal(move(o, ["hotbar", 2], ["equipped", -1], undefined, field), null);
  assert.equal(sword.loc, "equipped");
  assert.equal(sword.slot, EQUIP_SLOTS.indexOf("weapon"));
  assert.match(move(o, ["hotbar", 0], ["equipped", 0], undefined, field)!, /장착할 수 없는/);
  give(o, "fang_sword", 1, "common", "test");
  const fang = o.items.find((i) => i.tpl === "fang_sword")!;
  assert.match(move(o, [fang.loc, fang.slot], ["equipped", -1], undefined, field)!, /Lv10/);
  // 맞바꿀 때 장비 칸으로 들어가는 쪽도 검사: 젤리를 무기 칸으로 못 보냄
  assert.ok(move(o, ["equipped", sword.slot], ["hotbar", 0], undefined, field));
  assert.equal(sword.loc, "equipped");
  // 수량 · 칸 검증
  for (const [a, b, n] of [[["hotbar", 0], ["inventory", 1], 0], [["hotbar", 0], ["inventory", 1], 65], [["hotbar", 0], ["inventory", 27], 1], [["nope", 0], ["inventory", 1], 1], [["hotbar", 0], ["__proto__", 1], 1], [["hotbar", 0.5], ["inventory", 1], 1]] as const)
    assert.ok(move(o, a, b, n, field), JSON.stringify([a, b, n]));
  // 창고
  assert.match(move(o, ["hotbar", 0], ["storage", 0], undefined, field)!, /광장/);
  assert.equal(move(o, ["hotbar", 0], ["storage", -1], undefined, plaza), null);
  assert.equal(o.items.find((i) => i.tpl === "slime_jelly" && i.loc === "storage")!.qty, 54);
  // 가득 차면 지급이 통째로 실패
  const full = owner("인벤2");
  assert.equal(give(full, "copper_ring", 32, "common", "test"), null);
  assert.match(give(full, "slime_jelly", 1, "poor", "test")!, /가득/);
  assert.equal(full.items.length, 32);
  assert.deepEqual(loadItems(o.char.id).sort(byId), [...o.items].sort(byId), "DB = 메모리");
});

test("무작위 조작 2000번: 개수 보존 · 칸 겹침 없음 · 장비 칸 조건 · DB = 메모리 (복사 방지)", () => {
  setRandom(Math.random);
  const o = owner("퍼즈");
  give(o, "slime_jelly", 150, "poor", "t");
  give(o, "hp_potion_s", 40, "common", "t");
  give(o, "wolf_pelt", 20, "common", "t");
  for (const t of ["wood_sword", "old_dagger", "leather_cap", "leather_vest", "copper_ring", "copper_ring", "sprout_mail", "rabbit_charm"]) give(o, t, 1, "advanced", "t");
  let expect = totals(o.items);
  const locs = Object.keys(LOCS) as (keyof typeof LOCS)[];
  const pos = (): [keyof typeof LOCS, number] => {
    const l = locs[Math.floor(Math.random() * locs.length)];
    return [l, Math.floor(Math.random() * (LOCS[l] + 1)) - 1];
  };
  let ok = 0;
  for (let i = 0; i < 2000; i++) {
    const r = Math.random();
    const ctx = Math.random() < 0.5 ? plaza : field;
    const src = o.items[Math.floor(Math.random() * o.items.length)];
    const a: [keyof typeof LOCS, number] = Math.random() < 0.9 && src ? [src.loc, src.slot] : pos();
    if (r < 0.85) {
      const n = Math.random() < 0.3 ? Math.floor(Math.random() * 70) : undefined;
      if (!move(o, a, pos(), n, ctx)) ok++;
    } else if (r < 0.95) sort(o, Math.random() < 0.5 ? "inventory" : "storage", ctx);
    else if (src && Math.random() < 0.3 && !discard(o, a, ctx)) expect = totals(o.items);
    checkShape(o.items, 1);
    assert.deepEqual(totals(o.items), expect, `조작 ${i}`);
    if (i % 100 === 0) assert.deepEqual(loadItems(o.char.id).sort(byId), [...o.items].sort(byId), `DB 조작 ${i}`);
  }
  assert.ok(ok > 150, `성공한 이동 ${ok}`);
  assert.deepEqual(loadItems(o.char.id).sort(byId), [...o.items].sort(byId));
  const logged = db.prepare("SELECT COUNT(*) AS n FROM rpg_audit_log WHERE actor = ?").get(o.char.id) as { n: number };
  assert.ok(logged.n > ok, "모든 변경이 감사 로그에");
});

test("필드: 슬라임 처치 → 기여자에게만 드롭 → 자동 줍기 → 장착 → 스탯 · 평타 · 포션 쿨 · 내구도", () => {
  const map = loadMap(JSON.parse(readFileSync(new URL("../../../web/rpg/shared/data/maps/field.json", import.meta.url), "utf8")));
  let now = 2_000_000;
  const room = new Room("field", 1, map, now);
  const mk = (name: string, x: number, y: number) => {
    const char = createCharacter(name, name, "fire", ap)!;
    const sent: string[] = [];
    const p = buildPlayer({ readyState: 1, send: (s: string) => sent.push(s) } as never, name, char, x, y);
    room.add(p);
    return { p, sent };
  };
  const slime = [...room.mobs.values()].find((m) => m.key === "slime")!;
  const { p, sent } = mk("사냥꾼2", slime.x - 40, slime.y);
  const other = mk("구경꾼", slime.x - 40, slime.y + 30);
  const tick = (n = 1) => { for (let i = 0; i < n; i++) { now += TICK_MS; room.tick(now); } };
  // 난수 0: 모든 드롭 통과 · 장비는 전설
  setRandom(() => 0);
  slime.hp = 1;
  hit(room, p, slime, { base: 50, atkRatio: 0, apRatio: 0, cat: "physical", el: null, threat: 1 });
  assert.ok(slime.dead);
  setRandom(() => 0.99);
  const drops = [...room.drops.values()];
  assert.equal(drops.length, 3 + 6 * 2, "재료 · 포션 3묶음 + 장비 6종 × 2 (난수 0 이라 운 보너스 +1 이 늘 붙음)");
  p.mover.x = p.x = drops[0].x; // 떨어지는 자리에 서 있어도
  p.mover.y = p.y = drops[0].y;
  tick();
  const mine = sent.filter((s) => s.includes('["dr",')).join();
  assert.equal(room.drops.size, drops.length, "떨어진 직후에는 아직 못 주움 (0.4초) — 생김 · 주움이 같은 스냅샷에 안 실림");
  tick(8);
  assert.ok(mine.includes("old_dagger"), "기여자는 드롭을 봄");
  assert.ok(!other.sent.join().includes('"dr"'), "기여하지 않은 사람에게는 30초 동안 안 보임");
  // 드롭 위에 서면 자동 줍기 (구경꾼은 같은 자리여도 못 주움)
  for (const d of drops) {
    p.mover.x = p.x = other.p.mover.x = other.p.x = d.x;
    p.mover.y = p.y = other.p.mover.y = other.p.y = d.y;
    tick();
  }
  assert.equal(room.drops.size, 0);
  assert.equal(other.p.items.length, 0);
  assert.ok(sent.some((s) => s.includes('"get"')) && sent.some((s) => s.includes('"t":"inv"')));
  const dagger = p.items.find((i) => i.tpl === "old_dagger")!;
  assert.equal(dagger.rarity, "legendary");
  assert.equal(dagger.sp.length, 2, "전설은 특수효과 2개 (얻을 때 롤)");
  assert.equal(p.items.find((i) => i.tpl === "slime_jelly")!.qty, 2);
  // 장착 → 평타 · 스탯
  const atk0 = p.st.atk;
  assert.equal(itemOp(p, { op: "use", a: [dagger.loc, dagger.slot] }), null);
  assert.equal(p.slots.A, "slash");
  assert.ok(p.st.atk > atk0 + 9, `공격력 ${atk0} → ${p.st.atk}`);
  assert.match(itemOp(p, { op: "move", a: ["hotbar", 0], b: ["storage", 0] })!, /광장/);
  // 포션: 회복 · 공유 쿨 8초
  const pot = p.items.find((i) => i.tpl === "hp_potion_s")!;
  p.hp = 50;
  assert.equal(itemOp(p, { op: "use", a: [pot.loc, pot.slot] }), null);
  assert.ok(p.hp > 50);
  assert.match(itemOp(p, { op: "use", a: [pot.loc, pot.slot] }) ?? "", /대기/);
  tick(POTION_CD_MS / TICK_MS + 1);
  assert.equal(itemOp(p, { op: "use", a: [pot.loc, pot.slot] }), null);
  // 내구도: 적중 5번마다 −1, 0 이면 성능만 꺼짐 (맨손 평타)
  const target = [...room.mobs.values()].find((m) => !m.dead)!;
  const dur0 = dagger.dur;
  for (let i = 0; i < 5; i++) hit(room, p, target, { base: 1, atkRatio: 0, apRatio: 0, cat: "physical", el: null, threat: 1 });
  assert.equal(dagger.dur, dur0 - 1);
  dagger.dur = 1;
  p.dealt = 4;
  hit(room, p, target, { base: 1, atkRatio: 0, apRatio: 0, cat: "physical", el: null, threat: 1 });
  assert.equal(dagger.dur, 0);
  assert.equal(p.slots.A, "punch");
  assert.ok(p.st.atk < atk0 + 1);
  assert.equal(loadItems(p.char.id).find((i) => i.id === dagger.id)!.dur, 0, "내구도 저장");
  // 사망: 입은 장비 내구도 −5% (§13-4)
  give(p, "leather_vest", 1, "common", "test");
  const vest = p.items.find((i) => i.tpl === "leather_vest")!;
  itemOp(p, { op: "use", a: [vest.loc, vest.slot] });
  p.hp = 1;
  hit(room, target, p, { base: 50, atkRatio: 0, apRatio: 0, cat: "physical", el: null, threat: 1 });
  assert.ok(p.dead);
  assert.equal(vest.dur, vest.durMax - Math.ceil(vest.durMax * 0.05));
  setRandom(Math.random);
});
