// P7 파티 · 던전 · 결투: 파티 조작 · 보상 분배(1.5:1 · 경험치 균등) · 결투(체력 1 · K/D/A · 결투 승리 퀘스트) · 결투장 PvP ·
// 던전 "고목의 유적" 5인 파티로 1~10 스테이지(보스 페이즈 · 전멸기 · 공용 부활 · 포션 제한 · 클리어 보상 · 최초 클리어 공지) — 소켓 없이 Room 을 직접 돌림
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";

process.env.RPG_DB_FILE = `test-party-${process.pid}.sqlite`;
const { loadMap } = await import("../../../web/rpg/shared/map.ts");
const { mobExp, MOBS } = await import("../../../web/rpg/shared/data/mobs.ts");
const { RUINS } = await import("../../../web/rpg/shared/data/dungeons.ts");
const { partyExp, splitWeighted, TITLES } = await import("../../../web/rpg/shared/data/party.ts");
const { createCharacter, db, listMail, listNotis, loadItemsAt, loadKda, loadTitles } = await import("../src/db.ts");
const E = await import("../src/economy.ts");
const Q = await import("../src/quests.ts");
const P = await import("../src/party.ts");
const V = await import("../src/pvp.ts");
const D = await import("../src/dungeon.ts");
const { bossMove } = await import("../src/mobs.ts");
const { die, hit } = await import("../src/combat.ts");
const { give, use } = await import("../src/items.ts");
const { Room, buildPlayer } = await import("../src/room.ts");
test.after(() => {
  db.close();
  for (const ext of ["", "-wal", "-shm"]) rmSync(fileURLToPath(new URL(`../data/${process.env.RPG_DB_FILE}${ext}`, import.meta.url)), { force: true });
});
type Player = import("../src/room.ts").Player;
type Room = import("../src/room.ts").Room;

const map = (n: string) => loadMap(JSON.parse(readFileSync(new URL(`../../../web/rpg/shared/data/maps/${n}.json`, import.meta.url), "utf8")));
const maps = { plaza: map("plaza"), field: map("field"), arena: map("arena"), dungeon: map("dungeon") };
let now = 1_000_000;
const plaza = new Room("plaza", 1, maps.plaza, now);
const players: Player[] = [];
E.online.byChar = (id) => players.find((p) => p.char.id === id);
E.online.all = () => players;
D.setDungeonMap(maps.dungeon);
// main.ts 대신: 방 옮기기
const move = (p: Player, room: Room, x: number, y: number) => {
  p.room?.remove(p);
  p.x = p.mover.x = x;
  p.y = p.mover.y = y;
  room.add(p);
  p.potionLeft = room.inst ? RUINS.potionsPerStage : null;
};
D.dgHooks.place = move;
D.dgHooks.toPlaza = (p) => { if (p.dead) { p.dead = false; p.hp = p.st.hp; } move(p, plaza, maps.plaza.spawn.x, maps.plaza.spawn.y); };

const ap = { hair: 0, hairColor: 0, skin: 0, eyes: 0 };
let n = 0;
const sent = new Map<Player, string[]>();
function mk(lv = 1) {
  const c = createCharacter(`pt${++n}`, `파티원${n}`, "fire", ap)!;
  c.level = lv;
  const out: string[] = [];
  const p = buildPlayer({ readyState: 1, send: (s: string) => out.push(s) } as never, c.discord_id, c, maps.plaza.spawn.x, maps.plaza.spawn.y);
  plaza.add(p);
  players.push(p);
  sent.set(p, out);
  E.welcome(p);
  Q.loadQuestState(p);
  return p;
}
/** i 번째 메시지부터 스냅샷에 실린 방 이벤트 */
const evsSince = (p: Player, i: number): unknown[][] => sent.get(p)!.slice(i).map((x) => JSON.parse(x)).filter((m) => m.t === "s" && m.ev).flatMap((m) => m.ev);
const msgs = (p: Player, t: string) => sent.get(p)!.map((s) => JSON.parse(s)).filter((m) => m.t === t);
const lastParty = (p: Player) => msgs(p, "party").at(-1)?.party;
const claimAll = (p: Player) => { for (const m of listMail(p.char.id, Date.now())) assert.equal(E.claimMail(p, m.id), null); };

