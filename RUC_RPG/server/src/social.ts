import { filterChat } from "../../../web/rpg/shared/data/chat.ts";
import { CHAT_LOG, FRIEND, GUILD, validGuildName, type SocialView } from "../../../web/rpg/shared/data/social.ts";
import {
  audit, charByName, createGuild, gbankItems, moveGbank, saveItems, transferItem, delRelation, dropGuild, findCharacterById, guildById, guildByName, guildChat, guildMembers, guildOf, incomingOf, joinGuild, leaveGuild,
  logChat, relation, relationsOf, ruc, setGuildMaster, setGuildNotice, setRelation, tx, whispers,
} from "./db.ts";
import { atomic, mail, online, sendWallet, take } from "./economy.ts";
import type { Item } from "../../../web/rpg/shared/data/items.ts";
import { sendInv } from "./items.ts";
import { ITEMS } from "../../../web/rpg/shared/data/items.ts";
import { notify } from "./quests.ts";
import { guildGone, levelOf, nationOfGuild, realmView } from "./realm.ts";
import { guildBankCap, guildMaxMembers, guildNext } from "../../../web/rpg/shared/data/realm.ts";
import { freeSlot } from "./items.ts";
import { send, type Player } from "./room.ts";

/**
 * 소셜 (P10, D86~D89): 친구 · 차단 · 귓속말 · 접속 알림 · 길드 기초 · 길드 채팅 · 채팅 저장.
 * 친구 신청 · 길드 초대/신청은 알림(§22)으로 가고 거기서 수락. 길드 초대 · 신청 대기는 메모리(서버가 다시 켜지면 다시 보내면 됨).
 */

const invites = new Map<number, Set<number>>(); // 길드 id → 초대받은 캐릭터
const applies = new Map<number, Set<number>>(); // 길드 id → 가입 신청한 캐릭터
const lastWhisper = new Map<number, number>(); // 캐릭터 → 마지막으로 귓속말을 주고받은 상대 (/r)

const say = (q: Player, ch: "system" | "whisper" | "guild", from: string, text: string, to?: string, at = Date.now()) =>
  send(q, { t: "chat", ch, from, text, at, ...(to ? { to } : {}) });
const blocks = (a: number, b: number) => relation(a, b) === "block";
const tell = (p: Player, text: string) => say(p, "system", "", text);

/** 소셜 창 데이터 */
export function socialView(cid: number): SocialView {
  const rel = relationsOf(cid);
  const where = (id: number) => online.byChar(id)?.room?.kind ?? "";
  const g = guildOf(cid);
  const lv = g ? levelOf(g) : 1;
  return {
    realm: realmView(g),
    friends: rel.filter((r) => r.state === "ok").map((r) => ({ cid: r.cid, name: r.name, lv: r.lv, jb: r.jb, on: !!online.byChar(r.cid), where: where(r.cid) })),
    pending: incomingOf(cid).map((r) => ({ cid: r.cid, name: r.name })),
    blocked: rel.filter((r) => r.state === "block").map((r) => ({ cid: r.cid, name: r.name })),
    guild: g && {
      id: g.id, name: g.name, notice: g.notice,
      members: guildMembers(g.id).map((m) => ({ ...m, master: m.cid === g.master_id, on: !!online.byChar(m.cid) })),
      level: lv, xp: g.xp, next: guildNext(g.xp), cap: guildMaxMembers(lv), bankCap: guildBankCap(lv), bank: gbankItems(g.master_id),
      nation: nationOfGuild(g)?.name ?? null, lands: realmView(g).terr.filter((t) => t.owner === g.name).map((t) => t.name),
    },
  };
}
export const sendSocial = (p: Player) => send(p, { t: "social", s: socialView(p.char.id) });
const resend = (cid: number) => { const q = online.byChar(cid); if (q) sendSocial(q); };

