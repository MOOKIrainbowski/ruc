import { BitmapText, Container, Graphics, Rectangle, Sprite, Text, Texture } from "pixi.js";
import { ELEMENTS, type ElementId } from "../shared/data/elements";
import { Px } from "./art/px";
import { t } from "./i18n";

/**
 * 전투 이펙트 (§12-1 속성 색 · 파티클, §13-1 피해 숫자, §10-2 바닥 경고).
 * 파티클 · 숫자는 미리 만든 스프라이트를 돌려 씀(풀링, §29). 품질 낮음 = 파티클 25%.
 */

/** 속성별 파티클: 색 2개 · 중력(px/s², 음수면 위로) · 속력 · 수명 ms */
const STYLE: Record<ElementId | "hit" | "heal" | "dust", { c: [string, string]; g: number; v: number; life: number }> = {
  water: { c: [ELEMENTS.water.color, "#9ee0fa"], g: 260, v: 70, life: 420 },
  fire: { c: [ELEMENTS.fire.color, "#FFD27A"], g: -120, v: 50, life: 480 },
  earth: { c: [ELEMENTS.earth.color, "#8c6642"], g: 420, v: 80, life: 380 },
  grass: { c: [ELEMENTS.grass.color, "#a3e635"], g: 60, v: 55, life: 600 },
  wind: { c: [ELEMENTS.wind.color, "#ffffff"], g: -30, v: 110, life: 380 },
  electric: { c: [ELEMENTS.electric.color, "#ffffff"], g: 0, v: 140, life: 220 },
  ice: { c: [ELEMENTS.ice.color, "#ffffff"], g: 90, v: 45, life: 650 },
  light: { c: [ELEMENTS.light.color, "#ffffff"], g: -80, v: 60, life: 520 },
  dark: { c: [ELEMENTS.dark.color, "#3a2a5e"], g: -50, v: 45, life: 620 },
  poison: { c: [ELEMENTS.poison.color, "#7A2FBF"], g: -70, v: 40, life: 650 },
  none: { c: [ELEMENTS.none.color, "#ffffff"], g: 0, v: 90, life: 300 },
  iron: { c: [ELEMENTS.iron.color, "#ffb347"], g: 380, v: 120, life: 320 },
  hit: { c: ["#ffffff", "#ffe3cf"], g: 200, v: 70, life: 250 },
  heal: { c: ["#4CC764", "#b5f07a"], g: -60, v: 25, life: 700 },
  dust: { c: ["#d8cbb0", "#b3a385"], g: -25, v: 28, life: 420 },
};
export const elColor = (el: string) => (ELEMENTS as Record<string, { color: string }>)[el]?.color ?? "#ffffff";

type Particle = { s: Sprite; x: number; y: number; vx: number; vy: number; g: number; life: number; age: number };
type Num = { t: BitmapText; x: number; y: number; age: number; life: number; crit: boolean; side: number };
type Proj = { s: Sprite; x: number; y: number; vx: number; vy: number; left: number; el: string; trail: number; ult?: Sprite };
type Warn = { g: Graphics; age: number; ms: number; draw: (k: number) => void };
type Ghost = { s: Sprite; age: number; ms: number };
/** 처치 조각: 몹 그림을 잘게 잘라 튕겨 날림 */
type Shard = { s: Sprite; x: number; y: number; z: number; vx: number; vy: number; vz: number; spin: number; age: number; life: number };

const NUM_STYLE = { fontFamily: "Galmuri11", fontSize: 14, fill: "#ffffff", stroke: { color: "#1b1420", width: 3 } };

let orbTex: Texture | null = null;
function orb() {
  if (!orbTex) {
    const p = new Px(7, 7);
    p.ellipse(3, 3, 3, 3, "#ffffffaa");
    p.ellipse(3, 3, 2, 2, "#ffffff");
    orbTex = Texture.from(p.toCanvas());
  }
  return orbTex;
}

export class Fx {
  /** 월드 좌표 (확대됨) · 바닥 경고는 엔티티 아래 */
  world = new Container();
  ground = new Container();
  /** 화면 좌표 (피해 숫자) */
  screen = new Container();
  maxParticles = 400;
  private free: Sprite[] = [];
  private parts: Particle[] = [];
  private nums: Num[] = [];
  private freeNums: BitmapText[] = [];
  projs = new Map<number, Proj>();
  private warns: Warn[] = [];
  private ghosts: Ghost[] = [];
  private shards: Shard[] = [];
  shake = 0;
  /** 흔들림 세기(px) · 방향(맞은 쪽으로 밀림) */
  shakeAmp = 2;
  private kick = { x: 0, y: 0 };
  /** 화면 펀치 줌 (처치 · 치명타 순간 살짝 당겨짐, 0 = 그대로) */
  punch = 0;
  /** 화면 오버레이: 번쩍임 · 낮은 체력 붉은 테두리 · 연타 수 */
  private overlay = new Graphics();
  private flashes: { color: number; a: number; age: number; ms: number }[] = [];
  private danger = 0;
  private dangerT = 0;
  private comboN = 0;
  private comboAt = 0;
  private comboText: Text | null = null;
  private comboSub: Text | null = null;
  private comboPop = 0;
  /** 화면 좌표 연출 (궁극기 컷인 · 어두워짐) — draw(k 0→1, 화면 폭, 높이) */
  private screenFx: { g: Container; age: number; ms: number; draw: (k: number, sw: number, sh: number) => void }[] = [];
  /** 잠시 뒤 실행 (궁극기 대상 지정형: 시전이 끝나는 순간 명중 연출) */
  private later: { at: number; fn: () => void }[] = [];
  /** 같은 자리 연속 궁극기 명중(성역 · 강철 결계 …)은 두 번째부터 가볍게 */
  private lastUlt = { x: 0, y: 0, at: 0 };

