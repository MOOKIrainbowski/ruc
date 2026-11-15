/** Generate deterministic pixel art for the Fabric RPG HUD. */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { deflateSync } from "node:zlib";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const out = resolve(root, "minecraft/client/ruc-rpg-client/src/main/resources/assets/ruc_rpg/textures/gui/hud");
const preview = resolve(root, ".scratch/codex/hud/preview.png");
type Image = { w: number; h: number; p: Uint8Array };
const image = (w: number, h: number): Image => ({ w, h, p: new Uint8Array(w * h * 4) });
function px(a: Image, x: number, y: number, c: string | [number, number, number, number]) {
  if (x < 0 || y < 0 || x >= a.w || y >= a.h) return;
  const rgba = typeof c === "string" ? [...c.slice(1).matchAll(/[0-9a-f]{2}/gi)].map((m) => parseInt(m[0], 16)) : c;
  if (typeof c === "string" && rgba.length === 3) rgba.push(255);
  if (rgba.length !== 4) throw new Error(`invalid color ${c}`);
  a.p.set(rgba, (y * a.w + x) * 4);
}
function rect(a: Image, x: number, y: number, w: number, h: number, c: string | [number, number, number, number]) {
  for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) px(a, xx, yy, c);
}
function line(a: Image, points: string[], colors: Record<string, string>, ox = 0, oy = 0) {
  points.forEach((row, y) => [...row].forEach((ch, x) => { if (ch !== ".") px(a, ox + x, oy + y, colors[ch] ?? (ch === "+" ? "#ffffff" : "#000000")); }));
}
function chunk(type: string, body: Uint8Array): Buffer {
  const n = Buffer.from(type); const len = Buffer.alloc(4); len.writeUInt32BE(body.length);
  const data = Buffer.concat([n, Buffer.from(body)]); let crc = 0xffffffff;
  for (const b of data) { crc ^= b; for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0); }
  const sum = Buffer.alloc(4); sum.writeUInt32BE((crc ^ 0xffffffff) >>> 0);
  return Buffer.concat([len, n, Buffer.from(body), sum]);
}
function png(a: Image): Buffer {
  if (!a.w || !a.h || a.p.length !== a.w * a.h * 4 || a.p.some((v) => !Number.isFinite(v))) throw new Error(`invalid RGBA ${a.w}x${a.h}`);
  const rows = Buffer.alloc((a.w * 4 + 1) * a.h);
  for (let y = 0; y < a.h; y++) rows.set(a.p.subarray(y * a.w * 4, (y + 1) * a.w * 4), y * (a.w * 4 + 1) + 1);
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(a.w, 0); ihdr.writeUInt32BE(a.h, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(rows, { level: 9 })), chunk("IEND", new Uint8Array())]);
}
const files: [string, Image][] = [];
const add = (name: string, a: Image) => files.push([name, a]);

// 9x9 resource beads echo the vanilla heart's dark edge and single-pixel shine.
for (const [kind, base, light, dark, flame] of [
  ["mana", "#2F7BFF", "#9CCBFF", "#102A72", false], ["energy", "#FF8A1F", "#FFD083", "#762E08", true],
] as const) for (const [state, fill] of [["full", true], ["half", "half"], ["empty", false]] as const) {
  const a = image(9, 9);
  const shape = flame ? ["....#....", "...###...", "..#####..", ".#######.", ".#######.", ".#######.", "..#####..", "...###...", "....#...."] : [".#######.", "#########", "#########", "#########", "#########", "#########", "#########", "#########", ".#######."];
  for (let y = 0; y < 9; y++) for (let x = 0; x < 9; x++) if (shape[y][x] === "#") {
    const edge = x === 0 || x === 8 || y === 0 || y === 8 || shape[y - 1]?.[x] !== "#" || shape[y + 1]?.[x] !== "#";
    const lit = fill === true || (fill === "half" && x < 5);
    px(a, x, y, edge ? dark : !lit ? "#10131bbb" : (x < 4 && y < 4 ? light : base));
  }
  if (fill) { px(a, 2, 2, light); px(a, 3, 1, light); }
  add(`${kind}_${state}.png`, a);
}

