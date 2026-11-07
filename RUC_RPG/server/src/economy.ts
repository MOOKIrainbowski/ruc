import { randomUUID } from "node:crypto";
import { fmt } from "../../../web/rpg/shared/josa.ts";
import {
  ENCH_POWER, ENCH_SLOTS, ENHANCE, ENHANCE_MAX, ENHANCE_OPT, MAIL, MARKET, PREFIXES, cycleEnd, disassembleRuc, enchantCost, enhanceCost, meetsPrice,
  recombine as rollRecombine, repairCost, rollEnch, rollEnhance, rollShop, shopCycle, tenName, type Price, type ShopSlot,
} from "../../../web/rpg/shared/data/economy.ts";
import { ENCHANTS, ITEMS, LOCS, RARITIES, STACK, durMaxOf, stackable, type Item, type ItemPos, type Loc, type Rarity, type StoredItem } from "../../../web/rpg/shared/data/items.ts";
import { USE_RANGE, distToObj, prop } from "../../../web/rpg/shared/map.ts";
import { rand } from "./combat.ts";
import {
  Shortfall, audit, closeListing, expiredListings, findCharacterById, insertListing, insertMail, listMail, listing, loadItem, loadItems, loadItemsAt, mailCount, mailRow,
  markClaimed, myListings, openListings, purgeMail, ruc, saveBroadcast, saveItems, saveShopRoll, shopRoll, transferItem, tx, wallet, type ListingRow,
} from "./db.ts";
import { give, newItem, refreshGear, sendInv } from "./items.ts";
import { notify, quest } from "./quests.ts";
import type { Player } from "./room.ts";

/**
 * 경제 (§15-5 우편 · §16 강화 · 마법부여 · 분해 · 재조합 · §17 상점). 베타 지갑 RUC (D1).
 * 조작 하나 = 트랜잭션 하나 (RUC 원장 + 아이템 + 우편). 실패하면 DB 를 되돌리고 메모리(아이템 · 지갑)를 DB 에서 다시 읽음.
 * 클라이언트가 보낸 요청 id(rid)가 원장 멱등 키에 들어가서, 같은 요청이 두 번 와도 한 번만 처리됨 (§14-3 복사 방지).
 */

/** 플레이어에게 보여 줄 거절 이유 */
export class UserError extends Error {}
export const fail = (msg: string): never => { throw new UserError(msg); };

const send = (p: Player, m: object) => p.ws.readyState === 1 && p.ws.send(JSON.stringify(m));
/** 온라인 플레이어 찾기 (main.ts 가 채움) — 우편 도착 알림 · 서버 공지 */
export const online = { byChar: (_id: number): Player | undefined => undefined, all: (): Player[] => [] };

export function atomic(p: Player, action: string, fn: () => void): string | null {
  try {
    tx(fn);
    return null;
  } catch (e) {
    p.items = loadItems(p.char.id);
    p.ruc = wallet(p.char.id).balance;
    refreshGear(p);
    if (e instanceof UserError || e instanceof Shortfall) return e.message;
    console.error(`경제 처리 실패 (${action})`, e);
    return "처리 중 문제가 생겼습니다. 다시 시도해 주세요";
  }
}

/** RUC 변동 + 메모리 잔액. key 가 이미 쓰였으면 같은 요청이 또 온 것 → 전체 취소 */
export function pay(p: Player, delta: number, reason: string, ref: string | null, key: string) {
  const r = ruc(p.char.id, delta, reason, ref, key);
  if (r.dup) fail("이미 처리된 요청입니다");
  p.ruc = r.balance;
}
/** 요청 id → 멱등 키 (없으면 이번만 쓰는 키) */
export const keyOf = (p: Player, op: string, rid: unknown) =>
  `${op}:${p.char.id}:${typeof rid === "string" && /^[\w-]{8,64}$/.test(rid) ? rid : randomUUID()}`;

export const sendWallet = (p: Player) => send(p, { t: "ruc", ruc: p.ruc });

