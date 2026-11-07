import type { Mod, StatKey } from "../combat.ts";
import type { ElementId } from "./elements.ts";
import type { SkillGrade } from "../progress.ts";
import { SKILLS } from "./skills.ts";

/**
 * 아이템 (§14 · §15). 템플릿 · 희귀도 · 특수효과 · 세트 데이터와, 인스턴스에서 스탯을 계산하는 순수 함수.
 * 서버 판정과 클라이언트 툴팁이 같은 함수를 씁니다. 확률 롤은 난수 함수를 받아서(서버는 CSPRNG, 테스트는 고정값).
 */

export const RARITIES = ["poor", "common", "rare", "advanced", "mythic", "legendary"] as const;
export type Rarity = (typeof RARITIES)[number];
/**
 * §14-1 · §14-4. stat = 장비 스탯 배율 · up = 드롭 때 다음 희귀도로 올라갈 확률 (DECISIONS D26).
 * 마법부여 슬롯 · 가치 배율은 P5(강화 · 분해)에서.
 */
export const RARITY: Record<Rarity, { name: string; color: string; specials: number; dur: number; stat: number; up: number }> = {
  poor: { name: "하급", color: "#8E8E8E", specials: 0, dur: 1, stat: 0.8, up: 0.45 },
  common: { name: "일반", color: "#FFFFFF", specials: 0, dur: 1.2, stat: 1, up: 0.25 },
  rare: { name: "희귀", color: "#3DDC84", specials: 0, dur: 1.5, stat: 1.25, up: 0.15 },
  advanced: { name: "고급", color: "#3B82F6", specials: 1, dur: 2, stat: 1.55, up: 0.12 },
  mythic: { name: "신화", color: "#A855F7", specials: 1, dur: 2.6, stat: 1.9, up: 0.08 },
  legendary: { name: "전설", color: "#FF9F1C", specials: 2, dur: 3.5, stat: 2.4, up: 0 },
};

/** 장비 칸 (§15-1) */
export const EQUIP_SLOTS = [
  "helmet", "chest", "legs", "boots", "gloves", "cape", "weapon", "offhand",
  "ring1", "ring2", "necklace", "earring", "watch", "doll", "costumeTop", "costumeBottom", "hair",
] as const;
export type EquipSlot = (typeof EQUIP_SLOTS)[number];
export const EQUIP_NAME: Record<EquipSlot, string> = {
  helmet: "투구", chest: "흉갑", legs: "바지", boots: "신발", gloves: "장갑", cape: "망토", weapon: "무기", offhand: "보조무기",
  ring1: "반지", ring2: "반지", necklace: "목걸이", earring: "귀걸이", watch: "시계", doll: "인형", costumeTop: "코스튬 상의", costumeBottom: "코스튬 하의", hair: "헤어",
};

/** 보관 위치와 칸 수: 인벤토리 27 + 핫바 5 (§15-1 · §15-2), 창고 54 (§15-3) */
export const LOCS = { inventory: 27, hotbar: 5, equipped: EQUIP_SLOTS.length, storage: 54 } as const;
export type Loc = keyof typeof LOCS;
/** [위치, 칸]. 칸 −1 = 빈 곳에 알아서 */
export type ItemPos = [Loc, number];
export const STACK = 64;
/** 포션 공유 쿨 (§14-2) */
export const POTION_CD_MS = 8000;

export type Special = { id: string; v: number };
/** 마법부여 · 강화 옵션 한 줄 (§16-1 · §16-2): 종류 · 수치 · (속성 방어면) 속성 */
export type Ench = { k: string; v: number; el?: ElementId };
/** 아이템 인스턴스 (§14-3). 장비는 1개짜리 고유 UUID, 소모품 · 재료는 한 칸에 64개까지 */
export type Item = {
  id: string; tpl: string; loc: Loc; slot: number; qty: number; rarity: Rarity; enh: number; sp: Special[]; dur: number; durMax: number;
  /** 강화 옵션 · 마법부여 · +10 이름 (§16) */
  opt?: Ench[]; ench?: Ench[]; name?: string;
};
/** DB 의 아이템 행 — 우편 · 유저 상점 에스크로에 있는 것도 (플레이어 목록 inv 에는 안 옴) */
export type StoredItem = Omit<Item, "loc"> & { loc: Loc | "mail" | "escrow" };

