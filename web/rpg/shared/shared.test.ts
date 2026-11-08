// 실행: node --test web/rpg/shared/
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { SIM_MS, TILE } from "./constants.ts";
import { baseStats } from "./character.ts";
import { castMs, computeDamage, elementMul, finalStats, mitigation, type Hit } from "./combat.ts";
import { EQUIP_SLOTS, ITEMS, basicOf, durMaxOf, fits, gearOf, itemMods, rollDrops, rollRarity, rollSpecials, type Item } from "./data/items.ts";
import { ENHANCE, cycleEnd, disassembleRuc, enhanceCost, itemValue, rollEnhance, rollShop, shopCycle } from "./data/economy.ts";
import { JOBS, LINES, jobRes, jobStats } from "./data/jobs.ts";
import { MOBS } from "./data/mobs.ts";
import { addMastery, needMastery, skillNums, startLevel, type Learned } from "./progress.ts";
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
  castMove(m, SKILLS.dash_slash, 160 + 30, 160 + 40, open); // 3:4 방향
  for (let i = 0; i < 20; i++) step(m, { seq: i, mx: 0, my: 0, run: false }, open);
  assert.ok(Math.abs(m.x - 160 - 48) < 1e-9 && Math.abs(m.y - 160 - 64) < 1e-9, `${m.x},${m.y}`);
  const h = mover();
  castMove(h, SKILLS.first_aid, 0, 160, open);
  assert.equal(h.dir, 6); // 서쪽을 봄
  for (let i = 0; i < 24; i++) step(h, { seq: i, mx: 1, my: 0, run: false }, open); // 400ms = 24스텝
  assert.equal(h.x, 160);
  assert.equal(h.dir, 6);
  step(h, { seq: 0, mx: 1, my: 0, run: false }, open);
  assert.ok(h.x > 160);
  assert.equal(h.dir, 6, "시전 직후 0.5초는 조준 방향 유지");
});

/** 정해진 값을 차례로 돌려주는 난수 (다 쓰면 0.5) */
const seq = (...v: number[]) => () => v.shift() ?? 0.5;
const gearItem = (tpl: string, rarity: Item["rarity"], slot: string, extra: Partial<Item> = {}): Item => {
  const durMax = durMaxOf(ITEMS[tpl], rarity);
  return { id: tpl, tpl, loc: "equipped", slot: EQUIP_SLOTS.indexOf(slot as never), qty: 1, rarity, enh: 0, sp: [], dur: durMax, durMax, ...extra };
};

test("희귀도 롤: 단계마다 상향 확률, 운 · 등급 보너스는 확률을 더함", () => {
  assert.equal(rollRarity(seq(0.9), 0), "poor");
  assert.equal(rollRarity(seq(0.44, 0.24, 0.9), 0), "rare");
  assert.equal(rollRarity(seq(0.46), 0), "poor");
  assert.equal(rollRarity(seq(0.46, 0.9), 0.02), "common", "보너스 2%p 면 0.46 도 통과");
  assert.equal(rollRarity(() => 0, 0), "legendary");
  // 운이 높으면 평균 희귀도가 올라감 (같은 난수열)
  const avg = (bonus: number) => {
    let x = 0.123;
    const r = () => (x = (x * 9301 + 0.49297) % 1);
    let sum = 0;
    for (let i = 0; i < 5000; i++) sum += ["poor", "common", "rare", "advanced", "mythic", "legendary"].indexOf(rollRarity(r, bonus));
    return sum / 5000;
  };
  assert.ok(avg(200 * 0.0005) > avg(0));
});

