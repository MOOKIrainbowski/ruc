// P13 미뤄 둔 것 2: 채집(필드 지점 · 거리 · 다시 생김 · 이벤트) · 유저 퀘스트 collect · 연금술 제조 · 소환수 피격/어그로(골렘이 몹을 끌고, 쓰러지면 사라짐)
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";

process.env.RPG_DB_FILE = `test-gather-${process.pid}.sqlite`;
const { loadMap } = await import("../../../web/rpg/shared/map.ts");
const { GATHER } = await import("../../../web/rpg/shared/data/items.ts");
const { TICK_MS } = await import("../../../web/rpg/shared/constants.ts");
const { createCharacter, db, ruc } = await import("../src/db.ts");
const E = await import("../src/economy.ts");
const Q = await import("../src/quests.ts");
const { give } = await import("../src/items.ts");
const { hit, recalc } = await import("../src/combat.ts");
const { summon } = await import("../src/pets.ts");
const { Room, buildPlayer } = await import("../src/room.ts");
test.after(() => {
  db.close();
  for (const ext of ["", "-wal", "-shm"]) rmSync(fileURLToPath(new URL(`../data/${process.env.RPG_DB_FILE}${ext}`, import.meta.url)), { force: true });
});
type Player = import("../src/room.ts").Player;

const fieldMap = loadMap(JSON.parse(readFileSync(new URL("../../../web/rpg/shared/data/maps/field.json", import.meta.url), "utf8")));
let now = 3_000_000;
const field = new Room("field", 1, fieldMap, now);
const players: Player[] = [];
E.online.byChar = (id) => players.find((p) => p.char.id === id);
E.online.all = () => players;
const ap = { hair: 0, hairColor: 0, skin: 0, eyes: 0 };
let n = 0;
function mk(lv = 30) {
  const c = createCharacter(`ga${++n}`, `채집${n}`, "fire", ap)!;
  c.level = lv;
  const p = buildPlayer({ readyState: 1, send: () => {} } as never, c.discord_id, c, fieldMap.spawn.x, fieldMap.spawn.y);
  field.add(p);
  players.push(p);
  E.welcome(p);
  Q.loadQuestState(p);
  return p;
}
const count = (p: Player, tpl: string) => p.items.filter((i) => i.tpl === tpl).reduce((a, i) => a + i.qty, 0);
const tick = (k = 1) => { for (let i = 0; i < k; i++) { now += TICK_MS; field.tick(now); } };

test("채집: 필드에 지점이 있음 · 멀면 거부 · 캐면 재료 + 이벤트 · 다시 생김 · 유저 퀘스트 collect 진행", () => {
  assert.ok(field.nodes.length >= 3, `지점 ${field.nodes.length}곳`);
  assert.equal(new Room("plaza", 9, loadMap(JSON.parse(readFileSync(new URL("../../../web/rpg/shared/data/maps/plaza.json", import.meta.url), "utf8"))), now).nodes.length, 0, "광장에는 없음");
  const p = mk();
  const node = field.nodes[0];
  const item = GATHER[node.kind].item;
  assert.match(field.gather(p, node.id)!, /가까이/);
  p.x = p.mover.x = node.x;
  p.y = p.mover.y = node.y;
  // 유저 퀘스트: 다른 사람이 낸 "채집 2개" 를 받아 둠
  const owner = mk();
  ruc(owner.char.id, 5000, "test", null, `t:${owner.char.id}`);
  owner.ruc += 5000;
  field.remove(owner);
  const plaza = new Room("plaza", 2, loadMap(JSON.parse(readFileSync(new URL("../../../web/rpg/shared/data/maps/plaza.json", import.meta.url), "utf8"))), now);
  plaza.add(owner);
  assert.equal(Q.questOp(owner, { op: "create", title: "약초 모아 줘", kind: "collect", target: item, n: 2, ruc: 100, slots: 1, days: 1 }), null);
  const uq = Q.boardView(p).board.find((r: { title: string }) => r.title === "약초 모아 줘")!;
  field.remove(p);
  plaza.add(p);
  assert.equal(Q.questOp(p, { op: "accept", id: uq.id }), null);
  plaza.remove(p);
  field.add(p);
  assert.equal(field.gather(p, node.id), null);
  assert.equal(count(p, item), 1);
  assert.ok(field.ev.some((e) => e[0] === "gn" && e[1] === node.id && e[2] === 0));
  assert.match(field.gather(p, node.id)!, /캐 갔어요/);
  assert.equal(p.takes.get(uq.id), 1, "collect 1/2");
  // 다시 생김
  tick(Math.ceil(GATHER[node.kind].respawnMs / TICK_MS) + 1);
  field.ev = [];
  assert.equal(field.gather(p, node.id), null);
  assert.equal(count(p, item), 2);
  assert.equal(p.takes.has(uq.id) ? p.takes.get(uq.id) : 2, 2, "collect 완료");
});

test("연금술 제조: 재료가 모자라면 거부 · 약초 3 → 체력 포션(소) 2 · 광석 5 → 강화석", () => {
  const p = mk();
  // 미르 근처 판정은 econOp 가 함 — 여기서는 brew 를 바로
  assert.match(E.brew(p, 0)!, /모자랍니다/);
  give(p, "herb", 3, "common", "test");
  give(p, "ore", 5, "common", "test");
  assert.equal(E.brew(p, 0), null);
  assert.equal(count(p, "herb"), 0);
  assert.equal(count(p, "hp_potion_s"), 2);
  assert.equal(E.brew(p, 3), null);
  assert.equal(count(p, "enhance_stone"), 1);
  assert.match(E.brew(p, 99)!, /잘못된/);
});

test("소환수 피격 · 어그로: 골렘이 몹의 위협을 가져가고 몹에게 맞음 · 쓰러지면 사라짐", () => {
  const p = mk();
  p.job = "summoner";
  const m = [...field.mobs.values()].find((x) => !x.dead)!;
  m.base = { ...m.base, hp: 1e6 }; // 맞아도 안 죽는 몹
  recalc(m);
  m.hp = 1e6;
  p.x = p.mover.x = m.x - 30;
  p.y = p.mover.y = m.y;
  m.threat.set(p.id, 10);
  summon(field, p, { pet: "pet_golem", ms: 20_000 });
  const g = field.pets[0];
  assert.ok(g.hp > 0 && g.hp === g.st.hp && g.st.hp < p.st.hp, "HP = 주인의 60%");
  g.x = m.x - 10;
  g.y = m.y;
  hit(field, p, m, { base: 50, atkRatio: 0, apRatio: 0.6, cat: "magical", el: "earth", threat: 0.3, pet: g.id, taunt: 3 });
  assert.ok((m.threat.get(g.id) ?? 0) > (m.threat.get(p.id) ?? 0), "골렘 위협 > 주인 위협");
  assert.equal(field.combatant(g.id), g);
  // 몹에게 맞아 쓰러지면 사라짐
  hit(field, m, g, { base: 1e7, atkRatio: 0, apRatio: 0, cat: "physical", el: null, threat: 0 });
  assert.equal(g.dead, true);
  assert.equal(field.pets.includes(g), false);
  assert.equal(field.combatant(g.id), undefined);
});
