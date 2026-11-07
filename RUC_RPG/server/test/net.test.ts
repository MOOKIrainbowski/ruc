// 게임 서버를 띄워 실제 웹소켓으로 확인합니다: 접속 · 캐릭터 생성 · 이동 동기화 · 중복 접속 · 위조 티켓
import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFileSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { WebSocket } from "ws";
import { DEV_TICKET_SECRET, signTicket } from "../../../web/rpg/shared/ticket.ts";
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
  ws.on("message", (d) => {
    const m = JSON.parse(String(d)) as S2C;
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
  return { ws, until, send, open, inbox };
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
