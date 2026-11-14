import { ITEMS, type Item, type ItemPos, type Rarity } from "../../../web/rpg/shared/data/items.ts";
import {
  COLLECT_CHOICES, FIRST_QUEST, FOUNTAIN_R, FOUNTAIN_SPOTS, MOB_CHOICES, NOTI_TOAST, NPCS, QUESTS, USER_QUEST, userQuestFee,
  type Noti, type NotiKind, type QState, type QuestView, type UserKind, type UserQuestRow,
} from "../../../web/rpg/shared/data/quests.ts";
import {
  activeTakes, activeUserQuestCount, audit, findCharacterById, closeUserQuest, db, expiredUserQuests, hasTaken, insertNoti, insertTake, insertUserQuest, listNotis, loadItem,
  loadQuests, markPaid, openUserQuests, ownUserQuests, readNotis, saveItems, saveQuest, saveTakeProg, setTakeState, takeSlot, takesFor, tx, userQuest,
  type NotiRow, type QuestRow, type UQRow,
} from "./db.ts";
import { at, atomic, fail, keyOf, mail, online, pay, take } from "./economy.ts";
import { newItem, refreshGear, sendInv } from "./items.ts";
import { gainExp, type Player } from "./room.ts";
import { RUINS } from "../../../web/rpg/shared/data/dungeons.ts";

/**
 * 퀘스트 (§19) · 알림 (§22). 목표는 서버가 직접 본 일만 센다: 진행도는 서버 이벤트(quest())로만 오르고 클라이언트 신고는 없음.
 * NPC 퀘스트(튜토리얼)는 끝나면 보상이 우편으로 가고 다음 퀘스트가 바로 시작됨 (D43).
 * 유저 퀘스트: 보상 RUC + 수수료는 등록 때 원장에서 빠지고, 보상 아이템은 location 'escrow' slot = 1000000 + 퀘스트 id × 8 + 순번.
 */

const send = (p: Player, m: object) => p.ws.readyState === 1 && p.ws.send(JSON.stringify(m));
const ESC = 1_000_000;

// ── 알림 (§22) ───────────────────────────────────────────────────────
const notiOf = (r: NotiRow): Noti => ({ id: r.id, kind: r.kind as NotiKind, text: r.text, at: r.created_at, read: !!r.read, ...(r.data ? { data: JSON.parse(r.data) } : {}) });

/** 알림 저장 + 접속 중이면 바로 보냄. unique = 안 읽은 같은 종류가 있으면 새로 만들지 않음 */
export function notify(charId: number, kind: NotiKind, text: string, data?: Record<string, unknown>, unique = false) {
  if (unique && listNotis(charId).some((n) => n.kind === kind && !n.read)) return;
  const id = insertNoti(charId, kind, text, data);
  const p = online.byChar(charId);
  if (p) send(p, { t: "noti", n: { id, kind, text, at: Date.now(), read: false, ...(data ? { data } : {}) } satisfies Noti, toast: NOTI_TOAST.includes(kind) });
}
export const sendNotis = (p: Player) => send(p, { t: "notis", list: listNotis(p.char.id).map(notiOf) });
export function notiOp(p: Player, op: unknown, id: unknown) {
  if (op === "readAll") readNotis(p.char.id);
  else if (op === "read" && Number.isInteger(id)) readNotis(p.char.id, id as number);
}

// ── NPC 퀘스트 (튜토리얼) ─────────────────────────────────────────────
export function loadQuestState(p: Player) {
  p.quests = new Map(loadQuests(p.char.id).map((r) => [r.quest_id, r]));
  p.takes = new Map(activeTakes(p.char.id).map((r) => [r.quest_id, r.prog]));
  // 분수 둘레 지점(비트)은 메모리라 다시 접속하면 사라짐 → 저장된 개수만큼 앞 지점을 지난 것으로 (안 그러면 2/4 에서 다시 들어오면 3곳을 새로 돌아야 숫자가 오름)
  const fq = p.quests.get("tut_fountain");
  p.reach = fq?.state === "active" ? (1 << Math.min(4, fq.prog[0] ?? 0)) - 1 : 0;
  // 새 캐릭터(또는 퀘스트 기록이 없는 예전 캐릭터)는 튜토리얼부터
  if (!p.quests.size) start(p, FIRST_QUEST, false);
  else for (const q of p.quests.values()) if (q.state === "active" && QUESTS[q.quest_id]?.obj.some((o) => o.type === "level")) syncLevel(p, q);
}

