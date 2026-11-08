import { randomInt } from "node:crypto";
import type { Stats } from "../../../web/rpg/shared/character.ts";
import { computeDamage, finalStats, healAmount, hpRegen, mentalResist, resRegen, type FullStats, type Hit, type Mod } from "../../../web/rpg/shared/combat.ts";
import { FOREVER_MS, effectDef } from "../../../web/rpg/shared/data/effects.ts";
import { ELEMENTS, ELEMENT_PROC, REACTIONS, type ElementId } from "../../../web/rpg/shared/data/elements.ts";
import { COMBAT } from "../../../web/rpg/shared/data/stats.ts";
import type { Mover } from "../../../web/rpg/shared/movement.ts";
import { H_COUNTER, H_CRIT, H_DOT, H_HEAL, H_IMMUNE, H_MISS, H_RESIST, type Ev, type FxRow } from "../../../web/rpg/shared/protocol.ts";

/**
 * 전투 유닛(플레이어 · 몹) 공통 — 상태효과 엔진(§11-3) · 피해 적용(§13-1) · 회복(§6-3).
 * 시간은 전부 방의 틱 시각(w.now, ms)을 씁니다 — 테스트가 시간을 직접 넘길 수 있게.
 */

/** 확률은 서버 CSPRNG (§28) */
let rng = () => randomInt(0, 2 ** 47) / 2 ** 47;
/** 테스트용 난수 교체 */
export const setRandom = (f: () => number) => void (rng = f);
export const rand = () => rng();

export type Effect = { id: string; src: number; stacks: number; v: number; until: number; dur: number; next: number; dot: number };

export type Unit = {
  id: number;
  kind: "p" | "m";
  name: string;
  el: ElementId;
  lv: number;
  x: number;
  y: number;
  /** 피격 반지름 px */
  r: number;
  hp: number;
  mp: number;
  en: number;
  base: Stats;
  st: FullStats;
  fx: Effect[];
  /** hardCC 체감 기록 · 체감 면역 끝 시각 */
  dr: Map<string, { n: number; until: number }>;
  ccImmune: number;
  /** 마지막으로 피해를 주고받은 시각 (비전투 판정) */
  combat: number;
  dead: boolean;
  /** 무적 상태 (몹 귀환 중) */
  evade: boolean;
  block: { move: boolean; atk: boolean; skill: boolean };
  fxDirty: boolean;
  statsDirty: boolean;
  /** 장비 스탯 보정 (플레이어) */
  gear: Mod[];
  /** 세부 직업 (패시브 판정) · 기사도 연속 타격 · 내부 쿨 (일식 등) */
  job: string | null;
  chiv: { tgt: number; n: number } | null;
  icd: Map<string, number>;
  /** 플레이어만 */
  mover?: Mover;
  /** 소환수면 주인 id (P13) */
  petOf?: number;
};

/** 방이 제공하는 것 */
export interface World {
  now: number;
  ev: Ev[];
  unit(id: number): Unit | undefined;
  /** 피해 기록 (몹 위협 수치 · 처치 기여 · 막타 스킬) — HP 를 깎기 전에 불러서 막타도 기여로 셈 */
  damaged(src: Unit, tgt: Unit, amount: number, threat: number, h?: HitSpec): void;
  /** 직접 타격 뒤 (장비 내구도 · 발동 효과). 도트 · 반사는 안 부름 */
  struck(src: Unit, tgt: Unit, amount: number, h: HitSpec): void;
  killed(u: Unit, by: Unit | undefined): void;
  /** 넉백 등 강제 이동 (벽 충돌 포함) */
  push(u: Unit, dx: number, dy: number): void;
  /** (x, y) 반경 r 안의 살아 있는 플레이어(p) · 몹(m) */
  around(x: number, y: number, r: number, kind: "p" | "m"): Unit[];
  /** 적대 관계 (P7 결투장 · 결투). 없으면 플레이어 ↔ 몹만 */
  hostile?(a: Unit, b: Unit): boolean;
  /** 쓰러지기 직전: true 면 죽이지 않음 (결투 패배는 체력 1로 끝남) */
  spare?(src: Unit | undefined, u: Unit): boolean;
}
const foe = (w: World, a: Unit, b: Unit) => (w.hostile ? w.hostile(a, b) : a.kind !== b.kind);