test("드롭 테이블: 확률 · 개수 · 운(+운/200 기대값) · 장비는 1개씩 희귀도 롤", () => {
  const table = [{ item: "slime_jelly", chance: 0.5, qty: [1, 2] as [number, number] }, { item: "old_dagger", chance: 0.5 }];
  assert.deepEqual(rollDrops(table, 0, 0, seq(0.6, 0.6)), []);
  // 젤리: 통과 · 개수 2 · 운 보너스 판정 실패 / 단검: 통과 · 개수 1 · 운 실패 · 희귀도 하급
  assert.deepEqual(rollDrops(table, 0, 0, seq(0.1, 0.9, 0.9, 0.1, 0, 0.9, 0.9)), [
    { tpl: "slime_jelly", qty: 2, rarity: "poor" }, { tpl: "old_dagger", qty: 1, rarity: "poor" },
  ]);
  // 운 300 → 개수 +1 확정 + 50% 로 하나 더
  assert.equal(rollDrops([table[0]], 0, 300, seq(0, 0, 0.4))[0].qty, 3);
  // 등급 보너스: 확률 × 1.5 (하급)
  assert.equal(rollDrops([{ item: "slime_jelly", chance: 0.5 }], 1, 0, seq(0.7, 0, 0.9)).length, 1);
  for (const m of Object.values(MOBS)) for (const d of m.drops) assert.ok(ITEMS[d.item] || d.item === "book_random", d.item);
  // book_random = 아무 스킬북 하나 (희귀도 롤 → 스킬 등급)
  const book = rollDrops([{ item: "book_random", chance: 1 }], 0, 0, seq(0, 0, 0.5, 0.9))[0];
  assert.equal(ITEMS[book.tpl].kind, "book");
  assert.equal(book.rarity, "poor");
});

test("장비 스탯: 희귀도 배율 · 내구도 0 이면 꺼짐 · 세트 단계 · 평타 · 착용 조건", () => {
  assert.equal(durMaxOf(ITEMS.wood_sword, "poor"), 100);
  assert.equal(durMaxOf(ITEMS.leather_vest, "legendary", 2), Math.round(120 * 3.5 * 1.2));
  assert.equal(durMaxOf(ITEMS.copper_ring, "rare"), 0);
  const sword = gearItem("wood_sword", "rare", "weapon");
  assert.deepEqual(itemMods(sword), [{ k: "atk", add: 7 * 1.25 }]);
  const s0 = finalStats(baseStats(1), []);
  assert.equal(finalStats(baseStats(1), itemMods(sword)).atk, s0.atk + 8.75);
  assert.deepEqual(itemMods({ ...sword, dur: 0 }), []);
  assert.equal(basicOf([sword]), "slash");
  assert.equal(basicOf([{ ...sword, dur: 0 }]), "punch");
  assert.equal(basicOf([{ ...sword, loc: "inventory" }]), "punch");
  // 새싹 수호자: 2개 재생력 +10, 3개 풀 방어 +20, 5개 덩굴 보호막
  const set = ["sprout_helm:helmet", "sprout_mail:chest", "sprout_greaves:legs", "sprout_boots:boots", "sprout_gloves:gloves"].map((x) => gearItem(x.split(":")[0], "common", x.split(":")[1]));
  const st = (n: number) => finalStats(baseStats(1), gearOf(set.slice(0, n)).mods);
  assert.equal(st(1).regen, s0.regen);
  assert.equal(st(2).regen, s0.regen + 10);
  assert.equal(st(3).elDef.grass, 20);
  assert.equal(gearOf(set.slice(0, 4)).procs.length, 0);
  assert.deepEqual(gearOf(set).procs, [{ id: "vine_shield", v: 0.08 }]);
  // 특수효과: 고급 1개 · 전설 2개(서로 다름) · 일반 0개, 스탯형은 바로 스탯
  assert.equal(rollSpecials(ITEMS.wood_sword, "common", Math.random).length, 0);
  const leg = rollSpecials(ITEMS.wood_sword, "legendary", Math.random);
  assert.equal(new Set(leg.map((s) => s.id)).size, 2);
  // 전설 배율로 1 을 넘는 비율형(낙뢰 60~100% × 2.2)도 정수로 뭉개지지 않음
  const bolt = rollSpecials(ITEMS.wood_sword, "legendary", seq(0, 0.9, 0, 0)).find((x) => x.id === "fifth_bolt");
  assert.ok(bolt && bolt.v > 1 && !Number.isInteger(bolt.v), JSON.stringify(bolt));
  const ring = { ...gearItem("copper_ring", "advanced", "ring1"), sp: [{ id: "fortune", v: 3 }] };
  assert.equal(finalStats(baseStats(1), itemMods(ring)).luck, baseStats(1).luck + 3);
  assert.equal(fits(ITEMS.copper_ring, EQUIP_SLOTS.indexOf("ring2"), 1), null);
  assert.ok(fits(ITEMS.copper_ring, EQUIP_SLOTS.indexOf("weapon"), 1));
  assert.ok(fits(ITEMS.fang_sword, EQUIP_SLOTS.indexOf("weapon"), 9), "Lv10 부터");
  assert.ok(fits(ITEMS.hp_potion_s, 0, 40));
});

