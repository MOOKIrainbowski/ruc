/** Build the Minecraft M1 HUD resource-pack glyphs from the web RPG's pixel art. */
import { copyFileSync, mkdirSync, readdirSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { deflateSync } from "node:zlib";
import { registerHooks } from "node:module";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const pack = join(root, "minecraft/resourcepack/assets");
const rpg = join(root, "minecraft/plugins/RucRpg/src/main/resources");
const fontDir = join(pack, "ruc/font");
const texDir = join(pack, "ruc/textures/font/hud");
const hudFiles = join(pack, "minecraft/textures/gui/sprites/hud");
mkdirSync(texDir,{recursive:true});
for (const name of readdirSync(texDir)) if (/^atlas_/.test(name)) unlinkSync(join(texDir,name));

// Node can strip the source TS syntax but these web modules intentionally use a
// browser bundler's extensionless imports. Resolve those imports without editing web/.
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith(".") && !/\.(?:[cm]?js|json|node|ts)$/.test(specifier)) {
      try { return nextResolve(`${specifier}.ts`, context); } catch { /* try normal resolution */ }
    }
    return nextResolve(specifier, context);
  },
});

class CanvasImageData {
  data: Uint8ClampedArray;
  width: number;
  height: number;
  constructor(data: Uint8ClampedArray, width: number, height: number) { this.data = data; this.width = width; this.height = height; }
}
class CanvasShim {
  width = 0;
  height = 0;
  image?: CanvasImageData;
  getContext() {
    return {
      putImageData: (image: CanvasImageData) => { this.image = image; },
      getImageData: () => this.image,
    };
  }
}
Object.assign(globalThis, { document: { createElement: () => new CanvasShim() }, ImageData: CanvasImageData });

const [{ skillIcon, effectIcon, statIcon }, { SKILLS }, { EFFECTS }, { ELEMENTS }, { LINES, JOBS }] = await Promise.all([
  import(pathToFileURL(join(root, "web/rpg/client/art/icons.ts")).href),
  import(pathToFileURL(join(root, "web/rpg/shared/data/skills.ts")).href),
  import(pathToFileURL(join(root, "web/rpg/shared/data/effects.ts")).href),
  import(pathToFileURL(join(root, "web/rpg/shared/data/elements.ts")).href),
  import(pathToFileURL(join(root, "web/rpg/shared/data/jobs.ts")).href),
]);

