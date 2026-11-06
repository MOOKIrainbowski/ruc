import { Application, Container, Rectangle, Sprite, Text, Texture, TextureSource } from "pixi.js";
import { CHAR_H, CHAR_W, INTERP_DELAY_MS, SIM_MS, TILE } from "../shared/constants";
import type { Appearance } from "../shared/data/appearance";
import { prop, type GameMap } from "../shared/map";
import { step, type MoveInput, type Mover } from "../shared/movement";
import { F_MOVING, F_RUNNING, type EntityInfo, type S2C, type You } from "../shared/protocol";
import { ANIMATED, TILE_NAMES, gid } from "../shared/tiles";
import { ACTIONS, ACTION_FPS, APPRENTICE, FRAMES, characterSheet, shadowCanvas, type Action, type Outfit } from "./art/character";
import { Px } from "./art/px";
import { TILE_COLOR, VARIANTS, objectFrames, tileAtlas } from "./art/world";
import type { Net } from "./net";
import type { Settings } from "./settings";

TextureSource.defaultOptions.scaleMode = "nearest";

/** NPC 외형 (§19-1) */
const NPC_LOOK: Record<string, { ap: Appearance; outfit: Outfit }> = {
  lumi: { ap: { hair: 5, hairColor: 6, skin: 0, eyes: 1 }, outfit: { shirt: ["#fff4b0", "#f2d27a", "#c9a24a"], pants: ["#a3d95f", "#6fb840", "#4b902f"], shoe: "#6d513b" } },
  volt: { ap: { hair: 1, hairColor: 3, skin: 2, eyes: 2 }, outfit: { shirt: ["#8a8f99", "#6f7680", "#4f555e"], pants: ["#6d513b", "#523b2a", "#3a2a1e"], shoe: "#2f2620" } },
  mir: { ap: { hair: 2, hairColor: 4, skin: 1, eyes: 3 }, outfit: { shirt: ["#c8a0f0", "#9B5DE5", "#6b3fa0"], pants: ["#6b3fa0", "#4e2d78", "#36204f"], shoe: "#36204f" } },
  sera: { ap: { hair: 3, hairColor: 1, skin: 1, eyes: 0 }, outfit: { shirt: ["#ff9a9e", "#E5484D", "#a8323a"], pants: ["#ddd3c3", "#bdb2a1", "#9e917c"], shoe: "#4a3428" } },
  owen: { ap: { hair: 0, hairColor: 7, skin: 0, eyes: 0 }, outfit: { shirt: ["#7fb0ff", "#3b6fd6", "#2a4f9e"], pants: ["#ddd3c3", "#bdb2a1", "#9e917c"], shoe: "#4a3428" } },
  pip: { ap: { hair: 4, hairColor: 2, skin: 0, eyes: 1 }, outfit: { shirt: ["#7fd0ff", "#3BA7FF", "#2a78b8"], pants: ["#94735a", "#6d513b", "#523b2a"], shoe: "#4a3428" } },
  dario: { ap: { hair: 0, hairColor: 0, skin: 2, eyes: 2 }, outfit: { shirt: ["#d9b07a", "#b08a5a", "#806240"], pants: ["#6d513b", "#523b2a", "#3a2a1e"], shoe: "#2f2620" } },
};

type Sample = { t: number; x: number; y: number; dir: number; flags: number };
type Ent = {
  info: EntityInfo;
  sprite: Sprite;
  shadow: Sprite;
  label: Text;
  frames: Texture[][];
  buf: Sample[];
  x: number;
  y: number;
  dir: number; // 목표 방향
  shown: number; // 화면에 보이는 방향 (회전 보간)
  turnMs: number;
  action: Action;
  animMs: number;
};

export type HudState = {
  fps: number;
  x: number;
  y: number;
  dir: number;
  stamina: number;
  staminaMax: number;
  others: { x: number; y: number }[];
};

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

const LABEL_STYLE = { fontFamily: "Galmuri11", fontSize: 11, stroke: { color: "#1b1420", width: 3 }, align: "center" as const };

