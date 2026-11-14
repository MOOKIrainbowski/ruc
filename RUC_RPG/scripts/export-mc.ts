/**
 * Export authoritative web RPG tables and formula goldens for the Paper port.
 * Run from the repository root: node RUC_RPG/scripts/export-mc.ts
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { baseStats, expToNext } from "../../web/rpg/shared/character.ts";
import { castMs, computeDamage, elementMul, finalStats, healAmount, mentalResist, mitigation } from "../../web/rpg/shared/combat.ts";
import { CAPS, BASE_STATS, COMBAT, LEVEL_GROWTH, MOVE, ROLL, SECONDARY, STAMINA } from "../../web/rpg/shared/data/stats.ts";
import { ELEMENTS, ELEMENT_IDS, ELEMENT_PROC, REACTIONS } from "../../web/rpg/shared/data/elements.ts";
import { EFFECTS, FOREVER_MS } from "../../web/rpg/shared/data/effects.ts";
import { ITEMS, RARITIES, RARITY, SETS, SPECIALS, ENCHANTS, durMaxOf } from "../../web/rpg/shared/data/items.ts";
import { ENHANCE, ENHANCE_MAX, ENHANCE_OPT, PREFIXES, ENCH_SLOTS, ENCH_POWER, ENCH_COST_MUL, RARITY_VALUE, SHOP, SHOP_GOODS, BREW, MAIL, MARKET, rollShop, enhanceCost, enchantCost, repairCost, disassembleRuc, itemValue, rollEnhance } from "../../web/rpg/shared/data/economy.ts";
import { SKILLS, SLOTS, APPRENTICE_SLOTS } from "../../web/rpg/shared/data/skills.ts";
import { LINES, JOBS, STAT_GRADE, AWAKEN, AWAKEN_NAME, SPIRIT_BUFF, JOB_LV, JOB_POTENTIAL, JOB_POT_SHIFT, jobStats } from "../../web/rpg/shared/data/jobs.ts";
import { MOBS, GRADES, mobStats, mobExp } from "../../web/rpg/shared/data/mobs.ts";
import { GRADE, SKILL_GRADES, MASTERY, MASTERY_MOB, POT_GAIN, needMastery, startLevel, skillNums } from "../../web/rpg/shared/progress.ts";
import { TUTORIAL, QUESTS, FIRST_QUEST, NPCS, FOUNTAIN_SPOTS, FOUNTAIN_R, USER_QUEST, COLLECT_CHOICES, NOTI_KINDS, NOTI_TOAST } from "../../web/rpg/shared/data/quests.ts";
import { ROOM_NAME, RUINS } from "../../web/rpg/shared/data/dungeons.ts";
import { PARTY, PINGS, PING_WHEEL, PING, DUEL, KDA, TITLES } from "../../web/rpg/shared/data/party.ts";
import { PETS, ENGINEER } from "../../web/rpg/shared/data/pets.ts";
import { TERRITORIES, REALM, GUILD_XP } from "../../web/rpg/shared/data/realm.ts";

const root = new URL("../../minecraft/plugins/RucRpg/src/", import.meta.url);
const dataDir = fileURLToPath(new URL("main/resources/data/", root));
const testDir = fileURLToPath(new URL("test/resources/", root));

/** Remove executable helpers so the exported artifacts contain data only. */
function dataOnly(value: unknown): unknown {
  if (typeof value === "function" || value === undefined) return undefined;
  if (Array.isArray(value)) return value.map((entry) => dataOnly(entry));
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value)) {
      const clean = dataOnly(entry);
      if (clean !== undefined) out[key] = clean;
    }
    return out;
  }
  return value;
}

function assertJsonSafe(value: unknown, path = "root"): void {
  if (typeof value === "number" && !Number.isFinite(value)) throw new Error(`${path} is not finite: ${value}`);
  if (typeof value === "function" || typeof value === "bigint" || typeof value === "undefined") throw new Error(`${path} is not JSON data`);
  if (Array.isArray(value)) value.forEach((v, i) => assertJsonSafe(v, `${path}[${i}]`));
  else if (value && typeof value === "object") for (const [k, v] of Object.entries(value)) assertJsonSafe(v, `${path}.${k}`);
}

function save(dir: string, name: string, value: unknown): void {
  const clean = dataOnly(value);
  assertJsonSafe(clean, name);
  writeFileSync(join(dir, name), `${JSON.stringify(clean, null, 2)}\n`, "utf8");
}