export function makeUnit(o: { id: number; kind: "p" | "m"; name: string; el: ElementId; lv: number; x: number; y: number; r: number; base: Stats; mover?: Mover }): Unit {
  const u: Unit = {
    ...o, hp: 0, mp: 0, en: 0, st: finalStats(o.base, []), fx: [], dr: new Map(), ccImmune: 0, combat: -1e9,
    dead: false, evade: false, block: { move: false, atk: false, skill: false }, fxDirty: false, statsDirty: true, gear: [], job: null, chiv: null, icd: new Map(),
  };
  recalc(u);
  u.hp = u.st.hp;
  u.mp = u.st.mana;
  u.en = u.st.energy;
  return u;
}

/** 기본 스탯 · 속성 패시브 · 장비 · 효과를 합쳐 최종 스탯과 행동 제한을 다시 계산 */
export function recalc(u: Unit) {
  const mods: Mod[] = u.kind === "p" ? [...ELEMENTS[u.el].mods, ...u.gear] : [];
  const block = { move: false, atk: false, skill: false };
  for (const e of u.fx) {
    const d = effectDef(e.id);
    if (!d) continue;
    if (d.mods) mods.push(...d.mods(e.v, e.stacks));
    if (d.block) {
      block.move ||= !!d.block.move;
      block.atk ||= !!d.block.atk;
      block.skill ||= !!d.block.skill;
    }
  }
  u.st = finalStats(u.base, mods);
  u.block = block;
  u.hp = Math.min(u.hp, u.st.hp);
  u.mp = Math.min(u.mp, u.st.mana);
  u.en = Math.min(u.en, u.st.energy);
  u.statsDirty = true;
  if (u.mover) {
    u.mover.spd = u.st.moveSpeed;
    u.mover.endu = u.st.endurance;
    u.mover.aspd = u.st.atkSpeed;
    u.mover.staminaMax = u.st.stamina;
    u.mover.stamina = Math.min(u.mover.stamina, u.st.stamina);
    u.mover.root = block.move || u.dead;
  }
}

export const has = (u: Unit, id: string) => u.fx.some((e) => e.id === id);
export const find = (u: Unit, id: string) => u.fx.find((e) => e.id === id);
const inCombat = (w: World, u: Unit) => w.now - u.combat < COMBAT.outOfCombatMs;

export type FxSpec = { id: string; ms: number; v?: number; dot?: number; chance?: number };

/**
 * 효과 걸기 (§11-3). 같은 효과는 지속시간 갱신 · 스택형은 +1. 보호막은 따로따로 쌓임.
 * 디버프: 면역 · 무적 · 저지 불가 · 정신력 저항 · 강인함 · (플레이어) hardCC 체감과 끝난 뒤 0.5초 면역.
 */
