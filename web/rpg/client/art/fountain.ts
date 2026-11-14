import { Px } from "./px";

/**
 * 광장 분수 2배 그림 (2026-11-14 피드백 2차: "어떤 부분은 정면, 어떤 부분은 위에서 본 모양 — 시점을 통일").
 * 모든 부분을 같은 3/4 시점(위에서 약 55°)으로: 바닥에 누운 원 = 가로:세로 1 : 0.6 타원, 세워진 면 = 높이 0.85.
 * 수반 앞벽은 원통 투영 — 돌 블록 세로 줄눈이 같은 각도 간격이라 가장자리로 갈수록 좁아 보임(진짜 둥근 벽).
 * 3단: 수반(바깥 원 반지름 60 월드 px) → 발루스터 기둥 → 큰 접시 → 작은 접시 → 도토리 꼭지 + 솟는 물. 8프레임.
 * 캔버스 280×272 (오브젝트 128×128 + 여백, 2배), 바닥 타원 중심 = 캔버스 아래에서 78px (월드 39px 위 = 오브젝트 y − 39).
 * 충돌 = 같은 바닥 타원 (plaza.json, scripts/fountain-collision 참고: 중심 768,768 · 가로 60 · 세로 36).
 */

const W = 280;
const H = 272;
const CX = 140;
const GY = H - 78; // 바닥 타원 중심
const RX = 120; // 수반 바깥 (그림 px)
const RY = 72; // = RX × 0.6
const WALL = 22; // 앞벽 높이
const TY = GY - WALL; // 테두리 윗면 타원 중심
const RIM = 16; // 테두리 윗면 너비
const ST = ["#fdf8ec", "#efe5d0", "#dacbb0", "#bfae90", "#9c8a6c", "#76664e", "#544836"] as const;
const WT = ["#f2fdff", "#bdeefc", "#86d6f4", "#58b8e6", "#3a96cd", "#2a74ad", "#1e5285"] as const;

const sq = (k: number) => Math.sqrt(Math.max(0, 1 - k * k));
const inE = (x: number, y: number, rx: number, ry: number) => (x / rx) ** 2 + (y / ry) ** 2 <= 1;
const clampI = (i: number, n: number) => Math.max(0, Math.min(n - 1, Math.round(i)));

/** 물낯: 잔물결 고리가 가운데에서 밖으로 퍼짐 + 깊이 명암 + 반짝임 */
function water(p: Px, cx: number, cy: number, rx: number, ry: number, f: number, seed: number) {
  for (let y = -ry; y <= ry; y++)
    for (let x = -rx; x <= rx; x++) {
      if (!inE(x, y, rx, ry)) continue;
      const d = Math.sqrt((x / rx) ** 2 + (y / ry) ** 2);
      // 잔물결: 가운데에서 퍼지는 가는 고리 (흔들림 섞어 과녁처럼 보이지 않게)
      const wob = Math.sin(Math.atan2(y / ry, x / rx) * 5 + seed + f * 0.5) * 0.04;
      const ring = Math.sin((d + wob) * 13 - f * (Math.PI / 4) + seed);
      const dither = ((x + y * 2) & 3) / 4 - 0.4;
      let i = 2.6 - (y / ry) * 1.1 + d * 0.6 + dither * 0.8; // 뒤(위)는 안벽 그늘로 짙고 앞은 하늘을 비춰 밝게
      if (ring > 0.96 && d > 0.25 && d < 0.85) i -= 1; // 잔물결은 옅게 (Codex 리뷰: 수면이 캐릭터보다 튐)
      else if (ring < -0.93) i += 0.8;
      p.set(cx + x, cy + y, WT[clampI(i, WT.length)]);
    }
  for (let k = 0; k < 2; k++) { // 반짝임
    const a = (k / 5) * Math.PI * 2 + f * 0.3 + seed;
    const sx = Math.round(cx + Math.cos(a) * rx * 0.55), sy = Math.round(cy + Math.sin(a) * ry * 0.5);
    if ((f + k) % 3 === 0) { p.set(sx, sy, WT[0]); p.set(sx + 1, sy, WT[0]); p.set(sx - 1, sy, WT[1]); p.set(sx + 2, sy, WT[1]); }
  }
}

