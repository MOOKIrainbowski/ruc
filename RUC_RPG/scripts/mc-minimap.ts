/** Generate static RPG minimap glyphs, skin-pixel markers and stat bitmap fonts. */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { deflateSync } from "node:zlib";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const assets = join(root, "minecraft/resourcepack/assets/ruc");
const textures = join(assets, "textures/font/hud/minimap");
const glyphTextures = join(assets, "textures/font/hud/glyphs");
const fontDir = join(assets, "font");
const resources = join(root, "minecraft/plugins/RucRpg/src/main/resources");
const previewDir = join(root, ".scratch/codex/mc-minimap");
const sharp = createRequire(join(root, "web/package.json"))("sharp");
const mapIds = ["plaza", "highland", "field", "dungeon", "arena"] as const;
const padding = 32;
const mapTag = [17, 253, 239] as const;
const pixelTag = [253, 17, 239] as const;
const arrowTag = [17, 239, 253] as const;
const transparentAlpha = 1;
const tileColors: Record<number, string> = {
  1: "#8CC63F", 2: "#7ab535", 3: "#E8D3A9", 4: "#bfab86", 5: "#5EC8F0", 6: "#b9ab95",
  7: "#b07a4a", 8: "#d9a0c0", 9: "#ddd3c3", 10: "#6fd2f5", 11: "#4f8a2b", 12: "#a07850", 13: "#3c3545",
};
const statRows = [
  ["attack", "공격력"], ["spell", "주문력"], ["pdef", "물방"], ["mdef", "마방"],
  ["attack_speed", "공속"], ["move_speed", "이속"], ["crit", "치명"], ["luck", "운"],
] as const;
type RGBA = [number, number, number, number];
type MapJson = { width: number; height: number; layers: { name: string; type: string; data?: number[]; objects?: any[] }[] };
type Image = { width: number; height: number; pixels: Uint8Array };