const validPos = (p: unknown): p is ItemPos =>
  Array.isArray(p) && typeof p[0] === "string" && Object.hasOwn(LOCS, p[0]) && Number.isInteger(p[1]) && p[1] >= 0 && p[1] < LOCS[p[0] as Loc];
export const at = (p: Player, pos: unknown): Item => (validPos(pos) && p.items.find((i) => i.loc === pos[0] && i.slot === pos[1])) || fail("아이템이 없습니다");
const bag = (p: Player) => p.items.filter((i) => i.loc === "inventory" || i.loc === "hotbar");

/** 인벤토리 · 핫바에서 조건에 맞는 아이템을 n 개 꺼냄 (묶음은 나눔). 꺼낸 것을 새 인스턴스로 돌려줌 (나눈 묶음은 새 UUID) */
export function take(p: Player, n: number, match: (i: Item) => boolean, action: string): Item[] {
  const src = bag(p).filter(match).sort((a, b) => a.qty - b.qty);
  if (src.reduce((a, i) => a + i.qty, 0) < n) fail("재료가 모자랍니다");
  const before = src.map((i) => structuredClone(i));
  const out: Item[] = [];
  let left = n;
  for (const i of src) {
    if (!left) break;
    const k = Math.min(left, i.qty);
    out.push(k === i.qty ? { ...structuredClone(i) } : { ...structuredClone(i), id: randomUUID(), qty: k });
    i.qty -= k;
    left -= k;
  }
  p.items = p.items.filter((i) => i.qty > 0);
  saveItems(p.char.id, src.filter((i) => i.qty > 0), src.filter((i) => i.qty === 0).map((i) => i.id), action, "", before, src);
  return out;
}

// ── 우편 (§15-5, 마크 우편함과 같은 동작: 30일 · 모두 받기 · 빈 칸이 모자라면 남겨 둠) ─────────────

type MailOut = { sender: string; subject: string; body?: string; ruc?: number; reason: string; items?: StoredItem[] };
/** 우편 보내기 (트랜잭션 안에서). items 는 새로 만든 것 또는 from 의 것(주인 이전) */
export function mail(to: number, m: MailOut, from?: number): number {
  const now = Date.now();
  if (mailCount(to, now) >= MAIL.max) fail("받는 사람의 우편함이 가득 찼습니다");
  const id = insertMail(to, m.sender, m.subject, m.body ?? "", m.ruc ?? 0, m.reason, now, now + MAIL.days * 86_400_000);
  (m.items ?? []).forEach((it, i) => {
    const slot = id * MAIL.perMail + i;
    if (from !== undefined && loadItem(it.id)) transferItem(it.id, from, to, "mail", slot);
    else saveItems(to, [{ ...it, loc: "mail", slot }], [], "mail_in", `mail:${id}`, null, { mail: id });
  });
  audit(from ?? null, "mail_send", String(id), null, { to, ruc: m.ruc ?? 0, items: (m.items ?? []).map((i) => [i.tpl, i.qty]), reason: m.reason });
  const p = online.byChar(to);
  if (p) send(p, { t: "notify", kind: "mail", n: mailCount(to, now) });
  return id;
}

export function mailView(p: Player) {
  const now = Date.now();
  const rows = listMail(p.char.id, now);
  return rows.map((r) => ({
    id: r.id, sender: r.sender, subject: r.subject, body: r.body, ruc: r.attach_ruc, reason: r.reason, expires: r.expires_at,
    items: loadItemsAt(p.char.id, "mail", r.id * MAIL.perMail, r.id * MAIL.perMail + MAIL.perMail - 1),
  }));
}

