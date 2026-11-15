/** Generate white-shaded skill effect sprites and tinted preview samples. */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { deflateSync } from "node:zlib";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const texDir = resolve(root, "minecraft/resourcepack/assets/ruc/textures/item/fx");
const modelDir = resolve(root, "minecraft/resourcepack/assets/ruc/models/item/fx");
const itemDir = resolve(root, "minecraft/resourcepack/assets/ruc/items/fx");
const preview = resolve(root, ".scratch/codex/fx/preview.png");
type Sprite = { w: number; h: number; p: Uint8Array };
const sprite = (w: number, h: number): Sprite => ({ w, h, p: new Uint8Array(w * h * 4) });
function put(s: Sprite, x: number, y: number, shade = 255, alpha = 255) {
  x = Math.round(x); y = Math.round(y);
  if (x < 0 || y < 0 || x >= s.w || y >= s.h) return;
  const i = (y * s.w + x) * 4;
  if (alpha > s.p[i + 3]) s.p.set([shade, shade, shade, alpha], i);
}
function dot(s: Sprite, x: number, y: number, radius: number, shade = 255, alpha = 255) {
  const r = Math.max(0.1, radius);
  for (let yy = Math.floor(y - r - 1); yy <= Math.ceil(y + r + 1); yy++) for (let xx = Math.floor(x - r - 1); xx <= Math.ceil(x + r + 1); xx++) {
    const d = Math.hypot(xx - x, yy - y);
    if (d <= r + 0.6) put(s, xx, yy, shade, Math.round(alpha * Math.max(0, Math.min(1, r + 0.6 - d))));
  }
}
function line(s: Sprite, x1: number, y1: number, x2: number, y2: number, width: number, shade = 255, alpha = 255) {
  const steps = Math.ceil(Math.max(Math.abs(x2 - x1), Math.abs(y2 - y1)) * 2);
  for (let i = 0; i <= steps; i++) { const t = steps ? i / steps : 0; dot(s, x1 + (x2 - x1) * t, y1 + (y2 - y1) * t, width / 2, shade, alpha); }
}
function circle(s: Sprite, cx: number, cy: number, r: number, width: number, shade = 255, alpha = 255, start = 0, end = Math.PI * 2) {
  const steps = Math.ceil((end - start) * r * 2);
  for (let i = 0; i <= steps; i++) { const a = start + (end - start) * i / Math.max(1, steps); dot(s, cx + Math.cos(a) * r, cy + Math.sin(a) * r, width / 2, shade, alpha); }
}
function png(s: Sprite): Buffer {
  if (!s.w || !s.h || s.p.length !== s.w * s.h * 4 || s.p.some((v) => !Number.isFinite(v))) throw new Error(`invalid RGBA ${s.w}x${s.h}`);
  const rows = Buffer.alloc((s.w * 4 + 1) * s.h);
  for (let y = 0; y < s.h; y++) rows.set(s.p.subarray(y * s.w * 4, (y + 1) * s.w * 4), y * (s.w * 4 + 1) + 1);
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(s.w, 0); ihdr.writeUInt32BE(s.h, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(rows, { level: 9 })), chunk("IEND", new Uint8Array())]);
}
function chunk(type: string, body: Uint8Array): Buffer {
  const name = Buffer.from(type), len = Buffer.alloc(4); len.writeUInt32BE(body.length);
  const data = Buffer.concat([name, Buffer.from(body)]); let crc = 0xffffffff;
  for (const b of data) { crc ^= b; for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0); }
  const sum = Buffer.alloc(4); sum.writeUInt32BE((crc ^ 0xffffffff) >>> 0);
  return Buffer.concat([len, name, Buffer.from(body), sum]);
}