export type ItemKind = "weapon" | "armor" | "accessory" | "potion" | "material" | "book";
export type Template = {
  name: string;
  kind: ItemKind;
  icon: string;
  /** 착용 레벨 */
  lv: number;
  /** 툴팁 하단 플레이버 텍스트 (§14-6) */
  desc: string;
  slot?: EquipSlot | "ring";
  /** 무기 평타 (SKILLS id) — DECISIONS D20 */
  basic?: string;
  /** 일반 희귀도 기준 스탯 (희귀도 배율 · 강화 배율을 곱함) */
  stats?: Partial<Record<StatKey, number>>;
  set?: string;
  /** 포션 즉시 회복량 */
  heal?: { hp?: number; mp?: number; en?: number };
  /** 희귀도가 정해진 아이템 (소모품 · 재료). 없으면 드롭 때 롤 */
  rarity?: Rarity;
  /** 입었을 때 캐릭터 옷 색 (흉갑 · 바지 = [밝은 면, 기본, 그늘], 신발 = 한 색) */
  look?: [string, string, string] | string;
  /** 스킬북: 이 스킬을 배우거나 등급을 올림 */
  skill?: string;
  /** 부가석: 마법부여 종류 (data/economy.ts ENCHANTS) */
  enchant?: string;
  /** 기본 가치 RUC (희귀도 배율 전) — 상점 가격 · 분해 환불 (§16-3) */
  value?: number;
};

const potion = (name: string, icon: string, heal: Template["heal"], desc: string): Template =>
  ({ name, kind: "potion", icon, lv: 1, heal, rarity: "common", desc, value: Math.round(((heal?.hp ?? 0) + ((heal?.mp ?? 0) + (heal?.en ?? 0)) * 2) / 16) });
const mat = (name: string, icon: string, rarity: Rarity | undefined, desc: string, value: number, enchant?: string): Template =>
  ({ name, kind: "material", icon, lv: 1, rarity, desc, value, enchant });

