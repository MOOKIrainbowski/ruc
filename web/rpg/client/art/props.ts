import { OUTLINE, Px, hash } from "./px";

type Prop = { type: string; x: number; y: number; width: number; height: number; properties?: { name: string; value: string | number | boolean }[] };
type Ramp = readonly [string, string, string, string, string]; // 반사광 · 밝음 · 기본 · 그늘 · 깊은 그늘

const WOOD: Ramp = ["#edc58a", "#cb9658", "#986238", "#704426", "#492c20"];
const WOOD2: Ramp = ["#e5b879", "#b98149", "#82512e", "#5b3925", "#38251e"];
const IRON: Ramp = ["#fff0c4", "#d4c2a0", "#8f806d", "#5c5048", "#38303a"];
const CLOTH: Ramp = ["#fff0d5", "#dfc69d", "#ad8e61", "#795d3e", "#4a382b"];
const HAY: Ramp = ["#fff0a6", "#e5c75f", "#bd9738", "#8e6d29", "#594525"];
const FIRE = ["#fff7c5", "#ffe36a", "#ff9b36", "#ed4d2c", "#a72b27"] as const;

/** 논리 오브젝트 픽셀을 2×2 그림 픽셀로 칠합니다. */
const rect = (p: Px, x: number, y: number, w: number, h: number, c: string) => p.rect(x * 2, y * 2, w * 2, h * 2, c);
const dot = (p: Px, x: number, y: number, c: string) => p.rect(x * 2, y * 2, 2, 2, c);
const speck = (p: Px, x: number, y: number, c: string) => p.set(x, y, c); // 최종 해상도 1px 결
function crateFace(p: Px, x: number, y: number, w: number, h: number, wood: Ramp) {
  const top = Math.max(2, Math.floor(h * 0.25));
  for (let row = 0; row < top; row++) rect(p, x + row, y + row, w - row * 2, 1, row < 2 ? wood[0] : wood[1]);
  box(p, x + 1, y + top, w - 2, h - top - 1, wood);
  rect(p, x + 2, y + top + 2, Math.max(1, w - 4), 1, wood[1]);
  for (let i = 0; i < Math.min(6, w - 4); i++) speck(p, (x + 2 + i * 2) * 2, (y + top + 3 + ((i * 3) % Math.max(1, h - top - 5))) * 2, i % 2 ? wood[3] : wood[0]);
  for (let i = 0; i < Math.min(w, h); i++) { dot(p, x + 2 + i, y + top + 1 + i, wood[3]); dot(p, x + w - 3 - i, y + top + 1 + i, wood[1]); }
  for (const [bx, by] of [[x + 2, y + top + 1], [x + w - 3, y + top + 1], [x + 2, y + h - 3], [x + w - 3, y + h - 3]]) speck(p, bx * 2, by * 2, IRON[4]);
}
function box(p: Px, x: number, y: number, w: number, h: number, c: Ramp) {
  if (w < 1 || h < 1) return;
  rect(p, x, y, w, h, c[2]);
  rect(p, x, y, w, 1, c[1]); rect(p, x, y, 1, h, c[1]);
  rect(p, x + w - 1, y, 1, h, c[3]); rect(p, x, y + h - 1, w, 1, c[3]);
  dot(p, x, y, c[0]);
  rect(p, x + w - 1, y + h - 1, 1, 1, c[4]);
}
function ellipse(p: Px, cx: number, cy: number, rx: number, ry: number, c: string) {
  p.ellipse(Math.round(cx * 2), Math.round(cy * 2), Math.max(1, Math.round(rx * 2)), Math.max(1, Math.round(ry * 1.25)), c);
}
function ball(p: Px, cx: number, cy: number, rx: number, ry: number, c: Ramp) {
  for (let y = -ry; y <= ry; y++) for (let x = -rx; x <= rx; x++) {
    const nx = x / (rx + 0.5), ny = y / (ry + 0.5);
    if (nx * nx + ny * ny > 1) continue;
    const l = -(nx * 0.65 + ny * 0.8);
    rect(p, cx + x, cy + y, 1, 1, l > 0.48 ? c[0] : l > 0.12 ? c[1] : l < -0.62 ? c[4] : l < -0.2 ? c[3] : c[2]);
  }
}
function post(p: Px, x: number, y: number, h: number, c = WOOD) {
  box(p, x, y, 3, h, c);
  rect(p, x + 1, y + 2, 1, Math.max(1, h - 5), c[3]);
}
function seedOf(o: Prop) { return hash(Math.floor(o.x), Math.floor(o.y)); }
function woodVariant(s: number): Ramp { return s > 0.66 ? WOOD2 : WOOD; }