const art: Record<string, Sprite> = {};
function make(name: string, w: number, h: number, draw: (s: Sprite) => void) { const s = sprite(w, h); draw(s); art[name] = s; }
make("slash_arc", 64, 32, (s) => {
  const cx = 30, cy = 28, a0 = -2.9, a1 = -0.18;
  for (let i = 0; i <= 90; i++) { const a = a0 + (a1 - a0) * i / 90, k = i / 90, r = 25 - Math.sin(k * Math.PI) * 4;
    dot(s, cx + Math.cos(a) * r, cy + Math.sin(a) * r, 5.6, 170, 90);
    dot(s, cx + Math.cos(a) * r, cy + Math.sin(a) * r, 3.6, 225, 210);
    dot(s, cx + Math.cos(a) * r, cy + Math.sin(a) * r, 1.5, 255, 255);
  }
});
make("slash_cross", 32, 32, (s) => {
  line(s, 4, 5, 27, 26, 6, 175, 100); line(s, 4, 5, 27, 26, 3, 230, 220); line(s, 5, 27, 26, 4, 5, 175, 100); line(s, 5, 27, 26, 4, 2, 255, 255);
});
make("ring", 64, 64, (s) => {
  circle(s, 31.5, 31.5, 27, 7, 165, 75); circle(s, 31.5, 31.5, 27, 3, 245, 230); circle(s, 31.5, 31.5, 23, 1, 210, 150);
  circle(s, 31.5, 31.5, 30, 1, 230, 130);
  for (let i = 0; i < 12; i++) { const a = i * Math.PI / 6; dot(s, 31.5 + Math.cos(a) * 27, 31.5 + Math.sin(a) * 27, i % 3 === 0 ? 2 : 1.2, 255, 255); }
});
make("shock", 64, 64, (s) => {
  circle(s, 31.5, 31.5, 25, 8, 170, 90); circle(s, 31.5, 31.5, 25, 4, 235, 230); circle(s, 31.5, 31.5, 19, 1, 255, 155);
  for (let i = 0; i < 8; i++) { const a = i * Math.PI / 4; line(s, 31.5 + Math.cos(a) * 28, 31.5 + Math.sin(a) * 28, 31.5 + Math.cos(a) * 31, 31.5 + Math.sin(a) * 31, 2, 255, 200); }
});
make("spark", 16, 16, (s) => {
  const cx = 7.5, cy = 7.5;
  for (let i = 0; i < 8; i++) { const a = i * Math.PI / 4, r = i % 2 ? 6 : 7.5; line(s, cx, cy, cx + Math.cos(a) * r, cy + Math.sin(a) * r, i % 2 ? 1.4 : 2.2, i % 2 ? 210 : 255, 255); }
  dot(s, cx, cy, 2.2, 255, 255);
});
make("orb", 16, 16, (s) => {
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) { const d = Math.hypot(x - 7.5, y - 7.5); if (d < 7) put(s, x, y, d < 2 ? 255 : Math.round(235 - d * 12), Math.round(255 * Math.max(0, Math.min(1, (7 - d) / 2)))); }
  dot(s, 5, 4, 1.5, 255, 255); dot(s, 10, 9, 0.8, 255, 210);
});
make("arrow", 16, 16, (s) => {
  line(s, 2, 8, 12, 8, 2, 220, 240); line(s, 2, 8, 11, 8, 1, 255, 255);
  line(s, 9, 5, 14, 8, 1.4, 245, 255); line(s, 9, 11, 14, 8, 1.4, 245, 255);
  line(s, 2, 8, 0, 5, 1.2, 180, 220); line(s, 2, 8, 0, 11, 1.2, 180, 220);
});
for (let f = 0; f < 4; f++) make(`burst_${f}`, 32, 32, (s) => {
  const cx = 15.5, cy = 15.5, phase = f / 3, rays = 8 + f * 2;
  dot(s, cx, cy, 3 + f * 1.5, 255, 255 - f * 22);
  for (let i = 0; i < rays; i++) { const a = i * Math.PI * 2 / rays + (i % 2) * 0.13, inner = 2 + phase * 2, outer = 7 + phase * 7 + (i % 3) * 1.5;
    line(s, cx + Math.cos(a) * inner, cy + Math.sin(a) * inner, cx + Math.cos(a) * outer, cy + Math.sin(a) * outer, i % 2 ? 1.5 : 2.5, i % 2 ? 220 : 255, 245 - f * 25);
  }
  circle(s, cx, cy, 4 + phase * 5, 1.5, 255, 220 - f * 25, 0.2 + f * 0.25, 5.2 + f * 0.25);
});
make("beam", 16, 64, (s) => {
  for (let y = 1; y < 63; y++) { const k = Math.min(y, 63 - y) / 31, half = 2 + k * 5;
    for (let x = Math.floor(7.5 - half); x <= Math.ceil(7.5 + half); x++) { const d = Math.abs(x - 7.5); put(s, x, y, d < 1 ? 255 : 225, Math.round((d < 1 ? 250 : 115) * Math.min(1, k * 4))); }
  }
  line(s, 7, 2, 7, 61, 1, 255, 235); line(s, 8, 2, 8, 61, 1, 255, 235);
});
make("heal", 16, 16, (s) => {
  for (const [x, y, w, h] of [[6, 2, 4, 12], [2, 6, 12, 4]]) {
    for (let yy = y - 1; yy <= y + h; yy++) for (let xx = x - 1; xx <= x + w; xx++) if (!(xx >= x && xx < x + w && yy >= y && yy < y + h)) put(s, xx, yy, 155, 130);
    for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) put(s, xx, yy, xx === x || yy === y ? 220 : 255, 255);
  }
});
make("shield", 32, 32, (s) => {
  const cx = 15.5, cy = 15.5;
  for (let i = 0; i <= 100; i++) { const a = Math.PI * 2 * i / 100, x = cx + Math.cos(a) * 12, y = cy + Math.sin(a) * 12; dot(s, x, y, 2.2, 175, 90); dot(s, x, y, 1.3, 245, 220); }
  circle(s, cx, cy, 8, 1, 215, 135, -Math.PI * 0.9, Math.PI * 0.35);
  dot(s, 10, 8, 1.2, 255, 210); dot(s, 22, 22, 1.2, 255, 210);
});
make("hpbar_back", 64, 12, (s) => {
  for (let y = 0; y < 12; y++) for (let x = 0; x < 64; x++) put(s, x, y, y < 2 ? 92 : y > 9 ? 32 : 52, 255);
  for (let x = 2; x < 62; x++) { put(s,x,2,78); put(s,x,9,40); }
});
make("hpbar_frame", 64, 12, (s) => {
  for (let x = 0; x < 64; x++) { put(s,x,0,38); put(s,x,1,210); put(s,x,2,130); put(s,x,9,96); put(s,x,10,225); put(s,x,11,34); }
  for (let y = 1; y < 11; y++) { put(s,0,y,38); put(s,1,y,210); put(s,2,y,130); put(s,61,y,130); put(s,62,y,210); put(s,63,y,34); }
  for (let x = 4; x < 60; x += 8) { put(s,x,1,255); put(s,x+1,1,255); }
});
make("hpbar_fill", 1, 6, (s) => { put(s,0,0,190); put(s,0,1,238); for (let y=2;y<5;y++)put(s,0,y,255); put(s,0,5,205); });

