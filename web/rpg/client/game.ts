import { Application, Container, Graphics, Rectangle, Sprite, Text, Texture, TextureSource } from "pixi.js";
import { castMs, type FullStats } from "../shared/combat";
import { CHAR_FEET, CHAR_H, CHAR_W, INTERP_DELAY_MS, SIM_MS, TILE, type RoomKind } from "../shared/constants";
import type { Appearance } from "../shared/data/appearance";
import { effectDef } from "../shared/data/effects";
import { ITEMS, LOCS, RARITY, basicOf, lookOf, type Item, type Rarity } from "../shared/data/items";
import { JOBS, LINES, type LineId } from "../shared/data/jobs";
import { GRADES } from "../shared/data/mobs";
import { SKILLS, SLOTS, type SkillDef, type Slot } from "../shared/data/skills";
import { ROLL } from "../shared/data/stats";
import { USE_RANGE, distToObj, prop, type GameMap, type TiledObject } from "../shared/map";
import { castMove, step, tryRoll, type MoveInput, type Mover } from "../shared/movement";
import { skillNums } from "../shared/progress";
import {
  F_CAST, F_DEAD, F_MOVING, F_ROLL, F_RUNNING, H_COUNTER, H_CRIT, H_DOT, H_HEAL, H_IMMUNE, H_MISS, H_RESIST,
  type DropRow, type EntityInfo, type Ev, type FxRow, type S2C, type You,
} from "../shared/protocol";
import { josa } from "../shared/josa";
import { ANIMATED, TILE_NAMES, gid } from "../shared/tiles";
import { ACTIONS, ACTION_FPS, APPRENTICE, FRAMES, characterSheet, outfitOf, shadowCanvas, type Action, type Outfit } from "./art/character";
import { effectIcon } from "./art/icons";
import { itemIcon } from "./art/items";
import { mobFrames } from "./art/mobs";
import { Px } from "./art/px";
import { hash } from "./art/px";
import { DECAL_VARIANTS, TILE_COLOR, VARIANTS, contactShadow, decalSheet, objectFrames, tileAtlas } from "./art/world";
import { Fx, elColor } from "./fx";
import { Realism, type Light } from "./realistic";
import type { Net } from "./net";
import { NPC_LOOK, NPC_PLACE, type Place } from "./npcs";
import type { Settings } from "./settings";

TextureSource.defaultOptions.scaleMode = "nearest";

/** 네임 플레이트 높이 (발밑에서 머리 위까지 px) */
const PLATE_H: Record<string, number> = { slime: 21, rabbit: 27, goblin: 29, wolf: 23 };
const PLAYER_PLATE_H = 37;

/** 시전 불가지만 안내는 안 띄움 (쿨 · 다른 동작 중) */
const QUIET = "";

type Sample = { t: number; x: number; y: number; dir: number; flags: number; hp: number; res: number };
type Ent = {
  info: EntityInfo;
  mob: boolean;
  sprite: Sprite;
  shadow: Sprite;
  plate: Container;
  label: Text;
  /** 플레이어 칭호 자리: 직업 이름 (§23-2) */
  title: Text | null;
  bars: Graphics;
  icons: Container;
  frames: Texture[][];
  buf: Sample[];
  x: number;
  y: number;
  dir: number; // 목표 방향
  shown: number; // 화면에 보이는 방향 (회전 보간)
  turnMs: number;
  action: Action;
  animMs: number;
  flags: number;
  hp: number; // 천분율
  res: number;
  drawn: string;
  fx: FxRow[];
  fxAt: number;
  flash: number;
  lunge: { ms: number; dx: number; dy: number } | null;
  act: { kind: Action; until: number } | null;
  deadMs: number;
  face: number; // 몹: 0 오른쪽 · 1 왼쪽
};

export type HudState = {
  fps: number;
  x: number;
  y: number;
  dir: number;
  kind: RoomKind;
  stamina: number;
  staminaMax: number;
  exhausted: boolean;
  others: { x: number; y: number; mob: boolean }[];
  /** [HP, 최대, 마나, 최대, 기력, 최대, 보호막] — 예측 비용 반영 */
  v: number[];
  /** 슬롯별 [남은 ms, 전체 ms, 자원 충분] */
  cds: Partial<Record<Slot, [number, number, boolean]>>;
  /** 내 효과 [id, 남은 ms, 스택, 전체 ms, 값] */
  fx: FxRow[];
  dead: number;
  hint: string | null;
  /** 고른 핫바 칸 · 포션 공유 쿨 남은 ms */
  sel: number;
  potion: number;
  /** 차지 스킬 모으는 정도 0~1 (없으면 −1) */
  charge: number;
};

/** 바닥 아이템: 아이콘 + (희귀 이상) 빛 · 주우면 주운 사람 쪽으로 날아감 */
type GroundItem = { c: Container; x: number; y: number; t: number; fly: { to: number; ms: number } | null };

const sheetCache = new Map<string, Texture[][]>();
function sheetFrames(ap: Appearance, outfit: Outfit = APPRENTICE): Texture[][] {
  const key = JSON.stringify([ap, outfit]);
  let s = sheetCache.get(key);
  if (!s) {
    const base = Texture.from(characterSheet(ap, outfit));
    s = Array.from({ length: 8 }, (_, d) =>
      Array.from({ length: ACTIONS.length * FRAMES }, (_, c) => new Texture({ source: base.source, frame: new Rectangle(c * CHAR_W, d * CHAR_H, CHAR_W, CHAR_H) })),
    );
    sheetCache.set(key, s);
  }
  return s;
}
const mobCache = new Map<string, Texture[][]>();
function mobTextures(key: string): Texture[][] {
  let t = mobCache.get(key);
  if (!t) {
    t = mobFrames(key).map((side) => side.map((c) => Texture.from(c)));
    mobCache.set(key, t);
  }
  return t;
}
const itemTex = new Map<string, Texture>();
const itemTexture = (tpl: string, r: Rarity) => {
  let t = itemTex.get(tpl + r);
  if (!t) { t = Texture.from(itemIcon(tpl, r)); itemTex.set(tpl + r, t); }
  return t;
};
const iconTex = new Map<string, Texture>();
const fxTexture = (id: string) => {
  let t = iconTex.get(id);
  if (!t) { t = Texture.from(effectIcon(id)); iconTex.set(id, t); }
  return t;
};

const LABEL_STYLE = { fontFamily: "Galmuri11", fontSize: 11, stroke: { color: "#1b1420", width: 3 }, align: "center" as const };

/** 지도 한 장 (미니맵 · 전체 지도) — 타일 1칸 = 1px */
export function mapOverview(map: GameMap): HTMLCanvasElement {
  const p = new Px(map.w, map.h);
  for (let i = 0; i < map.w * map.h; i++) {
    const g = map.layers.decor_below[i] || map.layers.water[i] || map.layers.ground[i];
    p.set(i % map.w, Math.floor(i / map.w), TILE_COLOR[TILE_NAMES[g - 1]] ?? "#000000");
  }
  for (const o of map.objects) {
    const c = o.type === "building" ? "#C8643B" : o.type === "tree" ? "#4f8a2b" : o.type === "rock" ? "#9e917c" : null;
    if (c) p.rect(Math.floor((o.x - o.width / 2) / TILE), Math.floor((o.y - o.height / 2) / TILE), Math.max(1, o.width / TILE), Math.max(1, o.height / TILE / 2), c);
  }
  return p.toCanvas();
}

export class Game {
  app = new Application();
  world = new Container();
  entityLayer = new Container({ sortableChildren: true });
  screenLayer = new Container();
  fx = new Fx();
  indicator = new Graphics();
  map: GameMap;
  kind: RoomKind;
  net: Net;
  you: You;
  settings: Settings;
  stats: FullStats;
  me: Mover;
  prev: Mover;
  meSprite!: Ent;
  ents = new Map<number, Ent>();
  pending: MoveInput[] = [];
  acc = 0;
  keys = new Set<string>();
  inputBlocked = false;
  zoom = 3;
  offset: number | null = null;
  water: { s: Sprite; frames: Texture[] }[] = [];
  animated: { s: Sprite; frames: Texture[]; slow?: number }[] = [];
  glows: Sprite[] = [];
  /** 사실적 모드: 빛을 내는 오브젝트 · 그림자를 드리울 고정 오브젝트 */
  private lightSrc: Light[] = [];
  private staticSprites: Sprite[] = [];
  realism!: Realism;
  waterFrame = 0;
  waterMs = 0;
  fps = 0;
  // 전투 상태 (서버 값 + 예측)
  v: number[] = [0, 1, 0, 1, 0, 1, 0, 0, 0, 0, 0, 0];
  ackSeq = -1;
  castLog: { seq: number; k: Slot; mana: number; energy: number; cd: number; to?: { x: number; y: number } }[] = [];
  myFx: FxRow[] = [];
  myFxAt = 0;
  deadUntil = 0;
  mouse = { sx: 0, sy: 0, held: false };
  queued: { dodge: boolean; k: Slot | null; fromKey: boolean; cs: Slot | null } = { dodge: false, k: null, fromKey: false, cs: null };
  aiming: Slot | null = null;
  near: TiledObject | null = null;
  interactables: TiledObject[];
  onToast: (msg: string) => void = () => {};
  onXp: (amount: number, exp: number, level: number) => void = () => {};
  onItems: (items: Item[]) => void = () => {};
  /** 성장 상태가 바뀜 (React 스킬창 · HUD) · 시설 · NPC 와 상호작용 (F) → 열 창 */
  onProg: () => void = () => {};
  onPlace: (place: Place) => void = () => {};
  onTalk: (npc: string) => void = () => {};
  /** 차지 스킬을 모으는 중 (§10-2) */
  charging: { slot: Slot; at: number } | null = null;
  items: Item[] = [];
  /** 고른 핫바 칸 (§15-2) */
  sel = 0;
  drops = new Map<number, GroundItem>();
  private toasted = new Map<string, number>();
  private fpsAcc = { n: 0, t: 0 };
  private disposers: (() => void)[] = [];

