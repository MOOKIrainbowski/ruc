/**
 * 던전 "고목의 유적" (§20-3) 맵 → web/rpg/shared/data/maps/dungeon.json (Tiled 호환). 실행: node RUC_RPG/scripts/gen-dungeon.ts
 * 남쪽 입구 홀(나가는 문 · 시작 지점) → 무너진 회랑 → 북쪽 원형 유적 광장(스테이지 몹이 나타나는 stage_area · 다음 스테이지 포털).
 * 몹은 맵의 spawn_zone 이 아니라 던전 서버(dungeon.ts)가 스테이지마다 stage_area 에 소환합니다.
 */
import { TILE } from "../../web/rpg/shared/constants.ts";
import { mapKit } from "./mapkit.ts";

const { W, H, rand, fill, solid, reserve, isUsed, obj, hedgeBorder, trees, write } = mapKit(84, 72, 20261120);
const CX = 42; // 가운데 열
/** 걸어 다닐 수 있는 칸 (유적 광장 · 회랑 · 입구 홀) — 나머지 숲은 그림만, 전부 막힘 */
const open = new Uint8Array(W * H);
const walk = (x0: number, y0: number, w: number, h: number) => { for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) open[y * W + x] = 1; };

fill("ground", "grass_dark", 0, 0, W, H);
for (let i = 0; i < 220; i++) fill("ground", "grass", Math.floor(rand() * W), Math.floor(rand() * H), 1 + Math.floor(rand() * 2), 1);
hedgeBorder();

/** 원 안 칸마다 f(x, y, 중심에서 거리/반지름) */
function disk(cx: number, cy: number, r: number, f: (x: number, y: number, d: number) => void) {
  for (let y = cy - r; y <= cy + r; y++) for (let x = cx - r; x <= cx + r; x++) {
    const d = Math.hypot(x - cx, y - cy) / r;
    if (d <= 1) f(x, y, d);
  }
}

// ── 북쪽 유적 광장 (지름 36칸) ─────────────────────────────────────────
const AY = 26;
const AR = 18;
disk(CX, AY, AR + 1, (x, y, d) => { fill("ground", d > 0.95 ? "stone_edge" : "cobble", x, y, 1, 1); walk(x, y, 1, 1); });
disk(CX, AY, AR, (x, y) => { if (rand() < 0.16) fill("ground", rand() < 0.5 ? "dirt" : "grass_dark", x, y, 1, 1); }); // 갈라진 바닥 · 이끼
disk(CX, AY, AR + 2, (x, y) => reserve(x, y, 1, 1));
// 둘레의 무너진 기둥 (몸통 1칸 막힘)
for (let i = 0; i < 14; i++) {
  const a = (i / 14) * Math.PI * 2 + 0.2;
  const x = Math.round(CX + Math.cos(a) * (AR - 1.5));
  const y = Math.round(AY + Math.sin(a) * (AR - 1.5));
  if (y > AY + AR - 5 && Math.abs(x - CX) < 5) continue; // 남쪽 입구 자리
  obj("pillar", "무너진 기둥", x, y - 2, 1, 3, 1, { broken: i % 3 === 0 ? 1 : 0 });
}
// 엄폐용 바위 · 기둥 몇 개
for (const [x, y] of [[20, 20], [36, 20], [22, 32], [34, 32]]) obj("pillar", "무너진 기둥", x, y - 2, 1, 3, 1, { broken: 1 });
obj("statue", "고목왕의 옥좌", CX - 1, AY - AR + 1, 2, 3, 1);
// 다음 스테이지 포털 (북쪽 끝) · 몹이 나타나는 곳
obj("portal", "다음 스테이지", CX - 2, AY - AR + 4, 4, 4, 0, { target: "next" });
obj("stage_area", "stage_area", CX - 10, AY - 12, 20, 20, 0);

// ── 무너진 회랑 (광장 남쪽 → 입구 홀) ─────────────────────────────────
fill("ground", "stone_edge", CX - 4, AY + AR, 9, 12);
fill("ground", "cobble", CX - 3, AY + AR, 7, 12);
for (let i = 0; i < 18; i++) fill("ground", rand() < 0.5 ? "dirt" : "grass_dark", CX - 3 + Math.floor(rand() * 7), AY + AR + Math.floor(rand() * 12), 1, 1);
reserve(CX - 5, AY + AR, 11, 12);
walk(CX - 4, AY + AR - 1, 9, 13);
for (let y = AY + AR + 1; y < AY + AR + 11; y += 4) {
  obj("pillar", "회랑 기둥", CX - 5, y - 2, 1, 3, 1, { broken: y % 8 === 1 ? 1 : 0 });
  obj("pillar", "회랑 기둥", CX + 5, y - 2, 1, 3, 1, { broken: y % 8 === 5 ? 1 : 0 });
}

// ── 입구 홀 (남쪽) ───────────────────────────────────────────────────
const HY = AY + AR + 12; // 56
fill("ground", "stone_edge", CX - 11, HY, 23, 13);
fill("ground", "cobble", CX - 10, HY + 1, 21, 11);
reserve(CX - 12, HY - 1, 25, 15);
walk(CX - 11, HY, 23, 13);
obj("portal", "솔라스로 돌아가기", CX - 2, HY + 7, 4, 4, 0, { target: "plaza" });
obj("campfire", "모닥불", CX - 7, HY + 5, 1, 1, 1);
obj("statue", "수호 정령상", CX + 6, HY + 3, 2, 3, 1);
for (const [x, y] of [[CX - 9, HY + 2], [CX + 9, HY + 2], [CX - 9, HY + 9], [CX + 9, HY + 9]]) obj("pillar", "입구 기둥", x, y - 2, 1, 3, 1);
obj("sign", "고목의 유적 — 권장 Lv10~30", CX - 4, HY + 2, 1, 1, 1);
obj("spawn", "spawn", CX, HY + 4, 1, 1, 0);

// ── 숲: 버섯 · 통나무 · 그루터기 · 덤불 · 나무 ─────────────────────────
for (let i = 0; i < 70; i++) {
  const x = 3 + Math.floor(rand() * (W - 6));
  const y = 3 + Math.floor(rand() * (H - 6));
  if (isUsed(x, y) || isUsed(x + 1, y + 1)) continue;
  const k = i % 4;
  obj(["mushroom", "log", "stump", "bush"][k], ["버섯", "통나무", "그루터기", "덤불"][k], x, y, k === 1 ? 2 : 1, 1, 1);
}
trees(2600);
// 나무 사이 빈틈으로 빠져나가지 못하게 — 길 밖 바닥은 모두 막음
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (!open[y * W + x]) solid(x, y, 1, 1);
write("dungeon");
console.log("dungeon spawn", CX * TILE, (HY + 5) * TILE);
