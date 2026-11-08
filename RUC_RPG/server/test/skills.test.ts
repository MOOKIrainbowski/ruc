// 성장 (§9 · §10): 전직 · 스킬 습득 · 숙련도 · 레벨 상한 · 스킬북 + 직업 스킬 엔진 · 패시브 · 원소 반응 — 소켓 없이 Room 을 직접 돌림
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";

process.env.RPG_DB_FILE = `test-skills-${process.pid}.sqlite`;
const { TICK_MS } = await import("../../../web/rpg/shared/constants.ts");
const { JOBS, LINES, STAT_GRADE } = await import("../../../web/rpg/shared/data/jobs.ts");
const { SKILLS } = await import("../../../web/rpg/shared/data/skills.ts");
const { loadMap } = await import("../../../web/rpg/shared/map.ts");
const { needMastery } = await import("../../../web/rpg/shared/progress.ts");
const { addEffect, find, has, hit, recalc, setRandom } = await import("../src/combat.ts");
const { H_CRIT } = await import("../../../web/rpg/shared/protocol.ts");
// 몹을 맵에 놓는 위치는 항상 진짜 난수로 (고정 난수 0.99 에서는 한 구역의 몹이 전부 같은 점에 겹쳐 나와, 거기에 장식 오브젝트가 있으면 못 나옴)
let fixed: () => number = Math.random;
const setFixed = (f: () => number) => { fixed = f; setRandom(f); };
const { createCharacter, db, loadSkills, saveProgress } = await import("../src/db.ts");
const { give, itemOp } = await import("../src/items.ts");
const { changeJob, charBase, equip, gainMastery, refreshSlots, syncSkills } = await import("../src/progress.ts");
const { Room, buildPlayer } = await import("../src/room.ts");
test.after(() => {
  db.close();
  for (const ext of ["", "-wal", "-shm"]) rmSync(fileURLToPath(new URL(`../data/${process.env.RPG_DB_FILE}${ext}`, import.meta.url)), { force: true });
});
type Player = import("../src/room.ts").Player;
type Mob = import("../src/mobs.ts").Mob;

const map = loadMap(JSON.parse(readFileSync(new URL("../../../web/rpg/shared/data/maps/field.json", import.meta.url), "utf8")));
const ap = { hair: 0, hairColor: 0, skin: 0, eyes: 0 };
let n = 0;
/** 맞아도 안 죽는 과녁 (최대 HP 는 기본 스탯에서 — 효과가 바뀌면 다시 계산되므로) */
const tough = (m: Mob) => {
  m.base = { ...m.base, hp: 1e6 };
  recalc(m);
  m.hp = 1e6;
};