export function questStates(p: Player): { active: QState[]; done: string[]; reach: number } {
  const all = [...p.quests.values()];
  return {
    reach: p.reach,
    active: all.filter((q) => q.state === "active").map((q): QState => ({ id: q.quest_id, prog: q.prog, tracked: q.tracked })),
    done: all.filter((q) => q.state === "done").map((q) => q.quest_id),
  };
}
export const sendQuests = (p: Player) => send(p, { t: "qs", ...questStates(p) });

function start(p: Player, id: string, announce = true) {
  const def = QUESTS[id];
  if (!def || p.quests.has(id)) return;
  const q: QuestRow = { quest_id: id, state: "active", prog: def.obj.map(() => 0), tracked: true };
  p.quests.set(id, q);
  syncLevel(p, q);
  saveQuest(p.char.id, q);
  if (announce) send(p, { t: "qpop", kind: "start", title: def.title, text: def.hint });
  sendQuests(p);
}

function syncLevel(p: Player, q: QuestRow) {
  QUESTS[q.quest_id].obj.forEach((o, i) => {
    if (o.type === "level") q.prog[i] = Math.min(o.n, p.char.level);
    if (o.type === "party" && p.party) q.prog[i] = o.n; // 이미 파티에 있으면 바로 (P7)
  });
  check(p, q);
}

/** 서버가 본 일을 알림. 맞는 활성 퀘스트(NPC · 유저)의 진행도를 올림 */
export function quest(p: Player, type: string, target?: string, n = 1) {
  let changed = false;
  for (const q of [...p.quests.values()]) {
    if (q.state !== "active") continue;
    let touched = false;
    QUESTS[q.quest_id].obj.forEach((o, i) => {
      if (o.type !== type || q.prog[i] >= o.n) return;
      if (type === "level") q.prog[i] = Math.min(o.n, p.char.level);
      else if (type === "stage") {
        // 던전 스테이지 도달: 가장 높이 간 스테이지 (n = 스테이지 번호)
        if ((o.target && o.target !== target) || n <= q.prog[i]) return;
        q.prog[i] = Math.min(o.n, n);
      } else if (!o.target || o.target === "*" || o.target === target) q.prog[i] = Math.min(o.n, q.prog[i] + n);
      else return;
      touched = true;
    });
    if (touched) { changed = true; saveQuest(p.char.id, q); check(p, q); }
  }
  if (changed) sendQuests(p);
  if (type === "kill" || type === "stage" || type === "duel" || type === "collect") userProg(p, type, target ?? "", n);
}

function check(p: Player, q: QuestRow) {
  const def = QUESTS[q.quest_id];
  if (q.state !== "active" || !def.obj.every((o, i) => q.prog[i] >= o.n)) return;
  q.state = "done";
  try {
    tx(() => {
      saveQuest(p.char.id, q);
      const r = def.reward;
      if (r.ruc || r.items?.length)
        mail(p.char.id, {
          sender: NPCS[def.npc]?.name ?? "퀘스트", subject: `퀘스트 보상: ${def.title}`, reason: "quest", ruc: r.ruc ?? 0,
          items: (r.items ?? []).map(([tpl, qty]) => newItem(tpl, qty, (ITEMS[tpl].rarity ?? "common") as Rarity, "inventory", 0)),
        });
    });
  } catch (e) {
    q.state = "active"; // 보상 우편을 못 만들었으면 완료 취소 (우편함 가득 등) — 다음 이벤트 때 다시 시도
    console.error("퀘스트 보상 실패", q.quest_id, e);
    return;
  }
  const reward = [def.reward.exp ? `경험치 ${def.reward.exp}` : "", def.reward.ruc ? `${def.reward.ruc} RUC` : "", ...(def.reward.items ?? []).map(([t, n]) => `${ITEMS[t].name} ×${n}`)].filter(Boolean);
  send(p, { t: "qpop", kind: "done", title: def.title, text: reward.length ? `보상: ${reward.join(", ")} ${def.reward.ruc || def.reward.items ? "(우편함)" : ""}`.trim() : "" });
  notify(p.char.id, "quest_complete", `퀘스트 「${def.title}」 완료!`, { id: def.id });
  if (def.reward.exp && p.room) gainExp(p.room, p, def.reward.exp);
  if (def.next) start(p, def.next);
}

