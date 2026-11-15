/** Create textured 3D box rigs for RPG mobs, pets and plaza NPCs. */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { deflateSync } from "node:zlib";
import { registerHooks } from "node:module";

const root=resolve(dirname(fileURLToPath(import.meta.url)),"../..");
const assetRoot=join(root,"minecraft/resourcepack/assets/ruc");
const resourceRoot=join(root,"minecraft/plugins/RucRpg/src/main/resources");
const previewRoot=join(root,".scratch/codex/mc-models");
registerHooks({resolve(specifier,context,nextResolve){
  if(specifier.startsWith(".")&&!/\.(?:[cm]?js|json|node|ts)$/.test(specifier)){try{return nextResolve(`${specifier}.ts`,context);}catch{}}
  return nextResolve(specifier,context);
}});
class ImageDataShim { data:Uint8ClampedArray;width:number;height:number;constructor(data:Uint8ClampedArray,width:number,height:number){this.data=data;this.width=width;this.height=height;} }
class CanvasShim { width=0;height=0;image?:ImageDataShim;getContext(){return {putImageData:(v:ImageDataShim)=>{this.image=v;},getImageData:()=>this.image};} }
Object.assign(globalThis,{document:{createElement:()=>new CanvasShim()},ImageData:ImageDataShim});

