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
export const LOCS = { inventory: 27, hotbar: 5, equipped: EQUIP_SLOTS.length, storage: 108 } as const;
/** 창고 (P12): 기본 54칸 + 창고 확장권 한 장에 27칸, 두 장까지 (LOCS.storage = 최대) */
export const STORAGE = { base: 54, tab: 27, maxTabs: 2 };
/** 이 사람이 쓸 수 있는 칸 수 */
export const capOf = (loc: Loc, tabs = 0) => (loc === "storage" ? STORAGE.base + STORAGE.tab * Math.min(Math.max(0, tabs), STORAGE.maxTabs) : LOCS[loc]);
export type Loc = keyof typeof LOCS;
/** [위치, 칸]. 칸 −1 = 빈 곳에 알아서 */
export type ItemPos = [Loc, number];
export const STACK = 64;
export const STACKABLE_KINDS = ["potion", "material", "book"] as const;
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
export type StoredItem = Omit<Item, "loc"> & { loc: Loc | "mail" | "escrow" | "gbank" };

export type ItemKind = "weapon" | "armor" | "accessory" | "potion" | "material" | "book" | "consumable";
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
  /** 입었을 때 캐릭터 외형 (§8-3 · P11): 흉갑 · 바지 · 투구 · 망토 · 무기 = [밝은 면, 기본, 그늘], 신발 · 장갑 = 한 색 */
  look?: [string, string, string] | string;
  /** 투구 모양 (cap = 모자 · 그 밖 = 투구) · 지팡이/완드 보석 색 */
  shape?: "cap" | "helm";
  gem?: string;
  /** 소모품 (P12): fx = 효과(영약 30분 · 부활 깃털), recall = 3초 뒤 광장, box = 랜덤 상자, tab = 창고 확장 */
  use?: { fx?: { id: string; ms: number; v?: number }; recall?: true; box?: true; tab?: true; food?: number };
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
  old_dagger: { name: "낡은 단검", kind: "weapon", slot: "weapon", basic: "slash", icon: "dagger", lv: 1, stats: { atk: 4, atkSpeed: 15 }, look: ["#d9dde2", "#a7aeb6", "#6f7780"], desc: "날은 무뎌졌지만 손에 착 붙는다." },
  wood_sword: { name: "나무 검", kind: "weapon", slot: "weapon", basic: "slash", icon: "sword", lv: 1, stats: { atk: 7 }, look: ["#e8c48f", "#c49a6c", "#8a6440"], desc: "광장 아이들이 칼싸움 놀이에 쓰던 검. 의외로 단단하다." },
  apprentice_staff: { name: "견습 지팡이", kind: "weapon", slot: "weapon", basic: "bolt", icon: "staff", lv: 1, stats: { ap: 7, mana: 10 }, look: ["#c98d58", "#a36a3c", "#7d4f2b"], gem: "#7fd3ff", desc: "끝에 박힌 작은 마력석이 따뜻하게 빛난다." },
  hunter_bow: { name: "사냥꾼의 활", kind: "weapon", slot: "weapon", basic: "shot", icon: "bow", lv: 3, stats: { atk: 6, crit: 0.02 }, look: ["#d9a066", "#a36a3c", "#7d4f2b"], desc: "초원 토끼를 쫓던 사냥꾼이 쓰던 활." },
  goblin_axe: { name: "고블린 손도끼", kind: "weapon", slot: "weapon", basic: "slash", icon: "axe", lv: 6, stats: { atk: 11, critDmg: 0.1 }, look: ["#c9c2b2", "#8f877a", "#5e574d"], desc: "이 빠진 도끼날에 고블린 이빨 자국이 남아 있다." },
  fang_sword: { name: "송곳니 검", kind: "weapon", slot: "weapon", basic: "slash", icon: "sword", lv: 10, stats: { atk: 15, crit: 0.03 }, look: ["#fffaf0", "#e2d6b8", "#b3a586"], desc: "덩굴 늑대의 송곳니를 갈아 만든 검." },
  vine_wand: { name: "덩굴 완드", kind: "weapon", slot: "weapon", basic: "bolt", icon: "wand", lv: 10, stats: { ap: 14, mana: 20 }, look: ["#a3e06a", "#6fb840", "#4b902f"], gem: "#ffe14d", desc: "감긴 덩굴이 아직도 조금씩 자란다." },
  // ── 방어구 ──
  leather_cap: { name: "가죽 모자", kind: "armor", slot: "helmet", icon: "helmet", lv: 1, stats: { pdef: 3, hp: 10 }, look: ["#d9b07a", "#a0764c", "#7a5636"], shape: "cap", desc: "햇볕을 가리기에 딱 좋다." },
  leather_vest: { name: "가죽 조끼", kind: "armor", slot: "chest", icon: "chest", lv: 1, stats: { pdef: 5, hp: 20 }, look: ["#c49a6c", "#a0764c", "#7a5636"], desc: "주머니가 많아서 모험가들이 좋아한다." },
  leather_pants: { name: "가죽 바지", kind: "armor", slot: "legs", icon: "legs", lv: 1, stats: { pdef: 4, hp: 15 }, look: ["#8a6a4a", "#6b4f36", "#4f3826"], desc: "무릎에 덧댄 천이 든든하다." },
  leather_boots: { name: "가죽 장화", kind: "armor", slot: "boots", icon: "boots", lv: 1, stats: { pdef: 2, moveSpeed: 3 }, look: "#5a3b2a", desc: "초원 진흙도 문제없다." },
  leather_gloves: { name: "가죽 장갑", kind: "armor", slot: "gloves", icon: "gloves", lv: 1, stats: { pdef: 2, atkSpeed: 5 }, look: "#8a6440", desc: "손바닥이 미끄럽지 않게 홈이 파여 있다." },
  meadow_cape: { name: "초원 망토", kind: "armor", slot: "cape", icon: "cape", lv: 3, stats: { mdef: 4, regen: 2 }, look: ["#b5f07a", "#5fa845", "#3f7a2f"], desc: "바람이 불면 풀 냄새가 난다." },
  sprout_helm: { name: "새싹 수호자 투구", kind: "armor", slot: "helmet", icon: "helmet", lv: 8, set: "sprout_guardian", look: ["#b5f07a", "#6fb840", "#3f7a2f"], stats: { pdef: 6, mdef: 4, hp: 25 }, desc: "투구 꼭대기에서 새싹이 고개를 내민다." },
  sprout_mail: { name: "새싹 수호자 갑옷", kind: "armor", slot: "chest", icon: "chest", lv: 8, set: "sprout_guardian", stats: { pdef: 9, mdef: 6, hp: 40 }, look: ["#a3e06a", "#6fb840", "#4b902f"], desc: "나무껍질과 잎맥을 엮어 만든 갑옷." },
  sprout_greaves: { name: "새싹 수호자 각반", kind: "armor", slot: "legs", icon: "legs", lv: 8, set: "sprout_guardian", stats: { pdef: 7, mdef: 5, hp: 30 }, look: ["#7fb84a", "#5a8a35", "#3f6a26"], desc: "걸을 때마다 잎이 바스락거린다." },
  sprout_boots: { name: "새싹 수호자 장화", kind: "armor", slot: "boots", icon: "boots", lv: 8, set: "sprout_guardian", stats: { pdef: 4, mdef: 3, moveSpeed: 4 }, look: "#3f6a26", desc: "밟은 자리에 작은 꽃이 핀다는 소문." },
  sprout_gloves: { name: "새싹 수호자 장갑", kind: "armor", slot: "gloves", icon: "gloves", lv: 8, set: "sprout_guardian", look: "#4b902f", stats: { pdef: 4, mdef: 3, atkSpeed: 6 }, desc: "손등에 덩굴무늬가 수놓여 있다." },
  // ── 장신구 ──
  copper_ring: { name: "구리 반지", kind: "accessory", slot: "ring", icon: "ring", lv: 1, stats: { atk: 2, ap: 2 }, desc: "흔하지만 왠지 행운이 따르는 것 같다." },
  rabbit_charm: { name: "토끼발 목걸이", kind: "accessory", slot: "necklace", icon: "necklace", lv: 3, stats: { luck: 2, moveSpeed: 2 }, desc: "토끼정령이 떨어뜨린 솜털 뭉치를 엮었다." },
  fang_earring: { name: "늑대 송곳니 귀걸이", kind: "accessory", slot: "earring", icon: "earring", lv: 10, stats: { crit: 0.03, critDmg: 0.05 }, desc: "귀에 걸면 늑대 울음소리가 들리는 듯하다." },
  // ── 던전 "고목의 유적" 장비 (§20-3) ──
  ancient_blade: { name: "고목 수호검", kind: "weapon", slot: "weapon", basic: "slash", icon: "sword", lv: 15, stats: { atk: 22, crit: 0.03, hp: 30 }, look: ["#eefadf", "#b9d69a", "#7da35e"], desc: "엘드라의 뿌리가 감싸던 검. 칼날에서 숲 냄새가 난다." },
  ancient_staff: { name: "고목 지팡이", kind: "weapon", slot: "weapon", basic: "bolt", icon: "staff", lv: 15, stats: { ap: 22, mana: 40, cdr: 0.03 }, look: ["#d4c09a", "#8a7350", "#5e4c33"], gem: "#b5f07a", desc: "천 년 묵은 가지에 정령의 숨결이 남아 있다." },
  ancient_bow: { name: "고목 장궁", kind: "weapon", slot: "weapon", basic: "shot", icon: "bow", lv: 15, stats: { atk: 19, crit: 0.05 }, look: ["#d4c09a", "#8a7350", "#5e4c33"], desc: "시위를 당기면 잎사귀가 바람에 떤다." },
  ancient_mail: { name: "고대 수피 갑옷", kind: "armor", slot: "chest", icon: "chest", lv: 15, stats: { pdef: 16, mdef: 10, hp: 70 }, look: ["#b9a27a", "#8a7350", "#5e4c33"], desc: "고대 수목 기사의 껍질을 덧대 만든 갑옷." },
  twin_ring: { name: "쌍생화 반지", kind: "accessory", slot: "ring", icon: "ring", lv: 15, stats: { atk: 5, ap: 5, crit: 0.02 }, desc: "두 송이 꽃이 서로를 감싸 안은 반지." },
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
  // ── 소모품 (P12, §14 [추가]) — 일반 상점에서 늘 팖 ──
  elixir_power: { name: "용맹의 영약", kind: "consumable", icon: "elixir_power", lv: 1, rarity: "rare", use: { fx: { id: "elixir_power", ms: 1_800_000, v: 0.1 } }, value: 120, desc: "30분 동안 공격력 · 주문력 +10%. 쓰러져도 남습니다." },
  elixir_luck: { name: "행운의 영약", kind: "consumable", icon: "elixir_luck", lv: 1, rarity: "rare", use: { fx: { id: "elixir_luck", ms: 1_800_000, v: 0.1 } }, value: 120, desc: "30분 동안 경험치 +10% · 운 +10. 쓰러져도 남습니다." },
  elixir_iron: { name: "강철의 영약", kind: "consumable", icon: "elixir_iron", lv: 1, rarity: "rare", use: { fx: { id: "elixir_iron", ms: 1_800_000, v: 12 } }, value: 120, desc: "30분 동안 물리 · 마법 방어력 +12. 쓰러져도 남습니다." },
  revive_feather: { name: "부활 깃털", kind: "consumable", icon: "feather", lv: 1, rarity: "advanced", use: { fx: { id: "feather", ms: 600_000 } }, value: 150, desc: "10분 안에 쓰러지면 그 자리에서 HP 30%로 일어납니다 (한 번)." },
  return_scroll: { name: "귀환 주문서", kind: "consumable", icon: "scroll", lv: 1, rarity: "common", use: { recall: true }, value: 20, desc: "3초 뒤 햇살광장으로 돌아갑니다. 움직이거나 공격받으면 취소 (던전 안에서는 못 씀)." },
  random_box: { name: "랜덤 상자", kind: "consumable", icon: "box", lv: 1, rarity: "rare", use: { box: true }, value: 200, desc: "열면 장비 · 강화 재료 · 부가석 · 포션 중 하나. 운이 높을수록 좋은 희귀도." },
  storage_ticket: { name: "창고 확장권", kind: "consumable", icon: "ticket", lv: 1, rarity: "mythic", use: { tab: true }, value: 1000, desc: "창고를 27칸 늘립니다 (두 번까지, 54 → 108칸)." },
  meadow_bread: { name: "초원 보리빵", kind: "consumable", icon: "food_bread", lv: 1, rarity: "common", use: { food: 12 }, value: 12, desc: "담백한 보리빵. 스태미나를 12 회복합니다." },
  sun_apple: { name: "햇살 사과", kind: "consumable", icon: "food_apple", lv: 1, rarity: "common", use: { food: 20 }, value: 18, desc: "새콤달콤한 사과. 스태미나를 20 회복합니다." },
  roast_skewer: { name: "숯불 고기꼬치", kind: "consumable", icon: "food_skewer", lv: 1, rarity: "common", use: { food: 30 }, value: 28, desc: "겉은 바삭하고 속은 촉촉하다. 스태미나를 30 회복합니다." },
  river_trout: { name: "강물 송어구이", kind: "consumable", icon: "food_fish", lv: 1, rarity: "common", use: { food: 40 }, value: 38, desc: "허브 향을 입힌 송어. 스태미나를 40 회복합니다." },
  root_soup: { name: "뿌리채소 수프", kind: "consumable", icon: "food_soup", lv: 1, rarity: "common", use: { food: 50 }, value: 48, desc: "속을 따뜻하게 채운다. 스태미나를 50 회복합니다." },
  berry_pie: { name: "산딸기 파이", kind: "consumable", icon: "food_pie", lv: 1, rarity: "common", use: { food: 60 }, value: 58, desc: "달콤한 산딸기를 듬뿍 넣었다. 스태미나를 60 회복합니다." },
  honey_tteok: { name: "꿀바른 찰떡", kind: "consumable", icon: "food_tteok", lv: 1, rarity: "common", use: { food: 70 }, value: 68, desc: "쫀득한 떡에 야생꿀을 발랐다. 스태미나를 70 회복합니다." },
  feast_bento: { name: "모험가 도시락", kind: "consumable", icon: "food_bento", lv: 1, rarity: "common", use: { food: 85 }, value: 82, desc: "든든하게 채운 야외 식사. 스태미나를 85 회복합니다." },
  // ── 채집물 (P13, 초원) — 연금술사 미르에게서 포션 · 강화석으로 ──
  herb: mat("약초", "herb", "common", "초원 풀숲에서 캔 약초. 세 뿌리면 체력 포션이 된다.", 3),
  blue_herb: mat("푸른 약초", "blue_herb", "common", "이슬을 머금은 푸른 잎. 마나 포션의 재료.", 4),
  ore: mat("광석", "ore", "common", "바위 틈의 반짝이는 광석. 다섯 개를 녹이면 강화석 하나.", 5),
  // ── 재료 ──
  slime_jelly: mat("슬라임 젤리", "jelly", "poor", "말랑말랑. 강화 재료로 쓰인다는 소문이 있다.", 2),
  rabbit_fluff: mat("토끼 솜털", "fluff", "poor", "손바닥 위에서 바람도 없이 둥실 떠오른다.", 3),
  goblin_coin: mat("고블린 동전", "coin", "common", "어느 나라 돈인지 아무도 모른다.", 4),
  wolf_pelt: mat("늑대 가죽", "pelt", "common", "덩굴 자국이 무늬처럼 남아 있다.", 6),
  enhance_stone: mat("강화석", "stone", "rare", "광장 대장간의 강화대에서 장비를 강화할 때 씁니다.", 15),
  protect_scroll: mat("강화 보호 주문서", "scroll", "advanced", "강화가 파괴로 끝나도 실패(유지)로 바꿔 줍니다. 강화할 때 자동으로 한 장 씁니다.", 10),
  blessed_stone: mat("축복 강화석", "stone", "mythic", "강화 성공률 +10%p (파괴율은 그대로). 강화할 때 고르면 한 개 씁니다.", 2),
  // 던전 재료 (§20-3)
  spore_dust: mat("포자 가루", "spore", "common", "버섯 주술사의 모자에서 털어 낸 가루. 재채기가 난다.", 6),
  moss_heart: mat("이끼 낀 돌심장", "moss", "rare", "아직도 아주 천천히 뛰고 있다.", 20),
  dark_sap: mat("어둠 수액", "sap", "rare", "그림자 덩굴에서 배어 나온 끈적한 수액.", 18),
  ancient_bark: mat("고대 수피 갑옷 조각", "bark", "advanced", "고대 수목 기사의 갑옷에서 떨어진 조각.", 30),
  spirit_leaf: mat("정령의 잎사귀", "leaf", "rare", "균형을 되찾은 정령이 남긴 잎사귀. 은은하게 빛난다.", 40),
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

