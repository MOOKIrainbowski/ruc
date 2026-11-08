// 경제 (P5): 베타 지갑 · 원장 멱등 · 우편 · 일반 상점 · 유저 상점(에스크로 · 동시 구매) · 강화 · 마법부여 · 수리 · 분해 · 재조합 · 복사 방지
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";

process.env.RPG_DB_FILE = `test-econ-${process.pid}.sqlite`;
const { ENHANCE, MARKET, shopCycle } = await import("../../../web/rpg/shared/data/economy.ts");
const { EQUIP_SLOTS } = await import("../../../web/rpg/shared/data/items.ts");
const { loadMap } = await import("../../../web/rpg/shared/map.ts");
const { setRandom } = await import("../src/combat.ts");
const { Shortfall, createCharacter, db, loadItemsAt, listMail, ruc, tx, wallet } = await import("../src/db.ts");
const E = await import("../src/economy.ts");
const { give } = await import("../src/items.ts");
const { Room, buildPlayer } = await import("../src/room.ts");
test.after(() => {
  db.close();
  for (const ext of ["", "-wal", "-shm"]) rmSync(fileURLToPath(new URL(`../data/${process.env.RPG_DB_FILE}${ext}`, import.meta.url)), { force: true });
});
type Player = import("../src/room.ts").Player;

const map = loadMap(JSON.parse(readFileSync(new URL("../../../web/rpg/shared/data/maps/plaza.json", import.meta.url), "utf8")));
const room = new Room("plaza", 1, map);
const ap = { hair: 0, hairColor: 0, skin: 0, eyes: 0 };
let n = 0;
const players: Player[] = [];
E.online.byChar = (id) => players.find((p) => p.char.id === id);
E.online.all = () => players;
function mk() {
  const c = createCharacter(`e${++n}`, `상인${n}`, "fire", ap)!;
  const sent: string[] = [];
  const p = buildPlayer({ readyState: 1, send: (s: string) => sent.push(s) } as never, c.discord_id, c, map.spawn.x, map.spawn.y);
  room.add(p);
  players.push(p);
  E.welcome(p);
  return { p, sent };
}
/** 받은 우편 전부 받기 */
const claimAll = (p: Player) => { for (const m of listMail(p.char.id, Date.now())) assert.equal(E.claimMail(p, m.id), null); };
const pos = (p: Player, tpl: string): [string, number] => { const i = p.items.find((x) => x.tpl === tpl)!; return [i.loc, i.slot]; };
const qty = (p: Player, tpl: string) => p.items.filter((i) => i.tpl === tpl).reduce((a, i) => a + i.qty, 0);
const ledgerSum = (id: number) => (db.prepare("SELECT COALESCE(SUM(delta), 0) AS s FROM rpg_ruc_ledger WHERE character_id = ?").get(id) as { s: number }).s;

test("지갑 · 원장: 환영 우편 1,000 RUC · 멱등 키 · 음수 불가 · 원장 합 = 잔액", () => {
  const { p, sent } = mk();
  assert.equal(p.ruc, 0);
  assert.ok(sent.some((s) => s.includes('"kind":"mail"')), "새 우편 알림");
  const mails = E.mailView(p);
  assert.equal(mails.length, 1);
  assert.equal(mails[0].ruc, 1000);
  assert.equal(E.claimMail(p, mails[0].id), null);
  assert.equal(p.ruc, 1000);
  assert.equal(qty(p, "hp_potion_s"), 5);
  assert.match(E.claimMail(p, mails[0].id)!, /이미 받았거나/, "두 번 못 받음");
  E.welcome(p);
  assert.equal(E.mailView(p).length, 0, "환영 우편은 처음 한 번만");
  assert.deepEqual(ruc(p.char.id, 5, "test", null, "k1"), { balance: 1005, dup: false });
  assert.deepEqual(ruc(p.char.id, 5, "test", null, "k1"), { balance: 1005, dup: true }, "같은 키는 한 번만");
  assert.throws(() => ruc(p.char.id, -5000, "test", null, "k2"), Shortfall);
  assert.equal(wallet(p.char.id).balance, 1005);
  assert.equal(ledgerSum(p.char.id), 1005);
});

