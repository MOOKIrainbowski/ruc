// 게임 서버를 띄워 실제 웹소켓으로 확인합니다: 접속 · 캐릭터 생성 · 이동 동기화 · 중복 접속 · 위조 티켓
import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFileSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { WebSocket } from "ws";
import { DEV_TICKET_SECRET, signTicket } from "../../../web/rpg/shared/ticket.ts";
import { decodeSnapshot } from "../../../web/rpg/shared/snapshot.ts";
import type { EntityRow } from "../../../web/rpg/shared/protocol.ts";
import type { S2C } from "../../../web/rpg/shared/protocol.ts";
import { loadMap, prop, type TiledMap } from "../../../web/rpg/shared/map.ts";
import { baseStats } from "../../../web/rpg/shared/character.ts";
import { finalStats } from "../../../web/rpg/shared/combat.ts";
import { ELEMENTS } from "../../../web/rpg/shared/data/elements.ts";

const PORT = 25000 + Math.floor(Math.random() * 1000);
const DB = `test-${PORT}.sqlite`;
const server = spawn(process.execPath, ["src/main.ts", "--dev"], {
  cwd: fileURLToPath(new URL("..", import.meta.url)),
  env: { ...process.env, PORT: String(PORT), RPG_DB_FILE: DB },
  stdio: ["ignore", "pipe", "inherit"],
});
await new Promise<void>((ok) => server.stdout!.on("data", (d) => String(d).includes("ws://") && ok()));

test.after(async () => {
  const exited = new Promise((ok) => server.on("exit", ok));
  server.kill();
  await exited;
  for (const ext of ["", "-wal", "-shm"]) rmSync(fileURLToPath(new URL(`../data/${DB}${ext}`, import.meta.url)), { force: true });
});

function client(sub: string, secret = DEV_TICKET_SECRET) {
  const ws = new WebSocket(`ws://localhost:${PORT}`);
  const inbox: S2C[] = [];
  const waiters: [(m: S2C) => boolean, (m: S2C) => void][] = [];
  const rows = new Map<number, EntityRow>(); // 스냅샷 델타 기준 (D71)
  ws.on("message", (d, bin) => {
    const m = (bin ? decodeSnapshot(d as Buffer, rows) : JSON.parse(String(d))) as S2C;
    if (m.t === "joined") rows.clear();
    inbox.push(m);
    for (const w of [...waiters]) if (w[0](m)) { waiters.splice(waiters.indexOf(w), 1); w[1](m); }
  });
  const until = <T extends S2C>(pred: (m: S2C) => boolean, ms = 3000) =>
    new Promise<T>((ok, fail) => {
      const hit = inbox.find(pred);
      if (hit) return ok(hit as T);
      waiters.push([pred, ok as (m: S2C) => void]);
      setTimeout(() => fail(new Error("시간 초과")), ms);
    });
  const send = (m: object) => ws.send(JSON.stringify(m));
  const open = new Promise((ok) => ws.on("open", ok)).then(() => send({ t: "hello", ticket: signTicket({ sub, name: sub, avatar: null }, secret) }));
  return { ws, until, send, open, inbox, rows };
}

const ap = { hair: 0, hairColor: 0, skin: 0, eyes: 0 };

