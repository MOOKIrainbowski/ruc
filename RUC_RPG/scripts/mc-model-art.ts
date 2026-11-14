/** Build Minecraft item definitions/models/textures from the web RPG icon art. */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { deflateSync } from "node:zlib";
import { registerHooks } from "node:module";

const root=resolve(dirname(fileURLToPath(import.meta.url)),"../..");
const assets=join(root,"minecraft/resourcepack/assets/ruc");
const resources=join(root,"minecraft/plugins/RucRpg/src/main/resources");
registerHooks({resolve(specifier,context,nextResolve){
  if(specifier.startsWith(".")&&!/\.(?:[cm]?js|json|node|ts)$/.test(specifier)) { try{return nextResolve(`${specifier}.ts`,context);}catch{} }
  return nextResolve(specifier,context);
}});

class CanvasImageData {
  data:Uint8ClampedArray;width:number;height:number;
  constructor(data:Uint8ClampedArray,width:number,height:number){this.data=data;this.width=width;this.height=height;}
}
class CanvasShim {
  width=0;height=0;image?:CanvasImageData;
  getContext(){return {putImageData:(image:CanvasImageData)=>{this.image=image;},getImageData:()=>this.image};}
}
Object.assign(globalThis,{document:{createElement:()=>new CanvasShim()},ImageData:CanvasImageData});

const [{itemIcon},{skillIcon,effectIcon,statIcon},{ITEMS,RARITIES,isGear},{SKILLS},{EFFECTS},{ELEMENTS},{LINES,JOBS}]=await Promise.all([
  import(pathToFileURL(join(root,"web/rpg/client/art/items.ts")).href),
  import(pathToFileURL(join(root,"web/rpg/client/art/icons.ts")).href),
  import(pathToFileURL(join(root,"web/rpg/shared/data/items.ts")).href),
  import(pathToFileURL(join(root,"web/rpg/shared/data/skills.ts")).href),
  import(pathToFileURL(join(root,"web/rpg/shared/data/effects.ts")).href),
  import(pathToFileURL(join(root,"web/rpg/shared/data/elements.ts")).href),
  import(pathToFileURL(join(root,"web/rpg/shared/data/jobs.ts")).href),
]);
type CanvasLike={width:number;height:number;image?:CanvasImageData};
type Pixel=[number,number,number,number];
const rgba=(w:number,h:number)=>new Uint8Array(w*h*4);
function set(p:Uint8Array,w:number,h:number,x:number,y,c:Pixel){if(x>=0&&y>=0&&x<w&&y<h)p.set(c,(y*w+x)*4);}
function rect(p:Uint8Array,w:number,h:number,x:number,y,rw:number,rh:number,c:Pixel){for(let yy=y;yy<y+rh;yy++)for(let xx=x;xx<x+rw;xx++)set(p,w,h,xx,yy,c);}
function pngChunk(type:string,body:Uint8Array){const n=Buffer.from(type,"ascii"),l=Buffer.alloc(4);l.writeUInt32BE(body.length);const data=Buffer.concat([n,Buffer.from(body)]);let crc=0xffffffff;for(const b of data){crc^=b;for(let i=0;i<8;i++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}const c=Buffer.alloc(4);c.writeUInt32BE((crc^0xffffffff)>>>0);return Buffer.concat([l,n,Buffer.from(body),c]);}
function encodePng(w:number,h:number,p:Uint8Array){const scan=Buffer.alloc((w*4+1)*h);for(let y=0;y<h;y++)scan.set(p.subarray(y*w*4,(y+1)*w*4),y*(w*4+1)+1);const ih=Buffer.alloc(13);ih.writeUInt32BE(w,0);ih.writeUInt32BE(h,4);ih[8]=8;ih[9]=6;return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),pngChunk("IHDR",ih),pngChunk("IDAT",deflateSync(scan,{level:9})),pngChunk("IEND",new Uint8Array())]);}
function writePng(path:string,w:number,h:number,p:Uint8Array){mkdirSync(dirname(path),{recursive:true});writeFileSync(path,encodePng(w,h,p));}
function pixels(canvas:CanvasLike){if(!canvas.image)throw new Error("icon renderer returned no ImageData");return new Uint8Array(canvas.image.data.buffer.slice(0));}
const modelIds=new Set<string>();
function emitModel(path:string,texture:string,p:Uint8Array,w:number,h:number){
  if(modelIds.has(path))throw new Error(`duplicate model id ${path}`);modelIds.add(path);
  const modelPath=path.startsWith("item/")?path.slice("item/".length):path;
  const modelRef=`ruc:item/${modelPath}`;
  const itemDef={model:{type:"minecraft:model",model:modelRef}};
  const model={parent:"minecraft:item/generated",textures:{layer0:`ruc:item/${texture}`}};
  mkdirSync(dirname(join(assets,"items",`${path}.json`)),{recursive:true});
  mkdirSync(dirname(join(assets,"models/item",`${modelPath}.json`)),{recursive:true});
  writeFileSync(join(assets,"items",`${path}.json`),JSON.stringify(itemDef,null,2)+"\n","utf8");
  writeFileSync(join(assets,"models/item",`${modelPath}.json`),JSON.stringify(model,null,2)+"\n","utf8");
  writePng(join(assets,"textures/item",`${texture}.png`),w,h,p);
}
function fromCanvas(path:string,texture:string,canvas:CanvasLike){emitModel(path,texture,pixels(canvas),canvas.width,canvas.height);}