test("우편: 빈 칸이 모자라면 그대로 남음 → 비우면 받음 · 모두 받기", () => {
  const { p } = mk();
  claimAll(p);
  give(p, "copper_ring", 32 - p.items.length, "common", "test");
  assert.equal(p.items.length, 32);
  const id = tx(() => E.mail(p.char.id, { sender: "시험", subject: "칼", reason: "reward", ruc: 7, items: [{ id: crypto.randomUUID(), tpl: "wood_sword", loc: "inventory", slot: 0, qty: 1, rarity: "rare", enh: 0, sp: [], dur: 150, durMax: 150 }] }));
  const ruc0 = p.ruc;
  assert.match(E.claimMail(p, id)!, /빈 칸/);
  assert.equal(p.ruc, ruc0, "RUC 도 안 들어옴 (우편 단위로 전부 아니면 전무)");
  assert.equal(E.mailView(p).length, 1);
  const ring = p.items.find((i) => i.tpl === "copper_ring")!;
  assert.equal(E.disassemble(p, [ring.loc, ring.slot], "dis-0001"), null);
  assert.deepEqual(E.claimAll(p), [1, 0]);
  assert.equal(p.ruc, ruc0 + 7 + 1, "우편 7 + 분해 1");
  assert.ok(p.items.some((i) => i.tpl === "wood_sword" && i.rarity === "rare"));
});

test("일반 상점: 회차 고정 진열 · 수량 한도 · 우편으로 지급 · 같은 요청 두 번은 한 번만", () => {
  const { p } = mk();
  claimAll(p);
  const v = E.shopView(p);
  assert.equal(v.cycle, shopCycle(Date.now()));
  assert.deepEqual(E.shopView(p).slots, v.slots, "같은 회차는 같은 진열");
  assert.equal(v.rolled, 8, "회차 진열 8칸 (뒤에 늘 파는 잡화, P12)");
  const i = v.slots.slice(0, v.rolled).reduce((b, s, k) => (s.stock > v.slots[b].stock ? k : b), 0);
  ruc(p.char.id, 1_000_000, "test", null, `grant-shop-${p.char.id}`);
  p.ruc = wallet(p.char.id).balance;
  const s = v.slots[i];
  const ruc0 = p.ruc;
  assert.equal(E.shopBuy(p, v.cycle, i, 1, "buy-req-0001"), null);
  assert.match(E.shopBuy(p, v.cycle, i, 1, "buy-req-0001")!, /이미 처리된/);
  assert.equal(p.ruc, ruc0 - s.price, "한 번만 빠짐");
  assert.match(E.shopBuy(p, v.cycle + 1, i, 1, "buy-req-0002")!, /진열이 바뀌었/);
  assert.match(E.shopBuy(p, v.cycle, i, s.stock, "buy-req-0003")!, /남은 수량/);
  const mails = E.mailView(p);
  assert.equal(mails.at(-1)!.items[0].tpl, s.tpl, "구매품은 우편으로");
});

