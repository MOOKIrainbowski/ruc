import { Application, CanvasSource, Container, CullerPlugin, Graphics, Rectangle, Sprite, Text, Texture, TextureSource, UPDATE_PRIORITY, extensions } from "pixi.js";
import { castMs, type FullStats } from "../shared/combat";
import { CHAR_FEET, CHAR_H, CHAR_W, INTERP_DELAY_MS, SIM_MS, SNAP_MS, TILE, type RoomKind } from "../shared/constants";
import type { Appearance } from "../shared/data/appearance";
import { effectDef } from "../shared/data/effects";
import { ITEMS, LOCS, RARITY, basicOf, lookOf, type Item, type Rarity, GATHER, type GatherRow } from "../shared/data/items";
import { JOBS, LINES, type LineId } from "../shared/data/jobs";
import { GRADES } from "../shared/data/mobs";
import { SKILLS, SLOTS, type SkillDef, type Slot } from "../shared/data/skills";
import { ROLL } from "../shared/data/stats";
import { USE_RANGE, distToObj, heightKind, prop, type GameMap, type TiledObject } from "../shared/map";
import { castMove, dir8, step, tryRoll, type MoveInput, type Mover } from "../shared/movement";
import { skillNums } from "../shared/progress";
import {
  F_CAST, F_DEAD, F_MOVING, F_ROLL, F_RUNNING, H_COUNTER, H_CRIT, H_DOT, H_HEAL, H_IMMUNE, H_MISS, H_RESIST,
  type DropRow, type EntityInfo, type Ev, type FxRow, type S2C, type You,
} from "../shared/protocol";
import { josa } from "../shared/josa";
import { FOUNTAIN_R, FOUNTAIN_SPOTS, QUESTS, type QState } from "../shared/data/quests";
import { ANIMATED, TILE_NAMES, gid } from "../shared/tiles";
import { ACTIONS, ACTION_FPS, APPRENTICE, FRAMES, characterSheet, outfitOf, shadowCanvas, type Action, type Outfit } from "./art/character";
import { effectIcon } from "./art/icons";
import { itemIcon, gatherNode } from "./art/items";
import { MOB_PLATE, mobFrames } from "./art/mobs";
import { PINGS, PING, PING_WHEEL, TITLES, type PingKind } from "../shared/data/party";
import { Px } from "./art/px";
import { hash } from "./art/px";
import { cliff, steps } from "./art/terrain";
import { setTreeBiome } from "./art/trees";
import { DECAL_VARIANTS, R, TILE_COLOR, VARIANTS, contactShadow, decalSheet, objectFrames, tileAtlas } from "./art/world";
import { Fx, elColor } from "./fx";
import { Realism, type Light } from "./realistic";
import type { Net } from "./net";
import { NPC_LOOK, NPC_PLACE, type Place } from "./npcs";
import type { Settings } from "./settings";
import { t } from "./i18n";
import { sfx } from "./sound";

TextureSource.defaultOptions.scaleMode = "nearest";
// 화면 밖 컬링 (§29): cullable 인 것은 화면 밖이면 그리지 않음 — Pixi 기본 기능
extensions.add(CullerPlugin);

/** 네임 플레이트 높이 (발밑에서 머리 위까지 px) — 몹은 art/mobs.ts MOB_PLATE */
const PLATE_H = MOB_PLATE;
const PLAYER_PLATE_H = 37;
/** 마우스 휠 배율 범위 (작을수록 넓게 보임) */
const ZOOM_MIN = 1.25;
const ZOOM_MAX = 7;
/** 닉네임 색 (§23-2): 나 흰색 · 파티원 초록 · 일반 하늘색 · 적(결투 상대 · 결투장) 빨강 */
const NAME_COLOR = { me: "#ffffff", party: "#7CFC6A", other: "#8fdcff", foe: "#ff6b6b" };

/** 시전 불가지만 안내는 안 띄움 (쿨 · 다른 동작 중) */
const QUIET = "";

type Sample = { t: number; x: number; y: number; dir: number; flags: number; hp: number; res: number; en: number; hpMax: number };
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
  res: number; // 마나 천분율
  en: number; // 기력 천분율
  hpMax: number; // 눈금 (100 마다 작은 칸 · 1000 마다 굵은 칸)
  /** 깎인 체력 잔상(천분율) · 마지막으로 체력이 그대로이거나 오른 시각 */
  lag: number;
  lagAt: number;
  drawn: string;
  fx: FxRow[];
  fxAt: number;
  flash: number;
  lunge: { ms: number; dx: number; dy: number } | null;
  /** 공격 · 시전 동작: 시작 시각 ~ 끝 시각에 8프레임을 맞춰 끝까지 재생 (예전엔 공속 fps 로 돌려 회수 동작이 잘렸음) */
  act: { kind: Action; until: number; from: number } | null;
  /** 타격감 (2026-11-14): 맞으면 뒤로 밀림 · 히트스톱(이 시간 동안 동작이 멈춤) · 대시 잔상 간격 */
  knock: { ms: number; dx: number; dy: number } | null;
  stop: number;
  trail: number;
  /** 내가 마지막으로 때린 시각 (처치 연출) */
  hitByMe: number;
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
  others: { x: number; y: number; mob: boolean; party: boolean; foe: boolean; name: string; lv: number; boss: boolean }[];
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
  /** F3 디버그 오버레이 (§29): 프레임 처리 ms · 프레임 간격 ms · 엔티티 · 화면에 그린 것 · RTT · 서버 틱 ms · 하향 KB/s */
  dbg: { cpu: number; dt: number; ents: number; drawn: number; rtt: number; tick: number; kbps: number } | null;
  /** P7: 핑(미니맵) · 핑 휠(화면 좌표 · 고른 칸) · 던전 관전 · 부활할 곳 · 보스 HP 천분율(−1 = 없음) · 결투 시작까지 ms */
  marks: { x: number; y: number; k: PingKind }[];
  /** 정찰자 파티원이 본 몹 (5초) */
  spots: { x: number; y: number; until: number }[];
  wheel: { sx: number; sy: number; sel: number } | null;
  ghost: boolean;
  deadKind: string;
  bossHp: number;
  duelIn: number;
  /** 퀘스트 안내: 갈 곳 이름 · 거리(칸) · 방향(8방향) — 추적 창에 표시 */
  goal: { label: string; tiles: number; dir: number; x: number; y: number } | null;
};