test("성장 공식: 필요 숙련도 · 연속 레벨업 · 레벨 상한 · 시작 레벨 · 등급 · 직업 배율", () => {
  assert.equal(needMastery(1), 30);
  assert.equal(needMastery(4), 240);
  const l: Learned = { id: "magic_arrow", grade: "low", lv: 1, mastery: 0, slot: null };
  assert.equal(addMastery(l, 30 + 84 + 155, 10), 3, "한 번에 여러 레벨 (30 · 84 · 155)");
  assert.equal(l.lv, 4);
  addMastery(l, 1e6, 5);
  assert.deepEqual([l.lv, l.mastery], [5, needMastery(5)], "플레이어 레벨에서 멈추고 1레벨분만 보관");
  assert.equal(addMastery(l, 0, 6), 1, "플레이어가 오르면 쌓아 둔 것으로 바로");
  assert.equal(startLevel(10, 30), 1);
  assert.equal(startLevel(85, 30), 3);
  assert.equal(startLevel(400, 4), 4, "플레이어 레벨 이하");
  const sk = SKILLS.meteor;
  const lo = skillNums(sk, { grade: "low", lv: 1 }, 0);
  const hi = skillNums(sk, { grade: "high", lv: 10 }, 0.1);
  assert.equal(hi.power, 1.45 * (1 + 0.04 * 9));
  assert.equal(hi.cost.mana, Math.round(60 * 0.8));
  assert.equal(hi.radius, 64 * 1.15);
  assert.equal(hi.cooldownMs, lo.cooldownMs * (1 - 0.03 * 2) * 0.9, "5레벨마다 −3% 뒤 쿨감");
  // 직업 배율 (§6-2): 기본값과 성장량에 곱함
  const t = jobStats(10, "tank", [10, 10]);
  const b = baseStats(10);
  assert.equal(t.hp, b.hp * 1.5);
  assert.equal(t.ap, b.ap * 0.7);
  assert.equal(jobStats(10, null, [42, 10]).potentialPhys, 42);
  for (const [id, j] of Object.entries(JOBS)) assert.ok(LINES[j.line], id);
  // P9: 세부 직업 30개 모두 — 직업마다 전용 Q · W · E · R (2차 전직 Lv30)
  assert.equal(Object.values(JOBS).filter((j) => j.star).length, 30);
  for (const id of Object.keys(JOBS)) {
    const kit = Object.values(SKILLS).filter((s) => s.job.includes(id));
    assert.equal(kit.map((s) => s.slot).sort().join(""), "EQRW", `${id} 전용 Q · W · E · R`);
    assert.ok(kit.every((s) => s.learnLv === 30), id);
  }
  // 마법형(나이트워커): 공격력 ↔ 주문력 등급, 혼합형(마검사): 주문력 = 공격력 등급 · 자원
  const b30 = baseStats(30);
  const nin = jobStats(30, "assassin", [10, 10], "ninja");
  const nw = jobStats(30, "assassin", [10, 10], "nightwalker");
  assert.equal(nw.ap / b30.ap, nin.atk / b30.atk);
  assert.equal(nw.atk / b30.atk, nin.ap / b30.ap);
  assert.equal(jobStats(30, "warrior", [10, 10], "spellblade").ap / b30.ap, jobStats(30, "warrior", [10, 10]).atk / b30.atk);
  assert.deepEqual([jobRes("assassin", "nightwalker"), jobRes("warrior", "spellblade"), jobRes("tank", "berserker"), jobRes(null, null)], ["mana", "both", "energy", null]);
});