/** 우편 하나 받기: 첨부를 전부 넣을 수 있을 때만 (아니면 우편 그대로) */
function claimOne(p: Player, id: number) {
  const now = Date.now();
  const row = mailRow(id);
  if (!row || row.to_id !== p.char.id || !markClaimed(id, p.char.id, now)) fail("이미 받았거나 기간이 지난 우편입니다");
  const items = loadItemsAt(p.char.id, "mail", id * MAIL.perMail, id * MAIL.perMail + MAIL.perMail - 1) as Item[]; // 받으면서 인벤토리 칸으로 옮김
  const before = items.map((i) => structuredClone(i));
  const changed: Item[] = [];
  const removed: string[] = [];
  const taken: Item[] = [];
  for (const it of items) {
    // 같은 묶음에 먼저 → 남으면 빈 칸 (핫바 → 인벤토리)
    if (stackable(ITEMS[it.tpl]))
      for (const s of bag(p)) {
        if (!it.qty) break;
        if (s.tpl !== it.tpl || s.rarity !== it.rarity || s.qty >= STACK) continue;
        const k = Math.min(it.qty, STACK - s.qty);
        s.qty += k;
        it.qty -= k;
        if (!changed.includes(s)) changed.push(s);
      }
    if (!it.qty) { removed.push(it.id); continue; }
    let pos: ItemPos | null = null;
    for (const loc of ["hotbar", "inventory"] as Loc[])
      for (let s = 0; s < LOCS[loc] && !pos; s++) if (!p.items.some((i) => i.loc === loc && i.slot === s) && !taken.some((i) => i.loc === loc && i.slot === s)) pos = [loc, s];
    if (!pos) fail("인벤토리에 빈 칸이 없습니다. 한 칸 이상 비우고 다시 시도하세요.");
    it.loc = pos![0];
    it.slot = pos![1];
    taken.push(it);
    changed.push(it);
  }
  saveItems(p.char.id, changed, removed, "mail_claim", `mail:${id}`, before, changed);
  p.items.push(...taken);
  if (row!.attach_ruc) pay(p, row!.attach_ruc, "mail", String(id), `mail:${id}`);
}

export function claimMail(p: Player, id: unknown): string | null {
  return atomic(p, "claim", () => claimOne(p, Number(id)));
}

/** 모두 받기: 빈 칸이 허락하는 만큼. 반환: [받은 수, 남은 수] */
export function claimAll(p: Player): [number, number] {
  let n = 0;
  for (const r of listMail(p.char.id, Date.now())) if (!atomic(p, "claimAll", () => claimOne(p, r.id))) n++;
  return [n, mailCount(p.char.id, Date.now())];
}

/** 처음 접속: 지갑 만들고 베타 환영 우편 (1,000 RUC + 체력 포션 5) — 베타 지갑은 실제 RUC 와 별개 (D1, D38) */
export function welcome(p: Player) {
  const w = wallet(p.char.id);
  p.ruc = w.balance;
  if (!w.created) return;
  tx(() => mail(p.char.id, {
    sender: "햇살광장 솔라스", subject: "베타 테스터 환영 선물", reason: "reward", ruc: 1000,
    body: "러크 RPG 베타에 오신 걸 환영해요! 베타 RUC 는 마크 서버 RUC 와 별개이고, 베타가 끝나면 초기화될 수 있어요.",
    items: [newItem("hp_potion_s", 5, "common", "inventory", 0)],
  }));
}

// ── 일반 상점 (§17-2) ──────────────────────────────────────────────

export function shopView(p: Player) {
  const now = Date.now();
  const cycle = shopCycle(now);
  let roll = shopRoll(p.char.id, cycle);
  if (!roll) {
    const items = rollShop(p.char.id, cycle, p.st.luck);
    saveShopRoll(p.char.id, cycle, items, {});
    roll = { items, purchased: {} };
  }
  const slots = (roll.items as ShopSlot[]).map((s, i) => ({ ...s, left: s.stock - (roll!.purchased[i] ?? 0) }));
  return { cycle, ends: cycleEnd(cycle), slots };
}