const ui= (kind:"wood"|"green"|"tab"|"tab_on"|"close"|"left"|"right"|"blank"|"lock")=>{
  const w=32,h=32,p=rgba(w,h);if(kind==="blank")return p;
  const wood:Pixel=[163,106,60,255],woodDark:Pixel=[77,48,34,255],woodLight:Pixel=[191,132,80,255],green:Pixel=[93,158,31,255],greenDark:Pixel=[61,106,18,255];
  const border:Pixel=[77,48,34,255],gold:Pixel=[218,177,91,255],goldLight:Pixel=[255,225,157,255];
  if(kind==="wood"||kind==="green"){
    const selected=kind==="green", fill=selected?green:wood;
    rect(p,w,h,1,2,30,28,[58,42,30,255]);rect(p,w,h,2,1,28,29,border);rect(p,w,h,3,3,26,25,fill);
    rect(p,w,h,4,4,24,2,selected?[120,192,44,255]:woodLight);rect(p,w,h,4,4,2,22,selected?[120,192,44,255]:[218,164,106,255]);
    rect(p,w,h,4,26,24,2,selected?greenDark:[90,52,28,255]);rect(p,w,h,26,5,2,21,selected?greenDark:[90,52,28,255]);
    rect(p,w,h,7,9,18,1,selected?[151,205,92,255]:[184,126,77,255]);rect(p,w,h,7,22,18,1,selected?greenDark:[105,67,42,255]);
    for(const [x,y] of [[5,5],[25,5],[5,24],[25,24]])set(p,w,h,x,y,selected?goldLight:[215,172,119,255]);
  } else if(kind==="tab"||kind==="tab_on"){
    const on=kind==="tab_on", fill=on?[118,80,42,255]:[91,65,43,255];
    rect(p,w,h,2,8,28,22,border);rect(p,w,h,3,6,26,23,fill);rect(p,w,h,4,7,24,2,on?goldLight:[177,137,83,255]);
    rect(p,w,h,5,10,22,15,on?[143,101,51,255]:[117,82,51,255]);rect(p,w,h,5,24,22,2,on?gold:[73,50,35,255]);
    for(const x of [4,26])set(p,w,h,x,9,on?goldLight:woodLight);
  } else if(kind==="close"){
    rect(p,w,h,2,2,28,28,border);rect(p,w,h,4,4,24,24,[119,45,38,255]);rect(p,w,h,5,5,22,5,[169,70,56,255]);
    rect(p,w,h,10,8,4,4,goldLight);rect(p,w,h,18,8,4,4,goldLight);rect(p,w,h,8,10,4,4,goldLight);rect(p,w,h,20,10,4,4,goldLight);
    rect(p,w,h,11,11,10,10,[238,204,150,255]);rect(p,w,h,13,11,6,10,[119,45,38,255]);rect(p,w,h,11,13,10,6,[119,45,38,255]);
  } else if(kind==="left"||kind==="right"){
    rect(p,w,h,3,5,26,22,border);rect(p,w,h,4,4,24,22,[101,71,43,255]);rect(p,w,h,5,5,22,18,[151,105,55,255]);
    const right=kind==="right";for(let y=0;y<13;y++){const half=Math.min(y,12-y);const x=right?9+half:22-half;rect(p,w,h,x,9+y,3,1,goldLight);}
    rect(p,w,h,right?9:20,14,3,3,gold);rect(p,w,h,6,6,20,1,[232,191,110,255]);
  } else if(kind==="lock"){
    rect(p,w,h,8,4,16,17,border);rect(p,w,h,11,5,10,15,[207,179,113,255]);rect(p,w,h,13,8,6,10,[65,48,38,255]);
    rect(p,w,h,5,16,22,14,border);rect(p,w,h,7,18,18,10,[211,171,85,255]);rect(p,w,h,9,19,14,2,goldLight);rect(p,w,h,14,22,4,4,[92,64,36,255]);rect(p,w,h,15,25,2,2,[92,64,36,255]);
  }
  return p;
};
for(const [id,kind] of [["button_wood","wood"],["button_green","green"],["tab","tab"],["tab_on","tab_on"],["close","close"],["arrow_left","left"],["arrow_right","right"],["blank","blank"],["lock","lock"]] as const)
  emitModel(`ui/${id}`,`ui/${id}`,ui(kind),32,32);