/** 분수 둘레 네 곳 (tut_fountain) — 입력 처리 중 가끔 부름 */
export function reachTick(p: Player) {
  const q = p.quests.get("tut_fountain");
  if (!q || q.state !== "active" || p.room?.kind !== "plaza") return;
  const was = p.reach;
  FOUNTAIN_SPOTS.forEach((s, i) => { if (Math.hypot(p.x - s.x, p.y - s.y) <= FOUNTAIN_R) p.reach |= 1 << i; });
  if (p.reach === was) return;
  const count = [0, 1, 2, 3].filter((i) => p.reach & (1 << i)).length;
  if (count > q.prog[0]) { q.prog[0] = count; saveQuest(p.char.id, q); check(p, q); }
  sendQuests(p); // 어느 지점을 지났는지(reach 비트)를 클라가 바닥 표시 · 화살표로 보여 줌

}

export function setTracked(p: Player, id: unknown, on: unknown) {
  const q = typeof id === "string" ? p.quests.get(id) : undefined;
  if (!q || q.state !== "active") return;
  if (on === true && [...p.quests.values()].filter((x) => x.state === "active" && x.tracked).length >= 3) return;
  q.tracked = on === true;
  saveQuest(p.char.id, q);
  sendQuests(p);
}

// ── 유저 퀘스트 (§19-3) ───────────────────────────────────────────────
const itemIdsOf = (r: UQRow) => JSON.parse(r.item_ids) as string[];
const itemsOf = (r: UQRow): [string, number][] => itemIdsOf(r).map((id) => loadItem(id)).filter((i): i is NonNullable<typeof i> => !!i).map((i) => [i.tpl, i.qty]);

function rowOf(r: UQRow, uid: number, taken: Map<number, number>): UserQuestRow {
  return {
    id: r.id, owner: r.owner_name, title: r.title, kind: r.kind, target: r.target, n: r.n, ruc: r.reward_ruc, items: itemsOf(r), slots: r.slots, taken: r.taken,
    left: r.slots - r.taken, expires: r.expires_at, mine: r.owner_id === uid, joined: taken.has(r.id),
  };
}
export function boardView(p: Player) {
  const now = Date.now();
  const board = openUserQuests(now).map((r) => rowOf(r, p.char.id, p.takes));
  const mine = ownUserQuests(p.char.id, now - 86_400_000).map((r) => rowOf(r, p.char.id, p.takes));
  const taken = [...p.takes].map(([id, prog]) => [userQuest(id), prog] as const).filter(([r]) => !!r).map(([r, prog]) => ({ ...rowOf(r!, p.char.id, p.takes), prog }));
  return { board, mine, taken } satisfies Pick<QuestView, "board" | "mine" | "taken">;
}
export const sendBoard = (p: Player) => send(p, { t: "quest", view: "board", data: boardView(p) });

