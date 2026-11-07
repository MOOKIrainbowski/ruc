// 상태효과 엔진(§11-3) · 방 전투(스킬 → 몹 피해 → 처치 → 경험치, 몹 반격, 사망) — 소켓 없이 Room 을 직접 돌림
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";

// DB 는 data/ 안 임시 파일 (net.test 와 같은 방식)
process.env.RPG_DB_FILE = `test-combat-${process.pid}.sqlite`;
const { baseStats } = await import("../../../web/rpg/shared/character.ts");
const { SIM_MS, TICK_MS } = await import("../../../web/rpg/shared/constants.ts");
const { loadMap } = await import("../../../web/rpg/shared/map.ts");
const { newMover } = await import("../../../web/rpg/shared/movement.ts");
const { addEffect, find, hit, makeUnit, setRandom, shieldOf, tickEffects } = await import("../src/combat.ts");
const { Room, newId, playerSlots } = await import("../src/room.ts");
const { createCharacter, db } = await import("../src/db.ts");
test.after(() => {
  db.close();
  for (const ext of ["", "-wal", "-shm"]) rmSync(fileURLToPath(new URL(`../data/${process.env.RPG_DB_FILE}${ext}`, import.meta.url)), { force: true });
});
type Unit = import("../src/combat.ts").Unit;
type World = import("../src/combat.ts").World;
type Player = import("../src/room.ts").Player;

const world = (): World => ({ now: 0, ev: [], unit: () => undefined, damaged() {}, killed() {}, push() {} });
const unit = (kind: "p" | "m" = "p", spirit = 10): Unit => {
  const base = { ...baseStats(1), spirit };
  return makeUnit({ id: newId(), kind, name: "u", el: "none", lv: 1, x: 0, y: 0, r: 7, base, mover: kind === "p" ? newMover(0, 0, base) : undefined });
};

test("같은 효과: 지속시간 갱신 · 독은 5스택까지", () => {
  const w = world();
  const u = unit();
  addEffect(w, u, { id: "slow", ms: 1000, v: 0.3 });
  w.now = 500;
  addEffect(w, u, { id: "slow", ms: 1000, v: 0.3 });
  assert.equal(u.fx.length, 1);
  assert.equal(find(u, "slow")!.until, 1500);
  assert.equal(u.mover!.spd, 70);
  for (let i = 0; i < 7; i++) addEffect(w, u, { id: "poison", ms: 4000, dot: 3 });
  assert.equal(find(u, "poison")!.stacks, 5);
});

test("hardCC 체감 (플레이어): 100% → 50% → 25% → 면역, 끝난 뒤 0.5초 면역", () => {
  const w = world();
  const u = unit();
  const durs: number[] = [];
  for (let i = 0; i < 4; i++) {
    const ok = addEffect(w, u, { id: "stun", ms: 1000 });
    durs.push(ok ? find(u, "stun")!.dur : 0);
    assert.equal(u.mover!.root, ok);
    w.now += 2000;
    tickEffects(w, u); // 만료
    assert.equal(addEffect(w, u, { id: "stun", ms: 1000 }), false, "끝난 직후 0.5초 면역");
    w.now += 600;
  }
  assert.deepEqual(durs, [1000, 500, 250, 0]);
  w.now += 10_000;
  assert.ok(addEffect(w, u, { id: "stun", ms: 1000 }));
  assert.equal(find(u, "stun")!.dur, 1000, "10초 지나면 초기화");
  // 몹은 체감 없음
  const m = unit("m");
  for (let i = 0; i < 3; i++) { assert.ok(addEffect(w, m, { id: "stun", ms: 1000 })); w.now += 1100; tickEffects(w, m); }
});

test("정신계 저항 · 강인함 · 에어본은 줄지 않음 · 면역은 정화", () => {
  const w = world();
  const u = unit("p", 200); // 저항 50%
  setRandom(() => 0.4);
  assert.equal(addEffect(w, u, { id: "sleep", ms: 1000 }), false);
  setRandom(() => 0.6);
  assert.ok(addEffect(w, u, { id: "sleep", ms: 1000 }));
  setRandom(Math.random);
  const t = unit();
  addEffect(w, t, { id: "tenacity", ms: 9000, v: 0.9 }); // 상한 50%
  addEffect(w, t, { id: "root", ms: 1000 });
  addEffect(w, t, { id: "airborne", ms: 1000 });
  assert.equal(find(t, "root")!.dur, 500);
  assert.equal(find(t, "airborne")!.dur, 1000);
  addEffect(w, t, { id: "immune", ms: 3000 });
  assert.equal(t.fx.map((e) => e.id).join(), "tenacity,immune");
  assert.equal(addEffect(w, t, { id: "slow", ms: 1000, v: 0.5 }), false);
});

