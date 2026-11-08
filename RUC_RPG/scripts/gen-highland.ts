/**
 * 필드 "황혼 고원" (P15, 정식 성장 베타 편입 · D99) 생성 → web/rpg/shared/data/maps/highland.json (Tiled 호환).
 * 실행: node RUC_RPG/scripts/gen-highland.ts
 * Lv30~100 사냥터: 북쪽 입구(햇살 초원) → 남쪽으로 내려갈수록 강해짐.
 *   황혼 덤불(임프 30~38) · 바위 언덕(멧돼지 38~48) · 서리 절벽(하피 48~60) · 잿불 분지(골렘 60~72) · 그림자 폐허(기사 72~86) · 폭풍 봉우리(비룡 86~100)
 */
import { TILE } from "../../web/rpg/shared/constants.ts";
import { mapKit } from "./mapkit.ts";

const { W, H, rand, fill, solid, reserve, isUsed, obj, hedgeBorder, trees, write } = mapKit(104, 120, 20261109);

fill("ground", "grass_dark", 0, 0, W, H);
for (let i = 0; i < 420; i++) fill("ground", "grass", Math.floor(rand() * W), Math.floor(rand() * H), 1 + Math.floor(rand() * 3), 1 + Math.floor(rand() * 2));
hedgeBorder();

function path(x0: number, y0: number, x1: number, y1: number, w = 3) {
  const [ax, bx] = x0 < x1 ? [x0, x1] : [x1, x0];
  const [ay, by] = y0 < y1 ? [y0, y1] : [y1, y0];
  fill("ground", "dirt", ax, y0, bx - ax + w, w); fill("decor_below", 0, ax, y0, bx - ax + w, w); reserve(ax, y0, bx - ax + w, w);
  fill("ground", "dirt", x1, ay, w, by - ay + w); fill("decor_below", 0, x1, ay, w, by - ay + w); reserve(x1, ay, w, by - ay + w);
}
function lake(cx: number, cy: number, rx: number, ry: number) {
  for (let y = cy - ry - 2; y <= cy + ry + 2; y++) for (let x = cx - rx - 2; x <= cx + rx + 2; x++) {
    const d = ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2;
    if (d <= 1) { fill("water", "water", x, y, 1, 1); fill("decor_below", 0, x, y, 1, 1); solid(x, y, 1, 1); }
    else if (((x - cx) / (rx + 1.6)) ** 2 + ((y - cy) / (ry + 1.6)) ** 2 <= 1) { fill("ground", "sand", x, y, 1, 1); fill("decor_below", 0, x, y, 1, 1); }
  }
  reserve(cx - rx - 2, cy - ry - 2, rx * 2 + 5, ry * 2 + 5);
}
/** 바닥 무늬 구역 (사냥터마다 땅 색) */
function patch(tile: "sand" | "dirt" | "cobble" | "stone_edge", cx: number, cy: number, r: number, n: number) {
  for (let i = 0; i < n; i++) {
    const a = rand() * Math.PI * 2;
    const d = Math.sqrt(rand()) * r;
    fill("ground", tile, Math.round(cx + Math.cos(a) * d), Math.round(cy + Math.sin(a) * d), 2, 2);
  }
}
function zone(name: string, mob: string, cx: number, cy: number, r: number, count: number, lv: string, grade = "normal") {
  obj("spawn_zone", name, cx - r, cy - r, r * 2, r * 2, 0, { mob, count, lv, grade });
}

// ── 입구 (북): 햇살 초원으로 ─────────────────────────────────────────
const CX = 50;
obj("portal", "햇살 초원", CX, 2, 4, 4, 0, { target: "field", ax: (CX + 2) * TILE, ay: 10 * TILE });
reserve(CX - 3, 2, 10, 10);
obj("spawn", "spawn", CX + 1, 9, 2, 1, 0);
path(CX + 1, 8, CX + 1, 112); // 남북 큰길
path(18, 30, CX + 1, 30);
path(CX + 1, 50, 86, 50);
path(18, 72, CX + 1, 72);
path(CX + 1, 92, 86, 92);

// ── 사냥터 (남쪽으로 갈수록 강함) ─────────────────────────────────────
patch("dirt", 20, 24, 9, 40);
zone("황혼 덤불", "dusk_imp", 20, 24, 10, 9, "30-38");
patch("stone_edge", 84, 36, 10, 30);
zone("바위 언덕", "stone_boar", 84, 36, 11, 8, "38-48");
zone("바위 언덕 우두머리", "stone_boar", 84, 36, 3, 1, "48-48", "mid");
patch("sand", 20, 58, 9, 50);
zone("서리 절벽", "frost_harpy", 20, 60, 10, 8, "48-60");
patch("dirt", 84, 76, 10, 70);
zone("잿불 분지", "ember_golem", 84, 76, 11, 7, "60-72");
zone("잿불 분지 심장", "ember_golem", 84, 76, 3, 1, "72-72", "high");
patch("cobble", 22, 94, 10, 60);
zone("그림자 폐허", "shade_knight", 22, 94, 11, 7, "72-86");
patch("stone_edge", 76, 108, 9, 50);
zone("폭풍 봉우리", "storm_drake", 72, 108, 10, 6, "86-100");
zone("폭풍의 왕", "storm_drake", 72, 108, 3, 1, "100-100", "high");

lake(80, 16, 9, 6);
lake(30, 44, 6, 4);
obj("sign", "황혼 덤불 Lv30~38", CX - 4, 26, 1, 1, 1);
obj("sign", "바위 언덕 Lv38~48", CX + 6, 46, 1, 1, 1);
obj("sign", "서리 절벽 Lv48~60", CX - 4, 68, 1, 1, 1);
obj("sign", "잿불 분지 Lv60~72", CX + 6, 88, 1, 1, 1);
obj("sign", "그림자 폐허 Lv72~86", CX - 4, 98, 1, 1, 1);
obj("sign", "폭풍 봉우리 Lv86~100", CX + 6, 104, 1, 1, 1);

for (let i = 0; i < 110; i++) {
  const x = 3 + Math.floor(rand() * (W - 6));
  const y = 3 + Math.floor(rand() * (H - 6));
  if (isUsed(x, y) || isUsed(x + 1, y + 1)) continue;
  obj(["rock", "stump", "bush", "rock"][i % 4], ["바위", "그루터기", "덤불", "바위"][i % 4], x, y, 1, 1, 1);
}
trees(1100);
write("highland");