export const ITEMS: Record<string, Template> = {
  // ── 무기 ──
  old_dagger: { name: "낡은 단검", kind: "weapon", slot: "weapon", basic: "slash", icon: "dagger", lv: 1, stats: { atk: 4, atkSpeed: 15 }, desc: "날은 무뎌졌지만 손에 착 붙는다." },
  wood_sword: { name: "나무 검", kind: "weapon", slot: "weapon", basic: "slash", icon: "sword", lv: 1, stats: { atk: 7 }, desc: "광장 아이들이 칼싸움 놀이에 쓰던 검. 의외로 단단하다." },
  apprentice_staff: { name: "견습 지팡이", kind: "weapon", slot: "weapon", basic: "bolt", icon: "staff", lv: 1, stats: { ap: 7, mana: 10 }, desc: "끝에 박힌 작은 마력석이 따뜻하게 빛난다." },
  hunter_bow: { name: "사냥꾼의 활", kind: "weapon", slot: "weapon", basic: "shot", icon: "bow", lv: 3, stats: { atk: 6, crit: 0.02 }, desc: "초원 토끼를 쫓던 사냥꾼이 쓰던 활." },
  goblin_axe: { name: "고블린 손도끼", kind: "weapon", slot: "weapon", basic: "slash", icon: "axe", lv: 6, stats: { atk: 11, critDmg: 0.1 }, desc: "이 빠진 도끼날에 고블린 이빨 자국이 남아 있다." },
  fang_sword: { name: "송곳니 검", kind: "weapon", slot: "weapon", basic: "slash", icon: "sword", lv: 10, stats: { atk: 15, crit: 0.03 }, desc: "덩굴 늑대의 송곳니를 갈아 만든 검." },
  vine_wand: { name: "덩굴 완드", kind: "weapon", slot: "weapon", basic: "bolt", icon: "wand", lv: 10, stats: { ap: 14, mana: 20 }, desc: "감긴 덩굴이 아직도 조금씩 자란다." },
  // ── 방어구 ──
  leather_cap: { name: "가죽 모자", kind: "armor", slot: "helmet", icon: "helmet", lv: 1, stats: { pdef: 3, hp: 10 }, desc: "햇볕을 가리기에 딱 좋다." },
  leather_vest: { name: "가죽 조끼", kind: "armor", slot: "chest", icon: "chest", lv: 1, stats: { pdef: 5, hp: 20 }, look: ["#c49a6c", "#a0764c", "#7a5636"], desc: "주머니가 많아서 모험가들이 좋아한다." },
  leather_pants: { name: "가죽 바지", kind: "armor", slot: "legs", icon: "legs", lv: 1, stats: { pdef: 4, hp: 15 }, look: ["#8a6a4a", "#6b4f36", "#4f3826"], desc: "무릎에 덧댄 천이 든든하다." },
  leather_boots: { name: "가죽 장화", kind: "armor", slot: "boots", icon: "boots", lv: 1, stats: { pdef: 2, moveSpeed: 3 }, look: "#5a3b2a", desc: "초원 진흙도 문제없다." },
  leather_gloves: { name: "가죽 장갑", kind: "armor", slot: "gloves", icon: "gloves", lv: 1, stats: { pdef: 2, atkSpeed: 5 }, desc: "손바닥이 미끄럽지 않게 홈이 파여 있다." },
  meadow_cape: { name: "초원 망토", kind: "armor", slot: "cape", icon: "cape", lv: 3, stats: { mdef: 4, regen: 2 }, desc: "바람이 불면 풀 냄새가 난다." },
  sprout_helm: { name: "새싹 수호자 투구", kind: "armor", slot: "helmet", icon: "helmet", lv: 8, set: "sprout_guardian", stats: { pdef: 6, mdef: 4, hp: 25 }, desc: "투구 꼭대기에서 새싹이 고개를 내민다." },
  sprout_mail: { name: "새싹 수호자 갑옷", kind: "armor", slot: "chest", icon: "chest", lv: 8, set: "sprout_guardian", stats: { pdef: 9, mdef: 6, hp: 40 }, look: ["#a3e06a", "#6fb840", "#4b902f"], desc: "나무껍질과 잎맥을 엮어 만든 갑옷." },
  sprout_greaves: { name: "새싹 수호자 각반", kind: "armor", slot: "legs", icon: "legs", lv: 8, set: "sprout_guardian", stats: { pdef: 7, mdef: 5, hp: 30 }, look: ["#7fb84a", "#5a8a35", "#3f6a26"], desc: "걸을 때마다 잎이 바스락거린다." },
  sprout_boots: { name: "새싹 수호자 장화", kind: "armor", slot: "boots", icon: "boots", lv: 8, set: "sprout_guardian", stats: { pdef: 4, mdef: 3, moveSpeed: 4 }, look: "#3f6a26", desc: "밟은 자리에 작은 꽃이 핀다는 소문." },
  sprout_gloves: { name: "새싹 수호자 장갑", kind: "armor", slot: "gloves", icon: "gloves", lv: 8, set: "sprout_guardian", stats: { pdef: 4, mdef: 3, atkSpeed: 6 }, desc: "손등에 덩굴무늬가 수놓여 있다." },
  // ── 장신구 ──
  copper_ring: { name: "구리 반지", kind: "accessory", slot: "ring", icon: "ring", lv: 1, stats: { atk: 2, ap: 2 }, desc: "흔하지만 왠지 행운이 따르는 것 같다." },
  rabbit_charm: { name: "토끼발 목걸이", kind: "accessory", slot: "necklace", icon: "necklace", lv: 3, stats: { luck: 2, moveSpeed: 2 }, desc: "토끼정령이 떨어뜨린 솜털 뭉치를 엮었다." },
  fang_earring: { name: "늑대 송곳니 귀걸이", kind: "accessory", slot: "earring", icon: "earring", lv: 10, stats: { crit: 0.03, critDmg: 0.05 }, desc: "귀에 걸면 늑대 울음소리가 들리는 듯하다." },
  // ── 포션 (공유 쿨 8초) ──
  hp_potion_s: potion("체력 포션 (소)", "potion_hp", { hp: 80 }, "딸기 맛이 난다."),
  hp_potion_m: potion("체력 포션 (중)", "potion_hp", { hp: 200 }, "딸기에 꿀을 조금 넣었다."),
  hp_potion_l: potion("체력 포션 (대)", "potion_hp", { hp: 450 }, "한 병이면 하루 종일 뛰어다닐 수 있다."),
  mp_potion_s: potion("마나 포션 (소)", "potion_mp", { mp: 40 }, "박하 향이 머리를 맑게 한다."),
  mp_potion_m: potion("마나 포션 (중)", "potion_mp", { mp: 100 }, "마력석 가루가 반짝인다."),
  mp_potion_l: potion("마나 포션 (대)", "potion_mp", { mp: 220 }, "병 안에서 별이 빙글빙글 돈다."),
  en_potion_s: potion("기력 포션 (소)", "potion_en", { en: 40 }, "귤 맛. 톡 쏜다."),
  en_potion_m: potion("기력 포션 (중)", "potion_en", { en: 100 }, "마시면 주먹이 불끈 쥐어진다."),
  en_potion_l: potion("기력 포션 (대)", "potion_en", { en: 220 }, "대장장이 볼트의 비밀 레시피."),
  // ── 재료 ──
  slime_jelly: mat("슬라임 젤리", "jelly", "poor", "말랑말랑. 강화 재료로 쓰인다는 소문이 있다.", 2),
  rabbit_fluff: mat("토끼 솜털", "fluff", "poor", "손바닥 위에서 바람도 없이 둥실 떠오른다.", 3),
  goblin_coin: mat("고블린 동전", "coin", "common", "어느 나라 돈인지 아무도 모른다.", 4),
  wolf_pelt: mat("늑대 가죽", "pelt", "common", "덩굴 자국이 무늬처럼 남아 있다.", 6),
  enhance_stone: mat("강화석", "stone", "rare", "광장 대장간의 강화대에서 장비를 강화할 때 씁니다.", 15),
  protect_scroll: mat("강화 보호 주문서", "scroll", "advanced", "강화가 파괴로 끝나도 실패(유지)로 바꿔 줍니다. 강화할 때 자동으로 한 장 씁니다.", 10),
  blessed_stone: mat("축복 강화석", "stone", "mythic", "강화 성공률 +10%p (파괴율은 그대로). 강화할 때 고르면 한 개 씁니다.", 2),
  // 부가석 (§16-2): 희귀도가 수치를 정함
  ench_atk: mat("공격력 부가석", "gem", undefined, "마법부여: 공격력", 8, "atk"),
  ench_ap: mat("주문력 부가석", "gem", undefined, "마법부여: 주문력", 8, "ap"),
  ench_def: mat("방어 부가석", "gem", undefined, "마법부여: 물리 · 마법 방어력", 8, "def"),
  ench_hp: mat("체력 부가석", "gem", undefined, "마법부여: 최대 체력", 8, "hp"),
  ench_speed: mat("신속 부가석", "gem", undefined, "마법부여: 이동 속도", 10, "speed"),
  ench_crit: mat("치명 부가석", "gem", undefined, "마법부여: 치명타 확률", 10, "crit"),
  ench_eldef: mat("속성 방어 부가석", "gem", undefined, "마법부여: 속성 하나의 방어력 (속성은 부여할 때 정해짐)", 8, "eldef"),
  ench_vamp: mat("흡혈 부가석", "gem", undefined, "마법부여: 흡혈", 12, "vamp"),
};

