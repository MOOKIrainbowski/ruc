// P10 소셜: 친구 신청 → 수락 · 차단 · 귓속말(/w · /r) · 접속 알림 · 길드(만들기 비용 · 초대 · 신청 · 위임 · 추방 · 공지 · 해산 · 길드 채팅 · 이름표) · 채팅 저장
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";

process.env.RPG_DB_FILE = `test-social-${process.pid}.sqlite`;
const { loadMap } = await import("../../../web/rpg/shared/map.ts");
const { GUILD } = await import("../../../web/rpg/shared/data/social.ts");
const { createCharacter, db, guildChat, guildOf, listNotis, ruc, wallet, whispers } = await import("../src/db.ts");
const E = await import("../src/economy.ts");
const S = await import("../src/social.ts");
const { chatOp } = await import("../src/chat.ts");
const { Room, buildPlayer } = await import("../src/room.ts");
test.after(() => {
  db.close();
  for (const ext of ["", "-wal", "-shm"]) rmSync(fileURLToPath(new URL(`../data/${process.env.RPG_DB_FILE}${ext}`, import.meta.url)), { force: true });
});
type Player = import("../src/room.ts").Player;

const plazaMap = loadMap(JSON.parse(readFileSync(new URL("../../../web/rpg/shared/data/maps/plaza.json", import.meta.url), "utf8")));
const plaza = new Room("plaza", 1, plazaMap, 1_000_000);
const players: Player[] = [];
E.online.byChar = (id) => players.find((p) => p.char.id === id);
E.online.all = () => players;
const ap = { hair: 0, hairColor: 0, skin: 0, eyes: 0 };
let n = 0;
const out = new Map<Player, string[]>();
function mk(online = true) {
  const c = createCharacter(`so${++n}`, `소셜${n}`, "fire", ap)!;
  const box: string[] = [];
  const p = buildPlayer({ readyState: 1, send: (s: string) => box.push(String(s)) } as never, c.discord_id, c, plazaMap.spawn.x, plazaMap.spawn.y);
  out.set(p, box);
  if (online) login(p);
  return p;
}
const login = (p: Player) => { plaza.add(p); players.push(p); E.welcome(p); S.socialLogin(p); };
const logout = (p: Player) => { plaza.remove(p); players.splice(players.indexOf(p), 1); S.socialLogout(p); };
const msgs = (p: Player, t: string) => out.get(p)!.filter((s) => s.startsWith("{")).map((s) => JSON.parse(s)).filter((m) => m.t === t);
const social = (p: Player) => msgs(p, "social").at(-1)!.s;
const chats = (p: Player, ch: string) => msgs(p, "chat").filter((m) => m.ch === ch);

test("친구: 신청 → 알림 → 수락 · 서로 신청하면 바로 친구 · 접속 알림 · 삭제 · 차단(귓속말 · 신청 · 초대 막힘)", () => {
  const a = mk();
  const b = mk();
  assert.equal(S.friendOp(a, { op: "request", name: b.char.nickname }), null);
  assert.match(S.friendOp(a, { op: "request", name: b.char.nickname })!, /이미 신청/);
  const noti = listNotis(b.char.id).find((x) => x.kind === "friend_request")!;
  assert.equal(JSON.parse(noti.data!).cid, a.char.id);
  assert.deepEqual(social(b).pending.map((x: { name: string }) => x.name), [a.char.nickname]);
  assert.equal(S.friendOp(b, { op: "accept", cid: a.char.id }), null);
  assert.deepEqual(social(a).friends.map((f: { name: string; on: boolean }) => [f.name, f.on]), [[b.char.nickname, true]]);
  assert.ok(listNotis(a.char.id).some((x) => x.kind === "friend_accepted"));
  // 접속 끊음 · 접속 알림
  logout(b);
  assert.ok(chats(a, "system").some((m) => m.text.includes(`${b.char.nickname}님이 나갔어요`)));
  assert.equal(social(a).friends[0].on, false);
  login(b);
  assert.ok(chats(a, "system").some((m) => m.text.includes(`${b.char.nickname}님이 접속했어요`)));
  // 서로 신청하면 바로 친구
  const c = mk();
  const d = mk();
  assert.equal(S.friendOp(c, { op: "request", name: d.char.nickname }), null);
  assert.equal(S.friendOp(d, { op: "request", name: c.char.nickname }), null);
  assert.equal(social(c).friends.length, 1);
  // 삭제 → 양쪽 다
  assert.equal(S.friendOp(c, { op: "remove", cid: d.char.id }), null);
  assert.equal(social(d).friends.length, 0);
  // 차단: 친구가 끊기고 귓속말 · 친구 신청이 막힘, 해제하면 다시
  assert.equal(S.friendOp(a, { op: "block", name: b.char.nickname }), null);
  assert.equal(social(a).friends.length, 0);
  assert.equal(social(a).blocked[0].name, b.char.nickname);
  assert.match(chatOp(b, { text: `/w ${a.char.nickname} 안녕` })!, /차단/);
  assert.match(S.friendOp(b, { op: "request", name: a.char.nickname })!, /보낼 수 없는/);
  assert.equal(S.friendOp(a, { op: "unblock", cid: b.char.id }), null);
  assert.match(S.friendOp(a, { op: "request", name: "없는사람" })!, /없는 모험가/);
});

