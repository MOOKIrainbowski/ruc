/**
 * 광장 "솔라스" (§18) 맵 생성 → web/rpg/shared/data/maps/plaza.json (Tiled 호환).
 * 실행: node RUC_RPG/scripts/gen-plaza.ts
 * 한 번 만든 뒤 Tiled 에디터로 고쳐도 됩니다 — 다시 돌리면 덮어쓰니 그때는 이 스크립트를 쓰지 마세요.
 */
import { TILE } from "../../web/rpg/shared/constants.ts";
import { mapKit } from "./mapkit.ts";

const { W, H, rand, fill, solid, clear, reserve, obj, objects, hedgeBorder, trees, write } = mapKit(96, 96, 20261107);

// ── 바닥: 잔디 + 얼룩 ─────────────────────────────────────────────
fill("ground", "grass", 0, 0, W, H);
for (let i = 0; i < 260; i++) fill("ground", "grass_dark", Math.floor(rand() * W), Math.floor(rand() * H), 1 + Math.floor(rand() * 3), 1 + Math.floor(rand() * 2));

hedgeBorder();

// ── 도랑 (사각형, 폭 3) + 돌 테두리 ─────────────────────────────────
const M = { x0: 14, y0: 22, x1: 81, y1: 73 }; // 바깥 경계 (포함)
fill("ground", "stone_edge", M.x0 - 1, M.y0 - 1, M.x1 - M.x0 + 3, M.y1 - M.y0 + 3);
fill("ground", "grass", M.x0 + 4, M.y0 + 4, M.x1 - M.x0 - 7, M.y1 - M.y0 - 7);
for (const [x, y, w, h] of [
  [M.x0, M.y0, M.x1 - M.x0 + 1, 3], [M.x0, M.y1 - 2, M.x1 - M.x0 + 1, 3],
  [M.x0, M.y0, 3, M.y1 - M.y0 + 1], [M.x1 - 2, M.y0, 3, M.y1 - M.y0 + 1],
]) {
  fill("water", "water", x, y, w, h);
  solid(x, y, w, h);
}
reserve(M.x0 - 1, M.y0 - 1, M.x1 - M.x0 + 3, 5); reserve(M.x0 - 1, M.y1 - 3, M.x1 - M.x0 + 3, 5);
reserve(M.x0 - 1, M.y0 - 1, 5, M.y1 - M.y0 + 3); reserve(M.x1 - 3, M.y0 - 1, 5, M.y1 - M.y0 + 3);

// ── 길 (십자) + 다리 ────────────────────────────────────────────────
const CX = 46; // 남북 길 x 시작 (폭 4)
const CY = 46; // 동서 길 y 시작
fill("ground", "cobble", CX, 2, 4, H - 4); reserve(CX - 1, 2, 6, H - 4);
fill("ground", "cobble", 2, CY, W - 4, 4); reserve(2, CY - 1, W - 4, 6);
for (const [x, y, w, h] of [[CX, M.y0, 4, 3], [CX, M.y1 - 2, 4, 3], [M.x0, CY, 3, 4], [M.x1 - 2, CY, 3, 4]]) {
  fill("decor_below", "bridge", x, y, w, h);
  clear(x, y, w, h);
}

// ── 분수 광장 ───────────────────────────────────────────────────────
fill("ground", "sand", 36, 36, 24, 24); reserve(36, 36, 24, 24);
fill("decor_below", "fountain_rim", 44, 44, 8, 8);
fill("water", "fountain_water", 45, 45, 6, 6);
solid(44, 44, 8, 8);
obj("statue", "정령 조각상", 47, 46, 2, 3, 0);
for (const [x, y] of [[37, 37], [58, 37], [37, 58], [58, 58]]) obj("lamp", "가로등", x, y - 1, 1, 2, 1);
for (const [x, y] of [[40, 38], [54, 38], [40, 57], [54, 57]]) obj("bench", "벤치", x, y, 2, 1, 1);
for (const [x, y] of [[20, 27], [70, 27], [20, 66], [70, 66], [38, 27], [56, 27], [38, 66], [56, 66]]) {
  fill("decor_below", "flowers", x, y, 4, 2); reserve(x, y, 4, 2);
}

// ── 상점 천막 (서: 일반 ×4 / 동: 유저 ×6) ─────────────────────────────
for (let i = 0; i < 4; i++) obj("tent_shop", `일반 상점 ${i + 1}`, 22 + (i % 2) * 6, 31 + Math.floor(i / 2) * 22, 3, 3, 2, { shop: "general" });
for (let i = 0; i < 6; i++) obj("tent_market", `유저 상점 ${i + 1}`, 64 + (i % 2) * 6, 29 + Math.floor(i / 2) * 13, 3, 3, 2, { shop: "market" });

// ── 북쪽: 던전 포털 · 창고 · 대장간 · 교관 ─────────────────────────────
obj("portal", "고대 유적의 문", CX, 2, 4, 4, 0, { target: "dungeon" });
obj("building", "창고", 18, 6, 8, 7, 4, { role: "storage" });
obj("building", "대장간", 30, 6, 9, 7, 4, { role: "smithy" });
obj("anvil", "강화대", 40, 11, 2, 1, 1);
obj("npc", "볼트", 41, 9, 1, 1, 1, { npc: "volt", role: "대장장이" });
obj("npc", "다리오", 51, 5, 1, 1, 1, { npc: "dario", role: "유적 탐험가" });
obj("npc", "세라", 60, 12, 1, 1, 1, { npc: "sera", role: "직업 교관" });
obj("npc", "오웬", 70, 12, 1, 1, 1, { npc: "owen", role: "스킬 교관" });
obj("sign", "직업 교관", 58, 12, 1, 1, 1);
obj("sign", "스킬 교관", 68, 12, 1, 1, 1);

// ── 남쪽: 우편함 · 게시판 · 루미 · 연금술 · 필드 출구 ──────────────────
obj("mailbox", "우편함", 28, 80, 1, 2, 1);
obj("npc", "핍", 30, 81, 1, 1, 1, { npc: "pip", role: "우편 집배원" });
obj("board", "퀘스트 게시판", 37, 80, 3, 2, 1);
obj("npc", "루미", 55, 80, 1, 1, 1, { npc: "lumi", role: "안내원" });
obj("workbench", "연금술 작업대", 64, 80, 3, 2, 1);
obj("npc", "미르", 68, 81, 1, 1, 1, { npc: "mir", role: "연금술사" });
obj("portal", "햇살 초원", CX, 90, 4, 4, 0, { target: "field", ax: (CX + 2) * TILE, ay: 88 * TILE }); // ax · ay = 필드에서 돌아올 때 도착 지점

// ── 동쪽: 결투장 포털 / 서쪽 끝 전망대 ─────────────────────────────────
obj("portal", "결투장", 90, CY, 4, 4, 0, { target: "arena" });
obj("sign", "솔라스 전망대", 4, CY - 2, 1, 1, 1);

// 시작 위치: 분수 남쪽
objects.push({ id: objects.length + 1, name: "spawn", type: "spawn", x: 48 * TILE, y: 63 * TILE, width: 0, height: 0 });

// ── 나무: 빈 잔디에 흩뿌림 (줄기 1칸만 막음) ───────────────────────────
trees(2500);
write("plaza");
