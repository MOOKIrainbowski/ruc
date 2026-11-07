import { BitmapText, Container, Graphics, Sprite, Texture } from "pixi.js";
import { ELEMENTS, type ElementId } from "../shared/data/elements";
import { Px } from "./art/px";

/**
 * 전투 이펙트 (§12-1 속성 색 · 파티클, §13-1 피해 숫자, §10-2 바닥 경고).
 * 파티클 · 숫자는 미리 만든 스프라이트를 돌려 씀(풀링, §29). 품질 낮음 = 파티클 25%.
 */

/** 속성별 파티클: 색 2개 · 중력(px/s², 음수면 위로) · 속력 · 수명 ms */
const STYLE: Record<ElementId | "hit" | "heal", { c: [string, string]; g: number; v: number; life: number }> = {
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
};
export const elColor = (el: string) => (ELEMENTS as Record<string, { color: string }>)[el]?.color ?? "#ffffff";

type Particle = { s: Sprite; x: number; y: number; vx: number; vy: number; g: number; life: number; age: number };
type Num = { t: BitmapText; x: number; y: number; age: number; life: number; crit: boolean };
type Proj = { s: Sprite; x: number; y: number; vx: number; vy: number; left: number; el: string; trail: number };
type Warn = { g: Graphics; age: number; ms: number; draw: (k: number) => void };

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
  shake = 0;

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
    this.nums.push({ t, x: x + (Math.random() - 0.5) * 8, y, age: 0, life: crit ? 1100 : 850, crit });
  }

  /** 투사체 (서버가 판정, 여기서는 직선으로 그리기만) */
  projectile(id: number, x: number, y: number, vx: number, vy: number, range: number, el: string) {
    const s = new Sprite(orb());
    s.anchor.set(0.5);
    s.tint = elColor(el);
    this.world.addChild(s);
    this.projs.set(id, { s, x, y, vx, vy, left: range, el, trail: 0 });
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
    if (burst) this.burst(p.x, p.y - 12, p.el || "hit", 8);
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

  /** 근접 휘두르기 호 (월드) */
  swing(x: number, y: number, ang: number, range: number, color: string) {
    const g = new Graphics();
    g.position.set(x, y - 12);
    g.arc(0, 0, range * 0.8, ang - 0.8, ang + 0.8).stroke({ color, width: 2, alpha: 0.85 });
    this.world.addChild(g);
    this.warns.push({ g, age: 0, ms: 160, draw: (k) => (g.alpha = 1 - k) });
  }

  update(dt: number, toScreen: (x: number, y: number) => [number, number]) {
    const s = dt / 1000;
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
      n.t.position.set(sx + jitter, Math.round(sy - 26 * Math.sqrt(k)));
      n.t.alpha = k > 0.7 ? 1 - (k - 0.7) / 0.3 : 1;
    }
    for (const [id, p] of this.projs) {
      const step = Math.min(p.left, Math.sqrt(p.vx * p.vx + p.vy * p.vy) * s);
      const len = Math.sqrt(p.vx * p.vx + p.vy * p.vy) || 1;
      p.x += (p.vx / len) * step;
      p.y += (p.vy / len) * step;
      p.left -= step;
      p.s.position.set(Math.round(p.x), Math.round(p.y - 12));
      p.trail += dt;
      if (p.trail > 30) { p.trail = 0; this.burst(p.x, p.y - 12, p.el || "none", 1); }
      if (p.left <= 0) this.endProjectile(id, false);
    }
    for (let i = this.warns.length - 1; i >= 0; i--) {
      const w = this.warns[i];
      w.age += dt;
      if (w.age >= w.ms) { w.g.destroy(); this.warns.splice(i, 1); continue; }
      w.draw(w.age / w.ms);
    }
    this.shake = Math.max(0, this.shake - dt);
  }
}
