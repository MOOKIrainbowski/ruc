import { TILE } from "./constants.ts";
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
};

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
  return {
    w: json.width,
    h: json.height,
    layers,
    collider: { w: json.width, h: json.height, solid },
    objects,
    spawn: sp ? { x: sp.x, y: sp.y } : { x: (json.width * TILE) / 2, y: (json.height * TILE) / 2 },
  };
}

export const prop = (o: TiledObject, name: string) => o.properties?.find((p) => p.name === name)?.value;