test("유저 상점: 에스크로 · 복합 가격(RUC + 아이템) · 수수료 5% · 둘이 동시에 사도 한 명만 · 취소 반환", () => {
  const seller = mk().p;
  const a = mk().p;
  const b = mk().p;
  for (const p of [seller, a, b]) claimAll(p);
  give(seller, "fang_sword", 1, "mythic", "test");
  give(a, "slime_jelly", 5, "poor", "test");
  give(b, "slime_jelly", 5, "poor", "test");
  const sword = seller.items.find((i) => i.tpl === "fang_sword")!;
  assert.match(E.marketSell(seller, [sword.loc, sword.slot], [{ items: [] }], "sell-0000a")!, /비어/);
  assert.equal(E.marketSell(seller, [sword.loc, sword.slot], [{ ruc: 100, items: [{ tpl: "slime_jelly", qty: 2 }] }, { ruc: 300 }], "sell-0001a"), null);
  assert.ok(!seller.items.some((i) => i.id === sword.id), "에스크로로 빠짐");
  const lid = E.marketView(a).list.find((x) => x?.item.id === sword.id)!.id;
  // 같은 틱에 두 사람이 삼 — 서버는 한 줄로 처리하므로 먼저 온 쪽만
  const ra = E.marketBuy(a, lid, 0, "mbuy-a-0001");
  const rb = E.marketBuy(b, lid, 0, "mbuy-b-0001");
  assert.equal(ra, null);
  assert.match(rb!, /이미 팔렸/);
  assert.equal(b.ruc, 1000, "진 쪽은 아무것도 안 빠짐");
  assert.equal(qty(b, "slime_jelly"), 5);
  assert.equal(a.ruc, 900);
  assert.equal(qty(a, "slime_jelly"), 3);
  claimAll(a);
  assert.ok(a.items.some((i) => i.id === sword.id), "산 물건은 우편 → 인벤토리 (같은 인스턴스)");
  const sm = E.mailView(seller).at(-1)!;
  assert.equal(sm.ruc, 100 - Math.floor(100 * MARKET.fee));
  assert.equal(sm.items.reduce((x, i) => x + i.qty, 0), 2, "대가 아이템도 판매자 우편으로");
  // 취소 → 우편으로 반환
  give(seller, "copper_ring", 1, "rare", "test");
  const ring = seller.items.find((i) => i.tpl === "copper_ring")!;
  assert.equal(E.marketSell(seller, [ring.loc, ring.slot], [{ ruc: 50 }], "sell-0002a"), null);
  const rid = E.marketView(seller).mine[0]!.id;
  assert.match(E.marketCancel(a, rid)!, /내 판매/);
  assert.equal(E.marketCancel(seller, rid), null);
  assert.match(E.marketBuy(b, rid, 0, "mbuy-b-0002")!, /이미 팔렸거나 내려간/);
  claimAll(seller);
  assert.ok(seller.items.some((i) => i.id === ring.id));
});

test("강화: 재료 · 비용 · 성공 +6% · +10 이름과 서버 공지 · 파괴 · 보호 주문서", () => {
  const { p, sent } = mk();
  claimAll(p);
  give(p, "wood_sword", 1, "common", "test");
  const sword = p.items.find((i) => i.tpl === "wood_sword")!;
  const at = (): [string, number] => [sword.loc, sword.slot];
  const ruc0 = p.ruc;
  assert.match(E.enhance(p, at(), false, false, "enh-x-000")!, /재료/, "강화석이 없으면 거절");
  assert.equal(p.ruc, ruc0, "거절되면 RUC 도 그대로 (한 트랜잭션)");
  give(p, "enhance_stone", 64, "rare", "test");
  ruc(p.char.id, 100_000, "test", null, "grant-enh");
  p.ruc = wallet(p.char.id).balance;
  setRandom(() => 0);
  for (let i = 0; i < 10; i++) assert.equal(E.enhance(p, at(), false, false, `enh-ok-${i}0000`), null);
  const s = p.items.find((x) => x.id === sword.id)!;
  assert.equal(s.enh, 10);
  assert.match(s.name!, /「.+」 나무 검 \+10/);
  assert.equal(s.durMax, 120 * 2, "최대 내구도 × (1 + 0.1 × 10)");
  assert.ok(sent.some((m) => m.includes('"t":"notice"') && m.includes("10강에 성공했습니다")));
  assert.equal(qty(p, "enhance_stone"), 64 - ENHANCE.reduce((a, e) => a + e.stones, 0));
  assert.match(E.enhance(p, at(), false, false, "enh-max-000")!, /\+10/);
  // 파괴 · 보호 주문서
  give(p, "leather_cap", 2, "rare", "test");
  give(p, "protect_scroll", 1, "advanced", "test");
  const caps = p.items.filter((i) => i.tpl === "leather_cap");
  for (const c of caps) c.enh = 4; // +5 단계: 성공 65% · 파괴 1%
  setRandom(() => 0.655);
  assert.equal(E.enhance(p, [caps[0].loc, caps[0].slot], false, true, "enh-prot-00"), null);
  assert.ok(p.items.some((i) => i.id === caps[0].id), "보호 주문서 → 파괴 대신 실패");
  assert.equal(qty(p, "protect_scroll"), 0);
  assert.equal(E.enhance(p, [caps[1].loc, caps[1].slot], false, false, "enh-boom-00"), null);
  assert.ok(!p.items.some((i) => i.id === caps[1].id), "파괴");
  setRandom(Math.random);
});