test("귓속말: /w 닉 말 · /r 답장 · 접속 안 한 상대 · 욕설 가림 · 저장 → 다시 접속하면 기록", () => {
  const a = mk();
  const b = mk();
  const off = mk(false);
  assert.equal(chatOp(a, { text: `/w ${b.char.nickname} 시발 안녕` }), null);
  const got = chats(b, "whisper").at(-1);
  assert.equal(got.from, a.char.nickname);
  assert.equal(got.to, b.char.nickname);
  assert.equal(got.text, "** 안녕");
  assert.equal(chats(a, "whisper").at(-1).text, "** 안녕", "보낸 쪽도 봄");
  assert.equal(chatOp(b, { text: "/r 반가워" }), null);
  assert.equal(chats(a, "whisper").at(-1).text, "반가워");
  assert.match(chatOp(a, { text: `/w ${off.char.nickname} 거기 있어?` })!, /접속해 있지 않습니다/);
  assert.match(chatOp(a, { text: "/w" })!, /\/w 닉네임/);
  assert.equal(whispers(b.char.id, 10).length, 2);
  // 다시 접속하면 저장된 귓속말
  logout(b);
  out.get(b)!.length = 0;
  login(b);
  assert.deepEqual(chats(b, "whisper").map((m) => m.text), ["** 안녕", "반가워"]);
});

test("길드: 만들기(RUC · 이름 검사) · 초대 → 수락 · 가입 신청 → 승인 · 길드 채팅 · 공지 · 이름표 · 위임 · 추방 · 탈퇴 · 해산", () => {
  const m = mk();
  const a = mk();
  const b = mk();
  assert.match(S.guildOp(m, { op: "create", name: "가" })!, /2~10자/);
  assert.match(S.guildOp(m, { op: "create", name: "시발길드" })!, /쓸 수 없는/);
  const need = GUILD.createRuc - wallet(m.char.id).balance;
  if (need > 0) m.ruc = ruc(m.char.id, need, "test", null, `test:${m.char.id}`).balance;
  const before = wallet(m.char.id).balance;
  assert.equal(S.guildOp(m, { op: "create", name: "새벽별" }), null);
  assert.equal(wallet(m.char.id).balance, before - GUILD.createRuc);
  assert.equal(m.guild?.name, "새벽별");
  assert.ok(plaza.ev.some((e) => e[0] === "gd" && e[1] === m.id && e[2] === "새벽별"), "이름표 길드");
  // 같은 이름 · RUC 부족 (RUC 를 잃지 않음)
  const poor = mk();
  const pr = wallet(poor.char.id).balance;
  assert.match(S.guildOp(poor, { op: "create", name: "새벽별" })!, pr < GUILD.createRuc ? /RUC/ : /이미 있는/);
  assert.equal(wallet(poor.char.id).balance, pr);
  // 초대 → 알림 → 수락
  assert.match(S.guildOp(a, { op: "invite", name: b.char.nickname })!, /길드장만/);
  assert.equal(S.guildOp(m, { op: "invite", name: a.char.nickname }), null);
  const inv = JSON.parse(listNotis(a.char.id).find((x) => x.kind === "guild_invite")!.data!);
  assert.equal(S.guildOp(a, { op: "accept", id: inv.gid }), null);
  assert.equal(guildOf(a.char.id)?.name, "새벽별");
  assert.match(S.guildOp(a, { op: "accept", id: inv.gid })!, /초대가 없거나/, "한 번만");
  // 가입 신청 → 길드장 승인
  assert.equal(S.guildOp(b, { op: "apply", name: "새벽별" }), null);
  const req = JSON.parse(listNotis(m.char.id).find((x) => x.kind === "guild_request")!.data!);
  assert.equal(S.guildOp(m, { op: "approve", cid: req.cid }), null);
  assert.equal(b.guild?.name, "새벽별");
  assert.equal(social(m).guild.members.length, 3);
  // 길드 채팅 (/g) · 저장 · 길드가 없는 사람
  assert.equal(chatOp(a, { text: "/g 다들 안녕" }), null);
  for (const q of [m, a, b]) assert.equal(chats(q, "guild").at(-1).text, "다들 안녕");
  assert.equal(guildChat(m.guild!.id, 10).at(-1)?.text, "다들 안녕");
  assert.match(chatOp(poor, { text: "/g 나도" })!, /길드에 들어 있지/);
  // 공지 · 위임 · 추방 · 탈퇴
  assert.equal(S.guildOp(m, { op: "notice", text: "토요일 9시 던전" }), null);
  assert.equal(social(a).guild.notice, "토요일 9시 던전");
  assert.match(S.guildOp(m, { op: "leave" })!, /길드장을 넘기거나/);
  assert.equal(S.guildOp(m, { op: "promote", cid: a.char.id }), null);
  assert.ok(social(b).guild.members.find((x: { name: string; master: boolean }) => x.name === a.char.nickname).master);
  assert.match(S.guildOp(m, { op: "kick", cid: b.char.id })!, /길드장만/);
  assert.equal(S.guildOp(a, { op: "kick", cid: b.char.id }), null);
  assert.equal(b.guild, null);
  assert.ok(listNotis(b.char.id).some((x) => x.kind === "guild_kicked"));
  assert.equal(S.guildOp(m, { op: "leave" }), null);
  assert.equal(guildOf(m.char.id), null);
  // 다시 접속해도 길드 · 이름표 정보가 남음
  logout(a);
  login(a);
  assert.equal(a.guild?.name, "새벽별");
  // 해산: 모두 빠지고 알림
  assert.equal(S.guildOp(m, { op: "apply", name: "새벽별" }), null);
  assert.equal(S.guildOp(a, { op: "approve", cid: m.char.id }), null);
  assert.equal(S.guildOp(a, { op: "disband" }), null);
  assert.equal(guildOf(m.char.id), null);
  assert.equal(m.guild, null);
  assert.ok(listNotis(m.char.id).some((x) => x.kind === "guild_kicked" && x.text.includes("해산")));
});