export const stackable = (t: Template) => (STACKABLE_KINDS as readonly string[]).includes(t.kind) || (t.kind === "consumable" && !!t.use?.food);
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
export const SPECIAL_TIER: Partial<Record<Rarity, number>> = { advanced: 1, mythic: 1.5, legendary: 2.2 };

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

/** 랜덤 상자 (P12): 가중치 — 장비는 운으로 희귀도를 굴림 */
export const BOX_POOL: { tpl: string; w: number; qty?: number }[] = [
  ...["old_dagger", "wood_sword", "apprentice_staff", "hunter_bow", "goblin_axe", "fang_sword", "vine_wand", "leather_cap", "leather_vest", "leather_pants", "leather_boots", "leather_gloves", "meadow_cape", "copper_ring", "rabbit_charm"].map((tpl) => ({ tpl, w: 3 })),
  { tpl: "enhance_stone", w: 10, qty: 3 }, { tpl: "protect_scroll", w: 4 }, { tpl: "blessed_stone", w: 2 },
  ...["ench_atk", "ench_ap", "ench_def", "ench_hp", "ench_speed", "ench_crit"].map((tpl) => ({ tpl, w: 2 })),
  { tpl: "hp_potion_m", w: 6, qty: 5 }, { tpl: "mp_potion_m", w: 4, qty: 5 }, { tpl: "en_potion_m", w: 4, qty: 5 }, { tpl: "revive_feather", w: 2 },
  { tpl: "meadow_bread", w: 8, qty: 4 }, { tpl: "sun_apple", w: 7, qty: 4 }, { tpl: "roast_skewer", w: 5, qty: 3 },
  { tpl: "river_trout", w: 4, qty: 3 }, { tpl: "root_soup", w: 3, qty: 2 }, { tpl: "berry_pie", w: 3, qty: 2 },
  { tpl: "honey_tteok", w: 2, qty: 2 }, { tpl: "feast_bento", w: 1, qty: 1 },
];
export function rollBox(rand: () => number, luck: number): { tpl: string; qty: number; rarity: Rarity } {
  const total = BOX_POOL.reduce((a, x) => a + x.w, 0);
  let r = rand() * total;
  const pick = BOX_POOL.find((x) => (r -= x.w) < 0) ?? BOX_POOL[0];
  const t = ITEMS[pick.tpl];
  return { tpl: pick.tpl, qty: pick.qty ?? 1, rarity: t.rarity ?? rollRarity(rand, 0.1 + luck / 400) };
}

