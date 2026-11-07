import { mkdirSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import type { Appearance } from "../../../web/rpg/shared/data/appearance.ts";
import type { Item } from "../../../web/rpg/shared/data/items.ts";

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

type ItemRaw = { id: string; template_id: string; location: Item["loc"]; slot: number; qty: number; rarity: Item["rarity"]; enhance: number; specials: string; durability: number; durability_max: number };
const qItems = db.prepare("SELECT * FROM rpg_items WHERE owner_id = ? AND location IN ('inventory', 'hotbar', 'equipped', 'storage')");
const qDelItem = db.prepare("DELETE FROM rpg_items WHERE id = ? AND owner_id = ?");
const qPark = db.prepare("UPDATE rpg_items SET slot = ? WHERE id = ? AND owner_id = ?");
const qUpsert = db.prepare(`INSERT INTO rpg_items (id, owner_id, template_id, location, slot, qty, rarity, enhance, specials, durability, durability_max, origin, created_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(id) DO UPDATE SET location = excluded.location, slot = excluded.slot, qty = excluded.qty, durability = excluded.durability
  WHERE owner_id = excluded.owner_id`);
const qDur = db.prepare("UPDATE rpg_items SET durability = ? WHERE id = ? AND owner_id = ?");
const qAudit = db.prepare("INSERT INTO rpg_audit_log (actor, action, target, before, after, created_at) VALUES (?, ?, ?, ?, ?, ?)");

export function loadItems(owner: number): Item[] {
  return (qItems.all(owner) as ItemRaw[]).map((r) => ({
    id: r.id, tpl: r.template_id, loc: r.location, slot: r.slot, qty: r.qty, rarity: r.rarity, enh: r.enhance, sp: JSON.parse(r.specials), dur: r.durability, durMax: r.durability_max,
  }));
}

/**
 * 아이템 변경 저장 — 트랜잭션 하나 + 감사 로그 (§14-3). 실패하면 아무것도 안 바뀜.
 * 칸을 맞바꿀 때 UNIQUE(위치, 칸)에 걸리지 않게 바뀌는 행을 먼저 음수 칸으로 비켜 둡니다.
 */
export function saveItems(owner: number, changed: Item[], removed: string[], action: string, origin: string, before: unknown, after: unknown) {
  db.exec("BEGIN");
  try {
    for (const id of removed) qDelItem.run(id, owner);
    changed.forEach((it, i) => qPark.run(-1 - i, it.id, owner));
    const now = Date.now();
    for (const it of changed) qUpsert.run(it.id, owner, it.tpl, it.loc, it.slot, it.qty, it.rarity, it.enh, JSON.stringify(it.sp), it.dur, it.durMax, origin, now);
    qAudit.run(owner, action, changed[0]?.id ?? removed[0] ?? null, JSON.stringify(before), JSON.stringify(after), now);
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
}

export const saveDurability = (owner: number, id: string, dur: number) => qDur.run(dur, id, owner);
