// P15 정식 성장: 최대 레벨 100 · 황혼 고원(맵 · 몹 · 드롭 · 포털) · 장비 단계 · 3차 각성(조건 · 스탯 · 궁극기 강화)
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";

process.env.RPG_DB_FILE = `test-highland-${process.pid}.sqlite`;
const { loadMap, prop } = await import("../../../web/rpg/shared/map.ts");
const { COMBAT } = await import("../../../web/rpg/shared/data/stats.ts");
const { ITEMS, tierGear } = await import("../../../web/rpg/shared/data/items.ts");
const { MOBS } = await import("../../../web/rpg/shared/data/mobs.ts");
const { AWAKEN, jobStats } = await import("../../../web/rpg/shared/data/jobs.ts");
const { SKILLS } = await import("../../../web/rpg/shared/data/skills.ts");
const { SIM_MS, TICK_MS } = await import("../../../web/rpg/shared/constants.ts");
const { createCharacter, db, findCharacterById } = await import("../src/db.ts");
const { changeJob, refreshSlots } = await import("../src/progress.ts");
const { Room, buildPlayer, gainExp } = await import("../src/room.ts");
test.after(() => {
  db.close();
  for (const ext of ["", "-wal", "-shm"]) rmSync(fileURLToPath(new URL(`../data/${process.env.RPG_DB_FILE}${ext}`, import.meta.url)), { force: true });
});
const map = (n: string) => loadMap(JSON.parse(readFileSync(new URL(`../../../web/rpg/shared/data/maps/${n}.json`, import.meta.url), "utf8")));

test("최대 레벨 100 · 장비 4단계 48종 · 새 몹 드롭이 모두 있는 아이템", () => {
  assert.equal(COMBAT.maxLevel, 100);
  for (const k of ["dusk", "frost", "ember", "storm"]) assert.equal(tierGear(k).length, 12, k);
  assert.equal(ITEMS.storm_sword.lv, 95);
  assert.ok((ITEMS.storm_sword.stats!.atk ?? 0) > (ITEMS.dusk_sword.stats!.atk ?? 0));
  for (const id of ["dusk_imp", "stone_boar", "frost_harpy", "ember_golem", "shade_knight", "storm_drake"]) {
    assert.ok(MOBS[id], id);
    for (const d of MOBS[id].drops) assert.ok(ITEMS[d.item], `${id} → ${d.item}`);
  }
});

test("황혼 고원: 포털로 초원과 이어짐 · 사냥터 Lv30~100 · 방에 몹과 채집 지점", () => {
  const hl = map("highland");
  const field = map("field");
  const back = hl.objects.find((o) => o.type === "portal");
  assert.equal(back && prop(back, "target"), "field");
  assert.ok(field.objects.some((o) => o.type === "portal" && prop(o, "target") === "highland"), "초원 → 고원 포털");
  const lvs = hl.objects.filter((o) => o.type === "spawn_zone").map((o) => String(prop(o, "lv")).split("-").map(Number));
  assert.equal(Math.min(...lvs.map((l) => l[0])), 30);
  assert.equal(Math.max(...lvs.map((l) => l[1])), 100);
  const room = new Room("highland", 1, hl, 5_000_000);
  assert.ok(room.mobs.size >= 40, `몹 ${room.mobs.size}`);
  assert.ok(room.nodes.length >= 6);
  assert.ok([...room.mobs.values()].some((m) => m.key === "storm_drake" && m.lv >= 86));
});

test("3차 각성: 2차 전직 · Lv60 조건, 스탯 +10%, 전용 궁극기 쿨 −25%", () => {
  const c = createCharacter("aw1", "각성자", "fire", { hair: 0, hairColor: 0, skin: 0, eyes: 0 })!;
  c.level = 59;
  const room = new Room("field", 7, map("field"), 6_000_000);
  const p = buildPlayer({ readyState: 1, send: () => {} } as never, c.discord_id, c, 400, 400);
  room.add(p);
  assert.match(changeJob(p, { awaken: true })!, /2차 전직/);
  p.char.level = 59;
  assert.equal(changeJob(p, { line: "warrior" }), null);
  assert.equal(changeJob(p, { job: "gladiator" }), null);
  assert.match(changeJob(p, { awaken: true })!, /Lv60/);
  gainExp(room, p, 10_000_000);
  assert.equal(p.char.level, 100, "레벨이 40에서 멈추지 않고 100까지");
  const atk0 = p.base.atk;
  assert.equal(changeJob(p, { awaken: true }), null);
  assert.ok(p.prog.awake);
  assert.ok(Math.abs(p.base.atk / atk0 - (1 + AWAKEN.stat)) < 0.001, `공격력 ×1.1 (${atk0} → ${p.base.atk})`);
  assert.ok(Math.abs(jobStats(60, "warrior", [10, 10], "gladiator", true).hp / jobStats(60, "warrior", [10, 10], "gladiator").hp - 1.1) < 1e-9);
  assert.equal(findCharacterById(c.id)!.awakened, 1, "저장");
  assert.match(changeJob(p, { awaken: true })!, /이미/);
  // 전용 궁극기(챔피언의 결투) 쿨 −25%
  const ult = Object.values(SKILLS).find((s) => s.slot === "R" && s.job.includes("gladiator"))!;
  const m = [...room.mobs.values()][0];
  p.x = p.mover.x = m.x - 20; p.y = p.mover.y = m.y;
  const l = p.prog.skills.find((x) => x.id === ult.id)!;
  for (const o of p.prog.skills) if (o.slot === "R") o.slot = null;
  l.slot = "R";
  refreshSlots(p);
  p.en = p.st.energy; p.mp = p.st.mana;
  p.inputs.push({ seq: 1, mx: 0, my: 0, run: false, k: "R", ax: m.x, ay: m.y });
  room.tick(6_000_000 + TICK_MS);
  const cd = p.cd[ult.id] - p.steps * SIM_MS; // 쿨 시계 = 입력 시계 (D12)
  assert.ok(cd > 0 && cd <= ult.cooldownMs * AWAKEN.ultCd + 50, `쿨 ${cd} ≤ ${ult.cooldownMs * AWAKEN.ultCd}`);
});