  constructor() {
    this.screen.addChild(this.overlay);
  }

  setQuality(q: "low" | "medium" | "high") {
    this.maxParticles = q === "low" ? 100 : q === "medium" ? 400 : 800;
  }

  /** 파티클 n 개 (월드 px) */
  burst(x: number, y: number, kind: string, n: number) {
    const st = STYLE[kind as keyof typeof STYLE] ?? STYLE.hit;
    const k = this.maxParticles / 400;
    for (let i = 0; i < Math.max(1, Math.round(n * k)); i++) {
      if (this.parts.length >= this.maxParticles) return;
      const s = this.free.pop() ?? new Sprite(Texture.WHITE);
      s.tint = st.c[i % 2];
      s.width = s.height = Math.random() < 0.3 ? 2 : 1;
      s.visible = true;
      this.world.addChild(s);
      const a = Math.random() * Math.PI * 2;
      const v = st.v * (0.4 + Math.random() * 0.8);
      this.parts.push({ s, x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v * 0.7 - 20, g: st.g, life: st.life * (0.6 + Math.random() * 0.6), age: 0 });
    }
  }

  /** 떠오르는 숫자 · 글자 (화면 좌표는 매 프레임 toScreen 으로) */
  number(x: number, y: number, text: string, color: string, crit = false) {
    const t = this.freeNums.pop() ?? new BitmapText({ text: "", style: NUM_STYLE });
    t.text = text;
    t.tint = color;
    t.anchor.set(0.5, 1);
    t.scale.set(crit ? 1.5 : 1);
    t.alpha = 1;
    t.visible = true;
    this.screen.addChild(t);
    this.nums.push({ t, x: x + (Math.random() - 0.5) * 8, y, age: 0, life: crit ? 1100 : 850, crit, side: Math.random() < 0.5 ? -1 : 1 });
  }

  /** 투사체 (서버가 판정, 여기서는 직선으로 그리기만). ult = 궁극기: 2배 크기 + 빛무리 + 촘촘한 꼬리 */
  projectile(id: number, x: number, y: number, vx: number, vy: number, range: number, el: string, ult = false) {
    const s = new Sprite(orb());
    s.anchor.set(0.5);
    s.tint = elColor(el);
    if (ult) s.scale.set(2.2);
    this.world.addChild(s);
    let glow: Sprite | undefined;
    if (ult) {
      glow = new Sprite(orb());
      glow.anchor.set(0.5);
      glow.scale.set(5.5);
      glow.tint = elColor(el);
      glow.alpha = 0.45;
      glow.blendMode = "add";
      this.world.addChild(glow);
    }
    this.projs.set(id, { s, x, y, vx, vy, left: range, el, trail: 0, ult: glow });
  }