/** 필드 방 + 레벨 · 직업을 정한 플레이어 */
function setup(level: number, line?: string, job?: string, el = "fire", sub?: string) {
  let now = 5_000_000 + n * 1_000_000;
  setRandom(Math.random);
  const room = new Room("field", 1, map, now);
  setRandom(fixed);
  const sent: string[] = [];
  const char = createCharacter(`s${++n}`, `시험${n}`, el, ap)!;
  char.level = level;
  saveProgress(char.id, level, 0);
  const slime = [...room.mobs.values()].find((m) => m.key === "slime")!;
  const p: Player = buildPlayer({ readyState: 1, send: (s: string) => sent.push(s) } as never, char.discord_id, char, slime.x - 40, slime.y);
  room.add(p);
  // 직업 교관 거리 검사는 main.ts — 여기서는 바로 전직
  if (line) assert.equal(changeJob(p, { line }), null);
  if (job) assert.equal(changeJob(p, { job, sub }), null);
  let seq = 0;
  const tick = (t = 1, inp: Partial<import("../../../web/rpg/shared/movement.ts").MoveInput> = {}) => {
    for (let i = 0; i < t; i++) {
      p.inputs.push({ seq: seq++, mx: 0, my: 0, run: false, ...(i === 0 ? inp : {}) });
      p.inputs.push({ seq: seq++, mx: 0, my: 0, run: false }, { seq: seq++, mx: 0, my: 0, run: false });
      now += TICK_MS;
      room.tick(now);
    }
  };
  /** 스킬을 자기 슬롯에 끼우고 (비전투 조건은 따로 시험) 조준해서 씀 */
  const use = (id: string, ax: number, ay: number, extra = {}) => {
    const sk = SKILLS[id];
    for (const l of p.prog.skills) if (l.slot === sk.slot) l.slot = null;
    p.prog.skills.find((l) => l.id === id)!.slot = sk.slot;
    refreshSlots(p);
    p.mp = p.st.mana;
    p.en = p.st.energy;
    p.mover.stamina = p.mover.staminaMax;
    tick(1, { k: sk.slot, ax: Math.round(ax), ay: Math.round(ay), ...extra });
  };
  /** p 앞 dx 에 슬라임 하나를 데려다 놓고 나머지는 멀리 */
  const dummy = (dx = 30, dy = 0, key = "slime") => {
    const m = [...room.mobs.values()].find((x) => x.key === key && !x.dead)!;
    for (const o of room.mobs.values()) if (o !== m && Math.abs(o.x - p.x) < 200 && Math.abs(o.y - p.y) < 200) { o.x += 400; o.home = { x: o.x, y: o.y }; }
    m.x = p.x + dx;
    m.y = p.y + dy;
    m.hist = [];
    tough(m);
    m.state = "idle";
    m.wait = 1e15;
    return m;
  };
  return { room, p, sent, tick, use, dummy, now: () => now };
}

test("전직: 계열 배율 · 잠재력 · 스킬 자동 습득 · 슬롯 · 레벨 조건", () => {
  const { p } = setup(9);
  assert.match(changeJob(p, { line: "tank" })!, /Lv10/);
  p.char.level = 10;
  const hp0 = charBase(p).hp;
  assert.equal(changeJob(p, { line: "tank" }), null);
  assert.equal(p.base.hp, hp0 * STAT_GRADE.S);
  assert.equal(p.prog.pot[0], 10 + 1 + 30 + 1 + 1 + 1 + 3, "기본 10 · 대시 베기 +1 · 전직 +30 · 하급 3개 +1씩 · 불굴의 요새(중급) +3");
  assert.deepEqual(p.prog.skills.map((l) => l.id).sort(), ["dash_slash", "earth_split", "first_aid", "fortress", "iron_wall", "magic_arrow", "shield_bash"].sort());
  assert.deepEqual(p.slots, { A: "punch", Q: "shield_bash", W: "iron_wall", E: "earth_split", R: "fortress" }, "전직 스킬이 슬롯에 바로");
  assert.match(changeJob(p, { line: "mage" })!, /이미/);
  assert.match(changeJob(p, { job: "guardian" })!, /Lv30/);
  p.char.level = 30;
  syncSkills(p);
  assert.ok(p.prog.skills.some((l) => l.id === "taunt_shout") && p.prog.skills.some((l) => l.id === "counter_stance"), "Lv15 · Lv20 계열 스킬");
  assert.match(changeJob(p, { job: "ninja" })!, /계열/);
  assert.equal(changeJob(p, { job: "guardian" }), null);
  assert.equal(p.job, "guardian");
  assert.equal(p.slots.Q, "shield_throw");
  assert.equal(loadSkills(p.char.id).length, p.prog.skills.length, "저장");
  // 원소술사: 보조 속성은 주 속성과 달라야
  const e = setup(30, "mage").p;
  assert.match(changeJob(e, { job: "elementalist", sub: "fire" })!, /보조 속성/);
  assert.equal(changeJob(e, { job: "elementalist", sub: "water" }), null);
  assert.equal(e.prog.sub, "water");
});