/** 사기: 이번 회차 · 남은 수량 안에서. 구매품은 우편으로 (§17-2) */
export function shopBuy(p: Player, cycle: unknown, idx: unknown, n: unknown, rid: unknown): string | null {
  const v = shopView(p);
  const i = Number(idx);
  const qty = Number(n ?? 1);
  if (cycle !== v.cycle) return "진열이 바뀌었습니다. 다시 열어 주세요";
  const s = v.slots[i];
  if (!s || !Number.isInteger(qty) || qty < 1) return "잘못된 요청입니다";
  if (qty > s.left) return "남은 수량이 없습니다";
  return atomic(p, "shop", () => {
    pay(p, -s.price * qty, "shop", s.tpl, keyOf(p, "shop", rid));
    const purchased = shopRoll(p.char.id, v.cycle)!.purchased;
    purchased[i] = (purchased[i] ?? 0) + qty;
    saveShopRoll(p.char.id, v.cycle, v.slots.map(({ left: _l, ...x }) => x), purchased);
    const items = stackable(ITEMS[s.tpl]) ? [newItem(s.tpl, qty, s.rarity, "inventory", 0)] : Array.from({ length: qty }, () => newItem(s.tpl, 1, s.rarity, "inventory", 0));
    mail(p.char.id, { sender: "일반 상점", subject: `${ITEMS[s.tpl].name} 구매`, reason: "shop", items });
  });
}

// ── 유저 상점 (§17-3): 에스크로 · 복합 가격 · 수수료 5% ─────────────────

/** 가격 옵션 검사: 1~3개, 옵션마다 RUC 또는 아이템이 있어야 함 */
function cleanPrices(raw: unknown): Price[] {
  if (!Array.isArray(raw) || raw.length < 1 || raw.length > MARKET.options) fail("가격은 1~3가지로 정해 주세요");
  return (raw as Price[]).map((o) => {
    const r = o?.ruc === undefined ? 0 : Number(o.ruc);
    if (!Number.isInteger(r) || r < 0 || r > 1e9) fail("RUC 가격이 올바르지 않습니다");
    const items = (Array.isArray(o?.items) ? o.items : []).map((x) => {
      const q = Number(x?.qty);
      if (!x || typeof x.tpl !== "string" || !Object.hasOwn(ITEMS, x.tpl) || !Number.isInteger(q) || q < 1 || q > 999) fail("아이템 가격이 올바르지 않습니다");
      if (x.minRarity !== undefined && !RARITIES.includes(x.minRarity)) fail("희귀도가 올바르지 않습니다");
      return { tpl: x.tpl, qty: q, ...(x.minRarity ? { minRarity: x.minRarity as Rarity } : {}) };
    });
    if (items.length > 5) fail("아이템 가격은 5종까지입니다");
    if (!r && !items.length) fail("가격이 비어 있습니다");
    return { ...(r ? { ruc: r } : {}), ...(items.length ? { items } : {}) };
  });
}

export function marketSell(p: Player, pos: unknown, prices: unknown, rid: unknown): string | null {
  return atomic(p, "sell", () => {
    const it = at(p, pos);
    if (it.loc === "equipped" || it.loc === "storage") fail("인벤토리 · 핫바에 있는 아이템만 올릴 수 있습니다");
    if (myListings(p.char.id).length >= MARKET.max) fail(`판매 등록은 ${MARKET.max}건까지입니다`);
    const options = cleanPrices(prices);
    const now = Date.now();
    pay(p, 0, "market_list", it.id, keyOf(p, "sell", rid)); // 0 RUC — 멱등 키만 (같은 요청이 두 번 와도 한 건)
    const id = insertListing(p.char.id, it.id, options, now, now + MARKET.days * 86_400_000);
    const moved: StoredItem = { ...it, loc: "escrow", slot: id };
    saveItems(p.char.id, [moved], [], "escrow_in", `listing:${id}`, it, moved);
    p.items = p.items.filter((i) => i !== it);
  });
}

