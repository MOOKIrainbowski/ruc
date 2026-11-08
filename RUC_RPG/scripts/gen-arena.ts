/**
 * 결투장 (§13-3 광장 동쪽 포털 · 상시 PvP) 맵 → web/rpg/shared/data/maps/arena.json. 실행: node RUC_RPG/scripts/gen-arena.ts
 * 서쪽 대기석(포털 · 부활 지점, 모래밭 밖) → 돌 테두리 원형 모래 경기장 + 엄폐 기둥.
 */
import { TILE } from "../../web/rpg/shared/constants.ts";
import { mapKit } from "./mapkit.ts";

const { W, H, rand, fill, reserve, isUsed, obj, hedgeBorder, trees, write } = mapKit(84, 44, 20261121);

fill("ground", "grass", 0, 0, W, H);
for (let i = 0; i < 120; i++) fill("ground", "grass_dark", Math.floor(rand() * W), Math.floor(rand() * H), 1 + Math.floor(rand() * 3), 1);
hedgeBorder();

const CX = 44;
const CY = 22;
const R = 14;
for (let y = CY - R - 1; y <= CY + R + 1; y++) for (let x = CX - R - 1; x <= CX + R + 1; x++) {
  const d = Math.hypot(x - CX, y - CY) / R;
  if (d <= 1.07) fill("ground", d > 0.97 ? "stone_edge" : "sand", x, y, 1, 1);
}
reserve(CX - R - 2, CY - R - 2, R * 2 + 5, R * 2 + 5);
for (const [x, y] of [[CX - 6, CY - 5], [CX + 6, CY - 5], [CX - 6, CY + 5], [CX + 6, CY + 5], [CX, CY - 9], [CX, CY + 9]]) obj("pillar", "결투장 기둥", x, y - 2, 1, 3, 1, { broken: (x + y) % 2 });
obj("rock", "바위", CX - 1, CY, 2, 1, 1);
for (let i = 0; i < 10; i++) {
  const a = (i / 10) * Math.PI * 2;
  obj("banner", "깃발", Math.round(CX + Math.cos(a) * (R + 2)), Math.round(CY + Math.sin(a) * (R + 2)) - 2, 2, 3, 1);
}

// 서쪽 대기석: 광장으로 가는 포털 · 부활 지점
const WX = CX - R - 14; // 대기석 왼쪽 끝
fill("ground", "cobble", WX, CY - 3, 14, 7);
reserve(WX - 1, CY - 6, 16, 12);
obj("portal", "햇살광장 솔라스", WX + 1, CY - 3, 4, 4, 0, { target: "plaza", ax: (WX + 7) * TILE, ay: (CY + 1) * TILE });
obj("lamp", "가로등", WX + 6, CY - 5, 1, 2, 1);
obj("lamp", "가로등", WX + 6, CY + 3, 1, 2, 1);
obj("sign", "결투장 — 같은 파티가 아니면 모두 적! (쓰러져도 페널티 없음)", WX + 9, CY - 3, 1, 1, 1);
obj("spawn", "spawn", WX + 8, CY, 1, 1, 0);

for (let i = 0; i < 30; i++) {
  const x = 3 + Math.floor(rand() * (W - 6));
  const y = 3 + Math.floor(rand() * (H - 6));
  if (!isUsed(x, y) && !isUsed(x + 1, y + 1)) obj(["bush", "rock", "stump"][i % 3], ["덤불", "바위", "그루터기"][i % 3], x, y, 1, 1, 1);
}
trees(900);
write("arena");
