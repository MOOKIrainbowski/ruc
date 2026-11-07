/**
 * 필드 "햇살 초원" (§18 마지막 줄) 생성 → web/rpg/shared/data/maps/field.json (Tiled 호환).
 * 실행: node RUC_RPG/scripts/gen-field.ts
 * Lv1~20 사냥터: 북쪽 슬라임 언덕 → 동쪽 꽃바람 들판(토끼정령) → 남서 고블린 야영지 → 남동 덩굴 숲(덩굴 늑대).
 * spawn_zone 오브젝트 = 몹 리젠 지점 (mob · count · lv "최소-최대" · grade). 크기 = 순찰 범위.
 */
import { TILE } from "../../web/rpg/shared/constants.ts";
import { mapKit } from "./mapkit.ts";

const { W, H, rand, fill, solid, reserve, isUsed, obj, hedgeBorder, trees, write } = mapKit(112, 112, 20261108);

fill("ground", "grass", 0, 0, W, H);
for (let i = 0; i < 380; i++) fill("ground", "grass_dark", Math.floor(rand() * W), Math.floor(rand() * H), 1 + Math.floor(rand() * 3), 1 + Math.floor(rand() * 2));
for (let i = 0; i < 40; i++) fill("decor_below", "flowers", Math.floor(rand() * W), Math.floor(rand() * H), 2 + Math.floor(rand() * 3), 1 + Math.floor(rand() * 2));
hedgeBorder();

/** 굵기 w 인 흙길 (가로 → 세로 꺾임) */
function path(x0: number, y0: number, x1: number, y1: number, w = 3) {
  const [ax, bx] = x0 < x1 ? [x0, x1] : [x1, x0];
  const [ay, by] = y0 < y1 ? [y0, y1] : [y1, y0];
  fill("ground", "dirt", ax, y0, bx - ax + w, w); fill("decor_below", 0, ax, y0, bx - ax + w, w); reserve(ax, y0, bx - ax + w, w);
  fill("ground", "dirt", x1, ay, w, by - ay + w); fill("decor_below", 0, x1, ay, w, by - ay + w); reserve(x1, ay, w, by - ay + w);
}

/** 타원 연못 + 모래 물가 */
function pond(cx: number, cy: number, rx: number, ry: number) {
  for (let y = cy - ry - 2; y <= cy + ry + 2; y++) for (let x = cx - rx - 2; x <= cx + rx + 2; x++) {
    const d = ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2;
    if (d <= 1) { fill("water", "water", x, y, 1, 1); fill("decor_below", 0, x, y, 1, 1); solid(x, y, 1, 1); }
    else if (((x - cx) / (rx + 1.6)) ** 2 + ((y - cy) / (ry + 1.6)) ** 2 <= 1) { fill("ground", "sand", x, y, 1, 1); fill("decor_below", 0, x, y, 1, 1); }
  }
  reserve(cx - rx - 2, cy - ry - 2, rx * 2 + 5, ry * 2 + 5);
}

/** 몹 리젠 지점: 칸 (cx, cy) 중심, 반지름 r 칸. 오브젝트 y 는 아래 끝이라 Room 이 y − 높이/2 를 중심으로 씀 */
function zone(name: string, mob: string, cx: number, cy: number, r: number, count: number, lv: string, grade = "normal") {
  obj("spawn_zone", name, cx - r, cy - r, r * 2, r * 2, 0, { mob, count, lv, grade });
}

// ── 도착 지점 · 광장 포털 (북) ──────────────────────────────────────
const CX = 54;
obj("portal", "햇살광장 솔라스", CX, 2, 4, 4, 0, { target: "plaza", ax: (CX + 2) * TILE, ay: 10 * TILE });
reserve(CX - 3, 2, 10, 10);
path(CX + 1, 8, CX + 1, 62); // 남북 큰길
path(CX + 1, 40, 96, 40); // 동쪽 들판
path(30, 62, CX + 1, 62); // 남서 야영지 쪽
path(30, 62, 30, 74);
path(CX + 1, 62, 84, 62); // 남동 숲 쪽
path(84, 62, 84, 76);

// ── 사냥터 ──────────────────────────────────────────────────────────
zone("슬라임 언덕", "slime", 46, 26, 9, 10, "1-3");
zone("꽃바람 들판", "rabbit", 92, 28, 10, 8, "3-6");
fill("decor_below", "flowers", 84, 20, 16, 3); fill("decor_below", "flowers", 86, 32, 12, 2);
zone("고블린 야영지", "goblin", 28, 84, 10, 7, "6-9");
zone("고블린 대장", "goblin", 28, 84, 3, 1, "10-10", "low");
fill("ground", "dirt", 22, 79, 13, 11);
obj("campfire", "모닥불", 28, 84, 1, 1, 1);
zone("덩굴 숲", "wolf", 86, 90, 11, 6, "10-14");
for (let i = 0; i < 26; i++) fill("ground", "grass_dark", 74 + Math.floor(rand() * 24), 78 + Math.floor(rand() * 24), 2, 2);

pond(22, 36, 8, 6);
obj("sign", "슬라임 언덕 Lv1~3", CX - 2, 14, 1, 1, 1);
obj("sign", "꽃바람 들판 Lv3~6", 72, 38, 1, 1, 1);
obj("sign", "고블린 야영지 Lv6~10", 36, 60, 1, 1, 1);
obj("sign", "덩굴 숲 Lv10~14", 80, 60, 1, 1, 1);

// 시작 위치: 포털 남쪽
obj("spawn", "spawn", CX + 1, 9, 2, 1, 0);

// ── 장식: 바위 · 그루터기 · 덤불 (사냥터 밖) ─────────────────────────
for (let i = 0; i < 90; i++) {
  const x = 3 + Math.floor(rand() * (W - 6));
  const y = 3 + Math.floor(rand() * (H - 6));
  if (isUsed(x, y) || isUsed(x + 1, y + 1)) continue;
  obj(["rock", "stump", "bush"][i % 3], ["바위", "그루터기", "덤불"][i % 3], x, y, 1, 1, 1);
}
trees(1400);
trees(900, (x, y) => x > 68 && y > 70); // 덩굴 숲 둘레는 빽빽하게
write("field");