// 스킬북 (§10-3 습득 경로 · §10-4 등급): 스킬마다 한 종류, 희귀도가 등급을 정함
for (const sk of Object.values(SKILLS))
  if (!sk.hidden && sk.slot !== "A")
    ITEMS[`book_${sk.id}`] = { name: `스킬북: ${sk.name}`, kind: "book", icon: "book", lv: 1, skill: sk.id, value: 30, desc: "읽으면 스킬을 배우거나 등급이 오릅니다. 희귀할수록 높은 등급." };
export const BOOK_IDS = Object.keys(ITEMS).filter((id) => ITEMS[id].kind === "book");
/** 스킬북 희귀도 → 스킬 등급: 하급 · 일반 = 하급, 희귀 · 고급 = 중급, 신화 = 상급, 전설 = 초월급 */
export const bookGrade = (r: Rarity): SkillGrade => (r === "legendary" ? "trans" : r === "mythic" ? "high" : r === "rare" || r === "advanced" ? "mid" : "low");

export const stackable = (t: Template) => t.kind === "potion" || t.kind === "material" || t.kind === "book";
export const isGear = (t: Template) => !!t.slot;

/**
 * 특수효과 (§14-6): 고급 이상 장비를 얻을 때 종류별 풀에서 롤. range = 고급 기준 수치, 신화 ×1.5 · 전설 ×2.2.
 * mods 가 있으면 스탯, 없으면 서버 items.ts 의 발동 규칙(처치 · 평타 적중 · 피격).
 */
