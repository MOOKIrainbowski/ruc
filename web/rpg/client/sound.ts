/**
 * 사운드 (§25 · §24, P8): 8/16비트풍 효과음과 맵별 배경음을 파일 없이 WebAudio 로 합성 (DECISIONS D73).
 * 배경음 = 광장(따뜻한 루트) · 초원(경쾌) · 결투장(행진) · 유적(긴장) · 보스. 볼륨은 설정의 전체 × 배경음/효과음.
 * 브라우저 정책상 첫 클릭 · 키 입력 뒤에 소리가 남 (unlock). 탭이 숨으면 멈춤.
 */

let ctx: AudioContext | null = null;
let sfxBus: GainNode;
let bgmBus: GainNode;
const vol = { master: 0.8, bgm: 0.6, sfx: 0.8 };

function ac(): AudioContext | null {
  if (typeof window === "undefined") return null;
  if (!ctx) {
    try {
      ctx = new AudioContext();
    } catch {
      return null;
    }
    sfxBus = ctx.createGain();
    bgmBus = ctx.createGain();
    sfxBus.connect(ctx.destination);
    bgmBus.connect(ctx.destination);
    applyVolume();
    document.addEventListener("visibilitychange", () => void (document.hidden ? ctx?.suspend() : ctx?.resume()));
  }
  return ctx;
}

function applyVolume() {
  if (!ctx) return;
  sfxBus.gain.value = vol.master * vol.sfx * 0.5;
  bgmBus.gain.value = vol.master * vol.bgm * 0.16;
}

/** 설정 (0~100) */
export function setVolume(master: number, bgmV: number, sfxV: number) {
  vol.master = master / 100;
  vol.bgm = bgmV / 100;
  vol.sfx = sfxV / 100;
  applyVolume();
}

/** 첫 사용자 입력 때 부름 (자동 재생 정책) */
export function unlock() {
  const c = ac();
  if (c?.state === "suspended" && !document.hidden) void c.resume();
  if (cur && !timer) start();
}

const hz = (midi: number) => 440 * 2 ** ((midi - 69) / 12);

function tone(bus: GainNode, t: number, f: number, dur: number, type: OscillatorType, v: number, slideTo?: number) {
  const c = ctx!;
  const o = c.createOscillator();
  const g = c.createGain();
  o.type = type;
  o.frequency.setValueAtTime(f, t);
  if (slideTo) o.frequency.exponentialRampToValueAtTime(Math.max(20, slideTo), t + dur);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(v, t + 0.008);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(bus);
  o.start(t);
  o.stop(t + dur + 0.02);
}