export function marketView(p: Player) {
  const now = Date.now();
  const names = new Map<number, string>();
  const row = (l: ListingRow) => {
    const it = loadItem(l.item_id);
    if (!names.has(l.seller_id)) names.set(l.seller_id, findCharacterById(l.seller_id)?.nickname ?? "?");
    return it && { id: l.id, seller: names.get(l.seller_id)!, mine: l.seller_id === p.char.id, item: it, prices: JSON.parse(l.price_options) as Price[], expires: l.expires_at };
  };
  return { list: openListings(now).map(row).filter(Boolean), mine: myListings(p.char.id).map(row).filter(Boolean) };
}

/** 사기: 구매자가 고른 가격 옵션을 치름. 물건 → 구매자 우편, 대가(RUC − 수수료 5% · 아이템) → 판매자 우편 */
export function marketBuy(p: Player, id: unknown, opt: unknown, rid: unknown): string | null {
  let sold: [number, string] | null = null;
  const err = atomic(p, "buy", () => {
    const l = listing(Number(id));
    const now = Date.now();
    if (!l || l.status !== "open" || l.expires_at <= now) fail("이미 팔렸거나 내려간 물건입니다");
    if (l!.seller_id === p.char.id) fail("내 물건은 살 수 없습니다");
    const price = (JSON.parse(l!.price_options) as Price[])[Number(opt)] ?? fail("가격 옵션을 골라 주세요");
    const key = keyOf(p, "buy", rid);
    pay(p, -(price.ruc ?? 0), "market_buy", String(l!.id), key);
    const paid: Item[] = [];
    for (const need of price.items ?? []) paid.push(...take(p, need.qty, (i) => meetsPrice(i, need), "market_pay"));
    if (!closeListing(l!.id, "sold", p.char.id, now)) fail("이미 팔렸거나 내려간 물건입니다");
    const item = loadItem(l!.item_id) ?? fail("물건을 찾을 수 없습니다");
    mail(p.char.id, { sender: "유저 상점", subject: `${ITEMS[item.tpl].name} 구매`, reason: "shop", items: [item] }, l!.seller_id);
    const fee = Math.floor((price.ruc ?? 0) * MARKET.fee);
    mail(l!.seller_id, {
      sender: "유저 상점", subject: `${ITEMS[item.tpl].name} 판매 대금`, reason: "sale", ruc: (price.ruc ?? 0) - fee,
      body: fee ? `거래 수수료 ${fee} RUC (5%)` : "", items: paid,
    }, p.char.id);
    audit(p.char.id, "market_buy", String(l!.id), null, { seller: l!.seller_id, price, fee });
    sold = [l!.seller_id, item.name ?? ITEMS[item.tpl].name];
  });
  if (!err && sold) notify(sold[0], "market_sold", `「${sold[1]}」이(가) 팔렸어요. 대금은 우편함에서 받으세요`);
  return err;
}

function returnListing(l: ListingRow, status: "cancelled" | "expired") {
  if (!closeListing(l.id, status, null, Date.now())) fail("이미 팔렸거나 내려간 물건입니다");
  const item = loadItem(l.item_id) ?? fail("물건을 찾을 수 없습니다");
  mail(l.seller_id, { sender: "유저 상점", subject: `${ITEMS[item.tpl].name} 반환`, reason: "return", items: [item] }, l.seller_id);
}

export function marketCancel(p: Player, id: unknown): string | null {
  return atomic(p, "cancel", () => {
    const l = listing(Number(id));
    if (!l || l.seller_id !== p.char.id) fail("내 판매 목록이 아닙니다");
    returnListing(l!, "cancelled");
  });
}

/** 만료 · 오래된 우편 정리 (main 이 주기적으로) */
export function sweep(now: number) {
  for (const l of expiredListings(now))
    try {
      tx(() => returnListing(l, "expired"));
      notify(l.seller_id, "market_expired", "유저 상점에 올린 물건의 기한이 끝났어요. 우편함에서 돌려받으세요");
    } catch (e) { console.error("판매 만료 처리 실패", l.id, e); }
  purgeMail(now, MAIL.perMail);
}

