import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import { WebSocketServer, type WebSocket } from "ws";
import { expToNext, validNickname } from "../../../web/rpg/shared/character.ts";
import { INPUT_QUEUE_MAX, TICK_MS, WS_PORT, type RoomKind } from "../../../web/rpg/shared/constants.ts";
import { validAppearance } from "../../../web/rpg/shared/data/appearance.ts";
import { ELEMENTS } from "../../../web/rpg/shared/data/elements.ts";
import { ITEMS, RARITIES, type Rarity } from "../../../web/rpg/shared/data/items.ts";
import { SLOTS, type Slot } from "../../../web/rpg/shared/data/skills.ts";
import { USE_RANGE, distToObj, loadMap, prop, type GameMap, type TiledMap } from "../../../web/rpg/shared/map.ts";
import { blocked } from "../../../web/rpg/shared/movement.ts";
import type { C2S, S2C } from "../../../web/rpg/shared/protocol.ts";
import { DEV_TICKET_SECRET, verifyTicket, type Ticket } from "../../../web/rpg/shared/ticket.ts";
import { fxRows, recalc } from "./combat.ts";
import { createCharacter, findCharacter, savePosition, saveProgress, saveSettings, type CharacterRow } from "./db.ts";
import { econOp, online as econOnline, sweep, welcome } from "./economy.ts";
import { give, itemOp, sendInv } from "./items.ts";
import { mailCount } from "./db.ts";
import { changeJob, charBase, equip, saveDirtySkills, sendProg, syncSkills } from "./progress.ts";
import { Channels, buildPlayer, info, send, type Player } from "./room.ts";

const DEV = process.argv.includes("--dev");
const SECRET = process.env.RPG_TICKET_SECRET?.trim() || (DEV ? DEV_TICKET_SECRET : "");
if (!SECRET) {
  console.error("RPG_TICKET_SECRET 이 없습니다 (웹의 Vercel 환경변수와 같은 값). 개발이면 --dev 로 실행하세요.");
  process.exit(1);
}
const PORT = Number(process.env.PORT) || WS_PORT;
const ORIGINS = (process.env.RPG_ALLOWED_ORIGINS || "http://localhost:3000,https://ruc-server.vercel.app").split(",").map((s) => s.trim());

const mapFile = (name: string) => loadMap(JSON.parse(readFileSync(new URL(`../../../web/rpg/shared/data/maps/${name}.json`, import.meta.url), "utf8")) as TiledMap);
const maps: Record<RoomKind, GameMap> = { plaza: mapFile("plaza"), field: mapFile("field") };
const worlds: Record<RoomKind, Channels> = { plaza: new Channels("plaza", maps.plaza), field: new Channels("field", maps.field) };

const online = new Map<string, Player>(); // 디스코드 ID → 접속 중인 플레이어
econOnline.byChar = (id) => [...online.values()].find((p) => p.char.id === id);
econOnline.all = () => [...online.values()];

/** 저장된 맵 · 위치 · HP 로 플레이어를 만듦. kind = 들어갈 맵 */
function makePlayer(ws: WebSocket, t: Ticket, char: CharacterRow): { p: Player; kind: RoomKind } {
  const saved = char.position;
  const kind: RoomKind = saved && saved.map in maps && !blocked(maps[saved.map as RoomKind].collider, saved.x, saved.y) ? (saved.map as RoomKind) : "plaza";
  const pos = kind === saved?.map ? saved : maps.plaza.spawn;
  const p = buildPlayer(ws, t.sub, char, pos.x, pos.y);
  // 저장된 HP · 마나 · 기력 (장비 스탯을 얹은 뒤)
  const full = !saved?.hp || saved.hp <= 0;
  p.hp = full ? p.st.hp : Math.min(saved.hp!, p.st.hp);
  p.mp = full ? p.st.mana : Math.min(saved.mp ?? p.st.mana, p.st.mana);
  p.en = full ? p.st.energy : Math.min(saved.en ?? p.st.energy, p.st.energy);
  return { p, kind };
}

function join(p: Player, kind: RoomKind, ch?: number) {
  const w = worlds[kind];
  const prev = p.room;
  if (ch) {
    const t = w.get(ch);
    if (!t || (t !== prev && t.full)) return send(p, { t: "error", msg: "그 채널은 가득 찼습니다" });
  }
  // 먼저 나간 뒤 고름 — 혼자 있던 채널이 trim 으로 닫혀도 닫힌 방에 들어가지 않게, 같은 맵 안 이동은 같은 채널 유지
  if (prev) {
    prev.remove(p);
    worlds[prev.kind].trim();
  }
  const room = (ch && w.get(ch)) || (prev?.kind === kind && w.rooms.includes(prev) ? prev : w.pick());
  p.inputs = [];
  room.add(p);
  const others = [...room.players.values(), ...room.mobs.values()].filter((u) => u !== p && !u.dead);
  p.statsSent = JSON.stringify(p.st);
  p.statsDirty = false;
  send(p, {
    t: "joined",
    you: {
      id: p.id, nickname: p.char.nickname, level: p.char.level, exp: p.char.exp, element: p.char.element, appearance: p.char.appearance,
      ruc: p.ruc, kda: [0, 0, 0], settings: p.char.settings, slots: p.slots, prog: p.prog,
    },
    room: { kind: room.kind, ch: room.ch },
    me: p.mover,
    ents: others.map(info),
    fx: [p, ...others].filter((u) => u.fx.length).map((u) => [u.id, fxRows(room, u)]),
    channels: w.list(),
    stats: p.st,
    items: p.items,
    drops: room.visibleDrops(p),
  });
}