export const SPECIALS: Record<string, { name: string; on: ItemKind[]; range: [number, number]; desc: string; mods?: (v: number) => Mod[] }> = {
  kill_haste: { name: "추격자", on: ["weapon"], range: [0.15, 0.25], desc: "처치하면 2초간 이동 속도 +{v}%" },
  fifth_bolt: { name: "낙뢰", on: ["weapon"], range: [0.6, 1], desc: "5번째 평타마다 번개가 떨어져 공격력의 {v}% 전기 피해" },
  burn_touch: { name: "불씨", on: ["weapon"], range: [0.1, 0.2], desc: "평타가 맞으면 {v}% 확률로 화상" },
  low_shield: { name: "최후의 보루", on: ["armor"], range: [0.1, 0.18], desc: "체력이 30% 아래로 떨어지면 최대 체력 {v}% 보호막 (재사용 60초)" },
  thorns: { name: "가시 돋친", on: ["armor"], range: [0.1, 0.2], desc: "근접 공격을 받으면 받은 피해의 {v}% 반사" },
  sturdy: { name: "튼튼한", on: ["armor"], range: [0.04, 0.08], desc: "최대 체력 +{v}%", mods: (v) => [{ k: "hp", mul: v }] },
  swift: { name: "바람결", on: ["armor", "accessory"], range: [0.03, 0.06], desc: "이동 속도 +{v}%", mods: (v) => [{ k: "moveSpeed", mul: v }] },
  vamp: { name: "흡혈", on: ["weapon", "accessory"], range: [0.02, 0.04], desc: "흡혈 +{v}%", mods: (v) => [{ k: "lifesteal", add: v }] },
  fortune: { name: "행운", on: ["accessory"], range: [2, 4], desc: "운 +{v}", mods: (v) => [{ k: "luck", add: v }] },
};
const SPECIAL_TIER: Partial<Record<Rarity, number>> = { advanced: 1, mythic: 1.5, legendary: 2.2 };

/** 세트 (§14-5): 같은 세트를 n개 이상 입으면 단계별 효과. proc = 서버 발동 규칙 */
export const SETS: Record<string, { name: string; tiers: { n: number; desc: string; mods?: Mod[]; proc?: Special }[] }> = {
  sprout_guardian: {
    name: "새싹 수호자",
    tiers: [
      { n: 2, desc: "재생력 +10", mods: [{ k: "regen", add: 10 }] },
      { n: 3, desc: "풀 속성 방어력 +20", mods: [{ k: "elDef", el: "grass", add: 20 }] },
      { n: 5, desc: "피격 시 10% 확률로 2초 덩굴 보호막 (최대 체력 8%)", proc: { id: "vine_shield", v: 0.08 } },
    ],
  },
};