function assert(ok: unknown, message: string): asserts ok { if (!ok) throw new Error(message); }
function rgb(hex: string): [number, number, number] { return [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)]; }
function set(p: Uint8Array, w: number, h: number, x: number, y: number, c: RGBA) {
  if (x < 0 || y < 0 || x >= w || y >= h) return;
  p.set(c, (y * w + x) * 4);
}
function rect(p: Uint8Array, w: number, h: number, x: number, y: number, rw: number, rh: number, c: RGBA) {
  for (let yy = y; yy < y + rh; yy++) for (let xx = x; xx < x + rw; xx++) set(p, w, h, xx, yy, c);
}
function ellipse(p: Uint8Array, w: number, h: number, cx: number, cy: number, rx: number, ry: number, c: RGBA, ring = false) {
  rx = Math.max(1, rx); ry = Math.max(1, ry);
  for (let y = -ry; y <= ry; y++) for (let x = -rx; x <= rx; x++) {
    const d = x * x / (rx * rx) + y * y / (ry * ry);
    if (d <= 1 && (!ring || d >= .48)) set(p, w, h, cx + x, cy + y, c);
  }
}
function shade(color: string, amount: number) {
  const c = rgb(color), target = amount >= 0 ? 255 : 0, k = Math.abs(amount);
  return c.map(v => Math.round(v + (target - v) * k)) as [number, number, number];
}
function pngChunk(type: string, body: Uint8Array) {
  const name = Buffer.from(type, "ascii"), len = Buffer.alloc(4); len.writeUInt32BE(body.length);
  const data = Buffer.concat([name, Buffer.from(body)]); let crc = 0xffffffff;
  for (const b of data) { crc ^= b; for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0); }
  const c = Buffer.alloc(4); c.writeUInt32BE((crc ^ 0xffffffff) >>> 0);
  return Buffer.concat([len, name, Buffer.from(body), c]);
}
function encodePng(w: number, h: number, pixels: Uint8Array) {
  assert(w > 0 && h > 0 && w <= 256 && h <= 256 && pixels.length === w * h * 4, `PNG 크기/RGBA 오류: ${w}x${h}`);
  const scan = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) scan.set(pixels.subarray(y * w * 4, (y + 1) * w * 4), y * (w * 4 + 1) + 1);
  const ih = Buffer.alloc(13); ih.writeUInt32BE(w, 0); ih.writeUInt32BE(h, 4); ih[8] = 8; ih[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), pngChunk("IHDR", ih), pngChunk("IDAT", deflateSync(scan, { level: 9 })), pngChunk("IEND", new Uint8Array())]);
}
function writePng(path: string, image: Image) { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, encodePng(image.width, image.height, image.pixels)); }
function writeJson(path: string, value: unknown) { writeFileSync(path, JSON.stringify(value, null, 2) + "\n", "utf8"); }
const prop = (o: any, key: string) => o.properties?.find((p: any) => p.name === key)?.value;
function levelAt(height: number[] | undefined, w: number, h: number, x: number, y: number) { return !height || x < 0 || y < 0 || x >= w || y >= h ? 0 : height[y * w + x] & 15; }
function hillKind(height: number[] | undefined, w: number, h: number, x: number, y: number) {
  if (!height) return 0;
  const v = height[y * w + x], level = v & 15;
  if (!level) return 0;
  if (v & 16) return 4;
  if (levelAt(height, w, h, x, y + 1) < level || levelAt(height, w, h, x, y + 2) < level) return 1;
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (levelAt(height, w, h, x + dx, y + dy) < level) return 2;
  return 8;
}
function drawMap(json: MapJson) {
  const { width: mw, height: mh } = json, w = mw + padding * 2, h = mh + padding * 2;
  assert(Number.isInteger(mw) && Number.isInteger(mh) && w <= 256 && h <= 256, `지도 크기가 글리프 한도를 넘음: ${mw}x${mh}`);
  const p = new Uint8Array(w * h * 4), voidColor: RGBA = [34, 29, 45, 255];
  for (let i = 0; i < w * h; i++) p.set(voidColor, i * 4);
  const layer = (name: string) => json.layers.find(x => x.name === name)?.data;
  const ground = layer("ground"), water = layer("water"), below = layer("decor_below"), above = layer("decor_above"), collision = layer("collision"), heights = layer("height");
  for (const [name, data] of [["ground", ground], ["water", water], ["decor_below", below], ["collision", collision], ["decor_above", above]] as const)
    assert(data && data.length === mw * mh, `맵 ${name} 레이어 누락/길이 오류`);
  for (let y = 0; y < mh; y++) for (let x = 0; x < mw; x++) {
    const i = y * mw + x, gid = below![i] || water![i] || ground![i], name = tileColors[gid] ? gid : ground![i], kind = hillKind(heights, mw, mh, x, y);
    let c = rgb(tileColors[name] ?? "#221d2d");
    const variation = (x * 37 + y * 71 + x * y * 13) % 29;
    if (variation === 0) c = shade(`#${c.map(v => v.toString(16).padStart(2, "0")).join("")}`, -.08);
    if (kind === 2) c = c.map(v => Math.round(v * .78)) as [number, number, number];
    if (kind === 8) c = shade(`#${c.map(v => v.toString(16).padStart(2, "0")).join("")}`, .12);
    const px = padding + x, py = padding + y;
    set(p, w, h, px, py, [...c, 255]);
    if (kind === 1) set(p, w, h, px, py + 0, [75, 59, 55, 255]); // south-facing hill face
    else if (kind === 4) set(p, w, h, px, py, [241, 211, 132, 255]); // hillside stair
    if (above![i]) set(p, w, h, px, py, [...rgb(tileColors[above![i]] ?? "#526b38"), 255]);
    if (collision![i] === 13 && !water![i]) set(p, w, h, px, py, [47, 40, 48, 255]);
  }
  const objects = json.layers.find(x => x.type === "objectgroup")?.objects ?? [];
  const ordered = [...objects].sort((a, b) => {
    const rank = (t: string) => t === "tree" || t === "bush" ? 0 : t === "building" || t.startsWith("tent_") ? 1 : t === "portal" ? 2 : t === "npc" ? 3 : 4;
    return rank(a.type) - rank(b.type) || a.y - b.y || a.id - b.id;
  });
  for (const o of ordered) {
    const x = padding + Math.floor(o.x / 16), y = padding + Math.floor(o.y / 16),
      rx = Math.max(1, Math.round(o.width / 32)), ry = Math.max(1, Math.round(o.height / 32));
    const point = (color: string) => set(p, w, h, x, y, [...rgb(color), 255]);
    switch (o.type) {
      case "tree": ellipse(p, w, h, x, y - Math.max(1, ry / 2), rx + 1, Math.max(1, Math.round(ry / 2)), [59, 101, 47, 255]); point("#8CC63F"); break;
      case "bush": ellipse(p, w, h, x, y, rx, Math.max(1, ry / 2), [87, 139, 54, 255]); break;
      case "rock": case "pillar": case "statue":
        rect(p, w, h, x - rx, y - ry, rx * 2 + 1, ry * 2 + 1, [139, 130, 115, 255]); point("#d4c6ad"); break;
      case "building": case "tent_shop": case "tent_market": {
        const color = o.type === "tent_market" ? "#1FB5A8" : o.type === "tent_shop" ? "#FF9F43" : "#C8643B";
        rect(p, w, h, x - rx, y - ry, rx * 2 + 1, ry * 2 + 1, [43, 34, 42, 255]);
        rect(p, w, h, x - rx + 1, y - ry + 1, Math.max(1, rx * 2 - 1), Math.max(1, ry * 2 - 1), [...rgb(color), 255]);
        break;
      }
      case "portal": {
        const target = String(prop(o, "target") ?? "");
        ellipse(p, w, h, x, y, 3, 3, [...rgb(target === "dungeon" ? "#B57BFF" : target === "arena" ? "#E5484D" : target === "next" ? "#F2C94C" : "#4CC764"), 255], true);
        set(p, w, h, x, y, [35, 26, 47, 255]); break;
      }
      case "spawn_zone": {
        const boss = String(prop(o, "grade") ?? "normal") !== "normal", color = boss ? [255, 138, 31, 255] as RGBA : [229, 72, 77, 255] as RGBA;
        const r = Math.max(2, Math.round(o.width / 32));
        ellipse(p, w, h, x, y, r, r, [color[0], color[1], color[2], 255], true); break;
      }
      case "npc": ellipse(p, w, h, x, y, 2, 2, [255, 225, 77, 255]); set(p, w, h, x, y, [43, 29, 46, 255]); break;
      case "fountain": case "well": ellipse(p, w, h, x, y, 3, 2, [94, 200, 240, 255], true); set(p, w, h, x, y, [111, 210, 245, 255]); break;
      case "campfire": set(p, w, h, x, y, [255, 122, 42, 255]); set(p, w, h, x, y - 1, [255, 210, 122, 255]); break;
      case "mailbox": case "board": case "anvil": case "workbench": case "spawn":
        point(o.type === "spawn" ? "#fff4dc" : o.type === "mailbox" ? "#3b6fd6" : o.type === "anvil" ? "#9AA3AD" : "#c98d58"); break;
      default: break;
    }
  }
  const preview: Image = { width: w, height: h, pixels: new Uint8Array(p) };
  // One-pixel transparent tag frame lets the shader identify this map glyph; vanilla discards alpha 1/255.
  for (let x = 0; x < w; x++) { set(p, w, h, x, 0, [...mapTag, transparentAlpha]); set(p, w, h, x, h - 1, [...mapTag, transparentAlpha]); }
  for (let y = 0; y < h; y++) { set(p, w, h, 0, y, [...mapTag, transparentAlpha]); set(p, w, h, w - 1, y, [...mapTag, transparentAlpha]); }
  for (let i = 0; i < w * h; i++) if (p[i * 4 + 3] !== transparentAlpha) p[i * 4 + 3] = transparentAlpha;
  return { w, h, preview, image: { width: w, height: h, pixels: p } };
}

