import type { ElementId } from "./elements.ts";
import { ELEMENT_IDS } from "./elements.ts";
import { ENCHANTS, ITEMS, RARITIES, isGear, type Ench, type Item, type Rarity, type Template } from "./items.ts";

/**
 * 경제 (§16 · §17). RUC 는 베타 지갑 (DECISIONS D1) — 실제 마크 RUC 와 별개.
 * 확률은 서버 CSPRNG (난수 함수를 받음), 일반 상점 목록만 시드 고정 난수 (같은 회차엔 같은 목록).
 */

// ── 가치 (§14-1 배율 · §16-3) ────────────────────────────────────────
export const RARITY_VALUE: Record<Rarity, number> = { poor: 1, common: 3, rare: 10, advanced: 40, mythic: 200, legendary: 1000 };
export const baseValue = (t: Template) => t.value ?? (isGear(t) ? 15 + 5 * t.lv : 5);
/** 아이템 가치 = 기본가 × 희귀도 배율 × (1 + 0.15 × 강화) — 개당 */
export const itemValue = (it: Pick<Item, "tpl" | "rarity" | "enh">) => Math.round(baseValue(ITEMS[it.tpl]) * RARITY_VALUE[it.rarity] * (1 + 0.15 * it.enh));
/** 분해 환불 (§16-3): 가치 / 50, 최소 1 — 개당 */
export const disassembleRuc = (it: Pick<Item, "tpl" | "rarity" | "enh">) => Math.max(1, Math.floor(itemValue(it) / 50));

// ── 강화 (§16-1) ────────────────────────────────────────────────────
/** +1 … +10: 성공 · 파괴 확률(나머지는 실패 유지) · 강화석 개수 · RUC 배율 */
export const ENHANCE = [
  { ok: 0.95, boom: 0, stones: 1, mul: 1 },
  { ok: 0.9, boom: 0, stones: 1, mul: 1.2 },
  { ok: 0.85, boom: 0, stones: 2, mul: 1.5 },
  { ok: 0.75, boom: 0, stones: 2, mul: 2 },
  { ok: 0.65, boom: 0.01, stones: 3, mul: 3 },
  { ok: 0.55, boom: 0.03, stones: 3, mul: 4 },
  { ok: 0.45, boom: 0.05, stones: 4, mul: 6 },
  { ok: 0.35, boom: 0.08, stones: 5, mul: 8 },
  { ok: 0.25, boom: 0.12, stones: 6, mul: 12 },
  { ok: 0.15, boom: 0.15, stones: 8, mul: 20 },
];
export const ENHANCE_MAX = ENHANCE.length;
/** 강화 기본 비용: 30 RUC × (희귀도 순번 + 1) × 단계 배율 (DECISIONS D37) */
export const enhanceCost = (it: Pick<Item, "rarity" | "enh">) => Math.round(30 * (1 + RARITIES.indexOf(it.rarity)) * ENHANCE[it.enh].mul);
/** 성공 · 실패(유지) · 파괴. 축복 = 성공 +10%p (파괴율 그대로), 보호 = 파괴 → 실패 */
export function rollEnhance(r: number, step: number, blessed: boolean, protect: boolean): "ok" | "fail" | "boom" {
  const e = ENHANCE[step];
  const ok = Math.min(1, e.ok + (blessed ? 0.1 : 0));
  if (r < ok) return "ok";
  if (r < ok + e.boom) return protect ? "fail" : "boom";
  return "fail";
}
/** 성공 시 20% 확률로 강화 옵션 (최대 3개, 마법부여의 50% 수치) */
export const ENHANCE_OPT = { chance: 0.2, max: 3, scale: 0.5 };
/** +10 이름 접두어 (§16-1): 무기는 기세, 방어구는 수호, 장신구는 별빛 쪽 */
export const PREFIXES: Record<string, string[]> = {
  weapon: ["새벽을 가르는", "꺼지지 않는 불씨의", "천둥을 부르는", "바람을 베는", "정령왕의"],
  armor: ["숲의 맹세를 지닌", "무너지지 않는", "황금 들판의", "얼어붙은 달의", "정령왕의"],
  accessory: ["별빛 머금은", "끝없는 파도의", "행운이 깃든", "새벽을 품은", "정령왕의"],
};
export const tenName = (t: Template, prefix: string) => `「${prefix}」 ${t.name} +10`;