/** 채집 지점 (P13, D94): 필드 구역마다 서버가 놓음 → F 로 캐면 재료, respawnMs 뒤 다시 생김 */
export const GATHER: Record<string, { item: string; respawnMs: number; w: number }> = {
  herb: { item: "herb", respawnMs: 45_000, w: 5 },
  blue_herb: { item: "blue_herb", respawnMs: 45_000, w: 3 },
  ore: { item: "ore", respawnMs: 60_000, w: 2 },
};
/** 채집 지점 한 줄: [id, 종류, x, y, 캘 수 있음 1/0] */
export type GatherRow = [number, string, number, number, number];

// ── 고레벨 장비 단계 (P15 · D101): 황혼 35 · 서리 55 · 잿불 75 · 폭풍 95 — 무기 6 + 방어구 6, 수치는 고목 장비(Lv15) × 레벨/15 ──
const TIERS: { key: string; name: string; lv: number; c: [string, string, string]; gem: string; desc: string }[] = [
  { key: "dusk", name: "황혼", lv: 35, c: ["#c8a0f0", "#8a5dc8", "#5a3a8a"], gem: "#ff9a9e", desc: "황혼 고원의 저녁빛을 머금었다." },
  { key: "frost", name: "서리", lv: 55, c: ["#e8faff", "#9ee7ff", "#4a9ac0"], gem: "#ffffff", desc: "만지면 손끝이 얼얼하다." },
  { key: "ember", name: "잿불", lv: 75, c: ["#ffc8a0", "#ff6b3d", "#a8321a"], gem: "#ffe14d", desc: "꺼지지 않는 잿불이 속에서 타오른다." },
  { key: "storm", name: "폭풍", lv: 95, c: ["#fff4b0", "#F2C94C", "#a87a10"], gem: "#8fd0ff", desc: "들고 있으면 머리카락이 곤두선다." },
];
const r1 = (v: number) => Math.round(v);
for (const t of TIERS) {
  const k = t.lv / 15;
  const gear: Record<string, Template> = {
    [`${t.key}_sword`]: { name: `${t.name} 검`, kind: "weapon", slot: "weapon", basic: "slash", icon: "sword", lv: t.lv, stats: { atk: r1(22 * k), crit: 0.03, hp: r1(30 * k) }, look: t.c, desc: t.desc },
    [`${t.key}_dagger`]: { name: `${t.name} 단검`, kind: "weapon", slot: "weapon", basic: "slash", icon: "dagger", lv: t.lv, stats: { atk: r1(18 * k), atkSpeed: 15, crit: 0.04 }, look: t.c, desc: t.desc },
    [`${t.key}_axe`]: { name: `${t.name} 도끼`, kind: "weapon", slot: "weapon", basic: "slash", icon: "axe", lv: t.lv, stats: { atk: r1(25 * k), critDmg: 0.12 }, look: t.c, desc: t.desc },
    [`${t.key}_bow`]: { name: `${t.name} 장궁`, kind: "weapon", slot: "weapon", basic: "shot", icon: "bow", lv: t.lv, stats: { atk: r1(19 * k), crit: 0.05 }, look: t.c, desc: t.desc },
    [`${t.key}_staff`]: { name: `${t.name} 지팡이`, kind: "weapon", slot: "weapon", basic: "bolt", icon: "staff", lv: t.lv, stats: { ap: r1(22 * k), mana: r1(40 * k), cdr: 0.03 }, look: t.c, gem: t.gem, desc: t.desc },
    [`${t.key}_wand`]: { name: `${t.name} 완드`, kind: "weapon", slot: "weapon", basic: "bolt", icon: "wand", lv: t.lv, stats: { ap: r1(19 * k), mana: r1(25 * k), crit: 0.03 }, look: t.c, gem: t.gem, desc: t.desc },
    [`${t.key}_helm`]: { name: `${t.name} 투구`, kind: "armor", slot: "helmet", icon: "helmet", lv: t.lv, stats: { pdef: r1(6 * k), mdef: r1(4 * k), hp: r1(25 * k) }, look: t.c, desc: t.desc },
    [`${t.key}_mail`]: { name: `${t.name} 갑옷`, kind: "armor", slot: "chest", icon: "chest", lv: t.lv, stats: { pdef: r1(16 * k), mdef: r1(10 * k), hp: r1(70 * k) }, look: t.c, desc: t.desc },
    [`${t.key}_greaves`]: { name: `${t.name} 각반`, kind: "armor", slot: "legs", icon: "legs", lv: t.lv, stats: { pdef: r1(12 * k), mdef: r1(8 * k), hp: r1(50 * k) }, look: [t.c[1], t.c[2], t.c[2]], desc: t.desc },
    [`${t.key}_boots`]: { name: `${t.name} 장화`, kind: "armor", slot: "boots", icon: "boots", lv: t.lv, stats: { pdef: r1(4 * k), mdef: r1(3 * k), moveSpeed: 4 }, look: t.c[2], desc: t.desc },
    [`${t.key}_gloves`]: { name: `${t.name} 장갑`, kind: "armor", slot: "gloves", icon: "gloves", lv: t.lv, stats: { pdef: r1(4 * k), mdef: r1(3 * k), atkSpeed: 8 }, look: t.c[1], desc: t.desc },
    [`${t.key}_cape`]: { name: `${t.name} 망토`, kind: "armor", slot: "cape", icon: "cape", lv: t.lv, stats: { mdef: r1(8 * k), regen: r1(2 * k) }, look: t.c, desc: t.desc },
  };
  Object.assign(ITEMS, gear);
}
/** 고레벨 장비 템플릿 id (단계 · 부위) */
export const tierGear = (key: string) => Object.keys(ITEMS).filter((id) => id.startsWith(`${key}_`) && ITEMS[id].slot);