test("숙련도: 사용 · 적중 · 막타, 잠재력 배율, 스킬 레벨 ≤ 플레이어 레벨 (넘치면 1레벨분 보관), 쿨 · 위력", () => {
  const { p, use, dummy } = setup(10, "warrior");
  const l = p.prog.skills.find((x) => x.id === "double_slash")!;
  const lv0 = l.lv;
  const m0 = l.mastery;
  const d = dummy(20);
  use("double_slash", d.x, d.y);
  for (let i = 0; i < 4; i++) use("double_slash", d.x, d.y); // 쿨 중 → 거부 (숙련도 그대로)
  const pot = 1 + p.prog.pot[0] / 100;
  assert.ok(Math.abs(l.mastery - m0 - (1 + 2) * pot) < 0.02, `사용 1 + 적중 2 (반복 두 번이라도 대상당 한 번) × 잠재력 → ${l.mastery - m0}`);
  // 숙련도가 넘쳐도 플레이어 레벨에서 멈추고 1레벨분만 보관
  gainMastery(p, "double_slash", 1e6);
  assert.equal(l.lv, 10);
  assert.equal(l.mastery, needMastery(10));
  p.char.level = 11;
  syncSkills(p);
  assert.equal(l.lv, 11, "플레이어 레벨업 → 쌓아 둔 숙련도로 바로");
  assert.ok(l.lv > lv0);
  // 막타 +5
  const k = p.prog.skills.find((x) => x.id === "whirlwind")!;
  const d2 = dummy(10);
  d2.hp = 1;
  const before = k.mastery;
  use("whirlwind", d2.x, d2.y);
  assert.ok(d2.dead);
  assert.ok(k.mastery - before >= (1 + 2 + 5) * pot - 0.02, `사용 + 적중 + 막타 ${k.mastery - before}`);
});

test("슬롯 장착: 비전투에서만 · 자기 슬롯에만 · 스킬북으로 배움/등급 올림", () => {
  const { p, room, dummy } = setup(10, "support");
  p.combat = room.now;
  assert.match(equip(p, "magic_arrow", "Q")!, /전투 중/);
  p.combat = -1e9;
  assert.match(equip(p, "magic_arrow", "E")!, /넣을 수 없/);
  assert.equal(equip(p, "magic_arrow", "Q"), null);
  assert.equal(p.slots.Q, "magic_arrow");
  // 스킬북: 서포터 Lv15 스킬 (아직 레벨 미달)을 책으로 먼저 배움, 다른 계열 책은 못 읽음
  give(p, "book_holy_bolt", 1, "rare", "test");
  give(p, "book_meteor", 1, "common", "test");
  const book = p.items.find((i) => i.tpl === "book_holy_bolt")!;
  assert.equal(itemOp(p, { op: "use", a: [book.loc, book.slot] }), null);
  assert.equal(p.prog.skills.find((l) => l.id === "holy_bolt")!.grade, "mid", "희귀 책 = 중급");
  const meteor = p.items.find((i) => i.tpl === "book_meteor")!;
  assert.match(itemOp(p, { op: "use", a: [meteor.loc, meteor.slot] })!, /배울 수 없/);
  assert.ok(p.items.some((i) => i.tpl === "book_meteor"), "못 읽은 책은 그대로");
  // 등급: 중급은 위력 ×1.2 · 소모 −10%
  void dummy;
});

