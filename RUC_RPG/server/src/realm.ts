import { TILE } from "../../../web/rpg/shared/constants.ts";
import { filterChat } from "../../../web/rpg/shared/data/chat.ts";
import { GRADES } from "../../../web/rpg/shared/data/mobs.ts";
import { REALM, TERRITORIES, guildLevel, terrAt, validNationName, weekEnd, weekOf } from "../../../web/rpg/shared/data/realm.ts";
import type { RealmView } from "../../../web/rpg/shared/data/social.ts";
import { FOREVER_MS } from "../../../web/rpg/shared/data/effects.ts";
import { addEffect, has, removeEffect } from "./combat.ts";
import {
  addGuildXp, addInfluence, audit, createNation, dropNation, guildById, guildByName, guildMembers, guildOf, influenceTop, logChat, nationById, nationGuilds, nationNotice,
  ruc, seedTerritory, setGuildNation, setNationRuler, setTerritory, territories, tx, type GuildRow,
} from "./db.ts";
import { online, sendWallet } from "./economy.ts";
import type { Mob } from "./mobs.ts";
import { notify } from "./quests.ts";
import { send, type Player, type Room } from "./room.ts";
import { sendSocial } from "./social.ts";

/**
 * 영지 · 국가 · 길드 경험치 (P14, §21-4 베타 편입 · D96~D98) — 규칙은 shared/data/realm.ts.
 * 영향력 · 길드 경험치는 메모리에 모았다가 30초마다 DB 로 (몹 한 마리마다 쓰지 않게).
 */
for (const t of TERRITORIES) seedTerritory(t.id, t.name);
let terrs = territories();
const infl = new Map<string, number>();
const gxp = new Map<number, number>();
const invites = new Map<number, Set<number>>(); // 국가 id → 초대받은 길드 id

export const ownerOf = (terr: number) => terrs.find((t) => t.id === terr)?.owner_guild ?? null;
export function guildXp(gid: number, n: number) {
  gxp.set(gid, (gxp.get(gid) ?? 0) + n);
}
export function flushRealm() {
  if (!infl.size && !gxp.size) return;
  tx(() => {
    for (const [k, v] of infl) { const [t, g, w] = k.split(":").map(Number); addInfluence(t, g, w, v); }
    for (const [g, v] of gxp) addGuildXp(g, v);
  });
  infl.clear();
  gxp.clear();
}
const mapPx = (room: Room) => [room.map.w * TILE, room.map.h * TILE] as const;
const sys = (q: Player, text: string) => send(q, { t: "chat", ch: "system", from: "", text, at: Date.now() });

/** 몹 처치 (room hooks.kill): 처치한 사람 길드 경험치(등급 배율) · 필드면 그 영지 영향력 · 영주 길드 세금 */
export function realmKill(room: Room, m: Mob, best: Player | undefined) {
  const gi = Object.keys(GRADES).indexOf(m.grade) + 1;
  if (best?.guild) guildXp(best.guild.id, gi);
  if (room.kind !== "field") return;
  const t = terrAt(m.x, m.y, ...mapPx(room));
  if (!t) return;
  if (best?.guild) {
    const k = `${t.id}:${best.guild.id}:${weekOf(Date.now())}`;
    infl.set(k, (infl.get(k) ?? 0) + gi * 10);
  }
  const owner = ownerOf(t.id);
  if (owner) guildXp(owner, 1);
}

/** 이 길드원이 이 영지의 가호를 받는가: 영주 길드이거나 영주와 같은 국가 */
function blessed(p: Player, terr: number) {
  const owner = ownerOf(terr);
  if (!owner || !p.guild) return false;
  if (owner === p.guild.id) return true;
  return !!p.nation && guildById(owner)?.nation_id === p.nation.id;
}

/** 매초 (room hooks.sec): 필드에서 영지의 가호 켜고 끔 */
export function realmSec(room: Room) {
  if (room.kind !== "field") return;
  const [w, h] = mapPx(room);
  for (const p of room.players.values()) {
    if (p.dead) continue;
    const t = terrAt(p.x, p.y, w, h);
    const on = !!t && blessed(p, t.id);
    if (on && !has(p, "terr_bless")) addEffect(room, p, { id: "terr_bless", ms: FOREVER_MS }, p);
    else if (!on && has(p, "terr_bless")) removeEffect(room, p, "terr_bless");
  }
}

