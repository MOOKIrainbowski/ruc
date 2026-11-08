import { randomUUID } from "node:crypto";
import { CHANNEL_CAP, type RoomKind } from "../../../web/rpg/shared/constants.ts";
import { ITEMS, RARITIES, type Rarity } from "../../../web/rpg/shared/data/items.ts";
import { GRADES, MOBS, type Grade } from "../../../web/rpg/shared/data/mobs.ts";
import { chatTo } from "./chat.ts";
import { activeSanction, addBug, addSanction, audit, db, liftSanction, listBugs, saveBroadcast } from "./db.ts";
import { online, pay, sendWallet } from "./economy.ts";
import { give, refreshGear, sendInv } from "./items.ts";
import { partyOf } from "./party.ts";
import { setLevel } from "./progress.ts";
import { settleWeek } from "./realm.ts";
import { send, type Player, type Room } from "./room.ts";

/**
 * GM 도구 (§28): 디스코드 ID 화이트리스트(RPG_GM_IDS, 쉼표) — 개발 모드(--dev)에서는 ?dev= 계정도 GM.
 * 채팅에 "/gm 명령" 또는 GM 창(F8)의 버튼(같은 명령을 보냄). 모든 GM 행위는 감사 로그 (gm_명령).
 * 버그 제보(§28)도 여기: 설정 창의 버튼 → 스크린샷(작은 JPEG) · 위치 · 클라이언트 로그 → DB (+ RPG_BUG_WEBHOOK 이 있으면 디스코드).
 */

const GM_IDS = new Set((process.env.RPG_GM_IDS ?? "").split(",").map((s) => s.trim()).filter(Boolean));
let dev = false;
export const setGmDev = (on: boolean) => void (dev = on);
export const isGM = (p: Player) => GM_IDS.has(p.discordId) || (dev && p.discordId.startsWith("dev-"));

/** main.ts 가 채움: 다른 방(채널 맵)으로 · 지정한 방(던전 인스턴스 포함)으로 */
export const gmHooks = {
  travel: (_p: Player, _kind: RoomKind, _x: number, _y: number) => {},
  place: (_p: Player, _room: Room, _x: number, _y: number) => {},
};

const tell = (p: Player, msg: string) => chatTo([p], "system", "GM", msg);
const findOnline = (name: unknown) => {
  const n = String(name ?? "").toLowerCase();
  return online.all().find((q) => q.char.nickname.toLowerCase() === n);
};
const qByName = db.prepare("SELECT id, discord_id, nickname FROM rpg_characters WHERE nickname = ? COLLATE NOCASE");
const byName = (name: unknown) => qByName.get(String(name ?? "")) as { id: number; discord_id: string; nickname: string } | undefined;
const int = (v: unknown, d: number) => (Number.isFinite(Number(v)) && v !== undefined ? Math.trunc(Number(v)) : d);

export const GM_HELP = [
  "/gm give 닉 아이템id [개수] [희귀도]", "/gm level 닉 레벨", "/gm ruc 닉 양(음수 가능)", "/gm tp 닉 | /gm tp 맵 x y",
  "/gm spawn 몹id [수] [등급]", "/gm mute 닉 분 [사유] · /gm unmute 닉", "/gm kick 닉 [사유]", "/gm ban 닉 시간|perm [사유] · /gm unban 닉",
  "/gm announce 내용", "/gm who",
].join("\n");