test("파티 조작: 초대 → 수락 · 가입 신청 → 승인 · 위임 · 추방 · 나가기 · 해산 · 최대 5명 · 알림", () => {
  const [a, b, c, d, e, f, g] = Array.from({ length: 7 }, () => mk());
  assert.equal(P.partyOp(a, { op: "invite", name: b.char.nickname }), null, "파티가 없으면 초대하면서 만듦");
  const pt = P.partyOf(a)!;
  assert.equal(pt.leader, a.char.id);
  const inv = listNotis(b.char.id).find((x) => x.kind === "party_invite")!;
  assert.equal(JSON.parse(inv.data!).party, pt.id, "초대 알림에 수락 버튼용 파티 id");
  assert.equal(P.partyOp(b, { op: "accept", id: pt.id }), null);
  assert.equal(b.party, pt.id);
  assert.equal(P.partyOp(c, { op: "accept", id: pt.id }), "초대가 만료되었거나 파티가 없어졌습니다", "초대 없이 수락 불가");
  assert.equal(P.partyOp(b, { op: "invite", name: c.char.nickname }), "파티장만 초대할 수 있습니다");
  // 가입 신청 → 승인
  assert.equal(P.partyOp(c, { op: "request", name: a.char.nickname }), null);
  assert.ok(listNotis(a.char.id).some((x) => x.kind === "party_join_request"));
  assert.equal(P.partyOp(a, { op: "approve", cid: c.char.id }), null);
  assert.ok(listNotis(c.char.id).some((x) => x.kind === "party_accepted"));
  for (const x of [d, e]) { P.partyOp(a, { op: "invite", name: x.char.nickname }); P.partyOp(x, { op: "accept", id: pt.id }); }
  assert.equal(pt.members.length, 5);
  assert.equal(P.partyOp(a, { op: "invite", name: f.char.nickname }), "파티는 5명까지입니다");
  assert.deepEqual(lastParty(e).members.map((m: { name: string }) => m.name), [a, b, c, d, e].map((x) => x.char.nickname), "파티원 모두에게 상태");
  // 위임 · 추방 · 나가기
  assert.equal(P.partyOp(a, { op: "promote", cid: b.char.id }), null);
  assert.equal(pt.leader, b.char.id);
  assert.equal(P.partyOp(a, { op: "kick", cid: c.char.id }), "파티장만 추방할 수 있습니다");
  assert.equal(P.partyOp(b, { op: "kick", cid: c.char.id }), null);
  assert.equal(c.party, 0);
  assert.equal(lastParty(c), null);
  assert.ok(listNotis(c.char.id).some((x) => x.kind === "party_kicked"));
  assert.equal(P.partyOp(b, { op: "leave" }), null);
  assert.notEqual(pt.leader, b.char.id, "파티장이 나가면 다음 사람이 파티장");
  // 모집 공개 · 목록
  P.partyOp(players.find((x) => x.char.id === pt.leader)!, { op: "open", on: true, note: "  던전   같이 가요 " });
  P.partyOp(g, { op: "list" });
  assert.deepEqual(msgs(g, "ads").at(-1).list.map((x: { note: string }) => x.note), ["던전 같이 가요"]);
  // 해산
  const leader = players.find((x) => x.char.id === pt.leader)!;
  assert.equal(P.partyOp(leader, { op: "disband" }), null);
  for (const x of [a, d, e]) assert.equal(x.party, 0);
  assert.equal(P.partyById(pt.id), undefined);
  // 튜토리얼 '파티 만들기' 목표
  assert.equal(P.partyOp(g, { op: "create" }), null);
  P.partyOp(g, { op: "leave" });
});