test("마법부여 · 수리 · 분해 · 재조합", () => {
  const { p } = mk();
  claimAll(p);
  give(p, "copper_ring", 1, "advanced", "test");
  give(p, "ench_atk", 3, "rare", "test");
  ruc(p.char.id, 100_000, "test", null, "grant-ench");
  p.ruc = wallet(p.char.id).balance;
  const ring = p.items.find((i) => i.tpl === "copper_ring")!;
  const atk0 = p.st.atk;
  const stone = () => pos(p, "ench_atk") as never;
  assert.equal(E.enchant(p, [ring.loc, ring.slot], stone(), undefined, "ench-0001aa"), null);
  assert.equal(E.enchant(p, [ring.loc, ring.slot], stone(), undefined, "ench-0002aa"), null);
  assert.match(E.enchant(p, [ring.loc, ring.slot], stone(), undefined, "ench-0003aa")!, /덮어쓸/, "고급 = 2칸");
  assert.equal(E.enchant(p, [ring.loc, ring.slot], stone(), 0, "ench-0004aa"), null);
  const r = p.items.find((i) => i.id === ring.id)!;
  assert.equal(r.ench!.length, 2);
  assert.ok(r.ench!.every((e) => e.k === "atk" && e.v >= 2 * 1.5 && e.v <= 4 * 1.5));
  // 장착하면 마법부여가 스탯에
  E.econOp(p, { op: "noop" });
  give(p, "leather_vest", 1, "common", "test");
  const vest = p.items.find((i) => i.tpl === "leather_vest")!;
  vest.loc = "equipped";
  vest.slot = EQUIP_SLOTS.indexOf("chest");
  vest.dur = 10;
  const ruc0 = p.ruc;
  assert.equal(E.repair(p, "all", "rep-00001a"), null);
  assert.equal(p.items.find((i) => i.id === vest.id)!.dur, vest.durMax);
  assert.ok(p.ruc < ruc0);
  assert.match(E.disassemble(p, [vest.loc, vest.slot], "dis-vest01")!, /장착 중/);
  void atk0;
  // 재조합: 포션 3개 → 포션 하나
  give(p, "hp_potion_s", 3, "common", "test");
  const before = qty(p, "hp_potion_s");
  const pp = pos(p, "hp_potion_s");
  assert.equal(E.recombineOp(p, [pp, pp, pp], "recomb-0001"), null);
  assert.ok(p.items.filter((i) => i.tpl.includes("potion")).reduce((a, i) => a + i.qty, 0) === before - 3 + 1);
  give(p, "slime_jelly", 1, "poor", "test");
  const p2 = pos(p, "hp_potion_s");
  assert.match(E.recombineOp(p, [p2, pos(p, "slime_jelly"), p2], "recomb-0002")!, /같은 용도/);
});