/** 등록: 보상 RUC × 인원 + 수수료 3% 를 원장에서 빼고, 아이템은 에스크로 칸으로 */
export function uqCreate(p: Player, m: Record<string, unknown>): string | null {
  const title = typeof m.title === "string" ? m.title.trim().replace(/\s+/g, " ") : "";
  const kind = m.kind as UserKind;
  const target = String(m.target ?? "");
  const n = Number(m.n);
  const ruc = Number(m.ruc ?? 0);
  const slots = Number(m.slots ?? 1);
  const days = Number(m.days ?? USER_QUEST.maxDays);
  const list = Array.isArray(m.list) ? (m.list as unknown[]) : [];
  if (title.length < 2 || title.length > 24) return "제목은 2~24자로 써 주세요";
  if (kind !== "kill" && kind !== "deliver" && kind !== "stage" && kind !== "duel" && kind !== "collect") return "목표 유형이 올바르지 않습니다";
  const okTarget = kind === "kill" ? MOB_CHOICES.some(([k]) => k === target) : kind === "deliver" ? Object.hasOwn(ITEMS, target) : kind === "collect" ? COLLECT_CHOICES.some(([k]) => k === target) : kind === "stage" ? target === "ruins" : target === "duel";
  if (!okTarget) return "목표 대상이 올바르지 않습니다";
  if (!Number.isInteger(n) || n < 1 || n > (kind === "stage" ? RUINS.stages.length : USER_QUEST.maxN)) return kind === "stage" ? `스테이지는 1~${RUINS.stages.length} 사이로 정해 주세요` : `수량은 1~${USER_QUEST.maxN} 사이로 정해 주세요`;
  if (!Number.isInteger(ruc) || ruc < 0 || ruc > USER_QUEST.maxRuc) return "보상 RUC 가 올바르지 않습니다";
  if (!Number.isInteger(slots) || slots < 1 || slots > USER_QUEST.maxSlots) return `인원은 1~${USER_QUEST.maxSlots}명입니다`;
  if (!Number.isInteger(days) || days < 1 || days > USER_QUEST.maxDays) return `기한은 1~${USER_QUEST.maxDays}일입니다`;
  if (list.length > USER_QUEST.maxItems) return `보상 아이템은 ${USER_QUEST.maxItems}개까지입니다`;
  if (list.length && slots > 1) return "보상 아이템은 1명 한정 퀘스트에만 걸 수 있습니다";
  if (!ruc && !list.length) return "보상이 비어 있습니다";
  if (activeUserQuestCount(p.char.id) >= USER_QUEST.maxActive) return `동시에 ${USER_QUEST.maxActive}건까지 열 수 있습니다`;
  const total = ruc * slots + userQuestFee(ruc, slots);
  return atomic(p, "uq_create", () => {
    const items = list.map((pos) => at(p, pos as ItemPos));
    if (new Set(items).size !== items.length) fail("같은 아이템을 두 번 걸 수 없습니다");
    for (const it of items) if (it.loc === "equipped" || it.loc === "storage") fail("인벤토리 · 핫바에 있는 아이템만 걸 수 있습니다");
    pay(p, -total, "uquest_create", title, keyOf(p, "uq", m.rid));
    const id = insertUserQuest({ owner: p.char.id, name: p.char.nickname, title, kind, target, n, ruc, itemIds: [], slots, expires: Date.now() + days * 86_400_000 });
    items.forEach((it, i) => {
      const moved = { ...it, loc: "escrow" as const, slot: ESC + id * 8 + i };
      saveItems(p.char.id, [moved], [], "escrow_in", `uquest:${id}`, it, moved);
    });
    db.prepare("UPDATE rpg_user_quests SET item_ids = ? WHERE id = ?").run(JSON.stringify(items.map((i) => i.id)), id);
    p.items = p.items.filter((i) => !items.includes(i));
    audit(p.char.id, "uquest_create", String(id), null, { title, kind, target, n, ruc, slots, fee: userQuestFee(ruc, slots), items: items.map((i) => [i.tpl, i.qty]) });
  });
}

export function uqAccept(p: Player, id: unknown): string | null {
  const r = userQuest(Number(id));
  const now = Date.now();
  if (!r || r.status !== "open" || r.expires_at <= now) return "이미 마감된 퀘스트입니다";
  if (r.owner_id === p.char.id) return "내가 올린 퀘스트는 받을 수 없습니다";
  if (hasTaken(r.id, p.char.id)) return "이미 받은 퀘스트입니다";
  if (p.takes.size >= USER_QUEST.maxTaken) return `동시에 ${USER_QUEST.maxTaken}건까지 받을 수 있습니다`;
  try {
    tx(() => {
      if (!takeSlot(r.id, now)) fail("자리가 다 찼습니다");
      insertTake(r.id, p.char.id);
    });
  } catch (e) {
    if (e instanceof Error && e.message === "자리가 다 찼습니다") return e.message;
    console.error("유저 퀘스트 수락 실패", e);
    return "처리 중 문제가 생겼습니다";
  }
  p.takes.set(r.id, 0);
  // 같은 IP · 부계정 감지 로그 (§19-3 · D46): 등록자의 마지막 접속 IP 와 같으면 기록만 (막지는 않음 — 가족 · PC방)
  const owner = findCharacterById(r.owner_id);
  if (p.ip && owner?.last_ip === p.ip) audit(p.char.id, "uquest_same_ip", String(r.id), null, { owner: r.owner_id, ip: p.ip });
  notify(r.owner_id, "quest_accepted_by", `${p.char.nickname}님이 「${r.title}」을(를) 수락했습니다`, { id: r.id });
  audit(p.char.id, "uquest_accept", String(r.id), null, { owner: r.owner_id });
  return null;
}