/** 직업마다 모든 스킬을 써 보고 무슨 일이 일어났는지 확인 */
for (const [job, j] of Object.entries(JOBS).filter(([, x]) => x.star)) {
  test(`★ ${j.name}: 계열 + 전용 스킬 전부 시전 (Q3 · W2 · E3 · R2)`, () => {
    setFixed(() => 0.5);
    const { p, room, use, dummy, tick } = setup(40, j.line, job, "fire", job === "elementalist" ? "water" : undefined);
    const mine = Object.values(SKILLS).filter((s) => !s.hidden && s.slot !== "A" && (s.job.includes(j.line) || s.job.includes(job)));
    const count = (slot: string) => mine.filter((s) => s.slot === slot).length;
    assert.deepEqual([count("Q"), count("W"), count("E"), count("R")], [3, 2, 3, 2], LINES[j.line].name);
    for (const sk of mine) {
      assert.ok(p.prog.skills.some((l) => l.id === sk.id), `${sk.name} 습득`);
      p.combat = -1e9;
      p.fx = [];
      const d = dummy(sk.targeting === "melee" || sk.targeting === "self" ? 20 : 60);
      const hp0 = d.hp;
      const fx0 = p.fx.length;
      const x0 = p.x;
      p.hp = p.st.hp * 0.5;
      const hpMe = p.hp;
      if (sk.charge) {
        tick(1, { cs: sk.slot });
        tick(30);
      }
      use(sk.id, d.x, d.y);
      tick(Math.ceil(((sk.castMs + (sk.delayMs ?? 0) + (sk.repeat ? sk.repeat.n * sk.repeat.ms : 0)) / TICK_MS)) + 12);
      const happened = d.hp < hp0 || d.fx.length > 0 || p.fx.length > fx0 || p.hp > hpMe || p.x !== x0 || room.walls.length > 0;
      assert.ok(happened, `${sk.name}: 아무 일도 없음`);
      assert.ok(!p.out.some((e) => e[0] === "cf" && String(e[2]).includes(sk.name)), "");
      const cf = p.out.find((e) => e[0] === "cf");
      assert.equal(cf, undefined, `${sk.name} 거부: ${cf?.[2]}`);
      p.out = [];
      room.walls = [];
      p.cd = {};
    }
    setFixed(Math.random);
  });
}

test("패시브: 수호의 맹세 · 기사도 · 그림자 걸음 · 바람 읽기 · 치유의 손길", () => {
  setFixed(() => 0.99);
  // 수호기사가 옆 아군 피해 15% 를 대신 받음 (×0.8)
  const g = setup(30, "tank", "guardian");
  const ally = buildPlayer({ readyState: 1, send() {} } as never, "ally", createCharacter("ally", "아군", "fire", ap)!, g.p.x + 20, g.p.y);
  g.room.add(ally);
  const mob = g.dummy(60);
  const hpG = g.p.hp;
  const dealt = hit(g.room, mob, ally, { base: 100, atkRatio: 0, apRatio: 0, cat: "physical", el: null, threat: 1 });
  assert.ok(g.p.hp < hpG, "수호기사가 대신 받음");
  assert.equal(Math.round((hpG - g.p.hp) / 0.8), Math.round(dealt * 0.15 / 0.85), "15% × 0.8");
  // 기사도: 같은 대상 3번 → 4번째 +30%
  const k = setup(30, "warrior", "battle_knight");
  const t = k.dummy(30);
  const spec = { base: 50, atkRatio: 0, apRatio: 0, cat: "physical" as const, el: null, threat: 1 };
  const a = hit(k.room, k.p, t, spec);
  hit(k.room, k.p, t, spec);
  hit(k.room, k.p, t, spec);
  assert.equal(hit(k.room, k.p, t, spec), Math.round(a * 1.3));
  // 그림자 걸음: 3초 비전투 → 이속 +25%
  const nj = setup(30, "assassin", "ninja");
  nj.p.combat = nj.room.now;
  nj.tick(2);
  assert.ok(!has(nj.p, "shadow_step"));
  nj.tick(Math.ceil(3000 / TICK_MS));
  assert.ok(has(nj.p, "shadow_step"));
  assert.ok(Math.abs(nj.p.st.moveSpeed - Math.min(200, charBase(nj.p).moveSpeed * 1.25)) < 1, "이속 상한 200");
  // 바람 읽기: 움직이며 쏘면 −20%, 궁수는 그대로
  const shot = { base: 50, atkRatio: 0, apRatio: 0, cat: "physical" as const, el: null, threat: 1, ranged: true };
  const war = setup(30, "warrior");
  const arc = setup(30, "ranged", "archer");
  for (const s of [war, arc]) s.p.mover.moving = true;
  const tw = war.dummy(50);
  const ta = arc.dummy(50);
  const still = { ...shot, ranged: false };
  assert.equal(hit(war.room, war.p, tw, shot), Math.round(hit(war.room, war.p, tw, still) * 0.8));
  assert.equal(hit(arc.room, arc.p, ta, shot), hit(arc.room, arc.p, ta, still));
  // 치유의 손길: 30% 아래 아군에게 +30%
  const pr = setup(30, "support", "priest");
  pr.p.hp = pr.p.st.hp * 0.2;
  const h0 = pr.p.hp;
  pr.use("heal_light", pr.p.x, pr.p.y);
  const low = pr.p.hp - h0;
  pr.p.hp = pr.p.st.hp * 0.5;
  const h1 = pr.p.hp;
  pr.p.cd = {};
  pr.use("heal_light", pr.p.x, pr.p.y);
  assert.ok(Math.abs(low - (pr.p.hp - h1) * 1.3) <= 1, `${low} vs ${pr.p.hp - h1}`);
  setFixed(Math.random);
});