// ── 대장간: 강화 · 마법부여 · 수리 (§16 · §14-4) ─────────────────────

/** 강화 (§16-1): 강화석 · RUC, 축복 강화석(+10%p) · 보호 주문서(파괴 → 실패). 확률은 CSPRNG, 결과는 감사 로그 */
export function enhance(p: Player, pos: unknown, blessed: unknown, protect: unknown, rid: unknown): string | null {
  let result = "";
  const err = atomic(p, "enhance", () => {
    const it = at(p, pos);
    const t = ITEMS[it.tpl];
    if (!t.slot) fail("장비만 강화할 수 있습니다");
    if (it.enh >= ENHANCE_MAX) fail("이미 +10 입니다");
    const step = ENHANCE[it.enh];
    pay(p, -enhanceCost(it), "enhance", it.id, keyOf(p, "enh", rid));
    take(p, step.stones, (i) => i.tpl === "enhance_stone", "enhance_use");
    if (blessed === true) take(p, 1, (i) => i.tpl === "blessed_stone", "enhance_use");
    if (protect === true) take(p, 1, (i) => i.tpl === "protect_scroll", "enhance_use");
    result = rollEnhance(rand(), it.enh, blessed === true, protect === true);
    const before = structuredClone(it);
    if (result === "boom") {
      p.items = p.items.filter((i) => i !== it);
      saveItems(p.char.id, [], [it.id], "enhance_boom", "", before, null);
    } else if (result === "ok") {
      const ratio = it.durMax ? it.dur / it.durMax : 1;
      it.enh++;
      it.durMax = durMaxOf(t, it.rarity, it.enh);
      it.dur = Math.round(it.durMax * ratio);
      if ((it.opt?.length ?? 0) < ENHANCE_OPT.max && rand() < ENHANCE_OPT.chance) {
        const kinds = Object.keys(ENCHANTS);
        it.opt = [...(it.opt ?? []), rollEnch(kinds[Math.floor(rand() * kinds.length)], 1, rand, ENHANCE_OPT.scale)];
      }
      if (it.enh === ENHANCE_MAX) {
        const pool = PREFIXES[t.kind] ?? PREFIXES.weapon;
        it.name = tenName(t, pool[Math.floor(rand() * pool.length)]);
      }
      saveItems(p.char.id, [it], [], "enhance_ok", "", before, it);
    }
    audit(p.char.id, "enhance", it.id, { enh: before.enh, blessed: blessed === true, protect: protect === true }, { result, enh: it.enh });
    if (result === "ok" && it.enh === ENHANCE_MAX) broadcast(p, it);
  });
  if (!err) {
    send(p, { t: "econ", view: "enhanced", data: { result } });
    if (result === "ok") quest(p, "enhance");
  }
  return err;
}

/** +10 서버 전체 공지 (§16-1): '<이름>이 <아이템> 아이템 10강에 성공했습니다' */
function broadcast(p: Player, it: Item) {
  const text = fmt("{who}이/가 {item} 아이템 10강에 성공했습니다", { who: p.char.nickname, item: it.name ?? ITEMS[it.tpl].name });
  saveBroadcast("enhance10", text);
  for (const o of online.all()) {
    send(o, { t: "notice", text });
    notify(o.char.id, "enhance_broadcast", text);
  }
}