// TIERS is intentionally module-private. Reconstruct its table from the generated
// tier gear, which carries the same key/name/level/palette/gem/description values.
const tiers = Object.keys(ITEMS).filter((id) => id.endsWith("_sword") && !!ITEMS[`${id.slice(0, -"_sword".length)}_staff`]?.gem).map((id) => {
  const key = id.slice(0, -"_sword".length);
  const sword = ITEMS[id];
  const staff = ITEMS[`${key}_staff`];
  return { key, name: sword.name.replace(/ 검$/, ""), lv: sword.lv, c: sword.look, gem: staff?.gem, desc: sword.desc };
});

const tables: Record<string, unknown> = {
  "items.json": { ITEMS, RARITIES, RARITY, SETS, SPECIALS, ENCHANTS, TIERS: tiers },
  "skills.json": { SKILLS, SLOTS, APPRENTICE_SLOTS },
  "jobs.json": { LINES, JOBS, STAT_GRADE, AWAKEN, AWAKEN_NAME, SPIRIT_BUFF, JOB_LV, JOB_POTENTIAL, JOB_POT_SHIFT },
  "mobs.json": { MOBS, GRADES },
  "effects.json": { EFFECTS, FOREVER_MS },
  "elements.json": { ELEMENTS, ELEMENT_IDS, ELEMENT_PROC, REACTIONS },
  "stats.json": { BASE_STATS, LEVEL_GROWTH, MOVE, STAMINA, SECONDARY, CAPS, COMBAT, ROLL },
  "economy.json": { ENHANCE, ENHANCE_MAX, ENHANCE_OPT, PREFIXES, ENCHANTS, ENCH_SLOTS, ENCH_POWER, ENCH_COST_MUL, RARITY_VALUE, SHOP, SHOP_GOODS, BREW, MAIL, MARKET },
  "quests.json": { TUTORIAL, QUESTS, FIRST_QUEST, NPCS, FOUNTAIN_SPOTS, FOUNTAIN_R, USER_QUEST, COLLECT_CHOICES, NOTI_KINDS, NOTI_TOAST },
  "dungeons.json": { ROOM_NAME, RUINS },
  "party.json": { PARTY, PINGS, PING_WHEEL, PING, DUEL, KDA, TITLES },
  "pets.json": { PETS, ENGINEER },
  "realm.json": { TERRITORIES, REALM, GUILD_XP },
  "progress.json": { SKILL_GRADES, GRADE, MASTERY, MASTERY_MOB, POT_GAIN },
};

const levels = [1, 10, 30, 60, 100];
const warriorGrades = LINES.warrior.g;
const warriorGradeMods = [
  { k: "hp", mul: STAT_GRADE[warriorGrades.hp] - 1 },
  { k: "stamina", mul: STAT_GRADE[warriorGrades.stamina] - 1 },
  { k: "pdef", mul: STAT_GRADE[warriorGrades.def] - 1 },
  { k: "mdef", mul: STAT_GRADE[warriorGrades.def] - 1 },
  { k: "atk", mul: STAT_GRADE[warriorGrades.atk] - 1 },
  { k: "ap", mul: STAT_GRADE[warriorGrades.ap] - 1 },
  { k: "atkSpeed", mul: STAT_GRADE[warriorGrades.atkSpeed] - 1 },
  { k: "moveSpeed", mul: STAT_GRADE[warriorGrades.moveSpeed] - 1 },
  { k: "spirit", mul: STAT_GRADE[warriorGrades.spirit] - 1 },
];
const finalStatsCases = [
  { name: "apprentice-lv1", base: baseStats(1), mods: [] },
  { name: "warrior-lv30-grade-multipliers-plus-equipment", base: baseStats(30), mods: [...warriorGradeMods, { k: "atk", add: 18 }, { k: "hp", add: 40 }, { k: "pdef", mul: 0.12 }, { k: "elDef", el: "fire", add: 25 }] },
  { name: "mage-awakened-lv60-with-buff", base: jobStats(60, "mage", [0, 60], null, true), mods: [{ k: "ap", add: 35 }, { k: "cdr", add: 0.12 }, { k: "moveSpeed", mul: 0.1 }, { k: "elDef", el: "ice", add: 40 }] },
  { name: "caps-apply", base: baseStats(100), mods: [{ k: "atkSpeed", add: 500 }, { k: "moveSpeed", add: 500 }, { k: "cdr", add: 1 }, { k: "luck", add: 500 }] },
].map((c) => ({ ...c, result: finalStats(c.base, c.mods as never) }));

