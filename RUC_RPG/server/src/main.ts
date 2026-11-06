import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import { WebSocketServer, type WebSocket } from "ws";
import { baseStats, validNickname } from "../../../web/rpg/shared/character.ts";
import { INPUT_QUEUE_MAX, TICK_MS, WS_PORT } from "../../../web/rpg/shared/constants.ts";
import { validAppearance } from "../../../web/rpg/shared/data/appearance.ts";
import { ELEMENTS } from "../../../web/rpg/shared/data/elements.ts";
import { loadMap, type TiledMap } from "../../../web/rpg/shared/map.ts";
import { blocked, type Mover } from "../../../web/rpg/shared/movement.ts";
import type { C2S, S2C } from "../../../web/rpg/shared/protocol.ts";
import { DEV_TICKET_SECRET, verifyTicket, type Ticket } from "../../../web/rpg/shared/ticket.ts";
import { createCharacter, findCharacter, savePosition, saveSettings, type CharacterRow } from "./db.ts";
import { Channels, info, send, type Player } from "./room.ts";

const DEV = process.argv.includes("--dev");
const SECRET = process.env.RPG_TICKET_SECRET?.trim() || (DEV ? DEV_TICKET_SECRET : "");
if (!SECRET) {
  console.error("RPG_TICKET_SECRET 이 없습니다 (웹의 Vercel 환경변수와 같은 값). 개발이면 --dev 로 실행하세요.");
  process.exit(1);
}
const PORT = Number(process.env.PORT) || WS_PORT;
const ORIGINS = (process.env.RPG_ALLOWED_ORIGINS || "http://localhost:3000,https://ruc-server.vercel.app").split(",").map((s) => s.trim());

const plazaMap = loadMap(JSON.parse(readFileSync(new URL("../../../web/rpg/shared/data/maps/plaza.json", import.meta.url), "utf8")) as TiledMap);
const plaza = new Channels("plaza", plazaMap);

const online = new Map<string, Player>(); // 디스코드 ID → 접속 중인 플레이어
let nextId = 1;

function makePlayer(ws: WebSocket, t: Ticket, char: CharacterRow): Player {
  const s = baseStats(char.level);
  const pos = char.position?.map === "plaza" && !blocked(plazaMap.collider, char.position.x, char.position.y) ? char.position : plazaMap.spawn;
  const mover: Mover = { x: pos.x, y: pos.y, dir: 0, stamina: s.stamina, staminaMax: s.stamina, restMs: 0, exhausted: false, moving: false, running: false };
  return { id: nextId++, ws, discordId: t.sub, char, mover, ms: { moveSpeed: s.moveSpeed, endurance: s.endurance }, inputs: [], credits: 0, lastSeq: -1, room: null };
}

function join(p: Player, ch?: number) {
  const room = (ch && plaza.get(ch)) || plaza.pick();
  if (room.full) return send(p, { t: "error", msg: "그 채널은 가득 찼습니다" });
  if (p.room) p.room.remove(p);
  p.inputs = [];
  room.add(p);
  send(p, {
    t: "joined",
    you: {
      id: p.id, nickname: p.char.nickname, level: p.char.level, exp: p.char.exp, element: p.char.element, appearance: p.char.appearance,
      ruc: 0, kda: [0, 0, 0], settings: p.char.settings, ms: p.ms,
    },
    room: { kind: room.kind, ch: room.ch },
    me: p.mover,
    players: [...room.players.values()].filter((o) => o !== p).map(info),
    channels: plaza.list(),
  });
}

function leave(p: Player) {
  if (online.get(p.discordId) === p) online.delete(p.discordId);
  if (p.room) {
    savePosition(p.char.id, { map: "plaza", x: p.mover.x, y: p.mover.y });
    p.room.remove(p);
    plaza.trim();
  }
}

const http = createServer((req, res) => {
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ ok: true, online: online.size, channels: plaza.list() }));
});
const wss = new WebSocketServer({ server: http, maxPayload: 8 * 1024 });