test("보상 분배 (§21-2): 경험치는 20타일 안 파티원 균등 + 인원당 5%, RUC 는 같은 방 파티원에게 1.5 : 1, 드롭은 추첨 한 명 + 분배 알림", () => {
  const field = new Room("field", 9, maps.field, now);
  const [a, b, c] = [mk(5), mk(5), mk(5)];
  for (const x of [a, b, c]) claimAll(x);
  P.partyOp(a, { op: "invite", name: b.char.nickname }); P.partyOp(b, { op: "accept", id: P.partyOf(a)!.id });
  P.partyOp(a, { op: "invite", name: c.char.nickname }); P.partyOp(c, { op: "accept", id: P.partyOf(a)!.id });
  const z = field.zones.find((q) => q.mob === "goblin")!;
  move(a, field, z.x, z.y);
  move(b, field, z.x + 40, z.y);
  move(c, field, z.x + 600, z.y); // 멀리 (경험치 밖, RUC · 드롭은 같은 방이라 받음)
  const m = [...field.mobs.values()].find((q) => q.key === "goblin")!;
  m.x = z.x; m.y = z.y;
  const exp0 = [a, b, c].map((x) => x.char.exp + x.char.level * 1e6);
  const ruc0 = [a, b, c].map((x) => x.ruc);
  for (const x of [a, b, c]) x.out = [];
  m.dmgBy.set(b.id, 50);
  die(field, m, b);
  const each = partyExp(mobExp(m.def, m.lv, m.grade, 5), 2);
  assert.equal(a.char.exp + a.char.level * 1e6 - exp0[0] > 0, true);
  assert.deepEqual([a, b].map((x) => x.out.find((e) => e[0] === "xp")![1]), [each, each], "가까운 두 명이 똑같이");
  assert.equal(c.out.some((e) => e[0] === "xp"), false, "20타일 밖은 경험치 없음");
  const got = [a, b, c].map((x, i) => x.ruc - ruc0[i]);
  const total = got.reduce((s, v) => s + v, 0);
  assert.deepEqual(got, splitWeighted(total, [1.5, 1, 1]), "파티장(a) 1.5");
  const pl = a.out.filter((e) => e[0] === "pl");
  assert.equal(pl.length, [...field.drops.values()].length, "드롭마다 분배 결과 알림");
  for (const d of field.drops.values()) assert.equal(d.owners!.size, 1, "주인 한 명");
  for (const x of [a, b, c]) { P.partyOp(x, { op: "leave" }); move(x, plaza, maps.plaza.spawn.x, maps.plaza.spawn.y); }
});