/** 마법부여 (§16-2): 부가석 하나 + RUC. 슬롯이 가득 차면 덮어쓸 칸을 고름 */
export function enchant(p: Player, pos: unknown, stonePos: unknown, slot: unknown, rid: unknown): string | null {
  return atomic(p, "enchant", () => {
    const it = at(p, pos);
    const stone = at(p, stonePos);
    const t = ITEMS[it.tpl];
    const kind = ITEMS[stone.tpl].enchant;
    if (!t.slot) fail("장비에만 마법부여할 수 있습니다");
    if (!kind) fail("부가석이 아닙니다");
    const cap = ENCH_SLOTS[it.rarity];
    if (!cap) fail("하급 장비에는 마법부여할 수 없습니다");
    const list = [...(it.ench ?? [])];
    const over = list.length >= cap ? Number(slot) : list.length;
    if (!Number.isInteger(over) || over < 0 || over >= cap) fail("덮어쓸 칸을 골라 주세요");
    pay(p, -enchantCost(it.rarity, stone.rarity), "enchant", it.id, keyOf(p, "ench", rid));
    const power = ENCH_POWER[stone.rarity];
    take(p, 1, (i) => i === stone, "enchant_use");
    const before = structuredClone(it);
    list[over] = rollEnch(kind!, power, rand);
    it.ench = list;
    saveItems(p.char.id, [it], [], "enchant", "", before, it);
  });
}

/** 수리 (§14-4): 하나 또는 입은 장비 전부 */
export function repair(p: Player, pos: unknown, rid: unknown): string | null {
  return atomic(p, "repair", () => {
    const list = pos === "all" ? p.items.filter((i) => i.loc === "equipped" && i.dur < i.durMax) : [at(p, pos)];
    const cost = list.reduce((a, i) => a + repairCost(i), 0);
    if (!cost) fail("수리할 것이 없습니다");
    pay(p, -cost, "repair", list.map((i) => i.id).join(","), keyOf(p, "repair", rid));
    const before = list.map((i) => structuredClone(i));
    for (const i of list) i.dur = i.durMax;
    saveItems(p.char.id, list, [], "repair", "", before, list);
  });
}

// ── 분해 · 재조합 (§16-3 · §16-4) ────────────────────────────────────

export function disassemble(p: Player, pos: unknown, rid: unknown): string | null {
  return atomic(p, "disassemble", () => {
    const it = at(p, pos);
    if (it.loc === "equipped") fail("장착 중인 아이템은 분해할 수 없습니다");
    const refund = disassembleRuc(it) * it.qty;
    pay(p, refund, "disassemble", it.id, keyOf(p, "dis", rid));
    const before = structuredClone(it);
    p.items = p.items.filter((i) => i !== it);
    saveItems(p.char.id, [], [it.id], "disassemble", "", before, { refund });
  });
}

/** 같은 용도 3개 → 같은 용도 무작위 1개 (연금술 작업대) */
export function recombineOp(p: Player, list: unknown, rid: unknown): string | null {
  return atomic(p, "recombine", () => {
    if (!Array.isArray(list) || list.length !== 3) fail("재료 3개를 올려 주세요");
    const items = (list as unknown[]).map((pos) => at(p, pos));
    const kind = ITEMS[items[0].tpl].kind;
    if (items.some((i) => ITEMS[i.tpl].kind !== kind)) fail("같은 용도의 아이템 3개여야 합니다");
    if (items.some((i) => i.loc === "equipped")) fail("장착 중인 아이템은 쓸 수 없습니다");
    // 같은 칸을 여러 번 고르면 그만큼 개수가 있어야 함
    const need = new Map<Item, number>();
    for (const i of items) need.set(i, (need.get(i) ?? 0) + 1);
    for (const [i, n] of need) if (i.qty < n) fail("개수가 모자랍니다");
    pay(p, 0, "recombine", null, keyOf(p, "recomb", rid));
    const out = rollRecombine(items, p.st.luck, rand);
    for (const [i, n] of need) take(p, n, (x) => x === i, "recombine_use");
    const e = give(p, out.tpl, 1, out.rarity, "recombine");
    if (e) fail(e);
    audit(p.char.id, "recombine", out.tpl, items.map((i) => [i.tpl, i.rarity]), out);
    send(p, { t: "econ", view: "recombined", data: out });
  });
}

// ── 위치 확인 · 메시지 처리 ──────────────────────────────────────────