/** 다른 맵(또는 같은 맵 다른 곳)으로 */
function travel(p: Player, kind: RoomKind, x: number, y: number) {
  const m = p.mover;
  m.x = p.x = x;
  m.y = p.y = y;
  m.mv = m.lock = m.aim = 0;
  join(p, kind);
}

function save(p: Player) {
  saveDirtySkills(p);
  if (!p.room) return;
  if (p.dead) savePosition(p.char.id, { map: "plaza", ...maps.plaza.spawn });
  else savePosition(p.char.id, { map: p.room.kind, x: p.x, y: p.y, hp: Math.round(p.hp), mp: Math.round(p.mp), en: Math.round(p.en) });
}

function leave(p: Player) {
  if (online.get(p.discordId) === p) online.delete(p.discordId);
  if (p.room) {
    save(p);
    const kind = p.room.kind;
    p.room.remove(p);
    worlds[kind].trim();
  }
}

/** 광장 부활 (§13-4): 5초 뒤, 완전 회복. 경험치 손실은 쓰러질 때 이미 적용 */
function respawn(p: Player) {
  p.dead = false;
  p.respawnAt = 0;
  p.fx = [];
  p.fxDirty = true;
  recalc(p);
  p.hp = p.st.hp;
  p.mp = p.st.mana;
  p.en = p.st.energy;
  p.mover.stamina = p.mover.staminaMax;
  p.mover.exhausted = false;
  travel(p, "plaza", maps.plaza.spawn.x, maps.plaza.spawn.y);
}

/** 포털이 이어지는 곳: 도착 맵에서 출발 맵으로 가는 포털의 ax · ay (없으면 포털 아래) */
function arrival(to: RoomKind, from: RoomKind) {
  const o = maps[to].objects.find((x) => x.type === "portal" && prop(x, "target") === from);
  if (!o) return maps[to].spawn;
  return { x: Number(prop(o, "ax") ?? o.x), y: Number(prop(o, "ay") ?? o.y + 24) };
}

function use(p: Player, oid: number) {
  const room = p.room;
  const o = room?.map.objects.find((x) => x.id === oid);
  if (!room || !o || p.dead) return;
  if (distToObj(o, p.x, p.y) > USE_RANGE + 8) return send(p, { t: "error", msg: "조금 더 가까이 가세요" });
  if (o.type === "portal") {
    const target = String(prop(o, "target"));
    if (!(target in maps)) return send(p, { t: "error", msg: `「${o.name}」은 아직 준비 중입니다 (던전 · 결투장은 P7)` });
    const a = arrival(target as RoomKind, room.kind);
    return travel(p, target as RoomKind, a.x, a.y);
  }
  if (o.type === "npc") return send(p, { t: "error", msg: `${o.name}: "조금만 기다려 줘요! 곧 이야기 나눌 수 있어요."` });
}

/** 직업 교관(세라) 근처인가 — 전직은 광장에서 교관과 이야기해야 함 (§9-1) */
function nearInstructor(p: Player) {
  const o = p.room?.map.objects.find((x) => x.type === "npc" && prop(x, "npc") === "sera");
  return !!o && distToObj(o, p.x, p.y) <= USE_RANGE + 16;
}