const [{MOBS},{PETS},{NPCS},{mobFrames}]=await Promise.all([
  import(pathToFileURL(join(root,"web/rpg/shared/data/mobs.ts")).href),
  import(pathToFileURL(join(root,"web/rpg/shared/data/pets.ts")).href),
  import(pathToFileURL(join(root,"web/rpg/shared/data/quests.ts")).href),
  import(pathToFileURL(join(root,"web/rpg/client/art/mobs.ts")).href),
]);
type V3=[number,number,number];type RGB=[number,number,number];
type Palette={base:string;light:string;shade:string;accent:string;eye:string;dark:string;skin:string;metal:string;glow:string};
type Part={offset:V3;size:V3;tone?:keyof Palette;role?:string};
type Bone={name:string;parent:string|null;pivot:V3;size:V3;tone:keyof Palette;role:string;parts?:Part[];motion?:string};
type Actor={id:string;kind:"mob"|"pet"|"npc";name:string;role:string;source?:string;height:number;scale:number;palette?:Palette;bones:Bone[];style?:string};
type CanvasLike={width:number;height:number;image?:ImageDataShim};
type Face={texture:string;uv:number[]};
type BoxElement={from:number[];to:number[];faces:Record<string,Face>;shade:boolean};
type ModelJson={parent:string;textures:Record<string,string>;elements:BoxElement[]};
type EntityModel={name:string;parent:string|null;pivot:V3;model:string;hurtModel:string;origin:[8,8,8];role:string};
const rgba=(w:number,h:number)=>new Uint8Array(w*h*4);
function set(p:Uint8Array,w:number,h:number,x:number,y:number,c:RGB,a=255){if(x<0||y<0||x>=w||y>=h)return;const i=(y*w+x)*4;p[i]=c[0];p[i+1]=c[1];p[i+2]=c[2];p[i+3]=a;}
function get(p:Uint8Array,w:number,x:number,y:number):RGB{const i=(y*w+x)*4;return [p[i],p[i+1],p[i+2]];}
function hex(h:string):RGB{return [parseInt(h.slice(1,3),16),parseInt(h.slice(3,5),16),parseInt(h.slice(5,7),16)];}
function hx(c:RGB){return `#${c.map(v=>Math.max(0,Math.min(255,Math.round(v))).toString(16).padStart(2,"0")).join("")}`;}
function mix(a:string,b:string,t:number){const x=hex(a),y=hex(b);return hx(x.map((v,i)=>v+(y[i]-v)*t) as RGB);}
function light(c:string,t=.25){return mix(c,"#ffffff",t);}function dark(c:string,t=.28){return mix(c,"#17131d",t);}
function pngChunk(type:string,body:Uint8Array){const n=Buffer.from(type,"ascii"),len=Buffer.alloc(4);len.writeUInt32BE(body.length);const all=Buffer.concat([n,Buffer.from(body)]);let crc=0xffffffff;for(const b of all){crc^=b;for(let i=0;i<8;i++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}const c=Buffer.alloc(4);c.writeUInt32BE((crc^0xffffffff)>>>0);return Buffer.concat([len,n,Buffer.from(body),c]);}
function encodePng(w:number,h:number,p:Uint8Array){const scan=Buffer.alloc((w*4+1)*h);for(let y=0;y<h;y++)scan.set(p.subarray(y*w*4,(y+1)*w*4),y*(w*4+1)+1);const ih=Buffer.alloc(13);ih.writeUInt32BE(w,0);ih.writeUInt32BE(h,4);ih[8]=8;ih[9]=6;return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),pngChunk("IHDR",ih),pngChunk("IDAT",deflateSync(scan,{level:9})),pngChunk("IEND",new Uint8Array())]);}
function writePng(path:string,w:number,h:number,p:Uint8Array){mkdirSync(dirname(path),{recursive:true});writeFileSync(path,encodePng(w,h,p));}
function pixels(c:CanvasLike){if(!c.image)throw new Error("mobFrames returned no ImageData");return new Uint8Array(c.image.data.buffer.slice(0));}
const OUTLINE="#2b1d2e";
const npcPalette:Record<string,Palette>={
  lumi:{base:"#dff7ee",light:"#fff9e9",shade:"#84c9bd",accent:"#5bcb4a",eye:"#55a8bd",dark:OUTLINE,skin:"#f0c3a2",metal:"#d8ad54",glow:"#fff4b0"},
  volt:{base:"#8b5033",light:"#d99a58",shade:"#4b3029",accent:"#e5484d",eye:"#f2c94c",dark:OUTLINE,skin:"#d69c79",metal:"#9aa3ad",glow:"#ff7b3d"},
  mir:{base:"#78489a",light:"#d6a8e8",shade:"#3d2c56",accent:"#3ba7ff",eye:"#c8f0ff",dark:OUTLINE,skin:"#efd2b1",metal:"#c9a27a",glow:"#a8ddff"},
  sera:{base:"#397b78",light:"#a5dbbf",shade:"#21494e",accent:"#f2c94c",eye:"#69c8c3",dark:OUTLINE,skin:"#edc5a2",metal:"#d6b45c",glow:"#bdf3e1"},
  owen:{base:"#34598b",light:"#a4c8ee",shade:"#263453",accent:"#f2c94c",eye:"#7fd3ff",dark:OUTLINE,skin:"#e8c3a5",metal:"#b8c2cc",glow:"#c8f0ff"},
  pip:{base:"#b06b49",light:"#f0c07d",shade:"#68432f",accent:"#e5484d",eye:"#4f8d78",dark:OUTLINE,skin:"#f1c9a5",metal:"#d5af72",glow:"#fff1bd"},
  dario:{base:"#526944",light:"#b5c775",shade:"#303b32",accent:"#bd8d55",eye:"#87c6a1",dark:OUTLINE,skin:"#d9ad86",metal:"#c9a27a",glow:"#e7d183"},
};
function extractPalette(source:string|undefined):Palette|undefined{
  if(!source)return undefined;
  const frame=mobFrames(source)[0][0],p=pixels(frame),counts=new Map<string,number>();
  for(let i=0;i<p.length;i+=4){if(p[i+3]<96)continue;const c=hx([p[i],p[i+1],p[i+2]]);if(c.toLowerCase()===OUTLINE)continue;counts.set(c,(counts.get(c)??0)+1);}
  const colors=[...counts].sort((a,b)=>b[1]-a[1]).map(x=>x[0]);if(colors.length<3)return undefined;
  const lum=(c:string)=>{const [r,g,b]=hex(c);return .2126*r+.7152*g+.0722*b;};
  const base=colors.find(c=>lum(c)>35&&lum(c)<218)??colors[0],lightest=[...colors].sort((a,b)=>lum(b)-lum(a)).find(c=>lum(c)>lum(base)+18)??light(base,.35),darkest=[...colors].sort((a,b)=>lum(a)-lum(b)).find(c=>c!==base&&lum(c)<lum(base)-12)??dark(base,.3);
  const sat=(c:string)=>{const a=hex(c);return Math.max(...a)-Math.min(...a);};
  const accent=[...colors].sort((a,b)=>sat(b)-sat(a)).find(c=>c!==base&&sat(c)>30)??light(base,.2);
  return {base,light:lightest,shade:darkest,accent,eye:accent,dark:OUTLINE,skin:mix(base,"#f3c6a5",.55),metal:mix(base,"#bec9d3",.6),glow:light(accent,.45)};
}
const B=(name:string,parent:string|null,pivot:V3,size:V3,tone:keyof Palette,role=name,parts:Part[]=[],motion?:string):Bone=>({name,parent,pivot,size,tone,role,...(parts.length?{parts}:{}),...(motion?{motion}:{})});
const as=(id:string,kind:Actor["kind"],name:string,role:string,height:number,scale:number,bones:Bone[],source?:string,style?:string,palette?:Palette):Actor=>({id,kind,name,role,height,scale,bones,source,style,palette});
const human=(skin:keyof Palette="skin",coat:keyof Palette="base",arm:keyof Palette="base",extras:Bone[]=[])=>[
  B("body",null,[0,.83,0],[10,9,6],coat,"torso",[{offset:[0,1.6,0],size:[8,3,7],tone:"accent",role:"badge"}]),
  B("head","body",[0,1.48,0],[7,7,7],skin,"head"),
  B("hair","head",[0,1.77,-.015],[8,3,8],coat,"hair"),
  B("arm_l","body",[-.39,.85,0],[3,8,3],arm,"arm","" as any),
  B("arm_r","body",[.39,.85,0],[3,8,3],arm,"arm"),
  B("leg_l","body",[-.17,.29,0],[4,7,4],"shade","leg"),
  B("leg_r","body",[.17,.29,0],[4,7,4],"shade","leg"),
  ...extras,
];
// The concise human helper above is intentionally normalized to pivots around the feet.
function personBones(coat:keyof Palette,accessory:keyof Palette,opts:{hat?:string;tool?:string;cape?:boolean;bag?:boolean;armor?:boolean;magic?:boolean}={}):Bone[]{
  const out:Bone[]=[
    B("body",null,[0,.83,0],[10,9,6],coat,"torso",[
      {offset:[0,1.3,.2],size:[8,3,1],tone:accessory,role:"trim"},
      ...(opts.armor?[{offset:[0,0,.18],size:[11,7,2],tone:"metal" as const,role:"chestplate"}]:[]),
    ]),
    B("head","body",[0,1.48,.015],[7,7,7],"skin","head"),
    B("hair","head",[0,1.69,-.03],[8,4,8],accessory,"hair"),
    B("arm_l","body",[-.39,.85,0],[3,8,3],coat,"arm"),
    B("arm_r","body",[.39,.85,0],[3,8,3],coat,"arm"),
    B("leg_l","body",[-.17,.29,0],[4,7,4],"shade","leg"),
    B("leg_r","body",[.17,.29,0],[4,7,4],"shade","leg"),
  ];
  if(opts.hat)out.push(B("hat","head",[0,1.87,0],[10,3,10],accessory,"hat",[{offset:[0,1.8,0],size:[5,4,5],tone:"light",role:"hat-crown"}]));
  if(opts.cape)out.push(B("cape","body",[0,.94,-.25],[10,12,2],accessory,"cape",[{offset:[0,-5,0],size:[13,2,2],tone:"light",role:"hem"}]),B("cape_clasp","body",[0,1.13,.22],[3,3,1],"metal","badge"));
  if(opts.bag)out.push(B("satchel","body",[.34,.85,-.05],[5,6,4],"shade","bag",[{offset:[0,1,2],size:[3,1,1],tone:"metal",role:"buckle"}]));
  if(opts.tool==="hammer")out.push(B("hammer_handle","arm_r",[.53,.91,.14],[2,11,2],"wood","weapon"),B("hammer_head","hammer_handle",[.53,1.28,.14],[8,4,5],"metal","weapon-head"));
  else if(opts.tool==="staff"||opts.tool==="wand")out.push(B("staff","arm_r",[.52,.68,.08],[2,15,2],"wood","weapon",[{offset:[0,7,0],size:[5,4,5],tone:"glow",role:"gem"}]));
  else if(opts.tool==="book")out.push(B("book","arm_l",[-.49,.89,.22],[6,5,2],"accent","book",[{offset:[0,0,1.4],size:[4,3,1],tone:"metal",role:"rune"}]));
  else if(opts.tool==="sword")out.push(B("sword","arm_r",[.51,.87,.1],[2,12,2],"metal","weapon",[{offset:[0,4,0],size:[6,2,2],tone:"accent",role:"crossguard"}]));
  if(opts.magic)out.push(B("focus_orb", "head",[0,2.11,.12],[4,4,4],"glow","glow",[{offset:[0,0,1.9],size:[2,2,1],tone:"light",role:"rune"}],"hover"));
  return out;
}
const actors:Actor[]=[];
actors.push(as("slime","mob","슬라임","풀 슬라임",.85,.9,[
  B("body",null,[0,.38,0],[15,9,13],"base","slime",[{offset:[0,3,0],size:[12,3,11],tone:"light",role:"cap"},{offset:[0,-3.2,0],size:[12,2,10],tone:"shade",role:"underside"}]),
  B("eye_l","body",[-.25,.48,.4],[2,2,1],"light","eye",[{offset:[0,0,.8],size:[1,1,1],tone:"dark",role:"pupil"}]),B("eye_r","body",[.25,.48,.4],[2,2,1],"light","eye",[{offset:[0,0,.8],size:[1,1,1],tone:"dark",role:"pupil"}]),B("sprout","body",[0,.84,-.02],[2,3,2],"accent","leaf"),
],"slime","slime"));
actors.push(as("rabbit","mob","토끼 정령","푸른 눈과 긴 분홍 귀의 작은 숲 토끼",.92,.65,[
 B("body",null,[0,.37,-.04],[10,7,13],"base","body"),B("head","body",[0,.76,.28],[8,7,7],"light","head"),B("ear_l","head",[-.18,1.14,.3],[3,8,2],"base","ear"),B("ear_r","head",[.18,1.14,.3],[3,7,2],"base","ear"),B("tail","body",[0,.42,-.48],[4,4,4],"light","tail"),B("leg_fl","body",[-.22,.18,.34],[3,4,3],"shade","leg"),B("leg_fr","body",[.22,.18,.34],[3,4,3],"shade","leg"),B("leg_bl","body",[-.22,.18,-.36],[4,4,4],"shade","leg"),B("leg_br","body",[.22,.18,-.36],[4,4,4],"shade","leg"),B("eye","head",[.19,.78,.51],[1.4,1.5,1],"eye","eye",[{offset:[0,0,.55],size:[.6,.7,.4],tone:"light",role:"glint"}]),B("nose","head",[0,.68,.54],[2,1.5,1],"accent","nose"),
],"rabbit","rabbit"));
function goblinRig():Bone[]{return [
 B("body",null,[0,.86,0],[9,10,6],"shade","tunic",[{offset:[0,-2,.2],size:[10,3,1],tone:"accent",role:"belt"}]),B("head","body",[0,1.52,.05],[10,9,8],"base","head"),B("ear_l","head",[-.4,1.61,0],[5,3,3],"base","ear"),B("ear_r","head",[.4,1.61,0],[5,3,3],"base","ear"),B("arm_l","body",[-.43,.92,0],[3,8,3],"base","arm"),B("arm_r","body",[.43,.92,0],[3,8,3],"base","arm"),B("leg_l","body",[-.18,.28,0],[4,7,4],"shade","leg"),B("leg_r","body",[.18,.28,0],[4,7,4],"shade","leg"),B("club","arm_r",[.56,1.02,.05],[4,12,4],"wood","weapon",[{offset:[0,4,0],size:[6,4,5],tone:"shade",role:"knob"}]),
];}
actors.push(as("goblin","mob","고블린","황록색 귀·노란 눈·가죽 허리띠와 곤봉",1.72,1,goblinRig(),"goblin","goblin"));
actors.push(as("wolf","mob","덩굴 늑대","길게 뻗은 늑대 몸과 풀빛 등 무늬",1.04,.88,[
 B("body",null,[0,.48,-.04],[10,7,15],"base","body",[{offset:[0,1.6,0],size:[8,1,12],tone:"accent",role:"vine-stripe"}]),B("neck","body",[0,.67,.34],[7,7,7],"light","neck"),B("head","neck",[0,.82,.53],[8,7,7],"base","head"),B("muzzle","head",[0,.67,.78],[6,4,5],"light","muzzle"),B("ear_l","head",[-.2,1.08,.38],[2,4,2],"shade","ear"),B("ear_r","head",[.2,1.08,.38],[2,4,2],"shade","ear"),B("tail_1","body",[0,.56,-.55],[4,4,6],"base","tail"),B("tail_2","tail_1",[0,.73,-.75],[3,3,5],"accent","tail-tip"),...([[-.24,.24], [.24,.24],[-.24,-.4],[.24,-.4]] as [number,number][]).map(([x,z],i)=>B(`leg_${i}`,"body",[x,.2,z],[3,6,3],"shade","leg")),B("fang_l","muzzle",[-.1,.52,.91],[1.5,3,1.5],"light","fang"),B("fang_r","muzzle",[.1,.52,.91],[1.5,3,1.5],"light","fang"),
],"wolf","wolf"));
actors.push(as("dusk_imp","mob","황혼 임프","고블린형 임프, 뿔·박쥐 날개·휘는 꼬리",1.58,.94,[
 ...goblinRig().filter(b=>!b.name.startsWith("club")),B("horn_l","head",[-.22,1.94,.03],[2,5,2],"accent","horn"),B("horn_r","head",[.22,1.94,.03],[2,5,2],"accent","horn"),B("wing_l","body",[-.62,1.15,-.12],[8,3,8],"accent","wing",[{offset:[-.15,-1.5,0],size:[7,1,6],tone:"shade",role:"wing-rib"}]),B("wing_r","body",[.62,1.15,-.12],[8,3,8],"accent","wing",[{offset:[.15,-1.5,0],size:[7,1,6],tone:"shade",role:"wing-rib"}]),B("tail","body",[0,.46,-.43],[2,2,10],"shade","tail",[{offset:[0,-.5,-5],size:[3,3,3],tone:"accent",role:"tail-spade"}]),B("claw","arm_r",[.53,.65,.18],[2,3,2],"light","claw"),
],"dusk_imp","imp"));
function quadruped(id:string,boar=false):Bone[]{const b:Bone[]=[B("body",null,[0,.53,-.02],boar?[13,9,14]:[10,7,15],boar?"shade":"base","body",[{offset:[0,1.8,0],size:[11,1,12],tone:boar?"accent":"light",role:boar?"stone-plates":"fur-spine"}]),B("head","body",[0,.73,.48],boar?[10,8,8]:[8,7,8],boar?"base":"light","head"),B("muzzle","head",[0,.62,.79],boar?[8,4,5]:[6,4,5],boar?"shade":"base","muzzle"),B("tail","body",[0,.55,-.63],boar?[2,2,5]:[3,3,7],"shade","tail"),...([[-.26,.34],[.26,.34],[-.26,-.4],[.26,-.4]] as [number,number][]).map(([x,z],i)=>B(`leg_${i}`,"body",[x,.21,z],[boar?4:3,7,4],boar?"shade":"base","leg"))];if(boar)b.push(B("tusk_l","muzzle",[-.28,.5,.84],[2,4,2],"light","tusk"),B("tusk_r","muzzle",[.28,.5,.84],[2,4,2],"light","tusk"),B("brow","head",[0,.91,.64],[10,2,3],"accent","brow"));else b.push(B("ear_l","head",[-.2,1.02,.2],[2,4,2],"shade","ear"),B("ear_r","head",[.2,1.02,.2],[2,4,2],"shade","ear"));return b;}
actors.push(as("stone_boar","mob","돌멧돼지","바위판 등갑과 큰 상아 엄니",1.28,.96,quadruped("stone_boar",true),"stone_boar","boar"));
actors.push(as("frost_harpy","mob","서리 하피","얼음깃 날개와 금빛 부리의 공중 사냥꾼",1.62,.96,[
 B("body",null,[0,.82,0],[8,10,7],"base","body"),B("head","body",[0,1.52,.06],[7,7,7],"skin","head"),B("beak","head",[0,1.38,.36],[3,3,4],"metal","beak"),B("wing_l","body",[-.4,1.12,-.05],[9,3,7],"light","wing",[{offset:[-4,-1,0],size:[7,2,4],tone:"accent",role:"feathers"}]),B("wing_r","body",[.4,1.12,-.05],[9,3,7],"light","wing",[{offset:[4,-1,0],size:[7,2,4],tone:"accent",role:"feathers"}]),B("feather_l","wing_l",[-.62,.96,-.1],[4,7,3],"accent","feather"),B("feather_r","wing_r",[.62,.96,-.1],[4,7,3],"accent","feather"),B("leg_l","body",[-.18,.22,.02],[3,6,3],"metal","talon"),B("leg_r","body",[.18,.22,.02],[3,6,3],"metal","talon"),B("crest","head",[0,1.91,-.03],[3,4,3],"accent","crest"),
],"frost_harpy","harpy"));
function golem(id:string,ember=false):Bone[]{const c:Bone[]=[B("body",null,[0,1.12,0],[14,13,10],"base","torso",[{offset:[0,0,3],size:[6,6,2],tone:"glow",role:"core"},{offset:[0,-5,0],size:[15,3,11],tone:"shade",role:"stone-ledge"}]),B("head","body",[0,2.02,.02],[9,8,8],"shade","head"),B("shoulder_l","body",[-.54,1.42,-.02],[7,7,9],"light","shoulder"),B("shoulder_r","body",[.54,1.42,-.02],[7,7,9],"light","shoulder"),B("arm_l","shoulder_l",[-.76,.93,0],[6,8,7],"base","arm"),B("arm_r","shoulder_r",[.76,.93,0],[6,8,7],"base","arm"),B("fist_l","arm_l",[-.88,.68,.03],[8,7,8],"shade","fist"),B("fist_r","arm_r",[.88,.68,.03],[8,7,8],"shade","fist"),B("leg_l","body",[-.26,.38,0],[6,9,7],"shade","leg"),B("leg_r","body",[.26,.38,0],[6,9,7],"shade","leg")];if(ember)c.push(B("horn_l","head",[-.27,2.42,-.02],[3,5,3],"glow","flame"),B("horn_r","head",[.27,2.42,-.02],[3,5,3],"glow","flame"),B("crack_core","body",[0,1.12,.34],[2,8,1],"glow","crack"));else c.push(B("moss_l","shoulder_l",[-.1,1.77,.05],[8,3,9],"accent","moss"),B("moss_r","shoulder_r",[.1,1.77,.05],[8,3,9],"accent","moss"),B("moss_head","head",[0,2.48,-.05],[7,2,7],"accent","moss"));return c;}
actors.push(as("ember_golem","mob","잿불 골렘","검은 현무암 어깨와 갈라진 불꽃 심장",2.55,1.12,golem("ember_golem",true),"ember_golem","ember"));
actors.push(as("shade_knight","mob","그림자 기사","검은 갑옷·보랏빛 망토·긴 룬검",2.18,1.05,[
 ...personBones("metal","shade",{cape:true,armor:true}),B("helm","head",[0,1.82,-.02],[9,5,8],"shade","helmet",[{offset:[0,-1,.5],size:[7,2,1],tone:"glow",role:"visor"}]),B("sword","arm_r",[.6,.82,.1],[2,16,2],"metal","blade",[{offset:[0,5,0],size:[6,2,3],tone:"accent",role:"guard"}]),B("shield","arm_l",[-.72,.76,.15],[8,10,3],"shade","shield",[{offset:[0,0,2],size:[4,4,1],tone:"glow",role:"rune"}]),
],"shade_knight","knight"));
actors.push(as("storm_drake","mob","폭풍 비룡","긴 비늘 목·번개날개·두 토막 꼬리",2.25,1.22,[
 B("body",null,[0,.86,-.1],[12,10,14],"base","body",[{offset:[0,1,0],size:[10,2,12],tone:"accent",role:"scales"}]),B("neck","body",[0,1.07,.4],[8,9,8],"light","neck"),B("head","neck",[0,1.43,.62],[9,7,8],"base","head"),B("jaw","head",[0,1.22,.87],[7,3,5],"shade","jaw"),B("horn_l","head",[-.26,1.75,.55],[2,5,2],"accent","horn"),B("horn_r","head",[.26,1.75,.55],[2,5,2],"accent","horn"),B("wing_l","body",[-.55,1.02,-.1],[11,3,9],"accent","wing",[{offset:[-4,-1,0],size:[6,2,7],tone:"light",role:"membrane"}]),B("wing_r","body",[.55,1.02,-.1],[11,3,9],"accent","wing",[{offset:[4,-1,0],size:[6,2,7],tone:"light",role:"membrane"}]),B("tail_1","body",[0,.72,-.64],[5,6,8],"base","tail"),B("tail_2","tail_1",[0,.6,-.93],[3,4,7],"accent","tail-fin"),B("leg_l","body",[-.34,.3,.18],[4,6,5],"shade","claw"),B("leg_r","body",[.34,.3,.18],[4,6,5],"shade","claw"),B("spine","body",[0,1.26,-.1],[3,4,12],"glow","spines"),
],"storm_drake","drake"));
actors.push(as("sprout_slime","mob","새싹 슬라임","분홍 꽃을 피운 연두빛 투명 슬라임",1.02,.93,[B("body",null,[0,.43,0],[15,10,13],"base","slime",[{offset:[0,3.5,0],size:[12,3,11],tone:"light",role:"cap"},{offset:[0,-3.4,0],size:[13,2,11],tone:"accent",role:"flower-band"}]),B("eye_l","body",[-.25,.49,.43],[2,2,1],"light","eye"),B("eye_r","body",[.25,.49,.43],[2,2,1],"light","eye"),B("stem","body",[0,.94,-.02],[2,4,2],"shade","stem"),B("flower","stem",[0,1.12,.02],[7,3,6],"accent","flower",[{offset:[0,1.5,0],size:[3,2,3],tone:"glow",role:"pollen"}])],"sprout_slime","sprout"));
actors.push(as("shroom_shaman","mob","버섯 주술사","보랏빛 점박이 갓과 마력 지팡이",1.68,.98,[B("stem",null,[0,.75,0],[8,9,7],"skin","stem"),B("cap","stem",[0,1.42,.02],[15,6,14],"base","mushroom-cap",[{offset:[0,-3,0],size:[12,2,12],tone:"shade",role:"gills"}]),B("spots","cap",[0,1.67,.04],[11,2,11],"light","spots",[{offset:[-4,0,0],size:[2,1,2],tone:"glow",role:"spot"},{offset:[4,0,0],size:[2,1,2],tone:"glow",role:"spot"}]),B("head","stem",[0,1.08,.05],[5,5,5],"skin","face"),B("arm_l","stem",[-.48,.86,0],[3,7,3],"skin","arm"),B("arm_r","stem",[.48,.86,0],[3,7,3],"skin","arm"),B("staff","arm_r",[.54,.66,.04],[2,15,2],"wood","staff",[{offset:[0,7.5,0],size:[5,4,5],tone:"glow",role:"crystal"}]),B("root_l","stem",[-.18,.22,0],[3,5,3],"shade","root"),B("root_r","stem",[.18,.22,0],[3,5,3],"shade","root")],"shroom_shaman","shroom"));
actors.push(as("moss_golem","mob","이끼 골렘","회색 돌판과 살아 있는 이끼·초록 눈",2.48,1.12,golem("moss_golem",false),"moss_golem","moss"));
actors.push(as("shadow_vine","mob","그림자 덩굴","세 갈래 가시덩굴과 보랏빛 외눈",2.12,1.08,[B("core",null,[0,1.14,0],[9,9,7],"shade","eye-core",[{offset:[0,0,3.7],size:[5,5,1],tone:"glow",role:"eye"}]),B("tendril_l","core",[-.42,.95,-.02],[3,17,3],"base","tendril",[{offset:[-3,-2,0],size:[5,3,3],tone:"accent",role:"thorn"}]),B("tendril_r","core",[.42,.95,-.02],[3,17,3],"base","tendril",[{offset:[3,-2,0],size:[5,3,3],tone:"accent",role:"thorn"}]),B("tendril_back","core",[0,1.02,-.38],[3,18,3],"shade","tendril"),B("thorn_l","tendril_l",[-.52,1.14,.02],[3,5,3],"accent","thorn"),B("thorn_r","tendril_r",[.52,1.14,.02],[3,5,3],"accent","thorn"),B("root_l","core",[-.2,.24,0],[4,7,4],"shade","root"),B("root_r","core",[.2,.24,0],[4,7,4],"shade","root"),B("eye_glint","core",[0,1.16,.25],[2,2,1],"light","glint")],"shadow_vine","vine"));
actors.push(as("tree_knight","mob","고대 수목 기사","철투구를 쓴 고목 전사, 잎 방패와 긴 검",2.72,1.35,[...personBones("wood","accent",{armor:true}),B("helm","head",[0,1.84,-.02],[10,6,8],"metal","helmet",[{offset:[0,2,0],size:[4,3,4],tone:"accent",role:"sprout"}]),B("branch_l","arm_l",[-.55,.78,-.08],[4,10,4],"wood","branch",[{offset:[-.22,4,0],size:[7,2,3],tone:"accent",role:"leaf"}]),B("branch_r","arm_r",[.55,.78,-.08],[4,10,4],"wood","branch",[{offset:[.22,4,0],size:[7,2,3],tone:"accent",role:"leaf"}]),B("leaf_crown","helm",[0,2.13,-.04],[12,3,10],"accent","crown",[{offset:[-3,2,0],size:[3,5,3],tone:"light",role:"sprout"},{offset:[3,2,0],size:[3,4,3],tone:"light",role:"sprout"}]),B("leaf_shield","arm_l",[-.7,.7,.14],[9,12,3],"accent","shield",[{offset:[0,0,2],size:[5,5,1],tone:"light",role:"leaf-vein"}]),B("greatsword","arm_r",[.62,.73,.12],[3,18,3],"metal","blade",[{offset:[0,6,0],size:[8,2,3],tone:"wood",role:"guard"}])],"tree_knight","tree-knight"));
actors.push(as("twin_witch","mob","쌍둥이 꽃의 마녀","분홍·금빛 두 마녀가 나란히 선 보스",2.24,1.03,[B("body_l",null,[-.28,.74,0],[7,9,6],"base","robe"),B("head_l","body_l",[-.28,1.42,.02],[6,6,6],"skin","head"),B("hat_l","head_l",[-.28,1.83,-.02],[9,3,9],"accent","flower-hat",[{offset:[0,2,0],size:[5,3,5],tone:"light",role:"petal"}]),B("arm_l","body_l",[-.62,.84,0],[3,7,3],"base","arm"),B("wand_l","arm_l",[-.72,.7,.08],[2,12,2],"metal","wand",[{offset:[0,6,0],size:[4,4,4],tone:"glow",role:"gem"}]),B("body_r",null,[.28,.74,0],[7,9,6],"shade","robe"),B("head_r","body_r",[.28,1.42,.02],[6,6,6],"skin","head"),B("hat_r","head_r",[.28,1.83,-.02],[9,3,9],"metal","flower-hat",[{offset:[0,2,0],size:[5,3,5],tone:"glow",role:"petal"}]),B("arm_r","body_r",[.62,.84,0],[3,7,3],"shade","arm"),B("wand_r","arm_r",[.72,.7,.08],[2,12,2],"metal","wand",[{offset:[0,6,0],size:[4,4,4],tone:"accent",role:"gem"}]),B("spark_l","wand_l",[-.72,1.1,.08],[3,3,3],"glow","magic"),B("spark_r","wand_r",[.72,1.1,.08],[3,3,3],"glow","magic")],"twin_witch","twin-witch"));
actors.push(as("purify_orb","mob","정화의 구슬","황금 테두리·떠 있는 룬 파편의 빛 구슬",1.58,1.04,[B("core",null,[0,1.02,0],[10,10,10],"glow","orb",[{offset:[0,0,5.2],size:[6,6,1],tone:"light",role:"rune-eye"}]),B("ring_x","core",[0,1.02,0],[15,2,3],"metal","orbit-ring",[],"spin-x"),B("ring_z","core",[0,1.02,0],[3,15,2],"accent","orbit-ring",[],"spin-z"),B("shard_l","core",[-.58,1.14,.02],[3,5,3],"light","shard"),B("shard_r","core",[.58,.87,-.02],[3,5,3],"accent","shard"),B("shard_top","core",[0,1.72,0],[3,4,3],"metal","shard"),B("shard_bottom","core",[0,.33,0],[3,4,3],"metal","shard")],"purify_orb","orb"));
actors.push(as("fern","mob","성난 숲정령 페른","거대한 잎몸·붉은 눈·바람 소용돌이 왕관",3.12,1.85,[B("body",null,[0,1.32,0],[12,13,9],"base","leaf-torso",[{offset:[0,4,0],size:[10,4,8],tone:"light",role:"leaf-layer"},{offset:[0,-5,0],size:[15,3,11],tone:"accent",role:"root-skirt"}]),B("head","body",[0,2.28,.02],[14,12,11],"light","head",[{offset:[0,-2,5],size:[8,2,1],tone:"shade",role:"mouth"}]),B("crown","head",[0,2.7,0],[15,4,9],"accent","crown",[{offset:[-4,3,0],size:[4,7,4],tone:"light",role:"leaf-spike"},{offset:[4,3,0],size:[4,7,4],tone:"light",role:"leaf-spike"}]),B("eye_l","head",[-.22,2.35,.4],[2,2,1],"glow","eye"),B("eye_r","head",[.22,2.35,.4],[2,2,1],"glow","eye"),B("branch_l","body",[-.61,1.72,0],[5,10,5],"base","branch",[{offset:[-.25,4,0],size:[7,2,5],tone:"light",role:"leaf"}]),B("branch_r","body",[.61,1.72,0],[5,10,5],"base","branch",[{offset:[.25,4,0],size:[7,2,5],tone:"light",role:"leaf"}]),...[-1,1].flatMap((s)=>[0,1,2].map(i=>B(`frond_${s<0?"l":"r"}${i}`,s<0?"branch_l":"branch_r",[s*(.75+i*.14),1.55+i*.15,-.03+i*.03],[6-i,3,4],"accent","frond",[{offset:[s*2,1,0],size:[3,2,3],tone:"light",role:"leaf-tip"}]))),B("root_l","body",[-.3,.28,-.06],[6,8,6],"shade","root"),B("root_r","body",[.3,.28,-.06],[6,8,6],"shade","root")],"fern","fern"));
actors.push(as("eldra","mob","고목왕 엘드라","금빛 가지 왕관을 쓴 거대한 고목왕",4.35,2.4,[B("trunk",null,[0,2.02,-.04],[13,17,11],"base","trunk",[{offset:[0,2,5.5],size:[3,6,1],tone:"glow",role:"eyes"},{offset:[0,-4,5.5],size:[5,1,1],tone:"shade",role:"mouth"},{offset:[0,-4,-4],size:[15,4,13],tone:"shade",role:"roots"}]),B("face","trunk",[0,2.45,.05],[10,7,4],"shade","face"),B("eye_l","face",[-.18,2.48,.22],[2,2,1],"glow","eye"),B("eye_r","face",[.18,2.48,.22],[2,2,1],"glow","eye"),B("crown","trunk",[0,3.34,-.05],[16,8,15],"accent","canopy",[{offset:[-4,4,0],size:[7,4,8],tone:"light",role:"leaf-cluster"},{offset:[4,3,0],size:[7,5,8],tone:"base",role:"leaf-cluster"}]),B("branch_l","trunk",[-.72,2.68,-.05],[6,4,5],"wood","branch",[{offset:[-.32,3,0],size:[5,3,5],tone:"accent",role:"leaf"}]),B("branch_r","trunk",[.72,2.68,-.05],[6,4,5],"wood","branch",[{offset:[.32,3,0],size:[5,3,5],tone:"accent",role:"leaf"}]),B("hand_l","branch_l",[-1.02,2.43,.04],[4,7,4],"wood","root-hand"),B("hand_r","branch_r",[1.02,2.43,.04],[4,7,4],"wood","root-hand"),B("root_l","trunk",[-.32,.35,0],[6,9,8],"shade","root"),B("root_r","trunk",[.32,.35,0],[6,9,8],"shade","root"),B("gold_branch_l","crown",[-.36,3.86,0],[2,7,2],"metal","golden-bough"),B("gold_branch_c","crown",[0,4.0,0],[2,9,2],"glow","golden-bough"),B("gold_branch_r","crown",[.36,3.86,0],[2,7,2],"metal","golden-bough")],"eldra","eldra"));