/** 둥근 테두리 윗면 (바깥 rx·ry, 너비 rim) + 안벽(뒤쪽만 보임) + 물 (수위 = 윗면보다 drop 아래) */
function basinTop(p: Px, cx: number, cy: number, rx: number, ry: number, rim: number, drop: number, f: number, seed: number) {
  const irx = rx - rim, iry = Math.round(ry - rim * 0.6);
  for (let y = -ry; y <= ry; y++)
    for (let x = -rx; x <= rx; x++) {
      if (!inE(x, y, rx, ry)) continue;
      if (inE(x, y, irx, iry)) continue;
      // 윗면: 왼쪽 위가 밝게, 가장자리 몰딩(바깥 2px) 한 단 밝게
      const nearOut = !inE(x, y, rx - 2, ry - 1.2);
      const nearIn = inE(x, y, irx + 2, iry + 1.2);
      const l = -(x / rx) * 0.5 - (y / ry) * 0.6;
      let i = l > 0.35 ? 1 : l > -0.1 ? 2 : 3;
      if (nearOut) i -= 1;
      if (nearIn) i += 1;
      if ((Math.round(Math.atan2(y / ry, x / rx) / (Math.PI / 16)) & 1) && (x * x) % 7 === 0) i += 1; // 돌 이음매
      p.set(cx + x, cy + y, ST[clampI(i, ST.length)]);
    }
  // 안벽 (뒤쪽 반만 보임) → 물
  for (let y = -iry; y <= iry; y++)
    for (let x = -irx; x <= irx; x++) {
      if (!inE(x, y, irx, iry)) continue;
      if (inE(x, y - drop, irx - 1, iry - 1)) continue; // 물 자리
      const wet = !inE(x, y - drop + 2, irx - 1, iry - 1) ? 0 : 1;
      p.set(cx + x, cy + y, wet ? ST[5] : ST[4]);
    }
  water(p, cx, cy + drop, irx - 1, iry - 1, f, seed);
  // 물 위 안쪽 테두리 그림자 (뒤쪽 테두리가 물에 드리움)
  for (let x = -irx + 2; x <= irx - 2; x++) {
    const y = Math.round(cy + drop - (iry - 1) * sq(x / (irx - 1)));
    p.set(cx + x, y + 1, "#1e528555");
    p.set(cx + x, y + 2, "#1e528533");
  }
}

/** 원통 앞벽: 위 타원 앞 호 ~ 아래 타원 앞 호, 같은 각도 간격 세로 줄눈 · 가로 줄 · 위 몰딩 · 아래 굽 */
function frontWall(p: Px, cx: number, topY: number, rx: number, ry: number, hgt: number, courses: number) {
  for (let x = -rx; x <= rx; x++) {
    const k = x / rx;
    const yt = Math.round(topY + ry * sq(k));
    const yb = yt + hgt;
    const th = Math.asin(Math.max(-1, Math.min(1, k)));
    const light = -Math.sin(th) * 0.75 + 0.15; // 왼쪽 빛
    for (let y = yt; y <= yb; y++) {
      const v = (y - yt) / hgt;
      const course = Math.min(courses - 1, Math.floor(v * courses));
      const step = Math.PI / (courses % 2 ? 9 : 10);
      const joint = Math.abs(((th + (course % 2) * step * 0.5) % step + step) % step) < 0.035 + Math.abs(k) * 0.02;
      const hline = Math.abs(v * courses - Math.round(v * courses)) * hgt / courses < 0.6 && v > 0.05 && v < 0.95;
      let i = light > 0.45 ? 1 : light > 0.05 ? 2 : light > -0.35 ? 3 : 4;
      if (v < 0.12) i -= 1; // 위 몰딩 빛
      if (v > 0.86) i += 1; // 굽 그늘
      if (joint || hline) i += 2;
      p.set(cx + x, y, ST[clampI(i, ST.length)]);
    }
    p.set(cx + x, yb + 1, ST[6]); // 바닥과 닿는 곳
  }
}

