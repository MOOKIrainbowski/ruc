// 퀘스트 · 알림 (P6): 튜토리얼 흐름 · 서버 이벤트로만 진행 · 보상 우편 · 유저 퀘스트(에스크로 · 처치 · 전달 · 취소 · 만료) · 알림
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";

process.env.RPG_DB_FILE = `test-quest-${process.pid}.sqlite`;
const { TUTORIAL, FOUNTAIN_SPOTS, USER_QUEST, userQuestFee } = await import("../../../web/rpg/shared/data/quests.ts");
const { loadMap } = await import("../../../web/rpg/shared/map.ts");
const { createCharacter, db, listMail, listNotis, loadItem, userQuest } = await import("../src/db.ts");
const E = await import("../src/economy.ts");
const Q = await import("../src/quests.ts");
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
  const c = createCharacter(`q${++n}`, `모험가${n}`, "fire", ap)!;
  const sent: string[] = [];
  const p = buildPlayer({ readyState: 1, send: (s: string) => sent.push(s) } as never, c.discord_id, c, map.spawn.x, map.spawn.y);
  room.add(p);
  players.push(p);
  E.welcome(p);
  Q.loadQuestState(p);
  return { p, sent };
}
const claimAll = (p: Player) => { for (const m of listMail(p.char.id, Date.now())) assert.equal(E.claimMail(p, m.id), null); };
const active = (p: Player) => [...p.quests.values()].filter((q) => q.state === "active").map((q) => q.quest_id);
const qty = (p: Player, tpl: string) => p.items.filter((i) => i.tpl === tpl).reduce((a, i) => a + i.qty, 0);

test("튜토리얼: 새 캐릭터는 첫 퀘스트부터, 서버가 본 일만 진행도를 올리고, 끝나면 보상 우편 + 다음 퀘스트", () => {
  const { p, sent } = mk();
  assert.deepEqual(active(p), ["tut_talk"]);
  // 다른 NPC · 엉뚱한 이벤트는 무시
  Q.quest(p, "talk", "sera");
  Q.quest(p, "kill", "slime");
  assert.deepEqual(active(p), ["tut_talk"]);
  Q.quest(p, "talk", "lumi");
  assert.deepEqual(active(p), ["tut_fountain"]);
  assert.ok(sent.some((s) => s.includes('"t":"qpop"') && s.includes("첫 인사")), "완료 팝업");
  assert.ok(listNotis(p.char.id).some((x) => x.kind === "quest_complete"), "완료 알림 저장");

  // 분수: 네 곳 — 같은 곳을 두 번 지나도 한 번만
  p.room = room;
  for (const s of FOUNTAIN_SPOTS.slice(0, 2)) { p.x = s.x; p.y = s.y; Q.reachTick(p); Q.reachTick(p); }
  assert.deepEqual(p.quests.get("tut_fountain")!.prog, [2]);
  for (const s of FOUNTAIN_SPOTS.slice(2)) { p.x = s.x; p.y = s.y; Q.reachTick(p); }
  assert.deepEqual(active(p), ["tut_roll"]);

  // 구르기 3번 → 보상 우편(포션 3 + 100 RUC) + 우편 퀘스트
  const before = p.ruc;
  for (let i = 0; i < 3; i++) Q.quest(p, "roll");
  assert.deepEqual(active(p), ["tut_mail"]);
  assert.equal(p.ruc, before, "보상은 우편으로 — 받기 전에는 지갑이 그대로");
  assert.equal(E.claimMail(p, listMail(p.char.id, Date.now()).find((m) => m.subject.includes("데구루루"))!.id), null);
  Q.quest(p, "claim"); // econOp 가 부르는 일
  assert.equal(p.ruc, before + 100);
});