  /**
   * 궁극기 시전 (2026-11-14 피드백: "궁극기가 Q 스킬과 별로 달라 보이지 않는다" → 모든 스킬 중 가장 화려하게):
   * 바닥에 돌며 커지는 2중 마법진(육망성 · 룬 점) · 색 빛기둥 · 위로 솟는 소용돌이 입자 · 발밑 충격파.
   * mine = 내 궁극기 → 화면이 잠깐 어두워지고 사선 컷인 배너(스킬 이름) · 펀치 줌 · 흔들림.
   */
  ultCast(x: number, y: number, color: string, name: string | null) {
    const c = color;
    // 바닥 마법진
    const g = new Graphics();
    g.position.set(x, y);
    g.blendMode = "add";
    this.ground.addChild(g);
    this.warns.push({
      g, age: 0, ms: 1100,
      draw: (k) => {
        const open = 1 - (1 - Math.min(1, k / 0.3)) ** 3;
        const a = k > 0.7 ? (1 - k) / 0.3 : 1;
        const R = 46 * open;
        const rot = k * 3.2;
        g.clear();
        g.scale.set(1, 0.55);
        g.circle(0, 0, R).stroke({ color: c, width: 2.5, alpha: 0.95 * a });
        g.circle(0, 0, R * 0.86).stroke({ color: 0xffffff, width: 1, alpha: 0.7 * a });
        g.circle(0, 0, R * 0.5).stroke({ color: c, width: 1.5, alpha: 0.8 * a });
        for (let t = 0; t < 2; t++) { // 육망성 (두 삼각형이 반대로 돎)
          const pts: number[] = [];
          for (let i = 0; i < 3; i++) { const an = (t ? -rot : rot) + (i / 3) * Math.PI * 2 + t * Math.PI; pts.push(Math.cos(an) * R * 0.84, Math.sin(an) * R * 0.84); }
          g.poly(pts).stroke({ color: t ? 0xffffff : c, width: 1.5, alpha: 0.85 * a });
        }
        for (let i = 0; i < 12; i++) { const an = -rot * 1.5 + (i / 12) * Math.PI * 2; g.rect(Math.cos(an) * R * 0.93 - 1.5, Math.sin(an) * R * 0.93 - 1.5, 3, 3).fill({ color: i % 2 ? 0xffffff : c, alpha: a }); }
        g.circle(0, 0, R).fill({ color: c, alpha: 0.16 * a });
      },
    });
    // 빛기둥
    const pl = new Graphics();
    pl.blendMode = "add";
    this.ground.addChild(pl); // 캐릭터 뒤 (위에 덮으면 캐릭터가 하얗게 지워짐)
    this.warns.push({
      g: pl, age: 0, ms: 900,
      draw: (k) => {
        const h = 190 * Math.min(1, k * 5);
        const a = k < 0.5 ? 0.75 : 0.75 * (1 - (k - 0.5) / 0.5);
        const w = 14 * (1 - k * 0.6);
        pl.clear().rect(x - w, y - h, w * 2, h).fill({ color: c, alpha: a * 0.45 }).rect(x - w * 0.4, y - h, w * 0.8, h).fill({ color: 0xffffff, alpha: a * 0.8 });
      },
    });
    // 위로 솟는 소용돌이 입자 · 발밑 충격파
    for (let i = 0; i < 5; i++) this.burst(x, y - 8 - i * 22, "light", 6);
    this.burst(x, y - 10, "hit", 18);
    this.shock(x, y, c, 70, 520);
    this.shock(x, y, 0xffffff, 44, 380);
    if (!name) return;
    // 내 궁극기: 화면 어둡게 → 사선 컷인 배너
    this.flash(0xffffff, 0.35, 180);
    this.punch = 1;
    this.quake(260, 4);
    const dim = new Container();
    const dg = new Graphics();
    dim.addChild(dg);
    const text = new Text({ text: name, style: { fontFamily: "Galmuri11", fontSize: 34, fontWeight: "bold", fill: "#ffffff", stroke: { color: "#1b1420", width: 6 }, letterSpacing: 2 } });
    text.anchor.set(0.5);
    const sub = new Text({ text: t("fx.ult"), style: { fontFamily: "Galmuri11", fontSize: 13, fill: c, stroke: { color: "#1b1420", width: 4 }, letterSpacing: 6 } });
    sub.anchor.set(0.5);
    dim.addChild(text, sub);
    this.screen.addChild(dim);
    this.screenFx.push({
      g: dim, age: 0, ms: 1250,
      draw: (k, sw, sh) => {
        const inK = Math.min(1, k / 0.14);
        const outK = k > 0.78 ? (k - 0.78) / 0.22 : 0;
        const a = (1 - outK);
        dg.clear();
        dg.rect(0, 0, sw, sh).fill({ color: 0x0a0612, alpha: 0.38 * a * inK }); // 주변이 어두워짐
        const cy = sh * 0.2; // 캐릭터 머리 위 이름표와 겹치지 않게 위쪽
        const band = 74;
        const slide = (1 - (1 - inK) ** 3) * sw * 1.4 - sw * 0.2 + outK * sw * 0.9; // 왼쪽에서 들어와 오른쪽으로 빠짐
        const skew = 60;
        dg.poly([slide - sw * 1.2, cy - band / 2, slide + skew, cy - band / 2, slide - skew + 0, cy + band / 2, slide - sw * 1.2 - skew, cy + band / 2]).fill({ color: 0x120a1e, alpha: 0.82 * a });
        dg.poly([slide - sw * 1.2, cy - band / 2 - 4, slide + skew + 4, cy - band / 2 - 4, slide + skew, cy - band / 2, slide - sw * 1.2, cy - band / 2]).fill({ color: c, alpha: a });
        dg.poly([slide - sw * 1.2 - skew, cy + band / 2, slide - skew, cy + band / 2, slide - skew - 4, cy + band / 2 + 4, slide - sw * 1.2 - skew - 4, cy + band / 2 + 4]).fill({ color: c, alpha: a });
        for (let i = 0; i < 9; i++) { // 띠 위를 흐르는 속도선
          const lx = ((i * 197 + k * sw * 3) % (sw + 200)) - 100;
          dg.rect(lx, cy - band / 2 + 8 + ((i * 23) % (band - 16)), 60 + (i % 3) * 40, 2).fill({ color: 0xffffff, alpha: 0.35 * a });
        }
        const tx = Math.min(sw / 2, slide - sw * 0.5);
        text.position.set(Math.round(tx + (k > 0.14 && k < 0.78 ? (k - 0.14) * 30 : 0)), Math.round(cy - 4));
        sub.position.set(Math.round(tx - 10), Math.round(cy + 24));
        text.alpha = sub.alpha = a * inK;
        const pop = k < 0.2 ? 1.35 - (k / 0.2) * 0.35 : 1;
        text.scale.set(pop);
      },
    });
  }

  /** ms 뒤 궁극기 명중 연출 (대상 지정형) */
  ultLater(ms: number, x: number, y: number, color: string, near: number) {
    this.later.push({ at: performance.now() + ms, fn: () => this.ultImpact(x, y, 40, color, near) });
  }