/** 접시 몸통 아래쪽 (앞에서 보이는 둥근 밑면): 위 타원 앞 호에서 depth 만큼 내려가며 기둥 폭으로 좁아짐 */
function bowlUnder(p: Px, cx: number, topY: number, rx: number, ry: number, depth: number, neck: number) {
  for (let x = -rx; x <= rx; x++) {
    const k = x / rx;
    const yt = Math.round(topY + ry * sq(k));
    const dd = Math.round(depth * sq(k) + (Math.abs(x) < neck ? depth * 0.4 : 0));
    for (let y = yt; y <= yt + dd; y++) {
      const v = (y - yt) / Math.max(1, dd);
      const l = -k * 0.7 - v * 0.6 + 0.1;
      let i = l > 0.3 ? 2 : l > -0.1 ? 3 : l > -0.5 ? 4 : 5;
      if (y === yt) i = 1; // 입술 빛
      if (y === yt + 1 && (x + 200) % 10 < 5) i = 2; // 가리비 장식
      p.set(cx + x, y, ST[clampI(i, ST.length)]);
    }
  }
}

/** 기둥 (발루스터): 아래 y0 → 위 y1, 높이별 반폭 (배 모양) */
function baluster(p: Px, cx: number, y0: number, y1: number, w0: number) {
  for (let y = y1; y <= y0; y++) {
    const t = (y - y1) / (y0 - y1);
    const half = Math.round(w0 * (0.55 + 0.5 * Math.sin(Math.PI * Math.min(1, t * 1.15)) ** 1.5) + (t > 0.9 ? 3 : 0));
    for (let x = -half; x <= half; x++) {
      const k = x / (half + 0.5);
      const i = k < -0.5 ? 1 : k < 0.1 ? 2 : k < 0.6 ? 3 : 4;
      p.set(cx + x, y, ST[(y % 9 === 0 ? 1 : 0) + i]);
    }
  }
}

/** 떨어지는 물줄기 (반투명 띠가 아래로 흐름) + 떨어진 곳 물보라 */
function fall(p: Px, x: number, y0: number, y1: number, f: number, seed: number, wide = 2) {
  for (let y = y0; y <= y1; y++) {
    const band = (((y - y0 - f * 3 + seed * 5) % 8) + 8) % 8;
    for (let k = 0; k < wide; k++) p.set(x + k, y, band < 2 ? "#ffffffdd" : k === 0 ? "#bdeefccc" : "#86d6f4bb");
  }
  const s = (f + seed) % 4;
  p.set(x - 1, y1 - 1 - (s & 1), "#ffffffcc");
  p.set(x + wide, y1 - 1 - ((s >> 1) & 1), "#ffffffcc");
  p.set(x + (s % wide), y1 - 2 - (s & 1), "#f2fdffee");
}

/** 물 장막: 접시 입술 앞 호를 따라 아래로 (같은 각도 간격 — 원통 투영) */
function curtain(p: Px, cx: number, lipY: number, rx: number, ry: number, landY: (x: number) => number, f: number, n: number) {
  for (let k = 0; k < n; k++) {
    const ang = Math.PI * (0.06 + 0.88 * ((k + 0.5) / n)); // 0 오른쪽 .. π 왼쪽 (앞 반원)
    const px = Math.round(cx + Math.cos(ang) * rx * 0.96);
    const py = Math.round(lipY + Math.sin(ang) * ry * 0.96) + 2;
    fall(p, px, py, landY(px), f, k, 2);
  }
}