export function addEffect(w: World, tgt: Unit, f: FxSpec, src?: Unit): boolean {
  const def = effectDef(f.id);
  if (!def || tgt.dead) return false;
  let ms = f.ms;
  let v = f.v ?? 0;
  if (!def.buff) {
    if (has(tgt, "immune") || has(tgt, "invuln") || tgt.evade) return false;
    const cc = def.cat === "hardCC" || def.cat === "softCC";
    if (cc && has(tgt, "unstoppable")) return false;
    if (def.mental && rand() < mentalResist(tgt.st.spirit)) {
      w.ev.push(["h", src?.id ?? 0, tgt.id, 0, H_RESIST, ""]);
      return false;
    }
    if (src?.job === "illusionist" && MENTAL.has(f.id)) ms *= 1.2; // 환술사 「몽환」
    if (cc && f.id !== "airborne") ms *= 1 - tgt.st.tenacity;
    if (def.cat === "hardCC" && tgt.kind === "p") {
      if (w.now < tgt.ccImmune) return false;
      const d = tgt.dr.get(f.id);
      const n = d && w.now < d.until ? d.n + 1 : 0;
      const mul = COMBAT.drSteps[Math.min(n, COMBAT.drSteps.length - 1)];
      if (!mul) return false;
      tgt.dr.set(f.id, { n, until: w.now + COMBAT.drWindowMs });
      ms *= mul;
    }
    // 젖음: 얼음 둔화 2배 · 화상 지속 −50% (§11-2)
    if (has(tgt, "wet")) {
      if (f.id === "chill") v *= 2;
      if (f.id === "burn") ms *= 0.5;
    }
  }
  if (f.id === "immune") tgt.fx = tgt.fx.filter((e) => effectDef(e.id)?.buff);
  if (f.id === "shield" && has(tgt, "curse")) v *= 0.5;

  const cur = f.id === "shield" ? undefined : find(tgt, f.id);
  if (cur) {
    cur.until = w.now + ms;
    cur.dur = ms;
    cur.v = v;
    if (f.dot !== undefined) cur.dot = f.dot;
    if (def.max) cur.stacks = Math.min(def.max, cur.stacks + 1);
  } else {
    tgt.fx.push({ id: f.id, src: src?.id ?? 0, stacks: 1, v, until: w.now + ms, dur: ms, next: w.now + (def.tick ?? 0), dot: f.dot ?? 0 });
  }
  tgt.fxDirty = true;
  // 얼음 둔화 3중첩 → 빙결
  if (f.id === "chill" && find(tgt, "chill")!.stacks >= 3) {
    removeEffect(w, tgt, "chill");
    addEffect(w, tgt, { id: "freeze", ms: 1500 }, src);
  }
  recalc(tgt);
  // 성기사 「신성한 방벽」: 보호막을 받으면 보호막량의 10%만큼 주변(6칸) 아군 회복
  if (f.id === "shield" && tgt.job === "paladin" && v > 0) for (const a of w.around(tgt.x, tgt.y, 96, "p")) if (!foe(w, tgt, a)) applyHeal(w, tgt, a, v * 0.1, true);
  return true;
}

/** 정신계 디버프 (환술사 「몽환」 지속 +20%) */
const MENTAL = new Set(["charm", "confuse", "fear", "sleep"]);

export function removeEffect(w: World, u: Unit, id: string) {
  const i = u.fx.findIndex((e) => e.id === id);
  if (i < 0) return;
  if (effectDef(id)?.cat === "hardCC" && u.kind === "p") u.ccImmune = w.now + COMBAT.ccImmuneMs;
  u.fx.splice(i, 1);
  u.fxDirty = true;
  recalc(u);
}

/** 효과 시간 경과: 도트 · 지속 회복 틱, 만료 */
export function tickEffects(w: World, u: Unit) {
  for (let i = u.fx.length - 1; i >= 0; i--) {
    const e = u.fx[i];
    if (!e) continue;
    const def = effectDef(e.id)!;
    if (def.tick && w.now >= e.next && e.next <= e.until) {
      e.next += def.tick;
      if (def.cat === "dot") {
        const moving = u.mover ? u.mover.moving : (u as { moving?: boolean }).moving;
        dotDamage(w, w.unit(e.src), u, e.dot * e.stacks * (e.id === "bleed" && moving ? 2 : 1));
      } else if (def.cat === "hot") {
        if (e.id === "regen_hp") applyHeal(w, w.unit(e.src) ?? u, u, e.dot, true);
        else { u.mp = Math.min(u.st.mana, u.mp + e.dot); u.en = Math.min(u.st.energy, u.en + e.dot); }
      }
      if (u.dead) return;
    }
    if (w.now >= e.until) {
      if (def.cat === "hardCC" && u.kind === "p") u.ccImmune = w.now + COMBAT.ccImmuneMs;
      u.fx.splice(u.fx.indexOf(e), 1);
      u.fxDirty = true;
      recalc(u);
    }
  }
}