type Image = { width: number; height: number; image?: CanvasImageData };
type Pixel = [number, number, number, number];
const RGBA = (w: number, h: number, fill: Pixel = [0, 0, 0, 0]) => {
  const out = new Uint8Array(w * h * 4);
  for (let i = 0; i < w * h; i++) out.set(fill, i * 4);
  return out;
};
function set(data: Uint8Array, w: number, h: number, x: number, y: number, color: Pixel) {
  if (x < 0 || y < 0 || x >= w || y >= h) return;
  data.set(color, (y * w + x) * 4);
}
function rect(data: Uint8Array, w: number, h: number, x: number, y: number, rw: number, rh: number, color: Pixel) {
  for (let yy = y; yy < y + rh; yy++) for (let xx = x; xx < x + rw; xx++) set(data, w, h, xx, yy, color);
}
function pngChunk(type: string, body: Uint8Array): Buffer {
  const name = Buffer.from(type, "ascii");
  const len = Buffer.alloc(4); len.writeUInt32BE(body.length);
  const crcData = Buffer.concat([name, Buffer.from(body)]);
  let crc = 0xffffffff;
  for (const byte of crcData) {
    crc ^= byte;
    for (let b = 0; b < 8; b++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  const crcBuf = Buffer.alloc(4); crcBuf.writeUInt32BE((crc ^ 0xffffffff) >>> 0);
  return Buffer.concat([len, name, Buffer.from(body), crcBuf]);
}
function png(w: number, h: number, pixels: Uint8Array): Buffer {
  if (pixels.length !== w * h * 4) throw new Error(`bad RGBA length ${w}x${h}: ${pixels.length}`);
  const scan = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) scan.set(pixels.subarray(y * w * 4, (y + 1) * w * 4), y * (w * 4 + 1) + 1);
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]), pngChunk("IHDR", ihdr), pngChunk("IDAT", deflateSync(scan, { level: 9 })), pngChunk("IEND", new Uint8Array())]);
}
function writePng(path: string, w: number, h: number, data: Uint8Array) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, png(w, h, data));
}
function imageOf(canvas: Image): { width: number; height: number; pixels: Uint8Array } {
  if (!canvas.image) throw new Error("web icon did not create ImageData");
  return { width: canvas.width, height: canvas.height, pixels: new Uint8Array(canvas.image.data.buffer.slice(0)) };
}
const priv = (code: number) => String.fromCodePoint(code);
let nextChar = 0xe000;
type Glyph = { name: string; char: string; w: number; h: number; pixels: Uint8Array; advance: number; group: string };
const glyphs: Glyph[] = [];
const byName: Record<string, { char: string; width: number }> = {};
function groupFor(name:string):string {
  if(name.startsWith("bar.")) return "bar";
  if(name==="skill.slot") return "skill_slot";
  if(name.startsWith("skill.cd.")||name==="skill.nores") return "skill_overlay";
  if(name.startsWith("skill.")) return "skill_icon";
  if(name.startsWith("key.")) return "key";
  if(name.startsWith("effect.")) return "effect";
  if(name.startsWith("num.small.")) return "effect_num";
  if(name.startsWith("num.orb.")) return "orb_num";
  if(name.startsWith("orb.")&&name.endsWith(".unused")) return "orb_unused";
  if(name.startsWith("orb.")) return "orb";
  if(name.startsWith("stats.bg.")) return "stats_bg";
  if(name.startsWith("stats.icon.")) return `stats_icon_${name.split(".")[2]}`;
  if(name.startsWith("minimap.")) return "minimap";
  return "hud";
}
function inkWidth(w:number,h:number,pixels:Uint8Array):number {
  let right=-1; for(let y=0;y<h;y++) for(let x=0;x<w;x++) if(pixels[(y*w+x)*4+3]>0) right=Math.max(right,x);
  return right+1;
}
function add(name: string, w: number, h: number, pixels: Uint8Array) {
  if (nextChar > 0xf8ff) throw new Error("Private-use glyph range exhausted");
  const char = priv(nextChar++);
  const advance=inkWidth(w,h,pixels)+1; // 1.21.11 BitmapProvider: rounded ink width + one pixel.
  glyphs.push({ name, char, w, h, pixels, advance, group:groupFor(name) });
  byName[name] = { char, width: advance };
}
function canvasGlyph(name: string, canvas: Image, targetW?:number,targetH?:number) {
  const src = imageOf(canvas);
  const out=targetW&&targetH?resizeNearest(src,targetW,targetH):src;
  add(name, out.width, out.height, out.pixels);
}
function saveImage(path: string, image: { width: number; height: number; pixels: Uint8Array }) {
  writePng(path, image.width, image.height, image.pixels);
}
function resizeNearest(src:{width:number;height:number;pixels:Uint8Array},w:number,h:number) {
  const pixels=RGBA(w,h);
  for(let y=0;y<h;y++) for(let x=0;x<w;x++) {
    const sx=Math.min(src.width-1,Math.floor((x+0.5)*src.width/w)), sy=Math.min(src.height-1,Math.floor((y+0.5)*src.height/h));
    const i=(sy*src.width+sx)*4; pixels.set(src.pixels.subarray(i,i+4),(y*w+x)*4);
  }
  return {width:w,height:h,pixels};
}

