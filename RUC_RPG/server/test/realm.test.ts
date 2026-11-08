// P14 영지 · 국가 · 길드 확장: 몹 처치 → 길드 경험치 · 영향력 → 주간 정산(영주) → 영지의 가호 · 세금, 국가(세우기 조건 · 초대 · 채팅 · 이름표 · 해산), 길드 창고(넣기 · 꺼내기 · 위임 · 해산 우편)
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";

process.env.RPG_DB_FILE = `test-realm-${process.pid}.sqlite`;
const { loadMap } = await import("../../../web/rpg/shared/map.ts");
const { TILE } = await import("../../../web/rpg/shared/constants.ts");
const { TERRITORIES, REALM, guildBankCap, guildLevel } = await import("../../../web/rpg/shared/data/realm.ts");
const { GUILD } = await import("../../../web/rpg/shared/data/social.ts");
const { createCharacter, db, gbankItems, guildOf, listNotis, ruc } = await import("../src/db.ts");
const E = await import("../src/economy.ts");
const S = await import("../src/social.ts");
const R = await import("../src/realm.ts");
const { chatOp } = await import("../src/chat.ts");
const { give } = await import("../src/items.ts");
const { has } = await import("../src/combat.ts");
const { Room, buildPlayer, hooks } = await import("../src/room.ts");
test.after(() => {
  db.close();
  for (const ext of ["", "-wal", "-shm"]) rmSync(fileURLToPath(new URL(`../data/${process.env.RPG_DB_FILE}${ext}`, import.meta.url)), { force: true });
});
type Player = import("../src/room.ts").Player;
type Mob = import("../src/mobs.ts").Mob;

hooks.kill = R.realmKill;
hooks.sec = R.realmSec;
const fieldMap = loadMap(JSON.parse(readFileSync(new URL("../../../web/rpg/shared/data/maps/field.json", import.meta.url), "utf8")));
const field = new Room("field", 1, fieldMap, 4_000_000);
const players: Player[] = [];
E.online.byChar = (id) => players.find((p) => p.char.id === id);
E.online.all = () => players;
const ap = { hair: 0, hairColor: 0, skin: 0, eyes: 0 };
let n = 0;
const out = new Map<Player, string[]>();
function mk() {
  const c = createCharacter(`rl${++n}`, `영주${n}`, "fire", ap)!;
  const box: string[] = [];
  const p = buildPlayer({ readyState: 1, send: (s: string) => box.push(String(s)) } as never, c.discord_id, c, fieldMap.spawn.x, fieldMap.spawn.y);
  out.set(p, box);
  field.add(p);
  players.push(p);
  E.welcome(p);
  S.socialLogin(p);
  return p;
}
const rich = (p: Player, amt: number) => { p.ruc = ruc(p.char.id, amt, "test", null, `rich:${p.char.id}:${amt}`).balance; };
const social = (p: Player) => out.get(p)!.filter((s) => s.startsWith('{"t":"social"')).map((s) => JSON.parse(s)).at(-1)!.s;
const W = fieldMap.w * TILE;
const Hh = fieldMap.h * TILE;
/** 영지 t 안의 몹 하나를 b 가 처치한 것으로 */
function kill(t: number, b: Player) {
  const m = [...field.mobs.values()].find((x) => !x.dead)! as Mob;
  const tr = TERRITORIES.find((x) => x.id === t)!;
  m.x = ((tr.x0 + tr.x1) / 2) * W;
  m.y = ((tr.y0 + tr.y1) / 2) * Hh;
  R.realmKill(field, m, b);
}

test("영향력 → 주간 정산 → 영주 · 영지의 가호 · 세금 · 길드 경험치", () => {
  const a = mk();
  const b = mk();
  rich(a, GUILD.createRuc);
  rich(b, GUILD.createRuc);
  assert.equal(S.guildOp(a, { op: "create", name: "아침해" }), null);
  assert.equal(S.guildOp(b, { op: "create", name: "저녁달" }), null);
  for (let i = 0; i < 5; i++) kill(1, a);
  for (let i = 0; i < 2; i++) kill(1, b);
  R.settleWeek(Date.now(), true);
  const v = R.realmView(guildOf(a.char.id)!);
  assert.equal(v.terr.find((t) => t.id === 1)!.owner, "아침해");
  assert.ok(v.terr[0].top[0].points > v.terr[0].top[1].points);
  assert.equal(R.ownerOf(1), guildOf(a.char.id)!.id);
  // 가호: 영지 1 안의 영주 길드원만
  a.x = 0.25 * W; a.y = 0.25 * Hh;
  b.x = 0.25 * W; b.y = 0.25 * Hh;
  R.realmSec(field);
  assert.ok(has(a, "terr_bless") && !has(b, "terr_bless"));
  a.x = 0.75 * W;
  R.realmSec(field);
  assert.ok(!has(a, "terr_bless"), "영지를 벗어나면 꺼짐");
  // 세금: 영지 1 에서 b 가 잡아도 a 길드 경험치
  const gxp0 = guildOf(a.char.id)!.xp;
  kill(1, b);
  R.flushRealm();
  assert.equal(guildOf(a.char.id)!.xp, gxp0 + 1);
  assert.equal(guildLevel(0), 1);
  assert.ok(social(a).guild.level >= 1 && social(a).realm.terr.length === 4);
});