// Eight summonable companions/installations, each with a distinct rig and finish.
actors.push(as("pet_spirit","pet","계약 정령","하늘빛 부유 정령과 세 갈래 꼬리",.92,.62,[B("core",null,[0,.72,0],[8,8,7],"glow","spirit",[{offset:[0,0,4],size:[4,4,1],tone:"light",role:"face"}]),B("tail_1","core",[0,.47,-.2],[3,5,4],"accent","spirit-tail"),B("tail_2","tail_1",[0,.27,-.42],[2,4,3],"light","spirit-tail"),B("fin_l","core",[-.42,.63,-.03],[4,3,5],"light","fin"),B("fin_r","core",[.42,.63,-.03],[4,3,5],"light","fin"),B("spark","core",[0,1.02,0],[3,3,3],"glow","glow")],"pet_spirit","spirit"));
actors.push(as("pet_golem","pet","바위 골렘","작은 현무암 수호 골렘과 흙 룬",1.42,.78,golem("pet_golem",false).slice(0,10).map(b=>({...b,pivot:[b.pivot[0]*.72,b.pivot[1]*.6,b.pivot[2]*.72] as V3})),"moss_golem","pet-golem"));
actors.push(as("pet_wolf","pet","사냥개","작고 날렵한 덩굴 사냥개",.96,.72,quadruped("pet_wolf",false),"pet_wolf","pet-wolf"));
actors.push(as("turret","pet","포탑","철제 삼각 받침과 회전 포신",1.22,.8,[B("base",null,[0,.2,0],[13,4,12],"shade","tripod",[{offset:[0,-1,-.1],size:[7,4,7],tone:"metal",role:"feet"}]),B("pedestal","base",[0,.46,0],[5,6,5],"metal","pivot"),B("body","pedestal",[0,.76,0],[12,8,9],"base","turret-body",[{offset:[0,0,4.8],size:[4,4,1],tone:"glow",role:"sight"}]),B("barrel","body",[0,.79,.46],[4,4,9],"metal","barrel"),B("muzzle","barrel",[0,.79,.78],[6,6,3],"shade","muzzle",[{offset:[0,0,1.8],size:[3,3,1],tone:"glow",role:"shot"}]),B("antenna","body",[0,1.17,-.05],[2,4,2],"accent","antenna")],"turret","turret"));
actors.push(as("mend_station","pet","수리 장치","은회색 자동 수리 상자와 초록 십자",1.14,.78,[B("base",null,[0,.32,0],[13,5,11],"shade","base"),B("body","base",[0,.82,0],[11,10,9],"light","station",[{offset:[0,0,4.9],size:[7,7,1],tone:"base",role:"front-panel"}]),B("cross_v","body",[0,.82,.34],[2,6,1],"accent","heal-cross"),B("cross_h","body",[0,.82,.35],[6,2,1],"accent","heal-cross"),B("antenna","body",[0,1.3,-.04],[2,5,2],"base","antenna",[{offset:[0,3,0],size:[3,2,3],tone:"glow",role:"signal"}]),B("side_l","body",[-.38,.78,0],[2,5,6],"metal","vent"),B("side_r","body",[.38,.78,0],[2,5,6],"metal","vent")],"mend_station","station"));
function totemRig(color:"accent"|"glow"):Bone[]{return [B("post",null,[0,.73,0],[7,14,7],"wood","carved-post",[{offset:[0,0,4],size:[5,5,1],tone:color,role:"rune-face"}]),B("mask","post",[0,1.04,.02],[10,7,4],"wood","mask",[{offset:[-.18,.1,2.2],size:[2,2,1],tone:"glow",role:"eye"},{offset:[.18,.1,2.2],size:[2,2,1],tone:"glow",role:"eye"}]),B("crossbar","post",[0,1.34,0],[14,3,4],"shade","carved-crossbar"),B("base","post",[0,.13,0],[12,3,12],"shade","base"),B("spirit","post",[0,1.66,0],[4,4,4],color,"spirit",[],"hover")];}
actors.push(as("totem_heal","pet","치유 토템","나무 얼굴·초록 치유 룬·떠 있는 정령",1.42,.82,totemRig("accent"),"totem","heal-totem"));
actors.push(as("totem_storm","pet","폭풍 토템","번개색 룬과 전기 불꽃 정령",1.42,.82,totemRig("glow"),"totem","storm-totem",{base:"#835f35",light:"#d1a45e",shade:"#473428",accent:"#7fd3ff",eye:"#ffe14d",dark:OUTLINE,skin:"#c99a5d",metal:"#b8c2cc",glow:"#bdf3ff"}));
actors.push(as("decoy","pet","잔상","주인의 형상을 본뜬 반투명 잔영",1.78,.92,[B("body",null,[0,.83,0],[10,10,6],"glow","spectral-robe",[{offset:[0,-4,0],size:[14,4,8],tone:"accent",role:"echo-hem"}]),B("head","body",[0,1.53,.01],[7,7,7],"light","mask",[{offset:[0,0,3.6],size:[5,3,1],tone:"base",role:"void-eyes"}]),B("arm_l","body",[-.43,.9,0],[3,8,3],"accent","wispy-arm"),B("arm_r","body",[.43,.9,0],[3,8,3],"accent","wispy-arm"),B("trail_l","body",[-.2,.22,-.1],[3,6,4],"glow","afterimage"),B("trail_r","body",[.2,.22,-.1],[3,6,4],"glow","afterimage")],"pet_spirit","decoy"));