// Vanilla sprite names verified against the installed 1.21.11 client jar.
const transparent = [
  "food_empty.png", "food_half.png", "food_full.png", "food_empty_hunger.png", "food_half_hunger.png", "food_full_hunger.png",
  "armor_empty.png", "armor_half.png", "armor_full.png", "air.png", "air_empty.png", "air_bursting.png",
  ...["full", "full_blinking", "half", "half_blinking", "container", "container_blinking", "container_hardcore", "container_hardcore_blinking",
    "hardcore_full", "hardcore_full_blinking", "hardcore_half", "hardcore_half_blinking",
    "poisoned_full", "poisoned_full_blinking", "poisoned_half", "poisoned_half_blinking",
    "poisoned_hardcore_full", "poisoned_hardcore_full_blinking", "poisoned_hardcore_half", "poisoned_hardcore_half_blinking",
    "withered_full", "withered_full_blinking", "withered_half", "withered_half_blinking",
    "withered_hardcore_full", "withered_hardcore_full_blinking", "withered_hardcore_half", "withered_hardcore_half_blinking",
    "absorbing_full", "absorbing_full_blinking", "absorbing_half", "absorbing_half_blinking",
    "absorbing_hardcore_full", "absorbing_hardcore_full_blinking", "absorbing_hardcore_half", "absorbing_hardcore_half_blinking",
    "frozen_full", "frozen_full_blinking", "frozen_half", "frozen_half_blinking", "frozen_hardcore_full", "frozen_hardcore_full_blinking",
    "frozen_hardcore_half", "frozen_hardcore_half_blinking", "vehicle_full", "vehicle_half", "vehicle_container"].map((n) => `heart/${n}.png`),
];
for (const name of transparent) writePng(join(hudFiles, name), 1, 1, RGBA(1, 1));

// Import exact web pixel-art output. Colors follow Growth.skillBg's stable
// element/job/category fallback; per-player inherited element tints remain dynamic.
function skillBackground(sk: (typeof SKILLS)[string]): string {
  if (sk.elementInherit) return ELEMENTS.fire.color; // deterministic preview; runtime HUD may tint via its component color.
  if (sk.el) return ELEMENTS[sk.el].color;
  if (sk.sub) return ELEMENTS.fire.color;
  const line = sk.job?.find((j: string) => j in LINES) ?? (JOBS[sk.job?.[0]]?.line as string | undefined);
  if (line) return LINES[line].color;
  return sk.category === "magical" ? "#9B5DE5" : sk.heal ? "#4CC764" : "#9AA3AD";
}
const skills = Object.entries(SKILLS).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0);
for (const [id, sk] of skills) {
  canvasGlyph(`skill.${id}`, skillIcon(id, skillBackground(sk)) as unknown as Image,16,16);
  if (sk.elementInherit || sk.sub) for (const [element, def] of Object.entries(ELEMENTS))
    canvasGlyph(`skill.${id}.element.${element}`, skillIcon(id, def.color) as unknown as Image,16,16);
}
for (const id of Object.keys(EFFECTS).sort()) canvasGlyph(`effect.${id}`, effectIcon(id) as unknown as Image,10,10);
const statRows=[
  ["attack","sword","#E8EEF5"],["spell","star","#9B5DE5"],["pdef","shield","#9AA3AD"],["mdef","shield","#B39DDB"],
  ["attack_speed","bolt","#F5C542"],["move_speed","wing","#BDF3E1"],["crit","target","#E5484D"],["luck","clover","#2ECC71"],
] as const;
for(let row=0;row<statRows.length;row++) { const [id,icon,color]=statRows[row]; canvasGlyph(`stats.icon.${row}.${icon}`,statIcon(icon,color) as unknown as Image,8,8); }

