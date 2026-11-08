import { mkdirSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import type { Appearance } from "../../../web/rpg/shared/data/appearance.ts";
import type { Item, StoredItem } from "../../../web/rpg/shared/data/items.ts";
import type { Learned } from "../../../web/rpg/shared/progress.ts";

/**
 * 게임 DB — node:sqlite 파일 하나 (DECISIONS D5). 테이블은 단계마다 필요한 것만 추가합니다.
 * 실시간 상태(위치 등)는 메모리에 두고 30초마다 · 접속 종료 시 저장 (§26-2).
 */

const dir = new URL("../data/", import.meta.url);
mkdirSync(dir, { recursive: true });
export const db = new DatabaseSync(fileURLToPath(new URL(process.env.RPG_DB_FILE || "rpg.sqlite", dir)));
db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;");

db.exec(`
CREATE TABLE IF NOT EXISTS rpg_characters (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  discord_id  TEXT NOT NULL UNIQUE,
  nickname    TEXT NOT NULL UNIQUE COLLATE NOCASE,
  level       INTEGER NOT NULL DEFAULT 1,
  exp         INTEGER NOT NULL DEFAULT 0,
  element     TEXT NOT NULL,
  appearance  TEXT NOT NULL,
  position    TEXT,
  settings    TEXT,
  created_at  INTEGER NOT NULL
);
-- 아이템 인스턴스 (§14-3 · §26-2). 한 칸에 하나 — UNIQUE 가 겹침 · 복사를 DB 에서도 막음
CREATE TABLE IF NOT EXISTS rpg_items (
  id             TEXT PRIMARY KEY,
  owner_id       INTEGER NOT NULL REFERENCES rpg_characters(id),
  template_id    TEXT NOT NULL,
  location       TEXT NOT NULL,
  slot           INTEGER NOT NULL,
  qty            INTEGER NOT NULL CHECK (qty > 0),
  rarity         TEXT NOT NULL,
  enhance        INTEGER NOT NULL DEFAULT 0,
  enhance_opts   TEXT,
  enchants       TEXT,
  specials       TEXT NOT NULL DEFAULT '[]',
  durability     INTEGER NOT NULL DEFAULT 0,
  durability_max INTEGER NOT NULL DEFAULT 0,
  custom_name    TEXT,
  origin         TEXT NOT NULL,
  created_at     INTEGER NOT NULL,
  UNIQUE (owner_id, location, slot)
);
-- 배운 스킬 (§26-2): 등급 · 레벨 · 숙련도 · 장착 슬롯
CREATE TABLE IF NOT EXISTS rpg_skills_learned (
  character_id  INTEGER NOT NULL REFERENCES rpg_characters(id),
  skill_id      TEXT NOT NULL,
  grade         TEXT NOT NULL,
  level         INTEGER NOT NULL,
  mastery       REAL NOT NULL DEFAULT 0,
  equipped_slot TEXT,
  PRIMARY KEY (character_id, skill_id)
);
-- 베타 지갑 · RUC 원장 (§17-1, D1). 모든 변동은 원장 한 줄 + 멱등 키(같은 요청이 두 번 와도 한 번만)
CREATE TABLE IF NOT EXISTS rpg_wallet (
  character_id INTEGER PRIMARY KEY REFERENCES rpg_characters(id),
  balance      INTEGER NOT NULL DEFAULT 0 CHECK (balance >= 0),
  updated_at   INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS rpg_ruc_ledger (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  character_id    INTEGER NOT NULL,
  delta           INTEGER NOT NULL,
  reason          TEXT NOT NULL,
  ref_id          TEXT,
  balance_after   INTEGER NOT NULL,
  idempotency_key TEXT NOT NULL UNIQUE,
  created_at      INTEGER NOT NULL
);
-- 우편 (§15-5): 첨부 아이템은 rpg_items 의 location 'mail', slot = 우편 id × 64 + 순번
CREATE TABLE IF NOT EXISTS rpg_mail (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  to_id      INTEGER NOT NULL,
  sender     TEXT NOT NULL,
  subject    TEXT NOT NULL,
  body       TEXT NOT NULL DEFAULT '',
  attach_ruc INTEGER NOT NULL DEFAULT 0,
  reason     TEXT NOT NULL,
  claimed_at INTEGER,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS rpg_mail_to ON rpg_mail (to_id, claimed_at);
-- 일반 상점 회차별 진열 · 구매 기록 (§17-2)
CREATE TABLE IF NOT EXISTS rpg_shop_rolls (
  character_id INTEGER NOT NULL,
  cycle        INTEGER NOT NULL,
  items        TEXT NOT NULL,
  purchased    TEXT NOT NULL DEFAULT '{}',
  PRIMARY KEY (character_id, cycle)
);
-- 유저 상점 (§17-3): 아이템은 location 'escrow', slot = 등록 id
CREATE TABLE IF NOT EXISTS rpg_market_listings (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  seller_id     INTEGER NOT NULL,
  item_id       TEXT NOT NULL,
  price_options TEXT NOT NULL,
  status        TEXT NOT NULL,
  buyer_id      INTEGER,
  created_at    INTEGER NOT NULL,
  expires_at    INTEGER NOT NULL,
  closed_at     INTEGER
);
CREATE INDEX IF NOT EXISTS rpg_market_open ON rpg_market_listings (status, expires_at);
-- 서버 공지 기록 (+10 강화, 최초 클리어)
CREATE TABLE IF NOT EXISTS rpg_broadcasts (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  kind       TEXT NOT NULL,
  text       TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
-- 퀘스트 진행 (P6): state = active | done, prog = 목표별 진행 수(JSON 배열)
CREATE TABLE IF NOT EXISTS rpg_quests (
  char_id    INTEGER NOT NULL,
  quest_id   TEXT NOT NULL,
  state      TEXT NOT NULL,
  prog       TEXT NOT NULL DEFAULT '[]',
  tracked    INTEGER NOT NULL DEFAULT 1,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (char_id, quest_id)
);
-- 유저 퀘스트 (§19-3): 보상 RUC 는 등록 때 원장에서 빠져 이 줄이 들고 있음, 보상 아이템은 location 'escrow' slot = 1000000 + id * 8 + 순번
CREATE TABLE IF NOT EXISTS rpg_user_quests (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  owner_id   INTEGER NOT NULL,
  owner_name TEXT NOT NULL,
  title      TEXT NOT NULL,
  kind       TEXT NOT NULL,
  target     TEXT NOT NULL,
  n          INTEGER NOT NULL,
  reward_ruc INTEGER NOT NULL DEFAULT 0,
  item_ids   TEXT NOT NULL DEFAULT '[]',
  slots      INTEGER NOT NULL,
  taken      INTEGER NOT NULL DEFAULT 0,
  paid       INTEGER NOT NULL DEFAULT 0,
  status     TEXT NOT NULL DEFAULT 'open',
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS rpg_uq_open ON rpg_user_quests (status, expires_at);
CREATE TABLE IF NOT EXISTS rpg_user_quest_takes (
  quest_id   INTEGER NOT NULL,
  char_id    INTEGER NOT NULL,
  prog       INTEGER NOT NULL DEFAULT 0,
  state      TEXT NOT NULL DEFAULT 'active',
  created_at INTEGER NOT NULL,
  PRIMARY KEY (quest_id, char_id)
);
-- 알림 (§22): 영구 저장
CREATE TABLE IF NOT EXISTS rpg_notifications (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  char_id    INTEGER NOT NULL,
  kind       TEXT NOT NULL,
  text       TEXT NOT NULL,
  data       TEXT,
  read       INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS rpg_noti_char ON rpg_notifications (char_id, id);
-- 감사 로그 (§26-2): 아이템 · RUC · 강화 · 관리자 행위 전부
CREATE TABLE IF NOT EXISTS rpg_audit_log (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  actor      INTEGER,
  action     TEXT NOT NULL,
  target     TEXT,
  before     TEXT,
  after      TEXT,
  created_at INTEGER NOT NULL
);
`);

let depth = 0;
/** 트랜잭션. 안에서 또 부르면 바깥 트랜잭션에 합쳐짐 — 경제 조작(RUC + 아이템 + 우편)을 한 덩어리로 (§14-3) */
export function tx<T>(fn: () => T): T {
  if (depth) return fn();
  db.exec("BEGIN IMMEDIATE");
  depth++;
  try {
    const r = fn();
    db.exec("COMMIT");
    return r;
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  } finally {
    depth--;
  }
}
export const inTx = () => depth > 0;

// P7: K/D/A (§13-3 시즌 단위) · 칭호 (§26-2 rpg_character_titles)
db.exec(`
CREATE TABLE IF NOT EXISTS rpg_kda (
  character_id INTEGER NOT NULL,
  season       TEXT NOT NULL,
  kills        INTEGER NOT NULL DEFAULT 0,
  deaths       INTEGER NOT NULL DEFAULT 0,
  assists      INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (character_id, season)
);
CREATE TABLE IF NOT EXISTS rpg_character_titles (
  character_id INTEGER NOT NULL,
  title_id     TEXT NOT NULL,
  created_at   INTEGER NOT NULL,
  PRIMARY KEY (character_id, title_id)
);
-- (예약 §21-4) 길드 · 영지 · 국가 — 베타에서는 비워 둠
CREATE TABLE IF NOT EXISTS rpg_guilds (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL UNIQUE, created_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS rpg_territories (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL UNIQUE, created_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS rpg_nations (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL UNIQUE, created_at INTEGER NOT NULL);
`);

// 단계마다 늘어난 캐릭터 칸 — 이미 있는 DB 에도 붙임 (P4: 전직 · 잠재력, P7: 칭호)
const charCols = new Set((db.prepare("PRAGMA table_info(rpg_characters)").all() as { name: string }[]).map((c) => c.name));
for (const [col, def] of [["job_tier1", "TEXT"], ["job_tier2", "TEXT"], ["job_sub", "TEXT"], ["potential_phys", "REAL NOT NULL DEFAULT 10"], ["potential_mag", "REAL NOT NULL DEFAULT 10"], ["title_id", "TEXT"]])
  if (!charCols.has(col)) db.exec(`ALTER TABLE rpg_characters ADD COLUMN ${col} ${def}`);

export type CharacterRow = {
  id: number;
  discord_id: string;
  nickname: string;
  level: number;
  exp: number;
  element: string;
  appearance: Appearance;
  /** 마지막 위치 + HP · 마나 · 기력 (§26-2 실시간 상태) */
  position: { map: string; x: number; y: number; hp?: number; mp?: number; en?: number } | null;
  settings: Record<string, unknown> | null;
  /** 1차 전직 계열 · 2차 세부 직업 · 원소술사 보조 속성 · 잠재력 */
  job_tier1: string | null;
  job_tier2: string | null;
  job_sub: string | null;
  potential_phys: number;
  potential_mag: number;
  /** 고른 칭호 (TITLES id) */
  title_id: string | null;
};

type Raw = Omit<CharacterRow, "appearance" | "position" | "settings"> & { appearance: string; position: string | null; settings: string | null };

const parse = (r: Raw | undefined): CharacterRow | null =>
  r ? { ...r, appearance: JSON.parse(r.appearance), position: r.position ? JSON.parse(r.position) : null, settings: r.settings ? JSON.parse(r.settings) : null } : null;

const qFind = db.prepare("SELECT * FROM rpg_characters WHERE discord_id = ?");
const qInsert = db.prepare("INSERT INTO rpg_characters (discord_id, nickname, element, appearance, created_at) VALUES (?, ?, ?, ?, ?)");
const qPos = db.prepare("UPDATE rpg_characters SET position = ? WHERE id = ?");
const qSettings = db.prepare("UPDATE rpg_characters SET settings = ? WHERE id = ?");
const qProgress = db.prepare("UPDATE rpg_characters SET level = ?, exp = ? WHERE id = ?");

export function findCharacter(discordId: string) {
  return parse(qFind.get(discordId) as Raw | undefined);
}
const qFindId = db.prepare("SELECT * FROM rpg_characters WHERE id = ?");
export const findCharacterById = (id: number) => parse(qFindId.get(id) as Raw | undefined);

/** 닉네임이 이미 있으면 null */
export function createCharacter(discordId: string, nickname: string, element: string, appearance: Appearance) {
  try {
    qInsert.run(discordId, nickname, element, JSON.stringify(appearance), Date.now());
  } catch (e) {
    if (String(e).includes("UNIQUE")) return null;
    throw e;
  }
  return findCharacter(discordId);
}

export const savePosition = (id: number, p: NonNullable<CharacterRow["position"]>) => qPos.run(JSON.stringify(p), id);
export const saveProgress = (id: number, level: number, exp: number) => qProgress.run(level, exp, id);
export const saveSettings = (id: number, s: unknown) => qSettings.run(JSON.stringify(s), id);

// ── 아이템 ───────────────────────────────────────────────────────

type ItemRaw = {
  id: string; template_id: string; location: StoredItem["loc"]; slot: number; qty: number; rarity: Item["rarity"]; enhance: number; specials: string;
  durability: number; durability_max: number; enhance_opts: string | null; enchants: string | null; custom_name: string | null;
};
const qItems = db.prepare("SELECT * FROM rpg_items WHERE owner_id = ? AND location IN ('inventory', 'hotbar', 'equipped', 'storage')");
const qItemsAt = db.prepare("SELECT * FROM rpg_items WHERE owner_id = ? AND location = ? AND slot BETWEEN ? AND ? ORDER BY slot");
const qItem = db.prepare("SELECT * FROM rpg_items WHERE id = ?");
const qTransfer = db.prepare("UPDATE rpg_items SET owner_id = ?, location = ?, slot = ? WHERE id = ? AND owner_id = ?");
const qDelItem = db.prepare("DELETE FROM rpg_items WHERE id = ? AND owner_id = ?");
const qPark = db.prepare("UPDATE rpg_items SET slot = ? WHERE id = ? AND owner_id = ?");
const qUpsert = db.prepare(`INSERT INTO rpg_items (id, owner_id, template_id, location, slot, qty, rarity, enhance, specials, durability, durability_max, origin, created_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(id) DO UPDATE SET location = excluded.location, slot = excluded.slot, qty = excluded.qty, durability = excluded.durability,
    durability_max = excluded.durability_max, enhance = excluded.enhance
  WHERE owner_id = excluded.owner_id`);
const qItemExtra = db.prepare("UPDATE rpg_items SET enhance_opts = ?, enchants = ?, custom_name = ? WHERE id = ? AND owner_id = ?");
const qDur = db.prepare("UPDATE rpg_items SET durability = ? WHERE id = ? AND owner_id = ?");
const qAudit = db.prepare("INSERT INTO rpg_audit_log (actor, action, target, before, after, created_at) VALUES (?, ?, ?, ?, ?, ?)");

const itemOf = (r: ItemRaw): StoredItem => ({
  id: r.id, tpl: r.template_id, loc: r.location, slot: r.slot, qty: r.qty, rarity: r.rarity, enh: r.enhance, sp: JSON.parse(r.specials), dur: r.durability, durMax: r.durability_max,
  ...(r.enhance_opts ? { opt: JSON.parse(r.enhance_opts) } : {}), ...(r.enchants ? { ench: JSON.parse(r.enchants) } : {}), ...(r.custom_name ? { name: r.custom_name } : {}),
});
export const loadItems = (owner: number): Item[] => (qItems.all(owner) as ItemRaw[]).map(itemOf) as Item[];
/** 우편 · 에스크로처럼 플레이어 목록 밖에 있는 아이템 */
export const loadItemsAt = (owner: number, loc: string, from: number, to: number): StoredItem[] => (qItemsAt.all(owner, loc, from, to) as ItemRaw[]).map(itemOf);
export const loadItem = (id: string): (StoredItem & { owner: number }) | null => {
  const r = qItem.get(id) as (ItemRaw & { owner_id: number }) | undefined;
  return r ? { ...itemOf(r), owner: r.owner_id } : null;
};
/** 주인 · 위치를 옮김 (우편 · 거래). 지금 주인이 맞을 때만 — 아니면 예외 */
export function transferItem(id: string, from: number, to: number, loc: string, slot: number) {
  if (qTransfer.run(to, loc, slot, id, from).changes !== 1) throw new Error(`아이템 이동 실패 ${id}`);
}

/**
 * 아이템 변경 저장 — 트랜잭션 하나 + 감사 로그 (§14-3). 실패하면 아무것도 안 바뀜.
 * 칸을 맞바꿀 때 UNIQUE(위치, 칸)에 걸리지 않게 바뀌는 행을 먼저 음수 칸으로 비켜 둡니다.
 */
export function saveItems(owner: number, changed: StoredItem[], removed: string[], action: string, origin: string, before: unknown, after: unknown) {
  tx(() => {
    for (const id of removed) qDelItem.run(id, owner);
    changed.forEach((it, i) => qPark.run(-1 - i, it.id, owner));
    const now = Date.now();
    for (const it of changed) {
      qUpsert.run(it.id, owner, it.tpl, it.loc, it.slot, it.qty, it.rarity, it.enh, JSON.stringify(it.sp), it.dur, it.durMax, origin, now);
      qItemExtra.run(it.opt ? JSON.stringify(it.opt) : null, it.ench ? JSON.stringify(it.ench) : null, it.name ?? null, it.id, owner);
    }
    qAudit.run(owner, action, changed[0]?.id ?? removed[0] ?? null, JSON.stringify(before), JSON.stringify(after), now);
  });
}

export const saveDurability = (owner: number, id: string, dur: number) => qDur.run(dur, id, owner);

// ── 성장 (전직 · 스킬) ──────────────────────────────────────────

type SkillRaw = { skill_id: string; grade: Learned["grade"]; level: number; mastery: number; equipped_slot: Learned["slot"] };
const qSkills = db.prepare("SELECT * FROM rpg_skills_learned WHERE character_id = ?");
const qSkill = db.prepare(`INSERT INTO rpg_skills_learned (character_id, skill_id, grade, level, mastery, equipped_slot) VALUES (?, ?, ?, ?, ?, ?)
  ON CONFLICT(character_id, skill_id) DO UPDATE SET grade = excluded.grade, level = excluded.level, mastery = excluded.mastery, equipped_slot = excluded.equipped_slot`);
const qJob = db.prepare("UPDATE rpg_characters SET job_tier1 = ?, job_tier2 = ?, job_sub = ?, potential_phys = ?, potential_mag = ? WHERE id = ?");

export const loadSkills = (owner: number): Learned[] =>
  (qSkills.all(owner) as SkillRaw[]).map((r) => ({ id: r.skill_id, grade: r.grade, lv: r.level, mastery: r.mastery, slot: r.equipped_slot }));
export const saveSkill = (owner: number, l: Learned) => qSkill.run(owner, l.id, l.grade, l.lv, l.mastery, l.slot);
export const saveJob = (owner: number, line: string | null, job: string | null, sub: string | null, pot: [number, number]) => qJob.run(line, job, sub, pot[0], pot[1], owner);

// ── 경제 (P5) ────────────────────────────────────────────────────

/** 잔액이 모자라 RUC 변동이 거절됨 */
export class Shortfall extends Error {}

const qWalletNew = db.prepare("INSERT OR IGNORE INTO rpg_wallet (character_id, balance, updated_at) VALUES (?, 0, ?)");
const qWallet = db.prepare("SELECT balance FROM rpg_wallet WHERE character_id = ?");
const qWalletAdd = db.prepare("UPDATE rpg_wallet SET balance = balance + ?, updated_at = ? WHERE character_id = ? AND balance + ? >= 0");
const qLedgerKey = db.prepare("SELECT balance_after FROM rpg_ruc_ledger WHERE idempotency_key = ?");
const qLedger = db.prepare("INSERT INTO rpg_ruc_ledger (character_id, delta, reason, ref_id, balance_after, idempotency_key, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)");

/** 지갑 잔액 (없으면 0 으로 만듦). 새로 만들었으면 created */
export function wallet(owner: number): { balance: number; created: boolean } {
  const created = qWalletNew.run(owner, Date.now()).changes === 1;
  return { balance: (qWallet.get(owner) as { balance: number }).balance, created };
}

/**
 * RUC 변동 (§17-1): 원장 한 줄 + 잔액. key 가 이미 있으면 다시 적용하지 않고 그때 잔액을 돌려줌 (멱등).
 * 잔액이 음수가 되면 Shortfall — 부르는 쪽 트랜잭션 전체가 되돌아감.
 */
export function ruc(owner: number, delta: number, reason: string, ref: string | null, key: string): { balance: number; dup: boolean } {
  if (!Number.isInteger(delta)) throw new Error("RUC 는 정수만: " + delta);
  return tx(() => {
    const seen = qLedgerKey.get(key) as { balance_after: number } | undefined;
    if (seen) return { balance: seen.balance_after, dup: true };
    wallet(owner);
    if (qWalletAdd.run(delta, Date.now(), owner, delta).changes !== 1) throw new Shortfall("RUC 가 부족합니다");
    const balance = (qWallet.get(owner) as { balance: number }).balance;
    qLedger.run(owner, delta, reason, ref, balance, key, Date.now());
    return { balance, dup: false };
  });
}

export type MailRow = { id: number; to_id: number; sender: string; subject: string; body: string; attach_ruc: number; reason: string; claimed_at: number | null; created_at: number; expires_at: number };
const qMailNew = db.prepare("INSERT INTO rpg_mail (to_id, sender, subject, body, attach_ruc, reason, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)");
const qMails = db.prepare("SELECT * FROM rpg_mail WHERE to_id = ? AND claimed_at IS NULL AND expires_at > ? ORDER BY id");
const qMailOne = db.prepare("SELECT * FROM rpg_mail WHERE id = ?");
const qMailClaim = db.prepare("UPDATE rpg_mail SET claimed_at = ? WHERE id = ? AND to_id = ? AND claimed_at IS NULL AND expires_at > ?");
const qMailCount = db.prepare("SELECT COUNT(*) AS n FROM rpg_mail WHERE to_id = ? AND claimed_at IS NULL AND expires_at > ?");
const qMailExpired = db.prepare("SELECT id, to_id FROM rpg_mail WHERE claimed_at IS NULL AND expires_at <= ?");
const qMailDelete = db.prepare("DELETE FROM rpg_mail WHERE id = ?");
const qItemsDeleteAt = db.prepare("DELETE FROM rpg_items WHERE owner_id = ? AND location = ? AND slot BETWEEN ? AND ?");

export const insertMail = (to: number, sender: string, subject: string, body: string, attachRuc: number, reason: string, now: number, expires: number) =>
  Number(qMailNew.run(to, sender, subject, body, attachRuc, reason, now, expires).lastInsertRowid);
export const listMail = (to: number, now: number) => qMails.all(to, now) as MailRow[];
export const mailRow = (id: number) => (qMailOne.get(id) as MailRow | undefined) ?? null;
/** 받기 표시 — 안 받았고 기간 안일 때만 (이중 수령 방지, 마크 우편함과 같은 조건부 UPDATE) */
export const markClaimed = (id: number, to: number, now: number) => qMailClaim.run(now, id, to, now).changes === 1;
export const mailCount = (to: number, now: number) => (qMailCount.get(to, now) as { n: number }).n;
/** 30일 지난 우편 정리 (첨부 아이템도) — 감사 로그 */
export function purgeMail(now: number, perMail: number): number {
  const rows = qMailExpired.all(now) as { id: number; to_id: number }[];
  for (const m of rows)
    tx(() => {
      qItemsDeleteAt.run(m.to_id, "mail", m.id * perMail, m.id * perMail + perMail - 1);
      qMailDelete.run(m.id);
      audit(null, "mail_expire", String(m.id), { to: m.to_id }, null);
    });
  return rows.length;
}

const qRoll = db.prepare("SELECT items, purchased FROM rpg_shop_rolls WHERE character_id = ? AND cycle = ?");
const qRollSave = db.prepare(`INSERT INTO rpg_shop_rolls (character_id, cycle, items, purchased) VALUES (?, ?, ?, ?)
  ON CONFLICT(character_id, cycle) DO UPDATE SET purchased = excluded.purchased`);
export const shopRoll = (owner: number, cycle: number) => {
  const r = qRoll.get(owner, cycle) as { items: string; purchased: string } | undefined;
  return r ? { items: JSON.parse(r.items), purchased: JSON.parse(r.purchased) as Record<number, number> } : null;
};
export const saveShopRoll = (owner: number, cycle: number, items: unknown, purchased: Record<number, number>) => qRollSave.run(owner, cycle, JSON.stringify(items), JSON.stringify(purchased));

export type ListingRow = { id: number; seller_id: number; item_id: string; price_options: string; status: string; buyer_id: number | null; created_at: number; expires_at: number; closed_at: number | null };
const qListNew = db.prepare("INSERT INTO rpg_market_listings (seller_id, item_id, price_options, status, created_at, expires_at) VALUES (?, ?, ?, 'open', ?, ?)");
const qListOpen = db.prepare("SELECT * FROM rpg_market_listings WHERE status = 'open' AND expires_at > ? ORDER BY id DESC LIMIT 500");
const qListMine = db.prepare("SELECT * FROM rpg_market_listings WHERE seller_id = ? AND status = 'open' ORDER BY id DESC");
const qListOne = db.prepare("SELECT * FROM rpg_market_listings WHERE id = ?");
const qListClose = db.prepare("UPDATE rpg_market_listings SET status = ?, buyer_id = ?, closed_at = ? WHERE id = ? AND status = 'open'");
const qListExpired = db.prepare("SELECT * FROM rpg_market_listings WHERE status = 'open' AND expires_at <= ?");
export const insertListing = (seller: number, itemId: string, prices: unknown, now: number, expires: number) =>
  Number(qListNew.run(seller, itemId, JSON.stringify(prices), now, expires).lastInsertRowid);
export const openListings = (now: number) => qListOpen.all(now) as ListingRow[];
export const myListings = (seller: number) => qListMine.all(seller) as ListingRow[];
export const listing = (id: number) => (qListOne.get(id) as ListingRow | undefined) ?? null;
/** 판매 · 취소 · 만료로 닫음 — 아직 열려 있을 때만 (두 번 팔리지 않게) */
export const closeListing = (id: number, status: "sold" | "cancelled" | "expired", buyer: number | null, now: number) => qListClose.run(status, buyer, now, id).changes === 1;
export const expiredListings = (now: number) => qListExpired.all(now) as ListingRow[];

const qBroadcast = db.prepare("INSERT INTO rpg_broadcasts (kind, text, created_at) VALUES (?, ?, ?)");
export const saveBroadcast = (kind: string, text: string) => qBroadcast.run(kind, text, Date.now());
export const audit = (actor: number | null, action: string, target: string | null, before: unknown, after: unknown) =>
  qAudit.run(actor, action, target, JSON.stringify(before), JSON.stringify(after), Date.now());

// ── 퀘스트 (P6) ──────────────────────────────────────────────────────
export type QuestRow = { quest_id: string; state: "active" | "done"; prog: number[]; tracked: boolean };
const qQuests = db.prepare("SELECT * FROM rpg_quests WHERE char_id = ?");
const qQuestSave = db.prepare(`INSERT INTO rpg_quests (char_id, quest_id, state, prog, tracked, updated_at) VALUES (?, ?, ?, ?, ?, ?)
  ON CONFLICT(char_id, quest_id) DO UPDATE SET state = excluded.state, prog = excluded.prog, tracked = excluded.tracked, updated_at = excluded.updated_at`);
export const loadQuests = (id: number): QuestRow[] =>
  (qQuests.all(id) as { quest_id: string; state: "active" | "done"; prog: string; tracked: number }[]).map((r) => ({ quest_id: r.quest_id, state: r.state, prog: JSON.parse(r.prog), tracked: !!r.tracked }));
export const saveQuest = (id: number, q: QuestRow) => qQuestSave.run(id, q.quest_id, q.state, JSON.stringify(q.prog), q.tracked ? 1 : 0, Date.now());

export type UQRow = {
  id: number; owner_id: number; owner_name: string; title: string; kind: "kill" | "deliver" | "stage" | "duel"; target: string; n: number; reward_ruc: number;
  item_ids: string; slots: number; taken: number; paid: number; status: "open" | "closed"; created_at: number; expires_at: number;
};
const qUqNew = db.prepare("INSERT INTO rpg_user_quests (owner_id, owner_name, title, kind, target, n, reward_ruc, item_ids, slots, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)");
const qUqOne = db.prepare("SELECT * FROM rpg_user_quests WHERE id = ?");
const qUqOpen = db.prepare("SELECT * FROM rpg_user_quests WHERE status = 'open' AND expires_at > ? ORDER BY id DESC LIMIT 200");
const qUqOwn = db.prepare("SELECT * FROM rpg_user_quests WHERE owner_id = ? AND (status = 'open' OR created_at > ?) ORDER BY id DESC");
const qUqExpired = db.prepare("SELECT * FROM rpg_user_quests WHERE status = 'open' AND expires_at <= ?");
const qUqClose = db.prepare("UPDATE rpg_user_quests SET status = 'closed' WHERE id = ? AND status = 'open'");
const qUqTake = db.prepare("UPDATE rpg_user_quests SET taken = taken + 1 WHERE id = ? AND status = 'open' AND expires_at > ? AND taken < slots");
const qUqPaid = db.prepare("UPDATE rpg_user_quests SET paid = paid + 1 WHERE id = ?");
const qUqActiveN = db.prepare("SELECT COUNT(*) AS n FROM rpg_user_quests WHERE owner_id = ? AND status = 'open'");
export const insertUserQuest = (q: { owner: number; name: string; title: string; kind: string; target: string; n: number; ruc: number; itemIds: string[]; slots: number; expires: number }) =>
  Number(qUqNew.run(q.owner, q.name, q.title, q.kind, q.target, q.n, q.ruc, JSON.stringify(q.itemIds), q.slots, Date.now(), q.expires).lastInsertRowid);
export const userQuest = (id: number) => qUqOne.get(id) as UQRow | undefined;
export const openUserQuests = (now: number) => qUqOpen.all(now) as UQRow[];
export const ownUserQuests = (owner: number, since: number) => qUqOwn.all(owner, since) as UQRow[];
export const expiredUserQuests = (now: number) => qUqExpired.all(now) as UQRow[];
export const closeUserQuest = (id: number) => qUqClose.run(id).changes === 1;
export const takeSlot = (id: number, now: number) => qUqTake.run(id, now).changes === 1;
export const markPaid = (id: number) => qUqPaid.run(id);
export const activeUserQuestCount = (owner: number) => (qUqActiveN.get(owner) as { n: number }).n;

export type TakeRow = { quest_id: number; char_id: number; prog: number; state: "active" | "done" | "dropped" };
const qTakeNew = db.prepare("INSERT INTO rpg_user_quest_takes (quest_id, char_id, created_at) VALUES (?, ?, ?)");
const qTakesOf = db.prepare("SELECT * FROM rpg_user_quest_takes WHERE char_id = ? AND state = 'active'");
const qTakesFor = db.prepare("SELECT * FROM rpg_user_quest_takes WHERE quest_id = ? AND state = 'active'");
const qTakeProg = db.prepare("UPDATE rpg_user_quest_takes SET prog = ? WHERE quest_id = ? AND char_id = ? AND state = 'active'");
const qTakeState = db.prepare("UPDATE rpg_user_quest_takes SET state = ? WHERE quest_id = ? AND char_id = ? AND state = 'active'");
const qTakeAny = db.prepare("SELECT 1 AS x FROM rpg_user_quest_takes WHERE quest_id = ? AND char_id = ?");
export const insertTake = (quest: number, char: number) => qTakeNew.run(quest, char, Date.now());
export const activeTakes = (char: number) => qTakesOf.all(char) as TakeRow[];
export const takesFor = (quest: number) => qTakesFor.all(quest) as TakeRow[];
export const saveTakeProg = (quest: number, char: number, prog: number) => qTakeProg.run(prog, quest, char);
export const setTakeState = (quest: number, char: number, state: "done" | "dropped") => qTakeState.run(state, quest, char).changes === 1;
export const hasTaken = (quest: number, char: number) => !!qTakeAny.get(quest, char);

// ── 알림 (P6, §22) ───────────────────────────────────────────────────
export type NotiRow = { id: number; char_id: number; kind: string; text: string; data: string | null; read: number; created_at: number };
const qNotiNew = db.prepare("INSERT INTO rpg_notifications (char_id, kind, text, data, created_at) VALUES (?, ?, ?, ?, ?)");
const qNotiList = db.prepare("SELECT * FROM rpg_notifications WHERE char_id = ? ORDER BY id DESC LIMIT 50");
const qNotiRead = db.prepare("UPDATE rpg_notifications SET read = 1 WHERE char_id = ? AND (? = 0 OR id = ?)");
const qNotiPrune = db.prepare("DELETE FROM rpg_notifications WHERE char_id = ? AND id NOT IN (SELECT id FROM rpg_notifications WHERE char_id = ? ORDER BY id DESC LIMIT 200)");
export const insertNoti = (char: number, kind: string, text: string, data?: unknown) => {
  const id = Number(qNotiNew.run(char, kind, text, data === undefined ? null : JSON.stringify(data), Date.now()).lastInsertRowid);
  qNotiPrune.run(char, char);
  return id;
};
export const listNotis = (char: number) => qNotiList.all(char) as NotiRow[];
export const readNotis = (char: number, id = 0) => qNotiRead.run(char, id, id);

// ── K/D/A · 칭호 · 서버 공지 (P7) ─────────────────────────────────────
const qKda = db.prepare("SELECT kills, deaths, assists FROM rpg_kda WHERE character_id = ? AND season = ?");
const qKdaAdd = db.prepare(`INSERT INTO rpg_kda (character_id, season, kills, deaths, assists) VALUES (?, ?, ?, ?, ?)
  ON CONFLICT(character_id, season) DO UPDATE SET kills = kills + excluded.kills, deaths = deaths + excluded.deaths, assists = assists + excluded.assists`);
export function loadKda(char: number, season: string): [number, number, number] {
  const r = qKda.get(char, season) as { kills: number; deaths: number; assists: number } | undefined;
  return r ? [r.kills, r.deaths, r.assists] : [0, 0, 0];
}
export const addKda = (char: number, season: string, k: number, d: number, a: number) => qKdaAdd.run(char, season, k, d, a);

const qTitles = db.prepare("SELECT title_id FROM rpg_character_titles WHERE character_id = ? ORDER BY created_at");
const qTitleAdd = db.prepare("INSERT OR IGNORE INTO rpg_character_titles (character_id, title_id, created_at) VALUES (?, ?, ?)");
const qTitleSet = db.prepare("UPDATE rpg_characters SET title_id = ? WHERE id = ?");
export const loadTitles = (char: number) => (qTitles.all(char) as { title_id: string }[]).map((r) => r.title_id);
/** 새로 받았으면 true */
export const grantTitle = (char: number, id: string) => qTitleAdd.run(char, id, Date.now()).changes === 1;
export const setTitle = (char: number, id: string | null) => qTitleSet.run(id, char);

const qBroadcastKind = db.prepare("SELECT 1 AS x FROM rpg_broadcasts WHERE kind = ? LIMIT 1");
export const broadcastExists = (kind: string) => !!qBroadcastKind.get(kind);