test("두 명이 접속해 서로의 이동을 봄", async () => {
  const a = client("A");
  const b = client("B");
  await Promise.all([a.open, b.open]);
  await a.until((m) => m.t === "needCreate");
  a.send({ t: "create", nickname: "x", appearance: ap, element: "fire" });
  assert.equal((await a.until<Extract<S2C, { t: "createError" }>>((m) => m.t === "createError")).t, "createError");
  a.send({ t: "create", nickname: "알파", appearance: ap, element: "fire" });
  const ja = await a.until<Extract<S2C, { t: "joined" }>>((m) => m.t === "joined");
  await b.until((m) => m.t === "needCreate");
  b.send({ t: "create", nickname: "알파", appearance: ap, element: "ice" });
  await b.until((m) => m.t === "createError" && m.msg.includes("이미"));
  b.send({ t: "create", nickname: "베타", appearance: ap, element: "ice" });
  const jb = await b.until<Extract<S2C, { t: "joined" }>>((m) => m.t === "joined");
  assert.deepEqual(jb.ents.map((p) => p.name), ["알파"]);
  await a.until((m) => m.t === "spawn" && m.e.name === "베타");

  // A 가 오른쪽으로 30스텝 (0.5초) → B 의 스냅샷에서 A 가 약 32px 이동
  for (let i = 0; i < 30; i++) a.send({ t: "in", seq: i, mx: 1, my: 0, run: false });
  const s = await b.until<Extract<S2C, { t: "s" }>>((m) => m.t === "s" && m.e.some((r) => r[0] === ja.you.id && r[1] >= Math.round(ja.me.x) + 31));
  const row = s.e.find((r) => r[0] === ja.you.id)!;
  assert.ok(row[3] === 2 && row[1] - ja.me.x < 33, JSON.stringify(row)); // 동쪽, 과속 없음
  const ack = await a.until<Extract<S2C, { t: "s" }>>((m) => m.t === "s" && m.ack.seq === 29);
  assert.ok(Math.abs(ack.ack.m.x - ja.me.x - 32) < 0.01);

  // 같은 계정으로 다시 접속 → 이전 연결 끊김
  const a2 = client("A");
  await a2.open;
  await a.until((m) => m.t === "kicked" && m.reason === "dup");
  await a2.until((m) => m.t === "joined");
  a2.ws.close();
  b.ws.close();
});

test("위조 티켓은 끊김", async () => {
  const c = client("C", "wrong-secret");
  await c.open;
  await c.until((m) => m.t === "kicked" && m.reason === "auth");
});

test("광장은 안전지대 → 포털로 필드 이동 → 마력 화살 발사", async () => {
  const c = client("D");
  await c.open;
  await c.until((m) => m.t === "needCreate");
  c.send({ t: "create", nickname: "델타", appearance: ap, element: "water" });
  await c.until((m) => m.t === "joined");
  c.send({ t: "in", seq: 0, mx: 0, my: 0, run: false, k: "Q", ax: 0, ay: 0 });
  const cf = await c.until<Extract<S2C, { t: "s" }>>((m) => m.t === "s" && !!m.pe?.some((e) => e[0] === "cf"));
  assert.match(String(cf.pe!.find((e) => e[0] === "cf")![2]), /안전지대/);

  const plaza = loadMap(JSON.parse(readFileSync(new URL("../../../web/rpg/shared/data/maps/plaza.json", import.meta.url), "utf8")) as TiledMap);
  const portal = plaza.objects.find((o) => o.type === "portal" && prop(o, "target") === "field")!;
  c.send({ t: "use", oid: portal.id });
  await c.until((m) => m.t === "error" && m.msg.includes("가까이"));
  c.send({ t: "dev", map: "plaza", x: portal.x, y: portal.y - 8 });
  await c.until((m) => m.t === "joined" && m.room.kind === "plaza" && Math.abs(m.me.y - portal.y + 8) < 1);
  c.send({ t: "use", oid: portal.id });
  const jf = await c.until<Extract<S2C, { t: "joined" }>>((m) => m.t === "joined" && m.room.kind === "field");
  assert.ok(jf.ents.some((e) => e.mob === "slime"), "필드에 슬라임");
  c.send({ t: "in", seq: 1, mx: 0, my: 0, run: false, k: "Q", ax: Math.round(jf.me.x), ay: Math.round(jf.me.y) + 100 });
  const s = await c.until<Extract<S2C, { t: "s" }>>((m) => m.t === "s" && !!m.ev?.some((e) => e[0] === "p" && e[2] === jf.you.id));
  const p = s.ev!.find((e) => e[0] === "p")!;
  assert.equal(p[3], "magic_arrow");
  assert.equal(p[10], 1, "예측과 맞출 입력 seq");
  // 같은 맵 안 이동: 같은 채널에 남고 스냅샷(몹 포함)이 계속 옴
  c.send({ t: "dev", map: "field", x: Math.round(jf.me.x), y: Math.round(jf.me.y) + 32 });
  const j2 = await c.until<Extract<S2C, { t: "joined" }>>((m) => m.t === "joined" && m.room.kind === "field" && m !== jf);
  assert.equal(j2.room.ch, jf.room.ch);
  const mobIds = new Set(j2.ents.filter((e) => e.mob).map((e) => e.id));
  const n = c.inbox.length;
  await c.until((m) => c.inbox.indexOf(m) >= n && m.t === "s" && m.e.some((r) => mobIds.has(r[0])));
  c.ws.close();
});

