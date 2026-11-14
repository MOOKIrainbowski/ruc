// GM 관리 도구: 권한 경계 · 원장 지급 · 상태 토글 · 순간이동 명령
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";

process.env.RPG_DB_FILE = `test-gm-${process.pid}.sqlite`;
const { loadMap } = await import("../../../web/rpg/shared/map.ts");
const { createCharacter, db } = await import("../src/db.ts");
const E = await import("../src/economy.ts");
const { makeUnit, hit } = await import("../src/combat.ts");
const { gmCommand, gmHooks, setGmDev } = await import("../src/gm.ts");
const { Room, buildPlayer, newId } = await import("../src/room.ts");
test.after(() => {
  setGmDev(false);
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
function player(name: string) {
  const char = createCharacter(`gm-${++seq}`, name, "fire", { hair: 0, hairColor: 0, skin: 0, eyes: 0 })!;
  const p = buildPlayer({ readyState: 1, send: () => {} } as never, char.discord_id, char, map.spawn.x, map.spawn.y);
  room.add(p); players.push(p); E.welcome(p);
  return p;
}

test("GM 권한 검사 · 인벤토리 지급 · 무적/자원 토글 · 대상 맵 이동", () => {
  const gm = player("GM 운영자");
  const target = player("테스트 대상");
  assert.match(gmCommand(target, '/gm give "테스트 대상" meadow_bread 2 common')!, /GM/);
  setGmDev(true);
  gm.discordId = "dev-codex1";
  assert.equal(gmCommand(gm, '/gm give "테스트 대상" meadow_bread 2 common'), null);
  assert.equal(target.items.filter((i) => i.tpl === "meadow_bread").reduce((n, i) => n + i.qty, 0), 2);
  assert.equal(gmCommand(gm, '/gm toggle "테스트 대상" invuln on'), null);
  const attacker = makeUnit({ id: newId(), kind: "m", name: "시험 몹", el: "none", lv: 1, x: target.x, y: target.y, r: 7, base: target.base });
  const hp = target.hp;
  assert.equal(hit(room, attacker, target, { base: 100, atkRatio: 0, apRatio: 0, cat: "physical", el: null, threat: 0 }), 0);
  assert.equal(target.hp, hp);
  assert.equal(gmCommand(gm, '/gm toggle "테스트 대상" invuln off'), null);
  assert.equal(gmCommand(gm, '/gm toggle "테스트 대상" resources on'), null);
  target.hp = target.st.hp; target.mp = 0; target.en = 0; target.mover.stamina = 0;
  assert.ok(hit(room, attacker, target, { base: 100, atkRatio: 0, apRatio: 0, cat: "physical", el: null, threat: 0 }) > 0);
  assert.ok(target.hp < target.st.hp, "자원 무소모는 피해 면역이 아님");
  room.tick(room.now + 50);
  assert.equal(target.hp, target.st.hp);
  assert.equal(target.mp, target.st.mana);
  assert.equal(target.en, target.st.energy);
  assert.equal(target.mover.stamina, target.mover.staminaMax);
  assert.equal(gmCommand(gm, '/gm speed "테스트 대상" 3'), null);
  assert.equal(target.gm?.speed, 2, "클라 이동 상한에 맞춰 배율을 ×2로 제한");
  assert.equal(target.mover.spd, target.st.moveSpeed * 2);
  const oldTravel = gmHooks.travel;
  let moved: unknown[] = [];
  gmHooks.travel = (...args) => { moved = args; };
  assert.equal(gmCommand(gm, '/gm warp "테스트 대상" highland 400 800'), null);
  assert.equal(moved[0], target);
  assert.equal(moved[1], "highland");
  gmHooks.travel = oldTravel;
});