const npcDefinitions:any=NPCS;
actors.push(as("lumi","npc",npcDefinitions.lumi.name,npcDefinitions.lumi.role,1.74,1,personBones("base","accent",{cape:true,magic:true}),undefined,"lumi"));
actors.push(as("volt","npc",npcDefinitions.volt.name,npcDefinitions.volt.role,1.82,1,personBones("shade","metal",{tool:"hammer",bag:true,armor:true}),undefined,"volt"));
actors.push(as("mir","npc",npcDefinitions.mir.name,npcDefinitions.mir.role,1.72,.98,personBones("base","accent",{hat:"alchemist hood",tool:"wand",magic:true}),undefined,"mir"));
actors.push(as("sera","npc",npcDefinitions.sera.name,npcDefinitions.sera.role,1.8,1,personBones("base","metal",{cape:true,armor:true,tool:"sword"}),undefined,"sera"));
actors.push(as("owen","npc",npcDefinitions.owen.name,npcDefinitions.owen.role,1.76,1,personBones("shade","accent",{cape:true,tool:"book",magic:true}),undefined,"owen"));
actors.push(as("pip","npc",npcDefinitions.pip.name,npcDefinitions.pip.role,1.58,.94,personBones("base","accent",{hat:"courier cap",bag:true}),undefined,"pip"));
actors.push(as("dario","npc",npcDefinitions.dario.name,npcDefinitions.dario.role,1.86,1.02,personBones("shade","accent",{cape:true,hat:"explorer hat",tool:"staff",bag:true}),undefined,"dario"));

