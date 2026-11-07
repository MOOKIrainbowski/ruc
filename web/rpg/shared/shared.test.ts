// 실행: node --test web/rpg/shared/
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { SIM_MS, TILE } from "./constants.ts";
import { baseStats } from "./character.ts";
import { castMs, computeDamage, elementMul, finalStats, mitigation, type Hit } from "./combat.ts";
import { SKILLS } from "./data/skills.ts";
import { ROLL, STAMINA } from "./data/stats.ts";
import { josa, fmt } from "./josa.ts";
import { loadMap, type TiledMap } from "./map.ts";
import { blocked, castMove, dir8, newMover, step, tryRoll, type Collider, type Mover } from "./movement.ts";
import { signTicket, verifyTicket } from "./ticket.ts";

const open: Collider = { w: 20, h: 20, solid: new Uint8Array(400) };
const mover = (x = 160, y = 160): Mover => newMover(x, y, { stamina: 100, moveSpeed: 100, endurance: 10, atkSpeed: 100 });

test("8방향", () => {
  const cases: [number, number, number][] = [[0, 1, 0], [1, 1, 1], [1, 0, 2], [1, -1, 3], [0, -1, 4], [-1, -1, 5], [-1, 0, 6], [-1, 1, 7]];
  for (const [x, y, d] of cases) assert.equal(dir8(x, y), d, `${x},${y}`);
});

test("이동 속도 100 = 초당 64px, 대각선도 같은 속력", () => {
  const m = mover();
  for (let i = 0; i < 60; i++) step(m, { seq: i, mx: 1, my: 0, run: false }, open);
  assert.ok(Math.abs(m.x - 160 - 64) < 0.5, String(m.x));
  const d = mover();
  for (let i = 0; i < 60; i++) step(d, { seq: i, mx: 1, my: 1, run: false }, open);
  assert.ok(Math.abs(Math.hypot(d.x - 160, d.y - 160) - 64) < 0.5);
});

test("벽에 막히고 벽을 따라 미끄러짐", () => {
  const solid = new Uint8Array(400);
  for (let y = 0; y < 20; y++) solid[y * 20 + 12] = 1; // x=12 칸 세로 벽
  const c = { w: 20, h: 20, solid };
  const m = mover(170, 160);
  for (let i = 0; i < 120; i++) step(m, { seq: i, mx: 1, my: 1, run: false }, c);
  assert.ok(m.x <= 12 * TILE - 7 + 0.01, String(m.x)); // 상자 반폭 7
  assert.ok(m.y > 200); // 아래로는 계속 감
  assert.equal(blocked(c, m.x, m.y), false);
});

test("달리기 → 탈진 → 20% 회복 시 해제, 결과가 결정적", () => {
  const run = (m: Mover) => {
    let steps = 0;
    while (!m.exhausted && steps < 10_000) step(m, { seq: steps++, mx: 1, my: 0, run: true }, { ...open, w: 10_000 });
    return steps;
  };
  const a = mover(16, 160);
  const b = mover(16, 160);
  const n = run(a);
  run(b);
  assert.deepEqual(a, b);
  // 100 / (12 × 100/110) ≈ 9.17초
  assert.ok(Math.abs(n * SIM_MS - 9167) < 50, String(n * SIM_MS));
  let t = 0;
  while (a.exhausted) { step(a, { seq: 0, mx: 0, my: 0, run: false }, open); t += SIM_MS; }
  assert.ok(Math.abs(t - (STAMINA.regenDelayMs + 20 / 15 * 1000)) < 50, String(t));
});

test("조사", () => {
  assert.equal(josa("러크", "이/가"), "러크가");
  assert.equal(josa("검", "이/가"), "검이");
  assert.equal(josa("활", "으로/로"), "활로");
  assert.equal(josa("검", "으로/로"), "검으로");
  assert.equal(josa("Steve", "은/는"), "Steve는");
  assert.equal(fmt("{name}이/가 {item} 아이템 10강에 성공했습니다", { name: "볼트", item: "낡은 단검" }), "볼트가 낡은 단검 아이템 10강에 성공했습니다");
});

test("티켓: 서명 · 만료 · 위조", () => {
  const t = signTicket({ sub: "123", name: "a", avatar: null }, "s", 1_000_000);
  assert.equal(verifyTicket(t, "s", 1_000_000)?.sub, "123");
  assert.equal(verifyTicket(t, "s", 1_000_000 + 61_000), null);
  assert.equal(verifyTicket(t, "other", 1_000_000), null);
  const [h, , s] = t.split(".");
  const forged = Buffer.from(JSON.stringify({ sub: "999", name: "x", avatar: null, exp: 9e9 })).toString("base64url");
  assert.equal(verifyTicket(`${h}.${forged}.${s}`, "s", 1_000_000), null);
});

test("광장 맵: 시작 위치가 막혀 있지 않고 분수는 막힘", () => {
  const map = loadMap(JSON.parse(readFileSync(new URL("./data/maps/plaza.json", import.meta.url), "utf8")) as TiledMap);
  assert.equal(blocked(map.collider, map.spawn.x, map.spawn.y), false);
  assert.equal(blocked(map.collider, 48 * TILE, 48 * TILE), true);
});