function addGlyphChar(contract: any, used: Set<number>, name: string) {
  const existing = contract.glyphs[name]?.char;
  if (existing) {
    const code = existing.codePointAt(0)!;
    assert(code >= 0xe000 && code <= 0xf8ff, `PUA 밖의 글리프 코드: ${name}`);
    return existing;
  }
  let code = 0xe000;
  while (used.has(code) && code <= 0xf8ff) code++;
  assert(code <= 0xf8ff, "Private Use Area 글리프 코드 공간이 부족합니다.");
  used.add(code); return String.fromCodePoint(code);
}
function tintPixelPattern(lines: string[], color: RGBA = [255, 244, 220, 255]): Image {
  const w = Math.max(...lines.map(x => x.length)), h = lines.length, pixels = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < lines[y].length; x++) if (lines[y][x] !== ".") set(pixels, w, h, x, y, color);
  return { width: w, height: h, pixels };
}
async function renderLabel(text: string): Promise<Image> {
  const font = readFileSync(join(assets, "font/Galmuri11.ttf")).toString("base64");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="14"><defs><style>@font-face{font-family:Galmuri11;src:url(data:font/ttf;base64,${font})} text{font-family:Galmuri11;font-size:10px;fill:#fff4dc}</style></defs><text x="0" y="11">${text}</text></svg>`;
  const result = await sharp(Buffer.from(svg)).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  let minX = result.info.width, minY = result.info.height, maxX = -1, maxY = -1;
  for (let y = 0; y < result.info.height; y++) for (let x = 0; x < result.info.width; x++) if (result.data[(y * result.info.width + x) * 4 + 3] > 8) {
    minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
  }
  assert(maxX >= minX && maxY >= minY, `스탯 한글 글리프가 비었습니다: ${text}`);
  const w = maxX - minX + 1, h = maxY - minY + 1, pixels = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) pixels.set(result.data.subarray(((minY + y) * result.info.width + minX) * 4, ((minY + y) * result.info.width + minX + w) * 4), y * w * 4);
  return { width: w, height: h, pixels };
}