test("국가: 영지가 있어야 세움 · RUC · 다른 길드 초대 → 수락 · 국가 채팅 · 이름표 · 해산", () => {
  const a = players.find((p) => p.guild?.name === "아침해")!;
  const b = players.find((p) => p.guild?.name === "저녁달")!;
  assert.match(R.nationOp(b, { op: "found", name: "달나라" })!, /영지를 가진/);
  rich(a, REALM.nationRuc);
  assert.equal(R.nationOp(a, { op: "found", name: "해나라" }), null);
  assert.equal(a.nation?.name, "해나라");
  assert.ok(field.ev.some((e) => e[0] === "nt" && e[1] === a.id));
  assert.equal(R.nationOp(a, { op: "invite", name: "저녁달" }), null);
  const inv = JSON.parse(listNotis(b.char.id).find((x) => x.kind === "nation_invite")!.data!);
  assert.equal(R.nationOp(b, { op: "accept", id: inv.nid }), null);
  assert.equal(b.nation?.name, "해나라");
  // 같은 국가 → b 도 a 의 영지에서 가호
  b.x = 0.25 * W; b.y = 0.25 * Hh;
  R.realmSec(field);
  assert.ok(has(b, "terr_bless"));
  assert.equal(chatOp(b, { text: "/n 국가 만세" }), null);
  assert.ok(out.get(a)!.some((s) => s.includes('"ch":"nation"') && s.includes("국가 만세")));
  assert.match(R.nationOp(b, { op: "disband" })!, /군주만/);
  assert.equal(R.nationOp(a, { op: "disband" }), null);
  assert.equal(a.nation, null);
  assert.equal(b.nation, null);
});

test("길드 창고: 넣기(길드원) · 꺼내기(길드장만) · 칸 수 · 위임 때 넘김 · 해산하면 우편", () => {
  const m = mk();
  const x = mk();
  rich(m, GUILD.createRuc);
  assert.equal(S.guildOp(m, { op: "create", name: "곳간" }), null);
  assert.equal(S.guildOp(m, { op: "invite", name: x.char.nickname }), null);
  const inv = JSON.parse(listNotis(x.char.id).find((q) => q.kind === "guild_invite")!.data!);
  assert.equal(S.guildOp(x, { op: "accept", id: inv.gid }), null);
  give(x, "hp_potion_s", 10, "common", "test");
  const it = x.items.find((i) => i.tpl === "hp_potion_s")!;
  assert.equal(S.guildOp(x, { op: "deposit", a: [it.loc, it.slot], n: 4 }), null);
  assert.equal(x.items.find((i) => i.tpl === "hp_potion_s")!.qty, 6);
  const bank = gbankItems(m.char.id);
  assert.equal(bank.length, 1);
  assert.equal(bank[0].qty, 4);
  assert.equal(social(x).guild.bankCap, guildBankCap(1));
  assert.match(S.guildOp(x, { op: "withdraw", id: bank[0].id })!, /길드장만/);
  // 위임 → 창고도 새 길드장에게
  assert.equal(S.guildOp(m, { op: "promote", cid: x.char.id }), null);
  assert.equal(gbankItems(m.char.id).length, 0);
  assert.equal(gbankItems(x.char.id).length, 1);
  assert.equal(S.guildOp(x, { op: "withdraw", id: bank[0].id }), null);
  assert.equal(x.items.filter((i) => i.tpl === "hp_potion_s").reduce((a, i) => a + i.qty, 0), 10);
  // 다시 넣고 해산 → 길드장 우편으로
  const it2 = x.items.find((i) => i.tpl === "hp_potion_s")!;
  assert.equal(S.guildOp(x, { op: "deposit", a: [it2.loc, it2.slot], n: 2 }), null);
  assert.equal(S.guildOp(x, { op: "disband" }), null);
  assert.equal(gbankItems(x.char.id).length, 0);
  assert.ok(E.mailView(x).some((ml) => ml.reason === "gbank" && ml.items[0]?.qty === 2));
});