test("아이템: 지급 → 장착(평타 · 스탯 · 옷 색) → 창고 보관(광장만) → 다시 접속해도 그대로", async () => {
  const c = client("E");
  await c.open;
  await c.until((m) => m.t === "needCreate");
  c.send({ t: "create", nickname: "에코", appearance: ap, element: "earth" });
  const j = await c.until<Extract<S2C, { t: "joined" }>>((m) => m.t === "joined");
  assert.deepEqual(j.items, []);
  const inv = (pred: (items: Extract<S2C, { t: "inv" }>["items"]) => boolean) => c.until<Extract<S2C, { t: "inv" }>>((m) => m.t === "inv" && pred(m.items));
  c.send({ t: "dev", give: "leather_vest", rarity: "rare" });
  const got = await inv((it) => it.some((i) => i.tpl === "leather_vest"));
  const vest = got.items.find((i) => i.tpl === "leather_vest")!;
  assert.equal(vest.loc, "hotbar");
  c.send({ t: "item", op: "use", a: [vest.loc, vest.slot] });
  await inv((it) => it.some((i) => i.tpl === "leather_vest" && i.loc === "equipped"));
  const st = await c.until<Extract<S2C, { t: "stats" }>>((m) => m.t === "stats" && m.s.pdef > j.stats.pdef);
  const pdef = finalStats(baseStats(1), [...ELEMENTS.earth.mods, { k: "pdef", add: 5 * 1.25 }]).pdef; // 희귀 = 스탯 ×1.25, 흙 패시브 배율까지
  assert.equal(st.s.pdef, pdef);
  await c.until((m) => m.t === "s" && !!m.ev?.some((e) => e[0] === "eq" && e[1] === j.you.id && (e[2] as string[])[0] === "leather_vest"));
  c.send({ t: "dev", give: "hp_potion_s", n: 5 });
  const p = (await inv((it) => it.some((i) => i.tpl === "hp_potion_s"))).items.find((i) => i.tpl === "hp_potion_s")!;
  c.send({ t: "item", op: "move", a: [p.loc, p.slot], b: ["storage", -1], n: 2 });
  await inv((it) => it.some((i) => i.loc === "storage" && i.qty === 2) && it.some((i) => i.tpl === "hp_potion_s" && i.qty === 3));
  // 필드에서는 창고 안 됨
  c.send({ t: "dev", map: "field", x: 736, y: 400 });
  await c.until((m) => m.t === "joined" && m.room.kind === "field");
  c.send({ t: "item", op: "move", a: ["storage", 0], b: ["inventory", -1] });
  await c.until((m) => m.t === "error" && m.msg.includes("광장"));
  c.ws.close();
  // 다시 접속: DB 에서 그대로
  await new Promise((ok) => setTimeout(ok, 100));
  const c2 = client("E");
  await c2.open;
  const j2 = await c2.until<Extract<S2C, { t: "joined" }>>((m) => m.t === "joined");
  assert.ok(j2.items.some((i) => i.tpl === "leather_vest" && i.loc === "equipped"));
  assert.ok(j2.items.some((i) => i.loc === "storage" && i.qty === 2));
  assert.equal(j2.stats.pdef, pdef, "장비 스탯이 접속 때 바로 반영");
  c2.ws.close();
});