const contractPath = join(resources, "hud-glyphs.json");
const contract = JSON.parse(readFileSync(contractPath, "utf8"));
const used = new Set<number>();
for (const g of Object.values(contract.glyphs) as any[]) if (g.char) used.add(g.char.codePointAt(0));
for (const ch of Object.values(contract.spaces) as string[]) used.add(ch.codePointAt(0));
contract.fonts.minimapMaps = "ruc:hud_minimap_maps";
contract.fonts.minimapPixels = "ruc:hud_minimap_pixels";
contract.fonts.minimapArrow = "ruc:hud_minimap_arrow";
contract.fonts.statsBitmaps = Object.fromEntries(statRows.map(([id]) => [id, `ruc:hud_stats_${id}`]));
contract.minimap = {
  window: { anchor: "top-right", x: "screenWidth - 68", y: 4, width: 64, height: 64, margin: 4 },
  mapPixels: { tile: 1, tileBlocks: 2, padding: 32, mapBlockToPixel: "floor((block - mapOrigin) / 2)", viewRadiusTiles: 32 },
  mapGlyph: { font: "ruc:hud_minimap_maps", name: "minimap.map.<plaza|highland|field|dungeon|arena>", order: ["map glyph first; then player pixel/direction glyphs with zero-net advance"], hiddenWithoutShader: "PNG alpha 1/255; vanilla rendertype_text discards alpha < 0.1" },
  scrollColor: { componentTextColor: "#RRGGBB", r: "128 + floor(playerTileX - mapWidth/2)", g: "128 + floor(playerTileY - mapHeight/2)", b: 0, shaderDecode: "dx = r - 128; dy = g - 128; each encoded delta is clipped to signed 7-bit range [-64, 63]", mapTransform: "screenCenter=(screenWidth-36,36); map glyph itself is centered at bossbar title center=(screenWidth/2,12); shader translates by (screenWidth/2-36-dx,24-dy) GUI px" },
  skinPixels: { font: "ruc:hud_minimap_pixels", name: "minimap.head.pixel.<00-63>", order: "row-major y*8+x; each 1x1 glyph is tinted by the original skin pixel RGB", advance: 1, yFonts: "ruc:hud_minimap_pixel_y_<m36..p35>", yPosition: "font offset = target pixel Y relative to marker center; x is placed with space glyphs", otherPlayerDelta: "(floor(otherBlockX/2)-floor(ownBlockX/2), floor(otherBlockZ/2)-floor(ownBlockZ/2))", self: "same 8x8 pixels at delta (0,0), centered over the viewport center" },
  direction: { font: "ruc:hud_minimap_arrow", name: "minimap.direction.<0-7>", order: ["S", "SE", "E", "NE", "N", "NW", "W", "SW"], center: "self map center", size: [9, 9] },
  pixelSentinel: { map: [...mapTag, transparentAlpha], skinPixel: [...pixelTag, transparentAlpha], direction: [...arrowTag, transparentAlpha], legacyTest: "alpha=254/255 cyan sentinel from minimap.red/blue" },
};