test("경제 공식: 가치 · 분해 환불 · 강화 확률 (축복 · 보호) · 비용 · 상점 회차 · 시드 진열", () => {
  assert.equal(itemValue({ tpl: "wood_sword", rarity: "common", enh: 0 }), 20 * 3);
  assert.equal(itemValue({ tpl: "wood_sword", rarity: "legendary", enh: 2 }), Math.round(20 * 1000 * 1.3));
  assert.equal(disassembleRuc({ tpl: "wood_sword", rarity: "common", enh: 0 }), 1, "최소 1");
  assert.equal(disassembleRuc({ tpl: "wood_sword", rarity: "legendary", enh: 0 }), 400);
  assert.equal(rollEnhance(0.94, 0, false, false), "ok");
  assert.equal(rollEnhance(0.96, 0, false, false), "fail");
  assert.equal(rollEnhance(0.155, 9, false, false), "boom", "+10: 성공 15% 다음 15% 는 파괴");
  assert.equal(rollEnhance(0.155, 9, false, true), "fail", "보호 주문서");
  assert.equal(rollEnhance(0.2, 9, true, false), "ok", "축복 +10%p");
  assert.equal(rollEnhance(0.35, 9, true, false), "boom", "축복이어도 파괴율은 그대로");
  assert.equal(enhanceCost({ rarity: "rare", enh: 9 }), 30 * 3 * 20);
  assert.equal(ENHANCE.length, 10);
  // KST 00 · 06 · 12 · 18 시 경계
  const kst = (h: number) => Date.UTC(2026, 10, 7, h) - 9 * 3600_000;
  assert.equal(shopCycle(kst(5) + 3599_999), shopCycle(kst(0)));
  assert.equal(shopCycle(kst(6)), shopCycle(kst(0)) + 1);
  assert.equal(cycleEnd(shopCycle(kst(7))), kst(12));
  const a = rollShop(7, 100, 5);
  assert.deepEqual(rollShop(7, 100, 5), a, "같은 플레이어 · 회차 = 같은 진열");
  assert.notDeepEqual(rollShop(7, 101, 5), a);
  assert.notDeepEqual(rollShop(8, 100, 5), a);
  assert.ok(a.every((x) => ["poor", "common", "rare", "advanced", "mythic"].includes(x.rarity) && x.price > 0));
});

test("파티 분배 (§21-2): 파티장 1.5 : 1 정수 나누기 · 가중치 추첨 · 경험치 균등 + 인원당 5%", async () => {
  const { PARTY, partyExp, partyWeights, pickWeighted, splitWeighted } = await import("./data/party.ts");
  const w = partyWeights([1, 2, 3, 4, 5], 1);
  assert.deepEqual(w, [1.5, 1, 1, 1, 1]);
  const s = splitWeighted(5000, w);
  assert.equal(s.reduce((a, b) => a + b, 0), 5000, "합은 그대로");
  assert.deepEqual(s, [1364, 909, 909, 909, 909], "5인: 파티장 27.3% · 각 18.2%");
  assert.deepEqual(splitWeighted(7, [1.5, 1]), [4, 3]);
  assert.deepEqual(splitWeighted(0, [1.5, 1]), [0, 0]);
  assert.equal(pickWeighted(w, 0), 0);
  assert.equal(pickWeighted(w, 1.5 / 5.5 - 1e-9), 0);
  assert.equal(pickWeighted(w, 1.5 / 5.5 + 1e-9), 1);
  assert.equal(pickWeighted(w, 0.999999), 4);
  // 추첨 비율 ≈ 가중치
  const hits = [0, 0];
  for (let i = 0; i < 2500; i++) hits[pickWeighted([1.5, 1], i / 2500)]++;
  assert.deepEqual(hits, [1500, 1000]);
  assert.equal(partyExp(100, 1), 100, "혼자면 보너스 없음");
  assert.equal(partyExp(100, 2), Math.round((100 * (1 + PARTY.expBonus * 2)) / 2));
  assert.equal(partyExp(100, 5), 25);
});