/** "/gm …" 실행. 반환 = 거절 이유 (성공하면 GM 채팅으로 결과) */
export function gmCommand(p: Player, text: string): string | null {
  if (!isGM(p)) return "GM 만 쓸 수 있는 명령입니다";
  const [, cmd = "help", ...a] = text.split(/\s+/);
  const ok = (msg: string, target: string | null = null) => {
    audit(p.char.id, `gm_${cmd}`, target, null, { args: a });
    tell(p, msg);
    return null;
  };
  const need = (q: Player | undefined): q is Player => !!q;
  switch (cmd) {
    case "help":
      tell(p, GM_HELP);
      return null;
    case "who":
      return ok(online.all().map((q) => `${q.char.nickname} Lv${q.char.level} · ${q.room?.kind ?? "-"} ${q.room?.ch ?? ""} (${Math.round(q.x)},${Math.round(q.y)})`).join("\n") || "접속자 없음");
    case "give": {
      const q = findOnline(a[0]);
      if (!need(q)) return "접속 중인 닉네임이 아닙니다";
      if (!Object.hasOwn(ITEMS, a[1] ?? "")) return "없는 아이템 id 입니다";
      const r: Rarity = RARITIES.includes(a[3] as Rarity) ? (a[3] as Rarity) : ITEMS[a[1]].rarity ?? "common";
      const err = give(q, a[1], Math.max(1, Math.min(999, int(a[2], 1))), r, `gm:${p.char.id}`);
      if (err) return err;
      refreshGear(q);
      sendInv(q);
      return ok(`${q.char.nickname}에게 ${ITEMS[a[1]].name} ×${int(a[2], 1)} (${r})`, q.char.nickname);
    }
    case "level": {
      const q = findOnline(a[0]);
      if (!need(q)) return "접속 중인 닉네임이 아닙니다";
      setLevel(q, int(a[1], q.char.level));
      return ok(`${q.char.nickname} → Lv${q.char.level}`, q.char.nickname);
    }
    case "ruc": {
      const q = findOnline(a[0]);
      const n = int(a[1], 0);
      if (!need(q) || !n) return "/gm ruc 닉 양";
      try { pay(q, n, "gm", String(p.char.id), `gm:${q.char.id}:${randomUUID()}`); } catch (e) { return e instanceof Error ? e.message : "실패"; }
      sendWallet(q);
      return ok(`${q.char.nickname} RUC ${n > 0 ? "+" : ""}${n} → ${q.ruc}`, q.char.nickname);
    }
    case "tp": {
      if (a.length >= 3) {
        const kind = a[0] as RoomKind;
        if (!Object.hasOwn(CHANNEL_CAP, kind) || kind === "dungeon") return "맵은 plaza · field · arena";
        gmHooks.travel(p, kind, int(a[1], 0), int(a[2], 0));
        return ok(`${kind} (${a[1]}, ${a[2]})`);
      }
      const q = findOnline(a[0]);
      if (!need(q) || !q.room) return "접속 중인 닉네임이 아닙니다";
      gmHooks.place(p, q.room, q.x, q.y);
      return ok(`${q.char.nickname} 옆으로`, q.char.nickname);
    }
    case "settle": {
      // 영지 주간 정산을 지금 (이번 주 영향력으로, P14)
      settleWeek(Date.now(), true);
      return ok("영지 정산 완료");
    }
    case "spawn": {
      const key = a[0] ?? "";
      const grade = (Object.hasOwn(GRADES, a[2] ?? "") ? a[2] : "normal") as Grade;
      if (!Object.hasOwn(MOBS, key) || !p.room) return "없는 몹 id 입니다";
      const n = Math.max(1, Math.min(20, int(a[1], 1)));
      for (let i = 0; i < n; i++) p.room.addMob({ mob: key, count: 0, lv: [p.char.level, p.char.level], grade, x: p.x, y: p.y - 30, r: 40, alive: 0, respawn: [] });
      return ok(`${MOBS[key].name} ×${n} (${GRADES[grade].name})`);
    }
    case "mute":
    case "ban": {
      const c = byName(a[0]);
      if (!c) return "없는 닉네임입니다";
      const perm = a[1] === "perm";
      const span = int(a[1], cmd === "mute" ? 10 : 24) * (cmd === "mute" ? 60_000 : 3_600_000);
      const reason = a.slice(2).join(" ").slice(0, 100);
      addSanction(c.discord_id, cmd, perm ? 0 : Date.now() + span, reason, p.char.id);
      const q = findOnline(c.nickname);
      if (q && cmd === "ban") { send(q, { t: "kicked", reason: "banned" }); q.ws.close(); }
      if (q && cmd === "mute") tell(q, `채팅이 ${perm ? "영구히" : `${Math.round(span / 60_000)}분 동안`} 금지되었습니다${reason ? ` (${reason})` : ""}`);
      return ok(`${c.nickname} ${cmd === "ban" ? "차단" : "채팅 금지"} ${perm ? "영구" : cmd === "ban" ? `${a[1] ?? 24}시간` : `${a[1] ?? 10}분`}`, c.nickname);
    }
    case "unmute":
    case "unban": {
      const c = byName(a[0]);
      if (!c) return "없는 닉네임입니다";
      return liftSanction(c.discord_id, cmd === "unban" ? "ban" : "mute") ? ok(`${c.nickname} 해제`, c.nickname) : "걸려 있는 제재가 없습니다";
    }
    case "kick": {
      const q = findOnline(a[0]);
      if (!need(q)) return "접속 중인 닉네임이 아닙니다";
      send(q, { t: "kicked", reason: "gm" });
      q.ws.close();
      return ok(`${q.char.nickname} 추방`, q.char.nickname);
    }
    case "announce": {
      const msg = a.join(" ").slice(0, 120);
      if (!msg) return "/gm announce 내용";
      saveBroadcast("gm", msg);
      for (const o of online.all()) send(o, { t: "notice", text: `[운영] ${msg}` });
      chatTo(online.all(), "gm", p.char.nickname, msg);
      return ok("공지를 보냈습니다");
    }
  }
  return "모르는 명령입니다 — /gm help";
}