const mapProviders: any[] = [], mapMeta: Record<string, any> = {}, generated: string[] = [];
for (const id of mapIds) {
  const json = JSON.parse(readFileSync(join(root, `web/rpg/shared/data/maps/${id}.json`), "utf8")) as MapJson;
  const result = drawMap(json), name = `minimap.map.${id}`, char = addGlyphChar(contract, used, name), file = `map_${id}.png`;
  const imagePath = join(textures, file); writePng(imagePath, result.image); writePng(join(previewDir, file), result.preview);
  mapProviders.push({ type: "bitmap", file: `ruc:hud/minimap/${file}`, height: result.h, ascent: result.h / 2, chars: [[char]] });
  contract.glyphs[name] = { font: "ruc:hud_minimap_maps", char, advance: result.w, width: result.w, height: result.h, texture: `ruc:hud/minimap/${file}` };
  mapMeta[id] = { glyph: name, char, width: result.w, height: result.h, worldWidth: json.width, worldHeight: json.height, padding, center: [json.width / 2, json.height / 2] };
  generated.push(imagePath);
}
writeJson(join(fontDir, "hud_minimap_maps.json"), { providers: mapProviders });

const headChars = Array.from({ length: 64 }, (_, i) => {
  const name = `minimap.head.pixel.${String(i).padStart(2, "0")}`, char = addGlyphChar(contract, used, name);
  contract.glyphs[name] = { font: "ruc:hud_minimap_pixels", char, advance: 1, width: 1, height: 1, pixel: [i % 8, Math.floor(i / 8)] };
  return char;
});
const pixelStrip: Image = { width: 64, height: 1, pixels: new Uint8Array(64 * 4) };
for (let x = 0; x < 64; x++) set(pixelStrip.pixels, 64, 1, x, 0, [...pixelTag, transparentAlpha]);
writePng(join(textures, "head_pixels.png"), pixelStrip); generated.push(join(textures, "head_pixels.png"));
writeJson(join(fontDir, "hud_minimap_pixels.json"), { providers: [{ type: "bitmap", file: "ruc:hud/minimap/head_pixels.png", height: 1, ascent: 0, chars: [headChars.join("")] }] });
const pixelYFonts: Record<string, string> = {};
for (let dy = -36; dy <= 35; dy++) {
  const suffix = dy < 0 ? `m${-dy}` : `p${dy}`, id = `ruc:hud_minimap_pixel_y_${suffix}`;
  pixelYFonts[String(dy)] = id;
  writeJson(join(fontDir, `hud_minimap_pixel_y_${suffix}.json`), { providers: [{ type: "bitmap", file: "ruc:hud/minimap/head_pixels.png", height: 1, ascent: -dy, chars: [headChars.join("")] }] });
}
contract.minimap.skinPixels.yFonts = pixelYFonts;