test("튜토리얼 전체: 13단계(P7 파티 · 던전 포함)가 이어지고 마지막(세라와 대화)까지 완료, 같은 목표를 다시 채워도 두 번 보상하지 않음", () => {
  const { p } = mk();
  const mails0 = listMail(p.char.id, Date.now()).length;
  const step: Record<string, () => void> = {
    tut_talk: () => Q.quest(p, "talk", "lumi"),
    tut_fountain: () => { p.room = room; for (const s of FOUNTAIN_SPOTS) { p.x = s.x; p.y = s.y; Q.reachTick(p); } },
    tut_roll: () => { for (let i = 0; i < 3; i++) Q.quest(p, "roll"); },
    tut_mail: () => Q.quest(p, "claim"),
    tut_shop: () => Q.quest(p, "buy"),
    tut_attack: () => { for (let i = 0; i < 3; i++) Q.quest(p, "cast", "A"); Q.quest(p, "cast", "Q"); },
    tut_slime: () => { for (let i = 0; i < 5; i++) Q.quest(p, "kill", "slime"); },
    tut_enhance: () => Q.quest(p, "enhance"),
    tut_skill: () => Q.quest(p, "equip"),
    tut_party: () => Q.quest(p, "party"),
    // 스테이지 도달은 가장 높은 스테이지 — 같은 스테이지를 또 깨도 그대로, 더 높으면 바로 채워짐
    tut_dungeon: () => { Q.quest(p, "stage", "field", 1); assert.deepEqual(active(p), ["tut_dungeon"], "다른 던전은 안 셈"); Q.quest(p, "stage", "ruins", 2); },
    tut_lv10: () => { p.char.level = 10; Q.quest(p, "level"); },
    tut_job: () => Q.quest(p, "talk", "sera"),
  };
  for (const def of TUTORIAL) {
    assert.deepEqual(active(p), [def.id], `${def.id} 차례`);
    step[def.id]();
  }
  assert.deepEqual(active(p), []);
  assert.equal([...p.quests.values()].filter((q) => q.state === "done").length, TUTORIAL.length);
  const mails = listMail(p.char.id, Date.now());
  assert.equal(mails.length - mails0, TUTORIAL.filter((d) => d.reward.ruc || d.reward.items).length, "보상 있는 단계마다 우편 한 통");
  // 끝난 퀘스트는 이벤트가 다시 와도 변하지 않음
  Q.quest(p, "talk", "sera");
  assert.equal(listMail(p.char.id, Date.now()).length, mails.length);
  // 다시 접속해도 상태 유지
  p.quests = new Map();
  Q.loadQuestState(p);
  assert.deepEqual(active(p), []);
  assert.equal(p.quests.size, TUTORIAL.length);
});

test("유저 퀘스트(처치): 보상 RUC · 수수료 에스크로 → 수락 → 처치 → 보상 우편 → 알림, 자기 퀘스트 수락 불가", () => {
  const a = mk().p;
  const b = mk().p;
  claimAll(a);
  claimAll(b);
  const ruc0 = a.ruc;
  assert.equal(Q.uqCreate(a, { title: "슬라임 좀 잡아줘", kind: "kill", target: "slime", n: 2, ruc: 100, slots: 1, days: 3, rid: "rid-uq-1111" }), null);
  const fee = userQuestFee(100, 1);
  assert.equal(fee, 3);
  assert.equal(a.ruc, ruc0 - 103);
  const row = [...(db.prepare("SELECT id FROM rpg_user_quests").all() as { id: number }[])].at(-1)!;
  // 같은 요청 id 로 또 보내면 한 번만
  assert.notEqual(Q.uqCreate(a, { title: "슬라임 좀 잡아줘", kind: "kill", target: "slime", n: 2, ruc: 100, slots: 1, days: 3, rid: "rid-uq-1111" }), null);
  assert.equal(a.ruc, ruc0 - 103);
  assert.match(Q.uqAccept(a, row.id) ?? "", /내가 올린/);
  assert.equal(Q.uqAccept(b, row.id), null);
  assert.match(Q.uqAccept(b, row.id) ?? "", /이미 받은/);
  assert.ok(listNotis(a.char.id).some((x) => x.kind === "quest_accepted_by"));
  // 자리 1개라 세 번째 사람은 못 받음
  const c = mk().p;
  assert.match(Q.uqAccept(c, row.id) ?? "", /자리/);
  Q.quest(b, "kill", "rabbit");
  assert.equal(b.takes.get(row.id), 0, "다른 몹은 세지 않음");
  Q.quest(b, "kill", "slime");
  Q.quest(b, "kill", "slime");
  assert.equal(b.takes.has(row.id), false, "완료되면 목록에서 빠짐");
  const reward = listMail(b.char.id, Date.now()).find((m) => m.subject.includes("슬라임 좀"))!;
  assert.equal(reward.attach_ruc, 100);
  assert.equal(userQuest(row.id)!.status, "closed", "마지막 자리가 끝나 마감");
  // 이미 끝난 퀘스트는 더 못 받음 / 같은 몹을 또 잡아도 보상 중복 없음
  Q.quest(b, "kill", "slime");
  assert.equal(listMail(b.char.id, Date.now()).filter((m) => m.subject.includes("슬라임 좀")).length, 1);
});