test("보호막은 먼저 생긴 것부터 · 얼음 둔화 3중첩 → 빙결 · 구르기 무적 · 수면은 맞으면 깸", () => {
  const w = world();
  const a = unit("m");
  const u = unit();
  addEffect(w, u, { id: "shield", ms: 9000, v: 10 });
  addEffect(w, u, { id: "shield", ms: 9000, v: 30 });
  setRandom(() => 0.99); // 치명타 없음
  const hp = u.hp;
  hit(w, a, u, { base: 25, atkRatio: 0, apRatio: 0, cat: "physical", el: null, threat: 1 }); // 방어 10 → 23
  assert.equal(shieldOf(u), 17);
  assert.equal(u.fx.filter((e) => e.id === "shield")[0].v, 0);
  assert.equal(u.hp, hp);
  for (let i = 0; i < 3; i++) addEffect(w, u, { id: "chill", ms: 2000, v: 0.1 });
  assert.ok(find(u, "freeze") && !find(u, "chill"));
  // 구르기 무적 프레임: 피해 0 + 회피(IMMUNE) 이벤트
  const r = unit();
  r.mover!.ifr = 3;
  w.ev = [];
  assert.equal(hit(w, a, r, { base: 50, atkRatio: 0, apRatio: 0, cat: "physical", el: null, threat: 1 }), 0);
  assert.equal(r.hp, r.st.hp);
  assert.deepEqual(w.ev[0].slice(3, 5), [0, 8]);
  const s = unit();
  setRandom(() => 0.99);
  addEffect(w, s, { id: "sleep", ms: 5000 });
  hit(w, a, s, { base: 5, atkRatio: 0, apRatio: 0, cat: "physical", el: null, threat: 1 });
  assert.equal(find(s, "sleep"), undefined);
  setRandom(Math.random);
});

test("필드: 마력 화살로 슬라임 사냥 → 경험치, 슬라임 반격, 쓰러지면 5초 뒤 부활 대기", () => {
  setRandom(() => 0.99);
  const map = loadMap(JSON.parse(readFileSync(new URL("../../../web/rpg/shared/data/maps/field.json", import.meta.url), "utf8")));
  let now = 1_000_000;
  const room = new Room("field", 1, map, now);
  const slimes = [...room.mobs.values()].filter((m) => m.key === "slime");
  assert.equal(slimes.length, 10);
  const target = slimes[0];
  const sent: string[] = [];
  const char = createCharacter("t1", "사냥꾼", "fire", { hair: 0, hairColor: 0, skin: 0, eyes: 0 })!;
  const base = baseStats(1);
  const x = target.x - 60;
  const y = target.y;
  const u = makeUnit({ id: newId(), kind: "p", name: char.nickname, el: "fire", lv: 1, x, y, r: 7, base, mover: newMover(x, y, base) });
  const p = Object.assign(u, {
    kind: "p" as const, mover: u.mover!, ws: { readyState: 1, send: (s: string) => sent.push(s) } as never, discordId: "t1", char, inputs: [], credits: 0,
    lastSeq: -1, steps: 0, cd: {}, slots: playerSlots(), rtt: 0, room: null, out: [], respawnAt: 0, statsSent: "",
  }) as Player;
  room.add(p);
  let seq = 0;
  const run = (ticks: number, act?: () => Partial<import("../../../web/rpg/shared/movement.ts").MoveInput>) => {
    for (let t = 0; t < ticks; t++) {
      for (let i = 0; i < 3; i++) p.inputs.push({ seq: seq++, mx: 0, my: 0, run: false, ...(act?.() ?? {}) });
      now += TICK_MS;
      room.tick(now);
    }
  };
  // 시전: 마나 8 · 쿨 1.5초 → 슬라임 HP 70 (Lv1~3) 에 화살 피해 ≈ 27 × 1.25(불→풀)
  const aim = () => ({ k: "Q" as const, ax: Math.round(target.x), ay: Math.round(target.y) });
  let shots = 0;
  const mp0 = p.mp;
  while (!target.dead && shots < 12) {
    p.mover.x = p.x = target.x - 60; // 슬라임이 다가와도 거리 유지
    p.mover.y = p.y = target.y;
    run(1, aim);
    shots++;
    run(Math.ceil(1500 / TICK_MS));
  }
  assert.ok(target.dead, "슬라임이 쓰러짐");
  assert.ok(p.mp < mp0, "마나 소모");
  assert.ok(p.char.exp > 0, `경험치 ${p.char.exp}`);
  assert.ok(sent.some((s) => s.includes('"xp"')), "경험치 개인 이벤트");
  assert.ok(sent.some((s) => s.includes('["p",')) && sent.some((s) => s.includes('["h",')), "투사체 · 피해 이벤트");
  // 쿨 중 재시전은 거부 (cf)
  run(1, aim);
  run(1, aim);
  assert.ok(sent.some((s) => s.includes('"cf"')));
  // 다른 슬라임을 때려 반격받음 → 맞아서 HP 감소
  const s2 = slimes.find((m) => !m.dead)!;
  p.mover.x = p.x = s2.x - 10;
  p.mover.y = p.y = s2.y;
  const hp0 = p.hp;
  run(1, () => ({ k: "A", ax: Math.round(s2.x), ay: Math.round(s2.y) }));
  assert.ok(s2.threat.has(p.id), "평타로 위협 수치");
  run(60);
  assert.ok(p.hp < hp0, `반격 ${hp0} → ${p.hp}`);
  // 사망 → 5초 뒤 부활 예약 · 경험치 3% 손실 · 이동 막힘
  const exp = p.char.exp;
  p.hp = 1;
  run(60);
  assert.ok(p.dead && p.respawnAt > 0 && p.mover.root);
  assert.ok(p.char.exp <= exp);
  setRandom(Math.random);
  void SIM_MS;
});