/** 이름표 길드 이름 바꾸기 (같은 방에 보임) */
function setGuild(cid: number, g: { id: number; name: string } | null) {
  const q = online.byChar(cid);
  if (!q) return;
  q.guild = g;
  q.room?.ev.push(["gd", q.id, g?.name ?? ""]);
  const n = g ? nationOfGuild(guildById(g.id)) : null; // 길드가 바뀌면 국가도
  if ((n?.id ?? 0) !== (q.nation?.id ?? 0)) { q.nation = n; q.room?.ev.push(["nt", q.id, n?.name ?? ""]); }
}

/** 접속 · 접속 끊음: 친구 · 길드원에게 알림 + 그들의 목록을 새로 */
function announce(p: Player, on: boolean) {
  const at = Date.now();
  const told = new Set<number>();
  for (const r of relationsOf(p.char.id)) {
    const q = r.state === "ok" ? online.byChar(r.cid) : undefined;
    if (!q || blocks(q.char.id, p.char.id)) continue;
    told.add(q.char.id);
    say(q, "system", "", `친구 ${p.char.nickname}님이 ${on ? "접속했어요" : "나갔어요"}`, undefined, at);
    sendSocial(q);
  }
  if (p.guild) for (const m of guildMembers(p.guild.id)) {
    const q = m.cid === p.char.id || told.has(m.cid) ? undefined : online.byChar(m.cid);
    if (!q) continue;
    say(q, "system", "", `길드원 ${p.char.nickname}님이 ${on ? "접속했어요" : "나갔어요"}`, undefined, at);
    sendSocial(q);
  }
}

/** 접속 직후: 길드 · 소셜 창 · 저장된 길드 채팅/귓속말 · 접속 알림 */
export function socialLogin(p: Player) {
  const g = guildOf(p.char.id); // p.guild 는 buildPlayer 가 이미 채움
  sendSocial(p);
  const rows = [...(g ? guildChat(g.id, CHAT_LOG.history) : []), ...whispers(p.char.id, CHAT_LOG.history)].sort((a, b) => a.created_at - b.created_at);
  for (const r of rows) say(p, r.ch as "guild" | "whisper", r.from_name ?? "?", r.text, r.to_name ?? undefined, r.created_at);
  announce(p, true);
}
export const socialLogout = (p: Player) => announce(p, false);

// ── 채팅 ──────────────────────────────────────────────────────────────
/** 귓속말 (/w 닉 말 · /r 말) */
export function whisper(p: Player, name: string | null, raw: string): string | null {
  const q = name === null ? online.byChar(lastWhisper.get(p.char.id) ?? 0) : online.all().find((o) => o.char.nickname.toLowerCase() === name.toLowerCase());
  if (!q) return name === null ? "답장할 상대가 없거나 접속해 있지 않습니다" : `${name}님은 접속해 있지 않습니다`;
  if (q === p) return "자기 자신에게는 보낼 수 없습니다";
  if (blocks(q.char.id, p.char.id) || blocks(p.char.id, q.char.id)) return "귓속말을 주고받을 수 없는 상대입니다 (차단)";
  const text = filterChat(raw.trim());
  if (!text) return null;
  const at = Date.now();
  say(p, "whisper", p.char.nickname, text, q.char.nickname, at);
  say(q, "whisper", p.char.nickname, text, q.char.nickname, at);
  lastWhisper.set(p.char.id, q.char.id);
  lastWhisper.set(q.char.id, p.char.id);
  logChat("whisper", p.char.id, q.char.id, null, null, text);
  return null;
}

/** 길드 채팅 (/g 말) — 접속한 길드원에게 */
export function guildSay(p: Player, text: string): string | null {
  if (!p.guild) return "길드에 들어 있지 않습니다 (O 소셜 창)";
  const at = Date.now();
  for (const m of guildMembers(p.guild.id)) { const q = online.byChar(m.cid); if (q) say(q, "guild", p.char.nickname, text, undefined, at); }
  logChat("guild", p.char.id, null, p.guild.id, null, text);
  return null;
}

// ── 친구 · 차단 ─────────────────────────────────────────────────────────
type Op = { op?: unknown; name?: unknown; cid?: unknown; id?: unknown; text?: unknown; a?: unknown; n?: unknown };
/** 대상 캐릭터: cid 또는 닉네임 (접속하지 않아도 됨) */
const target = (m: Op) => {
  const n = typeof m.name === "string" ? m.name.trim() : "";
  const c = Number.isInteger(m.cid) ? findCharacterById(m.cid as number) : n ? charByName(n) : null;
  return c ? { id: c.id, nickname: c.nickname } : null;
};