const arrowChars: string[] = [], arrowProviders: any[] = [];
const vectors: [number, number][] = [[0, 1], [1, 1], [1, 0], [1, -1], [0, -1], [-1, -1], [-1, 0], [-1, 1]];
for (let dir = 0; dir < vectors.length; dir++) {
  const name = `minimap.direction.${dir}`, char = addGlyphChar(contract, used, name), pixels = new Uint8Array(9 * 9 * 4), [dx, dy] = vectors[dir];
  for (let y = 1; y < 8; y++) for (let x = 1; x < 8; x++) {
    const forward = (x - 4) * dx + (y - 4) * dy, cross = Math.abs((x - 4) * dy - (y - 4) * dx);
    if (forward >= -1 && forward <= 3 && cross <= (3 - forward) * .7 + .5) set(pixels, 9, 9, x, y, [255, 244, 220, transparentAlpha]);
  }
  for (let i = 0; i < 9; i++) { set(pixels, 9, 9, i, 0, [...arrowTag, transparentAlpha]); set(pixels, 9, 9, i, 8, [...arrowTag, transparentAlpha]); set(pixels, 9, 9, 0, i, [...arrowTag, transparentAlpha]); set(pixels, 9, 9, 8, i, [...arrowTag, transparentAlpha]); }
  const file = `direction_${dir}.png`; writePng(join(textures, file), { width: 9, height: 9, pixels }); generated.push(join(textures, file));
  arrowChars.push(char); contract.glyphs[name] = { font: "ruc:hud_minimap_arrow", char, advance: 9, width: 9, height: 9 };
  arrowProviders.push({ type: "bitmap", file: `ruc:hud/minimap/${file}`, height: 9, ascent: 4, chars: [[char]] });
}
writeJson(join(fontDir, "hud_minimap_arrow.json"), { providers: arrowProviders });

const digitRows = ["111101101101111", "010110010010111", "111001111100111", "111001111001111", "101101111001001", "111100111001111", "111100111101111", "111001001001001", "111101111101111", "111101111001111"];
const numImages: Record<string, Image> = {};
digitRows.forEach((bits, n) => {
  numImages[String(n)] = tintPixelPattern(Array.from({ length: 5 }, (_, y) => bits.slice(y * 3, y * 3 + 3)));
});
numImages.dot = tintPixelPattern(["..", "..", "..", "..", "..", ".#", ".#"]);
numImages.pct = tintPixelPattern(["#...#..", "#...#.#", "....##..", "...##...", "..##....", ".#...#..", "#....#.."]);
const labelImages: Record<string, Image> = {};
for (const [id, text] of statRows) labelImages[id] = await renderLabel(text);
for (const [key, nimg] of Object.entries(numImages)) {
  const file = `stats_number_${key}.png`;
  writePng(join(glyphTextures, file), nimg); generated.push(join(glyphTextures, file));
}
for (const [id, img] of Object.entries(labelImages)) {
  const file = `stats_label_${id}.png`; writePng(join(glyphTextures, file), img); generated.push(join(glyphTextures, file));
  const rowFont = `ruc:hud_stats_${id}`, char = addGlyphChar(contract, used, `stats.label.${id}`), row = statRows.findIndex(x => x[0] === id), ascent = 8 - row * 10;
  const providers = [{ type: "bitmap", file: `ruc:hud/glyphs/${file}`, height: img.height, ascent, chars: [[char]] }];
  const name = `stats.label.${id}`;
  contract.glyphs[name] = { font: rowFont, char, advance: img.width + 1, width: img.width, height: img.height, inkWidth: img.width };
  for (const [key, nimg] of Object.entries(numImages)) {
    const nf = `stats_number_${key}.png`, metric = `stats.num.${id}.${key}`, nchar = addGlyphChar(contract, used, metric);
    providers.push({ type: "bitmap", file: `ruc:hud/glyphs/${nf}`, height: nimg.height, ascent, chars: [[nchar]] });
    contract.glyphs[metric] = { font: rowFont, char: nchar, advance: nimg.width + 1, width: nimg.width, height: nimg.height, inkWidth: nimg.width };
    // The numeric ink is shared by all rows; this alias is the stable Java-facing name.
  }
  writeJson(join(fontDir, `hud_stats_${id}.json`), { providers });
  contract.fonts.statsBitmaps[id] = rowFont;
  const layout = contract.layout[`stats.text.${id}`];
  layout.font = rowFont; layout.label = { name, x: layout.labelX, font: rowFont, advance: img.width + 1 };
  layout.value = { x: layout.valueX, font: rowFont, names: `stats.num.${id}.<0-9|dot|pct>`, advanceFromGlyphs: true };
}