const atkStats = finalStats(jobStats(30, "warrior", [30, 0]), [
  { k: "crit", add: 0.2 }, { k: "critDmg", add: 0.4 }, { k: "penPhys", add: 0.25 }, { k: "penMag", add: 0.2 }, { k: "elPen", add: 0.15 },
  { k: "dmgUp", add: 0.1 }, { k: "skillDmg", add: 0.15 },
]);
const defStats = finalStats(baseStats(35), [
  { k: "pdef", add: 45 }, { k: "mdef", add: 60 }, { k: "dmgDown", add: 0.12 }, { k: "meleeDown", add: 0.08 }, { k: "dmgTakenUp", add: 0.05 },
  { k: "elDef", el: "fire", add: 30 }, { k: "elDef", el: "water", add: 20 },
]);
const damageCases = Array.from({ length: 20 }, (_, i) => {
  const categories = ["physical", "magical", "hybrid"] as const;
  const pairs: [string | null, string | null][] = [
    [null, null], ["fire", "grass"], ["water", "fire"], ["fire", "water"], ["iron", "ice"], ["earth", "wind"],
    ["light", "dark"], ["dark", "light"], ["electric", "earth"], ["poison", "iron"], ["none", "water"], ["ice", "grass"],
  ];
  const [el, defEl] = pairs[i % pairs.length];
  const hit = {
    base: 24 + i * 3,
    atkRatio: i % 3 === 1 ? 0 : 0.55 + (i % 4) * 0.1,
    apRatio: i % 3 === 0 ? 0 : 0.35 + (i % 3) * 0.15,
    cat: categories[i % categories.length],
    el: el as keyof typeof ELEMENTS | null,
    gradeMul: [1, 1.2, 1.45, 1.8][i % 4],
    skillLv: [1, 10, 50][i % 3],
    skill: i % 2 === 0,
    melee: i % 4 === 0,
    power: i % 5 === 0 ? 0.08 : 0,
  };
  const crit = i % 4 === 3;
  return { name: ["physical", "magical", "hybrid"][i % 3] + (crit ? "-crit" : "") + `-${i + 1}`, attacker: atkStats, defender: defStats, hit, defElement: defEl, crit, result: computeDamage(atkStats, defStats, hit, defEl as keyof typeof ELEMENTS | null, crit) };
});

const grades = Object.keys(GRADE) as (keyof typeof GRADE)[];
const skillIds = ["magic_arrow", "dash_slash", "first_aid", "shield_bash", "iron_wall", "fireball", "shuriken", "heal", "spirit_burst", "spirit_link"]
  .filter((id) => id in SKILLS);
for (const id of Object.keys(SKILLS).sort()) if (skillIds.length < 10 && !skillIds.includes(id)) skillIds.push(id);
const skillNumCases = skillIds.slice(0, 10).flatMap((id) => grades.flatMap((grade) => [1, 10, 50].map((lv) => {
  const input = { skill: id, grade, lv, cdr: 0.2 };
  return { ...input, result: skillNums(SKILLS[id], { grade, lv }, input.cdr) };
})));

const mobIds = ["slime", "goblin", "wolf", "moss_golem", "eldra"].filter((id) => id in MOBS);
for (const id of Object.keys(MOBS).sort()) if (mobIds.length < 5 && !mobIds.includes(id)) mobIds.push(id);
const mobCases = mobIds.slice(0, 5).flatMap((id) => Object.keys(GRADES).map((grade) => {
  const def = MOBS[id];
  const lv = 30;
  const stats = mobStats(def, lv, grade as keyof typeof GRADES);
  return { mob: id, lv, grade, stats, exp: mobExp(def, lv, grade as keyof typeof GRADES, 30) };
}));