test("유저 퀘스트(전달) · 아이템 보상 에스크로: 전달하면 등록자에게 물품 우편, 받은 사람에게 아이템 보상, 취소 규칙", () => {
  const a = mk().p;
  const b = mk().p;
  const c0 = mk().p;
  claimAll(a);
  claimAll(b);
  give(a, "wood_sword", 1, "common", "test");
  const pos = a.items.find((i) => i.tpl === "wood_sword")!;
  const ids = [pos.id];
  assert.equal(Q.uqCreate(a, { title: "포션 부탁", kind: "deliver", target: "hp_potion_s", n: 3, ruc: 0, list: [[pos.loc, pos.slot]], slots: 1, days: 2, rid: "rid-uq-2222" }), null);
  const q = (db.prepare("SELECT id FROM rpg_user_quests ORDER BY id DESC").get() as { id: number }).id;
  assert.equal(loadItem(ids[0])!.loc, "escrow");
  assert.equal(a.items.some((i) => i.id === ids[0]), false, "내 가방에서 빠짐");
  assert.equal(Q.uqAccept(b, q), null);
  assert.match(Q.uqCancel(a, q) ?? "", /진행 중인 사람/, "받은 사람이 있으면 못 내림");
  assert.equal(qty(b, "hp_potion_s"), 5);
  assert.match(Q.uqDeliver(c0, q, "rid-del-0001") ?? "", /받은 전달 퀘스트가 아닙니다/);
  assert.equal(Q.uqDeliver(b, q, "rid-del-0002"), null);
  assert.equal(qty(b, "hp_potion_s"), 2, "물품 3개가 가방에서 빠짐");
  // 같은 요청 반복 / 이미 끝남
  assert.notEqual(Q.uqDeliver(b, q, "rid-del-0002"), null);
  claimAll(a);
  claimAll(b);
  assert.equal(qty(a, "hp_potion_s"), 5 + 3, "등록자가 물품 3개를 받음");
  assert.equal(b.items.filter((i) => i.tpl === "wood_sword").length, 1, "받은 사람이 보상 아이템을 받음");
  assert.equal(loadItem(ids[0])!.loc === "escrow", false);
});

