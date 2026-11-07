/** 맵 생성 스크립트 공용 도구 — Tiled 호환 JSON 을 만듭니다 (§18 · §26-1). */
import { writeFileSync } from "node:fs";
import { TILE } from "../../web/rpg/shared/constants.ts";
import { MAP_LAYERS, TILE_NAMES, gid, type MapLayer, type TileName } from "../../web/rpg/shared/tiles.ts";
import type { TiledObject } from "../../web/rpg/shared/map.ts";

export function mapKit(W: number, H: number, seed: number) {
  const layers = Object.fromEntries(MAP_LAYERS.map((n) => [n, new Array<number>(W * H).fill(0)])) as Record<MapLayer, number[]>;
  const used = new Uint8Array(W * H); // 오브젝트 · 길이 차지한 칸 (나무를 심지 않음)
  const objects: TiledObject[] = [];
  const rand = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);

  function fill(layer: MapLayer, name: TileName | 0, x0: number, y0: number, w: number, h: number) {
    for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) {
      if (x < 0 || y < 0 || x >= W || y >= H) continue;
      layers[layer][y * W + x] = name === 0 ? 0 : gid(name);
    }
  }
  const solid = (x: number, y: number, w: number, h: number) => fill("collision", "solid", x, y, w, h);
  const clear = (x: number, y: number, w: number, h: number) => fill("collision", 0, x, y, w, h);
  function reserve(x0: number, y0: number, w: number, h: number) {
    for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) if (x >= 0 && y >= 0 && x < W && y < H) used[y * W + x] = 1;
  }
  const isUsed = (x: number, y: number) => x < 0 || y < 0 || x >= W || y >= H || used[y * W + x] === 1;

  /** 오브젝트 — 칸 (tx, ty) 부터 w×h. 좌표는 발밑 중심 px. foot = 아래에서부터 막는 줄 수 */
  function obj(type: string, name: string, tx: number, ty: number, w: number, h: number, foot = h, props: Record<string, string | number> = {}) {
    objects.push({
      id: objects.length + 1,
      name,
      type,
      x: (tx + w / 2) * TILE,
      y: (ty + h) * TILE,
      width: w * TILE,
      height: h * TILE,
      properties: Object.entries(props).map(([k, v]) => ({ name: k, type: typeof v === "number" ? "int" : "string", value: v })),
    });
    if (foot > 0) solid(tx, ty + h - foot, w, foot);
    reserve(tx - 1, ty - 1, w + 2, h + 2);
  }

  /** 가장자리 산울타리 (2칸, 막힘) */
  function hedgeBorder() {
    fill("decor_below", "hedge", 0, 0, W, 2); fill("decor_below", "hedge", 0, H - 2, W, 2);
    fill("decor_below", "hedge", 0, 0, 2, H); fill("decor_below", "hedge", W - 2, 0, 2, H);
    solid(0, 0, W, 2); solid(0, H - 2, W, 2); solid(0, 0, 2, H); solid(W - 2, 0, 2, H);
  }

  /** 빈 잔디에 나무를 흩뿌림 (줄기 1칸만 막음). inside(x, y) 로 영역 제한 */
  function trees(tries: number, inside: (x: number, y: number) => boolean = () => true) {
    for (let i = 0; i < tries; i++) {
      const x = 2 + Math.floor(rand() * (W - 6));
      const y = 4 + Math.floor(rand() * (H - 8));
      if (!inside(x, y)) continue;
      let free = true;
      for (let yy = y - 3; yy <= y + 1 && free; yy++) for (let xx = x - 1; xx <= x + 2; xx++) if (used[yy * W + xx]) { free = false; break; }
      if (!free) continue;
      obj("tree", "나무", x, y - 3, 2, 4, 0);
      solid(x, y, 2, 1);
    }
  }

  function write(file: string) {
    const json = {
      type: "map", version: "1.10", tiledversion: "1.10.2", orientation: "orthogonal", renderorder: "right-down",
      width: W, height: H, tilewidth: TILE, tileheight: TILE, infinite: false,
      nextlayerid: MAP_LAYERS.length + 2, nextobjectid: objects.length + 1,
      tilesets: [{
        firstgid: 1, name: "ruc_tiles", tilewidth: TILE, tileheight: TILE, tilecount: TILE_NAMES.length, columns: TILE_NAMES.length,
        image: "ruc_tiles.png", imagewidth: TILE * TILE_NAMES.length, imageheight: TILE,
        tiles: TILE_NAMES.map((name, id) => ({ id, properties: [{ name: "name", type: "string", value: name }] })),
      }],
      layers: [
        ...MAP_LAYERS.map((name, i) => ({ id: i + 1, type: "tilelayer", name, x: 0, y: 0, width: W, height: H, opacity: 1, visible: name !== "collision", data: layers[name] })),
        { id: MAP_LAYERS.length + 1, type: "objectgroup", name: "objects", x: 0, y: 0, opacity: 1, visible: true, draworder: "topdown", objects },
      ],
    };
    writeFileSync(new URL(`../../web/rpg/shared/data/maps/${file}.json`, import.meta.url), JSON.stringify(json));
    console.log(`${file}.json — 오브젝트 ${objects.length}개`);
  }

  return { W, H, layers, objects, rand, fill, solid, clear, reserve, isUsed, obj, hedgeBorder, trees, write };
}