  /**
   * 궁극기 명중: 3겹 충격파 · 큰 빛살 · 가운데 빛 · 불씨 입자 · 그을린 자국. near = 내 화면과의 가까움 0~1 (번쩍임 · 흔들림 세기).
   * 같은 자리에서 0.6초 안에 또 오면(반복형 궁극기) 가벼운 판으로.
   */
  ultImpact(x: number, y: number, r: number, color: string, near: number) {
    const now = performance.now();
    const again = now - this.lastUlt.at < 650 && Math.hypot(x - this.lastUlt.x, y - this.lastUlt.y) < 48;
    this.lastUlt = { x, y, at: now };
    const R = Math.max(40, r * 1.25);
    this.shock(x, y, color, R, 420);
    this.burst(x, y - 8, color === "#4CC764" ? "heal" : "hit", again ? 10 : 30);
    if (again) return;
    this.shock(x, y, 0xffffff, R * 0.7, 300);
    this.later.push({ at: now + 120, fn: () => this.shock(x, y, color, R * 1.35, 560) });
    // 빛살
    const g = new Graphics();
    g.position.set(x, y - 10);
    g.blendMode = "add";
    this.world.addChild(g);
    const n = this.maxParticles <= 100 ? 10 : 22;
    const rays = Array.from({ length: n }, (_, i) => ({ a: (i / n) * Math.PI * 2 + Math.random() * 0.25, l: 0.6 + Math.random() * 0.6, w: 1 + Math.random() * 2.5 }));
    this.warns.push({
      g, age: 0, ms: 520,
      draw: (k) => {
        g.clear();
        const a = 1 - k;
        for (const ry of rays) {
          const len = R * 1.4 * ry.l * (0.3 + 0.9 * Math.min(1, k * 3));
          g.moveTo(0, 0).lineTo(Math.cos(ry.a) * len, Math.sin(ry.a) * len * 0.62).stroke({ color: Math.random() < 0.3 ? 0xffffff : color, width: ry.w * (1 - k * 0.6), alpha: a });
        }
        g.circle(0, 0, 10 + 30 * k).fill({ color: 0xffffff, alpha: 0.7 * (1 - k) ** 2 });
        g.circle(0, 0, 6 + 46 * k).stroke({ color, width: 3, alpha: a * 0.8 });
      },
    });
    // 그을린 자국 (천천히 사라짐)
    const sc = new Graphics();
    sc.position.set(x, y);
    this.ground.addChild(sc);
    this.warns.push({ g: sc, age: 0, ms: 1800, draw: (k) => sc.clear().ellipse(0, 0, R * 0.62, R * 0.34).fill({ color: 0x1a0f08, alpha: 0.32 * (1 - k) }).ellipse(0, 0, R * 0.4, R * 0.22).stroke({ color, width: 1, alpha: 0.4 * (1 - k) }) });
    // 불씨: 위로 흩날림
    for (let i = 0; i < 4; i++) this.burst(x + (Math.random() - 0.5) * R, y - 6 - Math.random() * 20, "fire", 5);
    if (near > 0) {
      this.flash(0xffffff, 0.28 * near, 160);
      this.quake(220 * near + 60, 2 + 4 * near, 0, -1);
      this.punch = Math.max(this.punch, 0.8 * near);
    }
  }


  /** 투사체 id 바꾸기 (예측한 것을 서버 id 로) */
  rename(from: number, to: number) {
    const p = this.projs.get(from);
    if (!p) return;
    this.projs.delete(from);
    this.projs.set(to, p);
  }

  endProjectile(id: number, burst = true) {
    const p = this.projs.get(id);
    if (!p) return;
    if (burst) this.burst(p.x, p.y - 12, p.el || "hit", p.ult ? 24 : 8);
    if (p.ult) { this.shock(p.x, p.y, elColor(p.el), 36, 320); p.ult.destroy(); }
    p.s.destroy();
    this.projs.delete(id);
  }

  /** 바닥 경고 장판 (§10-2): 테두리 + 안쪽이 시간에 따라 차오름 */
  /** 바닥 경고 (§10-2). team "p" = 내 편 스킬 (금색) */
  telegraph(shape: string, x: number, y: number, ang: number, size: number, width: number, ms: number, team = "") {
    const [fill, line] = team === "p" ? [0xffd27a, 0xfff4b0] : [0xe5484d, 0xff6b6b];
    const g = new Graphics();
    g.position.set(x, y);
    g.rotation = shape === "line" ? ang : 0;
    this.ground.addChild(g);
    const draw = (k: number) => {
      g.clear();
      if (shape === "circle") {
        g.circle(0, 0, size).fill({ color: fill, alpha: 0.18 }).stroke({ color: line, width: 1, alpha: 0.9 });
        g.circle(0, 0, size * k).fill({ color: fill, alpha: 0.3 });
      } else {
        g.rect(0, -width / 2, size, width).fill({ color: fill, alpha: 0.18 }).stroke({ color: line, width: 1, alpha: 0.9 });
        g.rect(0, -width / 2, size * k, width).fill({ color: fill, alpha: 0.3 });
      }
    };
    draw(0);
    this.warns.push({ g, age: 0, ms, draw });
  }