test("결투 (§13-3): 필드에서 신청 → 수락 → 3초 뒤 시작 → 진 사람은 체력 1 · K/D/A · 결투 승리 유저 퀘스트", () => {
  const field = new Room("field", 8, maps.field, now);
  const [a, b, poster] = [mk(10), mk(10), mk()];
  claimAll(poster);
  assert.equal(Q.uqCreate(poster, { title: "결투 한판", kind: "duel", target: "duel", n: 1, ruc: 50, slots: 1, days: 1 }), null);
  const uq = Q.boardView(a).board.find((r) => r.title === "결투 한판")!;
  assert.equal(Q.uqAccept(a, uq.id), null);
  assert.equal(V.duelOp(a, { op: "ask", name: b.char.nickname }), "결투는 햇살 초원에서 신청할 수 있습니다 (결투장은 언제나 PvP)", "광장은 안 됨");
  move(a, field, 600, 400);
  move(b, field, 640, 400);
  assert.equal(V.duelOp(a, { op: "ask", name: b.char.nickname }), null);
  const ask = msgs(b, "ask").at(-1);
  assert.equal(ask.kind, "duel");
  assert.equal(field.hostile(a, b), false);
  field.now = now;
  assert.equal(V.duelOp(b, { op: "accept", id: ask.id }), null);
  V.duelTick(now + 1000);
  assert.equal(field.hostile(a, b), false, "카운트다운 동안은 못 때림");
  V.duelTick(now + 3100);
  assert.ok(field.hostile(a, b) && field.foes(a).includes(b));
  hit(field, a, b, { base: 999_999, atkRatio: 0, apRatio: 0, cat: "physical", el: null, threat: 1 });
  assert.equal(b.dead, false, "결투에서는 쓰러지지 않음");
  assert.equal(b.hp, 1);
  V.duelTick(now + 3200);
  assert.equal(a.duel, 0);
  assert.deepEqual(a.out.find((e) => e[0] === "duel" && e[1] === "end")!.slice(3), ["win"]);
  assert.deepEqual(b.out.find((e) => e[0] === "duel" && e[1] === "end")!.slice(3), ["lose"]);
  assert.deepEqual(loadKda(a.char.id, "beta1"), [1, 0, 0]);
  assert.deepEqual(loadKda(b.char.id, "beta1"), [0, 1, 0]);
  assert.equal(a.takes.has(uq.id), false, "결투 승리로 유저 퀘스트 완료");
  assert.ok(listMail(a.char.id, Date.now()).some((x) => x.subject.includes("결투 한판")));
  assert.equal(field.hostile(a, b), false);
  for (const x of [a, b]) move(x, plaza, maps.plaza.spawn.x, maps.plaza.spawn.y);
});

test("결투장: 같은 파티가 아니면 적 · 쓰러져도 경험치 그대로 · 결투장에서 부활 · 어시스트", () => {
  const arena = new Room("arena", 1, maps.arena, now);
  const [a, b, c, mate] = [mk(10), mk(10), mk(10), mk(10)];
  P.partyOp(a, { op: "invite", name: mate.char.nickname }); P.partyOp(mate, { op: "accept", id: P.partyOf(a)!.id });
  for (const x of [a, b, c, mate]) move(x, arena, 400, 320);
  assert.equal(arena.hostile(a, mate), false, "같은 파티");
  assert.ok(arena.hostile(a, b) && arena.hostile(b, c));
  b.char.exp = 50;
  arena.now = now;
  hit(arena, c, b, { base: 5, atkRatio: 0, apRatio: 0, cat: "physical", el: null, threat: 1 });
  hit(arena, a, b, { base: 999_999, atkRatio: 0, apRatio: 0, cat: "physical", el: null, threat: 1 });
  assert.equal(b.dead, true);
  assert.equal(b.char.exp, 50, "결투장 사망은 페널티 없음");
  assert.equal(b.respawnKind, "arena");
  assert.deepEqual(a.kda, [1, 0, 0]);
  assert.deepEqual(b.kda, [0, 1, 0]);
  assert.deepEqual(c.kda, [0, 0, 1], "10초 안에 때렸으면 어시스트");
  P.partyOp(a, { op: "leave" });
  for (const x of [a, b, c, mate]) { x.dead = false; x.hp = x.st.hp; move(x, plaza, maps.plaza.spawn.x, maps.plaza.spawn.y); }
});