/** 주간 정산: 지난주 영향력 1위가 이번 주 영주 (아무도 없으면 그대로). force = 이번 주 영향력으로 바로 (GM · 테스트) */
export function settleWeek(now: number, force = false) {
  flushRealm();
  const cur = weekOf(now);
  let changed = false;
  for (const t of territories()) {
    if (!force && t.week >= cur) continue;
    const top = influenceTop(t.id, force ? cur : cur - 1, 1)[0];
    const owner = top?.gid ?? t.owner_guild;
    setTerritory(t.id, owner, cur);
    if (top && top.gid !== t.owner_guild) {
      changed = true;
      const text = `‹${top.name}› 길드가 「${t.name}」의 새 영주가 되었습니다!`;
      for (const o of online.all()) send(o, { t: "notice", text });
      for (const mem of guildMembers(top.gid)) notify(mem.cid, "system", `우리 길드가 「${t.name}」의 영주가 되었어요 — 그 영지에서 경험치 +10% · 이동 속도 +5%`);
    }
  }
  terrs = territories();
  if (changed) for (const o of online.all()) sendSocial(o);
}

/** 소셜 창의 영지 · 국가 */
export function realmView(g: GuildRow | null): RealmView {
  const week = weekOf(Date.now());
  flushRealm();
  const nation = g?.nation_id ? nationById(g.nation_id) : null;
  return {
    week, ends: weekEnd(week),
    terr: terrs.map((t) => {
      const top = influenceTop(t.id, week, 3);
      return {
        id: t.id, name: t.name, owner: t.owner_guild ? (guildById(t.owner_guild)?.name ?? null) : null,
        top: top.map((x) => ({ name: x.name, points: x.points })), mine: g ? (influenceTop(t.id, week, 100).find((x) => x.gid === g.id)?.points ?? 0) : 0,
      };
    }),
    nation: nation && {
      id: nation.id, name: nation.name, notice: nation.notice, ruler: guildById(nation.ruler_guild)?.name ?? "?",
      guilds: nationGuilds(nation.id).map((x) => ({ name: x.name, lands: terrs.filter((t) => t.owner_guild === x.id).length, ruler: x.id === nation.ruler_guild })),
    },
  };
}

// ── 국가 ──────────────────────────────────────────────────────────────
/** 길드원 모두의 이름표 국가를 바꿈 */
function setNationOf(gid: number, n: { id: number; name: string } | null) {
  for (const mem of guildMembers(gid)) {
    const q = online.byChar(mem.cid);
    if (!q) continue;
    q.nation = n;
    q.room?.ev.push(["nt", q.id, n?.name ?? ""]);
    sendSocial(q);
  }
}
const resendNation = (nid: number) => { for (const g of nationGuilds(nid)) setNationOf(g.id, { id: nid, name: nationById(nid)!.name }); };

