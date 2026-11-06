import { mkdirSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import type { Appearance } from "../../../web/rpg/shared/data/appearance.ts";

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
`);

export type CharacterRow = {
  id: number;
  discord_id: string;
  nickname: string;
  level: number;
  exp: number;
  element: string;
  appearance: Appearance;
  position: { map: string; x: number; y: number } | null;
  settings: Record<string, unknown> | null;
};

type Raw = Omit<CharacterRow, "appearance" | "position" | "settings"> & { appearance: string; position: string | null; settings: string | null };

const parse = (r: Raw | undefined): CharacterRow | null =>
  r ? { ...r, appearance: JSON.parse(r.appearance), position: r.position ? JSON.parse(r.position) : null, settings: r.settings ? JSON.parse(r.settings) : null } : null;

const qFind = db.prepare("SELECT * FROM rpg_characters WHERE discord_id = ?");
const qInsert = db.prepare("INSERT INTO rpg_characters (discord_id, nickname, element, appearance, created_at) VALUES (?, ?, ?, ?, ?)");
const qPos = db.prepare("UPDATE rpg_characters SET position = ? WHERE id = ?");
const qSettings = db.prepare("UPDATE rpg_characters SET settings = ? WHERE id = ?");

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

export const savePosition = (id: number, p: { map: string; x: number; y: number }) => qPos.run(JSON.stringify(p), id);
export const saveSettings = (id: number, s: unknown) => qSettings.run(JSON.stringify(s), id);