/** 비율형 특수효과인가 (범위가 1 이하) — 전설 배율로 1 을 넘어도 % 로 다룸 */
export const pctSpecial = (id: string) => (SPECIALS[id]?.range[1] ?? 0) <= 1;
/** {v} 자리에 값 (pct 면 %) */
export const pctText = (desc: string, v: number, pct = v > 0 && v < 1) => desc.replaceAll("{v}", String(pct ? Math.round(v * 1000) / 10 : Math.round(v)));

/** 최대 내구도 (§14-4). 장신구는 내구도 없음 (0) */
export function durMaxOf(t: Template, r: Rarity, enh = 0) {
  const base = t.kind === "weapon" ? 100 : t.kind === "armor" ? 120 : 0;
  return Math.round(base * RARITY[r].dur * (1 + 0.1 * enh));
}

/** 내구도가 남았거나 내구도가 없는 장비만 성능을 냄 */
export const working = (it: Item) => it.durMax === 0 || it.dur > 0;

/** 장비 한 개의 스탯: 템플릿 × 희귀도 배율 × 강화(+6%/단계) + 스탯형 특수효과 */
/**
 * 마법부여 종류 (§16-2): range = 일반 희귀도 부가석의 수치 범위 (희귀도 배율은 data/economy.ts).
 * 강화 옵션(§16-1)도 같은 종류를 쓰고 수치는 절반.
 */
export const ENCHANTS: Record<string, { name: string; range: [number, number]; mods: (v: number, el?: ElementId) => Mod[] }> = {
  atk: { name: "공격력", range: [2, 4], mods: (v) => [{ k: "atk", add: v }] },
  ap: { name: "주문력", range: [2, 4], mods: (v) => [{ k: "ap", add: v }] },
  def: { name: "방어력", range: [2, 4], mods: (v) => [{ k: "pdef", add: v }, { k: "mdef", add: v }] },
  hp: { name: "체력", range: [15, 30], mods: (v) => [{ k: "hp", add: v }] },
  speed: { name: "이동 속도", range: [2, 4], mods: (v) => [{ k: "moveSpeed", add: v }] },
  crit: { name: "치명타 확률", range: [0.01, 0.02], mods: (v) => [{ k: "crit", add: v }] },
  eldef: { name: "속성 방어력", range: [5, 10], mods: (v, el) => (el ? [{ k: "elDef", el, add: v }] : []) },
  vamp: { name: "흡혈", range: [0.01, 0.02], mods: (v) => [{ k: "lifesteal", add: v }] },
};

export function itemMods(it: Item): Mod[] {
  const t = ITEMS[it.tpl];
  if (!t?.slot || !working(it)) return [];
  const mul = RARITY[it.rarity].stat * (1 + 0.06 * it.enh);
  const out: Mod[] = Object.entries(t.stats ?? {}).map(([k, v]) => ({ k: k as StatKey, add: v * mul }));
  for (const e of [...(it.opt ?? []), ...(it.ench ?? [])]) out.push(...(ENCHANTS[e.k]?.mods(e.v, e.el) ?? []));
  for (const s of it.sp) {
    const m = SPECIALS[s.id]?.mods;
    if (m) out.push(...m(s.v));
  }
  return out;
}

/** 입은 장비 전체: 스탯 보정 + 발동형 효과(특수효과 · 세트) */
export function gearOf(items: Item[]): { mods: Mod[]; procs: Special[]; sets: Map<string, number> } {
  const worn = items.filter((i) => i.loc === "equipped" && working(i));
  const mods = worn.flatMap(itemMods);
  const procs = worn.flatMap((i) => i.sp.filter((s) => !SPECIALS[s.id]?.mods));
  const sets = new Map<string, number>();
  for (const i of worn) {
    const s = ITEMS[i.tpl]?.set;
    if (s) sets.set(s, (sets.get(s) ?? 0) + 1);
  }
  for (const [id, n] of sets)
    for (const tier of SETS[id].tiers) {
      if (n < tier.n) continue;
      if (tier.mods) mods.push(...tier.mods);
      if (tier.proc) procs.push(tier.proc);
    }
  return { mods, procs, sets };
}