function draw(kind: string, p: Px, o: Prop, frame = 0) {
  const w = Math.floor(o.width), h = Math.floor(o.height), s = seedOf(o);
  const cx = Math.floor(w / 2);
  switch (kind) {
    case "barrel": {
      const wood = woodVariant(s);
      ellipse(p, cx, h * 0.24, w * 0.39, h * 0.13, wood[4]);
      box(p, 2, Math.floor(h * 0.22), w - 4, Math.floor(h * 0.62), wood);
      ellipse(p, cx, Math.floor(h * 0.83), w * 0.37, h * 0.12, wood[4]);
      ellipse(p, cx, Math.floor(h * 0.22), w * 0.38, h * 0.13, wood[1]);
      ellipse(p, cx, Math.floor(h * 0.23), w * 0.31, h * 0.09, wood[2]);
      for (const y of [Math.floor(h * 0.38), Math.floor(h * 0.7)]) { rect(p, 1, y, w - 2, 2, IRON[3]); rect(p, 2, y, w - 4, 1, IRON[1]); }
      for (let x = 4; x < w - 3; x += Math.max(4, Math.floor(w / 4))) rect(p, x, Math.floor(h * 0.35), 1, Math.floor(h * 0.43), wood[3]);
      speck(p, 4, 7, wood[0]); speck(p, 6, 8, wood[1]);
      break;
    }
    case "crate": {
      const wood = woodVariant(s);
      crateFace(p, 0, 0, w, h, wood);
      break;
    }
    case "crate_stack": {
      const half = Math.floor(w / 2), bh = Math.floor(h * 0.58);
      // 아래 상자 두 개, 위에는 한 개를 서로 다른 나뭇결로 엇갈려 얹습니다.
      crateFace(p, 0, h - bh, half + 1, bh, WOOD2);
      crateFace(p, half - 1, h - bh, w - half + 1, bh, WOOD);
      crateFace(p, Math.floor(w * 0.25), 0, Math.floor(w * 0.52), Math.floor(h * 0.62), woodVariant(s + 0.3));
      break;
    }
    case "sack": {
      const bag = s > 0.5 ? CLOTH : ["#f4e8c9", "#d7c49e", "#ad9870", "#79684e", "#514331"] as const;
      ball(p, cx, Math.floor(h * 0.58), Math.floor(w * 0.38), Math.floor(h * 0.37), bag);
      box(p, cx - 3, Math.floor(h * 0.16), 6, 3, bag);
      rect(p, cx - 4, Math.floor(h * 0.25), 8, 1, WOOD2[3]);
      for (let i = 0; i < 5; i++) speck(p, 2 * cx - 7 + i * 5, Math.floor(h * 0.52) * 2 + (i % 2), i % 2 ? bag[1] : bag[3]);
      rect(p, cx - 2, h - 3, 4, 1, bag[4]);
      break;
    }
    case "haystack": {
      ball(p, Math.floor(w * 0.35), Math.floor(h * 0.68), Math.floor(w * 0.33), Math.floor(h * 0.26), HAY);
      ball(p, Math.floor(w * 0.68), Math.floor(h * 0.7), Math.floor(w * 0.3), Math.floor(h * 0.23), ["#f9e88e", "#e2bd55", "#bd9234", "#8c6929", "#594425"]);
      for (let i = 0; i < 24; i++) {
        const x = 2 + Math.floor(hash(i, Math.floor(o.x), 31) * Math.max(1, w - 4));
        const y = Math.floor(h * 0.45) + Math.floor(hash(Math.floor(o.y), i, 43) * Math.max(1, h * 0.4));
        speck(p, x * 2, y * 2, i % 3 ? HAY[3] : HAY[0]);
      }
      rect(p, cx - 1, Math.floor(h * 0.6), 2, Math.floor(h * 0.3), WOOD2[3]);
      break;
    }
    case "log": {
      const y = Math.floor(h * 0.5), thick = Math.max(6, Math.floor(h * 0.5));
      box(p, 2, y, w - 7, thick, WOOD2);
      ellipse(p, w - 4, y + Math.floor(thick / 2), 4, Math.floor(thick / 2), WOOD[2]);
      ellipse(p, w - 4, y + Math.floor(thick / 2), 3, Math.max(2, Math.floor(thick / 2) - 2), "#dfb981");
      ellipse(p, w - 4, y + Math.floor(thick / 2), 1, Math.max(1, Math.floor(thick / 4)), WOOD[3]);
      for (let x = 4; x < w - 7; x += 5) { rect(p, x, y + 2, 1, thick - 4, WOOD2[3]); speck(p, x * 2 + 1, (y + 3) * 2, WOOD[0]); }
      dot(p, 3, y + 1, WOOD[0]);
      if (s > 0.55) { dot(p, w - 11, y - 1, "#6dae3e"); dot(p, w - 9, y - 2, "#9edb5c"); }
      break;
    }
    case "fence": {
      const wood = woodVariant(s);
      const n = Math.max(3, Math.floor(w / 7));
      for (let i = 0; i < n; i++) {
        const x = Math.floor((i * (w - 4)) / (n - 1)) + 1;
        post(p, x, Math.floor(h * 0.16), Math.floor(h * 0.76), wood);
        rect(p, x, Math.floor(h * 0.12), 3, 2, wood[0]);
      }
      for (const y of [Math.floor(h * 0.35), Math.floor(h * 0.67)]) { box(p, 0, y, w, 3, wood); rect(p, 1, y, w - 2, 1, wood[0]); }
      for (let i = 0; i < 7; i++) speck(p, (i * 13 + Math.floor(s * 20)) % (w * 2), Math.floor(h * 0.35) * 2 + 1, wood[3]);
      break;
    }
    case "mushroom": {
      const red = s > 0.5 ? ["#fff2cc", "#eab85d", "#b8752e", "#875126", "#4a3022"] as const : ["#fff1dd", "#f17768", "#c8433b", "#8f2c31", "#4b252c"] as const;
      const n = w >= 28 ? 3 : 2;
      for (let i = 0; i < n; i++) {
        const mx = Math.floor((i + 1) * w / (n + 1));
        const my = Math.floor(h * (0.4 + (i % 2) * 0.13));
        const r = i === 1 ? 4 : 3;
        rect(p, mx - 1, my, 3, h - my - 2, "#f3e4c5");
        ball(p, mx, my, r + 2, Math.max(2, r), red);
        for (let k = 0; k < 3; k++) speck(p, (mx - r + k * 3) * 2, (my - 2 + (k % 2)) * 2, "#fff6db");
        speck(p, (mx - 2) * 2, my * 2, "#fff6db");
      }
      rect(p, 2, h - 2, w - 4, 1, "#6e5336");
      break;
    }
    case "flowerpot": {
      const pot: Ramp = s > 0.55 ? ["#f0a477", "#cf7048", "#a84932", "#74352d", "#43272b"] : ["#f2b278", "#d58b50", "#ad6439", "#78452d", "#482e26"];
      const rimY = Math.floor(h * 0.58);
      rect(p, cx - 5, rimY - 2, 10, 2, pot[1]); rect(p, cx - 4, rimY, 8, 1, "#513b2e");
      for (let y = rimY + 1; y < h - 1; y++) {
        const inset = Math.floor((y - rimY) / 3);
        box(p, cx - 5 + inset, y, 10 - inset * 2, 1, pot);
      }
      post(p, cx - 1, 3, rimY - 3, ["#c0e874", "#77b74b", "#4e883a", "#32663a", "#254437"]);
      for (const [x, y, c] of [[cx - 5, 6, "#79bb45"], [cx + 2, 5, "#a1d657"], [cx - 3, 2, "#65a740"], [cx + 4, 8, "#79bb45"]] as [number, number, string][]) { rect(p, x, y, 3, 1, c); dot(p, x + 1, y - 1, c); }
      const bloom = s > 0.75 ? "#f6d56d" : s > 0.4 ? "#b77bd4" : "#f16c7d";
      dot(p, cx - 4, 3, bloom); dot(p, cx + 2, 2, bloom); speck(p, (cx - 4) * 2, 4, "#fff0a6");
      break;
    }
    case "banner": {
      const cloth = s > 0.66 ? ["#fff2c9", "#dfc65e", "#b49332", "#796026", "#473623"] as const : s > 0.33 ? ["#f7d8ff", "#b776d3", "#874a9e", "#59335f", "#382630"] as const : ["#ffd9d2", "#e76b62", "#bc403d", "#812d35", "#48272f"] as const;
      const poleX = Math.max(2, Math.floor(w * 0.18));
      const clothX = poleX + 2, clothW = Math.max(5, w - clothX - 2), top = 5, bottom = h - 4;
      rect(p, poleX, 1, 2, h - 1, WOOD2[3]); rect(p, poleX - 1, 1, 4, 1, IRON[1]);
      rect(p, poleX - 1, 0, 4, 1, IRON[0]); // 깃대 꼭지
      rect(p, poleX, top - 1, clothX + clothW - poleX, 2, WOOD2[2]); // 가로대
      for (let y = top; y < bottom; y++) {
        const fold = Math.floor((y - top) / 7) % 2;
        const wave = s > 0.5 && y % 5 === 0 ? 1 : 0;
        const notch = y >= bottom - 4 ? Math.min(Math.floor(clothW / 2) - 1, (y - (bottom - 4)) * Math.max(1, Math.floor(clothW / 5)) + 1) : 0;
        const left = clothX + wave, right = clothX + clothW - wave;
        if (notch) {
          const mid = Math.floor((left + right) / 2);
          rect(p, left, y, Math.max(1, mid - left - Math.floor(notch / 2)), 1, fold ? cloth[1] : cloth[2]);
          rect(p, mid + Math.ceil(notch / 2), y, Math.max(1, right - mid - Math.ceil(notch / 2)), 1, fold ? cloth[3] : cloth[2]);
        } else rect(p, left, y, right - left, 1, y < top + 2 ? cloth[0] : fold ? cloth[1] : cloth[2]);
        rect(p, clothX, y, 1, 1, cloth[0]);
        rect(p, clothX + clothW - 1, y, 1, 1, cloth[3]);
      }
      // 천 중앙 문장: 방패 테두리와 위치별 문양으로 16×32 · 32×48 모두 읽히게
      const mx = clothX + Math.floor(clothW / 2), my = top + Math.floor((bottom - top) * 0.48);
      dot(p, mx, my - 2, "#f6d56d"); rect(p, mx - 1, my - 1, 3, 3, "#f6d56d"); dot(p, mx, my + 2, cloth[4]);
      dot(p, mx, my - 1, cloth[0]); rect(p, mx - 1, my, 3, 1, cloth[0]);
      break;
    }
    case "sign": {
      const wood = woodVariant(s);
      post(p, cx - 1, Math.floor(h * 0.38), Math.floor(h * 0.62), wood);
      const bw = Math.max(12, w - 2), bh = Math.max(7, Math.floor(h * 0.46)), x = Math.floor((w - bw) / 2), y = 2;
      box(p, x, y, bw, bh, wood);
      rect(p, x + 2, y + 2, bw - 4, 1, wood[0]);
      const mark = Math.floor(s * 4);
      if (mark === 0) { rect(p, cx - 3, y + 3, 7, 1, WOOD2[3]); rect(p, cx - 2, y + 5, 5, 1, WOOD2[3]); }
      else if (mark === 1) { dot(p, cx - 2, y + 3, "#f4d06f"); dot(p, cx + 1, y + 5, "#f4d06f"); }
      else if (mark === 2) { rect(p, cx - 1, y + 3, 2, 4, "#dfe6bd"); rect(p, cx - 3, y + 4, 6, 1, "#dfe6bd"); }
      else { rect(p, cx - 4, y + 3, 8, 1, "#8fd0a0"); rect(p, cx - 2, y + 5, 4, 1, "#8fd0a0"); }
      break;
    }
    case "board": {
      const wood = woodVariant(s);
      post(p, 3, Math.floor(h * 0.68), Math.ceil(h * 0.32), wood); post(p, w - 6, Math.floor(h * 0.68), Math.ceil(h * 0.32), wood);
      box(p, 0, 0, w, Math.floor(h * 0.72), wood);
      rect(p, 2, 2, w - 4, Math.floor(h * 0.65) - 3, "#b78958");
      for (let i = 0; i < 4; i++) {
        const x = 3 + (i % 2) * Math.floor((w - 8) / 2), y = 3 + Math.floor(i / 2) * Math.max(5, Math.floor(h * 0.3));
        const col = ["#fff0d5", "#ffe58a", "#d6edff", "#f3bbd1"][(i + Math.floor(s * 4)) % 4];
        rect(p, x, y, Math.max(5, Math.floor((w - 9) / 2)), Math.max(5, Math.floor(h * 0.25)), col);
        for (let l = 1; l < 4; l++) rect(p, x + 1, y + l * 2, Math.max(2, Math.floor((w - 12) / 2) - (l % 2) * 2), 1, l === 1 ? "#8b6e54" : "#b29a78");
        dot(p, x + 1, y + 1, "#df5753");
      }
      break;
    }
    case "mailbox": {
      post(p, cx - 1, Math.floor(h * 0.54), Math.floor(h * 0.46), WOOD2);
      const top = Math.floor(h * 0.2);
      box(p, 2, top + 2, w - 4, Math.floor(h * 0.42), ["#bed8ff", "#6994d6", "#3f69ad", "#294b83", "#1c315c"]);
      ellipse(p, cx, top + 2, Math.floor(w * 0.38), 3, "#75a0dd");
      rect(p, 4, top + Math.floor(h * 0.37), w - 8, 2, "#263e6a");
      rect(p, 5, top + Math.floor(h * 0.35), w - 10, 1, "#e4f2ff");
      const flagX = s > 0.5 ? w - 3 : 2;
      rect(p, flagX, top - 3, 2, 7, IRON[3]); rect(p, flagX, top - 3, 5, 2, s > 0.5 ? "#ef625d" : "#f3c34f");
      if (s > 0.72) { rect(p, cx - 2, top + 4, 4, 3, "#fff0d5"); rect(p, cx - 1, top + 5, 2, 1, "#d66b5c"); }
      break;
    }
    case "workbench": {
      const wood = woodVariant(s);
      const top = Math.floor(h * 0.5);
      box(p, 0, top, w, 4, wood); rect(p, 1, top, w - 2, 1, wood[0]);
      post(p, 2, top + 4, h - top - 4, wood); post(p, w - 5, top + 4, h - top - 4, wood);
      rect(p, 3, top + Math.floor((h - top) * 0.55), w - 6, 2, wood[3]);
      // vice · hammer · chisels and a few bright filings
      box(p, 2, top - 4, 5, 4, IRON); rect(p, 3, top - 2, 3, 1, IRON[4]);
      rect(p, Math.floor(w * 0.55), top - 7, 2, 7, WOOD2[3]); rect(p, Math.floor(w * 0.48), top - 8, 7, 2, IRON[2]); rect(p, Math.floor(w * 0.48), top - 9, 3, 1, IRON[0]);
      for (let i = 0; i < 4; i++) speck(p, (w - 6 - i * 3) * 2, (top - 2 + (i % 2)) * 2, i % 2 ? "#f5d273" : "#85bd83");
      break;
    }
    case "anvil": {
      const top = Math.floor(h * 0.43);
      box(p, 3, top, w - 6, 4, IRON);
      rect(p, 4, top, w - 8, 1, IRON[0]);
      // Horn and heel, with the wide face seen from above.
      for (let i = 0; i < 5; i++) rect(p, Math.max(0, 2 - i), top + i, 4 + i, 1, i < 2 ? IRON[1] : IRON[2]);
      rect(p, w - 7, top - 1, 5, 2, IRON[1]);
      box(p, cx - 4, top + 4, 8, Math.floor(h * 0.22), IRON);
      box(p, cx - 6, top + Math.floor(h * 0.22) + 4, 12, Math.max(3, h - top - Math.floor(h * 0.22) - 6), WOOD2);
      rect(p, 5, top + 1, 4, 1, "#fff0c4");
      if (s > 0.72) { speck(p, 4, (top - 3) * 2, "#ffe07a"); speck(p, 7, (top - 5) * 2, "#ff9851"); }
      break;
    }
    case "bench": {
      const wood = woodVariant(s);
      const top = Math.floor(h * 0.42);
      box(p, 0, top, w, 3, wood); rect(p, 1, top, w - 2, 1, wood[0]);
      box(p, 1, top + 3, w - 2, 3, wood);
      post(p, 2, top + 6, h - top - 6, WOOD2); post(p, w - 5, top + 6, h - top - 6, WOOD2);
      rect(p, 3, top + Math.floor((h - top) * 0.55), w - 6, 2, wood[3]);
      for (let i = 0; i < 4; i++) speck(p, i * 4, top * 2 + 1, wood[i % 2]);
      break;
    }
    case "lamp": {
      post(p, cx - 1, 5, h - 5, IRON);
      box(p, cx - 5, h - 4, 10, 3, IRON);
      rect(p, cx - 8, 5, 16, 2, IRON[2]);
      box(p, cx - 6, 0, 12, 7, IRON);
      rect(p, cx - 4, 2, 8, 4, "#ffd779"); rect(p, cx - 3, 2, 5, 1, "#fff7ce"); rect(p, cx + 3, 3, 1, 3, "#cc8537");
      rect(p, cx - 7, 0, 14, 1, IRON[0]);
      // 작은 유리 반사광
      speck(p, (cx - 3) * 2, 5, "#ffffff"); speck(p, (cx - 2) * 2 + 1, 6, "#fff4bd");
      break;
    }
    case "campfire": {
      const t = (frame / 8) * Math.PI * 2;
      const l = Math.sin(t) * 2 + Math.cos(t * 2) * 1.2;
      const y = Math.floor(h * 0.69);
      // Crossed split logs, oval ends and bark notches.
      rect(p, 2, y + 2, w - 4, 4, WOOD2[3]); rect(p, 4, y, w - 8, 4, WOOD[2]);
      ellipse(p, 3, y + 3, 2, 2, WOOD[0]); ellipse(p, w - 3, y + 3, 2, 2, WOOD2[1]);
      for (let i = 0; i < 5; i++) speck(p, (3 + i * Math.max(1, Math.floor((w - 6) / 5))) * 2, (y + 2 + (i % 2)) * 2, WOOD[4]);
      const top = Math.floor(h * 0.24 + l);
      // Three distinct jagged tongues; frame changes lift and lean the tips.
      const flames: [number, number, number][] = [[cx - 4, top + 4, 4], [cx, top, 5], [cx + 4, top + 5, 3]];
      for (let i = 0; i < flames.length; i++) {
        const [fx, fy, hh] = flames[i];
        const sway = Math.round(Math.sin(t + i * 1.4) * 2);
        for (let yy = 0; yy < hh; yy++) {
          const half = yy < 2 ? 0 : yy < hh - 1 ? 1 : 2;
          rect(p, fx + sway - half, fy + yy, half * 2 + 1, 1, FIRE[Math.min(4, yy === 0 ? 1 : yy < hh * 0.5 ? 2 : 3)]);
        }
        rect(p, fx + sway, fy + Math.floor(hh * 0.52), 1, Math.max(1, Math.floor(hh * 0.38)), FIRE[0]);
      }
      for (let i = 0; i < 3; i++) speck(p, (cx - 5 + i * 5) * 2 + (frame % 2), (top - 2 - ((frame + i) % 3)) * 2, i % 2 ? "#ffd970" : "#fff1a4");
      break;
    }
  }
}