  /** 범위 스킬이 터짐: 퍼지는 고리 + 파티클 */
  ring(x: number, y: number, r: number, kind: string) {
    const color = kind === "heal" ? "#4CC764" : kind ? elColor(kind) : "#fff4dc";
    const g = new Graphics();
    g.position.set(x, y);
    this.ground.addChild(g);
    this.warns.push({ g, age: 0, ms: 320, draw: (k) => g.clear().circle(0, 0, Math.max(2, r * (0.4 + 0.6 * k))).stroke({ color, width: 2, alpha: 1 - k }).fill({ color, alpha: 0.15 * (1 - k) }) });
    this.burst(x, y - 4, kind || "hit", Math.min(24, 6 + Math.round(r / 4)));
  }

  /** 성역의 방패: 적 투사체를 막는 벽 */
  wall(x1: number, y1: number, x2: number, y2: number, ms: number) {
    const g = new Graphics();
    this.world.addChild(g);
    this.warns.push({
      g, age: 0, ms,
      draw: (k) => g.clear().moveTo(x1, y1).lineTo(x2, y2).stroke({ color: 0xfff4b0, width: 4, alpha: k > 0.8 ? (1 - k) * 4 : 0.85 }).moveTo(x1, y1 - 10).lineTo(x2, y2 - 10).stroke({ color: 0xffd27a, width: 2, alpha: 0.4 }),
    });
  }

  /** 레벨업 빛기둥 (§7): 금색 기둥이 솟았다가 사라짐 */
  pillar(x: number, y: number) {
    const g = new Graphics();
    g.blendMode = "add";
    this.world.addChild(g);
    this.warns.push({
      g, age: 0, ms: 1400,
      draw: (k) => {
        const h = 160 * Math.min(1, k * 4);
        const a = k < 0.7 ? 0.55 : 0.55 * (1 - (k - 0.7) / 0.3);
        g.clear().rect(x - 9, y - h, 18, h).fill({ color: 0xffd27a, alpha: a * 0.6 }).rect(x - 4, y - h, 8, h).fill({ color: 0xfff4b0, alpha: a });
      },
    });
    for (let i = 0; i < 4; i++) this.burst(x, y - 20 - i * 30, "light", 8);
  }

  /**
   * 근접 베기 (2026-11-14 타격감): 칼끝이 지나가는 자리를 따라 자라나는 굵은 초승달(가운데 흰 심 · 바깥 색 테두리) → 사라짐.
   * 예전엔 얇은 호 하나가 160ms 깜빡이고 끝나서 "공격 모션이 없다"는 제보.
   */
  swing(x: number, y: number, ang: number, range: number, color: string) {
    const g = new Graphics();
    g.position.set(x, y - 12);
    g.blendMode = "add";
    this.world.addChild(g);
    const r = Math.max(14, range * 0.85);
    const from = ang - 1.15;
    const span = 2.3;
    this.warns.push({
      g, age: 0, ms: 230,
      draw: (k) => {
        const grow = Math.min(1, k / 0.45); // 앞 45% 동안 휘둘러 나감
        const fade = k < 0.45 ? 1 : 1 - (k - 0.45) / 0.55;
        const end = from + span * grow;
        const start = Math.max(from, end - span * 0.85);
        g.clear();
        // 바깥 색 → 안쪽 흰 심 (굵기 차이로 초승달 모양)
        g.arc(0, 0, r, start, end).stroke({ color, width: 5, alpha: 0.35 * fade });
        g.arc(0, 0, r - 1, start + 0.15, end).stroke({ color, width: 3, alpha: 0.7 * fade });
        g.arc(0, 0, r - 1, start + 0.45, end).stroke({ color: 0xffffff, width: 1.5, alpha: fade });
        g.arc(0, 0, r * 0.62, start + 0.6, end - 0.1).stroke({ color, width: 1, alpha: 0.4 * fade });
      },
    });
  }

  /** 타격 불꽃: 맞은 곳에서 퍼지는 빛살 + 고리 (치명타는 크고 금색) */
  spark(x: number, y: number, color: string, crit = false) {
    const g = new Graphics();
    g.position.set(x, y);
    g.blendMode = "add";
    this.world.addChild(g);
    const n = crit ? 8 : 6;
    const R = crit ? 16 : 11;
    const rot = Math.random() * Math.PI;
    this.warns.push({
      g, age: 0, ms: crit ? 260 : 190,
      draw: (k) => {
        g.clear();
        const a = 1 - k;
        for (let i = 0; i < n; i++) {
          const ang = rot + (i / n) * Math.PI * 2;
          const len = (i % 2 ? 0.55 : 1) * R * (0.4 + k * 0.8);
          const r0 = R * k * 0.35;
          g.moveTo(Math.cos(ang) * r0, Math.sin(ang) * r0).lineTo(Math.cos(ang) * len, Math.sin(ang) * len).stroke({ color: i % 2 ? color : 0xffffff, width: crit ? 2 : 1.5, alpha: a });
        }
        g.circle(0, 0, R * (0.3 + k * 0.9)).stroke({ color: crit ? 0xffd27a : color, width: 1, alpha: a * 0.8 });
        if (k < 0.35) g.circle(0, 0, 4 * (1 - k)).fill({ color: 0xffffff, alpha: 0.9 });
      },
    });
  }