contract.minimap.maps = mapMeta;
contract.layout.minimap = { x: "screenWidth - 68", y: 4, width: 64, height: 64, clip: "shader", mapTilePixels: 1, mapTileBlocks: 2, baseTitleCenter: ["screenWidth/2", 12] };
contract.layout.minimap.map = { font: "ruc:hud_minimap_maps", names: "minimap.map.<map-id>", first: true, componentColor: "scrollColor", advance: "map glyph width; all marker additions must have net advance zero" };
contract.layout.minimap.players = { skinOrder: "row-major y*8+x", glyphs: "minimap.head.pixel.<00-63>", pixelAdvance: 1, playerCenterDelta: "other tile coordinate minus own tile coordinate", xPlacement: "move cursor to map-center-relative x-4; emit 8 pixels; rewind 8 after each row", yFont: "ruc:hud_minimap_pixel_y_<signed deltaY>; deltaY = playerCenterDeltaY + row - 4", ownHead: "center at (0,0), same skin pixel order", ownDirection: "minimap.direction.<DIRS index>, centered at (0,0)" };
contract.layout.minimap.scrollColor = contract.minimap.scrollColor;
contract.layout.statsBitmaps = Object.fromEntries(statRows.map(([id]) => [id, { label: `stats.label.${id}`, valueNames: `stats.num.${id}.<0-9|dot|pct>`, font: `ruc:hud_stats_${id}`, x: contract.layout[`stats.text.${id}`].x, y: contract.layout[`stats.text.${id}`].y, labelX: contract.layout[`stats.text.${id}`].labelX, valueX: contract.layout[`stats.text.${id}`].valueX }]));

writeJson(contractPath, contract);
const jsonCheck = JSON.parse(readFileSync(contractPath, "utf8"));
assert(Object.keys(jsonCheck.minimap.maps).length === 5, "미니맵 5종 계약 저장 확인 실패");
assert(Object.keys(jsonCheck.glyphs).filter((n: string) => n.startsWith("minimap.head.pixel.")).length === 64, "스킨 픽셀 글리프 수 오류");
assert(Object.keys(jsonCheck.glyphs).filter((n: string) => n.startsWith("stats.label.")).length === 8, "스탯 라벨 글리프 수 오류");
assert(Object.keys(jsonCheck.glyphs).filter((n: string) => n.startsWith("stats.num.")).length === 96, "스탯 숫자/기호 글리프 수 오류");
assert(generated.every(existsSync), "생성 PNG 누락");

console.log(`Minimap art: ${mapIds.length} maps, 64 skin pixels, 8 direction arrows, 8 Korean labels, 96 stat value glyphs.`);
console.log(`Map preview PNGs: ${join(".scratch", "codex", "mc-minimap")}; 1 tile = 1 map pixel = 2 Minecraft blocks.`);