const http = createServer((req, res) => {
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ ok: true, online: online.size, plaza: worlds.plaza.list(), field: worlds.field.list() }));
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
      const made = makePlayer(ws, ticket, char);
      player = made.p;
      online.set(ticket.sub, player);
      welcome(player);
      join(player, made.kind);
      const n = mailCount(player.char.id, Date.now());
      if (n) send(player, { t: "notify", kind: "mail", n });
      return;
    }
    if (!ticket) return;

    if (m.t === "create" && !player) {
      if (!validNickname(m.nickname)) return reply({ t: "createError", msg: "닉네임은 한글 · 영문 · 숫자 · _ 로 2~12자입니다" });
      if (!validAppearance(m.appearance) || !(m.element in ELEMENTS)) return reply({ t: "createError", msg: "외형 또는 속성이 올바르지 않습니다" });
      const char = findCharacter(ticket.sub) || createCharacter(ticket.sub, m.nickname, m.element, m.appearance);
      if (!char) return reply({ t: "createError", msg: "이미 쓰는 닉네임입니다" });
      player = makePlayer(ws, ticket, char).p;
      online.set(ticket.sub, player);
      welcome(player);
      join(player, "plaza");
      return send(player, { t: "notify", kind: "mail", n: mailCount(player.char.id, Date.now()) });
    }
    if (!player) return;

    switch (m.t) {
      case "in": {
        const seq = Number(m.seq);
        const last = player.inputs.length ? player.inputs[player.inputs.length - 1].seq : player.lastSeq;
        if (!Number.isInteger(seq) || seq <= last) return;
        if (player.inputs.length >= INPUT_QUEUE_MAX) return; // 너무 빨리 보내는 입력은 버림 (D9)
        const k = SLOTS.includes(m.k as Slot) ? (m.k as Slot) : undefined;
        player.inputs.push({
          seq, mx: Math.sign(Number(m.mx)) || 0, my: Math.sign(Number(m.my)) || 0, run: m.run === true,
          dg: m.dg === 1 ? 1 : undefined, k, ax: k ? Math.round(Number(m.ax)) : undefined, ay: k ? Math.round(Number(m.ay)) : undefined,
          cs: SLOTS.includes(m.cs as Slot) ? (m.cs as Slot) : undefined,
        });
        return;
      }
      case "ping":
        player.rtt = Math.max(0, Math.min(1000, Number(m.r) || 0));
        return reply({ t: "pong", c: Number(m.c) || 0 });
      case "settings":
        if (m.data && typeof m.data === "object" && JSON.stringify(m.data).length < 4000) {
          player.char.settings = m.data;
          saveSettings(player.char.id, m.data);
        }
        return;
      case "channel":
        if (player.room && player.room.ch !== m.ch && !player.dead) join(player, player.room.kind, Number(m.ch));
        return;
      case "use":
        return use(player, Number(m.oid));
      case "job": {
        if (!nearInstructor(player)) return reply({ t: "error", msg: "광장의 직업 교관 세라에게 가서 전직하세요" });
        const err = changeJob(player, m);
        if (err) reply({ t: "error", msg: err });
        return;
      }
      case "equip": {
        const err = equip(player, m.skill, m.slot);
        if (err) reply({ t: "error", msg: err });
        return;
      }
      case "econ": {
        const err = econOp(player, m);
        if (err) reply({ t: "error", msg: err });
        return;
      }
      case "item": {
        const err = itemOp(player, m);
        if (err) reply({ t: "error", msg: err });
        return;
      }
      case "dev": {
        if (!DEV) return;
        if (m.lv) {
          // 개발용 레벨 지정 (GM 도구 /gm level 은 P8)
          const c = player.char;
          c.level = Math.max(1, Math.min(40, Math.round(Number(m.lv)) || 1));
          c.exp = Math.min(c.exp, expToNext(c.level) - 1);
          saveProgress(c.id, c.level, c.exp);
          player.lv = c.level;
          player.base = charBase(player);
          syncSkills(player);
          recalc(player);
          player.hp = player.st.hp;
          player.mp = player.st.mana;
          player.en = player.st.energy;
          player.room?.ev.push(["lv", player.id, c.level]);
          player.out.push(["xp", 0, c.exp, c.level]);
          return sendProg(player);
        }
        if (m.give && Object.hasOwn(ITEMS, m.give)) {
          const r: Rarity = RARITIES.includes(m.rarity as Rarity) ? (m.rarity as Rarity) : ITEMS[m.give].rarity ?? "common";
          const err = give(player, m.give, Math.max(1, Math.min(64, Number(m.n) || 1)), r, "dev");
          if (err) reply({ t: "error", msg: err });
          return void sendInv(player);
        }
        const map = m.map && maps[m.map];
        const x = Number(m.x);
        const y = Number(m.y);
        if (map && !blocked(map.collider, x, y)) travel(player, m.map!, x, y);
        return;
      }
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
  for (const w of Object.values(worlds)) for (const r of w.rooms) r.tick(now);
  for (const p of online.values()) if (p.respawnAt && now >= p.respawnAt) respawn(p);
  if (++tickCount % 40 === 0) {
    const lists = { plaza: worlds.plaza.list(), field: worlds.field.list() };
    for (const p of online.values()) if (p.room) send(p, { t: "channels", list: lists[p.room.kind] });
  }
  if (tickCount % 600 === 0) for (const p of online.values()) save(p);
  if (tickCount % 1200 === 1) sweep(now); // 1분마다: 유저 상점 만료 반환 · 30일 지난 우편 정리
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

http.listen(PORT, process.env.RPG_BIND || undefined, () => console.log(`RPG 게임 서버 ws://localhost:${PORT}${DEV ? " (개발 모드)" : ""}`));