// Draw a 32px game-style glass orb: metal rim, spherical shading, liquid fill,
// tiny wave/bubbles and a sharp upper-left reflection.
function orb(name: string, fill: number, theme: "mana" | "energy" | "unused") {
  const w = 32, h = 32, p = RGBA(w, h);
  const rgb = (hex: string): Pixel => [parseInt(hex.slice(1,3),16), parseInt(hex.slice(3,5),16), parseInt(hex.slice(5,7),16),255];
  const dark = theme === "mana" ? "#0A2478" : theme === "energy" ? "#7A2E02" : "#4B4B4B";
  const mid = theme === "mana" ? "#2F7BFF" : theme === "energy" ? "#FF8A1F" : "#777777";
  const light = theme === "mana" ? "#B4DCFF" : theme === "energy" ? "#FFDC A0".replace(" ", "") : "#C5C5C5";
  const metal = (x:number,y:number) => { const d=(x-15.5)**2+(y-15.5)**2; return d<=14.4**2 && d>=12.2**2; };
  const inside=(x:number,y:number)=>((x-15.5)**2+(y-15.5)**2)<=11.8**2;
  for(let y=1;y<31;y++) for(let x=1;x<31;x++) {
    if(metal(x,y)) set(p,w,h,x,y,(x<16&&y<16)?[210,188,133,255]:(x>16&&y>16)?[86,65,44,255]:[151,126,84,255]);
    if(inside(x,y)) {
      const cap = Math.round(32*fill/32);
      const surface=28-Math.round(cap*0.68);
      const waveY=surface+((x%7)<3?1:0);
      const liquid=fill>0 && y>=waveY;
      const edge = x<8&&y<9 ? light : liquid ? mid : dark;
      set(p,w,h,x,y,rgb(edge));
      if((x===8&&y===8)||(x===9&&y===7)||(x===7&&y===9)) set(p,w,h,x,y,[245,250,255,220]);
      if(liquid&&((x===21&&y===surface-2)||(x===24&&y===surface-4))) set(p,w,h,x,y,[255,255,255,180]);
    }
  }
  for(let x=9;x<14;x++) set(p,w,h,x,4,[255,255,255,220]);
  for(let x=7;x<10;x++) set(p,w,h,x,6,[230,245,255,210]);
  return {width:w,height:h,pixels:p};
}
for (let n=0;n<=32;n++) {
  const mana=resizeNearest(orb("",n,"mana"),36,36), energy=resizeNearest(orb("",n,"energy"),36,36);
  add(`orb.mana.${n}`,36,36,mana.pixels); add(`orb.energy.${n}`,36,36,energy.pixels);
}
for(const res of ["mana","energy"] as const) { const unused=resizeNearest(orb("",0,"unused"),36,36); add(`orb.${res}.unused`,36,36,unused.pixels); }

// 89px bars use 29 three-pixel pieces plus a two-pixel end piece (30 pieces).
// Each non-final piece advances 4px; the compositor inserts space(-1) after it,
// so artwork pitch stays 3px and the visible bar is exactly 89px wide.
const barH=9, barCells=30;
function barChunk(kind:"hp"|"stamina"|"exhaust"|"shield", index:number, filled:number) {
  const w=index===barCells-1?2:3, p=RGBA(w,barH), last=index===barCells-1;
  const gold:Pixel=[201,162,74,255], bg:Pixel=kind==="exhaust"?[91,34,38,255]:[43,29,46,255];
  const fill:Pixel=kind==="hp"?[76,199,100,255]:kind==="stamina"?[201,162,122,255]:[229,72,77,255];
  if(kind==="shield") {
    if(filled>0) rect(p,w,barH,0,1,Math.min(w,filled),barH-2,[255,255,255,145]);
    set(p,w,barH,w-1,barH-1,[0,0,0,1]); // retain stable bitmap advance for transparent overlay stages.
    return {width:w,height:barH,pixels:p};
  }
  rect(p,w,barH,0,0,w,1,gold); rect(p,w,barH,0,barH-1,w,1,gold);
  if(index===0) rect(p,w,barH,0,0,1,barH,gold);
  if(last) rect(p,w,barH,w-1,0,1,barH,gold);
  rect(p,w,barH,0,1,w,barH-2,bg);
  if(filled>0) rect(p,w,barH,0,1,Math.min(w,filled),barH-2,fill);
  if(index>0&&index%3===0) rect(p,w,barH,0,0,1,index%15===0?4:2,[255,226,155,255]);
  if(last) rect(p,w,barH,w-1,0,1,barH,gold);
  return {width:w,height:barH,pixels:p};
}
for(const kind of ["hp","stamina","exhaust"] as const) for(let i=0;i<barCells;i++) {
  const w=i===barCells-1?2:3;
  for(let f=0;f<=w;f++) add(`bar.${kind}.${i}.${f}`,w,barH,barChunk(kind,i,f).pixels);
}
for(let i=0;i<barCells;i++) { const w=i===barCells-1?2:3; for(let f=0;f<=w;f++) add(`bar.shield.${i}.${f}`,w,barH,barChunk("shield",i,f).pixels); }