test("원소 반응: 과전류 연쇄 · 결빙 · 융해 · 독무 폭발, 원소술사 +25%", () => {
  setFixed(() => 0.99);
  const { room, p, dummy } = setup(30, "mage");
  const a = dummy(60);
  const b = [...room.mobs.values()].find((m) => m !== a && !m.dead)!;
  b.x = a.x + 20;
  b.y = a.y;
  tough(b);
  const spec = (el: string) => ({ base: 100, atkRatio: 0, apRatio: 0, cat: "magical" as const, el: el as never, threat: 1 });
  addEffect(room, a, { id: "wet", ms: 4000 });
  const bHp = b.hp;
  hit(room, p, a, spec("electric"));
  assert.ok(b.hp < bHp && has(b, "shock") && !has(a, "wet"), "과전류: 옆 적에게 연쇄 + 감전");
  addEffect(room, a, { id: "wet", ms: 4000 });
  hit(room, p, a, spec("ice"));
  assert.ok(has(a, "freeze"), "결빙");
  a.fx = [];
  const plain = hit(room, p, a, spec("ice"));
  addEffect(room, a, { id: "burn", ms: 3000, dot: 1 });
  assert.equal(hit(room, p, a, spec("ice")), Math.round(plain * 1.5), "융해 ×1.5");
  a.fx = [];
  const fire = hit(room, p, a, spec("fire"));
  for (let i = 0; i < 3; i++) addEffect(room, a, { id: "poison", ms: 4000, dot: 1 });
  assert.equal(hit(room, p, a, spec("fire")), fire + Math.round(3 * 0.2 * fire), "독무 폭발: 스택 × 20%");
  assert.ok(room.ev.some((e) => e[0] === "rx"));
  // 원소술사: 융해 추가분 +25%
  const el = setup(30, "mage", "elementalist", "fire", "ice");
  const t = el.dummy(60);
  const base = hit(el.room, el.p, t, spec("ice"));
  addEffect(el.room, t, { id: "burn", ms: 3000, dot: 1 });
  t.fx = t.fx.filter((e) => e.id === "burn");
  assert.equal(hit(el.room, el.p, t, spec("ice")), Math.round(base * (1 + 0.5 * 1.25)));
  setFixed(Math.random);
});