const slot = image(22, 22);
rect(slot, 0, 0, 22, 22, "#3a2a1e"); rect(slot, 1, 1, 20, 20, "#4d3022"); rect(slot, 2, 2, 18, 18, "#bf8450");
rect(slot, 3, 3, 16, 16, "#a36a3c"); rect(slot, 3, 3, 16, 1, "#ffdcaa88"); rect(slot, 3, 18, 16, 1, "#5a341cda");
rect(slot, 4, 4, 14, 14, "#00000000"); add("skill_slot.png", slot);
const cd = image(18, 18); rect(cd, 0, 0, 18, 18, "#00000099"); add("skill_cooldown.png", cd);
const nores = image(18, 18); rect(nores, 0, 0, 18, 18, "#174a9c88");
rect(nores, 0, 0, 18, 1, "#6dbbff"); rect(nores, 0, 17, 18, 1, "#6dbbff"); rect(nores, 0, 1, 1, 16, "#6dbbff"); rect(nores, 17, 1, 1, 16, "#6dbbff"); add("skill_nores.png", nores);

const glyphs: Record<string, string[]> = { q: [".......", "..###..", ".#...#.", ".#...#.", ".#.#.#.", ".#..##.", "..####."], c: [".......", "..####.", ".#.....", ".#.....", ".#.....", ".#.....", "..####."], z: [".......", ".#####.", "....#..", "...#...", "..#....", ".#.....", ".#####."], r: [".......", ".####..", ".#...#.", ".####..", ".#.#...", ".#..#..", ".#...#."] };
for (const k of Object.keys(glyphs)) {
  const a = image(7, 7); rect(a, 0, 0, 7, 7, "#18131dcc"); rect(a, 0, 0, 7, 1, "#786049"); rect(a, 0, 6, 7, 1, "#09080b");
  line(a, glyphs[k], { "#": "#fff1d8" }); add(`key_${k}.png`, a);
}

const panel = image(72, 84); rect(panel, 0, 0, 72, 84, "#1c120cbb");
rect(panel, 0, 0, 72, 1, "#b8895b99"); rect(panel, 0, 83, 72, 1, "#080706bb");
for (let y = 9; y < 84; y += 9) rect(panel, 4, y, 64, 1, "#c7a27a33"); add("stats_panel.png", panel);

const statDefs: [string, string, string[]][] = [
  ["atk", "#E5484D", ["......#.", ".....#..", "....#...", "#..#....", ".##.....", ".##.....", "#..#....", "#...#..."]],
  ["ap", "#9B5DE5", ["...#....", "...#....", "###+####", ".#+++#..", "..###...", ".##.##..", ".#...#..", "........"]],
  ["pdef", "#9AA3AD", [".######.", "########", "###+####", "###+####", ".##+###.", "..#####.", "...###..", "....#..."]],
  ["mdef", "#B39DDB", [".######.", "#......#", "#..#...#", "#..###.#", ".#.#.#.#", "..#.#.#.", "...#.#..", "....#..."]],
  ["atkspeed", "#F5C542", ["....##..", "...##...", "..##....", ".######.", "...##...", "..##....", ".##.....", "##......"]],
  ["movespeed", "#3FC8E8", [".......#", ".....###", "...####+", ".####+..", "#####...", "###.....", "#.......", "........"]],
  ["crit", "#F2C94C", ["...#....", "..##....", ".##.....", "#######.", "...##...", "..##.##.", ".#...#..", "........"]],
  ["luck", "#2ECC71", [".##.##..", "#######.", ".##.##..", "...#....", ".##.##..", "#######.", ".##.##..", "........"]],
];
for (const [name, color, shape] of statDefs) { const a = image(8, 8); line(a, shape, { "#": color, "+": "#ffffff" }); add(`stat_${name}.png`, a); }