test("전직: 교관 근처에서만 → 계열 스킬 · 슬롯 → 필드에서 새 스킬 시전 · 장착 바꾸기", async () => {
  const c = client("F");
  await c.open;
  await c.until((m) => m.t === "needCreate");
  c.send({ t: "create", nickname: "폭스", appearance: ap, element: "wind" });
  const j = await c.until<Extract<S2C, { t: "joined" }>>((m) => m.t === "joined");
  assert.deepEqual(j.you.slots, { A: "punch", Q: "magic_arrow", W: "dash_slash", E: "first_aid" });
  assert.equal(j.you.prog.skills.length, 3);
  c.send({ t: "job", line: "warrior" });
  await c.until((m) => m.t === "error" && m.msg.includes("세라"));
  const plaza = loadMap(JSON.parse(readFileSync(new URL("../../../web/rpg/shared/data/maps/plaza.json", import.meta.url), "utf8")) as TiledMap);
  const sera = plaza.objects.find((o) => o.type === "npc" && prop(o, "npc") === "sera")!;
  c.send({ t: "dev", map: "plaza", x: sera.x, y: sera.y + 20 });
  await c.until((m) => m.t === "joined" && m !== j);
  c.send({ t: "job", line: "warrior" });
  await c.until((m) => m.t === "error" && m.msg.includes("Lv10"));
  c.send({ t: "dev", lv: 12 });
  c.send({ t: "job", line: "warrior" });
  const p = await c.until<Extract<S2C, { t: "prog" }>>((m) => m.t === "prog" && m.prog.line === "warrior");
  assert.deepEqual([p.slots.Q, p.slots.W, p.slots.E, p.slots.R], ["double_slash", "battle_cry", "whirlwind", "sword_storm"]);
  assert.equal(p.prog.pot[0], 10 + 1 + 30 + 1 + 1 + 1 + 3);
  // 장착 바꾸기 (비전투)
  c.send({ t: "equip", skill: "magic_arrow", slot: "Q" });
  await c.until((m) => m.t === "prog" && m.slots.Q === "magic_arrow");
  c.send({ t: "equip", skill: "double_slash", slot: "Q" });
  await c.until((m) => m.t === "prog" && m.slots.Q === "double_slash");
  c.send({ t: "dev", map: "field", x: 736, y: 400 });
  const jf = await c.until<Extract<S2C, { t: "joined" }>>((m) => m.t === "joined" && m.room.kind === "field");
  assert.equal(jf.you.slots.Q, "double_slash");
  c.send({ t: "in", seq: 5000, mx: 0, my: 0, run: false, k: "Q", ax: Math.round(jf.me.x) + 20, ay: Math.round(jf.me.y) });
  await c.until((m) => m.t === "s" && !!m.ev?.some((e) => e[0] === "c" && e[1] === jf.you.id && e[2] === "double_slash"));
  c.ws.close();
});