export function fountainFrames2x(): HTMLCanvasElement[] {
  const frames: HTMLCanvasElement[] = [];
  const T1 = { y: TY - 84, rx: 66, ry: 40 }; // 큰 접시 윗면 중심
  const T2 = { y: T1.y - 42, rx: 34, ry: 20 }; // 작은 접시
  const waterY = TY + 6; // 수반 수위 (윗면보다 6 아래)
  const iRX = RX - RIM - 1, iRY = Math.round(RY - RIM * 0.6) - 1;
  const basinLand = (x: number) => Math.round(waterY + iRY * 0.35 * sq((x - CX) / iRX)); // 물줄기가 떨어지는 수반 물낯 (앞쪽)
  for (let f = 0; f < 8; f++) {
    const p = new Px(W, H);
    // ① 수반: 윗면 · 안벽 · 물
    basinTop(p, CX, TY, RX, RY, RIM, 6, f, 0);
    // ② 큰 기둥 (수반 물에서 큰 접시 밑까지) + 물에 닿는 곳 잔물결
    baluster(p, CX, waterY + 2, T1.y + 18, 13);
    for (let x = -18; x <= 18; x++) if ((x + f) % 4 < 2) p.set(CX + x, waterY + 3 + Math.round(Math.abs(x) / 9), WT[1]);
    // ③ 큰 접시: 밑면 → 윗면(테두리 · 물) → 작은 기둥 → 작은 접시 → 꼭지
    bowlUnder(p, CX, T1.y, T1.rx, T1.ry, 20, 12);
    basinTop(p, CX, T1.y, T1.rx, T1.ry, 8, 3, f, 1.7);
    baluster(p, CX, T1.y + 3, T2.y + 10, 8);
    bowlUnder(p, CX, T2.y, T2.rx, T2.ry, 12, 7);
    basinTop(p, CX, T2.y, T2.rx, T2.ry, 6, 2, f, 3.1);
    // 꼭지: 짧은 기둥 + 도토리
    baluster(p, CX, T2.y + 1, T2.y - 20, 5);
    for (let y = -8; y <= 6; y++) for (let x = -6; x <= 6; x++) if (x * x / 36 + (y * y) / (y < 0 ? 64 : 36) <= 1) p.set(CX + x, T2.y - 24 + y, ST[clampI((x / 6) * 1.5 + (y / 8) + 2, ST.length)]);
    p.rect(CX - 1, T2.y - 34, 3, 3, ST[2]);
    // ④ 솟는 물: 꼭지 위로 올라갔다가 퍼져 떨어짐
    for (let y = 0; y < 8; y++) { const b = (y + f * 2) % 6; p.set(CX, T2.y - 35 - y, b < 2 ? "#ffffffee" : "#bdeefcdd"); p.set(CX + 1, T2.y - 35 - y, "#86d6f4bb"); }
    for (let k = 0; k < 10; k++) {
      const a = (k / 10) * Math.PI * 2;
      const t = ((f + k * 3) % 8) / 8;
      const dx = Math.round(Math.cos(a) * 14 * t), dy = Math.round(-43 + 34 * t * t + Math.sin(a) * 4 * t);
      p.set(CX + dx, T2.y + dy, t < 0.5 ? "#ffffffee" : "#bdeefcdd");
    }
    // ⑤ 물 장막: 작은 접시 → 큰 접시, 큰 접시 → 수반
    curtain(p, CX, T2.y, T2.rx, T2.ry, () => T1.y + 8, f, 6);
    curtain(p, CX, T1.y, T1.rx, T1.ry, basinLand, f, 9);
    // ⑥ 수반 앞벽 (맨 앞)
    frontWall(p, CX, TY, RX, RY, WALL, 2);
    p.outline("#4a3f30");
    frames.push(p.toCanvas());
  }
  return frames;
}