// 20px skill tiles, 16px overlays and 8x5 key labels.
const frame=RGBA(20,20); rect(frame,20,20,0,0,20,20,[31,24,34,255]); rect(frame,20,20,1,1,18,18,[201,162,74,255]); rect(frame,20,20,2,2,16,16,[30,24,34,255]);
add("skill.slot",20,20,frame);
const passive=statIcon("sparkle","#FFF4B0") as unknown as Image; canvasGlyph("skill.passive",passive,16,16);
for(let stage=0;stage<8;stage++) {
  const p=RGBA(16,16);
  for(let y=0;y<16;y++) for(let x=0;x<16;x++) {
    const angle=(Math.atan2(y-7.5,x-7.5)+Math.PI*2)%(Math.PI*2), f=angle/(Math.PI*2);
    if(f<stage/8) set(p,16,16,x,y,[18,13,20,180]);
    else if(f<(stage+1)/8&&(x+y)%3!==0) set(p,16,16,x,y,[18,13,20,100]);
  }
  set(p,16,16,15,15,[0,0,0,1]); add(`skill.cd.${stage}`,16,16,p);
}
const red=RGBA(16,16);
for(let y=0;y<16;y++) for(let x=0;x<16;x++) if(x<2||y<2||x>=14||y>=14||((x+y)%5===0&&x>3&&y>3&&x<12&&y<12)) set(red,16,16,x,y,[229,72,77,185]);
add("skill.nores",16,16,red);
const microLetters:Record<string,string[]>={P:["110","101","110"],Q:["110","101","111"],S:["111","110","011"],F:["111","110","100"],R:["110","101","110"]};
for(const key of ["P","Q","SQ","F","SR"] as const) {
  const chars=key==="SQ"?["S","Q"]:key==="SR"?["S","R"]:[key];
  const w=chars.length*3+(chars.length-1), p=RGBA(w,3);
  chars.forEach((letter,index)=>microLetters[letter].forEach((row,y)=>[...row].forEach((bit,x)=>{ if(bit==="1") set(p,w,3,index*4+x,y,[255,244,210,255]); })));
  add(`key.${key}`,w,3,p);
}

// A fixed RGBA sentinel opts these glyphs into the minimap shader. Component
// colors tint them red/blue while their shared texture color avoids collisions.
for(const name of ["minimap.red","minimap.blue"] as const) {
  const marker=RGBA(8,8); rect(marker,8,8,0,0,8,8,[17,253,239,254]); add(name,8,8,marker);
}