/** 지도 한 장 (미니맵 · 전체 지도) — 타일 1칸 = 1px */
export function mapOverview(map: GameMap): HTMLCanvasElement {
  const p = new Px(map.w, map.h);
  for (let i = 0; i < map.w * map.h; i++) {
    const g = map.layers.decor_below[i] || map.layers.water[i] || map.layers.ground[i];
    p.set(i % map.w, Math.floor(i / map.w), TILE_COLOR[TILE_NAMES[g - 1]] ?? "#000000");
  }
  for (const o of map.objects) {
    const c = o.type === "building" ? "#C8643B" : o.type === "tree" ? "#4f8a2b" : null;
    if (c) p.rect(Math.floor((o.x - o.width / 2) / TILE), Math.floor((o.y - o.height / 2) / TILE), Math.max(1, o.width / TILE), Math.max(1, o.height / TILE / 2), c);
  }
  return p.toCanvas();
}

export class Game {
  app = new Application();
  world = new Container();
  entityLayer = new Container({ sortableChildren: true });
  screenLayer = new Container();
  map: GameMap;
  net: Net;
  you: You;
  settings: Settings;
  me: Mover;
  prev: Mover;
  meSprite!: Ent;
  ents = new Map<number, Ent>();
  pending: MoveInput[] = [];
  seq = 0;
  acc = 0;
  keys = new Set<string>();
  inputBlocked = false;
  zoom = 3;
  offset: number | null = null;
  water: { s: Sprite; frames: Texture[] }[] = [];
  animated: { s: Sprite; frames: Texture[] }[] = [];
  glows: Sprite[] = [];
  waterFrame = 0;
  waterMs = 0;
  fps = 0;
  private fpsAcc = { n: 0, t: 0 };
  private disposers: (() => void)[] = [];

  constructor(map: GameMap, net: Net, you: You, me: Mover, settings: Settings) {
    this.map = map;
    this.net = net;
    this.you = you;
    this.me = me;
    this.prev = { ...me };
    this.settings = settings;
  }

