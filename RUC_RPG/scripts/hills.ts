/**
 * 언덕 · 고지대 추가 (2026-11-14 피드백 2차 "지형에 높이가 없다 — 언덕을 추가해 높은 장소를").
 * 맵 JSON 에 타일 레이어 `height` 를 더함: 값 = 층(0 바닥 · 1 · 2) + 16(계단). 그림 · 충돌 규칙 (shared/map.ts heightKind 와 같음):
 *   - 앞면(절벽): 층 L 칸 중 남쪽 1~2칸 안에 더 낮은 칸이 있는 칸 → 막힘, 바위 절벽으로 그림 (3/4 시점이라 남쪽 면만 보임)
 *   - 가장자리: 앞면이 아닌 층 L 칸 중 8방향 이웃에 더 낮은 칸이 있는 칸 → 막힘, 풀 가장자리 · 낭떠러지 선
 *   - 계단: 남쪽 앞면 가운데 2칸 너비 (앞면 2줄 + 가장자리 1줄) → 다닐 수 있음
 * 놓는 곳: 풀밭(풀 · 짙은 풀 · 꽃)만, 길 · 물 · 산울타리 · 막힌 칸에서 2칸, 사냥터 · 포털 · NPC · 시설 · 시작 위치에서 떨어진 곳.
 * 놓은 뒤 시작 위치에서 갈 수 있던 곳이 모두 그대로 갈 수 있는지(언덕 위는 계단으로) 확인하고, 아니면 그 언덕은 버림.
 * 위 · 가장자리 · 앞면에 걸친 장식 오브젝트(나무 · 바위 …)는 위(다닐 수 있는 칸)에 있으면 두고, 막힌 칸에 걸치면 지움.
 * 실행: node RUC_RPG/scripts/hills.ts   (이미 height 레이어가 있는 맵은 건너뜀). 맵 JSON 이 바뀌므로 게임 서버를 다시 켜야 함.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { TILE } from "../../web/rpg/shared/constants.ts";
import { TILE_NAMES } from "../../web/rpg/shared/tiles.ts";
import { STAIRS, heightKind, type TiledMap, type TiledObject } from "../../web/rpg/shared/map.ts";

type Layer = { type: string; name: string; data?: number[]; objects?: TiledObject[]; width?: number; height?: number; x?: number; y?: number; opacity?: number; visible?: boolean; id?: number };
const DECOR = new Set(["tree", "bush", "rock", "stump", "mushroom", "log", "haystack", "fence", "barrel", "crate", "crate_stack", "sack", "flowerpot"]);
const OK_GROUND = new Set(["grass", "grass_dark", "flowers"].map((n) => TILE_NAMES.indexOf(n as never) + 1));

function run(file: string, count: number, size: [number, number, number, number], level2: number, seed0: number) {
  const path = new URL(`../../web/rpg/shared/data/maps/${file}.json`, import.meta.url);
  const json = JSON.parse(readFileSync(path, "utf8")) as TiledMap & { layers: Layer[]; nextlayerid: number };
  if (json.layers.some((l) => l.name === "height")) return console.log(`${file}: 이미 언덕 있음`);
  const W = json.width;
  const H = json.height;
  const L = (n: string) => json.layers.find((l) => l.name === n)!.data!;
  const ground = L("ground"), water = L("water"), deco = L("decor_below"), coll = L("collision");
  const solid = TILE_NAMES.indexOf("solid") + 1;
  const og = json.layers.find((l) => l.type === "objectgroup")!;
  let objects = og.objects!;
  let seed = seed0;
  const rand = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);
  const idx = (x: number, y: number) => y * W + x;

  // 장식 오브젝트 발밑의 충돌 칸 (나무 · 바위 …) — 언덕 자리를 막지 않음 (언덕을 놓으면 장식은 위에 남거나 지워짐)
  const foot = new Set<number>();
  const footOf = (o: TiledObject) => {
    const out: number[] = [];
    const y = Math.floor((o.y - 1) / TILE);
    for (let x = Math.floor((o.x - o.width / 2) / TILE); x < Math.ceil((o.x + o.width / 2) / TILE); x++) if (x >= 0 && y >= 0 && x < W && y < H) out.push(idx(x, y));
    return out;
  };
  for (const o of objects) if (DECOR.has(o.type)) for (const i of footOf(o)) if (coll[i] === solid) foot.add(i);
  // 놓을 수 없는 칸 (+ 거리 2 여유)
  const bad = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = idx(x, y);
    if (!OK_GROUND.has(ground[i]) || water[i] || deco[i] || (coll[i] === solid && !foot.has(i))) bad[i] = 1;
  }
  const keep = (cx: number, cy: number, r: number) => { for (let y = cy - r; y <= cy + r; y++) for (let x = cx - r; x <= cx + r; x++) if (x >= 0 && y >= 0 && x < W && y < H) bad[idx(x, y)] = 1; };
  for (const o of objects) {
    const tx = Math.floor(o.x / TILE), ty = Math.floor((o.y - 1) / TILE);
    if (o.type === "spawn_zone") keep(tx, Math.floor((o.y - o.height / 2) / TILE), Math.ceil(o.width / 2 / TILE) + 1);
    else if (!DECOR.has(o.type)) keep(tx, ty, Math.ceil(Math.max(o.width, o.height) / 2 / TILE) + 2);
  }
  const far = new Uint8Array(W * H); // bad 에서 2칸 이상
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    let ok = x >= 3 && y >= 3 && x < W - 3 && y < H - 3;
    for (let dy = -2; ok && dy <= 2; dy++) for (let dx = -2; ok && dx <= 2; dx++) { const xx = x + dx, yy = y + dy; if (xx < 0 || yy < 0 || xx >= W || yy >= H || bad[idx(xx, yy)]) ok = false; }
    far[idx(x, y)] = ok ? 1 : 0;
  }

  if (process.env.DEBUG) console.log(file, "bad", bad.reduce((a, b) => a + b, 0), "far", far.reduce((a, b) => a + b, 0), "of", W * H);
  const height = new Array<number>(W * H).fill(0);
  const level = (x: number, y: number) => (x < 0 || y < 0 || x >= W || y >= H ? 0 : height[idx(x, y)] & 15);
  const spawn = objects.find((o) => o.type === "spawn")!;
  const walk = (h: number[]) => {
    // 막힌 칸: 원래 충돌 + 언덕 앞면 · 가장자리 (계단 제외)
    const blocked = (x: number, y: number) => (coll[idx(x, y)] === solid && !foot.has(idx(x, y))) || (heightKind(h, W, H, x, y) & 3) !== 0;
    const seen = new Uint8Array(W * H);
    const q = [idx(Math.floor(spawn.x / TILE), Math.floor((spawn.y - 1) / TILE))];
    seen[q[0]] = 1;
    while (q.length) {
      const i = q.pop()!;
      const x = i % W, y = (i / W) | 0;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const xx = x + dx, yy = y + dy;
        if (xx < 0 || yy < 0 || xx >= W || yy >= H) continue;
        const j = idx(xx, yy);
        if (seen[j] || blocked(xx, yy)) continue;
        // 층이 다른 칸으로는 계단으로만
        const a = h[i] & 15, b = h[j] & 15;
        if (a !== b && !(h[i] & STAIRS) && !(h[j] & STAIRS)) continue;
        seen[j] = 1;
        q.push(j);
      }
    }
    return seen;
  };
  const before = walk(height);

  /** 울퉁불퉁한 타원 발자국 */
  const blob = (cx: number, cy: number, rx: number, ry: number, s: number) => {
    const cells: number[] = [];
    for (let y = cy - ry - 2; y <= cy + ry + 2; y++) for (let x = cx - rx - 2; x <= cx + rx + 2; x++) {
      const a = Math.atan2(y - cy, x - cx);
      const wob = 1 + 0.16 * Math.sin(a * 3 + s) + 0.1 * Math.sin(a * 5 + s * 2);
      if (((x - cx) / (rx * wob)) ** 2 + ((y - cy) / (ry * wob)) ** 2 <= 1) cells.push(idx(x, y));
    }
    return cells;
  };
  /** 세로 두께가 4 미만인 기둥 · 가로 3 미만인 줄을 깎아 앞면 · 가장자리가 겹치지 않게 */
  const tidy = (cells: Set<number>) => {
    let changed = true;
    while (changed) {
      changed = false;
      for (const i of [...cells]) {
        const x = i % W, y = (i / W) | 0;
        let up = 0, down = 0, l = 0, r = 0;
        while (cells.has(idx(x, y - up - 1))) up++;
        while (cells.has(idx(x, y + down + 1))) down++;
        while (cells.has(idx(x - l - 1, y))) l++;
        while (cells.has(idx(x + r + 1, y))) r++;
        if (up + down + 1 < 5 || l + r + 1 < 3) { cells.delete(i); changed = true; }
      }
    }
  };
  const stairs = (lv: number) => {
    // 남쪽 앞면 아래 끝 칸들 중 가운데 쪽, 아래(계단 앞)가 다닐 수 있는 2칸
    const bottoms: number[] = [];
    for (let i = 0; i < W * H; i++) if ((height[i] & 15) === lv && level(i % W, ((i / W) | 0) + 1) < lv) bottoms.push(i);
    bottoms.sort((a, b) => Math.abs((a % W) - avgX(bottoms)) - Math.abs((b % W) - avgX(bottoms)));
    for (const b of bottoms) {
      const x = b % W, y = (b / W) | 0;
      if (level(x + 1, y + 1) >= lv || (height[idx(x + 1, y)] & 15) !== lv) continue;
      // 계단: 앞면 2줄 + 가장자리 1줄, 2칸 너비 — 위 착지 칸이 같은 층 안쪽이어야
      if ((height[idx(x, y - 3)] & 15) !== lv || (height[idx(x + 1, y - 3)] & 15) !== lv) continue;
      // 계단 양옆은 같은 층 벽이어야 (옆으로 걸어 들어오지 못하게)
      let walls = true;
      for (let k = 0; k < 3; k++) if (level(x - 1, y - k) !== lv || level(x + 2, y - k) !== lv) walls = false;
      if (!walls) continue;
      for (let k = 0; k < 3; k++) for (const xx of [x, x + 1]) height[idx(xx, y - k)] |= STAIRS;
      // 위 착지 칸이 다닐 수 있는 언덕 위여야 (가장자리면 막혀서 못 올라감 — Codex 리뷰 · 실제 이동 테스트로 발견)
      if (heightKind(height, W, H, x, y - 3) === 8 && heightKind(height, W, H, x + 1, y - 3) === 8) return true;
      for (let k = 0; k < 3; k++) for (const xx of [x, x + 1]) height[idx(xx, y - k)] &= ~STAIRS;
    }
    return false;
  };
  const avgX = (a: number[]) => a.reduce((s, i) => s + (i % W), 0) / a.length;

  let made = 0;
  for (let tries = 0; tries < 400 && made < count; tries++) {
    const rx = Math.round(size[0] + rand() * (size[1] - size[0]));
    const ry = Math.round(size[2] + rand() * (size[3] - size[2]));
    const cx = Math.floor(rx + 3 + rand() * (W - rx * 2 - 6));
    const cy = Math.floor(ry + 3 + rand() * (H - ry * 2 - 6));
    // 빈 땅에 맞춰 자름 (남는 땅이 들쑥날쑥해서 타원이 통째로 들어갈 곳이 드묾)
    const cells = new Set(blob(cx, cy, rx, ry, rand() * 6).filter((i) => i >= 0 && i < W * H && far[i] && !hasHillNear(i)));
    tidy(cells);
    if (cells.size < 36) continue;
    // 덩어리가 하나여야 (잘라서 둘로 나뉘면 계단이 하나뿐인 쪽이 갇힘) — 가장 큰 덩어리만
    const first = [...cells][0];
    const part = new Set([first]);
    const st = [first];
    while (st.length) { const i = st.pop()!; for (const j of [i + 1, i - 1, i + W, i - W]) if (cells.has(j) && !part.has(j)) { part.add(j); st.push(j); } }
    if (part.size !== cells.size) continue;
    const backup = height.slice();
    for (const i of cells) height[i] = 1;
    // 2층: 크면 안쪽을 깎아서 (옆 · 위 3칸, 아래 4칸 — 1층 앞면 2줄 + 2층 계단 앞 착지 칸)
    if (rand() < level2) {
      const inner = new Set([...cells].filter((i) => { const x = i % W, y = (i / W) | 0; for (let d = -3; d <= 4; d++) for (let e = -3; e <= 3; e++) if (!cells.has(idx(x + e, y + d))) return false; return true; }));
      tidy(inner);
      if (inner.size >= 20) {
        for (const i of inner) height[i] = 2;
        // 2층 위에 설 자리가 12칸은 돼야 (너무 작으면 계단만 덩그러니)
        const room = [...inner].filter((i) => heightKind(height, W, H, i % W, (i / W) | 0) === 8).length;
        if (room < 12 || !stairs(2)) for (const i of inner) height[i] = 1;
      }
      if (process.env.DEBUG) console.log("  2층 후보", inner.size, [...inner].some((i) => height[i] === 2 || (height[i] & 15) === 2));
    }
    if (!stairs(1)) { height.splice(0, height.length, ...backup); continue; }
    const after = walk(height);
    // 원래 갈 수 있던 칸이 언덕 때문에 못 가게 되면 안 됨 (막힌 칸이 된 언덕 칸 제외)
    let ok = true;
    for (let i = 0; i < W * H && ok; i++) if (before[i] && !after[i] && !(heightKind(height, W, H, i % W, (i / W) | 0) & 3)) ok = false;
    // 언덕 위 다닐 수 있는 칸에도 갈 수 있어야
    for (const i of cells) if (ok && !(heightKind(height, W, H, i % W, (i / W) | 0) & 3) && !after[i]) ok = false;
    if (!ok) { height.splice(0, height.length, ...backup); continue; }
    made++;
  }
  function hasHillNear(i: number) {
    const x = i % W, y = (i / W) | 0;
    for (let d = -4; d <= 4; d++) for (let e = -4; e <= 4; e++) if (level(x + e, y + d)) return true;
    return false;
  }

  if (!made || process.env.DRY) return console.log(`${file}: 언덕 ${made}개 (저장 안 함)`);
  // 충돌: 앞면 · 가장자리
  let blockedN = 0;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (heightKind(height, W, H, x, y) & 3) { coll[idx(x, y)] = solid; blockedN++; }
  // 막힌 칸에 걸친 장식 오브젝트는 지움 (위에 있는 것은 그대로)
  const n0 = objects.length;
  objects = objects.filter((o) => {
    if (!DECOR.has(o.type)) return true;
    const cells = footOf(o);
    // 막힌 칸 · 계단 · 계단 둘레 2칸(오르내리는 길)에 걸친 장식은 지움
    const nearStairs = (i: number) => { const x = i % W, y = (i / W) | 0; for (let d = -2; d <= 2; d++) for (let e = -2; e <= 2; e++) if (height[idx(Math.max(0, Math.min(W - 1, x + e)), Math.max(0, Math.min(H - 1, y + d)))] & STAIRS) return true; return false; };
    if (!cells.some((i) => heightKind(height, W, H, i % W, (i / W) | 0) & 7 || nearStairs(i))) return true;
    for (const i of cells) if (!(heightKind(height, W, H, i % W, (i / W) | 0) & 3) && foot.has(i)) coll[i] = 0; // 지운 장식의 발밑 충돌도 지움
    return false;
  });
  og.objects = objects;
  const li = json.layers.findIndex((l) => l.name === "decor_below");
  json.layers.splice(li, 0, { type: "tilelayer", name: "height", data: height, width: W, height: H, x: 0, y: 0, opacity: 1, visible: true, id: json.nextlayerid++ });
  writeFileSync(path, JSON.stringify(json));
  console.log(`${file}.json — 언덕 ${made}개 · 막힌 칸 ${blockedN} · 지운 장식 ${n0 - objects.length}`);
}

// 맵 · 개수 · [가로 반지름 최소, 최대, 세로 최소, 최대] · 2층 확률 · 시드
const only = process.env.MAPS?.split(",");
const go = (f: string, ...a: [number, [number, number, number, number], number, number]) => (!only || only.includes(f)) && run(f, ...a);
go("field", 6, [5, 9, 4, 7], 0.4, 4242);
go("highland", 8, [7, 12, 6, 9], 0.8, 779);
go("plaza", 2, [5, 7, 4, 5], 0, 31337);
go("arena", 2, [4, 6, 3, 4], 0, 2024);
