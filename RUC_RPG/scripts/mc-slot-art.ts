/** Generate 16x16 gray accessory-slot silhouettes for the resource pack. */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { deflateSync } from "node:zlib";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const out = resolve(root, "minecraft/resourcepack/assets/ruc/textures/item/ui");
const preview = resolve(root, ".scratch/codex/accessory/preview.png");
const art: Record<string, string[]> = {
  necklace: ["................","................","....######......","...#......#.....","..#........#....","..#........#....","...#......#.....","....#....#......",".....#..#.......","......##........","......##........","......##........",".......#........","................","................","................"],
  earring: ["................",".....####.......","....#....#......","...#......#.....","...#......#.....","....#....#......",".....####.......",".......#........",".......#........","......###.......","......###.......",".......#........","................","................","................","................"],
  ring1: ["................","................",".....####.......","....#....#......","...#......#.....","...#......#.....","...#......#.....","....#....#......",".....####.......","......##........","................","................","................","................","................","................"],
  gloves: ["................","....#..#..#.....","....#..#..#.....","....#..#..#.....","....#..#..#.....","....########....","...#........#...","...#........#...","...#........#...","...#........#...","....########....",".....#....#.....","......####......","................","................","................"],
  cape: ["................",".....######.....","....#......#....","...#........#...","..#..........#..","..#..........#..","...#........#...","....#......#....",".....#....#.....","......#..#......",".......##.......",".......##.......","......####......","................","................","................"],
};
function chunk(type: string, body: Uint8Array): Buffer {
  const name = Buffer.from(type), len = Buffer.alloc(4); len.writeUInt32BE(body.length);
  const data = Buffer.concat([name, Buffer.from(body)]); let crc = 0xffffffff;
  for (const b of data) { crc ^= b; for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0); }
  const sum = Buffer.alloc(4); sum.writeUInt32BE((crc ^ 0xffffffff) >>> 0);
  return Buffer.concat([len, name, Buffer.from(body), sum]);
}
function png(pixels: Uint8Array): Buffer {
  if (pixels.length !== 16 * 16 * 4 || pixels.some((n) => !Number.isFinite(n))) throw new Error("expected valid 16x16 RGBA");
  const rows = Buffer.alloc((16 * 4 + 1) * 16);
  for (let y = 0; y < 16; y++) rows.set(pixels.subarray(y * 64, (y + 1) * 64), y * 65 + 1);
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(16, 0); ihdr.writeUInt32BE(16, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(rows, { level: 9 })), chunk("IEND", new Uint8Array())]);
}
mkdirSync(out, { recursive: true });
const thumbs: Uint8Array[] = [];
for (const [name, rows] of Object.entries(art)) {
  if (rows.length !== 16 || rows.some((row) => row.length !== 16)) throw new Error(`invalid shape: ${name}`);
  const pixels = new Uint8Array(16 * 16 * 4);
  rows.forEach((row, y) => [...row].forEach((ch, x) => {
    if (ch === ".") return;
    const at = (y * 16 + x) * 4;
    pixels.set(ch === "#" ? [154, 163, 173, 150] : [225, 230, 235, 175], at);
  }));
  writeFileSync(resolve(out, `slot_${name}.png`), png(pixels));
  const id = `ui/slot_${name}`;
  const modelDir = resolve(root, "minecraft/resourcepack/assets/ruc/models/item/ui");
  const itemDir = resolve(root, "minecraft/resourcepack/assets/ruc/items/ui");
  mkdirSync(modelDir, { recursive: true }); mkdirSync(itemDir, { recursive: true });
  writeFileSync(resolve(modelDir, `slot_${name}.json`), `${JSON.stringify({ parent: "minecraft:item/generated", textures: { layer0: `ruc:item/${id}` } }, null, 2)}\n`);
  writeFileSync(resolve(itemDir, `slot_${name}.json`), `${JSON.stringify({ model: { type: "minecraft:model", model: `ruc:item/${id}` } }, null, 2)}\n`);
  thumbs.push(pixels);
}
const modelsFile = resolve(root, "minecraft/plugins/RucRpg/src/main/resources/pack-models.json");
const modelIds = JSON.parse(readFileSync(modelsFile, "utf8")) as string[];
for (const name of Object.keys(art)) if (!modelIds.includes(`ui/slot_${name}`)) modelIds.push(`ui/slot_${name}`);
modelIds.sort(); writeFileSync(modelsFile, `${JSON.stringify(modelIds, null, 2)}\n`);
const sheet = new Uint8Array(80 * 16 * 4);
thumbs.forEach((pixels, i) => { for (let y = 0; y < 16; y++) sheet.set(pixels.subarray(y * 64, y * 64 + 64), (y * 80 + i * 16) * 4); });
const previewRows = new Uint8Array(320 * 64 * 4);
for (let y = 0; y < 16; y++) for (let x = 0; x < 80; x++) {
  const at = (y * 80 + x) * 4, color = sheet.subarray(at, at + 4);
  for (let dy = 0; dy < 4; dy++) for (let dx = 0; dx < 4; dx++) previewRows.set(color, ((y * 4 + dy) * 320 + x * 4 + dx) * 4);
}
function png320(pixels: Uint8Array): Buffer {
  const rows = Buffer.alloc((320 * 4 + 1) * 64);
  for (let y = 0; y < 64; y++) rows.set(pixels.subarray(y * 320 * 4, (y + 1) * 320 * 4), y * (320 * 4 + 1) + 1);
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(320, 0); ihdr.writeUInt32BE(64, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(rows, { level: 9 })), chunk("IEND", new Uint8Array())]);
}
mkdirSync(dirname(preview), { recursive: true }); writeFileSync(preview, png320(previewRows));
console.log("Generated 5 accessory slot textures (16x16 RGBA) and 320x64 preview.");
