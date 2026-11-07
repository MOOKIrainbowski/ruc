import { Container, Graphics, RenderTexture, Sprite, Texture, type Application } from "pixi.js";

/**
 * 사실적 그래픽 모드 (설정 → 그래픽 모드 "사실적"). 도트 그림은 그대로 두고 빛을 입힘:
 *  ① 하루 주기(24분) 조명 — 새벽 · 낮 · 노을 · 밤. 밤에는 가로등 · 모닥불 · 포털 · 내 캐릭터 주변만 밝음 (라이트맵 곱하기)
 *  ② 해 위치를 따르는 길게 늘어진 그림자 (캐릭터 · 몹 · 나무 · 건물), 낮 · 밤에 따라 진하기 변화
 *  ③ 비네트(가장자리 어둡게) · 따뜻한 색보정 · 가로등 빛 번짐 · 떠다니는 빛 입자
 * 꺼져 있으면(기본) 아무것도 만들지 않음 — 낮은 사양에서는 기본 모드 권장.
 */

export type Light = { x: number; y: number; r: number; color: number; flicker?: number };
type View = { zoom: number; wx: number; wy: number; sw: number; sh: number };

const DAY_MS = 24 * 60_000;
/** 하루 시각 0..1 → 주변광 [r, g, b] (1 = 원색 그대로) */
const AMBIENT: [number, [number, number, number]][] = [
  [0.0, [0.42, 0.48, 0.7]],
  [0.2, [1.0, 0.8, 0.64]],
  [0.3, [1, 1, 1]],
  [0.62, [1, 0.98, 0.94]],
  [0.72, [1, 0.72, 0.55]],
  [0.82, [0.46, 0.5, 0.74]],
  [1.0, [0.42, 0.48, 0.7]],
];
export function ambientAt(t: number): [number, number, number] {
  for (let i = 1; i < AMBIENT.length; i++) {
    const [t1, c1] = AMBIENT[i];
    const [t0, c0] = AMBIENT[i - 1];
    if (t <= t1) {
      const k = (t - t0) / (t1 - t0);
      return [0, 1, 2].map((j) => c0[j] + (c1[j] - c0[j]) * k) as [number, number, number];
    }
  }
  return AMBIENT[0][1];
}
/** 낮 정도 0(한밤)..1(한낮) */
export const daylight = (t: number) => Math.max(0, Math.min(1, ambientAt(t).reduce((a, b) => a + b, 0) / 3 - 0.3) / 0.7);

function radial(size: number, stops: [number, string][]) {
  const c = Object.assign(document.createElement("canvas"), { width: size, height: size });
  const ctx = c.getContext("2d")!;
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  for (const [o, col] of stops) g.addColorStop(o, col);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  return Texture.from(c);
}

export class Realism {
  private on = false;
  private app: Application;
  private world: Container;
  private stage: Container;
  private shadowLayer = new Container();
  private overlay = new Container();
  private lightScene = new Container();
  private ambient = new Graphics().rect(0, 0, 4, 4).fill(0xffffff);
  private lightSprites: Sprite[] = [];
  private lightTex = radial(128, [[0, "rgba(255,255,255,1)"], [0.45, "rgba(255,255,255,0.55)"], [1, "rgba(255,255,255,0)"]]);
  private rt: RenderTexture | null = null;
  private lightView: Sprite | null = null;
  private vignette: Sprite | null = null;
  private motes: { s: Sprite; x: number; y: number; ph: number; sp: number }[] = [];
  private shadows = new Map<Sprite, Sprite>();
  private staticShadows: Sprite[] = [];
  private size = "";
  private clock = Math.random() * 0.2 + 0.35; // 시작은 낮 (0.35~0.55)
  private startedAt = performance.now();

  constructor(app: Application, world: Container, stage: Container, entityLayer: Container, screenLayer: Container) {
    this.app = app;
    this.world = world;
    this.stage = stage;
    this.shadowLayer.visible = false;
    this.overlay.visible = false;
    this.world.addChildAt(this.shadowLayer, Math.max(0, this.world.getChildIndex(entityLayer)));
    this.stage.addChildAt(this.overlay, this.stage.getChildIndex(screenLayer));
  }

  get enabled() { return this.on; }
  /** 하루 시각 0..1 (하루 24분, 접속 때 낮에서 시작) */
  get time() { return (this.clock + (performance.now() - this.startedAt) / DAY_MS) % 1; }

  setEnabled(on: boolean) {
    if (on === this.on) return;
    this.on = on;
    this.shadowLayer.visible = on;
    this.overlay.visible = on;
    if (on) this.build();
  }

  private build() {
    if (this.vignette) return;
    this.vignette = new Sprite(radial(256, [[0, "rgba(0,0,0,0)"], [0.62, "rgba(10,8,24,0)"], [1, "rgba(10,8,24,0.62)"]]));
    this.lightScene.addChild(this.ambient);
    for (let i = 0; i < 60; i++) {
      const s = new Sprite(this.lightTex);
      s.anchor.set(0.5);
      s.blendMode = "add";
      s.visible = false;
      this.lightScene.addChild(s);
      this.lightSprites.push(s);
    }
    const dot = radial(8, [[0, "rgba(255,244,190,1)"], [1, "rgba(255,244,190,0)"]]);
    for (let i = 0; i < 36; i++) {
      const s = new Sprite(dot);
      s.anchor.set(0.5);
      s.blendMode = "add";
      s.alpha = 0.55;
      this.overlay.addChild(s);
      this.motes.push({ s, x: Math.random(), y: Math.random(), ph: Math.random() * 6.28, sp: 0.01 + Math.random() * 0.02 });
    }
    this.overlay.addChild(this.vignette);
  }