  async start(el: HTMLElement, players: EntityInfo[]) {
    await this.app.init({ resizeTo: el, background: "#0a1207", antialias: false, preference: "webgl", roundPixels: true });
    this.app.canvas.style.imageRendering = "pixelated";
    el.appendChild(this.app.canvas);
    await document.fonts.load("11px Galmuri11").catch(() => {});

    this.buildMap();
    this.app.stage.addChild(this.world, this.screenLayer);
    this.meSprite = this.makeEnt({ id: this.you.id, name: this.you.nickname, ap: this.you.appearance, el: this.you.element, lv: this.you.level }, true);
    for (const p of players) this.addEnt(p);

    const down = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.closest?.("input, textarea, select")) return;
      this.keys.add(e.code);
      if (e.code === "Tab" || e.code === "Space") e.preventDefault();
    };
    const up = (e: KeyboardEvent) => this.keys.delete(e.code);
    const blur = () => this.keys.clear();
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("blur", blur);
    this.disposers.push(() => { window.removeEventListener("keydown", down); window.removeEventListener("keyup", up); window.removeEventListener("blur", blur); });

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
    this.world.addChild(bake(layers.ground));
    const waterLayer = new Container();
    const animGids = new Set(ANIMATED.map(gid));
    for (let i = 0; i < w * h; i++) {
      const g = layers.water[i];
      if (!animGids.has(g)) continue;
      const frames = Array.from({ length: VARIANTS }, (_, v) => tileTex(g, v));
      const s = new Sprite(frames[0]);
      s.position.set((i % w) * TILE, Math.floor(i / w) * TILE);
      waterLayer.addChild(s);
      this.water.push({ s, frames });
    }
    this.world.addChild(waterLayer, bake(layers.decor_below), this.entityLayer);
    if (layers.decor_above.some((g) => g)) this.world.addChild(bake(layers.decor_above));

    const glowTex = Texture.from(glowCanvas());
    for (const o of this.map.objects) {
      if (o.type === "spawn") continue;
      if (o.type === "npc") {
        const look = NPC_LOOK[String(prop(o, "npc"))];
        const s = new Sprite(sheetFrames(look.ap, look.outfit)[0][0]);
        s.anchor.set(0.5, 60 / CHAR_H);
        s.position.set(o.x, o.y - 2);
        s.zIndex = o.y;
        this.entityLayer.addChild(s);
        this.animated.push({ s, frames: sheetFrames(look.ap, look.outfit)[0].slice(0, FRAMES) });
        this.label(`${o.name}\n${prop(o, "role")}`, o.x, o.y - 56, "#FFE14D");
        continue;
      }
      const frames = objectFrames(o).map((c) => Texture.from(c));
      const s = new Sprite(frames[0]);
      s.anchor.set(0.5, 1);
      s.position.set(o.x, o.y);
      s.zIndex = o.type === "portal" ? o.y - o.height : o.y;
      this.entityLayer.addChild(s);
      if (frames.length > 1) this.animated.push({ s, frames });
      if (o.type === "lamp") {
        const g = new Sprite(glowTex);
        g.anchor.set(0.5);
        g.position.set(o.x, o.y - 26);
        g.blendMode = "add";
        g.zIndex = 1e6;
        this.entityLayer.addChild(g);
        this.glows.push(g);
      }
      if (["portal", "tent_shop", "tent_market", "building", "mailbox", "board", "workbench", "anvil"].includes(o.type)) {
        this.label(o.name, o.x, o.y - o.height - 2, o.type === "portal" ? "#d6b3ff" : "#ffffff");
      }
    }
  }

  private labels: { t: Text; x: number; y: number }[] = [];
  private label(text: string, x: number, y: number, fill: string) {
    const t = new Text({ text, style: { ...LABEL_STYLE, fill, fontSize: 11 } });
    t.anchor.set(0.5, 1);
    this.screenLayer.addChild(t);
    this.labels.push({ t, x, y });
  }

  // ── 엔티티 ───────────────────────────────────────────────────────
  private makeEnt(info: EntityInfo, isMe = false): Ent {
    const frames = sheetFrames(info.ap);
    const sprite = new Sprite(frames[0][0]);
    sprite.anchor.set(0.5, 60 / CHAR_H);
    const shadow = new Sprite(shadowTex());
    shadow.anchor.set(0.5);
    shadow.zIndex = -1e6;
    const label = new Text({ text: info.name, style: { ...LABEL_STYLE, fill: isMe ? "#ffffff" : "#8fdcff" } });
    label.anchor.set(0.5, 1);
    this.entityLayer.addChild(shadow, sprite);
    this.screenLayer.addChild(label);
    const x = isMe ? this.me.x : 0;
    const y = isMe ? this.me.y : 0;
    return { info, sprite, shadow, label, frames, buf: [], x, y, dir: 0, shown: 0, turnMs: 0, action: "idle", animMs: 0 };
  }

  addEnt(info: EntityInfo) {
    if (info.id === this.you.id || this.ents.has(info.id)) return;
    const e = this.makeEnt(info);
    e.sprite.visible = e.shadow.visible = e.label.visible = false; // 첫 스냅샷 전까지 숨김
    this.ents.set(info.id, e);
  }

  removeEnt(id: number) {
    const e = this.ents.get(id);
    if (!e) return;
    e.sprite.destroy();
    e.shadow.destroy();
    e.label.destroy();
    this.ents.delete(id);
  }

  onMessage(m: S2C) {
    if (m.t === "spawn") this.addEnt(m.e);
    else if (m.t === "despawn") this.removeEnt(m.id);
    else if (m.t === "s") {
      const now = performance.now();
      const sample = m.st - now;
      this.offset = this.offset === null ? sample : this.offset + (sample - this.offset) * 0.05;
      // 보정 (§2-2): 서버가 처리한 입력 이후의 것만 다시 재생
      this.pending = this.pending.filter((i) => i.seq > m.ack.seq);
      const fixed = { ...m.ack.m };
      for (const i of this.pending) step(fixed, i, this.you.ms, this.map.collider);
      if (Math.abs(fixed.x - this.me.x) > 24 || Math.abs(fixed.y - this.me.y) > 24) this.prev = { ...fixed }; // 크게 어긋나면 순간이동
      this.me = fixed;
      for (const [id, x, y, dir, flags] of m.e) {
        const e = this.ents.get(id);
        if (!e) continue;
        e.buf.push({ t: m.st, x, y, dir, flags });
        if (e.buf.length > 30) e.buf.shift();
      }
    }
  }

  // ── 프레임 ──────────────────────────────────────────────────────
  private frame(dt: number) {
    this.fpsAcc.n++;
    this.fpsAcc.t += dt;
    if (this.fpsAcc.t >= 500) { this.fps = Math.round((this.fpsAcc.n * 1000) / this.fpsAcc.t); this.fpsAcc = { n: 0, t: 0 }; }

    // 고정 스텝 예측 (D9). 탭이 멈췄다 돌아오면 밀린 시간은 버림
    this.acc = Math.min(this.acc + dt, SIM_MS * 6);
    while (this.acc >= SIM_MS) {
      this.acc -= SIM_MS;
      const k = this.settings.keys;
      const on = (a: keyof Settings["keys"]) => !this.inputBlocked && this.keys.has(k[a]);
      const input: MoveInput = {
        seq: this.seq++,
        mx: (on("right") ? 1 : 0) - (on("left") ? 1 : 0),
        my: (on("down") ? 1 : 0) - (on("up") ? 1 : 0),
        run: on("run") || (k.run === "ShiftLeft" && !this.inputBlocked && this.keys.has("ShiftRight")),
      };
      this.prev = { ...this.me };
      step(this.me, input, this.you.ms, this.map.collider);
      this.pending.push(input);
      this.net.send({ t: "in", ...input });
    }
    const a = this.acc / SIM_MS;
    const me = this.meSprite;
    me.x = this.prev.x + (this.me.x - this.prev.x) * a;
    me.y = this.prev.y + (this.me.y - this.prev.y) * a;
    me.dir = this.me.dir;
    this.animate(me, this.me.running ? "run" : this.me.moving ? "walk" : "idle", dt);

    // 다른 플레이어 — 100ms 전 시점으로 보간
    const rt = performance.now() + (this.offset ?? 0) - INTERP_DELAY_MS;
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
      e.sprite.visible = e.label.visible = true;
      e.shadow.visible = this.settings.shadows;
      this.animate(e, cur.flags & F_RUNNING ? "run" : cur.flags & F_MOVING ? "walk" : "idle", dt);
    }

    // 물 · 포털 · NPC 애니메이션 (4프레임)
    this.waterMs += dt;
    if (this.waterMs >= 250) {
      this.waterMs = 0;
      this.waterFrame = (this.waterFrame + 1) % 4;
      for (const w of this.water) w.s.texture = w.frames[this.waterFrame];
      for (const w of this.animated) w.s.texture = w.frames[this.waterFrame % w.frames.length];
    }

    // 카메라: 정수 배율, 정수 좌표 (픽셀 떨림 방지)
    const sw = this.app.screen.width;
    const sh = this.app.screen.height;
    this.zoom = this.settings.zoom || Math.max(2, Math.min(5, Math.round(Math.min(sw / 520, sh / 320))));
    const z = this.zoom;
    const mapW = this.map.w * TILE;
    const mapH = this.map.h * TILE;
    const cx = Math.max(sw / 2 / z, Math.min(mapW - sw / 2 / z, me.x));
    const cy = Math.max(sh / 2 / z, Math.min(mapH - sh / 2 / z, me.y - 16));
    this.world.scale.set(z);
    this.world.position.set(Math.round(sw / 2 - cx * z), Math.round(sh / 2 - cy * z));

    const toScreen = (x: number, y: number): [number, number] => [Math.round(this.world.x + x * z), Math.round(this.world.y + y * z)];
    for (const l of this.labels) l.t.position.set(...toScreen(l.x, l.y));
    const np = this.settings.nameplates;
    for (const e of [me, ...this.ents.values()]) {
      e.label.position.set(...toScreen(e.x, e.y - 58));
      if (e !== me) e.label.visible = e.sprite.visible && np === "all";
    }
  }

  private animate(e: Ent, action: Action, dt: number) {
    if (action !== e.action) { e.action = action; e.animMs = 0; }
    e.animMs += dt;
    // 회전: 2단계 이상 바뀌면 중간 방향을 거쳐 돎 (§8-2)
    e.turnMs += dt;
    if (e.shown !== e.dir && e.turnMs >= 40) {
      e.turnMs = 0;
      const diff = (e.dir - e.shown + 8) % 8;
      e.shown = (e.shown + (diff <= 4 ? 1 : 7)) % 8;
    }
    const f = Math.floor((e.animMs / 1000) * ACTION_FPS[action]) % FRAMES;
    e.sprite.texture = e.frames[e.shown][ACTIONS.indexOf(action) * FRAMES + f];
    e.sprite.position.set(e.x, e.y);
    e.sprite.zIndex = e.y;
    e.shadow.position.set(e.x, e.y - 1);
  }

  hud(): HudState {
    return {
      fps: this.fps,
      x: this.meSprite.x,
      y: this.meSprite.y,
      dir: this.me.dir,
      stamina: this.me.stamina,
      staminaMax: this.me.staminaMax,
      others: [...this.ents.values()].filter((e) => e.sprite.visible).map((e) => ({ x: e.x, y: e.y })),
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
