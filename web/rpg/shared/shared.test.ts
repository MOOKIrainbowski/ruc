// 실행: node --test web/rpg/shared/
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { SIM_MS, TILE } from "./constants.ts";
import { STAMINA } from "./data/stats.ts";
import { josa, fmt } from "./josa.ts";
import { loadMap, type TiledMap } from "./map.ts";
import { blocked, dir8, step, type Collider, type Mover } from "./movement.ts";
import { signTicket, verifyTicket } from "./ticket.ts";

const open: Collider = { w: 20, h: 20, solid: new Uint8Array(400) };
const mover = (x = 160, y = 160): Mover => ({ x, y, dir: 0, stamina: 100, staminaMax: 100, restMs: 0, exhausted: false, moving: false, running: false });
const stats = { moveSpeed: 100, endurance: 10 };

test("8방향", () => {
  const cases: [number, number, number][] = [[0, 1, 0], [1, 1, 1], [1, 0, 2], [1, -1, 3], [0, -1, 4], [-1, -1, 5], [-1, 0, 6], [-1, 1, 7]];
  for (const [x, y, d] of cases) assert.equal(dir8(x, y), d, `${x},${y}`);
});

test("이동 속도 100 = 초당 64px, 대각선도 같은 속력", () => {
  const m = mover();
  for (let i = 0; i < 60; i++) step(m, { seq: i, mx: 1, my: 0, run: false }, stats, open);
  assert.ok(Math.abs(m.x - 160 - 64) < 0.5, String(m.x));
  const d = mover();
  for (let i = 0; i < 60; i++) step(d, { seq: i, mx: 1, my: 1, run: false }, stats, open);
  assert.ok(Math.abs(Math.hypot(d.x - 160, d.y - 160) - 64) < 0.5);
});

test("벽에 막히고 벽을 따라 미끄러짐", () => {
  const solid = new Uint8Array(400);
  for (let y = 0; y < 20; y++) solid[y * 20 + 12] = 1; // x=12 칸 세로 벽
  const c = { w: 20, h: 20, solid };
  const m = mover(170, 160);
  for (let i = 0; i < 120; i++) step(m, { seq: i, mx: 1, my: 1, run: false }, stats, c);
  assert.ok(m.x <= 12 * TILE - 7 + 0.01, String(m.x)); // 상자 반폭 7
  assert.ok(m.y > 200); // 아래로는 계속 감
  assert.equal(blocked(c, m.x, m.y), false);
});

test("달리기 → 탈진 → 20% 회복 시 해제, 결과가 결정적", () => {
  const run = (m: Mover) => {
    let steps = 0;
    while (!m.exhausted && steps < 10_000) step(m, { seq: steps++, mx: 1, my: 0, run: true }, stats, { ...open, w: 10_000 });
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
  while (a.exhausted) { step(a, { seq: 0, mx: 0, my: 0, run: false }, stats, open); t += SIM_MS; }
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
