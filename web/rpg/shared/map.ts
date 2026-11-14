import { SIM_VERSION, SNAP_VERSION, TILE } from "./constants.ts";
import { MOVE, ROLL, STAMINA } from "./data/stats.ts";
import type { Collider } from "./movement.ts";
import { MAP_LAYERS, gid, type MapLayer } from "./tiles.ts";

/** Tiled JSON 중 쓰는 부분만. */
export type TiledMap = {
  width: number;
  height: number;
  layers: (
    | { type: "tilelayer"; name: string; data: number[] }
    | { type: "objectgroup"; name: string; objects: TiledObject[] }
  )[];
};

export type TiledObject = {
  id: number;
  name: string;
  type: string;
  x: number; // px, 발밑 중심
  y: number;
  width: number;
  height: number;
  properties?: { name: string; type: string; value: string | number | boolean }[];
};

export type GameMap = {
  w: number;
  h: number;
  layers: Record<MapLayer, Uint16Array>;
  collider: Collider;
  objects: TiledObject[];
  spawn: { x: number; y: number };
  /** 언덕 층 (scripts/hills.ts, 없으면 평지): 값 = 층 0~2 + STAIRS(계단). 충돌은 collision 레이어에 이미 구워져 있음 — 그림용 */
  height?: Uint8Array;
};

/** height 레이어의 계단 표시 비트 */
export const STAIRS = 16;
/**
 * 언덕 칸 종류 (hills.ts 충돌 굽기 · 클라 그림 공용): 1 앞면(절벽 — 3/4 시점이라 남쪽 면만) · 2 가장자리 · 4 계단 · 8 언덕 위 · 0 평지.
 * 1 · 2 는 막힌 칸. 층 L 칸의 남쪽 1~2칸 안이 더 낮으면 앞면, 아니고 8방향 이웃이 더 낮으면 가장자리.
 */
export function heightKind(h: ArrayLike<number>, W: number, H: number, x: number, y: number): number {
  if (x < 0 || y < 0 || x >= W || y >= H) return 0;
  const v = h[y * W + x];
  const L = v & 15;
  if (!L) return 0;
  if (v & STAIRS) return 4;
  const lv = (xx: number, yy: number) => (xx < 0 || yy < 0 || xx >= W || yy >= H ? 0 : h[yy * W + xx] & 15);
  if (lv(x, y + 1) < L || lv(x, y + 2) < L) return 1;
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (lv(x + dx, y + dy) < L) return 2;
  return 8;
}

export function loadMap(json: TiledMap): GameMap {
  const layers = {} as Record<MapLayer, Uint16Array>;
  for (const name of MAP_LAYERS) {
    const l = json.layers.find((x) => x.name === name);
    if (!l || l.type !== "tilelayer" || l.data.length !== json.width * json.height) throw new Error(`맵 레이어 오류: ${name}`);
    layers[name] = Uint16Array.from(l.data);
  }
  const og = json.layers.find((x) => x.type === "objectgroup");
  const objects = og && og.type === "objectgroup" ? og.objects : [];
  const solidGid = gid("solid");
  const solid = Uint8Array.from(layers.collision, (v) => (v === solidGid ? 1 : 0));
  const sp = objects.find((o) => o.type === "spawn");
  const hl = json.layers.find((x) => x.name === "height");
  return {
    ...(hl && hl.type === "tilelayer" ? { height: Uint8Array.from(hl.data) } : {}),
    w: json.width,
    h: json.height,
    layers,
    collider: { w: json.width, h: json.height, solid },
    objects,
    spawn: sp ? { x: sp.x, y: sp.y } : { x: (json.width * TILE) / 2, y: (json.height * TILE) / 2 },
  };
}

/**
 * 시뮬레이션 지문 (FNV-1a): 충돌 칸 + 이동 상수 + SIM_VERSION. 서버(joined.sim)와 클라가 다르면
 * 예측이 서버 보정과 계속 어긋나 버벅임 — 2026-11-14 운영 서버가 옛 코드로 돌아 분수 근처가 그랬음
 */
export function simHash(m: GameMap): number {
  let h = 2166136261;
  const mix = (b: number) => { h = Math.imul(h ^ b, 16777619) >>> 0; };
  for (const v of m.collider.solid) mix(v);
  for (const ch of JSON.stringify([SIM_VERSION, SNAP_VERSION, TILE, m.w, m.h, MOVE, ROLL, STAMINA])) mix(ch.charCodeAt(0)); // TILE · 크기도 (Codex 리뷰)
  return h;
}

export const prop = (o: TiledObject, name: string) => o.properties?.find((p) => p.name === name)?.value;

/** 오브젝트 그림 영역(발밑 기준 위로 height)까지의 거리 — 상호작용(F) 판정 */
export function distToObj(o: TiledObject, x: number, y: number) {
  const dx = Math.max(o.x - o.width / 2 - x, 0, x - (o.x + o.width / 2));
  const dy = Math.max(o.y - o.height - y, 0, y - o.y);
  return Math.sqrt(dx * dx + dy * dy);
}
/** 상호작용 거리 (px) */
export const USE_RANGE = 24;