test("던전 고목의 유적: 5인 파티 1~10 스테이지 — 정비 · 다음 포털 · 보스 패턴 · 공용 부활 · 포션 제한 · 클리어 보상 · 최초 클리어", () => {
  const team = Array.from({ length: 5 }, () => mk(30));
  const [lead] = team;
  for (const x of team.slice(1)) { P.partyOp(lead, { op: "invite", name: x.char.nickname }); P.partyOp(x, { op: "accept", id: P.partyOf(lead)!.id }); }
  const portal = maps.plaza.objects.find((o) => o.type === "portal" && o.properties?.some((p) => p.value === "dungeon"))!;
  assert.equal(D.usePortal(team[1]), "파티장이 문 앞에서 입장을 확인해야 합니다");
  assert.equal(D.enter(lead), "광장 북쪽 '고대 유적의 문' 앞에서 입장하세요");
  for (const x of team) { x.x = x.mover.x = portal.x; x.y = x.mover.y = portal.y + 10; }
  D.usePortal(lead);
  assert.equal(msgs(lead, "ask").at(-1).kind, "dungeon", "파티장에게 입장 확인 창");
  assert.equal(D.enter(lead), null);
  const room = team[0].room!;
  assert.equal(room.kind, "dungeon");
  assert.ok(team.every((x) => x.room === room), "광장에 있던 파티원 모두 입장");
  const run = room.inst as InstanceType<typeof D.Run>;
  assert.equal(run.n, 1);
  const slimes = [...room.mobs.values()];
  assert.equal(slimes.length, 12);
  assert.equal(slimes[0].st.hp, Math.round(MOBS.sprout_slime.hp * (1 + 0.3 * 5) * (1 + 0.6 * 4)), "인원 보정 HP × 3.4");
  // 포션 제한: 스테이지마다 5개
  give(team[1], "hp_potion_s", 10, "common", "test");
  const potion = team[1].items.find((i) => i.tpl === "hp_potion_s")!;
  team[1].potionLeft = 0;
  assert.match(String(use(team[1], [potion.loc, potion.slot])), /포션을 더 쓸 수 없습니다/);
  // 공용 부활: 쓰러지고 10초 뒤
  room.now = now;
  die(room, team[4], undefined);
  assert.ok(team[4].dead && team[4].out.some((e) => e[0] === "dead" && e[2] === "dungeon"), "관전 (광장으로 안 감)");
  room.now = now + 5000;
  assert.match(String(D.dungeonOp(team[4], "revive")), /초 뒤에/);
  room.now = now + 10_500;
  assert.equal(D.dungeonOp(team[4], "revive"), null);
  assert.equal(team[4].dead, false);
  assert.equal(run.revives, 2);
  let t = now + 20_000;
  const step = (ms: number) => { t += ms; room.tick(t); };
  for (let stage = 1; stage <= 10; stage++) {
    assert.equal(run.n, stage);
    assert.equal(run.phase, "fight");
    if (stage === 5 || stage === 10) {
      const boss = room.mobs.get(run.bossId)!;
      assert.ok(boss && boss.fx.some((e) => e.id === "unstoppable"), "보스는 군중 제어 면역");
      for (const x of team) { x.x = x.mover.x = boss.x + 30; x.y = x.mover.y = boss.y; }
      let mark = sent.get(team[0])!.length;
      for (let i = 0; i < 60; i++) step(50);
      assert.ok(evsSince(team[0], mark).some((e) => e[0] === "w"), "보스 패턴 바닥 경고");
      boss.hp = boss.st.hp * 0.3;
      mark = sent.get(team[0])!.length;
      step(50);
      assert.ok(evsSince(team[0], mark).some((e) => e[0] === "bp"), "HP 가 떨어지면 페이즈 전환");
      if (stage === 10) {
        // 전멸기: 구슬을 못 부수면 남은 구슬마다 최대 체력의 pct
        const v = team[0];
        v.hp = v.st.hp;
        bossMove(room, boss, v, { kind: "orbs", n: 2, ms: 1000, pct: 0.1 });
        const orbs = [...room.mobs.values()].filter((m) => m.key === "purify_orb" && !m.dead);
        assert.equal(orbs.length, 2);
        for (let i = 0; i < 25; i++) step(50);
        assert.ok(orbs.every((o) => o.dead), "시간이 지나면 구슬 사라짐");
        assert.ok(v.st.hp - v.hp >= v.st.hp * 0.2 - 1, "남은 구슬 2개 × 10%");
        for (const x of team) { x.hp = x.st.hp; x.dead = false; }
      }
      die(room, boss, team[0]);
      assert.ok([...room.mobs.values()].every((m) => m.dead), "보스가 쓰러지면 졸개도 정리");
    } else {
      run.queue.length && assert.equal(stage, 9, "연속(웨이브)은 9스테이지만");
      for (let guard = 0; guard < 20 && (run.queue.length || [...room.mobs.values()].some((m) => !m.dead)); guard++) {
        for (const m of [...room.mobs.values()]) if (!m.dead) { m.dmgBy.set(team[0].id, 1); die(room, m, team[0]); }
        step(50);
      }
    }
    step(50);
    if (stage === 10) break;
    assert.equal(run.phase, "rest", `${stage}스테이지 정화 → 정비`);
    assert.match(String(D.dungeonPortal(team[2], "next")), /정비 중/);
    step(RUINS.restMs);
    step(50);
    assert.equal(run.phase, "open");
    assert.equal(D.dungeonPortal(team[2], "next"), null, "아무 파티원이나 다음 포털");
    assert.ok(team.every((x) => x.potionLeft === RUINS.potionsPerStage), "포션 수 초기화");
  }
  assert.equal(run.phase, "clear");
  for (const x of team) {
    assert.ok(x.quests.get("tut_dungeon") === undefined || x.quests.get("tut_dungeon")!.prog[0] >= 1);
    const mail = listMail(x.char.id, Date.now()).find((mm) => mm.subject === "고목왕을 쓰러뜨린 보상")!;
    assert.ok(mail, "클리어 보상 우편");
    const items = loadItemsAt(x.char.id, "mail", mail.id * 64, mail.id * 64 + 63);
    assert.ok(items.some((i) => RUINS.clear.gear.includes(i.tpl) && (i.rarity === "mythic" || i.rarity === "legendary")), "신화(또는 전설) 장비");
    assert.ok(items.some((i) => i.tpl === "enhance_stone" && i.qty === 10) && items.some((i) => i.tpl === "blessed_stone"));
    assert.deepEqual(loadTitles(x.char.id).sort(), ["first_purifier", "ruins_clear"].sort(), "칭호 + 최초 정화자");
    assert.ok(x.title && TITLES[x.title]);
  }
  const shares = team.map((x) => listMail(x.char.id, Date.now()).find((mm) => mm.subject === "고목왕을 쓰러뜨린 보상")!.attach_ruc);
  assert.equal(shares.reduce((a, b) => a + b, 0), RUINS.clear.ruc);
  assert.ok(shares[0] > shares[1], "파티장 몫이 큼");
  assert.ok(msgs(players[0], "notice").some((m) => m.text.includes("서버 최초")), "접속자 전원에게 서버 공지");
  // 귀환
  step(RUINS.returnMs * 2 + 100);
  assert.ok(team.every((x) => x.room === plaza), "끝나면 광장으로");
  step(50);
  assert.equal(D.dungeonRooms().length, 0, "빈 인스턴스는 사라짐");
});

test("던전 실패: 전원이 쓰러지면 광장으로 · 파티를 나가면 던전에서도 나감", () => {
  const [a, b] = [mk(12), mk(12)];
  P.partyOp(a, { op: "invite", name: b.char.nickname }); P.partyOp(b, { op: "accept", id: P.partyOf(a)!.id });
  const portal = maps.plaza.objects.find((o) => o.type === "portal" && o.properties?.some((p) => p.value === "dungeon"))!;
  for (const x of [a, b]) { x.x = x.mover.x = portal.x; x.y = x.mover.y = portal.y + 10; }
  assert.equal(D.enter(a), null);
  const room = a.room!;
  const run = room.inst as InstanceType<typeof D.Run>;
  let t = now;
  P.partyOp(b, { op: "leave" });
  room.tick((t += 50));
  assert.equal(b.room, plaza, "파티를 나가면 광장으로");
  die(room, a, undefined);
  room.tick((t += 50));
  assert.equal(run.phase, "fail");
  room.tick((t += RUINS.returnMs + 100));
  assert.equal(a.room, plaza);
  assert.equal(a.dead, false, "살아서 돌아옴");
});