test("경제 동시 요청: 둘이 같은 물건을 동시에 사면 한 명만 · 같은 우편을 두 번 받아도 한 번만 · 같은 요청 id 는 한 번만", async () => {
  const plaza = loadMap(JSON.parse(readFileSync(new URL("../../../web/rpg/shared/data/maps/plaza.json", import.meta.url), "utf8")) as TiledMap);
  const tent = plaza.objects.find((o) => o.type === "tent_market")!;
  const box = plaza.objects.find((o) => o.type === "mailbox")!;
  const join = async (sub: string, nick: string) => {
    const c = client(sub);
    await c.open;
    await c.until((m) => m.t === "needCreate");
    c.send({ t: "create", nickname: nick, appearance: ap, element: "fire" });
    await c.until((m) => m.t === "joined");
    return c;
  };
  const [g, h, i] = [await join("G", "판매자"), await join("H", "구매자하"), await join("I", "구매자이")];
  const at = (c: Awaited<ReturnType<typeof join>>, o: { x: number; y: number }) => c.send({ t: "dev", map: "plaza", x: o.x, y: o.y + 20 });
  const views = (c: Awaited<ReturnType<typeof join>>, view: string) => c.inbox.filter((m) => m.t === "econ" && m.view === view) as Extract<S2C, { t: "econ" }>[];
  // 판매자: 칼을 받아 유저 상점에 100 RUC 로 올림
  g.send({ t: "dev", give: "wood_sword", rarity: "rare" });
  const inv = await g.until<Extract<S2C, { t: "inv" }>>((m) => m.t === "inv" && m.items.some((x) => x.tpl === "wood_sword"));
  const sword = inv.items.find((x) => x.tpl === "wood_sword")!;
  at(g, tent);
  await g.until((m) => m.t === "joined" && Math.abs(m.me.y - tent.y - 20) < 1);
  g.send({ t: "econ", op: "sell", a: [sword.loc, sword.slot], prices: [{ ruc: 100 }], rid: "sell-req-00000001" });
  g.send({ t: "econ", op: "sell", a: [sword.loc, sword.slot], prices: [{ ruc: 100 }], rid: "sell-req-00000001" }); // 같은 요청이 두 번
  await g.until((m) => m.t === "econ" && m.view === "market" && (m.data as { mine: unknown[] }).mine.length === 1);
  // 구매자 둘: 환영 우편(1,000 RUC)을 받고 천막 앞으로
  for (const c of [h, i]) {
    at(c, box);
    await c.until((m) => m.t === "joined" && Math.abs(m.me.y - box.y - 20) < 1);
    c.send({ t: "econ", op: "mail" });
    const mail = await c.until<Extract<S2C, { t: "econ" }>>((m) => m.t === "econ" && m.view === "mail");
    const id = (mail.data as { id: number }[])[0].id;
    c.send({ t: "econ", op: "claim", id });
    c.send({ t: "econ", op: "claim", id }); // 같은 우편을 바로 또
    await c.until((m) => m.t === "error" && m.msg.includes("이미 받았거나"));
    await c.until((m) => m.t === "ruc" && m.ruc === 1000);
    at(c, tent);
    await c.until((m) => m.t === "joined" && Math.abs(m.me.y - tent.y - 20) < 1);
  }
  h.send({ t: "econ", op: "market" });
  const lid = ((await h.until<Extract<S2C, { t: "econ" }>>((m) => m.t === "econ" && m.view === "market")).data as { list: { id: number }[] }).list[0].id;
  // 동시에 삼
  h.send({ t: "econ", op: "mbuy", id: lid, opt: 0, rid: "buy-h-0000000001" });
  i.send({ t: "econ", op: "mbuy", id: lid, opt: 0, rid: "buy-i-0000000001" });
  await new Promise((ok) => setTimeout(ok, 400));
  const lost = [h, i].filter((c) => c.inbox.some((m) => m.t === "error" && m.msg.includes("이미 팔렸")));
  const won = [h, i].filter((c) => c.inbox.some((m) => m.t === "ruc" && m.ruc === 900));
  assert.equal(lost.length, 1, "한 명은 이미 팔렸다는 안내");
  assert.equal(won.length, 1, "한 명만 100 RUC 를 냄");
  assert.ok(!lost[0].inbox.some((m) => m.t === "ruc" && m.ruc === 900), "진 쪽 지갑은 그대로");
  assert.equal(views(g, "market").length >= 1, true);
  for (const c of [g, h, i]) c.ws.close();
});