// A single 98x84 parchment plate fits the layout and remains below the 256px tile limit.
const panel=RGBA(98,84); rect(panel,98,84,0,0,98,84,[232,211,169,255]);
rect(panel,98,84,0,0,98,2,[183,137,80,255]); rect(panel,98,84,0,82,98,2,[140,102,66,255]);
rect(panel,98,84,0,0,2,84,[183,137,80,255]); rect(panel,98,84,96,0,2,84,[140,102,66,255]);
for(let y=4;y<80;y+=4) for(let x=4;x<94;x+=8) if((x+y)%3===0) set(panel,98,84,x,y,[221,194,147,255]);
for(let i=0;i<8;i++){set(panel,98,84,4+i,4,[245,220,165,255]);set(panel,98,84,93-i,79,[111,77,49,255]);}
add("stats.bg.panel",98,84,panel);

// Small 3x5 dot digits for effect-duration badges.
const digits=["111101101101111","010110010010111","111001111100111","111001111001111","101101111001001","111100111001111","111100111101111","111001001001001","111101111101111","111101111001111"];
for(let d=0;d<10;d++) {
  const small=RGBA(3,5), large=RGBA(5,7);
  for(let i=0;i<15;i++) if(digits[d][i]==="1") { const x=i%3,y=Math.floor(i/3); set(small,3,5,x,y,[255,244,210,255]); rect(large,5,7,1+x,1+y,1,1,[255,244,210,255]); }
  add(`num.small.${d}`,3,5,small); add(`num.orb.${d}`,5,7,large);
}

// Persist one PNG per glyph too: reviewable without a game client, while font
// pages are packed into <=256px atlases below.
const perGlyph=join(texDir,"glyphs");
for(const g of glyphs) saveImage(join(perGlyph,`${g.name.replaceAll(".","_")}.png`),{width:g.w,height:g.h,pixels:g.pixels});