if(Object.keys(MOBS).length!==19||Object.keys(PETS).length!==8||Object.keys(NPCS).length!==7)throw new Error("RPG source entity counts changed; update the model manifest.");
const known=new Set(actors.map(a=>a.id));
for(const id of [...Object.keys(MOBS),...Object.keys(PETS),...Object.keys(NPCS)])if(!known.has(id))throw new Error(`missing model rig: ${id}`);
const ids=new Set<string>();for(const a of actors){if(ids.has(a.id))throw new Error(`duplicate actor ${a.id}`);ids.add(a.id);}

function actorPalette(a:Actor):Palette{return a.palette??(a.kind==="npc"?npcPalette[a.id]:undefined)??extractPalette(a.source)??{base:"#7caa55",light:"#b5d985",shade:"#405c39",accent:"#f2c94c",eye:"#fff4b0",dark:OUTLINE,skin:"#d7aa83",metal:"#aab7c2",glow:"#dff7ee"};}
function fillTile(p:Uint8Array,ox:number,oy:number,base:string,lightC:string,shadeC:string,accent:string,role:string,id:string){
  for(let y=0;y<16;y++)for(let x=0;x<16;x++){
    const edge=x===0||y===0||x===15||y===15;let c=base;
    if(y<3)c=light(base,.23);else if(y>12)c=dark(base,.24);if(x<2)c=light(c,.11);if(x>12)c=shadeC;if(edge)c=dark(base,.48);
    if((role.includes("wing")||role.includes("feather"))&&((x+y)%5===0))c=lightC;
    if((role.includes("armor")||role.includes("shield"))&&(x===3||x===12||y===3))c=accent;
    if((role.includes("leaf")||role.includes("frond")||role.includes("crown"))&&(x===5||x===6||x===7)&&y>2&&y<14)c=lightC;
    if((role.includes("vine")||role.includes("tendril")||role.includes("tail"))&&(x+y*3)%11===0)c=accent;
    if((role.includes("stone")||role.includes("golem")||role.includes("rock"))&&(x*7+y*3)%17===0)c=lightC;
    if((role.includes("robe")||role.includes("cape")||role.includes("tunic"))&&y>9&&((x+y)%6===0))c=shadeC;
    const hash=(id.charCodeAt((x*7+y*11)%id.length)+x*13+y*17)%29;
    if(hash===0&&x>2&&x<13&&y>2&&y<13)c=lightC;
    set(p,32,32,ox+x,oy+y,hex(c));
  }
}
function textureFor(a:Actor,b:Bone,pal:Palette):Uint8Array{
  const p=rgba(32,32),base=pal[b.tone]??pal.base,hi=pal.light,lo=pal.shade;
  fillTile(p,0,0,base,hi,lo,pal.accent,b.role,a.id+b.name);
  fillTile(p,16,0,dark(base,.16),light(base,.18),dark(lo,.1),pal.accent,b.role+"-side",a.id);
  fillTile(p,0,16,dark(base,.08),light(base,.12),dark(lo,.1),pal.accent,b.role+"-back",a.id);
  fillTile(p,16,16,light(base,.12),light(hi,.08),base,pal.accent,b.role+"-top",a.id);
  const dot=(x:number,y:number,c:string)=>set(p,32,32,x,y,hex(c));
  if(["head","face","eye-core","mask","muzzle","orb","spirit"].some(k=>b.role.includes(k))){
    // Front-facing eyes and a tiny glint make every humanoid/creature read from the player view.
    dot(4,4,pal.dark);dot(11,4,pal.dark);dot(4,5,pal.eye);dot(11,5,pal.eye);
    if(b.role.includes("muzzle")){for(let x=6;x<=9;x++)dot(x,10,pal.light);dot(7,11,pal.dark);dot(9,11,pal.dark);}
    else {dot(5,4,pal.light);dot(12,4,pal.light);dot(7,9,dark(base,.42));dot(8,9,dark(base,.42));}
  }
  if(b.role.includes("weapon")||b.role.includes("blade")||b.role.includes("staff")||b.role.includes("wand")){for(let y=2;y<14;y++)dot(8,y,y<7?pal.light:pal.metal);for(let x=4;x<13;x++)dot(x,8,pal.accent);}
  if(b.role.includes("core")||b.role.includes("orb")||b.role.includes("glow")||b.role.includes("gem")){for(let y=5;y<11;y++)for(let x=5;x<11;x++)if(Math.abs(x-8)+Math.abs(y-8)<5)dot(x,y,(x+y)%2?pal.glow:pal.light);}
  if(b.role.includes("book")){for(let y=3;y<13;y++){dot(7,y,pal.light);dot(8,y,pal.shade);}for(let x=3;x<13;x+=3)dot(x,6,pal.metal);}
  if(b.role.includes("badge")||b.role.includes("cross")||b.role.includes("rune")){for(let n=4;n<12;n++){dot(8,n,pal.glow);dot(n,8,pal.glow);}}
  if(b.role.includes("crown")||b.role.includes("hat")){for(let x=3;x<13;x+=3){dot(x,3,pal.glow);dot(x,4,pal.accent);}}
  return p;
}
function hurtTexture(p:Uint8Array){const out=new Uint8Array(p);for(let i=0;i<out.length;i+=4){if(!out[i+3])continue;out[i]=Math.min(255,Math.round(out[i]*.55+255*.45));out[i+1]=Math.round(out[i+1]*.28);out[i+2]=Math.round(out[i+2]*.28);}return out;}
function centeredElement(size:V3,offset:V3,tone:string):BoxElement{
  const from=size.map((v,i)=>8+offset[i]-v/2),to=size.map((v,i)=>8+offset[i]+v/2);
  const faces:Record<string,Face>={north:{texture:"#layer0",uv:[0,8,8,16]},south:{texture:"#layer0",uv:[0,0,8,8]},east:{texture:"#layer0",uv:[8,0,16,8]},west:{texture:"#layer0",uv:[8,0,16,8]},up:{texture:"#layer0",uv:[8,8,16,16]},down:{texture:"#layer0",uv:[0,8,8,16]}};
  return {from,to,faces,shade:true};
}
function modelFor(b:Bone,texture:string):ModelJson{
  const elements=[centeredElement(b.size,[0,0,0],texture),...(b.parts??[]).map(p=>centeredElement(p.size,p.offset,texture))];
  return {parent:"minecraft:item/generated",textures:{layer0:texture},elements};
}
const modelIds=new Set<string>();
function writeBone(a:Actor,b:Bone,pal:Palette):EntityModel{
  const id=`mob/${a.id}/${b.name}`,hurt=`${id}_hurt`;for(const m of [id,hurt]){if(modelIds.has(m))throw new Error(`duplicate model id ${m}`);modelIds.add(m);}
  const tex=`entity/mob/${a.id}/${b.name}`,baseP=textureFor(a,b,pal),variants:[[string,Uint8Array],[string,Uint8Array]]=[[id,baseP],[hurt,hurtTexture(baseP)]];
  for(const [modelId,pix] of variants){
    const itemPath=`items/${modelId}.json`,modelPath=`models/item/${modelId}.json`,modelRef=`ruc:item/${modelId}`;
    mkdirSync(dirname(join(assetRoot,itemPath)),{recursive:true});mkdirSync(dirname(join(assetRoot,modelPath)),{recursive:true});
    writeFileSync(join(assetRoot,itemPath),JSON.stringify({model:{type:"minecraft:model",model:modelRef}},null,2)+"\n","utf8");
    writeFileSync(join(assetRoot,modelPath),JSON.stringify(modelFor(b,`ruc:${tex}${modelId===hurt?"_hurt":""}`),null,2)+"\n","utf8");
    writePng(join(assetRoot,"textures",`${tex}${modelId===hurt?"_hurt":""}.png`),32,32,pix);
  }
  return {name:b.name,parent:b.parent,pivot:b.pivot,model:id,hurtModel:hurt,origin:[8,8,8],role:b.role};
}
const v=(x:number,y:number,z:number):V3=>[x,y,z];
type KF={t:number;rot?:V3;pos?:V3;scale?:V3};
function kf(t:number,rot?:V3,pos?:V3,scale?:V3):KF{return {t,...(rot?{rot}:{}),...(pos?{pos}:{}),...(scale?{scale}:{})};}
function animations(a:Actor):Record<string,unknown>{
  const keys=(which:string):Record<string,KF[]>=>{
    const out:Record<string,KF[]>={};const put=(name:string,frames:KF[])=>{out[name]=frames;};
    for(const b of a.bones){const n=b.name,r=b.role;
      if(which==="idle"){
        if(n==="body"||n==="core"||n==="trunk"||n==="stem"||n==="post"||n==="spirit"||n==="orb"||n==="eye-core")put(n,[kf(0,[0,-2,0],[0,0,0]),kf(700,[0,2,0],[0,.025,0]),kf(1400,[0,-2,0],[0,0,0])]);
        if(r.includes("wing")||r.includes("feather"))put(n,[kf(0,[0,0,-18]),kf(350,[0,0,18]),kf(700,[0,0,-18])]);
        if(r.includes("tail")||r.includes("tendril")||r.includes("frond")||r.includes("branch")||r.includes("crown")||r.includes("leaf"))put(n,[kf(0,[0,-4,0]),kf(700,[0,5,0]),kf(1400,[0,-4,0])]);
        if(r.includes("orbit-ring"))put(n,[kf(0,[0,0,0]),kf(1400,[0,360,0])]);
      } else if(which==="walk"){
        if(r.includes("leg")||r.includes("root"))put(n,[kf(0,[28,0,0]),kf(250,[-28,0,0]),kf(500,[28,0,0])]);
        if(r.includes("arm")||r.includes("branch")||r.includes("wing"))put(n,[kf(0,[-16,0,0]),kf(250,[16,0,0]),kf(500,[-16,0,0])]);
        if(n==="body"||n==="core"||n==="trunk")put(n,[kf(0,[0,0,0],[0,0,0]),kf(250,[0,0,0],[0,.05,0]),kf(500,[0,0,0],[0,0,0])]);
      } else if(which==="attack"){
        if(r.includes("weapon")||r.includes("blade")||r.includes("staff")||r.includes("wand")||r.includes("fist")||r.includes("claw")||r.includes("tendril")||r.includes("hand"))put(n,[kf(0,[0,0,-38]),kf(180,[0,0,45]),kf(420,[0,0,4])]);
        if(n==="body"||n==="trunk"||n==="core")put(n,[kf(0,[0,0,0]),kf(160,[-14,0,0]),kf(420,[5,0,0])]);
        if(r.includes("wing"))put(n,[kf(0,[0,0,-25]),kf(200,[0,0,35]),kf(480,[0,0,0])]);
      } else if(which==="cast"){
        if(r.includes("arm")||r.includes("wing")||r.includes("branch")||r.includes("staff")||r.includes("wand"))put(n,[kf(0,[0,0,0]),kf(260,[0,0,-32]),kf(520,[0,0,-24])]);
        if(r.includes("glow")||r.includes("orb")||r.includes("gem")||r.includes("magic")||r.includes("core"))put(n,[kf(0,undefined,undefined,[.75,.75,.75]),kf(260,undefined,undefined,[1.35,1.35,1.35]),kf(800,undefined,undefined,[.9,.9,.9])]);
        if(n==="body"||n==="trunk")put(n,[kf(0,[0,0,0]),kf(260,[-8,0,0]),kf(800,[0,0,0])]);
      } else if(which==="hurt"){
        if(n==="body"||n==="core"||n==="trunk"||n==="stem"||n==="post")put(n,[kf(0,[0,0,0]),kf(80,[0,0,18],[.12,0,0]),kf(220,[0,0,-8],[-.04,0,0]),kf(420,[0,0,0])]);
      } else if(which==="death"){
        put(n,[kf(0,[0,0,0],[0,0,0],[1,1,1]),kf(700,[0,0,65],[0,-.18,0],[1,.68,1]),kf(1100,[0,0,90],[0,-.35,0],[.01,.01,.01])]);
      }
    }
    if(!Object.keys(out).length){const b=a.bones[0],mid=which==="hurt"?210:250,end=which==="hurt"?420:500;out[b.name]=[kf(0),kf(mid,[0,0,20]),kf(end)];}
    return out;
  };
  const make=(kind:string,ms:number,loop:boolean)=>({ms,loop,keys:keys(kind)});
  const base:Record<string,unknown>={idle:make("idle",1400,true),walk:make("walk",500,true),attack:make("attack",520,false),cast:make("cast",800,false),hurt:make("hurt",420,false),death:make("death",1100,false)};
  // Set-piece motion distinguishes signature bosses and the two aerial species.
  if(a.id==="purify_orb")base.idle={ms:2200,loop:true,keys:{ring_x:[kf(0,[0,0,0]),kf(2200,[360,90,0])],ring_z:[kf(0,[0,0,0]),kf(2200,[0,0,360])],core:[kf(0,undefined,undefined,[1,1,1]),kf(1100,undefined,undefined,[1.16,1.16,1.16]),kf(2200,undefined,undefined,[1,1,1])]}};
  if(a.id==="twin_witch")base.cast={ms:980,loop:false,keys:{wand_l:[kf(0,[0,0,8]),kf(260,[0,0,-42]),kf(700,[0,0,-32])],wand_r:[kf(0,[0,0,-8]),kf(260,[0,0,42]),kf(700,[0,0,32])],spark_l:[kf(0,undefined,undefined,[.4,.4,.4]),kf(450,undefined,undefined,[1.7,1.7,1.7]),kf(980,undefined,undefined,[.6,.6,.6])],spark_r:[kf(0,undefined,undefined,[.4,.4,.4]),kf(450,undefined,undefined,[1.7,1.7,1.7]),kf(980,undefined,undefined,[.6,.6,.6])]}};
  if(a.id==="fern")base.attack={ms:1050,loop:false,keys:{branch_l:[kf(0,[0,0,-45]),kf(360,[0,0,62]),kf(760,[0,0,16])],branch_r:[kf(0,[0,0,45]),kf(360,[0,0,-62]),kf(760,[0,0,-16])],frond_l0:[kf(0,[0,0,-25]),kf(420,[0,0,42]),kf(1050)],frond_r0:[kf(0,[0,0,25]),kf(420,[0,0,-42]),kf(1050)],body:[kf(0),kf(360,[-18,0,0]),kf(1050)]}};
  if(a.id==="eldra")base.cast={ms:1500,loop:false,keys:{branch_l:[kf(0,[0,0,-18]),kf(500,[0,0,-58]),kf(1500,[0,0,-12])],branch_r:[kf(0,[0,0,18]),kf(500,[0,0,58]),kf(1500,[0,0,12])],gold_branch_c:[kf(0,[0,0,0],undefined,[.7,.7,.7]),kf(600,[0,0,0],undefined,[1.8,1.8,1.8]),kf(1500)],trunk:[kf(0),kf(600,[-14,0,0],[0,.14,0]),kf(1500)]}};
  if(a.id==="storm_drake"||a.id==="frost_harpy")base.walk={ms:640,loop:true,keys:{wing_l:[kf(0,[0,0,-42]),kf(320,[0,0,40]),kf(640,[0,0,-42])],wing_r:[kf(0,[0,0,42]),kf(320,[0,0,-40]),kf(640,[0,0,42])],body:[kf(0,undefined,[0,0,0]),kf(320,undefined,[0,.06,0]),kf(640)]}};
  if(a.id==="slime"||a.id==="sprout_slime")base.walk={ms:620,loop:true,keys:{body:[kf(0,undefined,undefined,[1,1,1]),kf(180,undefined,[0,.08,0],[1.08,.8,1.08]),kf(420,undefined,[0,.03,0],[.92,1.22,.92]),kf(620)]}};
  return base;
}

