/**
 * 맵 장식 추가 (2026-11 그래픽 개선: 구체적이고 사실적인 맵).
 * 이미 만든 plaza.json · field.json 에 통 · 상자 · 화분 · 우물 · 깃발 · 건초 · 통나무 · 버섯 · 울타리 등을 더함.
 * 실행: node RUC_RPG/scripts/decorate.ts   (여러 번 돌려도 한 번만 적용 — properties.decor 로 표시)
 * 지형 · 몹 리젠 · 기존 오브젝트는 건드리지 않고, 새 오브젝트는 길(돌길 · 흙길) · 물 · 다른 오브젝트에서 한 칸 떨어진 빈 곳에만 놓음.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { TILE } from "../../web/rpg/shared/constants.ts";
import { TILE_NAMES } from "../../web/rpg/shared/tiles.ts";
import type { TiledMap, TiledObject } from "../../web/rpg/shared/map.ts";

type Layer = { type: string; name: string; data?: number[]; objects?: TiledObject[] };
type Spec = [type: string, name: string, w: number, h: number, foot: number];
const SPEC: Record<string, Spec> = {
  barrel: ["barrel", "통", 1, 1, 1],
  crate: ["crate", "상자", 1, 1, 1],
  crate_stack: ["crate_stack", "쌓인 상자", 2, 1, 1],
  flowerpot: ["flowerpot", "화분", 1, 1, 1],
  banner: ["banner", "깃발", 1, 2, 0],
  well: ["well", "우물", 2, 2, 1],
  haystack: ["haystack", "건초 더미", 2, 1, 1],
  sack: ["sack", "자루", 1, 1, 1],
  log: ["log", "통나무", 2, 1, 1],
  fence: ["fence", "울타리", 2, 1, 1],
  mushroom: ["mushroom", "버섯", 1, 1, 0],
};

function run(file: string, plan: (add: (kind: string, tx: number, ty: number) => boolean, near: (x: number, y: number, r: number, kinds: string[], tries?: number) => void, rand: () => number, o: TiledObject[]) => void) {
  const path = new URL(`../../web/rpg/shared/data/maps/${file}.json`, import.meta.url);
  const json = JSON.parse(readFileSync(path, "utf8")) as TiledMap & { layers: Layer[]; nextobjectid: number };
  const og = json.layers.find((l) => l.type === "objectgroup")!;
  const objects = og.objects!;
  if (objects.some((o) => o.properties?.some((p) => p.name === "decor"))) return console.log(`${file}: 이미 장식됨`);
  const W = json.width;
  const H = json.height;
  const layer = (n: string) => json.layers.find((l) => l.name === n)!.data!;
  const ground = layer("ground");
  const water = layer("water");
  const coll = layer("collision");
  const solidGid = TILE_NAMES.indexOf("solid") + 1;
  const occ = new Uint8Array(W * H);
  const mark = (o: TiledObject, m = 1) => {
    for (let y = Math.floor((o.y - o.height) / TILE) - m; y <= Math.floor(o.y / TILE) + m - 1; y++)
      for (let x = Math.floor((o.x - o.width / 2) / TILE) - m; x < Math.ceil((o.x + o.width / 2) / TILE) + m; x++) if (x >= 0 && y >= 0 && x < W && y < H) occ[y * W + x] = 1;
  };
  for (const o of objects) if (o.type !== "spawn_zone") mark(o);
  const BAD = new Set(["cobble", "bridge", "dirt", "stone_edge", "fountain_rim", "fountain_water", "water", "hedge"].map((n) => TILE_NAMES.indexOf(n as never) + 1));
  let seed = 90210;
  const rand = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);
  let count = 0;
  const free = (tx: number, ty: number, w: number, h: number) => {
    for (let y = ty; y < ty + h; y++) for (let x = tx; x < tx + w; x++) {
      if (x < 3 || y < 3 || x >= W - 3 || y >= H - 3) return false;
      const i = y * W + x;
      if (occ[i] || water[i] || coll[i] === solidGid || BAD.has(ground[i])) return false;
    }
    return true;
  };
  const add = (kind: string, tx: number, ty: number) => {
    const [type, name, w, h, foot] = SPEC[kind];
    if (!free(tx, ty, w, h)) return false;
    objects.push({
      id: json.nextobjectid++, name, type, x: (tx + w / 2) * TILE, y: (ty + h) * TILE, width: w * TILE, height: h * TILE,
      properties: [{ name: "decor", type: "int", value: 1 }],
    });
    for (let y = ty - 1; y < ty + h + 1; y++) for (let x = tx - 1; x < tx + w + 1; x++) if (x >= 0 && y >= 0 && x < W && y < H) occ[y * W + x] = 1;
    if (foot > 0) for (let y = ty + h - foot; y < ty + h; y++) for (let x = tx; x < tx + w; x++) coll[y * W + x] = solidGid;
    count++;
    return true;
  };
  const near = (cx: number, cy: number, r: number, kinds: string[], tries = 12) => {
    for (let i = 0; i < tries; i++) add(kinds[i % kinds.length], Math.round(cx + (rand() * 2 - 1) * r), Math.round(cy + (rand() * 2 - 1) * r));
  };
  plan(add, near, rand, objects);
  json.nextobjectid = Math.max(json.nextobjectid, objects.length + 1);
  writeFileSync(path, JSON.stringify(json));
  console.log(`${file}.json — 장식 ${count}개 추가`);
}

// ── 광장 ───────────────────────────────────────────────────────────
run("plaza", (add, near, rand, objs) => {
  const at = (type: string) => objs.filter((o) => o.type === type).map((o) => [Math.round((o.x - o.width / 2) / TILE), Math.round((o.y - o.height) / TILE)] as const);
  for (const [tx, ty] of at("tent_shop")) { near(tx + 1, ty + 4, 4, ["barrel", "crate", "sack", "crate_stack"], 8); }
  for (const [tx, ty] of at("tent_market")) { near(tx + 1, ty + 4, 4, ["crate_stack", "sack", "barrel", "crate"], 8); }
  for (const [tx, ty] of at("building")) { near(tx + 4, ty + 9, 6, ["barrel", "crate", "crate_stack", "flowerpot", "sack"], 14); add("banner", tx - 1, ty + 3); add("banner", tx + 9, ty + 3); }
  near(48, 40, 11, ["flowerpot"], 24); near(48, 56, 11, ["flowerpot"], 24); // 분수 둘레 화분
  near(25, 40, 4, ["well"], 6); near(30, 60, 6, ["flowerpot", "barrel"], 10);
  near(48, 8, 6, ["banner"], 6); near(48, 86, 6, ["banner"], 6);
  near(42, 84, 8, ["flowerpot", "sack", "crate"], 14); near(60, 84, 6, ["barrel", "crate_stack"], 10);
  for (let i = 0; i < 24; i++) add("flowerpot", 18 + Math.floor(rand() * 60), 25 + Math.floor(rand() * 46));
});

// ── 필드 ───────────────────────────────────────────────────────────
run("field", (add, near, rand) => {
  near(28, 84, 7, ["crate_stack", "barrel", "sack", "crate", "log", "haystack"], 28); // 고블린 야영지
  near(54, 12, 7, ["well", "fence", "fence", "flowerpot"], 12); // 입구
  near(22, 36, 12, ["fence", "log", "mushroom"], 16); // 연못 둘레
  for (let i = 0; i < 40; i++) add("mushroom", 70 + Math.floor(rand() * 36), 74 + Math.floor(rand() * 32)); // 덩굴 숲
  for (let i = 0; i < 30; i++) add("log", 4 + Math.floor(rand() * 100), 4 + Math.floor(rand() * 100));
  for (let i = 0; i < 18; i++) add("haystack", 78 + Math.floor(rand() * 24), 16 + Math.floor(rand() * 24)); // 꽃바람 들판 농가 느낌
  for (let i = 0; i < 24; i++) add("fence", 4 + Math.floor(rand() * 100), 4 + Math.floor(rand() * 100));
  for (let i = 0; i < 40; i++) add("mushroom", 4 + Math.floor(rand() * 100), 4 + Math.floor(rand() * 100));
});