test("던전 데이터 (§20-3): 10스테이지 · 5 · 10 보스(페이즈 2 · 3) · 몹 · 드롭 아이템이 다 있음", async () => {
  const { RUINS, legendaryChance, memberHp } = await import("./data/dungeons.ts");
  assert.equal(RUINS.stages.length, 10);
  for (const st of RUINS.stages) for (const g of st.groups) assert.ok(MOBS[g.mob], g.mob);
  assert.equal(MOBS.fern.boss!.phases.length, 2);
  assert.equal(MOBS.eldra.boss!.phases.length, 3);
  assert.ok(MOBS.eldra.boss!.phases.some((p) => p.timeline.some((x) => x.move.kind === "orbs")), "전멸기 구슬 정화");
  assert.ok(MOBS.eldra.boss!.phases.some((p) => p.timeline.some((x) => x.move.kind === "spread")) && MOBS.eldra.boss!.phases.some((p) => p.timeline.some((x) => x.move.kind === "stack")), "분산 · 집결");
  for (const m of Object.values(MOBS)) for (const d of m.drops) assert.ok(d.item === "book_random" || ITEMS[d.item], d.item);
  for (const m of Object.values(MOBS)) for (const ph of m.boss?.phases ?? []) for (const x of ph.timeline) if (x.move.kind === "summon") assert.ok(MOBS[x.move.mob]);
  for (const g of RUINS.clear.gear) assert.ok(ITEMS[g]?.slot, g);
  assert.equal(memberHp(1), 1);
  assert.equal(memberHp(5), 1 + 0.6 * 4);
  assert.equal(legendaryChance(0), 0.05);
  assert.ok(legendaryChance(100) > 0.05);
  for (const n of ["arena", "dungeon"]) {
    const m = loadMap(JSON.parse(readFileSync(new URL(`./data/maps/${n}.json`, import.meta.url), "utf8")) as TiledMap);
    assert.ok(!blocked(m.collider, m.spawn.x, m.spawn.y), `${n} 시작 위치`);
  }
});

test("스냅샷 프레임 (D71): 델타 레코드 왕복 · 안 바뀐 줄은 0바이트 · 시야 밖 · mover 압축 왕복", async () => {
  const { diffRows, frame, readFrame, decodeSnapshot } = await import("./snapshot.ts");
  const { packMover, unpackMover } = await import("./movement.ts");
  type Row = [number, number, number, number, number, number, number];
  const sent = new Map<number, Row>();
  const got = new Map<number, Row>();
  const a: Row = [70001, 1700, 900, 3, 1, 1000, 500];
  const b: Row = [5, 10, 20, 0, 0, 999, 0];
  let recs = diffRows(sent, [a, b]);
  assert.equal(recs.length, 30, "처음은 전체 줄 15바이트 × 2");
  let f = readFrame(frame('{"t":"s"}', recs), got);
  assert.deepEqual(f.rows, [a, b]);
  assert.equal(diffRows(sent, [a, b]).length, 0, "안 바뀌면 아무것도 안 보냄");
  const a2: Row = [70001, 1690, 905, 3, 1, 1000, 500];
  recs = diffRows(sent, [a2, b]);
  assert.equal(recs.length, 7, "위치만 바뀌면 7바이트");
  f = readFrame(frame("{}", recs), got);
  assert.deepEqual(f.rows, [a2]);
  const a3: Row = [70001, 1400, 905, 4, 0, 800, 500];
  f = readFrame(frame("{}", diffRows(sent, [a3])), got);
  assert.deepEqual(f.rows, [a3], "크게 움직이거나 다른 칸이 바뀌면 전체 줄");
  assert.deepEqual(f.gone, [5], "빠진 엔티티는 시야 밖 레코드");
  assert.deepEqual([...got.keys()], [70001]);
  const m = newMover(123.456789, 77.25, { stamina: 100, moveSpeed: 100, endurance: 10, atkSpeed: 100 });
  m.exhausted = true;
  m.mvx = 1 / 3;
  assert.deepEqual(unpackMover(packMover(m)), m, "mover 왕복 — 실수 그대로 (D11)");
  const s = decodeSnapshot(frame(JSON.stringify({ t: "s", st: 5, ack: { seq: 9, m: packMover(m) }, v: [1, 2] }), new Uint8Array()), new Map());
  assert.equal(s.ack.seq, 9);
  assert.deepEqual(s.ack.m, m);
});

test("채팅 (§28): 욕설은 길이 그대로 * — 띄어 쓰거나 기호를 끼워도 걸림, 평범한 말은 그대로", async () => {
  const { cleanChat, filterChat, CHAT } = await import("./data/chat.ts");
  assert.equal(filterChat("안녕 시발 반가워"), "안녕 ** 반가워");
  assert.equal(filterChat("씨.발 ㅅ ㅂ"), "*** ***");
  assert.equal(filterChat("Fuck you"), "**** you");
  assert.equal(filterChat("시발점에서 출발"), "**점에서 출발", "기본 목록은 단순 일치 — 오탐은 목록으로 조정");
  assert.equal(filterChat("던전 같이 가요"), "던전 같이 가요");
  assert.equal(cleanChat("  a\n\nb   c "), "a b c");
  assert.equal(cleanChat("x".repeat(500)).length, CHAT.maxLen);
  assert.equal(cleanChat(42), "");
});