/** 보호막 먼저 (먼저 생긴 것부터) 깎고 남은 피해 */
function absorb(w: World, u: Unit, dmg: number): number {
  for (const e of u.fx) {
    if (e.id !== "shield" || dmg <= 0) continue;
    const a = Math.min(e.v, dmg);
    e.v -= a;
    dmg -= a;
    if (e.v <= 0) e.until = w.now; // 다음 tickEffects 에서 정리
  }
  return dmg;
}

export const shieldOf = (u: Unit) => u.fx.reduce((a, e) => (e.id === "shield" ? a + e.v : a), 0);

function loseHp(w: World, src: Unit | undefined, tgt: Unit, dmg: number) {
  if (dmg > 0 && has(tgt, "stealth")) removeEffect(w, tgt, "stealth"); // 맞아도 풀림
  tgt.hp -= absorb(w, tgt, dmg);
  tgt.combat = w.now;
  if (src) src.combat = w.now;
  if (has(tgt, "sleep")) removeEffect(w, tgt, "sleep");
  if (tgt.hp <= 0 && !w.spare?.(src, tgt)) die(w, tgt, src);
}

export function die(w: World, u: Unit, by: Unit | undefined) {
  if (u.dead) return;
  // 부활 깃털 (P12): 그 자리에서 HP 30% · 1.5초 무적
  if (u.kind === "p" && has(u, "feather")) {
    removeEffect(w, u, "feather");
    u.hp = Math.max(1, Math.round(u.st.hp * 0.3));
    addEffect(w, u, { id: "invuln", ms: 1500 }, u);
    w.ev.push(["rv", u.id]);
    return;
  }
  // 흑마법사 「영혼 수확」: 디버프가 걸린 적을 처치하면 HP · 마나 5% 회복
  if (by?.job === "warlock" && by !== u && u.fx.some((e) => !effectDef(e.id)?.buff)) {
    applyHeal(w, by, by, by.st.hp * 0.05, true);
    by.mp = Math.min(by.st.mana, by.mp + by.st.mana * 0.05);
  }
  u.dead = true;
  u.hp = 0;
  u.fx = u.fx.filter((e) => effectDef(e.id)?.keep); // 영약은 남음
  u.fxDirty = true;
  recalc(u);
  w.ev.push(["d", u.id]);
  w.killed(u, by);
}

/**
 * 타격 한 번. cast = 스킬 시전(숙련도), crit = 치명타 확률 +, execute = 대상 HP 이 비율 이하면 ×2,
 * mul = 차지 배율, ranged = 플레이어 물리 투사체 (이동 중 사격 −20%, 궁수 바람 읽기 제외)
 */
export type HitSpec = Hit & { threat: number; proc?: boolean; fx?: FxSpec[]; basic?: boolean; cast?: unknown; crit?: number; execute?: number; mul?: number; ranged?: boolean; reach?: number; pet?: number; taunt?: number };

