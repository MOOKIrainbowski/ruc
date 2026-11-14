// 음식 소모품: 스태미나 회복 · 수량 · 최대치
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";

process.env.RPG_DB_FILE = `test-food-${process.pid}.sqlite`;
const { loadMap } = await import("../../../web/rpg/shared/map.ts");
const { createCharacter, db } = await import("../src/db.ts");
const { give, itemOp, use } = await import("../src/items.ts");
const E = await import("../src/economy.ts");
const { Room, buildPlayer } = await import("../src/room.ts");
test.after(() => {
  db.close();
  for (const ext of ["", "-wal", "-shm"]) rmSync(fileURLToPath(new URL(`../data/${process.env.RPG_DB_FILE}${ext}`, import.meta.url)), { force: true });
});
type Player = import("../src/room.ts").Player;
const map = loadMap(JSON.parse(readFileSync(new URL("../../../web/rpg/shared/data/maps/plaza.json", import.meta.url), "utf8")));
const room = new Room("plaza", 1, map, 1_000_000);
const players: Player[] = [];
E.online.byChar = (id) => players.find((p) => p.char.id === id);
E.online.all = () => players;
let seq = 0;
function player() {
  const char = createCharacter(`food-${++seq}`, `음식${seq}`, "fire", { hair: 0, hairColor: 0, skin: 0, eyes: 0 })!;
  const p = buildPlayer({ readyState: 1, send: () => {} } as never, char.discord_id, char, map.spawn.x, map.spawn.y);
  room.add(p);
  players.push(p);
  E.welcome(p);
  return p;
}
const slot = (p: Player, tpl: string) => {
  const it = p.items.find((i) => i.tpl === tpl && i.loc !== "equipped")!;
  return [it.loc, it.slot] as [string, number];
};

test("음식은 스태미나만 회복하고 개수를 줄이며 최대치를 넘지 않는다", () => {
  const p = player();
  give(p, "meadow_bread", 12, "common", "test");
  const bread = p.items.find((i) => i.tpl === "meadow_bread")!;
  assert.equal(bread.qty, 12, "음식은 한 묶음으로 지급됨");
  let inventorySlot = 0;
  while (p.items.some((i) => i.loc === "inventory" && i.slot === inventorySlot)) inventorySlot++;
  assert.equal(itemOp(p, { op: "move", a: [bread.loc, bread.slot], b: ["inventory", inventorySlot], n: 2 }), null, "묶음 일부를 옮길 수 있음");
  assert.equal(bread.qty, 10);
  const split = p.items.find((i) => i.tpl === "meadow_bread" && i.loc === "inventory" && i.slot === inventorySlot)!;
  assert.equal(split.qty, 2);
  assert.equal(itemOp(p, { op: "move", a: [split.loc, split.slot], b: [bread.loc, bread.slot] }), null, "같은 칸에 합칠 수 있음");
  assert.equal(bread.qty, 12);
  p.mover.stamina = 10;
  assert.equal(use(p, slot(p, "meadow_bread")), null);
  assert.equal(p.mover.stamina, 22);
  assert.equal(p.items.find((i) => i.tpl === "meadow_bread")?.qty, 11);
  p.mover.stamina = p.mover.staminaMax - 5;
  assert.equal(use(p, slot(p, "meadow_bread")), null);
  assert.equal(p.mover.stamina, p.mover.staminaMax);
  const qty = p.items.find((i) => i.tpl === "meadow_bread")?.qty;
  assert.match(use(p, slot(p, "meadow_bread")) ?? "", /스태미나가 가득/);
  assert.equal(p.items.find((i) => i.tpl === "meadow_bread")?.qty, qty);
});