  constructor(map: GameMap, kind: RoomKind, net: Net, you: You, me: Mover, settings: Settings, stats: FullStats, items: Item[]) {
    this.map = map;
    this.kind = kind;
    this.net = net;
    this.you = you;
    this.me = me;
    this.prev = { ...me };
    this.settings = settings;
    this.stats = stats;
    this.interactables = map.objects.filter((o) => o.type === "portal" || o.type === "npc" || o.type in PLACE);
    this.setItems(items);
  }

  /** 인벤토리가 바뀜: 평타는 무기 칸 무기를 따라감 (D20) */
  setItems(items: Item[]) {
    this.items = items;
    this.you.slots = { ...this.you.slots, A: basicOf(items) };
    this.onItems(items);
  }

  async start(el: HTMLElement, ents: EntityInfo[], fx: [number, FxRow[]][], drops: DropRow[]) {
    await this.app.init({ resizeTo: el, background: "#0a1207", antialias: false, preference: "webgl", roundPixels: true });
    this.app.canvas.style.imageRendering = "pixelated";
    el.appendChild(this.app.canvas);
    await document.fonts.load("11px Galmuri11").catch(() => {});

    this.buildMap();
    this.app.stage.addChild(this.world, this.screenLayer);
    this.realism = new Realism(this.app, this.world, this.app.stage, this.entityLayer, this.screenLayer);
    for (const s of this.staticSprites) this.realism.addStatic(s);
    this.meSprite = this.makeEnt({ id: this.you.id, name: this.you.nickname, ap: this.you.appearance, look: lookOf(this.items), el: this.you.element, lv: this.you.level, jb: this.you.prog.job ?? this.you.prog.line ?? "" }, true);
    for (const e of ents) this.addEnt(e);
    for (const [id, rows] of fx) this.setFx(id, rows);
    for (const d of drops) this.addDrop(d);

    const down = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.closest?.("input, textarea, select")) return;
      this.keys.add(e.code);
      if (e.code === "Tab" || e.code === "Space") e.preventDefault();
      if (!e.repeat && !this.inputBlocked) this.press(e.code);
    };
    const up = (e: KeyboardEvent) => {
      this.keys.delete(e.code);
      const slot = this.slotOfKey(e.code);
      if (this.aiming && slot === this.aiming) { this.queue(this.aiming); this.aiming = null; }
      // 차지 스킬: 떼면 쏨
      if (this.charging && slot === this.charging.slot) { this.queue(slot); this.charging = null; }
    };
    const blur = () => {
      this.keys.clear(); this.mouse.held = false; this.aiming = null;
      if (this.charging) { this.queue(this.charging.slot); this.charging = null; }
    };
    const move = (e: MouseEvent) => {
      const r = this.app.canvas.getBoundingClientRect();
      this.mouse.sx = e.clientX - r.left;
      this.mouse.sy = e.clientY - r.top;
    };
    const mdown = (e: MouseEvent) => {
      if (this.inputBlocked) return;
      move(e);
      if (e.button === 0) this.mouse.held = true;
      if (e.button === 2) this.useHotbar();
    };
    // 휠 = 핫바 칸 (미니맵 위 휠은 미니맵 확대 — 캔버스에서만 받음)
    const wheel = (e: WheelEvent) => { if (!this.inputBlocked && e.deltaY) this.sel = (this.sel + (e.deltaY > 0 ? 1 : LOCS.hotbar - 1)) % LOCS.hotbar; };
    const mup = (e: MouseEvent) => { if (e.button === 0) this.mouse.held = false; };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("blur", blur);
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", mup);
    this.app.canvas.addEventListener("mousedown", mdown);
    this.app.canvas.addEventListener("wheel", wheel, { passive: true });
    this.disposers.push(() => {
      window.removeEventListener("keydown", down); window.removeEventListener("keyup", up); window.removeEventListener("blur", blur);
      window.removeEventListener("mousemove", move); window.removeEventListener("mouseup", mup);
    });

    this.applySettings(this.settings);
    this.app.ticker.add((t) => this.frame(t.deltaMS));
  }

  destroy() {
    for (const d of this.disposers) d();
    this.app.destroy(true, { children: true });
  }

  applySettings(s: Settings) {
    this.settings = s;
    this.app.ticker.maxFPS = s.fpsLimit;
    for (const e of [this.meSprite, ...this.ents.values()]) e.shadow.visible = s.shadows;
    for (const g of this.glows) g.visible = s.quality !== "low";
    this.fx.setQuality(s.quality);
    this.realism?.setEnabled(s.graphics === "realistic");
  }

  // ── 맵 ──────────────────────────────────────────────────────────
  private buildMap() {
    const { w, h, layers } = this.map;
    const atlas = tileAtlas();
    const atlasTex = Texture.from(atlas);
    const tileTex = (g: number, v: number) => new Texture({ source: atlasTex.source, frame: new Rectangle((g - 1) * TILE, v * TILE, TILE, TILE) });

    // 정적 레이어는 큰 캔버스 한 장으로 굽고(드로우콜 1), 물만 스프라이트로 움직입니다
    const bake = (layer: Uint16Array) => {
      const c = Object.assign(document.createElement("canvas"), { width: w * TILE, height: h * TILE });
      const ctx = c.getContext("2d")!;
      for (let i = 0; i < w * h; i++) {
        const g = layer[i];
        if (!g || TILE_NAMES[g - 1] === "solid") continue;
        const x = i % w;
        const y = Math.floor(i / w);
        const v = Math.floor(((x * 7 + y * 13) % 17) / 17 * VARIANTS);
        ctx.drawImage(atlas, (g - 1) * TILE, v * TILE, TILE, TILE, x * TILE, y * TILE, TILE, TILE);
      }
      return new Sprite(Texture.from(c));
    };
    const animGids = new Set(ANIMATED.map(gid));
    this.world.addChild(this.bakeGround(atlas, animGids));
    const waterLayer = new Container();
    for (let i = 0; i < w * h; i++) {
      const g = layers.water[i];
      if (!animGids.has(g)) continue;
      const frames = Array.from({ length: VARIANTS }, (_, v) => tileTex(g, v));
      const s = new Sprite(frames[0]);
      s.position.set((i % w) * TILE, Math.floor(i / w) * TILE);
      waterLayer.addChild(s);
      this.water.push({ s, frames });
    }
    this.world.addChild(waterLayer, bake(layers.decor_below), this.fx.ground, this.indicator, this.entityLayer, this.fx.world);
    if (layers.decor_above.some((g) => g)) this.world.addChild(bake(layers.decor_above));
    this.screenLayer.addChild(this.fx.screen);

    const glowTex = Texture.from(glowCanvas());
    const contactTex = Texture.from(contactShadow());
    for (const o of this.map.objects) {
      if (o.type === "spawn" || o.type === "spawn_zone") continue;
      if (o.type === "npc") {
        const look = NPC_LOOK[String(prop(o, "npc"))];
        const s = new Sprite(sheetFrames(look.ap, look.outfit)[0][0]);
        s.anchor.set(0.5, CHAR_FEET / CHAR_H);
        s.position.set(o.x, o.y - 2);
        s.zIndex = o.y;
        this.entityLayer.addChild(s);
        this.animated.push({ s, frames: sheetFrames(look.ap, look.outfit)[0].slice(0, FRAMES), slow: 3 }); // NPC 숨쉬기: 8프레임 약 2.7fps
        this.label(`${o.name}\n${prop(o, "role")}`, o.x, o.y - 42, "#FFE14D");
        const mark = this.label("!", o.x, o.y - 66, "#FFD84D");
        mark.style.fontSize = 22;
        mark.visible = false;
        this.marks.set(String(prop(o, "npc")), mark);
        continue;
      }
      const frames = objectFrames(o).map((c) => Texture.from(c));
      const s = new Sprite(frames[0]);
      s.anchor.set(0.5, 1);
      s.position.set(o.x, o.y);
      s.zIndex = o.type === "portal" ? o.y - o.height : o.y;
      this.entityLayer.addChild(s);
      if (frames.length > 1) this.animated.push({ s, frames });
      const CONTACT: Record<string, [number, number]> = {
        tree: [0.95, 9], building: [1.0, 8], tent_shop: [1.0, 7], tent_market: [1.0, 7], bench: [1.0, 5], lamp: [0.8, 5], statue: [1.0, 7], well: [1.0, 6],
        barrel: [1.0, 5], crate: [1.0, 5], crate_stack: [1.0, 6], flowerpot: [0.9, 4], haystack: [1.0, 6], sack: [0.9, 4], log: [1.0, 5], fence: [1.0, 4],
        rock: [1.0, 5], stump: [1.0, 5], bush: [1.1, 5], board: [1.0, 5], workbench: [1.0, 5], anvil: [1.0, 5], mailbox: [0.9, 4], mushroom: [0.8, 4],
      };
      const cs = CONTACT[o.type];
      if (cs) {
        const sh = new Sprite(contactTex);
        sh.anchor.set(0.5);
        sh.position.set(o.x, o.y - 1);
        sh.width = Math.max(10, o.width * cs[0]);
        sh.height = cs[1] * 2;
        sh.zIndex = -1e6;
        this.entityLayer.addChild(sh);
      }
      if (["tree", "barrel", "crate", "crate_stack", "flowerpot", "banner", "well", "haystack", "sack", "log", "fence", "mushroom", "lamp", "building", "tent_shop", "tent_market", "statue", "bench", "board", "mailbox", "workbench", "anvil", "rock", "stump", "bush", "sign"].includes(o.type)) this.staticSprites.push(s);
      if (o.type === "lamp") this.lightSrc.push({ x: o.x, y: o.y - 26, r: 70, color: 0xffd27a, flicker: 0.02 });
      if (o.type === "campfire") this.lightSrc.push({ x: o.x, y: o.y - 6, r: 80, color: 0xff9a4a, flicker: 0.07 });
      if (o.type === "portal") this.lightSrc.push({ x: o.x, y: o.y - o.height / 2, r: 56, color: o.properties?.find((x) => x.name === "target")?.value === "dungeon" ? 0xb07aff : o.properties?.find((x) => x.name === "target")?.value === "arena" ? 0xff6a6a : 0x6aff8a, flicker: 0.04 });
      if (o.type === "lamp" || o.type === "campfire") {
        const g = new Sprite(glowTex);
        g.anchor.set(0.5);
        g.position.set(o.x, o.type === "lamp" ? o.y - 26 : o.y - 6);
        g.blendMode = "add";
        g.zIndex = 1e6;
        this.entityLayer.addChild(g);
        this.glows.push(g);
      }
      if (["portal", "tent_shop", "tent_market", "building", "mailbox", "board", "workbench", "anvil", "sign"].includes(o.type) && !(o.type === "sign" && this.kind === "plaza")) {
        this.label(o.name, o.x, o.y - o.height - 2, o.type === "portal" ? "#d6b3ff" : "#ffffff");
      }
    }
  }

  /**
   * 바닥 굽기 (사실감): ① 타일 변형 ② 넓은 얼룩 노이즈(풀밭이 균일하지 않게) ③ 풀 · 자갈 · 낙엽 · 버섯 · 금 · 이끼 데칼
   * ④ 길 · 돌바닥과 잔디의 경계(돌 쪽 어두운 그늘 + 잔디가 돌 위로 삐져나옴, 흙길 가장자리는 들쑥날쑥)
   * ⑤ 물가(젖은 띠 + 거품). 한 번만 계산해 캔버스 한 장으로 굽습니다.
   */
  private bakeGround(atlas: HTMLCanvasElement, animGids: Set<number>) {
    const { w, h, layers } = this.map;
    const c = Object.assign(document.createElement("canvas"), { width: w * TILE, height: h * TILE });
    const ctx = c.getContext("2d")!;
    const decals = decalSheet();
    const nameAt = (x: number, y: number): string | null => (x < 0 || y < 0 || x >= w || y >= h ? null : TILE_NAMES[layers.ground[y * w + x] - 1] ?? null);
    const waterAt = (x: number, y: number) => x >= 0 && y >= 0 && x < w && y < h && animGids.has(layers.water[y * w + x]);
    const SOFT = new Set(["grass", "grass_dark", "flowers", "dirt"]);
    const HARD = new Set(["sand", "cobble", "stone_edge", "bridge", "fountain_rim"]);
    // 오브젝트가 차지한 칸에는 데칼을 뿌리지 않음
    const taken = new Uint8Array(w * h);
    for (const o of this.map.objects) {
      if (o.type === "spawn" || o.type === "spawn_zone") continue;
      for (let y = Math.floor((o.y - o.height) / TILE) - 1; y <= Math.floor(o.y / TILE); y++) for (let x = Math.floor((o.x - o.width / 2) / TILE) - 1; x <= Math.floor((o.x + o.width / 2) / TILE); x++) if (x >= 0 && y >= 0 && x < w && y < h) taken[y * w + x] = 1;
    }
    const vn = (x: number, y: number) => {
      const xi = Math.floor(x), yi = Math.floor(y), fx = x - xi, fy = y - yi;
      const sm = (t: number) => t * t * (3 - 2 * t);
      const a = hash(xi, yi, 5), b = hash(xi + 1, yi, 5), c2 = hash(xi, yi + 1, 5), d = hash(xi + 1, yi + 1, 5);
      return (a + (b - a) * sm(fx)) * (1 - sm(fy)) + (c2 + (d - c2) * sm(fx)) * sm(fy);
    };
    const DIRS4: [number, number][] = [[0, -1], [0, 1], [-1, 0], [1, 0]];
    // 경계 띠 영역 (타일 안, 해당 방향 가장자리에서 depth px)
    const strip = (d: number, ox: number, oy: number, depth: number): [number, number, number, number] =>
      d === 0 ? [ox, oy, TILE, depth] : d === 1 ? [ox, oy + TILE - depth, TILE, depth] : d === 2 ? [ox, oy, depth, TILE] : [ox + TILE - depth, oy, depth, TILE];
    const shade = (d: number, ox: number, oy: number, depth: number, rgb: string, a: number) => {
      const [x, y, sw, sh] = strip(d, ox, oy, depth);
      const g = d === 0 ? ctx.createLinearGradient(0, y, 0, y + sh) : d === 1 ? ctx.createLinearGradient(0, y + sh, 0, y) : d === 2 ? ctx.createLinearGradient(x, 0, x + sw, 0) : ctx.createLinearGradient(x + sw, 0, x, 0);
      g.addColorStop(0, `rgba(${rgb},${a})`);
      g.addColorStop(1, `rgba(${rgb},0)`);
      ctx.fillStyle = g;
      ctx.fillRect(x, y, sw, sh);
    };
    /** 경계선 위 픽셀을 확률적으로 찍음 (안쪽으로 1~depth px) */
    const speckle = (d: number, ox: number, oy: number, x: number, y: number, depth: number, colors: string[], p: number) => {
      for (let k = 0; k < TILE; k++) {
        const r = hash(x * 16 + k, y * 4 + d, 31);
        if (r > p) continue;
        const dep = 1 + Math.floor(hash(x * 16 + k, y, 32 + d) * depth);
        for (let q = 0; q < dep; q++) {
          const px = d === 2 ? ox + q : d === 3 ? ox + TILE - 1 - q : ox + k;
          const py = d === 0 ? oy + q : d === 1 ? oy + TILE - 1 - q : oy + k;
          ctx.fillStyle = colors[(k + q) % colors.length];
          ctx.fillRect(px, py, 1, 1);
        }
      }
    };

    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const g = layers.ground[y * w + x];
        if (!g || TILE_NAMES[g - 1] === "solid") continue;
        const name = TILE_NAMES[g - 1];
        const ox = x * TILE, oy = y * TILE;
        // ① 타일 변형 (이웃과 겹치지 않게 해시)
        ctx.drawImage(atlas, (g - 1) * TILE, Math.floor(hash(x, y, 3) * VARIANTS) * TILE, TILE, TILE, ox, oy, TILE, TILE);
        // ② 넓은 얼룩: 2px 단위로 부드럽게 (타일 경계가 네모로 보이지 않게)
        const soft = SOFT.has(name);
        if (soft || HARD.has(name)) {
          for (let sy = 0; sy < TILE; sy += 2) {
            for (let sx = 0; sx < TILE; sx += 2) {
              const wx = x + sx / TILE;
              const wy = y + sy / TILE;
              const n = (vn(wx / 7, wy / 7) * 0.62 + vn(wx / 2.6, wy / 2.6) * 0.28 + vn(wx * 1.7, wy * 1.7) * 0.1 - 0.5) * 2;
              ctx.fillStyle = soft ? (n > 0 ? `rgba(238,240,120,${n * 0.17})` : `rgba(14,66,30,${-n * 0.22})`) : `rgba(110,84,48,${Math.abs(n) * 0.08})`;
              ctx.fillRect(ox + sx, oy + sy, 2, 2);
            }
          }
        }
        // ③ 데칼
        if (!taken[y * w + x] && !layers.collision[y * w + x] && !layers.decor_below[y * w + x]) {
          const r = hash(x, y, 77);
          const sub = hash(y, x, 78);
          let kind = -1;
          if ((name === "grass" || name === "grass_dark") && r < 0.1) kind = sub < 0.42 ? 0 : sub < 0.58 ? 4 : sub < 0.76 ? 1 : sub < 0.9 ? 2 : 3;
          else if (name === "dirt" && r < 0.09) kind = sub < 0.6 ? 1 : 2;
          else if ((name === "cobble" || name === "sand") && r < 0.07) kind = sub < 0.5 ? 5 : sub < 0.8 ? 6 : 1;
          if (kind >= 0) ctx.drawImage(decals, Math.floor(hash(x, y, 79) * DECAL_VARIANTS) * TILE, kind * TILE, TILE, TILE, ox, oy, TILE, TILE);
        }
        // ④ ⑤ 경계
        DIRS4.forEach(([dx, dy], d) => {
          const nn = nameAt(x + dx, y + dy);
          const nWater = waterAt(x + dx, y + dy);
          if (waterAt(x, y)) return;
          if (nWater) {
            shade(d, ox, oy, 4, "30,64,84", 0.34); // 젖은 땅
            shade(d, ox, oy, 2, "255,255,255", 0.22);
            speckle(d, ox, oy, x, y, 1, ["#ffffffcc", "#d8f4ffaa"], 0.5); // 거품
            return;
          }
          if (!nn) return;
          if (HARD.has(name) && SOFT.has(nn)) {
            shade(d, ox, oy, 4, "34,26,12", 0.3); // 돌 가장자리 그늘
            speckle(d, ox, oy, x, y, 2, ["#76b02f", "#98d048", "#5c9a33"], 0.42); // 삐져나온 잔디
          } else if ((name === "grass" && nn === "grass_dark") || (name === "grass_dark" && nn === "grass")) {
            // 짙은 풀밭과 연한 풀밭의 경계도 들쑥날쑥하게 섞음 (네모 얼룩이 보이지 않게)
            speckle(d, ox, oy, x, y, 3, name === "grass" ? ["#76b02f", "#639b27", "#86c03a"] : ["#8CC63F", "#98d048", "#7ab535"], 0.6);
          } else if (name === "dirt" && (nn === "grass" || nn === "grass_dark" || nn === "flowers")) {
            speckle(d, ox, oy, x, y, 3, ["#8CC63F", "#76b02f", "#98d048"], 0.55); // 들쑥날쑥한 길 가장자리
            shade(d, ox, oy, 2, "70,48,24", 0.22);
          }
        });
      }
    }
    return new Sprite(Texture.from(c));
  }

  private labels: { t: Text; x: number; y: number }[] = [];
  private label(text: string, x: number, y: number, fill: string) {
    const t = new Text({ text, style: { ...LABEL_STYLE, fill, fontSize: 11 } });
    t.anchor.set(0.5, 1);
    this.screenLayer.addChild(t);
    this.labels.push({ t, x, y });
    return t;
  }

  /** 머리 위 ! 표시 (§19-1): 지금 퀘스트가 말을 걸라고 하는 NPC */
  private marks = new Map<string, Text>();
  setNpcMarks(npcs: string[]) {
    for (const [id, t] of this.marks) t.visible = npcs.includes(id);
  }

  // ── 엔티티 ───────────────────────────────────────────────────────
  private makeEnt(info: EntityInfo, isMe = false): Ent {
    const mob = !!info.mob;
    const frames = mob ? mobTextures(info.mob!) : sheetFrames(info.ap!, outfitOf(info.look));
    const sprite = new Sprite(frames[0][0]);
    sprite.anchor.set(0.5, mob ? 29 / 32 : CHAR_FEET / CHAR_H);
    const shadow = new Sprite(shadowTex());
    shadow.anchor.set(0.5);
    shadow.zIndex = -1e6;
    const plate = new Container();
    const color = mob ? GRADES[info.grade ?? "normal"].color : isMe ? "#ffffff" : "#8fdcff";
    const label = new Text({ text: mob ? `Lv${info.lv} ${info.name}` : info.name, style: { ...LABEL_STYLE, fill: color } });
    label.anchor.set(0.5, 1);
    label.y = -6;
    const bars = new Graphics();
    const icons = new Container();
    plate.addChild(bars, label, icons);
    let title: Text | null = null;
    if ((mob && info.grade && info.grade !== "normal") || !mob) {
      title = new Text({ text: mob ? GRADES[info.grade!].name : this.jobTitle(info.jb), style: { ...LABEL_STYLE, fontSize: 10, fill: mob ? color : "#FFE14D" } });
      title.anchor.set(0.5, 1);
      title.y = -19;
      plate.addChild(title);
    }
    this.entityLayer.addChild(shadow, sprite);
    this.screenLayer.addChild(plate);
    const x = isMe ? this.me.x : 0;
    const y = isMe ? this.me.y : 0;
    return {
      info, mob, sprite, shadow, plate, label, title, bars, icons, frames, buf: [], x, y, dir: 0, shown: 0, turnMs: 0, action: "idle", animMs: 0,
      flags: 0, hp: 1000, res: 1000, drawn: "", fx: [], fxAt: 0, flash: 0, lunge: null, act: null, deadMs: 0, face: 0,
    };
  }

  /** 이 오브젝트 · NPC 가 여는 창 */
  private placeOf(o: TiledObject | null): Place | null {
    if (!o) return null;
    return o.type === "npc" ? NPC_PLACE[String(prop(o, "npc"))] ?? null : PLACE[o.type] ?? null;
  }

  /** 칭호 자리: 1차 · 2차 직업 이름 (견습은 비움) */
  private jobTitle(jb?: string) {
    return !jb ? "" : jb in LINES ? LINES[jb as LineId].name : (JOBS[jb]?.name ?? "");
  }

  addEnt(info: EntityInfo) {
    if (info.id === this.you.id || this.ents.has(info.id)) return;
    const e = this.makeEnt(info);
    e.sprite.visible = e.shadow.visible = e.plate.visible = false; // 첫 스냅샷 전까지 숨김
    this.ents.set(info.id, e);
  }

  private addDrop([, id, tpl, rarity, , x, y]: DropRow) {
    if (this.drops.has(id) || !ITEMS[tpl]) return;
    const c = new Container();
    if (rarity !== "poor" && rarity !== "common") {
      const glow = new Graphics().ellipse(0, -1, 8, 3).fill({ color: RARITY[rarity].color, alpha: 0.55 });
      glow.blendMode = "add";
      c.addChild(glow);
    }
    const s = new Sprite(itemTexture(tpl, rarity));
    s.anchor.set(0.5, 1);
    s.scale.set(0.375); // 아이콘이 32×32 가 되어 절반 크기로 (월드 표시 크기는 그대로)
    c.addChild(s);
    c.position.set(x, y);
    c.zIndex = y - 1;
    this.entityLayer.addChild(c);
    this.drops.set(id, { c, x, y, t: Math.random() * 1000, fly: null });
  }

  removeEnt(id: number) {
    const e = this.ents.get(id);
    if (!e) return;
    e.sprite.destroy();
    e.shadow.destroy();
    e.plate.destroy({ children: true });
    this.ents.delete(id);
  }

  private ent(id: number): Ent | undefined {
    return id === this.you.id ? this.meSprite : this.ents.get(id);
  }

  private setFx(id: number, rows: FxRow[]) {
    if (id === this.you.id) { this.myFx = rows; this.myFxAt = performance.now(); }
    const e = this.ent(id);
    if (!e) return;
    e.fx = rows;
    e.fxAt = performance.now();
    // 네임 플레이트: 디버프만 (§23-2)
    e.icons.removeChildren().forEach((c) => c.destroy());
    const debuffs = rows.filter((r) => !effectDef(r[0])?.buff).slice(0, 5);
    debuffs.forEach((r, i) => {
      const s = new Sprite(fxTexture(r[0]));
      s.scale.set(0.5); // 32×32 아이콘을 16px 크기로
      s.position.set((i - debuffs.length / 2) * 17, -40);
      e.icons.addChild(s);
    });
  }

  // ── 서버 메시지 ──────────────────────────────────────────────────
  onMessage(m: S2C) {
    if (m.t === "spawn") this.addEnt(m.e);
    else if (m.t === "despawn") this.removeEnt(m.id);
    else if (m.t === "stats") this.stats = m.s;
    else if (m.t === "inv") this.setItems(m.items);
    else if (m.t === "prog") {
      this.you.prog = m.prog;
      this.you.slots = { ...m.slots, A: basicOf(this.items) };
      this.onProg();
    }
    else if (m.t === "s") {
      const now = performance.now();
      const sample = m.st - now;
      this.offset = this.offset === null ? sample : this.offset + (sample - this.offset) * 0.05;
      // 보정 (§2-2): 서버가 처리한 입력 이후의 것만 다시 재생
      this.ackSeq = m.ack.seq;
      this.v = m.v;
      this.pending = this.pending.filter((i) => i.seq > m.ack.seq);
      this.castLog = this.castLog.filter((c) => c.seq > m.ack.seq);
      const fixed = { ...m.ack.m };
      for (const i of this.pending) this.replay(fixed, i);
      if (Math.abs(fixed.x - this.me.x) > 24 || Math.abs(fixed.y - this.me.y) > 24) this.prev = { ...fixed }; // 크게 어긋나면 순간이동
      this.me = fixed;
      for (const [id, x, y, dir, flags, hp, res] of m.e) {
        const e = this.ents.get(id);
        if (!e) continue;
        e.buf.push({ t: m.st, x, y, dir, flags, hp, res });
        if (e.buf.length > 30) e.buf.shift();
      }
      if (m.ev) for (const ev of m.ev) this.event(ev);
      if (m.pe) for (const ev of m.pe) this.personal(ev);
    }
  }

  private event(ev: Ev) {
    const now = performance.now();
    switch (ev[0]) {
      case "h": {
        const [, , tgt, amount, flags, el] = ev as [string, number, number, number, number, string];
        const e = this.ent(tgt);
        if (!e) return;
        const mine = tgt === this.you.id;
        const label = flags & H_COUNTER ? "반격!" : flags & H_IMMUNE ? (e === this.meSprite && this.me.ifr > 0 ? "회피" : "무적") : flags & H_MISS ? "빗나감" : flags & H_RESIST ? "저항" : null;
        const top = e.y - (e.mob ? (PLATE_H[e.info.mob!] ?? 24) : 40);
        if (this.settings.damageNumbers || mine) {
          if (label) this.fx.number(e.x, top, label, "#cfd6de");
          else if (flags & H_HEAL) this.fx.number(e.x, top, `+${amount}`, "#4CC764");
          else this.fx.number(e.x, top, String(amount), mine ? "#ff6b6b" : flags & H_DOT ? "#c9a0f0" : el ? elColor(el) : "#ffffff", !!(flags & H_CRIT));
        }
        if (label) return;
        if (flags & H_HEAL) { this.fx.burst(e.x, e.y - 16, "heal", 6); return; }
        e.flash = 120;
        this.fx.burst(e.x, e.y - 14, el || "hit", el ? 12 : 5);
        if (mine && this.settings.shake && amount > this.v[1] * 0.05) this.fx.shake = 160;
        return;
      }
      case "c": {
        const [, id, sk, ax, ay] = ev as [string, number, string, number, number];
        if (id === this.you.id) return; // 내 시전은 이미 예측해서 재생함
        const e = this.ents.get(id);
        if (!e) return;
        if (e.mob) {
          const dx = ax - e.x;
          const dy = ay - e.y;
          const len = Math.sqrt(dx * dx + dy * dy) || 1;
          if (sk === "atk") e.lunge = { ms: 0, dx: dx / len, dy: dy / len };
          return;
        }
        this.playCast(e, SKILLS[sk], ax, ay, now);
        return;
      }
      case "p": {
        const [, pid, owner, , el, x, y, vx, vy, range, seq] = ev as [string, number, number, string, string, number, number, number, number, number, number];
        if (owner === this.you.id && seq >= 0 && this.fx.projs.has(-(seq + 1))) return this.fx.rename(-(seq + 1), pid);
        this.fx.projectile(pid, x, y, vx, vy, range, el || "wind");
        return;
      }
      case "px":
        return this.fx.endProjectile(ev[1] as number);
      case "w": {
        const [, shape, x, y, ang, size, width, ms, team] = ev as [string, string, number, number, number, number, number, number, string?];
        return this.fx.telegraph(shape, x, y, ang, size, width, ms, team);
      }
      case "gx": {
        const [, x, y, r, kind] = ev as [string, number, number, number, string];
        return this.fx.ring(x, y, r, kind);
      }
      case "wl": {
        const [, x1, y1, x2, y2, ms] = ev as number[] as [never, number, number, number, number, number];
        return this.fx.wall(x1, y1, x2, y2, ms);
      }
      case "rx": {
        const e = this.ent(ev[1] as number);
        if (e) this.fx.number(e.x, e.y - (e.mob ? (PLATE_H[e.info.mob!] ?? 24) + 12 : 52), `${ev[2]}!`, "#FFD27A", true);
        return;
      }
      case "rv": {
        const e = this.ent(ev[1] as number);
        if (!e) return;
        e.deadMs = 0;
        if (e === this.meSprite) this.deadUntil = 0;
        this.fx.pillar(e.x, e.y);
        return;
      }
      case "job": {
        const [, id, line, job] = ev as [string, number, string, string];
        const e = this.ent(id);
        if (!e || e.mob) return;
        e.info.jb = job || line;
        if (e.title) e.title.text = this.jobTitle(e.info.jb);
        this.fx.pillar(e.x, e.y);
        return;
      }
      case "f":
        return this.setFx(ev[1] as number, ev[2] as FxRow[]);
      case "d": {
        const e = this.ent(ev[1] as number);
        if (e) { e.deadMs = 1; this.fx.burst(e.x, e.y - 10, e.mob ? "hit" : "dark", 16); }
        return;
      }
      case "dr":
        return this.addDrop(ev as DropRow);
      case "dx": {
        const d = this.drops.get(ev[1] as number);
        if (!d) return;
        if (ev[2]) d.fly = { to: ev[2] as number, ms: 0 };
        else { d.c.destroy({ children: true }); this.drops.delete(ev[1] as number); }
        return;
      }
      case "eq": {
        const e = this.ent(ev[1] as number);
        if (!e || e.mob) return;
        e.info.look = ev[2] as string[];
        e.frames = sheetFrames(e.info.ap!, outfitOf(e.info.look));
        return;
      }
      case "lv": {
        const [, id, lv] = ev as [string, number, number];
        const e = this.ent(id);
        if (!e) return;
        e.info.lv = lv;
        if (e.mob) e.label.text = `Lv${lv} ${e.info.name}`;
        if (id === this.you.id) this.you.level = lv;
        this.fx.number(e.x, e.y - 56, "LEVEL UP!", "#FFD27A", true);
        this.fx.pillar(e.x, e.y);
        return;
      }
    }
  }

  private personal(ev: Ev) {
    switch (ev[0]) {
      case "cf": {
        const [, seq, why] = ev as [string, number, string];
        this.fx.endProjectile(-(seq + 1), false);
        if (!why.includes("대기") && !why.includes("동작")) this.toast(why);
        return;
      }
      case "xp": {
        const [, amount, exp, level] = ev as [string, number, number, number];
        this.you.exp = exp;
        this.you.level = level;
        if (amount) this.fx.number(this.meSprite.x, this.meSprite.y - 50, `${amount > 0 ? "+" : ""}${amount} EXP`, amount > 0 ? "#F2C94C" : "#ff6b6b");
        this.onXp(amount, exp, level);
        return;
      }
      case "dr":
        return this.addDrop(ev as DropRow);
      case "get": {
        const [, tpl, qty, rarity] = ev as [string, string, number, Rarity];
        const t = ITEMS[tpl];
        if (t) this.fx.number(this.meSprite.x, this.meSprite.y - 50, `+${t.name}${qty > 1 ? ` ×${qty}` : ""}`, rarity === "common" ? "#fff4dc" : RARITY[rarity].color);
        return;
      }
      case "sk": {
        // 스킬 레벨업 · 새로 배움 (§10-3)
        const [, id, lv, kind] = ev as [string, string, number, string];
        const sk = SKILLS[id];
        if (!sk) return;
        const text = kind === "learn" ? `새 스킬 「${sk.name}」 (K)` : kind === "grade" ? `「${sk.name}」 등급이 올랐습니다` : `「${sk.name}」 Lv${lv}`;
        this.fx.number(this.meSprite.x, this.meSprite.y - 62, text, "#9be564");
        if (kind !== "lv") this.toast(text);
        return;
      }
      case "ruc": {
        const amount = ev[1] as number;
        this.you.ruc += amount;
        this.fx.number(this.meSprite.x + 10, this.meSprite.y - 40, `+${amount} RUC`, "#F2C94C");
        return;
      }
      case "du": {
        const [, id, dur] = ev as [string, string, number];
        const it = this.items.find((i) => i.id === id);
        if (!it) return;
        this.setItems(this.items.map((i) => (i === it ? { ...i, dur } : i)));
        if (dur === 0) this.toast(`「${ITEMS[it.tpl].name}」의 내구도가 다 닳아 성능이 꺼졌습니다`);
        return;
      }
      case "dead":
        this.deadUntil = performance.now() + (ev[1] as number);
        this.meSprite.deadMs = 1;
        this.mouse.held = false;
        return;
    }
  }

  private toast(msg: string) {
    const now = performance.now();
    if (!msg || now - (this.toasted.get(msg) ?? 0) < 1500) return;
    this.toasted.set(msg, now);
    this.onToast(msg);
  }

  // ── 입력 · 스킬 예측 ─────────────────────────────────────────────
  private slotOfKey(code: string): Slot | null {
    const k = this.settings.keys;
    return code === k.skillQ ? "Q" : code === k.skillW ? "W" : code === k.skillE ? "E" : code === k.skillR || code === k.skillR2 ? "R" : null;
  }

  /** 핫바 고른 칸 우클릭 = 사용 (포션 · 장비는 장착) (§15-2 · D20) */
  private useHotbar() {
    const it = this.items.find((i) => i.loc === "hotbar" && i.slot === this.sel);
    if (!it) return;
    if (ITEMS[it.tpl]?.heal && (this.v[12] ?? 0) > 0) return this.toast("포션 재사용 대기 중입니다");
    this.net.send({ t: "item", op: "use", a: ["hotbar", this.sel] });
  }

  private press(code: string) {
    const k = this.settings.keys;
    const digit = /^Digit([1-5])$/.exec(code);
    if (digit) this.sel = Number(digit[1]) - 1;
    else if (code === k.dodge) this.queued.dodge = true;
    else if (code === k.interact) {
      if (this.near?.type === "npc") {
        this.net.send({ t: "use", oid: this.near.id }); // 서버: "말 걸기" 퀘스트 목표
        this.onTalk(String(prop(this.near, "npc")));
        return;
      }
      const place = this.placeOf(this.near);
      if (place) this.onPlace(place);
      else if (this.near) this.net.send({ t: "use", oid: this.near.id });
    }
    else {
      const slot = this.slotOfKey(code);
      if (!slot) return;
      // 차지 스킬: 누르는 동안 모음 (서버에는 모으기 시작을 입력에 실어 알림)
      if (this.skill(slot)?.charge && this.canCast(slot) === null) {
        this.charging = { slot, at: performance.now() };
        this.queued.cs = slot;
        return;
      }
      if (this.settings.castMode === "indicator" && this.you.slots[slot]) this.aiming = slot;
      else this.queue(slot);
    }
  }

  private queue(k: Slot) {
    this.queued.k = k;
    this.queued.fromKey = true;
  }

  private skill(k: Slot): SkillDef | undefined {
    return SKILLS[this.you.slots[k] ?? ""];
  }

  /** 등급 · 레벨을 반영한 수치 (서버와 같은 공식) */
  nums(k: Slot) {
    const sk = this.skill(k)!;
    return skillNums(sk, this.you.prog.skills.find((l) => l.id === sk.id), k === "A" ? 0 : this.stats.cdr);
  }

  /** 커서 근처(24px) · 사거리 안의 적 (서버 skills.ts enemyNear 와 같게) */
  private enemyNear(ax: number, ay: number, range: number) {
    let best: Ent | undefined;
    let bd = 24;
    for (const e of this.ents.values()) {
      if (!e.mob || e.deadMs > 0 || !e.sprite.visible) continue;
      const d = Math.sqrt((e.x - ax) ** 2 + (e.y - ay) ** 2);
      if (d <= bd + 10 && Math.sqrt((e.x - this.me.x) ** 2 + (e.y - this.me.y) ** 2) <= range + 18) { bd = d; best = e; }
    }
    return best;
  }

  /** 커서 근처 아군 (없으면 나) — 아군 돌진 예측 */
  private allyNear(ax: number, ay: number): { x: number; y: number } {
    for (const e of this.ents.values()) if (!e.mob && e.sprite.visible && Math.sqrt((e.x - ax) ** 2 + (e.y - ay) ** 2) <= 30) return e;
    return this.me;
  }

  /** 서버 cast() 검증을 똑같이 (§2-2 낙관적 재생) */
  private canCast(k: Slot): string | null {
    const sk = this.skill(k);
    if (!sk) return k === "R" ? "궁극기는 1차 전직(Lv10) 후 열립니다" : "스킬이 없는 슬롯입니다 (K 스킬창)";
    if (this.kind === "plaza") return "광장은 안전지대라 공격 · 스킬을 쓸 수 없습니다";
    if (this.deadUntil) return QUIET;
    const b = this.blocks();
    if (k === "A" ? b.atk : b.skill) return "지금은 쓸 수 없습니다";
    if (this.me.mv > 0 || this.me.lock > 0) return QUIET;
    if (this.cdLeft(k) > 0) return QUIET;
    const n = this.nums(k);
    const [mp, en] = this.resources();
    if (mp < n.cost.mana) return "마나가 부족합니다";
    if (en < n.cost.energy) return "기력이 부족합니다";
    if (sk.targeting === "target") {
      const [ax, ay] = this.aimPoint();
      if (!this.enemyNear(ax, ay, n.range)) return "대상이 없습니다 — 적에게 마우스를 올리세요";
    }
    return null;
  }

  private blocks() {
    const b = { atk: false, skill: false };
    for (const r of this.myFx) {
      const d = effectDef(r[0])?.block;
      if (d) { b.atk ||= !!d.atk; b.skill ||= !!d.skill; }
    }
    return b;
  }

  /** 마나 · 기력: 서버 값 − 아직 서버가 처리 안 한 내 시전 비용 */
  private resources(): [number, number] {
    let mp = this.v[2];
    let en = this.v[4];
    for (const c of this.castLog) { mp -= c.mana; en -= c.energy; }
    return [Math.max(0, mp), Math.max(0, en)];
  }

  private cdTotal(k: Slot) {
    const sk = this.skill(k);
    if (!sk) return 0;
    return k === "A" ? castMs(sk.cooldownMs, this.stats.atkSpeed) : this.nums(k).cooldownMs;
  }

  /** 남은 쿨(ms): 서버 값(ack 시점)과 아직 처리 안 된 내 시전 중 큰 것 */
  private cdLeft(k: Slot) {
    const nowSeq = this.net.seq - 1;
    let left = (this.v[7 + SLOTS.indexOf(k)] ?? 0) - (nowSeq - this.ackSeq) * SIM_MS;
    for (const c of this.castLog) if (c.k === k) left = Math.max(left, c.cd - (nowSeq - c.seq) * SIM_MS);
    return Math.max(0, left);
  }

  private aimPoint(): [number, number] {
    const z = this.zoom;
    return [Math.round((this.mouse.sx - this.world.x) / z), Math.round((this.mouse.sy - this.world.y) / z)];
  }

  /** 재생: 서버 room.input 과 같은 순서 (구르기 → 시전 → 이동) */
  private replay(m: Mover, i: MoveInput) {
    if (i.dg) tryRoll(m, i);
    if (i.k) {
      const sk = this.skill(i.k);
      if (sk) castMove(m, sk, i.ax!, i.ay!, this.map.collider, this.nums(i.k).range, this.castLog.find((c) => c.seq === i.seq)?.to);
    }
    step(m, i, this.map.collider);
  }

  private playCast(e: Ent, sk: SkillDef | undefined, ax: number, ay: number, now: number) {
    if (!sk) return;
    const kind: Action = sk.targeting === "melee" || sk.targeting === "dash" || (sk.targeting === "self" && sk.category === "physical") ? "attack" : "cast";
    e.act = { kind, until: now + Math.max(280, castMs(sk.castMs || 300, this.stats.atkSpeed)) };
    e.animMs = 0;
    const ang = Math.atan2(ay - e.y, ax - e.x);
    const el = sk.elementInherit ? e.info.el : "none";
    if (sk.targeting === "melee") this.fx.swing(e.x, e.y, ang, sk.range, "#ffffff");
    if (sk.targeting === "dash") this.fx.burst(e.x, e.y - 12, el, 10);
    if (sk.targeting === "ally" || sk.targeting === "skillshot" || sk.targeting === "target") this.fx.burst(e.x, e.y - 30, sk.targeting === "ally" ? "heal" : el, 6);
    if (sk.targeting === "blink") this.fx.burst(e.x, e.y - 12, el === "none" ? "dark" : el, 14);
  }

  // ── 프레임 ──────────────────────────────────────────────────────
  private frame(dt: number) {
    const now = performance.now();
    this.fpsAcc.n++;
    this.fpsAcc.t += dt;
    if (this.fpsAcc.t >= 500) { this.fps = Math.round((this.fpsAcc.n * 1000) / this.fpsAcc.t); this.fpsAcc = { n: 0, t: 0 }; }
    if (this.deadUntil && now > this.deadUntil + 3000) this.deadUntil = 0;

    // 고정 스텝 예측 (D9 · D12). 탭이 멈췄다 돌아오면 밀린 시간은 버림
    this.acc = Math.min(this.acc + dt, SIM_MS * 6);
    while (this.acc >= SIM_MS) {
      this.acc -= SIM_MS;
      const k = this.settings.keys;
      const on = (a: keyof Settings["keys"]) => !this.inputBlocked && this.keys.has(k[a]);
      const input: MoveInput = {
        seq: this.net.seq++,
        mx: (on("right") ? 1 : 0) - (on("left") ? 1 : 0),
        my: (on("down") ? 1 : 0) - (on("up") ? 1 : 0),
        run: on("run") || (k.run === "ShiftLeft" && !this.inputBlocked && this.keys.has("ShiftRight")),
      };
      this.prev = { ...this.me };
      if (this.queued.dodge) {
        input.dg = 1;
        this.queued.dodge = false;
        tryRoll(this.me, input);
      }
      if (this.queued.cs) { input.cs = this.queued.cs; this.queued.cs = null; }
      const slot = this.queued.k ?? (this.mouse.held && !this.inputBlocked ? "A" : null);
      const fromKey = this.queued.fromKey;
      this.queued.k = null;
      this.queued.fromKey = false;
      if (slot) {
        const why = this.canCast(slot);
        if (why === null) {
          const [ax, ay] = this.aimPoint();
          Object.assign(input, { k: slot, ax, ay });
          const sk = this.skill(slot)!;
          const n = this.nums(slot);
          const sx = this.me.x;
          const sy = this.me.y;
          const to = sk.targeting === "ally" && sk.dashSteps ? { ...this.allyNear(ax, ay) } : undefined;
          castMove(this.me, sk, ax, ay, this.map.collider, n.range, to);
          this.castLog.push({ seq: input.seq, k: slot, mana: n.cost.mana, energy: n.cost.energy, cd: this.cdTotal(slot), to });
          this.meSprite.x = sx;
          this.meSprite.y = sy;
          this.playCast(this.meSprite, sk, ax, ay, now);
          if (sk.targeting === "skillshot" && !sk.count) {
            const dx = ax - sx;
            const dy = ay - sy;
            const len = Math.sqrt(dx * dx + dy * dy) || 1;
            const speed = sk.speed! * (1 + this.stats.projSpeed);
            this.fx.projectile(-(input.seq + 1), sx, sy, (dx / len) * speed, (dy / len) * speed, n.range, sk.elementInherit ? this.you.element : sk.sub ? this.you.prog.sub ?? "none" : sk.el ?? "none");
          }
        } else if (fromKey) this.toast(why);
      }
      step(this.me, input, this.map.collider);
      this.pending.push(input);
      this.net.send({ t: "in", ...input });
    }
    const a = this.acc / SIM_MS;
    const me = this.meSprite;
    me.x = this.prev.x + (this.me.x - this.prev.x) * a;
    me.y = this.prev.y + (this.me.y - this.prev.y) * a;
    me.dir = this.me.dir;
    const rolling = this.me.mv > 0 && this.me.rollCd > ROLL.cdSteps;
    if (this.me.mv > 0 && !rolling) this.fx.burst(me.x, me.y - 12, this.you.element, 1); // 돌진 잔상
    me.flags = (rolling ? F_ROLL : 0) | (this.deadUntil ? F_DEAD : 0);
    me.hp = (this.v[0] / Math.max(1, this.v[1])) * 1000;
    me.res = (this.v[2] / Math.max(1, this.v[3])) * 1000;
    this.animate(me, this.me.running ? "run" : this.me.moving ? "walk" : "idle", dt, now);

    // 다른 플레이어 · 몹 — 100ms 전 시점으로 보간
    const rt = now + (this.offset ?? 0) - INTERP_DELAY_MS;
    for (const e of this.ents.values()) {
      const b = e.buf;
      if (!b.length) continue;
      while (b.length >= 2 && b[1].t <= rt) b.shift();
      const s0 = b[0];
      const s1 = b[1];
      if (s1 && s0.t <= rt) {
        const f = (rt - s0.t) / (s1.t - s0.t);
        e.x = s0.x + (s1.x - s0.x) * f;
        e.y = s0.y + (s1.y - s0.y) * f;
      } else { e.x = s0.x; e.y = s0.y; }
      const cur = s1 && s0.t <= rt ? s1 : s0;
      e.dir = cur.dir;
      e.flags = cur.flags;
      e.hp = cur.hp;
      e.res = cur.res;
      e.sprite.visible = e.plate.visible = true;
      e.shadow.visible = this.settings.shadows;
      this.animate(e, cur.flags & F_RUNNING ? "run" : cur.flags & F_MOVING ? "walk" : "idle", dt, now);
    }

    // 바닥 아이템: 둥실 · 주우면 주운 사람에게 날아감
    for (const [id, d] of this.drops) {
      d.t += dt;
      if (d.fly) {
        d.fly.ms += dt;
        const to = this.ent(d.fly.to);
        const k = Math.min(1, d.fly.ms / 180);
        if (to) d.c.position.set(d.x + (to.x - d.x) * k, d.y + (to.y - 16 - d.y) * k);
        d.c.alpha = 1 - k * 0.6;
        if (k >= 1 || !to) { d.c.destroy({ children: true }); this.drops.delete(id); }
      } else d.c.position.set(d.x, Math.round(d.y - 2 - Math.sin(d.t / 300) * 1.5));
    }

    // 물 · 포털 · NPC 애니메이션 (4프레임)
    this.waterMs += dt;
    if (this.waterMs >= 125) { // 물 · 모닥불 · 포털: 8프레임 8fps (예전 4프레임 4fps)
      this.waterMs = 0;
      this.waterFrame = (this.waterFrame + 1) % 64;
      for (const w of this.water) w.s.texture = w.frames[this.waterFrame % w.frames.length];
      for (const w of this.animated) w.s.texture = w.frames[Math.floor(this.waterFrame / (w.slow ?? 1)) % w.frames.length];
    }

    // 카메라: 정수 배율, 정수 좌표 (픽셀 떨림 방지)
    const sw = this.app.screen.width;
    const sh = this.app.screen.height;
    // 화면 배율 ×N: 숫자가 클수록 더 넓게 보임 (×4 = 가장 많이 보임). 확대 배율 = 6 − N
    this.zoom = this.settings.zoom ? 6 - this.settings.zoom : Math.max(2, Math.min(5, Math.round(Math.min(sw / 520, sh / 320))));
    const z = this.zoom;
    const mapW = this.map.w * TILE;
    const mapH = this.map.h * TILE;
    const cx = Math.max(sw / 2 / z, Math.min(mapW - sw / 2 / z, me.x));
    const cy = Math.max(sh / 2 / z, Math.min(mapH - sh / 2 / z, me.y - 16));
    const shake = this.fx.shake > 0 && this.settings.shake ? Math.round((Math.random() - 0.5) * 4) : 0;
    this.world.scale.set(z);
    this.world.position.set(Math.round(sw / 2 - cx * z) + shake, Math.round(sh / 2 - cy * z));

    const toScreen = (x: number, y: number): [number, number] => [Math.round(this.world.x + x * z), Math.round(this.world.y + y * z)];
    this.fx.update(dt, toScreen);
    if (this.realism.enabled) {
      const sprites = [this.meSprite.sprite, ...[...this.ents.values()].map((e) => e.sprite), ...this.animated.filter((a) => a.slow).map((a) => a.s)];
      this.realism.update({ zoom: z, wx: this.world.x, wy: this.world.y, sw, sh }, this.lightSrc, sprites, { x: me.x, y: me.y - 8 });
    }
    for (const l of this.labels) l.t.position.set(...toScreen(l.x, l.y));
    const np = this.settings.nameplates;
    for (const e of [me, ...this.ents.values()]) {
      e.plate.position.set(...toScreen(e.x, e.y - (e.mob ? (PLATE_H[e.info.mob!] ?? 24) : PLAYER_PLATE_H)));
      if (e !== me && !e.mob) e.plate.visible = e.sprite.visible && np === "all";
      this.drawBars(e);
    }

    // 상호작용 대상 · 조준 표시
    let near: TiledObject | null = null;
    for (const o of this.interactables) if (distToObj(o, this.me.x, this.me.y) <= USE_RANGE) near = o;
    this.near = near;
    this.indicator.clear();
    const aimSlot = this.aiming ?? this.charging?.slot;
    const aimSk = aimSlot && this.skill(aimSlot);
    if (aimSk && aimSk.range > 0) {
      const n = this.nums(aimSlot!);
      const [ax, ay] = this.aimPoint();
      const dx = ax - me.x;
      const dy = ay - me.y;
      const len = Math.sqrt(dx * dx + dy * dy) || 1;
      const r = Math.min(len, n.range);
      this.indicator.circle(me.x, me.y, n.range).stroke({ color: 0xffffff, width: 1, alpha: 0.35 });
      if (aimSk.targeting === "ground") this.indicator.circle(me.x + (dx / len) * r, me.y + (dy / len) * r, n.radius).stroke({ color: 0xffe14d, width: 1, alpha: 0.8 });
      else this.indicator.moveTo(me.x, me.y - 6).lineTo(me.x + (dx / len) * r, me.y - 6 + (dy / len) * r).stroke({ color: 0xffe14d, width: 2, alpha: 0.8 });
    }
    if (this.charging) {
      const k = Math.min(1, (performance.now() - this.charging.at) / (this.skill(this.charging.slot)?.charge?.ms ?? 1000));
      this.indicator.circle(me.x, me.y - 14, 10 + 10 * k).stroke({ color: k >= 1 ? 0xffd27a : 0xffffff, width: 2, alpha: 0.5 + 0.5 * k });
    }
  }

  private drawBars(e: Ent) {
    const key = `${Math.round(e.hp / 20)}:${Math.round(e.res / 20)}`;
    if (key === e.drawn) return;
    e.drawn = key;
    const w = e.mob ? 26 : 32;
    const g = e.bars.clear();
    g.rect(-w / 2 - 1, -5, w + 2, e.mob ? 5 : 7).fill(0x1b1420);
    g.rect(-w / 2, -4, (w * Math.max(0, e.hp)) / 1000, 3).fill(e.mob ? 0xe5484d : 0x4cc764);
    if (!e.mob) g.rect(-w / 2, -1, (w * Math.max(0, e.res)) / 1000, 2).fill(0x2f7bff);
  }

  private animate(e: Ent, base: Action, dt: number, now: number) {
    e.animMs += dt;
    e.flash = Math.max(0, e.flash - dt);
    const dead = !!(e.flags & F_DEAD) || e.deadMs > 0;
    if (dead) e.deadMs += dt;
    // 몹: 좌우 2방향 + 이동/대기 4프레임 · 공격 시 앞으로 튀어나감 · 쓰러지면 가라앉으며 사라짐
    if (e.mob) {
      if (e.dir >= 1 && e.dir <= 3) e.face = 0;
      else if (e.dir >= 5) e.face = 1;
      const f = Math.floor((e.animMs / 1000) * (base === "idle" ? 6 : 14)) % 8;
      e.sprite.texture = e.frames[e.face][f];
      let ox = 0;
      let oy = 0;
      if (e.lunge) {
        e.lunge.ms += dt;
        const k = Math.sin((Math.min(e.lunge.ms, 250) / 250) * Math.PI) * 5;
        ox = e.lunge.dx * k;
        oy = e.lunge.dy * k;
        if (e.lunge.ms >= 250) e.lunge = null;
      }
      if (e.flags & F_CAST && !e.lunge) ox = Math.round(Math.sin(now / 30));
      e.sprite.position.set(Math.round(e.x + ox), Math.round(e.y + oy + (dead ? Math.min(6, e.deadMs / 100) : 0)));
      e.sprite.alpha = dead ? Math.max(0, 1 - e.deadMs / 800) : 1;
      e.sprite.tint = e.flash > 0 ? 0xff9090 : 0xffffff;
      e.sprite.zIndex = e.y;
      e.shadow.position.set(e.x, e.y - 1);
      e.plate.alpha = dead ? 0 : 1;
      return;
    }
    // 플레이어: 공격 · 시전 동작이 끝날 때까지 우선
    let action = base;
    if (e.act && now < e.act.until) action = e.act.kind;
    else e.act = null;
    if (action !== e.action) { e.action = action; e.animMs = 0; }
    // 회전: 2단계 이상 바뀌면 중간 방향을 거쳐 돎 (§8-2)
    e.turnMs += dt;
    if (e.shown !== e.dir && e.turnMs >= 40) {
      e.turnMs = 0;
      const diff = (e.dir - e.shown + 8) % 8;
      e.shown = (e.shown + (diff <= 4 ? 1 : 7)) % 8;
    }
    const fps = ACTION_FPS[action] * (action === "attack" ? Math.max(1, this.stats.atkSpeed / 100) : 1);
    const f = action === "attack" || action === "cast" ? Math.min(FRAMES - 1, Math.floor((e.animMs / 1000) * fps)) : Math.floor((e.animMs / 1000) * fps) % FRAMES;
    const rolling = !!(e.flags & F_ROLL);
    e.sprite.texture = e.frames[e.shown][ACTIONS.indexOf(rolling || dead ? "idle" : action) * FRAMES + (rolling || dead ? 0 : f)];
    // 구르기: 몸을 한 바퀴 (90° 단위라 픽셀이 깨지지 않음) · 사망: 옆으로 누움
    e.sprite.rotation = dead ? -Math.PI / 2 : rolling ? (Math.floor(e.animMs / 75) % 4) * (Math.PI / 2) * (e.dir >= 5 ? -1 : 1) : 0;
    e.sprite.anchor.set(0.5, rolling ? 0.6 : dead ? 0.75 : CHAR_FEET / CHAR_H);
    e.sprite.position.set(e.x, e.y - (rolling ? 9 : dead ? 3 : 0));
    e.sprite.alpha = dead ? 0.75 : e.fx.some((r) => r[0] === "stealth") ? 0.4 : 1;
    e.sprite.tint = e.flash > 0 ? 0xff9090 : dead ? 0xb0a8c0 : 0xffffff;
    e.sprite.zIndex = e.y;
    e.shadow.position.set(e.x, e.y - 1);
  }

  hud(): HudState {
    const now = performance.now();
    const [mp, en] = this.resources();
    const cds: HudState["cds"] = {};
    for (const k of SLOTS) {
      const sk = this.skill(k);
      if (!sk) continue;
      const c = this.nums(k).cost;
      cds[k] = [this.cdLeft(k), this.cdTotal(k), mp >= c.mana && en >= c.energy];
    }
    const age = now - this.myFxAt;
    return {
      fps: this.fps,
      x: this.meSprite.x,
      y: this.meSprite.y,
      dir: this.me.dir,
      kind: this.kind,
      stamina: this.me.stamina,
      staminaMax: this.me.staminaMax,
      exhausted: this.me.exhausted,
      others: [...this.ents.values()].filter((e) => e.sprite.visible && !(e.flags & F_DEAD)).map((e) => ({ x: e.x, y: e.y, mob: e.mob })),
      v: [this.v[0], this.v[1], mp, this.v[3], en, this.v[5], this.v[6]],
      cds,
      fx: this.myFx.map((r) => [r[0], Math.max(0, r[1] - age), r[2], r[3], r[4]] as FxRow).filter((r) => r[1] > 0 || r[3] === 0),
      dead: this.deadUntil ? Math.max(0, this.deadUntil - now) : 0,
      hint: !this.near ? null : this.near.type === "portal" ? `${josa(this.near.name, "으로/로")} 이동` : this.near.type === "npc" ? `${this.near.name}에게 말 걸기` : `${this.near.name} 열기`,
      sel: this.sel,
      potion: this.v[12] ?? 0,
      charge: this.charging ? Math.min(1, (now - this.charging.at) / (this.skill(this.charging.slot)?.charge?.ms ?? 1000)) : -1,
    };
  }
}

let shadow: Texture | null = null;
const shadowTex = () => (shadow ??= Texture.from(shadowCanvas()));

function glowCanvas() {
  const c = Object.assign(document.createElement("canvas"), { width: 64, height: 64 });
  const ctx = c.getContext("2d")!;
  const g = ctx.createRadialGradient(32, 32, 2, 32, 32, 32);
  g.addColorStop(0, "rgba(255,210,122,0.45)");
  g.addColorStop(1, "rgba(255,210,122,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  return c;
}

/** F 로 여는 창 (P4 성장 · P5 경제) */
export type { Place } from "./npcs";
const PLACE: Record<string, Place> = { mailbox: "mail", tent_shop: "shop", tent_market: "market", anvil: "forge", workbench: "alchemy", board: "board" };