test("P7 실제 접속: 파티 초대 알림 → 수락 → 핑 → 파티장이 유적의 문에서 입장 확인 → 둘 다 던전 1스테이지 → 나가기 → 결투장 포털", async () => {
  const plaza = loadMap(JSON.parse(readFileSync(new URL("../../../web/rpg/shared/data/maps/plaza.json", import.meta.url), "utf8")) as TiledMap);
  const join = async (sub: string, nick: string) => {
    const c = client(sub);
    await c.open;
    await c.until((m) => m.t === "needCreate");
    c.send({ t: "create", nickname: nick, appearance: ap, element: "grass" });
    await c.until((m) => m.t === "joined");
    return c;
  };
  const [a, b] = [await join("PA", "파티장"), await join("PB", "파티원")];
  a.send({ t: "party", op: "invite", name: "파티원" });
  const noti = await b.until<Extract<S2C, { t: "noti" }>>((m) => m.t === "noti" && m.n.kind === "party_invite");
  assert.equal(noti.toast, true, "파티 초대는 토스트");
  b.send({ t: "party", op: "accept", id: noti.n.data!.party as number });
  await a.until((m) => m.t === "party" && m.party?.members.length === 2);
  await b.until((m) => m.t === "pv" && m.v.length === 2);
  a.send({ t: "mark", k: "attack", x: 700, y: 900 });
  await b.until((m) => m.t === "mark" && m.k === "attack" && m.from === "파티장");
  // 유적의 문: 파티원이 먼저 쓰면 안내, 파티장은 확인 창
  const gate = plaza.objects.find((o) => o.type === "portal" && prop(o, "target") === "dungeon")!;
  for (const c of [a, b]) {
    c.send({ t: "dev", map: "plaza", x: gate.x, y: gate.y + 12 });
    await c.until((m) => m.t === "joined" && Math.abs(m.me.y - gate.y - 12) < 1);
  }
  b.send({ t: "use", oid: gate.id });
  await b.until((m) => m.t === "error" && m.msg.includes("파티장"));
  a.send({ t: "use", oid: gate.id });
  await a.until((m) => m.t === "ask" && m.kind === "dungeon" && m.members.length === 2);
  a.send({ t: "dungeon", op: "enter" });
  for (const c of [a, b]) {
    const j = await c.until<Extract<S2C, { t: "joined" }>>((m) => m.t === "joined" && m.room.kind === "dungeon");
    assert.equal(j.ents.filter((e) => e.mob === "sprout_slime").length, 12);
    await c.until((m) => m.t === "dg" && m.s?.stage === 1 && m.s.phase === "fight" && m.s.potions === 5);
  }
  b.send({ t: "dungeon", op: "leave" });
  await b.until((m) => m.t === "joined" && m.room.kind === "plaza");
  await b.until((m) => m.t === "dg" && m.s === null);
  // 결투장 포털 (광장 동쪽)
  const arena = plaza.objects.find((o) => o.type === "portal" && prop(o, "target") === "arena")!;
  b.send({ t: "dev", map: "plaza", x: arena.x - 40, y: arena.y - 8 });
  await b.until((m) => m.t === "joined" && Math.abs(m.me.x - arena.x + 40) < 1);
  b.send({ t: "use", oid: arena.id });
  await b.until((m) => m.t === "joined" && m.room.kind === "arena");
  b.send({ t: "who" });
  await b.until((m) => m.t === "who" && m.list.some((w) => w.name === "파티원"));
  a.ws.close();
  b.ws.close();
});