export function friendOp(p: Player, m: Op & { a?: unknown; n?: unknown }): string | null {
  if (m.op === "gift") return giftOp(p, m);
  if (m.op === "view") { sendSocial(p); return null; } // 소셜 창을 열 때 새로 (영향력 등)
  const me = p.char.id;
  const o = target(m);
  if (!o) return "없는 모험가입니다";
  if (o.id === me) return "자기 자신입니다";
  const mine = relation(me, o.id);
  switch (m.op) {
    case "request": {
      if (mine === "ok") return "이미 친구입니다";
      if (mine === "block") return "차단한 상대입니다 (먼저 차단을 푸세요)";
      if (blocks(o.id, me)) return "친구 신청을 보낼 수 없는 상대입니다";
      if (relationsOf(me).filter((r) => r.state === "ok").length >= FRIEND.max) return `친구는 ${FRIEND.max}명까지입니다`;
      // 상대가 먼저 신청해 두었으면 바로 친구
      if (relation(o.id, me) === "pending") return friendOp(p, { op: "accept", cid: o.id });
      if (mine === "pending") return "이미 신청했습니다";
      setRelation(me, o.id, "pending");
      notify(o.id, "friend_request", `${p.char.nickname}(Lv${p.char.level})님이 친구 신청을 보냈어요`, { cid: me, name: p.char.nickname });
      resend(o.id); // 받은 신청 목록
      tell(p, `${o.nickname}님에게 친구 신청을 보냈어요`);
      break;
    }
    case "accept": {
      if (relation(o.id, me) !== "pending") return "받은 친구 신청이 없습니다";
      if (relationsOf(me).filter((r) => r.state === "ok").length >= FRIEND.max) return `친구는 ${FRIEND.max}명까지입니다`;
      tx(() => { setRelation(o.id, me, "ok"); setRelation(me, o.id, "ok"); });
      notify(o.id, "friend_accepted", `${p.char.nickname}님과 친구가 되었어요`, { cid: me });
      resend(o.id);
      break;
    }
    case "decline":
      if (!delRelation(o.id, me, "pending")) return "받은 친구 신청이 없습니다";
      break;
    case "remove":
      tx(() => { delRelation(me, o.id, "ok"); delRelation(o.id, me, "ok"); delRelation(me, o.id, "pending"); });
      resend(o.id);
      break;
    case "block":
      if (relationsOf(me).filter((r) => r.state === "block").length >= FRIEND.blockMax) return `차단은 ${FRIEND.blockMax}명까지입니다`;
      // 친구 · 신청을 끊고 차단 (상대가 나를 차단한 줄은 그대로)
      tx(() => { setRelation(me, o.id, "block"); delRelation(o.id, me, "ok"); delRelation(o.id, me, "pending"); });
      resend(o.id);
      tell(p, `${o.nickname}님을 차단했어요 — 귓속말 · 친구 신청 · 채팅이 보이지 않아요`);
      break;
    case "unblock":
      if (!delRelation(me, o.id, "block")) return "차단한 상대가 아닙니다";
      break;
    default:
      return "잘못된 요청입니다";
  }
  sendSocial(p);
  return null;
}