  /** 오브젝트(나무 · 건물 …)의 고정 그림자 — 한 번만 만듦 */
  addStatic(src: Sprite) {
    const s = new Sprite(src.texture);
    s.anchor.copyFrom(src.anchor);
    s.position.copyFrom(src.position);
    s.tint = 0x000000;
    this.shadowLayer.addChild(s);
    this.staticShadows.push(s);
  }

  private shadowOf(src: Sprite) {
    let s = this.shadows.get(src);
    if (!s) {
      s = new Sprite(src.texture);
      s.tint = 0x000000;
      this.shadowLayer.addChild(s);
      this.shadows.set(src, s);
    }
    return s;
  }

  update(view: View, lights: Light[], sprites: Sprite[], playerLight: { x: number; y: number }) {
    if (!this.on || !this.vignette) return;
    const t = this.time;
    const day = daylight(t);
    const sunPhase = Math.max(0, Math.min(1, (t - 0.22) / 0.56)); // 0 동쪽(아침) → 1 서쪽(저녁)
    const elev = Math.sin(sunPhase * Math.PI); // 한낮 1
    const skew = (sunPhase - 0.5) * 1.5;
    const len = 0.28 + (1 - elev) * 0.85;
    const alpha = 0.12 + day * 0.2;

    // ② 그림자
    const apply = (s: Sprite, o: Sprite) => {
      s.texture = o.texture;
      s.anchor.copyFrom(o.anchor);
      s.position.copyFrom(o.position);
      s.scale.set(o.scale.x, -len * Math.abs(o.scale.y));
      s.skew.x = skew;
      s.alpha = o.visible ? alpha * o.alpha : 0;
      s.zIndex = 0;
      s.visible = o.visible;
    };
    for (const [src, sh] of this.shadows) if (src.destroyed) { sh.destroy(); this.shadows.delete(src); }
    for (const src of sprites) if (!src.destroyed && src.rotation === 0) apply(this.shadowOf(src), src);
    for (const [src, sh] of this.shadows) if (src.destroyed || src.rotation !== 0) sh.visible = false;
    for (const s of this.staticShadows) {
      s.scale.set(1, -len);
      s.skew.x = skew;
      s.alpha = alpha;
    }

    // ① 라이트맵 (화면의 절반 해상도)
    const w = Math.max(2, Math.ceil(view.sw / 2));
    const h = Math.max(2, Math.ceil(view.sh / 2));
    if (this.size !== `${w}x${h}`) {
      this.size = `${w}x${h}`;
      this.rt?.destroy(true);
      this.rt = RenderTexture.create({ width: w, height: h, scaleMode: "linear" });
      if (!this.lightView) {
        this.lightView = new Sprite(this.rt);
        this.lightView.blendMode = "multiply";
        this.overlay.addChildAt(this.lightView, 0);
      } else this.lightView.texture = this.rt;
      this.lightView.scale.set(2);
      this.ambient.width = w;
      this.ambient.height = h;
    }
    const [ar, ag, ab] = ambientAt(t);
    this.ambient.tint = (Math.round(ar * 255) << 16) | (Math.round(ag * 255) << 8) | Math.round(ab * 255);
    const night = 1 - day;
    const now = performance.now() / 1000;
    const all: Light[] = [...lights, { ...playerLight, r: 70 + night * 40, color: 0xffe2b0 }];
    this.lightSprites.forEach((s, i) => {
      const l = all[i];
      s.visible = !!l;
      if (!l) return;
      const flick = l.flicker ? 1 + Math.sin(now * 13 + i * 2.1) * l.flicker + Math.sin(now * 7.3 + i) * l.flicker * 0.6 : 1;
      s.position.set(((view.wx + l.x * view.zoom) | 0) / 2, ((view.wy + l.y * view.zoom) | 0) / 2);
      const px = (l.r * 2 * view.zoom * flick) / 2 / 128; // 라이트맵 픽셀 / 텍스처 픽셀
      s.scale.set(px);
      s.tint = l.color;
      s.alpha = Math.min(1, 0.35 + night * 0.8);
    });
    this.app.renderer.render({ container: this.lightScene, target: this.rt!, clear: true });

    // ③ 비네트 · 빛 입자
    this.vignette.width = view.sw;
    this.vignette.height = view.sh;
    this.vignette.alpha = 0.55 + night * 0.25;
    for (const m of this.motes) {
      m.y -= m.sp * 0.016;
      if (m.y < -0.05) { m.y = 1.05; m.x = Math.random(); }
      m.s.position.set((m.x + Math.sin(now * 0.6 + m.ph) * 0.02) * view.sw, m.y * view.sh);
      m.s.scale.set(0.7 + Math.sin(now * 2 + m.ph) * 0.3);
      m.s.alpha = (0.25 + day * 0.35) * (0.6 + Math.sin(now * 1.7 + m.ph) * 0.4);
    }
  }
}