/** 피해 한 번 (§13-1). 반환: 실제로 깎은 양 (보호막 포함) */
export function hit(w: World, src: Unit, tgt: Unit, h: HitSpec): number {
  if (tgt.dead || src.dead) return 0;
  if (tgt.evade || (tgt.mover && tgt.mover.ifr > 0) || has(tgt, "invuln")) {
    w.ev.push(["h", src.id, tgt.id, 0, H_IMMUNE, ""]);
    return 0;
  }
  if (h.basic && has(src, "blind") && rand() < 0.5) {
    w.ev.push(["h", src.id, tgt.id, 0, H_MISS, ""]);
    return 0;
  }
  const ambush = src !== tgt && has(src, "stealth");
  if (ambush) removeEffect(w, src, "stealth"); // 공격하면 은신이 풀림 (§11-1)
  const crit = (ambush && src.job === "nightwalker") || rand() < src.st.crit + (h.crit ?? 0); // 나이트워커 「밤의 장막」
  const proc = h.proc && h.el ? ELEMENT_PROC[h.el] : undefined;
  let dmg = computeDamage(src.st, tgt.st, { ...h, power: (h.power ?? 0) + (proc?.power ?? 0) }, tgt.el, crit);
  if (h.cat !== "magical" && has(tgt, "freeze")) {
    dmg = Math.round(dmg * 1.3);
    removeEffect(w, tgt, "freeze");
  }
  if (h.el === "electric" && has(tgt, "wet")) dmg = Math.round(dmg * 1.3);
  dmg = Math.max(1, Math.round(dmg * (h.mul ?? 1) * passiveMul(w, src, tgt, h)));
  // 반격 태세: 근접 공격을 막고 그대로 되돌려 주며 1초 기절
  if (h.melee && has(tgt, "counter") && src !== tgt) {
    w.ev.push(["h", src.id, tgt.id, 0, H_COUNTER, ""]);
    w.ev.push(["h", tgt.id, src.id, dmg, 0, ""]);
    w.damaged(tgt, src, dmg, 2);
    loseHp(w, tgt, src, dmg);
    addEffect(w, src, { id: "stun", ms: 1000 }, tgt);
    return 0;
  }
  if (src.kind === "p" && h.el) dmg = react(w, src, tgt, h.el, dmg);
  dmg = guardianShare(w, src, tgt, dmg);
  w.ev.push(["h", src.id, tgt.id, dmg, crit ? H_CRIT : 0, h.el ?? ""]);
  w.damaged(src, tgt, dmg, h.threat, h);
  loseHp(w, src, tgt, dmg);
  const vamp = h.cat === "magical" ? src.st.spellVamp : src.st.lifesteal;
  if (vamp > 0) applyHeal(w, src, src, dmg * vamp, false);
  w.struck(src, tgt, dmg, h);
  if (src.job === "arcanist" && h.skill) src.mp = Math.min(src.st.mana, src.mp + src.st.mana * 0.02); // 비전술사 「비전 순환」
  if (tgt.dead) return dmg;
  if (h.basic) {
    // 마검사 「마검 공명」: 평타에 주 속성 추가 피해 (주문력 30%)
    if (src.job === "spellblade") hit(w, src, tgt, { base: 0, atkRatio: 0, apRatio: 0.3, cat: "magical", el: src.el, threat: 1 });
    // 권사 「연환」: 평타 4타째에 짧은 에어본
    if (src.job === "monk") {
      const c = (src.chiv ??= { tgt: 0, n: 0 });
      if (++c.n >= 4) { c.n = 0; addEffect(w, tgt, { id: "airborne", ms: 400 }, src); }
    }
    if (tgt.dead) return dmg;
  }

  // 스킬 효과 · 속성 부가 효과 (§12-1)
  for (const f of [...(h.fx ?? []), ...(proc?.fx ?? [])]) {
    if (f.chance !== undefined && rand() >= f.chance) continue;
    addEffect(w, tgt, { ...f, dot: f.dot !== undefined ? Math.max(1, dmg * f.dot) : undefined }, src);
  }
  if (proc?.knock) {
    const dx = tgt.x - src.x;
    const dy = tgt.y - src.y;
    const len = Math.sqrt(dx * dx + dy * dy) || 1;
    w.push(tgt, (dx / len) * proc.knock, (dy / len) * proc.knock);
  }
  // 얼음 패시브: 근접 공격자에게 짧은 둔화
  if (h.melee && tgt.kind === "p" && tgt.el === "ice") addEffect(w, src, { id: "slow", ms: 800, v: 0.2 }, tgt);
  return dmg;
}