/** 퀘스트 목표 지점 (월드 px) · 강조할 오브젝트 · 엔티티 */
type Goal = { x: number; y: number; label: string; r: number; obj?: TiledObject; ent?: Ent };
const SPOT_NAME = ["북", "동", "남", "서"];

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
  /** 퀘스트 안내: 바닥 화살표 줄(엔티티 아래) · 목표 테두리 강조 + 머리 위 화살표(엔티티 위) */
  questLine = new Graphics();
  questMark = new Graphics();
  private quests: { active: QState[]; reach: number } = { active: [], reach: 0 };
  private spotLabels: Text[] = [];
  private goal: Goal | null = null;
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
  zoom = 0;
  /** 마우스 휠 배율 (0 = 설정 · 자동을 따름). 부드럽게 따라감 */
  zoomWant = (() => { try { const z = Number(localStorage.getItem("rpg.zoom")); return z >= ZOOM_MIN && z <= ZOOM_MAX ? z : 0; } catch { return 0; } })();
  /** 서버 보정과 예측의 작은 차이 — 화면에서만 서서히 줄임 */
  private err: [number, number] = [0, 0];
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
  /** F3 디버그: 켜짐 · 프레임 처리 시간(이동 평균) · 프레임 간격 · 대역폭 측정 */
  debug = false;
  private cpuMs = 0;
  private dtMs = 16;
  private frameStart = 0;
  private bw = { bytes: 0, at: 0, kbps: 0 };
  // P7: 파티원 · 결투 상대 (엔티티 id) · 핑 · 던전 관전 · 보스
  partyIds = new Set<number>();
  inParty = false;
  duelFoes = new Set<number>();
  duelAt = 0;
  ghost = false;
  deadKind = "";
  bossId = 0;
  wheel: { sx: number; sy: number; wx: number; wy: number } | null = null;
  pings: { c: Container; x: number; y: number; k: PingKind; until: number }[] = [];
  spots: { x: number; y: number; until: number }[] = [];
  /** 화면 가운데 큰 글씨 (보스 페이즈 · 던전 안내 · 결투) */
  onBanner: (text: string, ms: number) => void = () => {};
  /** 채팅 창에 시스템 줄 (파티 드롭 분배 — §21-2 "파티 채팅에 결과 표시") */
  onChat: (ch: "party" | "system", text: string) => void = () => {};
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

  /** 2.5칸 안의 캘 수 있는 채집 지점 id */
  private nearNode(): number | null {
    let best: number | null = null;
    let bd = 24;
    for (const [id, n] of this.nodes) {
      const d = Math.hypot(n.x - this.me.x, n.y - this.me.y);
      if (n.on && d < bd) { bd = d; best = id; }
    }
    return best;
  }

  /** 채집 지점 (P13) */
  private nodes = new Map<number, { s: Sprite; kind: string; x: number; y: number; on: boolean }>();
  private setNode(id: number, on: boolean) {
    const n = this.nodes.get(id);
    if (!n) return;
    n.on = on;
    n.s.texture = Texture.from(gatherNode(n.kind, !on));
  }

  async start(el: HTMLElement, ents: EntityInfo[], fx: [number, FxRow[]][], drops: DropRow[], nodes: GatherRow[] = []) {
    await this.app.init({ resizeTo: el, background: "#0a1207", antialias: false, preference: "webgl", roundPixels: true });
    this.app.canvas.style.imageRendering = "pixelated";
    el.appendChild(this.app.canvas);
    await document.fonts.load("11px Galmuri11").catch(() => {});

    this.buildMap();
    this.app.stage.addChild(this.world, this.screenLayer);
    this.realism = new Realism(this.app, this.world, this.app.stage, this.entityLayer, this.screenLayer);
    for (const s of this.staticSprites) this.realism.addStatic(s);
    this.meSprite = this.makeEnt({ id: this.you.id, name: this.you.nickname, ap: this.you.appearance, look: lookOf(this.items), el: this.you.element, lv: this.you.level, jb: this.you.prog.job ?? this.you.prog.line ?? "", tt: this.you.tt, gd: this.you.gd, nt: this.you.nt, ...(this.you.prog.awake ? { aw: 1 as const } : {}) }, true);
    for (const e of ents) this.addEnt(e);
    for (const [id, rows] of fx) this.setFx(id, rows);
    for (const d of drops) this.addDrop(d);
    for (const [id, kind, x, y, on] of nodes) {
      const s = new Sprite(Texture.from(gatherNode(kind, !on)));
      s.anchor.set(0.5, 0.85);
      s.position.set(x, y);
      s.zIndex = y - 2;
      this.entityLayer.addChild(s);
      this.nodes.set(id, { s, kind, x, y, on: !!on });
    }

    const down = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.closest?.("input, textarea, select")) return;
      this.keys.add(e.code);
      if (e.code === "Tab" || e.code === "Space") e.preventDefault();
      if (!e.repeat && !this.inputBlocked) this.press(e.code);
    };
    const up = (e: KeyboardEvent) => {
      this.keys.delete(e.code);
      if (e.code === this.settings.keys.ping && this.wheel) this.releaseWheel();
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
      // 빠른 핑 (§21-3): Alt+클릭 — 공격하지 않음
      if (e.button === 0 && e.altKey) {
        if (this.inParty) { const [wx, wy] = this.aimPoint(); this.net.send({ t: "mark", k: "danger", x: wx, y: wy }); }
        return;
      }
      if (e.button === 0) this.mouse.held = true;
      if (e.button === 2) this.useHotbar();
    };
    // 휠 = 화면 배율 (2026-11-14 피드백), Ctrl+휠 = 핫바 칸 (미니맵 위 휠은 미니맵 확대 — 캔버스에서만 받음)
    const wheel = (e: WheelEvent) => {
      if (this.inputBlocked || !e.deltaY) return;
      e.preventDefault(); // Ctrl+휠 브라우저 확대 막기
      if (e.ctrlKey) { this.sel = (this.sel + (e.deltaY > 0 ? 1 : LOCS.hotbar - 1)) % LOCS.hotbar; return; }
      this.zoomWant = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, (this.zoomWant || this.zoom) * Math.pow(1.0015, -Math.max(-240, Math.min(240, e.deltaY)))));
      try { localStorage.setItem("rpg.zoom", String(this.zoomWant)); } catch { /* 저장 못 해도 이번 접속에서는 됨 */ }
    };
    const mup = (e: MouseEvent) => { if (e.button === 0) this.mouse.held = false; };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("blur", blur);
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", mup);
    this.app.canvas.addEventListener("mousedown", mdown);
    this.app.canvas.addEventListener("wheel", wheel, { passive: false });
    this.disposers.push(() => {
      window.removeEventListener("keydown", down); window.removeEventListener("keyup", up); window.removeEventListener("blur", blur);
      window.removeEventListener("mousemove", move); window.removeEventListener("mouseup", mup);
    });

    this.applySettings(this.settings);
    this.app.ticker.add((t) => { this.frameStart = performance.now(); this.dtMs = this.dtMs * 0.9 + t.deltaMS * 0.1; this.frame(t.deltaMS); });
    // 그리기까지 끝난 뒤 (렌더는 LOW, 이건 그보다 뒤) — 프레임 처리 시간
    this.app.ticker.add(() => { this.cpuMs = this.cpuMs * 0.9 + (performance.now() - this.frameStart) * 0.1; }, undefined, UPDATE_PRIORITY.UTILITY);
    for (const c of this.entityLayer.children) c.cullable = true;
  }

  destroy() {
    for (const d of this.disposers) d();
    this.app.destroy(true, { children: true });
  }

  applySettings(s: Settings) {
    if (this.settings && this.settings.zoom !== s.zoom) { this.zoomWant = 0; try { localStorage.removeItem("rpg.zoom"); } catch { /* 없어도 됨 */ } } // 설정에서 배율을 고르면 휠 배율은 버림
    this.settings = s;
    this.app.ticker.maxFPS = s.fpsLimit;
    for (const e of [this.meSprite, ...this.ents.values()]) e.shadow.visible = s.shadows;
    for (const g of this.glows) g.visible = s.quality !== "low";
    this.fx.setQuality(s.quality);
    this.realism?.setEnabled(s.graphics === "realistic");
  }

  // ── 맵 ──────────────────────────────────────────────────────────
  private buildMap() {
    if (this.kind === "plaza") this.spotLabels = FOUNTAIN_SPOTS.map((sp) => { const t = this.label("", sp.x, sp.y + 14, "#FFE14D"); t.style.fontSize = 13; t.visible = false; return t; });
    const { w, h, layers } = this.map;
    setTreeBiome(this.kind); // 맵마다 수종 (고원 = 가문비, 던전 = 고목 …)
    const atlas = tileAtlas();
    const atlasTex = hdTex(atlas);
    const tileTex = (g: number, v: number) => new Texture({ source: atlasTex.source, frame: new Rectangle((g - 1) * TILE, v * TILE, TILE, TILE) });

    // 정적 레이어는 큰 캔버스 한 장으로 굽고(드로우콜 1), 물만 스프라이트로 움직입니다
    const paint = (ctx: CanvasRenderingContext2D, layer: Uint16Array) => {
      for (let i = 0; i < w * h; i++) {
        const g = layer[i];
        if (!g || TILE_NAMES[g - 1] === "solid") continue;
        const x = i % w;
        const y = Math.floor(i / w);
        let v = Math.floor(((x * 7 + y * 13) % 17) / 17 * VARIANTS);
        if (TILE_NAMES[g - 1] === "hedge") v = (v % 4) + (y + 1 < h && layer[(y + 1) * w + x] === g ? 0 : 4); // 남쪽이 트이면 잎 벽 앞면
        ctx.drawImage(atlas, (g - 1) * TILE * R, v * TILE * R, TILE * R, TILE * R, x * TILE, y * TILE, TILE, TILE);
      }
    };
    const bake = (layer: Uint16Array) => {
      const c = Object.assign(document.createElement("canvas"), { width: w * TILE * R, height: h * TILE * R });
      const ctx = c.getContext("2d")!;
      ctx.imageSmoothingEnabled = false;
      ctx.scale(R, R);
      paint(ctx, layer);
      return chunked(c);
    };
    const animGids = new Set(ANIMATED.map(gid));
    // 장식층(산울타리 · 다리 · 꽃)은 바닥 캔버스에 같이 구움 — 2배 캔버스를 두 장 두지 않게 (GPU 메모리 절반)
    this.world.addChild(this.bakeGround(atlas, animGids, (ctx) => paint(ctx, layers.decor_below)));
    const waterLayer = new Container();
    for (let i = 0; i < w * h; i++) {
      const g = layers.water[i];
      if (!animGids.has(g) || layers.decor_below[i]) continue; // 다리 밑 물은 안 움직여도 됨 (다리가 바닥 캔버스에 있음)
      const frames = Array.from({ length: VARIANTS }, (_, v) => tileTex(g, v));
      const s = new Sprite(frames[0]);
      s.position.set((i % w) * TILE, Math.floor(i / w) * TILE);
      s.cullable = true;
      waterLayer.addChild(s);
      this.water.push({ s, frames });
    }
    this.world.addChild(waterLayer, this.fx.ground, this.indicator, this.questLine, this.entityLayer, this.fx.world, this.questMark);
    if (layers.decor_above.some((g) => g)) this.world.addChild(bake(layers.decor_above));
    this.screenLayer.addChild(this.fx.screen);

    const glowTex = Texture.from(glowCanvas());
    const contactTex = Texture.from(contactShadow());
    for (const o of this.map.objects) {
      if (o.type === "spawn" || o.type === "spawn_zone" || o.type === "stage_area") continue;
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
      const frames = objectFrames(o).map(hdTex);
      const s = new Sprite(frames[0]);
      s.anchor.set(0.5, 1);
      s.position.set(o.x, o.y);
      s.zIndex = o.type === "portal" ? o.y - o.height : o.y;
      this.entityLayer.addChild(s);
      if (frames.length > 1) this.animated.push({ s, frames });
      const CONTACT: Record<string, [number, number]> = {
        tree: [0.95, 9], building: [1.0, 8], tent_shop: [1.0, 7], tent_market: [1.0, 7], bench: [1.0, 5], lamp: [0.8, 5], statue: [1.0, 7], fountain: [1.04, 12], well: [1.0, 6],
        barrel: [1.0, 5], crate: [1.0, 5], crate_stack: [1.0, 6], flowerpot: [0.9, 4], haystack: [1.0, 6], sack: [0.9, 4], log: [1.0, 5], fence: [1.0, 4],
        rock: [1.0, 5], stump: [1.0, 5], bush: [1.1, 5], board: [1.0, 5], workbench: [1.0, 5], anvil: [1.0, 5], mailbox: [0.9, 4], mushroom: [0.8, 4], pillar: [1.2, 5],
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
      if (["tree", "barrel", "crate", "crate_stack", "flowerpot", "banner", "well", "haystack", "sack", "log", "fence", "mushroom", "lamp", "building", "tent_shop", "tent_market", "statue", "fountain", "bench", "board", "mailbox", "workbench", "anvil", "rock", "stump", "bush", "sign", "pillar"].includes(o.type)) this.staticSprites.push(s);
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
  private bakeGround(atlas: HTMLCanvasElement, animGids: Set<number>, decor: (ctx: CanvasRenderingContext2D) => void) {
    const { w, h, layers } = this.map;
    const c = Object.assign(document.createElement("canvas"), { width: w * TILE * R, height: h * TILE * R });
    const ctx = c.getContext("2d")!;
    ctx.imageSmoothingEnabled = false;
    ctx.scale(R, R); // 아래 좌표는 월드 px — 타일 · 데칼 그림은 R 배 해상도 그대로 들어감
    const decals = decalSheet();
    const nameAt = (x: number, y: number): string | null => (x < 0 || y < 0 || x >= w || y >= h ? null : TILE_NAMES[layers.ground[y * w + x] - 1] ?? null);
    const waterAt = (x: number, y: number) => x >= 0 && y >= 0 && x < w && y < h && animGids.has(layers.water[y * w + x]);
    const SOFT = new Set(["grass", "grass_dark", "flowers", "dirt"]);
    const HARD = new Set(["sand", "cobble", "stone_edge", "bridge", "fountain_rim"]);
    // 오브젝트가 차지한 칸에는 데칼을 뿌리지 않음
    const taken = new Uint8Array(w * h);
    for (const o of this.map.objects) {
      if (o.type === "spawn" || o.type === "spawn_zone" || o.type === "stage_area") continue;
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
        ctx.drawImage(atlas, (g - 1) * TILE * R, Math.floor(hash(x, y, 3) * VARIANTS) * TILE * R, TILE * R, TILE * R, ox, oy, TILE, TILE);
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
          if (kind >= 0) ctx.drawImage(decals, Math.floor(hash(x, y, 79) * DECAL_VARIANTS) * TILE * R, kind * TILE * R, TILE * R, TILE * R, ox, oy, TILE, TILE);
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
    decor(ctx);
    this.bakeHills(ctx, shade);
    return chunked(c);
  }

  /**
   * ⑥ 언덕 (2026-11-14 피드백 2차, height 레이어 — scripts/hills.ts): 위는 햇빛을 더 받아 살짝 밝게 · 가장자리 풀 테두리와 낭떠러지 선 ·
   * 남쪽 앞면 = 지층 있는 바위 절벽(위 칸은 풀이 걸쳐 늘어짐) · 돌계단 · 절벽 아래 땅에 그늘. 충돌은 맵 collision 에 이미 구워져 있음.
   */
  private bakeHills(ctx: CanvasRenderingContext2D, shade: (d: number, ox: number, oy: number, depth: number, rgb: string, a: number) => void) {
    const hm = this.map.height;
    if (!hm) return;
    const { w, h } = this.map;
    const lv = (x: number, y: number) => (x < 0 || y < 0 || x >= w || y >= h ? 0 : hm[y * w + x] & 15);
    const kd = (x: number, y: number) => heightKind(hm, w, h, x, y);
    const art = (p: { toCanvas(): HTMLCanvasElement }, ox: number, oy: number) => ctx.drawImage(p.toCanvas(), ox, oy, TILE, TILE);
    const px = (x: number, y: number, ww: number, hh: number, col: string) => { ctx.fillStyle = col; ctx.fillRect(x, y, ww, hh); };
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const L = lv(x, y);
        const k = kd(x, y);
        const ox = x * TILE, oy = y * TILE;
        // 더 높은 절벽 · 가장자리 바로 아래 · 옆 땅: 그늘
        if (k !== 1 && k !== 4) {
          if (kd(x, y - 1) === 1 && lv(x, y - 1) > L) { shade(0, ox, oy, 9, "24,16,10", 0.5); shade(0, ox, oy, 3, "24,16,10", 0.35); }
          // 해가 왼쪽 위 → 언덕 동쪽 땅에 그림자가 길게, 서쪽은 짧게
          if (lv(x - 1, y) > L) { shade(2, ox, oy, 11, "24,16,10", 0.42); shade(2, ox, oy, 3, "24,16,10", 0.3); }
          if (lv(x + 1, y) > L) shade(3, ox, oy, 4, "24,16,10", 0.28);
          if (lv(x, y - 1) > L && kd(x, y - 1) !== 1) shade(0, ox, oy, 5, "24,16,10", 0.3);
        }
        if (!L) continue;
        if (k === 1) {
          const row = kd(x, y - 1) === 1 && lv(x, y - 1) === L ? 1 : 0;
          art(cliff(x, row, !(kd(x - 1, y) === 1 && lv(x - 1, y) === L), !(kd(x + 1, y) === 1 && lv(x + 1, y) === L), L), ox, oy);
          continue;
        }
        if (k === 4) {
          art(steps(x + y, kd(x, y - 1) !== 4, kd(x - 1, y) !== 4, kd(x + 1, y) !== 4), ox, oy);
          continue;
        }
        // 위 · 가장자리: 높을수록 햇빛을 더 받음
        px(ox, oy, TILE, TILE, `rgba(255,236,150,${0.1 * L})`); // 높은 곳은 볕을 더 받아 노랗게 바랜 풀 (Codex 리뷰: 주변과 구분)
        if ((x * 7 + y * 3) % 5 === 0) px(ox + (x % 3) * 4, oy + (y % 4) * 3, 6, 1, "rgba(255,255,220,0.18)"); // 바람결
        // 윗면 가장자리 안쪽: 북 · 서쪽은 햇빛 받는 밝은 띠, 동쪽은 그늘 띠 (둥근 언덕 어깨)
        if (lv(x, y - 2) < L) shade(0, ox, oy, 6, "255,250,200", 0.16);
        if (lv(x - 2, y) < L) shade(2, ox, oy, 6, "255,250,200", 0.14);
        if (lv(x + 2, y) < L) shade(3, ox, oy, 7, "30,40,10", 0.2);
        if (k === 2) {
          // 더 낮은 쪽으로: 바깥 낭떠러지(어두운 바위 띠 — 뒤쪽 · 옆 절벽이 살짝 보임) + 풀 가장자리 빛 + 안쪽 풀 그늘
          if (lv(x, y - 1) < L) { px(ox, oy, TILE, 2.5, "#5f4f3d"); px(ox, oy, TILE, 1, "#3a2f25"); px(ox, oy + 2.5, TILE, 1, "#d6f08a"); px(ox, oy + 3.5, TILE, 1, "#7cb43a"); }
          if (lv(x - 1, y) < L && !(kd(x - 1, y) & 5)) { px(ox, oy, 3, TILE, "#826e53"); px(ox, oy, 1, TILE, "#3a2f25"); px(ox + 3, oy, 1, TILE, "#d6f08a"); px(ox + 4, oy, 0.5, TILE, "#7cb43a"); }
          if (lv(x + 1, y) < L && !(kd(x + 1, y) & 5)) { px(ox + TILE - 3, oy, 3, TILE, "#5f4f3d"); px(ox + TILE - 1, oy, 1, TILE, "#3a2f25"); px(ox + TILE - 4, oy, 1, TILE, "#a9d957"); }
          // 모서리만 낮은 칸 (대각선)
          if (lv(x, y - 1) >= L && lv(x - 1, y) >= L && lv(x - 1, y - 1) < L) px(ox, oy, 3, 2.5, "#5f4f3d");
          if (lv(x, y - 1) >= L && lv(x + 1, y) >= L && lv(x + 1, y - 1) < L) px(ox + TILE - 3, oy, 3, 2.5, "#5f4f3d");
        }
      }
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

  /** 진행 중 퀘스트 · 분수 둘레 지난 지점(비트) — RpgGame 이 qs 를 받을 때마다 */
  setQuests(active: QState[], reach: number) {
    this.quests = { active, reach };
  }

  /**
   * 퀘스트 안내 (2026-11-14 베타 피드백 "어디서 해야 하는지 모르겠다"): 추적 중인 튜토리얼 퀘스트의 첫 미완료 목표 → 갈 곳.
   * 다른 맵에서 해야 하면 그 맵으로 가는 포털. 위치가 없는 목표(구르기 · 파티 · 레벨)는 null.
   */
  private questGoal(): Goal | null {
    if (this.kind === "dungeon" || this.ghost) return null;
    const q = this.quests.active.find((a) => a.tracked && QUESTS[a.id]);
    if (!q) return null;
    const def = QUESTS[q.id];
    const o = def.obj.find((x, k) => (q.prog[k] ?? 0) < x.n);
    if (!o) return null;
    const NEED: Partial<Record<string, RoomKind>> = { talk: "plaza", reach: "plaza", claim: "plaza", buy: "plaza", enhance: "plaza", equip: "plaza", stage: "plaza", cast: "field", kill: "field" };
    const where = NEED[o.type];
    if (!where) return null;
    const near = (pred: (x: TiledObject) => boolean) => {
      let best: TiledObject | null = null;
      let bd = Infinity;
      for (const x of this.map.objects) {
        if (!pred(x)) continue;
        const d = distToObj(x, this.me.x, this.me.y);
        if (d < bd) { bd = d; best = x; }
      }
      return best;
    };
    const objGoal = (t: TiledObject, label: string): Goal => ({ x: t.x, y: t.y - Math.min(t.height, 24) / 2, label, r: Math.max(t.width, 16) / 2, obj: t });
    if (this.kind !== where) {
      const portal = near((x) => x.type === "portal" && prop(x, "target") === where) ?? near((x) => x.type === "portal" && prop(x, "target") === (this.kind === "highland" ? "field" : "plaza"));
      return portal ? objGoal(portal, `${portal.name} 포털`) : null;
    }
    let t: TiledObject | null = null;
    switch (o.type) {
      case "talk": t = near((x) => x.type === "npc" && prop(x, "npc") === o.target); break;
      case "equip": t = near((x) => x.type === "npc" && prop(x, "npc") === "owen"); break;
      case "claim": t = near((x) => x.type === "mailbox"); break;
      case "buy": t = near((x) => x.type === "tent_shop"); break;
      case "enhance": t = near((x) => x.type === "anvil"); break;
      case "stage": t = near((x) => x.type === "portal" && prop(x, "target") === "dungeon"); break;
      case "reach": {
        // 분수 둘레: 아직 안 지난 지점 중 가장 가까운 곳
        let best = -1;
        let bd = Infinity;
        FOUNTAIN_SPOTS.forEach((sp, k) => {
          if (this.quests.reach & (1 << k)) return;
          const d = Math.hypot(sp.x - this.me.x, sp.y - this.me.y);
          if (d < bd) { bd = d; best = k; }
        });
        return best < 0 ? null : { x: FOUNTAIN_SPOTS[best].x, y: FOUNTAIN_SPOTS[best].y, label: `분수 ${SPOT_NAME[best]}쪽 지점`, r: 16 };
      }
      case "cast":
      case "kill": {
        // 가까이 보이는 그 몹 → 없으면 서식지
        const want = o.type === "kill" && o.target !== "*" ? o.target : "slime";
        let best: Ent | null = null;
        let bd = 220;
        for (const e of this.ents.values()) {
          if (!e.mob || e.info.pet || !e.sprite.visible || e.flags & F_DEAD || e.deadMs > 0 || (o.type === "kill" && o.target !== "*" && e.info.mob !== want)) continue;
          const d = Math.hypot(e.x - this.me.x, e.y - this.me.y);
          if (d < bd) { bd = d; best = e; }
        }
        if (best) return { x: best.x, y: best.y - 8, label: best.info.name, r: 12, ent: best };
        const z = near((x) => x.type === "spawn_zone" && prop(x, "mob") === want);
        return z ? { x: z.x, y: z.y - z.height / 2, label: `${z.name} (서식지)`, r: Math.min(80, z.width / 2) } : null;
      }
    }
    return t ? objGoal(t, t.type === "npc" ? `${t.name} (${prop(t, "role")})` : t.name) : null;
  }

  /** 바닥 화살표 줄(흐르는 점선 + 화살촉) · 목표 테두리 강조 · 머리 위 통통 튀는 화살표 · 분수 둘레 지점 표시 */
  private drawQuest(now: number) {
    const line = this.questLine.clear();
    const mark = this.questMark.clear();
    const me = this.meSprite;
    const g = (this.goal = this.questGoal());
    const pulse = 0.55 + 0.45 * Math.sin(now / 180);
    // 분수 퀘스트: 네 지점 + 한 바퀴 도는 길 (지난 곳 초록 ✔ · 남은 곳 금색)
    const fq = this.kind === "plaza" && this.quests.active.find((a) => a.id === "tut_fountain");
    this.spotLabels.forEach((t, k) => {
      t.visible = !!fq;
      if (fq) { const done = !!(this.quests.reach & (1 << k)); t.text = `${SPOT_NAME[k]} ${done ? "✔" : "◇"}`; t.style.fill = done ? "#7CFC6A" : "#FFE14D"; }
    });
    if (fq) {
      const cx = 768;
      const cy = 768;
      const R = 112;
      const off = (now / 600) % 1;
      for (let i = 0; i < 48; i++) {
        const a0 = ((i + off) / 48) * Math.PI * 2;
        const a1 = a0 + (Math.PI * 2) / 96;
        line.moveTo(cx + Math.cos(a0) * R, cy + Math.sin(a0) * R).lineTo(cx + Math.cos(a1) * R, cy + Math.sin(a1) * R);
      }
      line.stroke({ color: 0xffe14d, width: 1.5, alpha: 0.45 });
      FOUNTAIN_SPOTS.forEach((sp, k) => {
        const done = !!(this.quests.reach & (1 << k));
        const col = done ? 0x7cfc6a : 0xffe14d;
        line.ellipse(sp.x, sp.y, FOUNTAIN_R * 0.75, FOUNTAIN_R * 0.45).fill({ color: col, alpha: done ? 0.18 : 0.12 + 0.12 * pulse }).stroke({ color: col, width: 2, alpha: done ? 0.7 : 0.5 + 0.5 * pulse });
      });
    }
    if (!g) return;
    const tx = g.ent ? g.ent.x : g.x;
    const ty = g.ent ? g.ent.y - 8 : g.y;
    const dx = tx - me.x;
    const dy = ty - (me.y - 6);
    const dist = Math.sqrt(dx * dx + dy * dy);
    // 화살표 줄: 발밑에서 목표 쪽으로 흐르는 점선 + 끝 화살촉 (목표 가까이 오면 사라짐)
    if (dist > g.r + 26) {
      const ux = dx / dist;
      const uy = dy / dist;
      const end = Math.min(dist - g.r - 6, 220); // 화면 밖 먼 곳이면 220px 까지만 그리고 화살촉
      const flow = (now / 30) % 14;
      for (let d = 12 + flow; d < end - 10; d += 14) {
        const d1 = Math.min(d + 7, end - 10);
        line.moveTo(me.x + ux * d, me.y - 6 + uy * d).lineTo(me.x + ux * d1, me.y - 6 + uy * d1);
      }
      line.stroke({ color: 0xffe14d, width: 3, alpha: 0.9, cap: "round" });
      const hx = me.x + ux * end;
      const hy = me.y - 6 + uy * end;
      line.poly([hx + ux * 8, hy + uy * 8, hx - uy * 6, hy + ux * 6, hx + uy * 6, hy - ux * 6]).fill({ color: 0xffe14d, alpha: 0.95 }).stroke({ color: 0x5a4214, width: 1 });
    }
    // 목표 테두리 강조 (오브젝트는 그림 영역 사각형, 몹 · 지점은 원)
    const glow = { color: 0xffe14d, width: 2, alpha: 0.55 + 0.45 * pulse };
    if (g.obj && g.obj.type !== "spawn_zone") {
      const o = g.obj;
      const pad = 3 + pulse * 2;
      mark.roundRect(o.x - o.width / 2 - pad, o.y - o.height - pad, o.width + pad * 2, o.height + pad * 2, 4).stroke(glow);
      mark.roundRect(o.x - o.width / 2 - pad - 2, o.y - o.height - pad - 2, o.width + pad * 2 + 4, o.height + pad * 2 + 4, 6).stroke({ color: 0xffffff, width: 1, alpha: 0.35 * pulse });
    } else mark.circle(tx, ty, g.r + pulse * 3).stroke(glow);
    // 머리 위 통통 튀는 화살표
    const top = g.obj ? g.obj.y - g.obj.height : ty - g.r;
    const by = top - 10 - Math.abs(Math.sin(now / 220)) * 6;
    mark.poly([tx, by + 7, tx - 6, by, tx - 2, by, tx - 2, by - 6, tx + 2, by - 6, tx + 2, by, tx + 6, by]).fill({ color: 0xffe14d }).stroke({ color: 0x5a4214, width: 1 });
  }

  // ── 엔티티 ───────────────────────────────────────────────────────
  private makeEnt(info: EntityInfo, isMe = false): Ent {
    const mob = !!info.mob;
    const frames = mob ? mobTextures(info.mob!) : sheetFrames(info.ap!, outfitOf(info.look, info.jb, !!info.aw));
    const sprite = new Sprite(frames[0][0]);
    const fh = frames[0][0].height;
    sprite.anchor.set(0.5, mob ? (fh - 3) / fh : CHAR_FEET / CHAR_H);
    const shadow = new Sprite(shadowTex());
    shadow.anchor.set(0.5);
    shadow.zIndex = -1e6;
    const plate = new Container();
    const color = info.pet ? "#B8F5C8" : mob ? GRADES[info.grade ?? "normal"].color : isMe ? "#ffffff" : "#8fdcff";
    const label = new Text({ text: mob && !info.pet ? `Lv${info.lv} ${info.name}` : info.name, style: { ...LABEL_STYLE, fill: color } });
    label.anchor.set(0.5, 1);
    label.y = -6;
    const bars = new Graphics();
    const icons = new Container();
    plate.addChild(bars, label, icons);
    let title: Text | null = null;
    if (!info.pet && ((mob && info.grade && info.grade !== "normal") || !mob)) {
      title = new Text({ text: mob ? GRADES[info.grade!].name : this.titleText(info), style: { ...LABEL_STYLE, fontSize: 10, fill: mob ? color : "#FFE14D" } });
      title.anchor.set(0.5, 1);
      title.y = -19;
      plate.addChild(title);
    }
    sprite.cullable = shadow.cullable = plate.cullable = true;
    this.entityLayer.addChild(shadow, sprite);
    this.screenLayer.addChild(plate);
    const x = isMe ? this.me.x : 0;
    const y = isMe ? this.me.y : 0;
    return {
      info, mob, sprite, shadow, plate, label, title, bars, icons, frames, buf: [], x, y, dir: 0, shown: 0, turnMs: 0, action: "idle", animMs: 0,
      flags: 0, hp: 1000, res: 1000, en: 1000, hpMax: 100, lag: 1000, lagAt: 0, drawn: "", fx: [], fxAt: 0, flash: 0, lunge: null, act: null, deadMs: 0, face: 0, knock: null, stop: 0, trail: 0, hitByMe: 0,
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

  /** 칭호 자리: 고른 칭호(「」), 없으면 직업 이름 */
  private titleText(info: EntityInfo) {
    const t = info.tt && TITLES[info.tt] ? `「${TITLES[info.tt]}」` : `${info.aw ? "각성 " : ""}${this.jobTitle(info.jb)}`;
    return `${info.nt ? `«${info.nt}» ` : ""}${info.gd ? `‹${info.gd}› ` : ""}${t}`; // 국가 (P14) · 길드 (P10)
  }

  /** 적대 플레이어: 결투장(같은 파티 제외) · 결투 상대 (서버 Room.hostile 과 같게) */
  isFoe(e: Ent) {
    if (e.mob || e === this.meSprite || e.info.pet) return false;
    if (this.kind === "arena") return !this.partyIds.has(e.info.id);
    return this.duelFoes.has(e.info.id) && performance.now() >= this.duelAt;
  }

  /** 파티원 · 적 이름 색 다시 칠함 */
  private paintNames() {
    for (const e of this.ents.values()) {
      if (e.mob || e.info.pet) continue;
      e.label.style.fill = this.isFoe(e) ? NAME_COLOR.foe : this.partyIds.has(e.info.id) ? NAME_COLOR.party : NAME_COLOR.other;
    }
  }

  setParty(ids: number[], inParty: boolean) {
    const key = ids.join();
    this.inParty = inParty;
    if (key === [...this.partyIds].join()) return;
    this.partyIds = new Set(ids);
    this.paintNames();
  }

  /** 핑 표시: 3초 (§21-3) */
  addPing(k: PingKind, x: number, y: number, from: string) {
    const def = PINGS[k];
    if (!def) return;
    const c = new Container();
    const ring = new Graphics().circle(0, 0, 14).stroke({ color: def.color, width: 3, alpha: 0.9 }).circle(0, 0, 4).fill(def.color);
    const icon = new Text({ text: def.icon, style: { ...LABEL_STYLE, fill: def.color, fontSize: 18 } });
    icon.anchor.set(0.5, 1.4);
    const name = new Text({ text: `${def.name} · ${from}`, style: { ...LABEL_STYLE, fill: "#ffffff", fontSize: 11 } });
    name.anchor.set(0.5, -1.1);
    c.addChild(ring, icon, name);
    this.screenLayer.addChild(c);
    this.pings.push({ c, x, y, k, until: performance.now() + PING.ms });
    sfx("ping");
  }

  /** 핑 휠을 떼면: 휠 가운데에서 마우스 방향의 칸 (가까우면 '위험') */
  private releaseWheel() {
    const w = this.wheel!;
    this.wheel = null;
    const sel = this.wheelSel(w);
    this.net.send({ t: "mark", k: sel < 0 ? "danger" : PING_WHEEL[sel], x: w.wx, y: w.wy });
  }

  private wheelSel(w: { sx: number; sy: number }) {
    const dx = this.mouse.sx - w.sx;
    const dy = this.mouse.sy - w.sy;
    if (Math.hypot(dx, dy) < 18) return -1;
    const a = (Math.atan2(dx, -dy) + Math.PI * 2) % (Math.PI * 2); // 위 = 0, 시계 방향
    return Math.round(a / ((Math.PI * 2) / PING_WHEEL.length)) % PING_WHEEL.length;
  }

  addEnt(info: EntityInfo) {
    if (info.id === this.you.id || this.ents.has(info.id)) return;
    const e = this.makeEnt(info);
    e.sprite.visible = e.shadow.visible = e.plate.visible = false; // 첫 스냅샷 전까지 숨김
    if (!e.mob && !info.pet) e.label.style.fill = this.isFoe(e) ? NAME_COLOR.foe : this.partyIds.has(info.id) ? NAME_COLOR.party : NAME_COLOR.other;
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
      if (Math.abs(fixed.x - this.me.x) > 24 || Math.abs(fixed.y - this.me.y) > 24) { this.prev = { ...fixed }; this.err = [0, 0]; } // 크게 어긋나면 순간이동
      else { this.err[0] += this.me.x - fixed.x; this.err[1] += this.me.y - fixed.y; } // 작은 어긋남은 화면에서 녹여 없앰 (튀지 않게)
      this.me = fixed;
      for (const [id, x, y, dir, flags, hp, res, en, hpMax] of m.e) {
        const e = this.ents.get(id);
        if (!e) continue;
        // 델타라 멈춰 있는 동안은 줄이 안 옴 — 다시 움직이면 직전 위치를 한 스냅샷 전 시각에 넣어 보간이 거기서 시작하게
        const last = e.buf[e.buf.length - 1];
        if (last && m.st - last.t > SNAP_MS * 1.5) e.buf.push({ ...last, t: m.st - SNAP_MS });
        e.buf.push({ t: m.st, x, y, dir, flags, hp, res, en, hpMax });
        if (e.buf.length > 30) e.buf.shift();
      }
      // 시야(AOI) 밖으로 나감 → 숨김 (다시 들어오면 전체 줄이 옴)
      for (const id of m.g ?? []) {
        const e = this.ents.get(id);
        if (!e) continue;
        e.buf = [];
        e.sprite.visible = e.shadow.visible = e.plate.visible = false;
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
        const src = ev[1] as number;
        if (mine) sfx("hurt");
        else if (src === this.you.id) sfx(flags & H_CRIT ? "crit" : "hit");
        e.flash = 120;
        this.fx.burst(e.x, e.y - 14, el || "hit", el ? 12 : 5);
        // 타격감 (2026-11-14 베타 피드백 "타격감이 없다"): 불꽃 · 맞은 쪽 넉백 · 내가 때리면 히트스톱
        if (!(flags & H_DOT)) {
          const crit = !!(flags & H_CRIT);
          this.fx.spark(e.x, e.y - 14, el ? elColor(el) : "#fff4dc", crit);
          const s = this.ent(src);
          if (s && s !== e) {
            const dx = e.x - s.x;
            const dy = e.y - s.y;
            const len = Math.sqrt(dx * dx + dy * dy) || 1;
            e.knock = { ms: 0, dx: dx / len, dy: dy / len };
          }
          if (src === this.you.id) {
            this.meSprite.stop = e.stop = crit ? 90 : 50;
            e.hitByMe = now;
            this.fx.combo(now);
            const kx = e.knock?.dx ?? 0;
            const ky = e.knock?.dy ?? 0;
            // 도파민 (2026-11-14 피드백 2차): 치명타 = 흰 번쩍임 · 집중선 · 바닥 충격파 · 펀치 줌 · 큰 흔들림
            if (crit) {
              this.fx.flash(0xffffff, 0.22, 120);
              this.fx.speedLines(e.x, e.y - 14, el ? elColor(el) : 0xffd27a);
              this.fx.shock(e.x, e.y, el ? elColor(el) : 0xffd27a, 30);
              this.fx.punch = Math.max(this.fx.punch, 0.7);
              if (this.settings.shake) this.fx.quake(150, 4, kx, ky);
            } else if (this.settings.shake) this.fx.quake(60, 1.2, kx, ky);
          }
        }
        if (mine) {
          const k = Math.min(1, amount / Math.max(1, this.v[1]) / 0.25); // 최대 체력의 25% 면 가장 셈
          this.fx.flash(0xff2020, 0.08 + 0.22 * k, 160 + 140 * k);
          const s = this.ent(src);
          if (this.settings.shake && amount > this.v[1] * 0.03) this.fx.quake(140 + 120 * k, 2 + 4 * k, s ? Math.sign(this.me.x - s.x) : 0, s ? Math.sign(this.me.y - s.y) : 0);
        }
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
        if (e === this.meSprite) { this.deadUntil = 0; this.ghost = false; sfx("level"); }
        this.fx.pillar(e.x, e.y);
        return;
      }
      case "gn":
        // 채집 지점: 캐 감(0, 캔 사람) · 다시 생김(1)
        this.setNode(ev[1] as number, ev[2] === 1);
        if (ev[2] === 0 && ev[3] === this.you.id) sfx("pickup");
        return;
      case "tt":
      case "nt":
      case "gd": {
        // 칭호 · 길드가 바뀜 → 이름표 칭호 자리
        const e = this.ent(ev[1] as number);
        if (!e || e.mob) return;
        e.info[ev[0] as "tt" | "gd" | "nt"] = (ev[2] as string) || undefined;
        if (e.title) e.title.text = this.titleText(e.info);
        return;
      }
      case "bp": {
        // 보스 페이즈 전환 (§20-4)
        this.onBanner(`${ev[2]}`, 2600);
        sfx("boss");
        if (this.settings.shake) this.fx.quake(400, 3);
        const e = this.ent(ev[1] as number);
        if (e) this.fx.burst(e.x, e.y - 30, e.info.el || "grass", 30);
        return;
      }
      case "ann": {
        const [, text, ms, id] = ev as [string, string, number, number?];
        const e = id ? this.ent(id) : undefined;
        if (e) this.fx.number(e.x, e.y - 52, text, "#ff9a9e", true);
        else this.onBanner(text, ms || 2500);
        return;
      }
      case "wp": {
        const [, x, y, r] = ev as number[] as [never, number, number, number];
        this.fx.number(x, y - r, "여기로 모여요!", "#FFE14D", true);
        return;
      }
      case "job": {
        const [, id, line, job] = ev as [string, number, string, string];
        const e = this.ent(id);
        if (!e || e.mob) return;
        e.info.jb = job || line;
        if (e.title) e.title.text = this.titleText(e.info);
        this.fx.pillar(e.x, e.y);
        return;
      }
      case "f":
        return this.setFx(ev[1] as number, ev[2] as FxRow[]);
      case "d": {
        const e = this.ent(ev[1] as number);
        if (!e) return;
        e.deadMs = 1;
        if (!e.mob || e.info.pet || !e.sprite.visible) this.fx.burst(e.x, e.y - 10, e.mob ? "hit" : "dark", 16);
        else {
          // 처치: 몹이 조각나 내 반대쪽으로 튕겨 날아감 · 내가 잡았으면 펀치 줌 + 흔들림
          const dx = e.x - this.meSprite.x;
          const dy = e.y - this.meSprite.y;
          const len = Math.sqrt(dx * dx + dy * dy) || 1;
          this.fx.shatter(e.sprite, dx / len, dy / len);
          if (now - e.hitByMe < 1500) {
            this.fx.punch = 1;
            if (this.settings.shake) this.fx.quake(180, 3, dx / len, dy / len);
            this.fx.number(e.x, e.y - (PLATE_H[e.info.mob!] ?? 24) - 8, t("fx.kill"), "#FFE14D", true);
          }
        }
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
        e.frames = sheetFrames(e.info.ap!, outfitOf(e.info.look, e.info.jb, !!e.info.aw));
        return;
      }
      case "aw": {
        // 3차 각성 (P15): 칭호 "각성 …" · 금빛 망토 테두리 · 빛기둥
        const e = this.ent(ev[1] as number);
        if (!e || e.mob) return;
        e.info.aw = 1;
        if (e.title) e.title.text = this.titleText(e.info);
        e.frames = sheetFrames(e.info.ap!, outfitOf(e.info.look, e.info.jb, true));
        this.fx.pillar?.(e.x, e.y);
        return;
      }
      case "jb": {
        // 전직 (P11): 칭호 자리 직업 이름 · 2차 전직 망토 · 문장
        const e = this.ent(ev[1] as number);
        if (!e || e.mob) return;
        e.info.jb = ev[2] as string;
        if (e.title) e.title.text = this.titleText(e.info);
        e.frames = sheetFrames(e.info.ap!, outfitOf(e.info.look, e.info.jb, !!e.info.aw));
        return;
      }
      case "lv": {
        const [, id, lv] = ev as [string, number, number];
        const e = this.ent(id);
        if (!e) return;
        e.info.lv = lv;
        if (e.mob) e.label.text = `Lv${lv} ${e.info.name}`;
        if (id === this.you.id) { this.you.level = lv; sfx("level"); }
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
        sfx("pickup");
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
        sfx("coin");
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
      case "dead": {
        const [, ms, kind] = ev as [string, number, string?];
        this.deadKind = kind ?? "plaza";
        // 던전: 관전 (공용 부활 · 파티원 부활까지)
        if (kind === "dungeon") this.ghost = true;
        else this.deadUntil = performance.now() + ms;
        this.meSprite.deadMs = 1;
        this.mouse.held = false;
        sfx("death");
        return;
      }
      case "sp": {
        // 정찰자 「매의 눈」: 파티원이 본 몹 → 미니맵 5초
        const v = ev[1] as number[];
        const until = performance.now() + 5000;
        for (let i = 0; i + 1 < v.length; i += 2) this.spots.push({ x: v[i], y: v[i + 1], until });
        return;
      }
      case "pl": {
        // 파티 드롭 분배 결과 (§21-2)
        const [, tpl, rarity, who] = ev as [string, string, Rarity, string];
        const t = ITEMS[tpl];
        if (t) this.onChat("party", `「${t.name}」${rarity !== "common" && !t.rarity ? `(${RARITY[rarity].name})` : ""} → ${who}`);
        return;
      }
      case "duel": {
        const [, kind, foes, v] = ev as [string, string, number[], number | string];
        if (kind === "start") {
          this.duelFoes = new Set(foes);
          this.duelAt = performance.now() + Number(v);
          this.onBanner(`결투! ${Math.ceil(Number(v) / 1000)}초 뒤 시작`, Number(v));
          setTimeout(() => this.paintNames(), Number(v) + 50);
        } else {
          this.duelFoes.clear();
          this.onBanner(v === "win" ? "결투 승리!" : v === "lose" ? "결투 패배…" : "결투 무승부", 2600);
        }
        this.paintNames();
        return;
      }
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

  /** 모바일 터치 (P16): 가장 가까운 적(260px 안, 없으면 바라보는 쪽 60px)을 마우스 조준점으로 */
  touchAim() {
    let best: Ent | undefined;
    let bd = 260;
    for (const e of this.ents.values()) {
      if (e.info.pet || (!e.mob && !this.isFoe(e)) || e.deadMs > 0 || !e.sprite.visible) continue;
      const d = Math.hypot(e.x - this.me.x, e.y - this.me.y);
      if (d < bd) { bd = d; best = e; }
    }
    const V = [[0, 1], [1, 1], [1, 0], [1, -1], [0, -1], [-1, -1], [-1, 0], [-1, 1]][this.me.dir] ?? [0, 1];
    const [tx, ty] = best ? [best.x, best.y] : [this.me.x + V[0] * 60, this.me.y + V[1] * 60];
    this.mouse.sx = this.world.x + tx * this.world.scale.x;
    this.mouse.sy = this.world.y + ty * this.world.scale.x;
  }
  /** 모바일 공격 단추 = 왼쪽 마우스 누르고 있기 */
  setAttack(on: boolean) {
    this.mouse.held = on && !this.inputBlocked;
  }

  /** 핫바 고른 칸 우클릭 = 사용 (포션 · 장비는 장착) (§15-2 · D20) */
  useHotbar() {
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
    else if (code === k.ping) {
      // 핑 휠 (§21-3): 누르고 있는 동안 휠, 떼면 커서 자리(누른 순간)에 핑
      if (!this.inParty) return this.toast("핑은 파티 중에만 쓸 수 있습니다 (P 파티창)");
      const [wx, wy] = this.aimPoint();
      this.wheel = { sx: this.mouse.sx, sy: this.mouse.sy, wx, wy };
    }
    else if (code === k.interact) {
      // 채집 (P13): 가장 가까운 캘 수 있는 지점
      const node = this.nearNode();
      if (node) return this.net.send({ t: "gather", id: node });
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
      if (e.info.pet || (!e.mob && !this.isFoe(e)) || e.deadMs > 0 || !e.sprite.visible) continue;
      const d = Math.sqrt((e.x - ax) ** 2 + (e.y - ay) ** 2);
      if (d <= bd + 10 && Math.sqrt((e.x - this.me.x) ** 2 + (e.y - this.me.y) ** 2) <= range + 18) { bd = d; best = e; }
    }
    return best;
  }

  /** 커서 근처 아군 (없으면 나) — 아군 돌진 예측 */
  private allyNear(ax: number, ay: number): { x: number; y: number } {
    for (const e of this.ents.values()) if (!e.mob && !e.info.pet && e.sprite.visible && Math.sqrt((e.x - ax) ** 2 + (e.y - ay) ** 2) <= 30) return e;
    return this.me;
  }

  /** 서버 cast() 검증을 똑같이 (§2-2 낙관적 재생) */
  private canCast(k: Slot): string | null {
    const sk = this.skill(k);
    if (!sk) return k === "R" ? "궁극기는 1차 전직(Lv10) 후 열립니다" : "스킬이 없는 슬롯입니다 (K 스킬창)";
    if (this.kind === "plaza") return "광장은 안전지대라 공격 · 스킬을 쓸 수 없습니다";
    if (this.deadUntil || this.ghost) return QUIET;
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
    const z = this.world.scale.x || this.zoom;
    return [Math.round((this.mouse.sx - this.world.x) / z), Math.round((this.mouse.sy - this.world.y) / z)];
  }

  /** 재생: 서버 room.input 과 같은 순서 (구르기 → 시전 → 이동) */
  private replay(m: Mover, i: MoveInput) {
    if (i.dg) tryRoll(m, i, this.kind === "plaza");
    if (i.k) {
      const sk = this.skill(i.k);
      if (sk) castMove(m, sk, i.ax!, i.ay!, this.map.collider, this.nums(i.k).range, this.castLog.find((c) => c.seq === i.seq)?.to);
    }
    step(m, i, this.map.collider, this.kind === "plaza");
  }

  private playCast(e: Ent, sk: SkillDef | undefined, ax: number, ay: number, now: number) {
    if (!sk) return;
    const kind: Action = sk.targeting === "melee" || sk.targeting === "dash" || (sk.targeting === "self" && sk.category === "physical") ? "attack" : "cast";
    const ms = castMs(sk.castMs || 300, this.stats.atkSpeed);
    // 공격: 0.3~0.48초에 8프레임(준비 · 휘두름 · 타격 · 회수) 전부 / 시전: 시전 시간(최소 0.36초)
    const dur = kind === "attack" ? Math.max(300, Math.min(480, ms)) : Math.max(360, ms);
    e.act = { kind, until: now + dur, from: now };
    e.animMs = 0;
    e.action = kind;
    const ang = Math.atan2(ay - e.y, ax - e.x);
    const el = sk.elementInherit ? e.info.el : "none";
    const col = el && el !== "none" ? elColor(el) : "#fff4dc";
    if (kind === "cast") this.fx.circle(e.x, e.y, sk.targeting === "ally" ? "#4CC764" : col, dur + 120);
    if (sk.targeting === "melee") this.fx.swing(e.x, e.y, ang, sk.range, col);
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
        tryRoll(this.me, input, this.kind === "plaza");
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
          if (slot !== "A") sfx("cast");
          if (sk.targeting === "skillshot" && !sk.count) {
            const dx = ax - sx;
            const dy = ay - sy;
            const len = Math.sqrt(dx * dx + dy * dy) || 1;
            const speed = sk.speed! * (1 + this.stats.projSpeed);
            this.fx.projectile(-(input.seq + 1), sx, sy, (dx / len) * speed, (dy / len) * speed, n.range, sk.elementInherit ? this.you.element : sk.sub ? this.you.prog.sub ?? "none" : sk.el ?? "none");
          }
        } else if (fromKey) this.toast(why);
      }
      step(this.me, input, this.map.collider, this.kind === "plaza");
      this.pending.push(input);
      this.net.send({ t: "in", ...input });
    }
    const a = this.acc / SIM_MS;
    const me = this.meSprite;
    const decay = Math.exp(-dt / 60);
    this.err[0] *= decay;
    this.err[1] *= decay;
    me.x = this.prev.x + (this.me.x - this.prev.x) * a + this.err[0];
    me.y = this.prev.y + (this.me.y - this.prev.y) * a + this.err[1];
    me.dir = this.me.dir;
    const rolling = this.me.mv > 0 && this.me.rollCd > ROLL.cdSteps;
    if (this.me.mv > 0 && !rolling) this.fx.burst(me.x, me.y - 12, this.you.element, 1); // 돌진 잔상
    me.flags = (rolling ? F_ROLL : 0) | (this.deadUntil || this.ghost ? F_DEAD : 0);
    me.hp = (this.v[0] / Math.max(1, this.v[1])) * 1000;
    me.res = (this.v[2] / Math.max(1, this.v[3])) * 1000;
    me.en = (this.v[4] / Math.max(1, this.v[5])) * 1000;
    me.hpMax = this.v[1] ?? 100;
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
      e.en = cur.en;
      e.hpMax = cur.hpMax;
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
    // 화면 배율 ×N: 숫자가 클수록 더 넓게 보임 (×4 = 가장 많이 보임). 확대 배율 = 6 − N. 휠로 바꾸면 그 값을 부드럽게 따라감
    const base = this.settings.zoom ? 6 - this.settings.zoom : Math.max(2, Math.min(5, Math.round(Math.min(sw / 520, sh / 320))));
    const want = this.zoomWant || base;
    this.zoom = !this.zoom || Math.abs(want - this.zoom) < 0.002 ? want : this.zoom + (want - this.zoom) * (1 - Math.exp(-dt / 70));
    const z = this.zoom;
    const mapW = this.map.w * TILE;
    const mapH = this.map.h * TILE;
    // 맵이 화면보다 작으면 가운데 (아주 넓은 화면에서 한쪽만 검게 비지 않게)
    const cx = mapW * z <= sw ? mapW / 2 : Math.max(sw / 2 / z, Math.min(mapW - sw / 2 / z, me.x));
    const cy = mapH * z <= sh ? mapH / 2 : Math.max(sh / 2 / z, Math.min(mapH - sh / 2 / z, me.y - 16));
    const [qx, qy] = this.settings.shake ? this.fx.shakeOffset() : [0, 0];
    const zp = z * (1 + 0.045 * this.fx.punch * this.fx.punch); // 펀치 줌 (화면 가운데 = 나 기준)
    this.world.scale.set(zp);
    this.world.position.set(Math.round(sw / 2 - cx * zp) + qx, Math.round(sh / 2 - cy * zp) + qy);

    const toScreen = (x: number, y: number): [number, number] => [Math.round(this.world.x + x * zp), Math.round(this.world.y + y * zp)];
    this.fx.setDanger(this.v[1] && this.v[0] > 0 && this.v[0] < this.v[1] * 0.3 ? 1 - this.v[0] / (this.v[1] * 0.3) * 0.6 : 0);
    this.fx.update(dt, toScreen, sw, sh);
    if (this.realism.enabled) {
      const sprites = [this.meSprite.sprite, ...[...this.ents.values()].map((e) => e.sprite), ...this.animated.filter((a) => a.slow).map((a) => a.s)];
      this.realism.update({ zoom: z, wx: this.world.x, wy: this.world.y, sw, sh }, this.lightSrc, sprites, { x: me.x, y: me.y - 8 });
    }
    for (const l of this.labels) l.t.position.set(...toScreen(l.x, l.y));
    const np = this.settings.nameplates;
    // 핑 (화면 좌표로 따라감 · 3초 · 깜빡이며 사라짐)
    const pnow = performance.now();
    this.pings = this.pings.filter((p) => {
      if (pnow >= p.until) { p.c.destroy({ children: true }); return false; }
      p.c.position.set(...toScreen(p.x, p.y));
      const left = p.until - pnow;
      p.c.alpha = left < 600 ? left / 600 : 1;
      const age = PING.ms - left;
      p.c.scale.set(age < 200 ? 2 - age / 200 : 1); // 찍힐 때 크게 → 제자리
      return true;
    });
    for (const e of [me, ...this.ents.values()]) {
      e.plate.position.set(...toScreen(e.x, e.y - (e.mob ? (PLATE_H[e.info.mob!] ?? 24) : PLAYER_PLATE_H)));
      if (e !== me && !e.mob) e.plate.visible = e.sprite.visible && (np === "all" || (np === "party" && this.partyIds.has(e.info.id)));
      if (e.mob && e.info.pet) e.label.visible = false; // 소환수 · 설치물은 이름 없이 HP 막대만 (여럿이면 겹침)
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
    this.drawQuest(now);
  }

  /**
   * 머리 위 막대 (2026-11-14 피드백: 크게 · 구체적으로): 플레이어 = 체력 · 기력 · 마나 세 줄, 몹 = 체력.
   * 체력 눈금: 100 마다 가는 선 · 1000 마다 굵은 선 — 체력이 많을수록 칸이 잘게 많아짐 (너무 촘촘하면 굵은 선만).
   * 깎인 체력은 흰 조각으로 잠깐 남았다가 줄어듦. 배율이 커지면 막대도 같이 커짐.
   */
  private drawBars(e: Ent) {
    const player = !e.mob;
    const k = Math.max(1, Math.min(2.6, this.zoom / 2.2));
    // 깎인 체력 잔상: 0.35초 머물다가 빠르게 따라옴. 회복은 바로
    const hp = Math.max(0, Math.min(1000, e.hp));
    if (hp >= e.lag) { e.lag = hp; e.lagAt = performance.now(); }
    else if (performance.now() - e.lagAt > 350) e.lag = Math.max(hp, e.lag - this.dtMs * 2.2);
    const key = `${Math.round(hp)}:${Math.round(e.lag)}:${Math.round(e.res / 8)}:${Math.round(e.en / 8)}:${e.hpMax}:${k.toFixed(2)}:${this.isFoe(e)}`;
    if (key === e.drawn) return;
    e.drawn = key;
    const W = player ? 46 : e.info.pet ? 26 : 34;
    const HH = player ? 5 : 4; // 체력 줄 높이
    const SH = 2; // 기력 · 마나 줄 높이
    const H = player ? HH + SH * 2 + 4 : HH + 2; // 테두리 · 사이 1px 포함
    const g = e.bars.clear();
    e.bars.scale.set(k);
    e.bars.position.set(0, 2 - H * k);
    const x0 = -W / 2;
    g.roundRect(x0 - 1.5, -1.5, W + 3, H + 3, 2).fill({ color: 0x0c0810, alpha: 0.55 }); // 바깥 그늘
    g.rect(x0 - 1, -1, W + 2, H + 2).fill(0x1b1420);
    const bar = (y: number, h: number, v: number, col: number, hi: number, back: number) => {
      g.rect(x0, y, W, h).fill(back);
      const w = (W * Math.max(0, Math.min(1000, v))) / 1000;
      if (w <= 0) return;
      g.rect(x0, y, w, h).fill(col);
      g.rect(x0, y, w, Math.max(1, Math.floor(h / 2.5))).fill({ color: hi, alpha: 0.75 }); // 윗면 반사
    };
    const foe = this.isFoe(e);
    const hpCol = e.mob && !e.info.pet ? [0xd9343b, 0xff8a8a] : foe ? [0xe5484d, 0xff9a9e] : e === this.meSprite ? [0x3fbf5a, 0xa8f0b4] : [0x46b4e8, 0xb4e8ff];
    bar(0, HH, hp, hpCol[0], hpCol[1], 0x3a1a1e);
    if (e.lag > hp) g.rect(x0 + (W * hp) / 1000, 0, (W * (e.lag - hp)) / 1000, HH).fill({ color: 0xfff1c8, alpha: 0.9 }); // 방금 깎인 만큼
    // 눈금
    const max = Math.max(1, e.hpMax);
    const small = (W * 100) / max >= 1.6; // 가는 선끼리 1.6px 은 떨어져야 그림
    for (let v = small ? 100 : 1000; v < max; v += small ? 100 : 1000) {
      const x = x0 + Math.round((W * v) / max * 2) / 2;
      const big = v % 1000 === 0;
      g.rect(x - (big ? 0.5 : 0.25), 0, big ? 1 : 0.5, big ? HH : Math.ceil(HH * 0.6)).fill({ color: 0x120c16, alpha: big ? 0.95 : 0.7 });
    }
    if (player) {
      bar(HH + 1, SH, e.en, 0xf0a020, 0xffe08a, 0x3a2a10); // 기력
      bar(HH + 2 + SH, SH, e.res, 0x2f7bff, 0x9cc8ff, 0x16224a); // 마나
    }
    const top = 2 - H * k - 2;
    e.label.y = top;
    if (e.title) e.title.y = top - 13;
    e.icons.y = top + 34 - (e.title ? 13 : 0);
  }

  private animate(e: Ent, base: Action, dt: number, now: number) {
    e.animMs += e.stop > 0 ? 0 : dt; // 히트스톱: 잠깐 멈춤
    e.stop = Math.max(0, e.stop - dt);
    e.flash = Math.max(0, e.flash - dt);
    let kx = 0;
    let ky = 0;
    if (e.knock) {
      e.knock.ms += dt;
      const k = Math.max(0, 1 - e.knock.ms / 160) ** 2;
      kx = Math.round(e.knock.dx * 4 * k);
      ky = Math.round(e.knock.dy * 3 * k);
      if (e.knock.ms >= 160) e.knock = null;
    }
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
      e.sprite.position.set(Math.round(e.x + ox + kx), Math.round(e.y + oy + ky + (dead ? Math.min(6, e.deadMs / 100) : 0)));
      e.sprite.alpha = dead ? Math.max(0, 1 - e.deadMs / 800) : 1;
      e.sprite.tint = e.flash > 0 ? 0xff9090 : 0xffffff;
      e.sprite.zIndex = e.y;
      e.shadow.position.set(e.x, e.y - 1);
      e.plate.alpha = dead ? 0 : 1;
      return;
    }
    // 플레이어: 대시 > 공격 · 시전(끝날 때까지) > 이동
    const rolling = !!(e.flags & F_ROLL);
    let action = base;
    if (e.act && now < e.act.until) action = e.act.kind;
    else e.act = null;
    if (rolling) action = "dash";
    if (action !== e.action) {
      e.action = action;
      e.animMs = 0;
      if (action === "dash") { this.fx.burst(e.x, e.y - 1, "dust", 8); e.trail = 99; } // 박차는 흙먼지
    }
    // 회전: 2단계 이상 바뀌면 중간 방향을 거쳐 돎 (§8-2)
    e.turnMs += dt;
    if (e.shown !== e.dir && e.turnMs >= 40) {
      e.turnMs = 0;
      const diff = (e.dir - e.shown + 8) % 8;
      e.shown = (e.shown + (diff <= 4 ? 1 : 7)) % 8;
    }
    // 공격 · 시전 · 대시는 동작 길이에 8프레임을 맞춤 (끝까지 다 보임), 나머지는 fps 로 반복
    const span = action === "dash" ? ROLL.steps * SIM_MS : (action === "attack" || action === "cast") && e.act ? e.act.until - e.act.from : 0;
    const f = span ? Math.min(FRAMES - 1, Math.floor((e.animMs / span) * FRAMES)) : Math.floor((e.animMs / 1000) * ACTION_FPS[action]) % FRAMES;
    e.sprite.texture = e.frames[e.shown][ACTIONS.indexOf(dead ? "idle" : action) * FRAMES + (dead ? 0 : f)];
    // 사망: 옆으로 누움. 대시는 전용 동작(몸을 낮추고 앞으로 기울인 질주) + 잔상 · 흙먼지 (예전 90° 회전 구르기를 바꿈)
    e.sprite.rotation = dead ? -Math.PI / 2 : 0;
    e.sprite.anchor.set(0.5, dead ? 0.75 : CHAR_FEET / CHAR_H);
    e.sprite.position.set(e.x + kx, e.y - (dead ? 3 : 0) + ky);
    if (rolling && !dead) {
      e.trail += dt;
      if (e.trail >= 45) {
        e.trail = 0;
        this.fx.ghost(e.sprite, Number.parseInt(elColor(e.info.el ?? "none").slice(1), 16) || 0x9fd8ff);
        if (e.animMs < ROLL.steps * SIM_MS * 0.6) this.fx.burst(e.x, e.y - 1, "dust", 2);
      }
    }
    e.sprite.alpha = dead ? 0.75 : e.info.pet ? 0.5 : e.fx.some((r) => r[0] === "stealth") ? 0.4 : 1;
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
      others: [...this.ents.values()].filter((e) => e.sprite.visible && !e.info.pet && !(e.flags & F_DEAD)).map((e) => ({ x: e.x, y: e.y, mob: e.mob, party: this.partyIds.has(e.info.id), foe: this.isFoe(e), name: e.info.name, lv: e.info.lv, boss: !!e.info.grade && e.info.grade !== "normal" })),
      v: [this.v[0], this.v[1], mp, this.v[3], en, this.v[5], this.v[6]],
      cds,
      fx: this.myFx.map((r) => [r[0], Math.max(0, r[1] - age), r[2], r[3], r[4]] as FxRow).filter((r) => r[1] > 0 || r[3] === 0),
      dead: this.deadUntil ? Math.max(0, this.deadUntil - now) : 0,
      hint: this.nearNode() ? `${ITEMS[GATHER[this.nodes.get(this.nearNode()!)!.kind].item].name} 채집` : !this.near ? null : this.near.type === "portal" ? `${josa(this.near.name, "으로/로")} 이동` : this.near.type === "npc" ? `${this.near.name}에게 말 걸기` : `${this.near.name} 열기`,
      sel: this.sel,
      potion: this.v[12] ?? 0,
      charge: this.charging ? Math.min(1, (now - this.charging.at) / (this.skill(this.charging.slot)?.charge?.ms ?? 1000)) : -1,
      marks: this.pings.map((p) => ({ x: p.x, y: p.y, k: p.k })),
      spots: (this.spots = this.spots.filter((s) => s.until > now)),
      wheel: this.wheel ? { sx: this.wheel.sx, sy: this.wheel.sy, sel: this.wheelSel(this.wheel) } : null,
      ghost: this.ghost,
      deadKind: this.deadKind,
      bossHp: this.bossId ? (this.ents.get(this.bossId)?.hp ?? 0) : -1,
      duelIn: this.duelFoes.size && now < this.duelAt ? this.duelAt - now : 0,
      dbg: this.debug ? this.debugStats(now) : null,
      goal: this.goal ? { x: this.goal.ent?.x ?? this.goal.x, y: this.goal.ent?.y ?? this.goal.y, label: this.goal.label, tiles: Math.round(Math.hypot(this.goal.x - this.me.x, this.goal.y - this.me.y) / TILE), dir: dir8(this.goal.x - this.me.x, this.goal.y - this.me.y) } : null,
    };
  }

  /** 버그 제보 스크린샷: 화면을 작게(가로 최대 960) JPEG 로 — 서버 한도(약 220KB) 안에 들도록 */
  async screenshot(): Promise<string | null> {
    // 지금 보이는 화면만 (전체 맵이 아니라 · 컬링된 것도 화면 밖이라 상관없음)
    const src = this.app.renderer.extract.canvas({ target: this.app.stage, frame: new Rectangle(0, 0, this.app.screen.width, this.app.screen.height) }) as HTMLCanvasElement;
    for (const [w, q] of [[960, 0.6], [720, 0.5], [480, 0.45]] as const) {
      const k = Math.min(1, w / src.width);
      const c = Object.assign(document.createElement("canvas"), { width: Math.round(src.width * k), height: Math.round(src.height * k) });
      c.getContext("2d")!.drawImage(src, 0, 0, c.width, c.height);
      const url = c.toDataURL("image/jpeg", q);
      if (url.length <= 210_000) return url;
    }
    return null;
  }

  private debugStats(now: number) {
    if (now - this.bw.at >= 1000) {
      this.bw.kbps = this.bw.at ? ((this.net.bytes - this.bw.bytes) / 1024) / ((now - this.bw.at) / 1000) : 0;
      this.bw = { bytes: this.net.bytes, at: now, kbps: this.bw.kbps };
    }
    const drawn = this.entityLayer.children.filter((c) => c.visible && !c.culled).length;
    return { cpu: this.cpuMs, dt: this.dtMs, ents: this.ents.size + 1, drawn, rtt: this.net.rtt, tick: this.net.tickMs, kbps: this.bw.kbps };
  }
}

let shadow: Texture | null = null;
const shadowTex = () => (shadow ??= Texture.from(shadowCanvas()));

/**
 * 큰 구운 캔버스 → 1024px(월드 512px) 조각 스프라이트들 (Codex 리뷰: 2배 바닥이 최대 3584×3840 — 2048 텍스처 한계 기기 ·
 * 모바일 메모리). 조각은 컬링되어 화면에 들어온 것만 GPU 에 올라감.
 */
function chunked(c: HTMLCanvasElement) {
  const box = new Container();
  const N = 1024;
  for (let y = 0; y < c.height; y += N)
    for (let x = 0; x < c.width; x += N) {
      const part = Object.assign(document.createElement("canvas"), { width: Math.min(N, c.width - x), height: Math.min(N, c.height - y) });
      part.getContext("2d")!.drawImage(c, x, y, part.width, part.height, 0, 0, part.width, part.height);
      const s = new Sprite(hdTex(part));
      s.position.set(x / R, y / R);
      s.cullable = true;
      box.addChild(s);
    }
  c.width = c.height = 0; // 큰 캔버스 메모리 바로 돌려줌
  return box;
}

/** 월드 그림(R 배 캔버스) → 해상도 R 텍스처: 월드 크기는 그대로, 픽셀은 R² 배 */
function hdTex(c: HTMLCanvasElement) {
  return new Texture({ source: new CanvasSource({ resource: c, resolution: R }) });
}

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