/** 광장의 그 시설 근처인가 (§15-5 우편함 · §16 강화대 · §17 천막) */
function near(p: Player, types: string[], npcs: string[] = []) {
  const objs = p.room?.kind === "plaza" ? p.room.map.objects : [];
  return objs.some((o) => (types.includes(o.type) || (o.type === "npc" && npcs.includes(String(prop(o, "npc"))))) && distToObj(o, p.x, p.y) <= USE_RANGE + 24);
}
const PLACES: Record<string, [string[], string[], string]> = {
  mail: [["mailbox"], ["pip"], "광장의 우편함 앞에서 열 수 있습니다"],
  shop: [["tent_shop"], [], "광장의 일반 상점 천막 앞에서 열 수 있습니다"],
  market: [["tent_market"], [], "광장의 유저 상점 천막 앞에서 열 수 있습니다"],
  forge: [["anvil"], ["volt"], "광장 대장간의 강화대 앞에서 할 수 있습니다"],
  alchemy: [["workbench"], ["mir"], "광장의 연금술 작업대 앞에서 할 수 있습니다"],
};
const PLACE_OF: Record<string, string> = {
  mail: "mail", claim: "mail", claimAll: "mail", shop: "shop", buy: "shop", market: "market", sell: "market", mbuy: "market", cancel: "market",
  enhance: "forge", enchant: "forge", repair: "forge", recombine: "alchemy",
};

export type EconMsg = { op?: unknown; id?: unknown; a?: unknown; b?: unknown; n?: unknown; cycle?: unknown; prices?: unknown; opt?: unknown; list?: unknown; blessed?: unknown; protect?: unknown; slot?: unknown; rid?: unknown };

/** 요청 하나 처리 → 결과 화면 · 인벤토리 · 지갑을 다시 보냄 */
export function econOp(p: Player, m: EconMsg): string | null {
  const op = String(m.op);
  const place = PLACE_OF[op];
  if (place && !near(p, PLACES[place][0], PLACES[place][1])) return PLACES[place][2];
  let err: string | null = null;
  switch (op) {
    case "mail": break;
    case "claim": err = claimMail(p, m.id); if (!err) quest(p, "claim"); break;
    case "claimAll": {
      const [got, left] = claimAll(p);
      if (got) quest(p, "claim");
      err = left ? `우편 ${got}통을 받았습니다. 아직 ${left}통이 남아 있습니다 — 인벤토리를 비우고 다시 받으세요` : null;
      break;
    }
    case "shop": break;
    case "buy": err = shopBuy(p, m.cycle, m.id, m.n, m.rid); if (!err) quest(p, "buy"); break;
    case "market": break;
    case "sell": err = marketSell(p, m.a, m.prices, m.rid); break;
    case "mbuy": err = marketBuy(p, m.id, m.opt, m.rid); break;
    case "cancel": err = marketCancel(p, m.id); break;
    case "enhance": err = enhance(p, m.a, m.blessed, m.protect, m.rid); break;
    case "enchant": err = enchant(p, m.a, m.b, m.slot, m.rid); break;
    case "repair": err = repair(p, m.a, m.rid); break;
    case "disassemble": err = disassemble(p, m.a, m.rid); break;
    case "recombine": err = recombineOp(p, m.list, m.rid); break;
    default: return "알 수 없는 요청";
  }
  refreshGear(p);
  sendInv(p);
  sendWallet(p);
  if (place === "mail") send(p, { t: "econ", view: "mail", data: mailView(p) });
  if (place === "shop") send(p, { t: "econ", view: "shop", data: shopView(p) });
  if (place === "market") send(p, { t: "econ", view: "market", data: marketView(p) });
  return err;
}

/** 몹 처치 RUC (§20-2): 막타 기여자 지갑으로 바로 */
export function dropRuc(p: Player, amount: number, mob: string) {
  if (amount <= 0) return;
  try {
    pay(p, amount, "drop", mob, `drop:${p.char.id}:${randomUUID()}`);
    p.out.push(["ruc", amount]);
    sendWallet(p);
  } catch (e) {
    console.error("RUC 드롭 실패", e);
  }
}