/** 선물 (P12, 알림 gift): 친구에게 가방(인벤토리 · 핫바)의 아이템을 우편으로 */
export function giftOp(p: Player, m: { cid?: unknown; a?: unknown; n?: unknown }): string | null {
  const cid = Number(m.cid);
  if (!Number.isInteger(cid) || relation(p.char.id, cid) !== "ok") return "친구에게만 선물할 수 있습니다";
  const a = m.a as [string, number] | undefined;
  if (!Array.isArray(a) || (a[0] !== "inventory" && a[0] !== "hotbar")) return "가방에 있는 아이템만 선물할 수 있습니다";
  const it = p.items.find((i) => i.loc === a[0] && i.slot === a[1]);
  if (!it) return "아이템이 없습니다";
  const qty = m.n === undefined ? it.qty : Number(m.n);
  if (!Number.isInteger(qty) || qty < 1 || qty > it.qty) return "수량이 올바르지 않습니다";
  const to = findCharacterById(cid)!;
  const name = ITEMS[it.tpl].name;
  const err = atomic(p, "gift", () => {
    const out = take(p, qty, (i) => i.id === it.id, "gift");
    mail(cid, { sender: p.char.nickname, subject: `${p.char.nickname}님의 선물`, body: `${name} ×${qty}`, reason: "gift", items: out }, p.char.id);
  });
  sendInv(p);
  if (err) return err;
  notify(cid, "gift", `${p.char.nickname}님이 선물을 보냈어요: ${name} ×${qty} (우편함)`, { from: p.char.nickname });
  tell(p, `${to.nickname}님에게 「${name}」 ×${qty} 을(를) 선물했어요`);
  return null;
}

// ── 길드 ──────────────────────────────────────────────────────────────
const others = (gid: number, but: number) => guildMembers(gid).map((m) => m.cid).filter((c) => c !== but);
function syncGuild(gid: number) { for (const m of guildMembers(gid)) resend(m.cid); }
function guildNote(gid: number, text: string, but = 0) {
  for (const cid of others(gid, but)) { const q = online.byChar(cid); if (q) say(q, "guild", "", text); }
}