const frame = image(70, 70); rect(frame, 0, 0, 70, 70, "#3a2a1e"); rect(frame, 1, 1, 68, 68, "#7d4f2b");
rect(frame, 2, 2, 66, 66, "#bf8450"); rect(frame, 3, 3, 64, 64, "#3a2a1e");
rect(frame, 4, 4, 62, 62, "#00000000");
for (const [x, y] of [[2,2],[67,2],[2,67],[67,67]]) { px(frame, x, y, "#ffdcaa"); px(frame, x, y + (y === 2 ? 1 : -1), "#94603a"); }
add("minimap_frame.png", frame);
const me = image(7, 7); line(me, ["...#...", "..###..", ".#####.", "#######", "...#...", "...#...", "......."], { "#": "#fff1d8", "+": "#ffffff" });
// Edge pixels use a dark outline; the center remains a bright north-pointing marker.
for (let y = 0; y < 7; y++) for (let x = 0; x < 7; x++) if (me.p[(y * 7 + x) * 4 + 3]) {
  if ([...Array(4)].some((_, i) => { const [dx,dy] = [[1,0],[-1,0],[0,1],[0,-1]][i]; return !me.p[((y + dy) * 7 + x + dx) * 4 + 3]; })) px(me, x, y, "#35251e");
}
line(me, ["...#...", "..#+#..", ".##+##.", "...#...", "...#...", ".......", "......."], { "#": "#fff1d8", "+": "#ffffff" }); add("minimap_me.png", me);

mkdirSync(out, { recursive: true });
for (const [name, a] of files) { if (a.w <= 0 || a.h <= 0) throw new Error(`invalid dimensions: ${name}`); writeFileSync(resolve(out, name), png(a)); }

// Single nearest-neighbor contact sheet with 4x enlarged sprites and labels kept out of the art.
const cols = 4, cellW = 304, cellH = 360, rows = Math.ceil(files.length / cols), sheet = image(cols * cellW, rows * cellH);
for (let i = 0; i < files.length; i++) {
  const [name, src] = files[i], ox = (i % cols) * cellW + 4, oy = Math.floor(i / cols) * cellH + 4;
  for (let y = 0; y < src.h; y++) for (let x = 0; x < src.w; x++) {
    const at = (y * src.w + x) * 4, color: [number,number,number,number] = [src.p[at],src.p[at+1],src.p[at+2],src.p[at+3]];
    rect(sheet, ox + x * 4, oy + y * 4, 4, 4, color);
  }
  // Filename written as compact 3x5 bitmap text under each preview.
  const chars: Record<string, string[]> = { a:["010","101","111","101","101"],b:["110","101","110","101","110"],c:["011","100","100","100","011"],d:["110","101","101","101","110"],e:["111","100","110","100","111"],f:["111","100","110","100","100"],g:["011","100","101","101","011"],h:["101","101","111","101","101"],i:["111","010","010","010","111"],k:["101","101","110","101","101"],l:["100","100","100","100","111"],m:["101","111","111","101","101"],n:["101","111","111","111","101"],o:["010","101","101","101","010"],p:["110","101","110","100","100"],q:["010","101","101","011","001"],r:["110","101","110","101","101"],s:["011","100","010","001","110"],t:["111","010","010","010","010"],u:["101","101","101","101","111"],v:["101","101","101","101","010"],w:["101","101","111","111","101"],y:["101","101","010","010","010"],z:["111","001","010","100","111"],"_ ":["000","000","000","000","000"]};
  const label = name.replace(".png", "").slice(0, 24).toLowerCase(); let cursor = ox;
  for (const ch of label) { const g = chars[ch] ?? ["000","000","000","000","000"]; line(sheet, g, { "1": "#fff1d8" }, cursor, oy + 340); cursor += 4; }
}
mkdirSync(dirname(preview), { recursive: true }); writeFileSync(preview, png(sheet));
console.log(`Generated ${files.length} HUD textures and ${sheet.w}x${sheet.h} preview.`);