/** 도트 틱 — 방어 무시(걸 때 이미 피해 기준으로 계산), 도트 피해 증가만 반영 */
export function dotDamage(w: World, src: Unit | undefined, tgt: Unit, raw: number) {
  if (tgt.dead || tgt.evade || has(tgt, "invuln")) return;
  const dmg = Math.max(1, Math.round(raw * (1 + (src?.st.dotDmg ?? 0))));
  w.ev.push(["h", src?.id ?? 0, tgt.id, dmg, H_DOT, ""]);
  if (src) w.damaged(src, tgt, dmg, 1);
  loseHp(w, src, tgt, dmg);
}

/** 치유. computed = 이미 healAmount 를 거친 값(지속 회복 틱) */
export function applyHeal(w: World, src: Unit, tgt: Unit, amount: number, computed: boolean) {
  if (tgt.dead || amount <= 0) return;
  // 힐러 패시브 「치유의 손길」: 체력 30% 이하 아군에게 +30%
  const touch = src.job === "priest" && tgt.hp < tgt.st.hp * 0.3 ? 1.3 : 1;
  const v = Math.round((computed ? amount : amount * (1 + tgt.st.healTaken)) * touch);
  if (v <= 0) return;
  tgt.hp = Math.min(tgt.st.hp, tgt.hp + v);
  w.ev.push(["h", src.id, tgt.id, v, H_HEAL, ""]);
}

export const healPerTick = (base: number, src: Unit, tgt: Unit) => healAmount(base, src.st, tgt.st);

/** 자연 회복 · 탈진 HP 감소 (§6-3). dt 초 */
export function regen(w: World, u: Unit, dt: number) {
  if (u.dead) return;
  const ic = inCombat(w, u);
  u.hp = Math.min(u.st.hp, u.hp + hpRegen(u.st, ic) * dt);
  u.mp = Math.min(u.st.mana, u.mp + resRegen(u.st.mana, ic) * dt);
  u.en = Math.min(u.st.energy, u.en + resRegen(u.st.energy, ic) * dt);
  if (u.mover?.exhausted) u.hp = Math.max(Math.min(u.hp, 1), u.hp - u.st.hp * COMBAT.exhaustDrain * dt);
}

/** 네트워크로 보낼 효과 목록 */
export const fxRows = (w: World, u: Unit): FxRow[] =>
  u.fx.map((e) => (e.dur >= FOREVER_MS ? [e.id, 0, e.stacks, 0, e.v] : [e.id, Math.max(0, Math.round(e.until - w.now)), e.stacks, Math.round(e.dur), Math.round(e.v * 100) / 100]));

// ── 직업 패시브 (§9-3) ──────────────────────────────────────────

/** 피해 배율: 처형 · 이동 중 물리 사격 −20%(궁수 제외) · 직업 패시브 */
function passiveMul(w: World, src: Unit, tgt: Unit, h: HitSpec): number {
  let m = h.execute && tgt.hp <= tgt.st.hp * h.execute ? 2 : 1;
  if (h.ranged && src.mover?.moving && src.job !== "archer") m *= 0.8;
  switch (src.job) {
    case "battle_knight": { // 기사도: 같은 대상 3연타 뒤 +30%
      const c = src.chiv;
      if (c && c.tgt === tgt.id) {
        if (c.n >= 3) { m *= 1.3; c.n = 0; } else c.n++;
      } else src.chiv = { tgt: tgt.id, n: 1 };
      break;
    }
    case "gladiator": // 투기장의 함성: 근처(10칸) 적이 1명뿐이면 +15%
      if ([...w.around(src.x, src.y, 160, "m"), ...w.around(src.x, src.y, 160, "p")].filter((u) => foe(w, src, u)).length <= 1) m *= 1.15;
      break;
    case "lancer": // 간격 지배: 사거리 70% 바깥에서 맞히면 +20%
      if (h.reach && Math.hypot(tgt.x - src.x, tgt.y - src.y) - tgt.r >= h.reach * 0.7) m *= 1.2;
      break;
    case "cleric": // 성광: 어둠 속성 적 +25%
      if (tgt.el === "dark") m *= 1.25;
      break;
    case "hunter": // 사냥감 표식: 표식 대상 +10%
      if (has(tgt, "mark")) m *= 1.1;
      break;
    case "sniper": { // 집중: 쌓인 만큼 +10%씩, 맞히면 사라짐
      const e = find(src, "aim_focus");
      if (e) { m *= 1 + 0.1 * e.stacks; removeEffect(w, src, "aim_focus"); }
      break;
    }
  }
  return m;
}