test("방어 상쇄 · 상성 · 공속 상한", () => {
  assert.equal(mitigation(100, 0), 0.5);
  assert.equal(mitigation(100, 1), 1);
  assert.equal(mitigation(-50, 0), 1);
  assert.equal(elementMul("water", "fire"), 1.25);
  assert.equal(elementMul("water", "grass"), 0.8);
  assert.equal(elementMul("light", "dark"), 1.25);
  assert.equal(elementMul("dark", "light"), 1.25);
  assert.equal(elementMul("none", "fire"), 1);
  assert.equal(elementMul(null, "fire"), 1);
  assert.equal(castMs(1000, 200), 500);
  assert.equal(castMs(1000, 999), 400); // 공속 상한 250
});

test("스탯 합산: (기본 + add) × (1 + mul), 상한 · 0 아래 없음", () => {
  const s = finalStats(baseStats(1), [{ k: "moveSpeed", mul: 0.5 }, { k: "moveSpeed", mul: 0.6 }, { k: "atk", add: 5 }, { k: "atk", mul: 0.1 }, { k: "pdef", add: -99 }, { k: "elDef", el: "fire", add: 20 }]);
  assert.equal(s.moveSpeed, 200); // 100 × 2.1 → 상한 200
  assert.equal(s.atk, 16.5);
  assert.equal(s.pdef, 0);
  assert.equal(s.elDef.fire, 20);
  assert.equal(s.elDef.water, 0);
  assert.equal(s.crit, 0.05);
});

test("피해 공식 §13-1", () => {
  const a = finalStats(baseStats(1), []); // 주문력 10
  const d = finalStats(baseStats(1), [{ k: "mdef", add: 90 }, { k: "elDef", el: "fire", add: 100 }]); // 마방 100
  const h: Hit = { base: 18, atkRatio: 0, apRatio: 0.9, cat: "magical", el: "fire", skill: true };
  // (18 + 9) × 상성 1.25(불→풀) × 마방 0.5 × 속성방어 0.5 = 8.4375 → 8
  assert.equal(computeDamage(a, d, h, "grass", false), 8);
  // 치명타 ×1.5, 스킬 레벨 3 → ×1.08
  assert.equal(computeDamage(a, d, { ...h, skillLv: 3 }, "grass", true), Math.round(27 * 1.08 * 1.25 * 1.5 * 0.25));
  // 물리 · 하이브리드
  const p: Hit = { base: 0, atkRatio: 1, apRatio: 0, cat: "physical", el: null };
  assert.equal(computeDamage(a, finalStats(baseStats(1), [{ k: "pdef", add: 90 }]), p, null, false), 5);
  assert.equal(computeDamage(a, finalStats(baseStats(1), [{ k: "pdef", add: 90 }]), { ...p, cat: "hybrid" }, null, false), Math.round(10 * (0.5 * 0.5 + 0.5 * 100 / 110)));
  // 최소 1, 피해 감소 상한 90%
  assert.equal(computeDamage(a, finalStats(baseStats(1), [{ k: "dmgDown", add: 5 }, { k: "pdef", add: 1e6 }]), p, null, false), 1);
});

test("구르기: 0.3초에 56px, 앞 0.2초 무적, 스태미나 20 × 100/110", () => {
  const m = mover();
  tryRoll(m, { seq: 0, mx: 1, my: 0, run: false });
  assert.equal(m.ifr, ROLL.iframeSteps);
  assert.ok(Math.abs(m.stamina - (100 - 2000 / 110)) < 1e-9);
  let iframes = 0;
  for (let i = 0; i < ROLL.steps; i++) {
    step(m, { seq: i, mx: 0, my: 1, run: false }, open); // 구르는 중 입력은 무시
    if (m.ifr > 0) iframes++;
  }
  assert.ok(Math.abs(m.x - 160 - ROLL.dist) < 1e-9 && m.y === 160, `${m.x},${m.y}`);
  assert.equal(iframes, ROLL.iframeSteps - 1);
  tryRoll(m, { seq: 0, mx: 1, my: 0, run: false });
  assert.equal(m.mv, 0, "쿨 중에는 못 구름");
});

test("대시 베기: 마우스 쪽으로 80px · 응급 처치: 시전 중 고정", () => {
  const m = mover();
  castMove(m, SKILLS.dash_slash, 160 + 30, 160 + 40); // 3:4 방향
  for (let i = 0; i < 20; i++) step(m, { seq: i, mx: 0, my: 0, run: false }, open);
  assert.ok(Math.abs(m.x - 160 - 48) < 1e-9 && Math.abs(m.y - 160 - 64) < 1e-9, `${m.x},${m.y}`);
  const h = mover();
  castMove(h, SKILLS.first_aid, 0, 160);
  assert.equal(h.dir, 6); // 서쪽을 봄
  for (let i = 0; i < 24; i++) step(h, { seq: i, mx: 1, my: 0, run: false }, open); // 400ms = 24스텝
  assert.equal(h.x, 160);
  assert.equal(h.dir, 6);
  step(h, { seq: 0, mx: 1, my: 0, run: false }, open);
  assert.ok(h.x > 160);
  assert.equal(h.dir, 6, "시전 직후 0.5초는 조준 방향 유지");
});