test("P8 핵심 루프 E2E (§4 · §30): 광장 퀘스트 → 우편 → 상점 → 초원 사냥 → 강화 → 파티 → 던전 정화 → 전직 + 채팅 · GM · 버그 제보 · 차단", async () => {
  const plaza = loadMap(JSON.parse(readFileSync(new URL("../../../web/rpg/shared/data/maps/plaza.json", import.meta.url), "utf8")) as TiledMap);
  const obj = (type: string, f: (o: (typeof plaza.objects)[number]) => boolean = () => true) => plaza.objects.find((o) => o.type === type && f(o))!;
  const npc = (id: string) => obj("npc", (o) => prop(o, "npc") === id);
  const join = async (sub: string, nick: string) => {
    const c = client(sub);
    await c.open;
    await c.until((m) => m.t === "needCreate");
    c.send({ t: "create", nickname: nick, appearance: ap, element: "fire" });
    await c.until((m) => m.t === "joined");
    return c;
  };
  type C = Awaited<ReturnType<typeof join>>;
  const goTo = async (c: C, o: { x: number; y: number }, dy = 20) => {
    const n = c.inbox.length;
    c.send({ t: "dev", map: "plaza", x: o.x, y: o.y + dy });
    await c.until((m) => c.inbox.indexOf(m) >= n && m.t === "joined");
  };
  const a = await join("LOOP-A", "루프");
  // ① 광장: 루미에게 말 걸기 → 튜토리얼 다음 단계
  await goTo(a, npc("lumi"));
  a.send({ t: "use", oid: npc("lumi").id });
  await a.until((m) => m.t === "qs" && m.active.some((q) => q.id === "tut_fountain"));
  // ② 우편: 환영 선물(1,000 RUC)
  await goTo(a, obj("mailbox"));
  a.send({ t: "econ", op: "mail" });
  const mail = await a.until<Extract<S2C, { t: "econ" }>>((m) => m.t === "econ" && m.view === "mail");
  a.send({ t: "econ", op: "claim", id: (mail.data as { id: number }[])[0].id });
  await a.until((m) => m.t === "ruc" && m.ruc === 1000);
  // ③ 일반 상점에서 하나 사기 → RUC 줄고 우편으로
  await goTo(a, obj("tent_shop"));
  a.send({ t: "econ", op: "shop" });
  const shop = await a.until<Extract<S2C, { t: "econ" }>>((m) => m.t === "econ" && m.view === "shop");
  const sd = shop.data as { cycle: number; slots: { price: number; left: number }[] };
  const cheap = sd.slots.map((x, i) => [x, i] as const).filter(([x]) => x.left > 0).sort((p, q) => p[0].price - q[0].price)[0];
  a.send({ t: "econ", op: "buy", cycle: sd.cycle, id: cheap[1], n: 1, rid: "loop-buy-000001" });
  await a.until((m) => m.t === "ruc" && m.ruc === 1000 - cheap[0].price);
  // ④ 초원: 포털 → 슬라임을 실제 입력(평타)으로 잡아 경험치
  const fieldGate = obj("portal", (o) => prop(o, "target") === "field");
  await goTo(a, fieldGate, -8);
  a.send({ t: "use", oid: fieldGate.id });
  const jf = await a.until<Extract<S2C, { t: "joined" }>>((m) => m.t === "joined" && m.room.kind === "field");
  const slime = jf.ents.find((e) => e.mob === "slime")!;
  let seq = 10_000;
  const n0 = a.inbox.length;
  const died = () => a.inbox.slice(n0).some((m) => m.t === "s" && !!m.ev?.some((e) => e[0] === "d" && e[1] === slime.id));
  for (let i = 0; i < 600 && !died(); i++) {
    const r = a.rows.get(slime.id);
    if (r && i % 20 === 0) { a.send({ t: "dev", map: "field", x: r[1] - 14, y: r[2] }); await a.until((m) => m.t === "joined" && a.inbox.indexOf(m) > n0); }
    if (r) a.send({ t: "in", seq: seq++, mx: 0, my: 0, run: false, k: "A", ax: r[1], ay: r[2] });
    await new Promise((ok) => setTimeout(ok, 30));
  }
  assert.ok(died(), "그 슬라임이 쓰러짐");
  await a.until((m) => a.inbox.indexOf(m) > n0 && m.t === "s" && !!m.pe?.some((e) => e[0] === "xp" && (e[1] as number) > 0));
  // ⑤ 광장 강화대: +1 강화
  a.send({ t: "dev", give: "wood_sword", rarity: "common" });
  a.send({ t: "dev", give: "enhance_stone", n: 10 });
  const inv = await a.until<Extract<S2C, { t: "inv" }>>((m) => m.t === "inv" && m.items.some((x) => x.tpl === "enhance_stone"));
  const sword = inv.items.find((x) => x.tpl === "wood_sword")!;
  await goTo(a, obj("anvil"));
  a.send({ t: "econ", op: "enhance", a: [sword.loc, sword.slot], rid: "loop-enh-0000001" });
  await a.until((m) => m.t === "econ" && m.view === "enhanced");
  // ⑥ 채팅: 같은 방 · 욕설은 가려짐 / GM 명령은 GM 만
  const b = await join("LOOP-B", "루프동료");
  await goTo(b, obj("anvil"));
  a.send({ t: "chat", text: "안녕 시발 반가워" });
  await b.until((m) => m.t === "chat" && m.from === "루프" && m.text === "안녕 ** 반가워");
  a.send({ t: "chat", text: "/gm announce 해킹" });
  await a.until((m) => m.t === "error" && m.msg.includes("GM 만"));
  // ⑦ 파티 → 유적 1스테이지 정화(개발용 정리) → 정비
  a.send({ t: "party", op: "invite", name: "루프동료" });
  const inviteN = await b.until<Extract<S2C, { t: "noti" }>>((m) => m.t === "noti" && m.n.kind === "party_invite");
  b.send({ t: "party", op: "accept", id: inviteN.n.data!.party as number });
  await a.until((m) => m.t === "party" && m.party?.members.length === 2);
  const gate = obj("portal", (o) => prop(o, "target") === "dungeon");
  await goTo(a, gate, 12);
  await goTo(b, gate, 12);
  a.send({ t: "dungeon", op: "enter" });
  await b.until((m) => m.t === "joined" && m.room.kind === "dungeon");
  await a.until((m) => m.t === "dg" && m.s?.stage === 1);
  a.send({ t: "dev", stage: 1 });
  await a.until((m) => m.t === "dg" && m.s?.phase === "rest");
  await a.until((m) => m.t === "chat" && m.ch === "party" || (m.t === "s" && !!m.ev?.some((e) => e[0] === "ann")), 2000).catch(() => null);
  a.send({ t: "dungeon", op: "leave" });
  await a.until((m) => m.t === "joined" && m.room.kind === "plaza" && a.inbox.indexOf(m) > a.inbox.findIndex((x) => x.t === "dg" && x.s?.phase === "rest"));
  // ⑧ Lv10 → 세라에게 1차 전직
  a.send({ t: "dev", lv: 10 });
  await goTo(a, npc("sera"));
  a.send({ t: "job", line: "warrior" });
  await a.until((m) => m.t === "prog" && m.prog.line === "warrior");
  // ⑨ GM(개발 모드 dev- 계정): 공지 · 채팅 금지 · 차단 → 다시 접속 못 함, 버그 제보는 DB 로
  const gm = await join("dev-loopgm", "루프지엠");
  const j = gm.inbox.find((m) => m.t === "joined") as Extract<S2C, { t: "joined" }>;
  assert.equal(j.you.gm, true);
  gm.send({ t: "chat", text: "/gm announce 곧 점검" });
  await a.until((m) => m.t === "notice" && m.text.includes("곧 점검"));
  gm.send({ t: "chat", text: "/gm mute 루프동료 5 도배" });
  await b.until((m) => m.t === "chat" && m.ch === "system" && m.text.includes("금지"));
  b.send({ t: "chat", text: "말해 볼까" });
  await b.until((m) => m.t === "error" && m.msg.includes("채팅 금지"));
  gm.send({ t: "bug", text: "테스트 제보입니다", log: ["[error] x"] });
  await gm.until((m) => m.t === "chat" && m.text.includes("버그 제보 #"));
  gm.send({ t: "gm" });
  const panel = await gm.until<Extract<S2C, { t: "gm" }>>((m) => m.t === "gm" && !!m.players);
  assert.ok(panel.players!.some((p) => p.name === "루프동료" && p.muted) && panel.bugs!.some((x) => x.text === "테스트 제보입니다"));
  gm.send({ t: "chat", text: "/gm ban 루프동료 1 테스트" });
  await b.until((m) => m.t === "kicked" && m.reason === "banned");
  const b2 = client("LOOP-B");
  await b2.open;
  await b2.until((m) => m.t === "kicked" && m.reason === "banned");
  for (const c of [a, gm]) c.ws.close();
});