const expected: Record<string, [number, number]> = {
  slash_arc: [64,32], slash_cross: [32,32], ring: [64,64], shock: [64,64], spark: [16,16], orb: [16,16], arrow: [16,16],
  burst_0: [32,32], burst_1: [32,32], burst_2: [32,32], burst_3: [32,32], beam: [16,64], heal: [16,16], shield: [32,32], hpbar_back: [64,12], hpbar_frame: [64,12], hpbar_fill: [1,6],
};
for (const [name, s] of Object.entries(art)) {
  if (!expected[name] || s.w !== expected[name][0] || s.h !== expected[name][1]) throw new Error(`unexpected sprite size: ${name} ${s.w}x${s.h}`);
  for (let i = 0; i < s.p.length; i += 4) if (s.p[i] !== s.p[i + 1] || s.p[i] !== s.p[i + 2]) throw new Error(`sprite must be grayscale for tinting: ${name}`);
}
mkdirSync(texDir, { recursive: true }); mkdirSync(modelDir, { recursive: true }); mkdirSync(itemDir, { recursive: true });
for (const [name, s] of Object.entries(art)) {
  writeFileSync(resolve(texDir, `${name}.png`), png(s));
  const id = `ruc:item/fx/${name}`;
  writeFileSync(resolve(modelDir, `${name}.json`), `${JSON.stringify({ parent: "minecraft:item/generated", textures: { layer0: id } }, null, 2)}\n`);
  writeFileSync(resolve(itemDir, `${name}.json`), `${JSON.stringify({ model: { type: "minecraft:model", model: id, tints: [{ type: "minecraft:custom_model_data", index: 0, default: 16777215 }] } }, null, 2)}\n`);
}
const listPath = resolve(root, "minecraft/plugins/RucRpg/src/main/resources/pack-models.json");
const ids = JSON.parse(readFileSync(listPath, "utf8")) as string[];
for (const name of Object.keys(art)) if (!ids.includes(`fx/${name}`)) ids.push(`fx/${name}`);
ids.sort(); if (new Set(ids).size !== ids.length) throw new Error("duplicate model id in pack-models.json");
writeFileSync(listPath, `${JSON.stringify(ids, null, 2)}\n`);