test("메커니즘: 반격 태세 · 은신 · 부활 · 성역의 방패 · 차지 · 튕김 · 처형 · 순보", () => {
  setFixed(() => 0.99);
  // 반격 태세: 근접 공격을 막고 되돌려 줌 + 기절
  const t = setup(30, "tank", "guardian");
  const m = t.dummy(20);
  t.use("counter_stance", m.x, m.y);
  const hp0 = t.p.hp;
  const mhp = m.hp;
  hit(t.room, m, t.p, { base: 50, atkRatio: 0, apRatio: 0, cat: "physical", el: null, threat: 1, melee: true });
  assert.equal(t.p.hp, hp0);
  assert.ok(m.hp < mhp && has(m, "stun"));
  // 성역의 방패: 토끼 투사체가 벽에 막힘
  t.p.cd = {};
  t.tick(30);
  t.use("sanctuary_wall", t.p.x + 50, t.p.y);
  assert.equal(t.room.walls.length, 1);
  const rabbit = [...t.room.mobs.values()].find((x) => x.key === "rabbit")!;
  rabbit.x = t.p.x + 80;
  rabbit.y = t.p.y - 6;
  t.room.ev = [];
  t.room.shoot(rabbit, "mob", null, -1, 0, 150, 120, 5, { base: 50, atkRatio: 0, apRatio: 0, cat: "magical", el: null, threat: 0 }, -1, 0);
  const evs: unknown[][] = [];
  for (let i = 0; i < 20; i++) { evs.push(...t.room.ev); t.tick(); }
  assert.ok(!evs.some((e) => e[0] === "h" && e[2] === t.p.id), "벽에 막힘");
  // 은신: 몹이 놓침
  const s = setup(30, "assassin", "ninja");
  const wolf = s.dummy(60, 0, "wolf");
  wolf.wait = 0;
  s.use("smoke", wolf.x, wolf.y);
  assert.ok(has(s.p, "stealth"));
  s.tick(5);
  assert.ok(!wolf.threat.has(s.p.id) || !wolf.wind, "은신한 상대는 노리지 않음");
  // 순보: 7칸 순간이동
  s.p.cd = {};
  const x0 = s.p.x;
  s.use("shunpo", s.p.x - 200, s.p.y);
  assert.ok(x0 - s.p.x > 60 && !has(s.p, "stealth") === !has(s.p, "stealth"));
  // 처형: HP 30% 아래면 ×2
  s.p.cd = {};
  const e = s.dummy(100);
  e.hp = e.st.hp * 0.2;
  const h1 = e.hp;
  s.use("shadow_execute", e.x, e.y);
  s.tick(10);
  const big = h1 - e.hp;
  const e2 = s.dummy(100);
  const h2 = e2.hp;
  s.p.cd = {};
  s.use("shadow_execute", e2.x, e2.y);
  s.tick(10);
  assert.ok(Math.abs(big - (h2 - e2.hp) * 2) <= 2, `처형 ${big} vs ${h2 - e2.hp}`);
  // 차지: 1.2초 모으면 2배 (무 속성 — 화상 도트가 섞이지 않게)
  const a = setup(30, "ranged", "archer", "none");
  const tgt = a.dummy(80);
  a.use("aimed_shot", tgt.x, tgt.y);
  a.tick(10);
  const quick = 1e6 - tgt.hp;
  tgt.hp = 1e6;
  a.p.cd = {};
  a.tick(1, { cs: "Q" });
  a.tick(30);
  a.use("aimed_shot", tgt.x, tgt.y);
  a.tick(10);
  assert.ok(Math.abs(1e6 - tgt.hp - quick * 2) <= 2, `차지 ${1e6 - tgt.hp} vs ${quick}`);
  // 튕김: 방패 투척이 옆 적에게
  const b1 = t.dummy(40);
  const b2 = [...t.room.mobs.values()].find((x) => x !== b1 && x.key === "slime" && !x.dead)!;
  b2.x = b1.x + 30;
  b2.y = b1.y + 20;
  tough(b2);
  t.p.cd = {};
  t.use("shield_throw", b1.x, b1.y);
  t.tick(20);
  assert.ok(b1.hp < 1e6 && b2.hp < 1e6, "튕김");
  // 부활의 기적
  const pr = setup(30, "support", "priest");
  const dead = buildPlayer({ readyState: 1, send() {} } as never, "dead", createCharacter("dead", "쓰러짐", "fire", ap)!, pr.p.x + 30, pr.p.y);
  pr.room.add(dead);
  dead.hp = 1;
  hit(pr.room, pr.dummy(80) as Mob, dead, { base: 1000, atkRatio: 0, apRatio: 0, cat: "physical", el: null, threat: 1 });
  assert.ok(dead.dead);
  pr.use("resurrection", dead.x, dead.y);
  pr.tick(Math.ceil(1500 / TICK_MS) + 2);
  assert.ok(!dead.dead && dead.respawnAt === 0 && dead.hp > dead.st.hp * 0.3);
  assert.ok(pr.room.ev.length >= 0 && find(dead, "stun") === undefined);
  setFixed(Math.random);
});