/** 수호의 맹세: 근처(96px) 수호기사가 아군 피해의 15%를 대신 받고, 대신 받은 피해는 20% 줄임 */
function guardianShare(w: World, src: Unit, tgt: Unit, dmg: number): number {
  if (tgt.kind !== "p" || tgt.petOf || dmg < 2) return dmg;
  const g = w.around(tgt.x, tgt.y, 96, "p").find((u) => u !== tgt && u.job === "guardian" && !foe(w, u, tgt) && u !== src);
  if (!g) return dmg;
  const part = Math.round(dmg * 0.15);
  const taken = Math.max(1, Math.round(part * 0.8));
  w.ev.push(["h", src.id, g.id, taken, H_DOT, ""]);
  loseHp(w, src, g, taken);
  return dmg - part;
}

/** 원소 반응 (§12-3). 대상의 상태 + 들어온 속성 → 효과. 원소술사 「원소 조화」는 반응 피해 +25%. 반환: 이번 타격 피해 */
function react(w: World, src: Unit, tgt: Unit, el: ElementId, dmg: number): number {
  const r = REACTIONS.find((x) => x.b === el && has(tgt, x.a));
  if (!r) return dmg;
  const rm = src.job === "elementalist" ? 1.25 : 1;
  const others = () => w.around(tgt.x, tgt.y, 48, tgt.kind).filter((u) => u !== tgt && foe(w, src, u));
  switch (r.a + "+" + r.b) {
    case "wet+electric":
      removeEffect(w, tgt, "wet");
      addEffect(w, tgt, { id: "shock", ms: 300 }, src);
      for (const u of others()) {
        const d = Math.max(1, Math.round(dmg * 0.5 * rm));
        w.ev.push(["h", src.id, u.id, d, 0, "electric"]);
        w.damaged(src, u, d, 1);
        loseHp(w, src, u, d);
        addEffect(w, u, { id: "shock", ms: 300 }, src);
      }
      break;
    case "wet+ice":
      removeEffect(w, tgt, "wet");
      addEffect(w, tgt, { id: "freeze", ms: 1500 }, src);
      break;
    case "burn+wind": {
      const dot = (find(tgt, "burn")?.dot ?? dmg * 0.15) * rm;
      for (const u of others()) addEffect(w, u, { id: "burn", ms: 3000, dot }, src);
      break;
    }
    case "burn+ice":
      removeEffect(w, tgt, "burn");
      dmg = Math.round(dmg * (1 + 0.5 * rm));
      break;
    case "root+fire":
      for (const u of [tgt, ...others()]) addEffect(w, u, { id: "burn", ms: 3000, dot: Math.max(1, dmg * 0.15 * rm) }, src);
      break;
    case "poison+fire": {
      const e = find(tgt, "poison")!;
      dmg += Math.round(e.stacks * 0.2 * dmg * rm);
      removeEffect(w, tgt, "poison");
      break;
    }
    case "curse+light":
      if (w.now < (tgt.icd.get("eclipse") ?? 0)) return dmg;
      tgt.icd.set("eclipse", w.now + 5000);
      addEffect(w, tgt, { id: "stun", ms: 500 }, src);
      break;
  }
  w.ev.push(["rx", tgt.id, r.name]);
  return dmg;
}