// ── 마법부여 (§16-2) ────────────────────────────────────────────────
/** 아이템 희귀도별 마법부여 슬롯 (§14-1) */
export const ENCH_SLOTS: Record<Rarity, number> = { poor: 0, common: 1, rare: 1, advanced: 2, mythic: 2, legendary: 3 };
/** 부가석 희귀도 → 수치 배율 · 비용 배율 (D37) */
export const ENCH_POWER: Record<Rarity, number> = { poor: 0.6, common: 1, rare: 1.5, advanced: 2.2, mythic: 3.2, legendary: 4.5 };
export const ENCH_COST_MUL: Record<Rarity, number> = { poor: 1, common: 1.5, rare: 2, advanced: 3, mythic: 5, legendary: 8 };
/** 비용 = 100 RUC × 아이템 희귀도 배율 × 부가석 희귀도 배율 */
export const enchantCost = (item: Rarity, stone: Rarity) => Math.round(100 * ENCH_COST_MUL[item] * ENCH_COST_MUL[stone]);
const round = (v: number) => (v < 1 ? Math.round(v * 1000) / 1000 : Math.round(v));
/** 부가석 하나로 굴린 마법부여 한 줄 (scale 0.5 = 강화 옵션) */
export function rollEnch(kind: string, power: number, rand: () => number, scale = 1): Ench {
  const [lo, hi] = ENCHANTS[kind].range;
  const e: Ench = { k: kind, v: round((lo + rand() * (hi - lo)) * power * scale) };
  if (kind === "eldef") e.el = ELEMENT_IDS.filter((x) => x !== "none")[Math.floor(rand() * 11)] as ElementId;
  return e;
}

// ── 수리 (§14-4) ────────────────────────────────────────────────────
/** 닳은 내구도 1 당 0.5 RUC × (1 + 희귀도 순번 × 0.5) */
export const repairCost = (it: Pick<Item, "rarity" | "dur" | "durMax">) => Math.ceil(Math.max(0, it.durMax - it.dur) * 0.5 * (1 + RARITIES.indexOf(it.rarity) * 0.5));

// ── 재조합 (§16-4) ──────────────────────────────────────────────────
/** 같은 용도 3개 → 같은 용도 무작위 1개. 결과 희귀도: 평균 기준 70% 같음 · 25% 한 단계 아래 · 5% 위 (운 +0.05%p/점) */
export function recombine(inputs: Pick<Item, "tpl" | "rarity">[], luck: number, rand: () => number): { tpl: string; rarity: Rarity } {
  const kind = ITEMS[inputs[0].tpl].kind;
  const pool = Object.keys(ITEMS).filter((id) => ITEMS[id].kind === kind);
  const tpl = pool[Math.floor(rand() * pool.length)];
  const fixed = ITEMS[tpl].rarity;
  if (fixed) return { tpl, rarity: fixed };
  const avg = Math.round(inputs.reduce((a, i) => a + RARITIES.indexOf(i.rarity), 0) / inputs.length);
  const r = rand();
  const up = 0.05 + luck * 0.0005;
  const i = r < up ? avg + 1 : r < up + 0.25 ? avg - 1 : avg;
  return { tpl, rarity: RARITIES[Math.max(0, Math.min(RARITIES.length - 1, i))] };
}

// ── 일반 상점 (§17-2) ───────────────────────────────────────────────
export const SHOP = { slots: 8, hours: 6, kstOffsetH: 9 };
const H = 3600_000;
/** 갱신 회차: KST 00 · 06 · 12 · 18시마다 +1 */
export const shopCycle = (now: number) => Math.floor((now + SHOP.kstOffsetH * H) / (SHOP.hours * H));
export const cycleEnd = (cycle: number) => (cycle + 1) * SHOP.hours * H - SHOP.kstOffsetH * H;