function frame(o: Prop, kind: string, n = 0): HTMLCanvasElement {
  const w = Math.max(1, Math.floor(o.width)), h = Math.max(1, Math.floor(o.height));
  const src = new Px(w * 2, h * 2);
  draw(kind, src, o, n);
  src.outline(OUTLINE);
  const out = new Px((w + 12) * 2, (h + 8) * 2);
  out.draw(src, 12, 16); // PAD_X=6 · PAD_TOP=8, 2× 그림 해상도
  out.outline(OUTLINE);
  return out.toCanvas();
}

/** 오브젝트 위치·종류로 결정적인 형태 차이를 주고, 모닥불은 8프레임으로 흔들립니다. */
export const PROPS: Record<string, (o: Prop) => HTMLCanvasElement[]> = {
  barrel: (o) => [frame(o, "barrel")],
  crate: (o) => [frame(o, "crate")],
  crate_stack: (o) => [frame(o, "crate_stack")],
  sack: (o) => [frame(o, "sack")],
  haystack: (o) => [frame(o, "haystack")],
  log: (o) => [frame(o, "log")],
  fence: (o) => [frame(o, "fence")],
  mushroom: (o) => [frame(o, "mushroom")],
  flowerpot: (o) => [frame(o, "flowerpot")],
  banner: (o) => [frame(o, "banner")],
  sign: (o) => [frame(o, "sign")],
  board: (o) => [frame(o, "board")],
  mailbox: (o) => [frame(o, "mailbox")],
  workbench: (o) => [frame(o, "workbench")],
  anvil: (o) => [frame(o, "anvil")],
  bench: (o) => [frame(o, "bench")],
  lamp: (o) => [frame(o, "lamp")],
  campfire: (o) => Array.from({ length: 8 }, (_, i) => frame(o, "campfire", i)),
};