// Pack each placement family independently. Its ascent controls the screen
// top while the provider's image cell remains as short as its ink permits.
const charCodeByName:Record<string,string>={};
const ascentForGroup=(group:string)=>{
  if(group==="bar") return -25;
  if(group==="skill_slot") return -2;
  if(group==="skill_icon"||group==="skill_overlay") return -4;
  if(group==="key") return -25;
  if(group==="effect") return 13;
  if(group==="effect_num") return 6;
  if(group==="orb"||group==="orb_unused") return -29;
  if(group==="orb_num") return -43;
  if(group==="stats_bg") return 19;
  if(group.startsWith("stats_icon_")) return 17-10*Number(group.slice("stats_icon_".length));
  return 0;
};
const groups=[...new Set(glyphs.map(g=>g.group))];
for(const group of groups) {
  const batch=glyphs.filter(g=>g.group===group), providers:any[]=[];
  const sizes=[...new Set(batch.map(g=>`${g.w}x${Math.max(g.h,ascentForGroup(group)+1)}`))].sort();
  for(const size of sizes) {
    const [w,h]=size.split("x").map(Number), items=batch.filter(g=>g.w===w&&Math.max(g.h,ascentForGroup(group)+1)===h);
    const cols=Math.max(1,Math.floor(256/w)), rows=Math.max(1,Math.floor(256/h)), cap=cols*rows;
    for(let page=0;page<Math.ceil(items.length/cap);page++) {
      const part=items.slice(page*cap,(page+1)*cap), usedRows=Math.ceil(part.length/cols), usedCols=Math.min(cols,part.length), out=RGBA(usedCols*w,usedRows*h), chars:string[]=[];
      for(let i=0;i<part.length;i++) {
        const g=part[i], x=(i%cols)*w, y=Math.floor(i/cols)*h;
        for(let yy=0;yy<g.h;yy++) out.set(g.pixels.subarray(yy*w*4,(yy+1)*w*4),((y+yy)*usedCols*w+x)*4);
        chars.push(g.char); charCodeByName[g.name]=g.char;
      }
      const lines=[]; for(let y=0;y<usedRows;y++) {
        const line=chars.slice(y*cols,(y+1)*cols);
        while(line.length<usedCols) line.push(" ");
        lines.push(line.join(""));
      }
      const basename=`atlas_${group}_${w}x${h}_${String(page).padStart(2,"0")}.png`;
      writePng(join(texDir,basename),usedCols*w,usedRows*h,out);
      providers.push({type:"bitmap",file:`ruc:hud/${basename}`,height:h,ascent:ascentForGroup(group),chars:lines});
    }
  }
  writeFileSync(join(fontDir,`hud_${group}.json`),JSON.stringify({providers},null,2)+"\n","utf8");
}
for(const old of readdirSync(fontDir)) if(/^hud_row\d+\.json$/.test(old)) unlinkSync(join(fontDir,old));
writeFileSync(join(fontDir,"hud.json"),JSON.stringify({providers:[]},null,2)+"\n","utf8");
for(let row=0;row<8;row++) writeFileSync(join(fontDir,`stats_${statRows[row][0]}.json`),JSON.stringify({providers:[{type:"ttf",file:"ruc:Galmuri11.ttf",shift:[0,0],size:11,oversample:1.0}]},null,2)+"\n","utf8");
const groupFont=(group:string)=>`ruc:hud_${group}`;
const glyphContract:any={version:2,fonts:{hud:"ruc:hud",families:Object.fromEntries(groups.map(g=>[g,groupFont(g)])),stats:Object.fromEntries(statRows.map(([id])=>[id,`ruc:stats_${id}`]))},glyphs:{},spaces:{},spaceFont:"ruc:space",spacing:{},layout:{},statsFonts:{},notes:{coordinateOrigin:"bottom-center GUI px; x right+, y up+",defaultActionbarTextTopFromBottom:65,bitmapTopFromBottom:"65 + ascent",ascentFormula:"For target bottom-origin top Y: ascent = Y - 65. Vanilla actionbar drawString baseline gives text top at screenHeight-72; BitmapProvider ink top = drawY + (7-ascent).",actionbarOrigin:"centered; append -sum(advances) space to place cursor at x=0",bitmapAdvance:"1.21.11 rounded ink width + 1; emitted advance = rightmost nontransparent pixel + 1",atlasMax:256,barCells:30,barPitch:3,barWidth:89,orbStages:33,cooldownStages:8,skillCount:skills.length,effectCount:Object.keys(EFFECTS).length,contextualOverlayCaveat:"Coordinates assume default/no contextual left-right GUI overlays; vanilla actionbar y shifts when those overlays occupy more height."}};
for(const g of glyphs) glyphContract.glyphs[g.name]={font:groupFont(g.group),char:g.char,advance:g.advance,inkWidth:inkWidth(g.w,g.h,g.pixels),width:g.w,height:g.h};
const entry=(x:number,y:number,w:number,h:number,font:string,extra:Record<string,unknown>={})=>({x,y,w,h,font,...extra});
glyphContract.layout={
  "bar.hp":entry(-91,31,89,9,groupFont("bar"),{cells:30,pitch:3,cellNames:"bar.hp.<cell>.<fill>",spacingPerJoinedCell:-1}),
  "bar.stamina":entry(2,31,89,9,groupFont("bar"),{cells:30,pitch:3,cellNames:"bar.stamina.<cell>.<fill>",spacingPerJoinedCell:-1}),
  "bar.exhaust":entry(2,31,89,9,groupFont("bar"),{cells:30,pitch:3,cellNames:"bar.exhaust.<cell>.<fill>",spacingPerJoinedCell:-1}),
  "bar.shield":entry(-91,31,89,9,groupFont("bar"),{cells:30,pitch:3,cellNames:"bar.shield.<cell>.<fill>",spacingPerJoinedCell:-1}),
  "skill.slots":entry(-54,43,108,20,groupFont("skill_slot"),{count:5,gap:2,slotGlyph:"skill.slot",slotOrder:["passive","Q","SQ","F","SR"]}),
  "skill.icons":entry(-52,45,104,16,groupFont("skill_icon"),{count:5,step:22,iconNames:["skill.passive","skill.<id>","skill.<id>","skill.<id>","skill.<id>"]}),
  "skill.cooldown":entry(-52,45,104,16,groupFont("skill_overlay"),{count:5,step:22,stages:8,name:"skill.cd.<0-7>"}),
  "skill.nores":entry(-52,45,104,16,groupFont("skill_overlay"),{count:5,step:22,name:"skill.nores"}),
  "skill.keys":entry(-54,40,108,3,groupFont("key"),{count:5,step:22,align:"slot-center",names:["key.P","key.Q","key.SQ","key.F","key.SR"],readabilityNote:"3px micro-labels fit the only non-overlapping gap in the supplied coordinate bands."}),
  "effects":entry(-59,66,118,12,groupFont("effect"),{align:"center",max:10,gap:2,iconW:10,iconH:10,name:"effect.<id>",durationFont:groupFont("effect_num"),durationName:"num.small.<0-9>",durationSize:[3,5]}),
  "orb.mana":entry(-131,0,36,36,groupFont("orb"),{stages:33,unusedFont:groupFont("orb_unused"),unusedName:"orb.mana.unused",numberFont:groupFont("orb_num"),numberNames:"num.orb.<0-9>",numberAnchor:[-113,15],numberAlign:"center"}),
  "orb.energy":entry(95,0,36,36,groupFont("orb"),{stages:33,unusedFont:groupFont("orb_unused"),unusedName:"orb.energy.unused",numberFont:groupFont("orb_num"),numberNames:"num.orb.<0-9>",numberAnchor:[113,15],numberAlign:"center"}),
  "stats.panel":entry(-233,0,98,84,groupFont("stats_bg"),{name:"stats.bg.panel",rows:8,rowHeight:10}),
};
for(let row=0;row<8;row++) {
  const [id]=statRows[row], y=74-row*10;
  glyphContract.layout[`stats.icon.${id}`]=entry(-231,y,8,8,groupFont(`stats_icon_${row}`),{name:`stats.icon.${row}.<icon>`});
  glyphContract.layout[`stats.text.${id}`]=entry(-221,y-1,86,10,`ruc:stats_${id}`,{labelX:-221,valueX:-169,name:`stats.font.${id}`,valueFont:`ruc:stats_${id}`});
  glyphContract.statsFonts[id]=`ruc:stats_${id}`;
}
for(const [name,value] of Object.entries(byName)) glyphContract.glyphs[name]={...glyphContract.glyphs[name],char:charCodeByName[name]??value.char};
for(let n=1;n<=1024;n*=2) for(const sign of [-1,1]) { const key=sign<0?`-${n}`:`+${n}`; const char=priv(nextChar++); glyphContract.spaces[key]=char; glyphContract.spacing[key]={font:"ruc:space",char,advance:sign*n,width:sign*n}; }
const spaceProviders=Object.entries(glyphContract.spacing).map(([key,entry]:any)=>({type:"space",advances:{[entry.char]:entry.width}}));
writeFileSync(join(fontDir,"space.json"),JSON.stringify({providers:spaceProviders},null,2)+"\n","utf8");
writeFileSync(join(rpg,"hud-glyphs.json"),JSON.stringify(glyphContract,null,2)+"\n","utf8");

// Galmuri is already a local workspace dependency (OFL-1.1); no network fetch.
copyFileSync(join(root,"web/node_modules/galmuri/dist/Galmuri11.ttf"),join(fontDir,"Galmuri11.ttf"));
copyFileSync(join(root,"web/node_modules/galmuri/ofl.md"),join(fontDir,"OFL.txt"));

console.log(`HUD art: ${skills.length} skills, ${Object.keys(EFFECTS).length} effects, ${glyphs.length} bitmap glyphs, ${transparent.length} transparent vanilla sprites.`);
console.log(`Generated files: ${relative(root,texDir)}, ${relative(root,fontDir)}, ${relative(root,join(rpg,"hud-glyphs.json"))}`);