test("P17 실제 접속: 영약을 마시고 나갔다 다시 들어와도 남은 시간째 이어짐 (D103)", async () => {
  const c = client("ELIXIR-A");
  await c.open;
  await c.until((m) => m.t === "needCreate");
  c.send({ t: "create", nickname: "영약시험", appearance: ap, element: "fire" });
  const j = await c.until<Extract<S2C, { t: "joined" }>>((m) => m.t === "joined");
  c.send({ t: "dev", give: "elixir_power" });
  const inv = await c.until<Extract<S2C, { t: "inv" }>>((m) => m.t === "inv" && m.items.some((i) => i.tpl === "elixir_power"));
  const it = inv.items.find((i) => i.tpl === "elixir_power")!;
  c.send({ t: "item", op: "use", a: [it.loc, it.slot] });
  await c.until((m) => m.t === "s" && !!m.ev?.some((e) => e[0] === "f" && e[1] === j.you.id && (e[2] as unknown as [string][]).some((r) => r[0] === "elixir_power")));
  c.ws.close();
  await new Promise((r) => setTimeout(r, 400));
  const d = client("ELIXIR-A");
  await d.open;
  await d.until((m) => m.t === "joined");
  const back = await d.until((m) => m.t === "s" && !!m.ev?.some((e) => e[0] === "f" && (e[2] as unknown as [string, number][]).some((r) => r[0] === "elixir_power" && r[1] > 1_700_000)));
  assert.ok(back, "다시 접속해도 30분 영약이 남아 있음");
  d.ws.close();
});