const gearTpl = Object.keys(ITEMS).find((id) => ITEMS[id].slot) ?? Object.keys(ITEMS)[0];
const gear = ITEMS[gearTpl];
const valueCases = RARITIES.flatMap((rarity) => [0, 5, 10].map((enh) => {
  const input = { tpl: gearTpl, rarity, enh };
  return { ...input, value: itemValue(input), disassembleRuc: disassembleRuc(input) };
}));
const costCases = RARITIES.flatMap((rarity) => [0, 4, 9].map((enh) => {
  const input = { rarity, enh };
  return { ...input, cost: enhanceCost(input) };
}));
const repairCases = RARITIES.flatMap((rarity) => {
  const durMax = durMaxOf(gear, rarity);
  return [0, Math.floor(durMax / 2), durMax].map((dur) => {
    const input = { rarity, dur, durMax };
    return { tpl: gearTpl, ...input, cost: repairCost(input) };
  });
});
const enhanceRollCases = ENHANCE.flatMap((step, index) => {
  const epsilon = 1e-9;
  const sampleR = [...new Set([0, Math.max(0, step.ok - epsilon), step.ok, Math.min(1, step.ok + Math.max(epsilon, step.boom / 2)), Math.min(1, step.ok + step.boom), 0.999999])];
  return sampleR.flatMap((r) => [false, true].flatMap((blessed) => [false, true].map((protect) => ({ step: index, blessed, protect, r, result: rollEnhance(r, index, blessed, protect) }))));
});
const rollShopCases = [
  { user: "user", cycle: 20261115, luck: 0 },
  { user: "user", cycle: 20261116, luck: 80 },
].map((input) => ({ ...input, result: rollShop(input.user, input.cycle, input.luck) }));

const golden = {
  baseStats: levels.map((lv) => ({ lv, result: baseStats(lv) })),
  expToNext: Array.from({ length: 100 }, (_, i) => ({ lv: i + 1, result: expToNext(i + 1) })),
  finalStats: finalStatsCases,
  computeDamage: damageCases,
  mitigation: [0, 25, 100, 300].flatMap((def) => [0, 0.25, 0.8].map((pen) => ({ def, pen, result: mitigation(def, pen) }))),
  elementMul: ELEMENT_IDS.map((atk) => ({ atk, against: ELEMENT_IDS.map((def) => ({ def, result: elementMul(atk, def) })) })),
  castMs: [
    { baseMs: 1000, atkSpeed: 50 }, { baseMs: 1000, atkSpeed: 100 }, { baseMs: 800, atkSpeed: 175 }, { baseMs: 600, atkSpeed: 250 }, { baseMs: 600, atkSpeed: 400 },
  ].map((input) => ({ ...input, result: castMs(input.baseMs, input.atkSpeed) })),
  healAmount: [
    { base: 100, giver: finalStats(baseStats(1), []), taker: finalStats(baseStats(1), []) },
    { base: 180, giver: finalStats(baseStats(30), [{ k: "spirit", add: 80 }, { k: "healPower", add: 0.25 }]), taker: finalStats(baseStats(60), [{ k: "spirit", add: 40 }, { k: "healTaken", add: 0.1 }]) },
  ].map((input) => ({ ...input, result: healAmount(input.base, input.giver, input.taker) })),
  mentalResist: [0, 50, 100, 200, 500].map((spirit) => ({ spirit, result: mentalResist(spirit) })),
  needMastery: Array.from({ length: 100 }, (_, i) => ({ lv: i + 1, result: needMastery(i + 1) })),
  startLevel: [[0, 1], [40, 10], [120, 50], [4000, 100], [4000, 30]].map(([pot, playerLv]) => ({ pot, playerLv, result: startLevel(pot, playerLv) })),
  skillNums: skillNumCases,
  mobStats: mobCases,
  itemValue: valueCases,
  enhanceCost: costCases,
  enchantCost: RARITIES.flatMap((item) => RARITIES.map((stone) => ({ item, stone, result: enchantCost(item, stone) }))),
  repairCost: repairCases,
  disassembleRuc: valueCases.map(({ tpl, rarity, enh }) => ({ tpl, rarity, enh, result: disassembleRuc({ tpl, rarity, enh }) })),
  rollEnhance: enhanceRollCases,
  rollShop: rollShopCases,
};

mkdirSync(dataDir, { recursive: true });
mkdirSync(testDir, { recursive: true });
for (const [name, value] of Object.entries(tables)) save(dataDir, name, value);
save(testDir, "golden.json", golden);

console.log(`Exported ${Object.keys(tables).length} data tables and golden.json (${skillNumCases.length} skill cases, ${damageCases.length} damage cases, ${mobCases.length} mob cases).`);