let noiseBuf: AudioBuffer | null = null;
function noise(bus: GainNode, t: number, dur: number, v: number, freq = 2000) {
  const c = ctx!;
  if (!noiseBuf) {
    noiseBuf = c.createBuffer(1, c.sampleRate, c.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  const s = c.createBufferSource();
  s.buffer = noiseBuf;
  const f = c.createBiquadFilter();
  f.type = "bandpass";
  f.frequency.value = freq;
  const g = c.createGain();
  g.gain.setValueAtTime(v, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  s.connect(f).connect(g).connect(bus);
  s.start(t);
  s.stop(t + dur + 0.02);
}

const arp = (t: number, notes: number[], step: number, type: OscillatorType, v: number) => notes.forEach((n, i) => tone(sfxBus, t + i * step, hz(n), step * 1.6, type, v));

const SFX = {
  hit: (t: number) => { tone(sfxBus, t, 330, 0.07, "square", 0.18, 140); noise(sfxBus, t, 0.05, 0.25, 1800); },
  crit: (t: number) => { tone(sfxBus, t, 520, 0.12, "square", 0.22, 160); noise(sfxBus, t, 0.09, 0.35, 2600); },
  hurt: (t: number) => { tone(sfxBus, t, 180, 0.14, "sawtooth", 0.2, 70); },
  cast: (t: number) => { tone(sfxBus, t, 400, 0.16, "triangle", 0.22, 900); },
  level: (t: number) => arp(t, [72, 76, 79, 84, 88], 0.07, "square", 0.16),
  pickup: (t: number) => arp(t, [84, 91], 0.05, "square", 0.12),
  coin: (t: number) => arp(t, [83, 88], 0.06, "square", 0.12),
  ping: (t: number) => { tone(sfxBus, t, 880, 0.12, "sine", 0.3); tone(sfxBus, t + 0.1, 1320, 0.16, "sine", 0.25); },
  ui: (t: number) => tone(sfxBus, t, 660, 0.04, "square", 0.08),
  death: (t: number) => arp(t, [67, 63, 60, 55], 0.12, "triangle", 0.25),
  ok: (t: number) => arp(t, [72, 79, 84, 91], 0.06, "square", 0.16),
  fail: (t: number) => { tone(sfxBus, t, 160, 0.3, "sawtooth", 0.18, 90); },
  boom: (t: number) => { noise(sfxBus, t, 0.6, 0.6, 400); tone(sfxBus, t, 90, 0.5, "sawtooth", 0.25, 30); },
  quest: (t: number) => arp(t, [67, 72, 76, 79, 84], 0.09, "triangle", 0.25),
  boss: (t: number) => { noise(sfxBus, t, 0.8, 0.4, 200); arp(t, [40, 43, 46], 0.18, "sawtooth", 0.2); },
  portal: (t: number) => { tone(sfxBus, t, 200, 0.4, "sine", 0.25, 1200); noise(sfxBus, t, 0.35, 0.12, 3000); },
};
export type Sfx = keyof typeof SFX;

const lastAt = new Map<Sfx, number>();
let burst = { t: 0, n: 0 };
/** 효과음 — 같은 소리는 40ms 에 한 번, 전체는 100ms 에 8개까지 (난전에서 귀가 아프지 않게) */
export function sfx(name: Sfx) {
  const c = ctx;
  if (!c || c.state !== "running" || vol.master * vol.sfx <= 0) return;
  const now = performance.now();
  if (now - (lastAt.get(name) ?? 0) < 40) return;
  if (now - burst.t > 100) burst = { t: now, n: 0 };
  if (++burst.n > 8) return;
  lastAt.set(name, now);
  SFX[name](c.currentTime + 0.005);
}

// ── 배경음: 8분음표 32칸 패턴을 루프 (lead = 음계 칸 번호, −1 = 쉼) ──────────────
type Track = { bpm: number; root: number; scale: number[]; lead: number[]; bass: number[]; leadType: OscillatorType; drums?: boolean };
const MAJ = [0, 2, 4, 7, 9, 12, 14, 16, 19];
const MIN = [0, 2, 3, 5, 7, 8, 10, 12, 14, 15];
const TRACKS: Record<string, Track> = {
  plaza: { bpm: 96, root: 60, scale: MAJ, leadType: "triangle",
    lead: [0, -1, 2, 3, 4, -1, 3, -1, 2, -1, 1, 2, 0, -1, -1, -1, 3, -1, 4, 5, 6, -1, 5, -1, 4, -1, 3, 2, 1, -1, -1, -1],
    bass: [0, 0, 3, 3, 4, 4, 3, 3] },
  field: { bpm: 132, root: 67, scale: MAJ, leadType: "square", drums: true,
    lead: [0, 2, 4, 2, 5, 4, 2, -1, 3, 4, 5, 4, 3, 2, 1, -1, 0, 2, 4, 5, 6, 5, 4, 2, 3, 2, 1, 2, 0, -1, -1, -1],
    bass: [0, 0, 4, 4, 3, 3, 4, 4] },
  arena: { bpm: 120, root: 62, scale: MIN, leadType: "square", drums: true,
    lead: [0, -1, 0, 2, 4, -1, 4, -1, 3, 2, 3, 4, 2, -1, -1, -1, 0, -1, 0, 2, 4, 5, 7, -1, 6, 5, 4, 2, 0, -1, -1, -1],
    bass: [0, 0, 5, 5, 3, 3, 4, 4] },
  dungeon: { bpm: 84, root: 57, scale: MIN, leadType: "sine",
    lead: [4, -1, -1, 3, -1, -1, 2, -1, -1, -1, 1, -1, 2, -1, -1, -1, 4, -1, -1, 5, -1, 4, 3, -1, -1, -1, 2, -1, 0, -1, -1, -1],
    bass: [0, 0, 0, 0, 5, 5, 4, 4] },
  highland: { bpm: 112, root: 62, scale: MIN, leadType: "triangle", drums: true,
    lead: [0, -1, 3, 4, 5, -1, 4, 3, 2, -1, 0, -1, 2, 3, 4, -1, 7, -1, 5, 4, 3, -1, 4, 5, 2, -1, -1, 1, 0, -1, -1, -1],
    bass: [0, 0, 5, 5, 3, 3, 4, 4] },
  boss: { bpm: 152, root: 64, scale: MIN, leadType: "square", drums: true,
    lead: [0, 0, 3, 0, 4, 0, 3, 2, 0, 0, 3, 0, 5, 4, 3, 2, 7, 7, 6, 5, 4, 5, 4, 3, 2, 3, 2, 1, 0, -1, 0, -1],
    bass: [0, 0, 0, 0, 5, 5, 6, 6] },
};

let cur: string | null = null;
let timer = 0;
let stepN = 0;
let nextT = 0;

/** 배경음 바꾸기 (null = 끔). 같은 곡이면 그대로 */
export function bgm(name: string | null) {
  if (name === cur) return;
  cur = name && TRACKS[name] ? name : null;
  clearInterval(timer);
  timer = 0;
  if (cur && ctx?.state === "running") start();
}

function start() {
  const c = ctx;
  if (!c || !cur) return;
  stepN = 0;
  nextT = c.currentTime + 0.15;
  timer = window.setInterval(schedule, 60);
}

function schedule() {
  const c = ctx;
  const tr = cur ? TRACKS[cur] : null;
  if (!c || !tr || c.state !== "running") return;
  const step = 60 / tr.bpm / 2;
  if (nextT < c.currentTime - 0.3) nextT = c.currentTime + 0.05; // 탭이 숨었다 돌아오면 밀린 음은 버림
  while (nextT < c.currentTime + 0.25) {
    const i = stepN % 32;
    const n = tr.lead[i];
    if (n >= 0) tone(bgmBus, nextT, hz(tr.root + tr.scale[n % tr.scale.length]), step * 0.9, tr.leadType, 0.5);
    if (i % 4 === 0) tone(bgmBus, nextT, hz(tr.root - 24 + tr.scale[tr.bass[(i / 4) % tr.bass.length]]), step * 3.6, "triangle", 0.7);
    if (tr.drums) {
      if (i % 4 === 0) tone(bgmBus, nextT, 110, 0.12, "sine", 0.9, 40);
      if (i % 4 === 2) noise(bgmBus, nextT, 0.06, 0.35, 6000);
    }
    nextT += step;
    stepN++;
  }
}
