// 게임 서버를 띄워 실제 웹소켓으로 확인합니다: 접속 · 캐릭터 생성 · 이동 동기화 · 중복 접속 · 위조 티켓
import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { WebSocket } from "ws";
import { DEV_TICKET_SECRET, signTicket } from "../../../web/rpg/shared/ticket.ts";
import type { S2C } from "../../../web/rpg/shared/protocol.ts";

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
  assert.deepEqual(jb.players.map((p) => p.name), ["알파"]);
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
