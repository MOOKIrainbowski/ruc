/**
 * 타일셋 — Tiled gid = 인덱스 + 1 (0 = 빈칸). 그림은 client/art/tiles.ts 가 이름으로 그립니다.
 * 나무 · 건물 · 천막처럼 여러 칸짜리는 타일이 아니라 objects 레이어의 오브젝트입니다 (깊이 정렬 때문).
 */
export const TILE_NAMES = [
  "grass", "grass_dark", "sand", "cobble", "water", "stone_edge",
  "bridge", "flowers", "fountain_rim", "fountain_water", "hedge", "dirt", "solid",
] as const;

export type TileName = (typeof TILE_NAMES)[number];
export const gid = (name: TileName) => TILE_NAMES.indexOf(name) + 1;
/** 물결 애니메이션 4프레임 (§18) */
export const ANIMATED: TileName[] = ["water", "fountain_water"];

export const MAP_LAYERS = ["ground", "water", "decor_below", "collision", "decor_above"] as const;
export type MapLayer = (typeof MAP_LAYERS)[number];