export function guildOp(p: Player, m: Op): string | null {
  const me = p.char.id;
  const g = guildOf(me);
  const master = !!g && g.master_id === me;
  switch (m.op) {
    case "create": {
      if (g) return "이미 길드에 들어 있습니다";
      const name = typeof m.name === "string" ? m.name.trim() : "";
      if (!validGuildName(name)) return "길드 이름은 한글 · 영문 · 숫자 2~10자입니다";
      if (filterChat(name) !== name) return "쓸 수 없는 이름입니다";
      if (p.ruc < GUILD.createRuc) return `길드를 만들려면 ${GUILD.createRuc.toLocaleString()} RUC 가 필요합니다`;
      let id: number | null;
      try {
        // 길드 만들기 + 비용을 한 트랜잭션으로 (RUC 가 모자라면 길드도 안 생김)
        id = tx(() => {
          const gid = createGuild(name, me);
          if (gid) p.ruc = ruc(me, -GUILD.createRuc, "guild_create", String(gid), `guild_create:${gid}`).balance;
          return gid;
        });
      } catch {
        return `RUC 가 부족합니다 (${GUILD.createRuc.toLocaleString()} RUC)`;
      }
      if (!id) return "이미 있는 길드 이름입니다";
      audit(me, "guild_create", String(id), null, { name });
      sendWallet(p);
      setGuild(me, { id, name });
      tell(p, `길드 ‹${name}›을(를) 만들었어요. 소셜 창(O)에서 길드원을 초대하세요`);
      break;
    }
    case "invite": {
      if (!g || !master) return "길드장만 초대할 수 있습니다";
      const o = target(m);
      if (!o || o.id === me) return "없는 모험가입니다";
      if (guildOf(o.id)) return `${o.nickname}님은 이미 길드에 들어 있습니다`;
      if (blocks(o.id, me)) return "초대할 수 없는 상대입니다";
      if (guildMembers(g.id).length >= guildMaxMembers(levelOf(g))) return `길드는 지금 ${guildMaxMembers(levelOf(g))}명까지입니다 (길드 레벨이 오르면 늘어남)`;
      if (!invites.has(g.id)) invites.set(g.id, new Set());
      invites.get(g.id)!.add(o.id);
      notify(o.id, "guild_invite", `길드 ‹${g.name}›에서 초대했어요 (${p.char.nickname})`, { gid: g.id, name: g.name });
      tell(p, `${o.nickname}님을 길드에 초대했어요`);
      return null;
    }
    case "accept":
    case "decline": {
      const gid = Number(m.id);
      const inv = invites.get(gid);
      if (!inv?.has(me)) return "받은 길드 초대가 없거나 기한이 지났습니다";
      inv.delete(me);
      const to = guildById(gid);
      if (m.op === "decline" || !to) return to ? null : "없어진 길드입니다";
      return enroll(p, to.id, to.name);
    }
    case "apply": {
      if (g) return "이미 길드에 들어 있습니다";
      const to = typeof m.name === "string" ? guildByName(m.name.trim()) : null;
      if (!to) return "없는 길드입니다";
      if (blocks(to.master_id, me)) return "가입 신청을 보낼 수 없는 길드입니다";
      if (!applies.has(to.id)) applies.set(to.id, new Set());
      if (applies.get(to.id)!.has(me)) return "이미 가입 신청을 보냈습니다";
      applies.get(to.id)!.add(me);
      notify(to.master_id, "guild_request", `${p.char.nickname}(Lv${p.char.level})님이 길드 가입을 신청했어요`, { gid: to.id, cid: me, name: p.char.nickname });
      tell(p, `길드 ‹${to.name}›에 가입 신청을 보냈어요`);
      return null;
    }
    case "approve":
    case "reject": {
      if (!g || !master) return "길드장만 할 수 있습니다";
      const cid = Number(m.cid);
      if (!applies.get(g.id)?.delete(cid)) return "가입 신청이 없거나 기한이 지났습니다";
      if (m.op === "reject") break;
      if (guildOf(cid)) return "이미 다른 길드에 들어갔습니다";
      if (guildMembers(g.id).length >= guildMaxMembers(levelOf(g))) return `길드는 지금 ${guildMaxMembers(levelOf(g))}명까지입니다 (길드 레벨이 오르면 늘어남)`;
      joinGuild(cid, g.id);
      setGuild(cid, { id: g.id, name: g.name });
      notify(cid, "guild_joined", `길드 ‹${g.name}›에 들어갔어요`, { gid: g.id });
      guildNote(g.id, `${findCharacterById(cid)?.nickname ?? "?"}님이 길드에 들어왔어요`, cid);
      syncGuild(g.id);
      return null;
    }
    case "leave": {
      if (!g) return "길드에 들어 있지 않습니다";
      if (master && guildMembers(g.id).length > 1) return "길드장은 먼저 다른 길드원에게 길드장을 넘기거나 길드를 해산하세요";
      if (master) return guildOp(p, { op: "disband" });
      leaveGuild(me);
      setGuild(me, null);
      guildNote(g.id, `${p.char.nickname}님이 길드를 떠났어요`);
      syncGuild(g.id);
      break;
    }
    case "kick": {
      if (!g || !master) return "길드장만 추방할 수 있습니다";
      const cid = Number(m.cid);
      if (cid === me || guildOf(cid)?.id !== g.id) return "우리 길드원이 아닙니다";
      leaveGuild(cid);
      setGuild(cid, null);
      notify(cid, "guild_kicked", `길드 ‹${g.name}›에서 추방되었어요`, { gid: g.id });
      resend(cid);
      syncGuild(g.id);
      return null;
    }
    case "promote": {
      if (!g || !master) return "길드장만 넘길 수 있습니다";
      const cid = Number(m.cid);
      if (cid === me || guildOf(cid)?.id !== g.id) return "우리 길드원이 아닙니다";
      setGuildMaster(g.id, cid);
      moveGbank(me, cid); // 길드 창고는 길드장 소유로 저장 (FK)
      guildNote(g.id, `${findCharacterById(cid)?.nickname ?? "?"}님이 새 길드장이 되었어요`, 0);
      syncGuild(g.id);
      return null;
    }
    case "notice": {
      if (!g || !master) return "길드장만 공지를 쓸 수 있습니다";
      const text = filterChat(String(m.text ?? "").replace(/\s+/g, " ").trim().slice(0, GUILD.noticeMax));
      setGuildNotice(g.id, text);
      if (text) guildNote(g.id, `[공지] ${text}`, 0);
      syncGuild(g.id);
      return null;
    }
    case "deposit": {
      // 길드 창고에 넣기 (길드원 누구나) — 가방의 아이템을 원하는 수량만큼
      if (!g) return "길드에 들어 있지 않습니다";
      const a = m.a as [string, number] | undefined;
      if (!Array.isArray(a) || (a[0] !== "inventory" && a[0] !== "hotbar")) return "가방에 있는 아이템만 넣을 수 있습니다";
      const it = p.items.find((i) => i.loc === a[0] && i.slot === a[1]);
      if (!it) return "아이템이 없습니다";
      const qty = (m as { n?: unknown }).n === undefined ? it.qty : Number((m as { n?: unknown }).n);
      if (!Number.isInteger(qty) || qty < 1 || qty > it.qty) return "수량이 올바르지 않습니다";
      const bank = gbankItems(g.master_id);
      const cap = guildBankCap(levelOf(g));
      let slot = 0;
      while (bank.some((b) => b.slot === slot)) slot++;
      if (slot >= cap) return `길드 창고가 가득 찼습니다 (${cap}칸)`;
      const err = atomic(p, "gbank_in", () => {
        const out = take(p, qty, (i) => i.id === it.id, "gbank_in");
        saveItems(g.master_id, out.map((o) => ({ ...o, loc: "gbank" as const, slot })), [], "gbank_in", `guild:${g.id}`, null, { by: me });
      });
      sendInv(p);
      if (err) return err;
      guildNote(g.id, `${p.char.nickname}님이 길드 창고에 「${ITEMS[it.tpl].name}」 ×${qty} 을(를) 넣었어요`, 0);
      syncGuild(g.id);
      return null;
    }
    case "withdraw": {
      // 꺼내기는 길드장만 (아무나 가져가지 못하게)
      if (!g || !master) return "길드 창고에서 꺼내기는 길드장만 할 수 있습니다";
      const it = gbankItems(me).find((i) => i.id === m.id);
      if (!it) return "길드 창고에 없는 아이템입니다";
      const pos = freeSlot(p, ["inventory", "hotbar"]);
      if (!pos) return "인벤토리에 빈 칸이 없습니다";
      transferItem(it.id, me, me, pos[0], pos[1]);
      p.items.push({ ...it, loc: pos[0], slot: pos[1] } as Item);
      audit(me, "gbank_out", it.id, { guild: g.id }, { tpl: it.tpl, qty: it.qty });
      sendInv(p);
      syncGuild(g.id);
      return null;
    }
    case "disband": {
      if (!g || !master) return "길드장만 해산할 수 있습니다";
      const list = guildMembers(g.id).map((x) => x.cid);
      const bank = gbankItems(me);
      if (bank.length) {
        const err = atomic(p, "gbank_close", () => { mail(me, { sender: "길드 창고", subject: `길드 ‹${g.name}› 해산 — 창고 물건`, reason: "gbank", items: bank }, me); });
        if (err) return err;
      }
      guildGone(g.id, g.nation_id);
      dropGuild(g.id);
      invites.delete(g.id);
      applies.delete(g.id);
      audit(me, "guild_disband", String(g.id), { name: g.name }, null);
      for (const cid of list) {
        setGuild(cid, null);
        if (cid !== me) notify(cid, "guild_kicked", `길드 ‹${g.name}›이(가) 해산되었어요`, { gid: g.id });
        resend(cid);
      }
      return null;
    }
    default:
      return "잘못된 요청입니다";
  }
  sendSocial(p);
  return null;
}

function enroll(p: Player, gid: number, name: string): string | null {
  if (guildOf(p.char.id)) return "이미 길드에 들어 있습니다";
  const gr = guildById(gid)!;
  if (guildMembers(gid).length >= guildMaxMembers(levelOf(gr))) return `길드는 지금 ${guildMaxMembers(levelOf(gr))}명까지입니다`;
  joinGuild(p.char.id, gid);
  setGuild(p.char.id, { id: gid, name });
  guildNote(gid, `${p.char.nickname}님이 길드에 들어왔어요`, p.char.id);
  syncGuild(gid);
  tell(p, `길드 ‹${name}›에 들어왔어요. /g 로 길드 채팅`);
  return null;
}