wss.on("connection", (ws, req) => {
  if (!DEV && !ORIGINS.includes(req.headers.origin || "")) return ws.close(4003, "origin");
  let ticket: Ticket | null = null;
  let player: Player | null = null;
  const reply = (m: S2C) => ws.readyState === 1 && ws.send(JSON.stringify(m));
  const kick = (reason: "dup" | "rate" | "auth" | "server") => { reply({ t: "kicked", reason }); ws.close(); };

  // 레이트 리밋 (§27): 1초에 150개 넘으면 끊음 (입력 60 + 여유)
  let windowStart = Date.now();
  let count = 0;
  const helloTimer = setTimeout(() => !ticket && kick("auth"), 10_000);

  ws.on("message", (raw) => {
    const now = Date.now();
    if (now - windowStart > 1000) { windowStart = now; count = 0; }
    if (++count > 150) return kick("rate");

    let m: C2S;
    try { m = JSON.parse(String(raw)); } catch { return; }
    if (!m || typeof m !== "object") return;

    if (m.t === "hello") {
      if (ticket) return;
      ticket = verifyTicket(m.ticket, SECRET);
      if (!ticket) return kick("auth");
      clearTimeout(helloTimer);
      // 같은 계정이 다시 들어오면 기존 연결을 끊음 (§2-3)
      const old = online.get(ticket.sub);
      if (old) { send(old, { t: "kicked", reason: "dup" }); leave(old); old.ws.close(); }
      const char = findCharacter(ticket.sub);
      if (!char) return reply({ t: "needCreate", defaultName: ticket.name.replace(/[^가-힣a-zA-Z0-9_]/g, "").slice(0, 12) });
      player = makePlayer(ws, ticket, char);
      online.set(ticket.sub, player);
      return join(player);
    }
    if (!ticket) return;

    if (m.t === "create" && !player) {
      if (!validNickname(m.nickname)) return reply({ t: "createError", msg: "닉네임은 한글 · 영문 · 숫자 · _ 로 2~12자입니다" });
      if (!validAppearance(m.appearance) || !(m.element in ELEMENTS)) return reply({ t: "createError", msg: "외형 또는 속성이 올바르지 않습니다" });
      const char = findCharacter(ticket.sub) || createCharacter(ticket.sub, m.nickname, m.element, m.appearance);
      if (!char) return reply({ t: "createError", msg: "이미 쓰는 닉네임입니다" });
      player = makePlayer(ws, ticket, char);
      online.set(ticket.sub, player);
      return join(player);
    }
    if (!player) return;

    switch (m.t) {
      case "in": {
        const seq = Number(m.seq);
        if (!Number.isInteger(seq) || seq <= player.lastSeq) return;
        if (player.inputs.length >= INPUT_QUEUE_MAX) return; // 너무 빨리 보내는 입력은 버림 (D9)
        player.inputs.push({ seq, mx: Math.sign(Number(m.mx)) || 0, my: Math.sign(Number(m.my)) || 0, run: m.run === true });
        return;
      }
      case "ping":
        return reply({ t: "pong", c: Number(m.c) || 0 });
      case "settings":
        if (m.data && typeof m.data === "object" && JSON.stringify(m.data).length < 4000) {
          player.char.settings = m.data;
          saveSettings(player.char.id, m.data);
        }
        return;
      case "channel":
        if (player.room?.ch !== m.ch) join(player, Number(m.ch));
        return;
    }
  });

  ws.on("close", () => {
    clearTimeout(helloTimer);
    if (player) leave(player);
  });
});

// 20Hz 틱 (§2-2). setInterval 은 밀리면 따라잡지 않으므로 다음 목표 시각으로 맞춥니다.
let next = performance.now();
let tickCount = 0;
function loop() {
  const now = Date.now();
  for (const r of plaza.rooms) r.tick(now);
  if (++tickCount % 40 === 0) {
    const list = plaza.list();
    for (const p of online.values()) send(p, { t: "channels", list });
  }
  if (tickCount % 600 === 0) for (const p of online.values()) if (p.room) savePosition(p.char.id, { map: "plaza", x: p.mover.x, y: p.mover.y });
  next += TICK_MS;
  setTimeout(loop, Math.max(0, next - performance.now()));
}
loop();

function shutdown() {
  for (const p of [...online.values()]) { send(p, { t: "kicked", reason: "server" }); leave(p); }
  process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

http.listen(PORT, () => console.log(`RPG 게임 서버 ws://localhost:${PORT}${DEV ? " (개발 모드)" : ""}`));