test("P9 세부 직업 24개: 전직 · 전용 스킬 슬롯 · 잠재력 옮기기(마법형 · 혼합형) · 주문력 평타", () => {
  for (const [id, j] of Object.entries(JOBS)) {
    const { p } = setup(30, j.line, id, "fire", id === "elementalist" ? "water" : undefined);
    const kit = Object.values(SKILLS).filter((s) => s.job.includes(id));
    for (const sk of kit) assert.equal(p.slots[sk.slot], sk.id, `${id}: ${sk.slot} 슬롯에 바로`);
    if (j.kind) assert.ok(p.prog.pot[1] > 10 + (j.kind === "magic" ? 29 : 14), `${id} 잠재력 → 마법 ${p.prog.pot}`);
  }
  // 나이트워커 평타(단검 · 맨손)는 주문력으로: 주문력만 올리면 평타 피해도 오름
  const { p, room, dummy } = setup(30, "assassin", "nightwalker");
  assert.ok(p.base.ap > p.base.atk);
  const d = dummy(20);
  setFixed(() => 0.99);
  const spec = { base: 0, atkRatio: 1, apRatio: 0, cat: "physical" as const, el: null, threat: 1, basic: true };
  p.st.atk = 1;
  const before = d.hp;
  hit(room, p, d, spec);
  assert.ok(before - d.hp <= 3, "물리 평타 스펙 그대로면 공격력 1 → 거의 0");
  setFixed(Math.random);
});