  /** 시전 마법진: 발밑에서 돌며 커지는 이중 고리 + 룬 점 (ms 동안) */
  circle(x: number, y: number, color: string, ms: number) {
    const g = new Graphics();
    g.position.set(x, y);
    g.blendMode = "add";
    this.ground.addChild(g);
    this.warns.push({
      g, age: 0, ms,
      draw: (k) => {
        const open = Math.min(1, k / 0.25);
        const a = k > 0.8 ? (1 - k) / 0.2 : 1;
        const r = 14 * open;
        g.clear();
        g.scale.set(1, 0.5); // 바닥에 누운 원
        g.circle(0, 0, r).stroke({ color, width: 1.5, alpha: 0.85 * a });
        g.circle(0, 0, r * 0.7).stroke({ color: 0xffffff, width: 1, alpha: 0.5 * a });
        for (let i = 0; i < 6; i++) {
          const ang = k * 4 + (i / 6) * Math.PI * 2;
          g.rect(Math.cos(ang) * r * 0.85 - 1, Math.sin(ang) * r * 0.85 - 1, 2, 2).fill({ color, alpha: a });
        }
        g.circle(0, 0, r).fill({ color, alpha: 0.12 * a });
      },
    });
  }

  /** 잔상 (대시): 지금 그림을 색만 입혀 그 자리에 남기고 ms 동안 흐려짐 */
  ghost(src: Sprite, tint: number, ms = 260) {
    const s = new Sprite(src.texture);
    s.anchor.copyFrom(src.anchor);
    s.position.copyFrom(src.position);
    s.scale.copyFrom(src.scale);
    s.tint = tint;
    s.alpha = 0.55;
    s.blendMode = "add";
    this.ground.addChild(s);
    this.ghosts.push({ s, age: 0, ms });
  }

  /** 화면 흔들림: ms 동안, amp px, (dx, dy) 쪽으로 먼저 튐 */
  quake(ms: number, amp: number, dx = 0, dy = 0) {
    this.shakeAmp = this.shake > 0 ? Math.max(this.shakeAmp, amp) : amp;
    this.shake = Math.max(this.shake, ms);
    this.kick = { x: dx * amp, y: dy * amp };
  }

  /** 지금 프레임의 흔들림 오프셋 (화면 px) */
  shakeOffset(): [number, number] {
    if (this.shake <= 0) return [0, 0];
    const a = this.shakeAmp * Math.min(1, this.shake / 120);
    const k = this.kick;
    this.kick = { x: k.x * 0.6, y: k.y * 0.6 };
    return [Math.round((Math.random() - 0.5) * 2 * a + k.x), Math.round((Math.random() - 0.5) * 2 * a + k.y)];
  }

  /** 화면 전체 번쩍임 (치명타 = 흰색, 크게 맞음 = 빨강) */
  flash(color: number, alpha: number, ms: number) {
    this.flashes.push({ color, a: alpha, age: 0, ms });
  }

  /** 낮은 체력 경고 0~1 (매 프레임) */
  setDanger(k: number) {
    this.danger = k;
  }

  /** 바닥 충격파: 바닥에 누운 고리가 빠르게 퍼짐 */
  shock(x: number, y: number, color: string | number, r: number, ms = 300) {
    const g = new Graphics();
    g.position.set(x, y);
    g.scale.set(1, 0.55);
    g.blendMode = "add";
    this.ground.addChild(g);
    this.warns.push({
      g, age: 0, ms,
      draw: (k) => {
        const e = 1 - (1 - k) ** 3;
        g.clear().circle(0, 0, r * (0.2 + 0.8 * e)).stroke({ color, width: 3 * (1 - k) + 0.5, alpha: 0.9 * (1 - k) });
        g.circle(0, 0, r * 0.75 * e).stroke({ color: 0xffffff, width: 1, alpha: 0.5 * (1 - k) });
      },
    });
  }

  /** 치명타 집중선: 맞은 곳을 향해 모이는 빛줄기 */
  speedLines(x: number, y: number, color: string | number) {
    const g = new Graphics();
    g.position.set(x, y);
    g.blendMode = "add";
    this.world.addChild(g);
    const n = this.maxParticles <= 100 ? 6 : 12;
    const rays = Array.from({ length: n }, (_, i) => ({ a: (i / n) * Math.PI * 2 + Math.random() * 0.3, l: 0.6 + Math.random() * 0.5, w: Math.random() < 0.5 }));
    this.warns.push({
      g, age: 0, ms: 240,
      draw: (k) => {
        g.clear();
        for (const r of rays) {
          const r1 = 46 * r.l * (1 - k * 0.5);
          const r0 = r1 * (0.35 + 0.5 * k);
          g.moveTo(Math.cos(r.a) * r0, Math.sin(r.a) * r0 * 0.8).lineTo(Math.cos(r.a) * r1, Math.sin(r.a) * r1 * 0.8).stroke({ color: r.w ? 0xffffff : color, width: 1.5, alpha: 1 - k });
        }
      },
    });
  }