/** GM 창 (F8): 실시간 접속자 · 최근 버그 제보 (스크린샷은 하나씩 따로) */
export function gmPanel(p: Player, bug?: unknown) {
  if (!isGM(p)) return "GM 만 볼 수 있습니다";
  if (bug !== undefined) {
    const b = listBugs(50).find((x) => x.id === Number(bug));
    send(p, { t: "gm", bug: b ? { id: b.id, img: b.img, log: JSON.parse(b.log) } : null });
    return null;
  }
  send(p, {
    t: "gm",
    players: online.all().map((q) => ({ name: q.char.nickname, lv: q.char.level, where: q.room?.kind ?? "", ch: q.room?.ch ?? 0, x: Math.round(q.x), y: Math.round(q.y), party: !!partyOf(q), muted: !!activeSanction(q.discordId, "mute") })),
    bugs: listBugs(20).map((b) => ({ id: b.id, name: b.name, place: b.place, text: b.text, at: b.created_at, img: !!b.img })),
  });
  return null;
}

// ── 버그 제보 (§28) ────────────────────────────────────────────────
const bugAt = new Map<number, number>();
export const BUG = { cooldownMs: 60_000, maxImg: 220_000, maxText: 1000 };

export function bugOp(p: Player, m: { text?: unknown; img?: unknown; log?: unknown }): string | null {
  const now = Date.now();
  if (now - (bugAt.get(p.char.id) ?? 0) < BUG.cooldownMs) return "버그 제보는 1분에 한 번 보낼 수 있어요";
  const text = typeof m.text === "string" ? m.text.trim().slice(0, BUG.maxText) : "";
  if (text.length < 2) return "무슨 일이 있었는지 적어 주세요";
  const img = typeof m.img === "string" && m.img.startsWith("data:image/jpeg;base64,") && m.img.length <= BUG.maxImg ? m.img : null;
  const log = (Array.isArray(m.log) ? m.log : []).slice(-60).map((x) => String(x).slice(0, 300));
  bugAt.set(p.char.id, now);
  const place = `${p.room?.kind ?? "-"} ${p.room?.ch ?? ""}채널 (${Math.round(p.x)}, ${Math.round(p.y)})`;
  const id = addBug({ char_id: p.char.id, name: p.char.nickname, place, text, log: JSON.stringify(log), img });
  audit(p.char.id, "bug_report", String(id), null, { place });
  void webhook(id, p.char.nickname, place, text, log, img);
  tell(p, `버그 제보 #${id} 를 받았어요. 고마워요!`);
  return null;
}

/** RPG_BUG_WEBHOOK (디스코드 웹훅 URL) 이 있으면 스크린샷을 붙여 보냄. 실패해도 DB 에는 남아 있음 */
async function webhook(id: number, name: string, place: string, text: string, log: string[], img: string | null) {
  const url = process.env.RPG_BUG_WEBHOOK?.trim();
  if (!url) return;
  try {
    const form = new FormData();
    form.set("payload_json", JSON.stringify({ content: `**버그 제보 #${id}** — ${name} · ${place}\n${text}\n\`\`\`\n${log.slice(-12).join("\n").slice(0, 1200)}\n\`\`\``.slice(0, 1990) }));
    if (img) form.set("files[0]", new Blob([Buffer.from(img.split(",")[1], "base64")], { type: "image/jpeg" }), `bug-${id}.jpg`);
    await fetch(url, { method: "POST", body: form });
  } catch (e) {
    console.error("버그 제보 웹훅 실패", e);
  }
}