test("P9 패시브: 광전사 · 대지수호자 · 나이트워커 · 투척수 2회 충전 · 주술사 · 엔지니어 · 환영자객 · 소환수", () => {
  // 광전사 「피의 광기」: 잃은 HP 10%마다 1중첩
  const b = setup(30, "tank", "berserker");
  b.p.hp = b.p.st.hp * 0.45;
  b.tick(1);
  assert.equal(find(b.p, "blood_rage")?.stacks, 5);
  const ls = b.p.st.lifesteal;
  b.p.hp = b.p.st.hp;
  b.tick(1);
  assert.ok(!has(b.p, "blood_rage") && b.p.st.lifesteal < ls);

  // 대지수호자 「대지의 뿌리」: 멈춰 있으면 방어 +20% · 넉백 면역
  const e = setup(30, "tank", "earthwarden");
  e.tick(2);
  assert.ok(has(e.p, "earth_root"));
  const x0 = e.p.x;
  e.room.push(e.p, 30, 0);
  assert.equal(e.p.x, x0);
  for (let i = 0; i < 3; i++) e.p.inputs.push({ seq: 9000 + i, mx: 1, my: 0, run: false }); // 틱 내내 걸음
  e.room.tick(e.now() + TICK_MS);
  assert.ok(!has(e.p, "earth_root"), "움직이면 풀림");

  // 나이트워커 「밤의 장막」: 은신을 깨는 첫 공격은 치명타
  const n = setup(30, "assassin", "nightwalker");
  const d = n.dummy(20);
  setFixed(() => 0.99);
  addEffect(n.room, n.p, { id: "stealth", ms: 3000 }, n.p);
  n.room.ev = [];
  hit(n.room, n.p, d, { base: 10, atkRatio: 0, apRatio: 1, cat: "magical", el: null, threat: 1 });
  assert.equal(n.room.ev.find((v) => v[0] === "h")?.[4], H_CRIT);
  n.room.ev = [];
  hit(n.room, n.p, d, { base: 10, atkRatio: 0, apRatio: 1, cat: "magical", el: null, threat: 1 });
  assert.equal(n.room.ev.find((v) => v[0] === "h")?.[4], 0, "은신이 없으면 보통 확률");
  setFixed(Math.random);

  // 투척수 「손재주」: 투척 스킬 2회 충전
  const t = setup(30, "ranged", "thrower");
  const td = t.dummy(60);
  const cf = () => t.sent.join("").includes("재사용 대기");
  t.use("dagger_fan", td.x, td.y);
  t.use("dagger_fan", td.x, td.y);
  assert.ok(!cf(), "두 번은 바로");
  t.use("dagger_fan", td.x, td.y);
  t.tick(2);
  assert.ok(cf(), "세 번째는 대기");

  // 주술사 「조상의 가호」: 디버프를 지우면 1.5초 보호막
  const sh = setup(30, "support", "shaman");
  addEffect(sh.room, sh.p, { id: "slow", ms: 5000, v: 0.3 });
  sh.use("cleansing_wave", sh.p.x, sh.p.y);
  assert.ok(!has(sh.p, "slow") && has(sh.p, "shield"));

  // 엔지니어 「정비」: 설치물 지속 +30% · 포탑이 적을 쏨
  const en = setup(30, "support", "engineer");
  const ed = en.dummy(80);
  en.use("deploy_turret", ed.x, ed.y);
  assert.equal(en.room.pets.length, 1);
  assert.equal(en.room.pets[0].until - en.now(), 15_000 * 1.3);
  const hp0 = ed.hp;
  en.tick(40);
  assert.ok(ed.hp < hp0, "포탑 사격");
  assert.ok(en.sent.some((m) => m.includes('"pet"')), "소환수 엔티티 정보");

  // 소환사: 정령 최대 2마리 · 따라다님 · 시간이 지나면 사라짐
  const su = setup(30, "mage", "summoner");
  su.use("summon_spirit", su.p.x, su.p.y);
  su.tick(Math.ceil(6000 / TICK_MS) + 1);
  su.use("summon_spirit", su.p.x, su.p.y);
  su.tick(Math.ceil(6000 / TICK_MS) + 1);
  su.use("summon_spirit", su.p.x, su.p.y);
  assert.equal(su.room.pets.length, 2, "최대 2 — 오래된 것부터 사라짐");
  for (let i = 0; i < 30; i++) su.p.inputs.push({ seq: 9000 + i, mx: 1, my: 0, run: false });
  su.tick(14);
  for (const q of su.room.pets) assert.ok(Math.hypot(q.x - su.p.x, q.y - su.p.y) < 40, "주인을 따라감");
  su.tick(Math.ceil(16_000 / TICK_MS));
  assert.equal(su.room.pets.length, 0);

  // 환영자객 「잔상」: 구르면 분신 + 몹이 2초 동안 놓침
  const ph = setup(30, "assassin", "phantom");
  const pd = ph.dummy(40);
  pd.wait = 0;
  pd.threat.set(ph.p.id, 100);
  ph.tick(1, { dg: 1, mx: -1 });
  assert.ok(ph.room.pets.some((q) => q.key === "decoy"));
  assert.ok((ph.p.icd.get("decoy") ?? 0) > ph.now());
});