/** 받은 사람이 포기 — 자리를 돌려줌 */
export function uqAbandon(p: Player, id: unknown): string | null {
  const qid = Number(id);
  if (!p.takes.has(qid)) return "받은 퀘스트가 아닙니다";
  tx(() => {
    if (setTakeState(qid, p.char.id, "dropped")) db.prepare("UPDATE rpg_user_quests SET taken = taken - 1 WHERE id = ?").run(qid);
  });
  p.takes.delete(qid);
  return null;
}

/** 보상을 받아 가는 사람에게 — 우편 (RUC + 에스크로 아이템). 마지막 자리면 퀘스트 닫음 */
function payout(r: UQRow, to: number) {
  markPaid(r.id);
  const ids = itemIdsOf(r);
  const items = ids.map((i) => loadItem(i)).filter((i): i is NonNullable<typeof i> => !!i);
  mail(to, { sender: "유저 퀘스트", subject: `「${r.title}」 보상`, reason: "quest", ruc: r.reward_ruc, body: `${r.owner_name}님의 퀘스트를 완수했어요`, items }, r.owner_id);
  if (r.paid + 1 >= r.slots) closeUserQuest(r.id);
}

/** 유저 퀘스트 진행 (서버 이벤트만): 처치 · 던전 스테이지 도달(가장 높은 스테이지) · 결투 승리 */
function userProg(p: Player, type: string, target: string, n: number) {
  for (const [qid, prog] of [...p.takes]) {
    const r = userQuest(qid);
    if (!r || r.kind !== type || (type !== "duel" && r.target !== target)) continue;
    if (r.status !== "open" || r.expires_at <= Date.now()) { p.takes.delete(qid); continue; }
    const now = type === "stage" ? Math.max(prog, n) : prog + (type === "collect" ? n : 1);
    if (now === prog) continue;
    p.takes.set(qid, now);
    saveTakeProg(qid, p.char.id, now);
    send(p, { t: "uqp", id: qid, prog: now });
    if (now >= r.n) finishTake(p, r);
  }
}

function finishTake(p: Player, r: UQRow) {
  try {
    tx(() => {
      if (!setTakeState(r.id, p.char.id, "done")) fail("이미 처리되었습니다");
      payout(r, p.char.id);
    });
  } catch (e) {
    console.error("유저 퀘스트 완료 실패", r.id, e);
    return;
  }
  p.takes.delete(r.id);
  send(p, { t: "qpop", kind: "done", title: r.title, text: "보상은 우편함으로 보냈어요" });
  notify(p.char.id, "quest_complete", `유저 퀘스트 「${r.title}」 완료!`, { uq: r.id });
  notify(r.owner_id, "system", `「${r.title}」을(를) ${p.char.nickname}님이 완수했습니다`, { uq: r.id });
}