function polyFill(p:Uint8Array,w:number,h:number,pts:[number,number][],c:RGB){
  const minX=Math.max(0,Math.floor(Math.min(...pts.map(x=>x[0])))),maxX=Math.min(w-1,Math.ceil(Math.max(...pts.map(x=>x[0]))));
  const minY=Math.max(0,Math.floor(Math.min(...pts.map(x=>x[1])))),maxY=Math.min(h-1,Math.ceil(Math.max(...pts.map(x=>x[1]))));
  for(let y=minY;y<=maxY;y++)for(let x=minX;x<=maxX;x++){let inside=false;for(let i=0,j=pts.length-1;i<pts.length;j=i++){const [xi,yi]=pts[i],[xj,yj]=pts[j];if((yi>y)!==(yj>y)&&x<(xj-xi)*(y-yi)/(yj-yi)+xi)inside=!inside;}if(inside)set(p,w,h,x,y,c);}
}
function renderCompare(a:Actor,pal:Palette,sourceCanvas?:CanvasLike){
  const w=360,h=164,p=rgba(w,h),centerY=142,ppb=Math.min(80/a.height,44);
  const bg=[245,239,222] as RGB;for(let y=0;y<h;y++)for(let x=0;x<w;x++)set(p,w,h,x,y,bg);
  for(let x=0;x<w;x++)for(let y=145;y<148;y++)set(p,w,h,x,y,[190,170,133]);
  // Reference sprite at left, nearest-neighbour enlarged for shape comparison.
  if(sourceCanvas?.image){const s=sourceCanvas.image,side=Math.min(s.width,s.height),size=104,ox=8,oy=29;for(let y=0;y<size;y++)for(let x=0;x<size;x++){const sx=Math.floor(x*side/size),sy=Math.floor(y*side/size),si=(sy*s.width+sx)*4;if(s.data[si+3]>24)set(p,w,h,ox+x,oy+y,[s.data[si],s.data[si+1],s.data[si+2]]);}}
  const paintBox=(b:Bone,view:"front"|"side",xCenter:number)=>{
    const all=[{offset:[0,0,0] as V3,size:b.size,tone:b.tone},...(b.parts??[])];
    for(const part of all){const [sx,sy,sz]=part.size,off=part.offset;const cx=b.pivot[0]+off[0]*a.scale/16,cy=b.pivot[1]+off[1]*a.scale/16,cz=b.pivot[2]+off[2]*a.scale/16,dx=sx*a.scale/16/2,dy=sy*a.scale/16/2,dz=sz*a.scale/16/2;
      const corners:{x:number;y:number;z:number}[]=[];for(const x of [cx-dx,cx+dx])for(const y of [cy-dy,cy+dy])for(const z of [cz-dz,cz+dz])corners.push({x,y,z});
      const project=(q:{x:number;y:number;z:number}):[number,number]=>view==="front"?[xCenter+(q.x+q.z*.22)*ppb,centerY-q.y*ppb+q.z*.13*ppb]:[xCenter+(q.z+q.x*.2)*ppb,centerY-q.y*ppb+q.x*.12*ppb];
      const tone=part.tone?pal[part.tone]:undefined,front=view==="front"?[1,3,7,5]:[4,5,7,6],side=view==="front"?[2,3,7,6]:[1,3,7,5],top=[3,7,6,2];
      for(const [face,color] of [[side,pal.shade],[top,pal.light],[front,tone??pal.base]] as [number[],string][]){const pts=face.map(i=>project(corners[i]));polyFill(p,w,h,pts,hex(color));}
      const pts=front.map(i=>project(corners[i]));for(let i=0;i<pts.length;i++){const [x0,y0]=pts[i],[x1,y1]=pts[(i+1)%pts.length],steps=Math.max(Math.abs(x1-x0),Math.abs(y1-y0));for(let q=0;q<=steps;q++)set(p,w,h,Math.round(x0+(x1-x0)*q/Math.max(1,steps)),Math.round(y0+(y1-y0)*q/Math.max(1,steps)),hex(mix(pal.dark,pal.base,.18)));}
    }
  };
  // Front and side box passes share each actor's declared pivots, dimensions and palette.
  const views:["front"|"side",number][]=[["front",176],["side",284]];
  for(const [view,x] of views){const ordered=[...a.bones].sort((u,v)=>view==="front"?u.pivot[2]-v.pivot[2]:u.pivot[0]-v.pivot[0]);for(const bone of ordered)paintBox(bone,view,x);}
  // Simple panel separators and bottom labels encoded as geometric marks, avoiding external fonts.
  for(const x of [120,232])for(let y=20;y<148;y++)set(p,w,h,x,y,[196,180,150]);
  return p;
}
const packFile=join(resourceRoot,"pack-models.json");let prior:string[]=[];try{const j=JSON.parse(readFileSync(packFile,"utf8"));if(Array.isArray(j))prior=j.filter((v:any)=>typeof v==="string");}catch{}
const manifest:Record<string,unknown>={version:1};let boneCount=0;
for(const actor of actors){
  const pal=actorPalette(actor);const bones:EntityModel[]=actor.bones.map(b=>writeBone(actor,b,pal));boneCount+=bones.length;
  manifest[actor.id]={kind:actor.kind,name:actor.name,role:actor.role,source:actor.source??null,scale:actor.scale,height:actor.height,bones,anims:animations(actor)};
  if(["wolf","frost_harpy","tree_knight","fern","eldra","dario"].includes(actor.id)){
    const source=actor.source?mobFrames(actor.source)[0][0]:undefined;writePng(join(previewRoot,`${actor.id}_front-side.png`),360,164,renderCompare(actor,pal,source));
  }
}
const models=[...new Set([...prior,...modelIds])].sort();writeFileSync(packFile,JSON.stringify(models,null,2)+"\n","utf8");
writeFileSync(join(resourceRoot,"models.json"),JSON.stringify(manifest,null,2)+"\n","utf8");
const report={actors:actors.length,mobs:Object.keys(MOBS).length,pets:Object.keys(PETS).length,npcs:Object.keys(NPCS).length,bones:boneCount,baseAndHurtModels:modelIds.size,uniquePackModels:models.length,previewDir:join(".scratch","codex","mc-models"),previewIds:["wolf","frost_harpy","tree_knight","fern","eldra","dario"],textureSize:[32,32],textureDensity:"32 pixels per 16-model-unit block; four 16x16 face tiles",notes:"Web mobFrames supplies palette extraction and the left-hand comparison images; NPC palette/wardrobe designs are role-specific from quests.NPCS.",};
writeFileSync(join(resourceRoot,"model-build.json"),JSON.stringify(report,null,2)+"\n","utf8");
console.log(`RPG models: ${actors.length} actors, ${boneCount} bones, ${modelIds.size} base/hurt item models, ${models.length} pack ids.`);