  /** 처치: 그림을 조각내 튕겨 날림 (위로 솟았다가 바닥에 튀고 사라짐). (dx, dy) = 날아갈 쪽 */
  shatter(src: Sprite, dx: number, dy: number) {
    const tex = src.texture;
    const f = tex.frame;
    const C = 4; // 조각 크기 (그림 px)
    const flip = src.scale.x < 0;
    const ox = src.x - f.width * src.anchor.x;
    const oy = src.y - f.height * src.anchor.y;
    const lim = this.maxParticles / 8; // 품질: 낮음 12 · 중간 50 · 높음 100 조각 (Codex 리뷰: 군중 전투에서 과함)
    let n = 0;
    for (let y = 0; y < f.height; y += C) for (let x = 0; x < f.width; x += C) {
      if (n >= lim || Math.random() < 0.35) continue; // 일부만 (가볍게 · 덜 규칙적으로)
      const piece = new Sprite(new Texture({ source: tex.source, frame: new Rectangle(f.x + x, f.y + y, Math.min(C, f.width - x), Math.min(C, f.height - y)) }));
      piece.anchor.set(0.5);
      if (flip) piece.scale.x = -1;
      this.world.addChild(piece);
      const px = ox + (flip ? f.width - x - C / 2 : x + C / 2);
      const py = oy + y + C / 2;
      const v = 40 + Math.random() * 90;
      const a = Math.atan2(dy, dx) + (Math.random() - 0.5) * 2.2;
      this.shards.push({ s: piece, x: px, y: src.y, z: src.y - py, vx: Math.cos(a) * v, vy: Math.sin(a) * v * 0.5, vz: 60 + Math.random() * 120, spin: (Math.random() - 0.5) * 20, age: 0, life: 700 + Math.random() * 500 });
      n++;
    }
    this.burst(src.x, src.y - 12, "hit", 10);
    this.shock(src.x, src.y, 0xfff4dc, 26, 360);
  }

  /** 내 연타 +1 (2.4초 안에 다음 타격이 없으면 끊김) — 10 · 25 · 50 · 100 연타에 칭찬 */
  combo(now: number) {
    this.comboN = now - this.comboAt < 2400 ? this.comboN + 1 : 1;
    this.comboAt = now;
    this.comboPop = 1;
    if (this.comboN < 3) return;
    if (!this.comboText || !this.comboSub) {
      this.comboText = new Text({ text: "", style: { fontFamily: "Galmuri11", fontSize: 30, fontWeight: "bold", fill: "#ffffff", stroke: { color: "#1b1420", width: 5 } } });
      this.comboSub = new Text({ text: "", style: { fontFamily: "Galmuri11", fontSize: 13, fill: "#FFE14D", stroke: { color: "#1b1420", width: 4 } } });
      this.comboText.anchor.set(1, 0.5);
      this.comboSub.anchor.set(1, 0.5);
      this.screen.addChild(this.comboText, this.comboSub);
    }
    const n = this.comboN;
    this.comboText.text = `${n}`;
    this.comboText.style.fill = n >= 100 ? "#ff5cf0" : n >= 50 ? "#ff4040" : n >= 25 ? "#ff8a1f" : n >= 10 ? "#FFD84D" : "#ffffff";
    const praise = n >= 100 ? t("fx.comboLegend") : n >= 50 ? t("fx.comboAmazing") : n >= 25 ? t("fx.comboGreat") : n >= 10 ? t("fx.comboGood") : "";
    this.comboSub.text = praise ? `${t("fx.combo")} · ${praise}` : t("fx.combo");
    if ([10, 25, 50, 100].includes(n)) { this.flash(0xffe14d, 0.16, 220); this.comboPop = 1.8; }
  }