test("유저 퀘스트: 취소 · 만료 시 남은 보상 우편 반환, 규칙 검사(수량 · 3건 제한 · 비어 있는 보상 · 다인 아이템)", () => {
  const a = mk().p;
  claimAll(a);
  assert.match(Q.uqCreate(a, { title: "x", kind: "kill", target: "slime", n: 1, ruc: 10, slots: 1, rid: "rid-bad-0001" }) ?? "", /제목/);
  assert.match(Q.uqCreate(a, { title: "빈 보상", kind: "kill", target: "slime", n: 1, ruc: 0, slots: 1, rid: "rid-bad-0002" }) ?? "", /보상이 비어/);
  assert.match(Q.uqCreate(a, { title: "없는 몹", kind: "kill", target: "dragon", n: 1, ruc: 10, slots: 1, rid: "rid-bad-0003" }) ?? "", /대상/);
  assert.match(Q.uqCreate(a, { title: "너무 많음", kind: "kill", target: "slime", n: USER_QUEST.maxN + 1, ruc: 10, slots: 1, rid: "rid-bad-0004" }) ?? "", /수량/);
  assert.match(Q.uqCreate(a, { title: "RUC 부족", kind: "kill", target: "slime", n: 1, ruc: 5_000_000, slots: 1, rid: "rid-bad-0005" }) ?? "", /RUC/);
  const before = a.ruc;
  assert.equal(Q.uqCreate(a, { title: "취소할 것", kind: "kill", target: "wolf", n: 1, ruc: 50, slots: 2, days: 1, rid: "rid-ok-0001" }), null);
  assert.equal(a.ruc, before - 100 - userQuestFee(50, 2));
  const id = (db.prepare("SELECT id FROM rpg_user_quests ORDER BY id DESC").get() as { id: number }).id;
  assert.equal(Q.uqCancel(a, id), null);
  assert.equal(userQuest(id)!.status, "closed");
  const back = listMail(a.char.id, Date.now()).find((m) => m.subject.includes("반환"))!;
  assert.equal(back.attach_ruc, 100, "남은 보상은 돌려받고 수수료만 사라짐");
  assert.match(Q.uqCancel(a, id) ?? "", /이미 마감/);

  // 3건 제한
  for (let i = 0; i < USER_QUEST.maxActive; i++) assert.equal(Q.uqCreate(a, { title: `동시 ${i}`, kind: "kill", target: "slime", n: 1, ruc: 1, slots: 1, rid: `rid-many-000${i}` }), null);
  assert.match(Q.uqCreate(a, { title: "넷째", kind: "kill", target: "slime", n: 1, ruc: 1, slots: 1, rid: "rid-many-0009" }) ?? "", /동시에/);

  // 만료: 기한 지난 것을 정리하면 남은 보상이 우편으로
  db.prepare("UPDATE rpg_user_quests SET expires_at = ? WHERE owner_id = ? AND status = 'open'").run(Date.now() - 1, a.char.id);
  const mailsBefore = listMail(a.char.id, Date.now()).length;
  Q.sweepQuests(Date.now());
  assert.equal((db.prepare("SELECT COUNT(*) AS n FROM rpg_user_quests WHERE owner_id = ? AND status = 'open'").get(a.char.id) as { n: number }).n, 0);
  assert.equal(listMail(a.char.id, Date.now()).length - mailsBefore, USER_QUEST.maxActive);
  assert.ok(listNotis(a.char.id).some((x) => x.text.includes("기한")));
});

test("알림: 저장 · 접속 중이면 바로 푸시 · 읽음 처리 · unique 는 안 읽은 같은 종류를 한 번만", () => {
  const { p, sent } = mk();
  Q.notify(p.char.id, "gift", "선물이 도착했어요");
  assert.ok(sent.some((s) => s.includes('"t":"noti"') && s.includes("선물") && s.includes('"toast":true')), "중요한 알림은 토스트");
  Q.notify(p.char.id, "system", "조용한 알림");
  assert.ok(sent.some((s) => s.includes("조용한 알림") && s.includes('"toast":false')));
  Q.notify(p.char.id, "mail_unclaimed", "우편 1통", undefined, true);
  Q.notify(p.char.id, "mail_unclaimed", "우편 2통", undefined, true);
  assert.equal(listNotis(p.char.id).filter((x) => x.kind === "mail_unclaimed").length, 1);
  const list = listNotis(p.char.id);
  Q.notiOp(p, "read", list[0].id);
  assert.equal(listNotis(p.char.id).find((x) => x.id === list[0].id)!.read, 1);
  Q.notiOp(p, "readAll", undefined);
  assert.ok(listNotis(p.char.id).every((x) => x.read === 1));
  // 오프라인 사용자에게도 쌓임
  const gone = mk().p;
  players.splice(players.indexOf(gone), 1);
  Q.notify(gone.char.id, "system", "오프라인 알림");
  assert.ok(listNotis(gone.char.id).some((x) => x.text === "오프라인 알림"));
});