/** 시드 고정 난수 (mulberry32) — 같은 (플레이어, 회차)면 같은 목록 */
export function seeded(seed: string): () => number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 16777619);
  return () => {
    h = (h + 0x6d2b79f5) | 0;
    let t = Math.imul(h ^ (h >>> 15), 1 | h);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 상점 진열 후보: 가중치 · 칸당 구매 한도 */
const SHOP_POOL: { item: string; w: number; stock: number }[] = [
  { item: "hp_potion_s", w: 10, stock: 10 }, { item: "mp_potion_s", w: 7, stock: 10 }, { item: "en_potion_s", w: 7, stock: 10 },
  { item: "hp_potion_m", w: 6, stock: 5 }, { item: "mp_potion_m", w: 4, stock: 5 }, { item: "en_potion_m", w: 4, stock: 5 },
  { item: "enhance_stone", w: 6, stock: 5 }, { item: "protect_scroll", w: 2, stock: 1 }, { item: "blessed_stone", w: 1, stock: 1 },
  ...["ench_atk", "ench_ap", "ench_def", "ench_hp", "ench_speed", "ench_crit", "ench_eldef", "ench_vamp"].map((item) => ({ item, w: 2, stock: 2 })),
  ...["old_dagger", "wood_sword", "apprentice_staff", "hunter_bow", "goblin_axe", "leather_cap", "leather_vest", "leather_pants", "leather_boots", "leather_gloves", "meadow_cape", "copper_ring", "rabbit_charm"]
    .map((item) => ({ item, w: 2, stock: 1 })),
];
/** 늘 파는 잡화 (P12): 회차 진열과 따로, 한 회차에 99개까지 */
export const SHOP_GOODS: { item: string; price: number }[] = [
  { item: "return_scroll", price: 40 }, { item: "revive_feather", price: 300 }, { item: "elixir_power", price: 250 }, { item: "elixir_luck", price: 250 },
  { item: "elixir_iron", price: 250 }, { item: "random_box", price: 400 }, { item: "storage_ticket", price: 2000 },
];
/** 하급 40 · 일반 35 · 희귀 25% (§17-2), 운이 높으면 위쪽으로 (운 × 0.05%p 를 하급 → 희귀로) */
function shopRarity(r: number, luck: number): Rarity {
  const shift = Math.min(0.2, luck * 0.0005);
  return r < 0.4 - shift ? "poor" : r < 0.75 - shift ? "common" : "rare";
}
export type ShopSlot = { tpl: string; rarity: Rarity; price: number; stock: number };
/** 이 플레이어 · 이 회차의 진열 (§17-2: seed = hash(유저, 회차)) */
export function rollShop(user: string | number, cycle: number, luck: number): ShopSlot[] {
  const rand = seeded(`${user}:${cycle}`);
  const total = SHOP_POOL.reduce((a, x) => a + x.w, 0);
  const out: ShopSlot[] = [];
  for (let i = 0; i < SHOP.slots; i++) {
    let r = rand() * total;
    const pick = SHOP_POOL.find((x) => (r -= x.w) < 0) ?? SHOP_POOL[0];
    const t = ITEMS[pick.item];
    const rarity = t.rarity ?? shopRarity(rand(), luck);
    out.push({ tpl: pick.item, rarity, price: itemValue({ tpl: pick.item, rarity, enh: 0 }), stock: pick.stock });
  }
  return out;
}

// ── 우편 · 유저 상점 (§15-5 · §17-3) ─────────────────────────────────
export const MAIL = { days: 30, max: 100, perMail: 64 };
export const MARKET = { days: 7, max: 10, fee: 0.05, options: 3 };
/** 유저 상점 가격 한 가지: RUC 와 아이템을 함께 (AND), 옵션 여러 개는 구매자가 고름 (OR) */
export type PriceItem = { tpl: string; qty: number; minRarity?: Rarity };
export type Price = { ruc?: number; items?: PriceItem[] };
/** 이 아이템이 가격 조건의 아이템을 채우는가 (같은 템플릿 · 최소 희귀도) */
export const meetsPrice = (it: Pick<Item, "tpl" | "rarity">, need: PriceItem) =>
  it.tpl === need.tpl && RARITIES.indexOf(it.rarity) >= RARITIES.indexOf(need.minRarity ?? "poor");