const WEAPON = EQUIP_SLOTS.indexOf("weapon");
/** 평타: 무기 칸 무기의 평타, 없거나 내구도 0이면 맨손 (D20) */
export function basicOf(items: Item[]): string {
  const w = items.find((i) => i.loc === "equipped" && i.slot === WEAPON);
  return (w && working(w) && ITEMS[w.tpl]?.basic) || "punch";
}

/** 옷 색이 바뀌는 장비(흉갑 · 바지 · 신발) 템플릿 id, 장비 칸 순서 — 다른 사람 화면의 내 캐릭터 색 */
export const lookOf = (items: Item[]) =>
  items.filter((i) => i.loc === "equipped" && ITEMS[i.tpl]?.look).sort((a, b) => a.slot - b.slot).map((i) => i.tpl);

/** 이 장비가 그 장비 칸에 들어가는가 (종류 · 착용 레벨) */
export function fits(t: Template | undefined, slot: number, level: number): string | null {
  const s = EQUIP_SLOTS[slot];
  if (!t?.slot) return "장착할 수 없는 아이템입니다";
  if (t.slot !== s && !(t.slot === "ring" && (s === "ring1" || s === "ring2"))) return "그 칸에는 장착할 수 없습니다";
  if (level < t.lv) return `Lv${t.lv} 부터 장착할 수 있습니다`;
  return null;
}

// ── 롤 (§20-2 · §6-3 운) ─────────────────────────────────────────

/** 희귀도: 하급에서 시작해 단계마다 up(+보너스) 확률로 한 단계씩 올라감. bonus = 운 × 0.05%p + 몹 등급 */
export function rollRarity(rand: () => number, bonus: number): Rarity {
  let i = 0;
  while (i < RARITIES.length - 1 && rand() < RARITY[RARITIES[i]].up + bonus) i++;
  return RARITIES[i];
}

export type DropRoll = { item: string; chance: number; qty?: [number, number] };

/** 드롭 테이블 굴리기. gradeIdx = 몹 등급 순번(일반 0 …) — 확률 ×(1 + 0.5 × 등급), 희귀도 +4%p × 등급. 운: 개수 기대값 +운/200 */
export function rollDrops(table: DropRoll[], gradeIdx: number, luck: number, rand: () => number): { tpl: string; qty: number; rarity: Rarity }[] {
  const out: { tpl: string; qty: number; rarity: Rarity }[] = [];
  const extra = luck / 200;
  for (const d of table) {
    if (rand() >= Math.min(1, d.chance * (1 + 0.5 * gradeIdx))) continue;
    // book_random = 아무 스킬북 하나
    const id = d.item === "book_random" ? BOOK_IDS[Math.floor(rand() * BOOK_IDS.length)] : d.item;
    const t = ITEMS[id];
    const [a, b] = d.qty ?? [1, 1];
    const qty = a + Math.floor(rand() * (b - a + 1)) + Math.floor(extra) + (rand() < extra % 1 ? 1 : 0);
    const r = t.rarity ?? rollRarity(rand, luck * 0.0005 + gradeIdx * 0.04);
    if (stackable(t)) out.push({ tpl: id, qty, rarity: r });
    else for (let i = 0; i < qty; i++) out.push({ tpl: id, qty: 1, rarity: i ? rollRarity(rand, luck * 0.0005 + gradeIdx * 0.04) : r });
  }
  return out;
}

/** 특수효과 롤 — 아이템을 얻을 때 (§14-6) */
export function rollSpecials(t: Template, r: Rarity, rand: () => number): Special[] {
  const tier = SPECIAL_TIER[r];
  if (!tier || !isGear(t)) return [];
  const pool = Object.keys(SPECIALS).filter((id) => SPECIALS[id].on.includes(t.kind));
  const out: Special[] = [];
  while (out.length < RARITY[r].specials && pool.length) {
    const id = pool.splice(Math.floor(rand() * pool.length), 1)[0];
    const [lo, hi] = SPECIALS[id].range;
    const v = (lo + rand() * (hi - lo)) * tier;
    out.push({ id, v: pctSpecial(id) ? Math.round(v * 1000) / 1000 : Math.round(v) });
  }
  return out;
}