export function nationOp(p: Player, m: { op?: unknown; name?: unknown; id?: unknown; text?: unknown }): string | null {
  const g = guildOf(p.char.id);
  if (!g) return "길드에 들어 있어야 합니다";
  const master = g.master_id === p.char.id;
  const nation = g.nation_id ? nationById(g.nation_id) : null;
  const ruler = !!nation && nation.ruler_guild === g.id && master;
  switch (m.op) {
    case "found": {
      if (!master) return "길드장만 국가를 세울 수 있습니다";
      if (nation) return "이미 국가에 속해 있습니다";
      if (!terrs.some((t) => t.owner_guild === g.id)) return "영지를 가진 길드만 국가를 세울 수 있습니다";
      const name = typeof m.name === "string" ? m.name.trim() : "";
      if (!validNationName(name)) return "국가 이름은 한글 · 영문 · 숫자 2~10자입니다";
      if (filterChat(name) !== name) return "쓸 수 없는 이름입니다";
      if (p.ruc < REALM.nationRuc) return `국가를 세우려면 ${REALM.nationRuc.toLocaleString()} RUC 가 필요합니다`;
      let id: number | null;
      try {
        id = tx(() => {
          const nid = createNation(name, g.id);
          if (nid) p.ruc = ruc(p.char.id, -REALM.nationRuc, "nation_found", String(nid), `nation_found:${nid}`).balance;
          return nid;
        });
      } catch {
        return `RUC 가 부족합니다 (${REALM.nationRuc.toLocaleString()} RUC)`;
      }
      if (!id) return "이미 있는 국가 이름입니다";
      audit(p.char.id, "nation_found", String(id), null, { name, guild: g.id });
      sendWallet(p);
      setNationOf(g.id, { id, name });
      for (const o of online.all()) send(o, { t: "notice", text: `‹${g.name}› 길드가 국가 «${name}»을(를) 세웠습니다!` });
      return null;
    }
    case "invite": {
      if (!ruler) return "국가의 군주(군주 길드의 길드장)만 초대할 수 있습니다";
      const to = typeof m.name === "string" ? guildByName(m.name.trim()) : null;
      if (!to) return "없는 길드입니다";
      if (to.nation_id) return "이미 국가에 속한 길드입니다";
      if (!invites.has(nation!.id)) invites.set(nation!.id, new Set());
      invites.get(nation!.id)!.add(to.id);
      notify(to.master_id, "nation_invite", `국가 «${nation!.name}»이(가) 길드 ‹${to.name}›을(를) 초대했어요`, { nid: nation!.id, name: nation!.name });
      sys(p, `길드 ‹${to.name}›에 국가 초대를 보냈어요`);
      return null;
    }
    case "accept":
    case "decline": {
      const nid = Number(m.id);
      if (!master) return "길드장만 할 수 있습니다";
      if (!invites.get(nid)?.delete(g.id)) return "받은 국가 초대가 없거나 기한이 지났습니다";
      if (m.op === "decline") return null;
      if (nation) return "이미 국가에 속해 있습니다";
      const n = nationById(nid);
      if (!n) return "없어진 국가입니다";
      setGuildNation(g.id, nid);
      resendNation(nid);
      const rm = guildById(n.ruler_guild);
      if (rm) notify(rm.master_id, "system", `길드 ‹${g.name}›이(가) 국가 «${n.name}»에 들어왔어요`);
      return null;
    }
    case "leave": {
      if (!nation) return "국가에 속해 있지 않습니다";
      if (!master) return "길드장만 할 수 있습니다";
      if (nation.ruler_guild === g.id) return "군주 길드는 국가를 해산해야 나갈 수 있습니다";
      setGuildNation(g.id, null);
      setNationOf(g.id, null);
      resendNation(nation.id);
      return null;
    }
    case "expel": {
      if (!ruler) return "군주만 할 수 있습니다";
      const to = typeof m.name === "string" ? guildByName(m.name.trim()) : null;
      if (!to || to.nation_id !== nation!.id || to.id === g.id) return "우리 국가의 다른 길드가 아닙니다";
      setGuildNation(to.id, null);
      setNationOf(to.id, null);
      notify(to.master_id, "system", `길드 ‹${to.name}›이(가) 국가 «${nation!.name}»에서 추방되었어요`);
      resendNation(nation!.id);
      return null;
    }
    case "notice": {
      if (!ruler) return "군주만 할 수 있습니다";
      const text = filterChat(String(m.text ?? "").replace(/\s+/g, " ").trim().slice(0, REALM.nationNoticeMax));
      nationNotice(nation!.id, text);
      resendNation(nation!.id);
      return null;
    }
    case "disband": {
      if (!ruler) return "군주만 해산할 수 있습니다";
      const list = nationGuilds(nation!.id);
      dropNation(nation!.id);
      invites.delete(nation!.id);
      audit(p.char.id, "nation_disband", String(nation!.id), { name: nation!.name }, null);
      for (const x of list) setNationOf(x.id, null);
      return null;
    }
    default:
      return "잘못된 요청입니다";
  }
}

/** 군주 길드가 해산되면: 다른 길드에 군주를 넘기거나(가장 오래된 길드) 국가를 해산 (social.ts 가 부름) */
export function guildGone(gid: number, nid: number | null) {
  if (!nid) return;
  const n = nationById(nid);
  if (!n || n.ruler_guild !== gid) return;
  const rest = nationGuilds(nid).filter((x) => x.id !== gid);
  if (rest.length) { setNationRuler(nid, rest[0].id); resendNation(nid); }
  else dropNation(nid);
}

/** 국가 채팅 (/n 말) — 국가의 모든 길드의 접속한 길드원에게 */
export function nationSay(p: Player, text: string): string | null {
  if (!p.nation) return "국가에 속해 있지 않습니다 (O 소셜 창 → 영지 · 국가)";
  const at = Date.now();
  for (const g of nationGuilds(p.nation.id))
    for (const mem of guildMembers(g.id)) { const q = online.byChar(mem.cid); if (q) send(q, { t: "chat", ch: "nation", from: p.char.nickname, text, at }); }
  logChat("nation", p.char.id, null, null, `nation:${p.nation.id}`, text);
  return null;
}

/** 접속할 때 국가 (이름표) */
export function nationOfGuild(g: GuildRow | null) {
  const n = g?.nation_id ? nationById(g.nation_id) : null;
  return n && { id: n.id, name: n.name };
}
export const levelOf = (g: GuildRow) => guildLevel(g.xp + (gxp.get(g.id) ?? 0));