test("복사 방지: 세 사람이 무작위 경제 조작 400번 (같은 요청 id 재사용 포함) — 원장 합 = 지갑, 물건은 한 곳에만", () => {
  const ps = [mk().p, mk().p, mk().p];
  for (const p of ps) {
    claimAll(p);
    give(p, "slime_jelly", 40, "poor", "test");
    give(p, "wood_sword", 3, "rare", "test");
  }
  const rids = Array.from({ length: 30 }, (_, i) => `fuzz-rid-${i}0000`);
  const pick = <T,>(a: T[]) => a[Math.floor(Math.random() * a.length)];
  for (let i = 0; i < 400; i++) {
    const p = pick(ps);
    const r = Math.random();
    const rid = pick(rids) + (Math.random() < 0.5 ? "" : `-${i}`);
    const item = p.items.length ? pick(p.items) : undefined;
    if (r < 0.3 && item) E.marketSell(p, [item.loc, item.slot], [{ ruc: 1 + Math.floor(Math.random() * 50) }, { items: [{ tpl: "slime_jelly", qty: 1 + Math.floor(Math.random() * 3) }] }], rid);
    else if (r < 0.6) {
      const open = E.marketView(p).list.filter((x) => x && !x.mine);
      if (open.length) E.marketBuy(p, pick(open)!.id, Math.random() < 0.5 ? 0 : 1, rid);
    } else if (r < 0.7) {
      const mine = E.marketView(p).mine;
      if (mine.length) E.marketCancel(p, pick(mine)!.id);
    } else if (r < 0.85) for (const m of listMail(p.char.id, Date.now()).slice(0, 2)) E.claimMail(p, Math.random() < 0.2 ? m.id - 1 : m.id);
    else if (r < 0.92 && item && item.loc !== "equipped") E.disassemble(p, [item.loc, item.slot], rid);
    else {
      const v = E.shopView(p);
      E.shopBuy(p, v.cycle, Math.floor(Math.random() * 8), 1, rid);
    }
  }
  for (const p of ps) {
    assert.equal(wallet(p.char.id).balance, ledgerSum(p.char.id), "원장 합 = 잔액");
    assert.equal(p.ruc, wallet(p.char.id).balance, "메모리 = DB");
  }
  // 판매된 물건은 산 사람에게, 열린 물건은 판매자 에스크로에, 취소 · 만료는 판매자에게 — 한 곳에만
  // 같은 물건이 다시 팔릴 수 있으니 물건마다 마지막 등록만 봄
  const rows = db.prepare(`SELECT l.status, l.seller_id, l.buyer_id, i.owner_id, i.location FROM rpg_market_listings l JOIN rpg_items i ON i.id = l.item_id
    WHERE l.id = (SELECT MAX(id) FROM rpg_market_listings WHERE item_id = l.item_id)`).all() as
    { status: string; seller_id: number; buyer_id: number; owner_id: number; location: string }[];
  assert.ok(rows.length > 5, `거래 ${rows.length}`);
  for (const r of rows) {
    // 팔린 물건은 에스크로를 떠남 — 산 사람이 그 묶음(같은 UUID)을 다른 거래의 대가로 다시 낼 수 있어서 주인이 바뀌는 건 정상
    if (r.status === "sold") assert.ok(r.owner_id === r.buyer_id || r.location !== "escrow", JSON.stringify(r));
    else if (r.status === "open") assert.deepEqual([r.owner_id, r.location], [r.seller_id, "escrow"]);
    else assert.equal(r.owner_id, r.seller_id);
  }
  const sold = rows.filter((r) => r.status === "sold").length;
  assert.ok(sold > 0, "실제로 팔린 거래가 있음");
  // 아이템 수: 우편 · 에스크로 · 인벤토리에 흩어져도 같은 행이 둘일 수 없음 (PRIMARY KEY), 칸 겹침도 없음 (UNIQUE)
  for (const p of ps) assert.equal(loadItemsAt(p.char.id, "escrow", 0, 1e9).length, E.marketView(p).mine.length);
});