// Tinted contact sheet, shown on a dark checker-like field to make the grayscale alpha art readable.
const cols = 4, cell = 80, rows = Math.ceil(Object.keys(art).length / cols), sheet = sprite(cols * cell, rows * cell);
const tint = [[74, 158, 255], [255, 91, 105], [80, 218, 131], [191, 115, 255]];
Object.entries(art).forEach(([name, src], i) => {
  const scale = Math.max(1, Math.min(4, Math.floor((cell - 12) / Math.max(src.w, src.h))));
  const ox = (i % cols) * cell + Math.floor((cell - src.w * scale) / 2), oy = Math.floor(i / cols) * cell + 6 + Math.floor((cell - 12 - src.h * scale) / 2);
  for (let y = 0; y < cell - 14; y++) for (let x = 0; x < cell; x++) put(sheet, (i % cols) * cell + x, Math.floor(i / cols) * cell + y + 6, ((x >> 2) + (y >> 2)) % 2 ? 48 : 34, 255);
  const [tr, tg, tb] = tint[i % tint.length];
  for (let y = 0; y < src.h; y++) for (let x = 0; x < src.w; x++) {
    const si = (y * src.w + x) * 4, lum = src.p[si], a = src.p[si + 3] / 255;
    const srcRgb = [Math.round(tr * lum / 255), Math.round(tg * lum / 255), Math.round(tb * lum / 255)];
    for (let dy=0;dy<scale;dy++)for(let dx=0;dx<scale;dx++){
      const di = ((oy + y * scale + dy) * sheet.w + ox + x * scale + dx) * 4, oldA = sheet.p[di + 3];
      const dstRgb = oldA ? [sheet.p[di], sheet.p[di + 1], sheet.p[di + 2]] : [0, 0, 0];
      const outA = a + oldA / 255 * (1 - a);
      sheet.p.set(srcRgb.map((c, n) => Math.round((c * a + dstRgb[n] * (oldA / 255) * (1 - a)) / outA)).concat(Math.round(outA * 255)), di);
    }
  }
});
mkdirSync(dirname(preview), { recursive: true }); writeFileSync(preview, png(sheet));
const barPreview=sprite(208,56);
for(let y=0;y<barPreview.h;y++)for(let x=0;x<barPreview.w;x++){const shade=(x>>2)+(y>>2)%2?35:24;put(barPreview,x,y,shade,255);}
function barLayer(src:Sprite,ox:number,oy:number,scale:number,tint:[number,number,number],stretchW=src.w*scale){
  for(let y=0;y<src.h*scale;y++)for(let x=0;x<stretchW;x++){
    const sx=Math.min(src.w-1,Math.floor(x/scale)),sy=Math.floor(y/scale),i=(sy*src.w+sx)*4,a=src.p[i+3]/255;
    const dx=ox+x,dy=oy+y,di=(dy*barPreview.w+dx)*4;if(dx<0||dy<0||dx>=barPreview.w||dy>=barPreview.h||!a)continue;
    const old=barPreview.p[di+3]/255,outA=a+old*(1-a),rgb=[0,1,2].map(c=>Math.round((tint[c]*src.p[i]/255*a+barPreview.p[di+c]*old*(1-a))/outA));
    barPreview.p.set([...rgb,Math.round(outA*255)],di);
  }
}
barLayer(art.hpbar_back,8,10,3,[255,255,255]);
barLayer(art.hpbar_fill,17,19,3,[76,199,100],111);
barLayer(art.hpbar_frame,8,10,3,[255,255,255]);
writeFileSync(resolve(dirname(preview), "hpbar-preview.png"), png(barPreview));
console.log(`Generated ${Object.keys(art).length} white-shaded FX sprites and ${sheet.w}x${sheet.h} tinted preview.`);