/** 전달형: 받은 사람이 아이템을 내면 등록자에게 우편으로 가고 바로 완료 */
export function uqDeliver(p: Player, id: unknown, rid: unknown): string | null {
  const r = userQuest(Number(id));
  if (!r || !p.takes.has(r.id) || r.kind !== "deliver") return "받은 전달 퀘스트가 아닙니다";
  if (r.status !== "open" || r.expires_at <= Date.now()) return "이미 마감된 퀘스트입니다";
  const err = atomic(p, "uq_deliver", () => {
    pay(p, 0, "uquest_deliver", String(r.id), keyOf(p, "uqd", rid));
    const paid = take(p, r.n, (i: Item) => i.tpl === r.target, "uquest_deliver");
    if (!setTakeState(r.id, p.char.id, "done")) fail("이미 처리되었습니다");
    mail(r.owner_id, { sender: "유저 퀘스트", subject: `「${r.title}」 전달 물품`, reason: "quest", body: `${p.char.nickname}님이 보냈어요`, items: paid }, p.char.id);
    payout(r, p.char.id);
  });
  if (err) return err;
  p.takes.delete(r.id);
  refreshGear(p);
  sendInv(p);
  send(p, { t: "qpop", kind: "done", title: r.title, text: "보상은 우편함으로 보냈어요" });
  notify(p.char.id, "quest_complete", `유저 퀘스트 「${r.title}」 완료!`, { uq: r.id });
  notify(r.owner_id, "system", `「${r.title}」 물품이 우편으로 도착했습니다`, { uq: r.id });
  return null;
}

/** 등록자가 내림 — 받은 사람이 진행 중이면 못 내림 (기한 만료 때까지). 남은 보상은 우편으로 반환 */
function closeAndRefund(r: UQRow) {
  if (!closeUserQuest(r.id)) fail("이미 마감된 퀘스트입니다");
  const left = r.slots - r.paid;
  const items = left > 0 ? itemIdsOf(r).map((i) => loadItem(i)).filter((i): i is NonNullable<typeof i> => !!i) : [];
  if (left > 0 && (r.reward_ruc || items.length))
    mail(r.owner_id, { sender: "유저 퀘스트", subject: `「${r.title}」 보상 반환`, reason: "return", ruc: r.reward_ruc * left, items }, r.owner_id);
}
export function uqCancel(p: Player, id: unknown): string | null {
  const r = userQuest(Number(id));
  if (!r || r.owner_id !== p.char.id) return "내가 올린 퀘스트가 아닙니다";
  if (takesFor(r.id).length) return "진행 중인 사람이 있어 내릴 수 없습니다 (기한이 끝나면 정리돼요)";
  try { tx(() => closeAndRefund(r)); } catch (e) { return e instanceof Error ? e.message : "처리 중 문제가 생겼습니다"; }
  return null;
}
export function uqReport(p: Player, id: unknown): string | null {
  const r = userQuest(Number(id));
  if (!r) return "없는 퀘스트입니다";
  audit(p.char.id, "uquest_report", String(r.id), null, { owner: r.owner_id, title: r.title });
  return null;
}

/** 기한 지난 유저 퀘스트 정리 (1분마다) */
export function sweepQuests(now: number) {
  for (const r of expiredUserQuests(now)) {
    try {
      tx(() => {
        for (const t of takesFor(r.id)) setTakeState(r.id, t.char_id, "dropped");
        closeAndRefund(r);
      });
      for (const t of online.all()) t.takes.delete(r.id);
      notify(r.owner_id, "system", `「${r.title}」 기한이 끝났습니다. 남은 보상은 우편으로 돌아갑니다`, { uq: r.id });
    } catch (e) { console.error("유저 퀘스트 만료 실패", r.id, e); }
  }
}

/** 유저 퀘스트 · 알림 요청 처리. 반환 = 거절 이유 */
export function questOp(p: Player, m: Record<string, unknown>): string | null {
  let err: string | null = null;
  switch (m.op) {
    case "track": setTracked(p, m.id, m.on); return null;
    case "board": break;
    case "create": err = uqCreate(p, m); refreshGear(p); sendInv(p); send(p, { t: "ruc", ruc: p.ruc }); break;
    case "accept": err = uqAccept(p, m.id); break;
    case "abandon": err = uqAbandon(p, m.id); break;
    case "deliver": err = uqDeliver(p, m.id, m.rid); send(p, { t: "ruc", ruc: p.ruc }); break;
    case "cancel": err = uqCancel(p, m.id); break;
    case "report": err = uqReport(p, m.id); break;
    default: return "알 수 없는 요청";
  }
  sendBoard(p);
  return err;
}