for(const id of Object.keys(SKILLS).sort())fromCanvas(`skill/${id}`,`skill/${id}`,skillIcon(id,"#7755a5"));
for(const id of Object.keys(EFFECTS).sort())fromCanvas(`effect/${id}`,`effect/${id}`,effectIcon(id));
const stats:[string,string,string][]=[["heart","heart","#E5484D"],["foot","foot","#BDF3E1"],["drop","drop","#3BA7FF"],["flame","flame","#FF5A36"],["sword","sword","#E8EEF5"],["star","star","#FFF4B0"],["bolt","bolt","#FFE14D"],["wing","wing","#BDF3E1"],["shield","shield","#9AA3AD"],["ring","ring","#C9A27A"],["sparkle","sparkle","#FFF4B0"],["heartPlus","heartPlus","#4CC764"],["clock","clock","#9AA3AD"],["clover","clover","#2ECC71"]];
for(const [id,icon,color] of stats)fromCanvas(`stat/${id}`,`stat/${id}`,statIcon(icon,color));
const elementGlyph:Record<string,string>={water:"drop",fire:"flame",earth:"crack",grass:"clover",wind:"wing",electric:"bolt",ice:"snow",light:"star",dark:"skull",poison:"thorn",none:"sparkle",iron:"shield"};
for(const [id,e] of Object.entries(ELEMENTS))fromCanvas(`element/${id}`,`element/${id}`,statIcon(elementGlyph[id]??"sparkle",e.color));
for(const [id,line] of Object.entries(LINES))fromCanvas(`line/${id}`,`line/${id}`,skillIcon(line.icon,line.color));
for(const [id,job] of Object.entries(JOBS)){
  const line=LINES[job.line];const color=job.kind==="magic"?"#9B5DE5":job.kind==="hybrid"?"#E0A84C":line.color;
  fromCanvas(`job/${id}`,`job/${id}`,skillIcon(line.icon,color));
}

const vanillaGearIcons=new Set(["sword","axe","helmet","chest","legs","boots"]);
const gearByIcon=new Map<string,string[]>();
for(const [tpl,t] of Object.entries(ITEMS))if(isGear(t)&&!vanillaGearIcons.has(t.icon)){const list=gearByIcon.get(t.icon)??[];list.push(tpl);gearByIcon.set(t.icon,list);}
const canonicalGearTemplates:Record<string,string>={};
for(const icon of [...gearByIcon.keys()].sort()){
  const tpl=[...gearByIcon.get(icon)!].sort()[0];canonicalGearTemplates[icon]=tpl;
  for(const rarity of RARITIES)fromCanvas(`item/${icon}_${rarity}`,`${icon}_${rarity}`,itemIcon(tpl,rarity));
}
let skippedEnchant=0,nonGearCount=0;
for(const [tpl,t] of Object.entries(ITEMS).sort(([a],[b])=>a.localeCompare(b))){
  if(isGear(t)||t.enchant){if(t.enchant)skippedEnchant++;continue;}
  fromCanvas(`item/${tpl}`,tpl,itemIcon(tpl,t.rarity??"common"));nonGearCount++;
}

const listed=join(resources,"pack-models.json");let prior:string[]=[];
try{const parsed=JSON.parse(readFileSync(listed,"utf8"));if(!Array.isArray(parsed)||parsed.some(v=>typeof v!=="string"))throw new Error("pack-models.json must be string[]");prior=parsed;}catch(e:any){if(e.code!=="ENOENT")throw e;}
const all=[...new Set([...prior,...modelIds])].sort();writeFileSync(listed,JSON.stringify(all,null,2)+"\n","utf8");
const manifest={version:1,skillCount:Object.keys(SKILLS).length,effectCount:Object.keys(EFFECTS).length,elementCount:Object.keys(ELEMENTS).length,lineCount:Object.keys(LINES).length,jobCount:Object.keys(JOBS).length,statIcons:stats.map(x=>x[0]),uiModels:9,gearIcons:Object.keys(canonicalGearTemplates).sort(),canonicalGearTemplates,nonGearItems:nonGearCount,enchantsSkipped:skippedEnchant,modelsGenerated:modelIds.size,notes:["Job icon backgrounds use the line color; magic/hybrid variants use their existing kind distinction because Job has no own color field.","Gear icon+rarity keys can represent several templates; the alphabetically first template is the canonical web itemIcon source."]};
writeFileSync(join(resources,"item-models.json"),JSON.stringify(manifest,null,2)+"\n","utf8");
console.log(`Minecraft item art: ${modelIds.size} models; ${Object.keys(SKILLS).length} skills, ${Object.keys(EFFECTS).length} effects, ${nonGearCount} non-gear icons, ${skippedEnchant} enchant books intentionally omitted.`);