  update(dt: number, toScreen: (x: number, y: number) => [number, number], sw = 0, sh = 0) {
    const s = dt / 1000;
    // 처치 조각: 위로 솟았다 떨어져 바닥에서 한 번 튀고 흐려짐
    for (let i = this.shards.length - 1; i >= 0; i--) {
      const p = this.shards[i];
      p.age += dt;
      if (p.age >= p.life) { p.s.destroy(); this.shards.splice(i, 1); continue; }
      p.vz -= 420 * s;
      p.z += p.vz * s;
      if (p.z < 0) { p.z = 0; p.vz = -p.vz * 0.35; p.vx *= 0.6; p.vy *= 0.6; p.spin *= 0.5; }
      p.x += p.vx * s;
      p.y += p.vy * s;
      p.s.position.set(Math.round(p.x), Math.round(p.y - p.z));
      p.s.rotation += p.spin * s;
      p.s.alpha = p.age > p.life * 0.6 ? 1 - (p.age - p.life * 0.6) / (p.life * 0.4) : 1;
    }
    this.punch = Math.max(0, this.punch - dt / 260);
    const pnow = performance.now();
    for (let i = this.later.length - 1; i >= 0; i--) if (pnow >= this.later[i].at) { const f = this.later[i].fn; this.later.splice(i, 1); f(); }
    for (let i = this.screenFx.length - 1; i >= 0; i--) {
      const f = this.screenFx[i];
      f.age += dt;
      if (f.age >= f.ms) { f.g.destroy({ children: true }); this.screenFx.splice(i, 1); continue; }
      f.draw(f.age / f.ms, sw, sh);
    }
    // 화면 오버레이 (번쩍임 · 낮은 체력 테두리)
    const o = this.overlay.clear();
    for (let i = this.flashes.length - 1; i >= 0; i--) {
      const f = this.flashes[i];
      f.age += dt;
      if (f.age >= f.ms) { this.flashes.splice(i, 1); continue; }
      o.rect(0, 0, sw, sh).fill({ color: f.color, alpha: f.a * (1 - f.age / f.ms) });
    }
    if (this.danger > 0 && sw) {
      this.dangerT += dt;
      const a = this.danger * (0.35 + 0.25 * Math.sin(this.dangerT / 140)); // 심장 박동처럼
      const b = Math.round(Math.min(sw, sh) * 0.09);
      for (let k = 0; k < 6; k++) {
        const w = b * (1 - k / 6);
        o.rect(0, 0, sw, w).rect(0, sh - w, sw, w).rect(0, 0, w, sh).rect(sw - w, 0, w, sh).fill({ color: 0xc81e28, alpha: a / 6 });
      }
    }
    // 연타 수: 오른쪽 가운데, 맞힐 때마다 툭 튀어나옴 · 끊기기 0.6초 전부터 흐려짐
    if (this.comboText && this.comboSub) {
      const left = 2400 - (performance.now() - this.comboAt);
      const vis = this.comboN >= 3 && left > 0;
      this.comboText.visible = this.comboSub.visible = vis;
      if (vis) {
        this.comboPop = Math.max(0, this.comboPop - dt / 140);
        const sc = 1 + this.comboPop * 0.45 + Math.min(0.6, this.comboN / 160);
        this.comboText.scale.set(sc);
        this.comboText.position.set(Math.round(sw - 40), Math.round(sh * 0.42));
        this.comboSub.position.set(Math.round(sw - 40), Math.round(sh * 0.42 + 24 * sc));
        this.comboText.alpha = this.comboSub.alpha = left < 600 ? left / 600 : 1;
        this.comboText.rotation = this.comboPop > 0.5 ? (Math.random() - 0.5) * 0.08 : 0;
      } else if (left <= 0) this.comboN = 0;
    }
    for (let i = this.parts.length - 1; i >= 0; i--) {
      const p = this.parts[i];
      p.age += dt;
      if (p.age >= p.life) {
        p.s.visible = false;
        this.free.push(p.s);
        this.parts[i] = this.parts[this.parts.length - 1];
        this.parts.pop();
        continue;
      }
      p.vy += p.g * s;
      p.x += p.vx * s;
      p.y += p.vy * s;
      p.s.position.set(Math.round(p.x), Math.round(p.y));
      p.s.alpha = 1 - p.age / p.life;
    }
    for (let i = this.nums.length - 1; i >= 0; i--) {
      const n = this.nums[i];
      n.age += dt;
      if (n.age >= n.life) {
        n.t.visible = false;
        this.freeNums.push(n.t);
        this.nums.splice(i, 1);
        continue;
      }
      const k = n.age / n.life;
      const [sx, sy] = toScreen(n.x, n.y);
      const jitter = n.crit && n.age < 200 ? Math.round((Math.random() - 0.5) * 4) : 0;
      const arc = n.crit ? Math.round(n.side * 22 * k) : 0; // 치명타는 옆으로 튀어 떨어짐
      const rise = n.crit ? 34 * Math.sin(Math.min(1, k * 1.6) * Math.PI * 0.75) : 26 * Math.sqrt(k);
      n.t.position.set(sx + jitter + arc, Math.round(sy - rise));
      const base = n.crit ? 1.5 : 1;
      n.t.scale.set(n.age < 110 ? base * (1.7 - (0.7 * n.age) / 110) : base); // 맞는 순간 크게 튀어나옴
      n.t.alpha = k > 0.7 ? 1 - (k - 0.7) / 0.3 : 1;
    }
    for (const [id, p] of this.projs) {
      const step = Math.min(p.left, Math.sqrt(p.vx * p.vx + p.vy * p.vy) * s);
      const len = Math.sqrt(p.vx * p.vx + p.vy * p.vy) || 1;
      p.x += (p.vx / len) * step;
      p.y += (p.vy / len) * step;
      p.left -= step;
      p.s.position.set(Math.round(p.x), Math.round(p.y - 12));
      if (p.ult) { p.ult.position.copyFrom(p.s.position); p.ult.alpha = 0.35 + 0.15 * Math.sin(performance.now() / 40); }
      p.trail += dt;
      if (p.trail > (p.ult ? 12 : 30)) { p.trail = 0; this.burst(p.x, p.y - 12, p.el || "none", p.ult ? 3 : 1); }
      if (p.left <= 0) this.endProjectile(id, false);
    }
    for (let i = this.warns.length - 1; i >= 0; i--) {
      const w = this.warns[i];
      w.age += dt;
      if (w.age >= w.ms) { w.g.destroy(); this.warns.splice(i, 1); continue; }
      w.draw(w.age / w.ms);
    }
    for (let i = this.ghosts.length - 1; i >= 0; i--) {
      const g = this.ghosts[i];
      g.age += dt;
      if (g.age >= g.ms) { g.s.destroy(); this.ghosts.splice(i, 1); continue; }
      g.s.alpha = 0.55 * (1 - g.age / g.ms);
    }
    this.shake = Math.max(0, this.shake - dt);
  }
}
