import type { Stats } from "../../../web/rpg/shared/character.ts";
import { computeDamage, finalStats, healAmount, hpRegen, mentalResist, resRegen, type FullStats, type Hit, type Mod } from "../../../web/rpg/shared/combat.ts";
import { effectDef } from "../../../web/rpg/shared/data/effects.ts";
import { ELEMENTS, ELEMENT_PROC, type ElementId } from "../../../web/rpg/shared/data/elements.ts";
import { COMBAT } from "../../../web/rpg/shared/data/stats.ts";
import type { Mover } from "../../../web/rpg/shared/movement.ts";
import { H_CRIT, H_DOT, H_HEAL, H_IMMUNE, H_MISS, H_RESIST, type Ev, type FxRow } from "../../../web/rpg/shared/protocol.ts";

/**
 * 전투 유닛(플레이어 · 몹) 공통 — 상태효과 엔진(§11-3) · 피해 적용(§13-1) · 회복(§6-3).
 * 시간은 전부 방의 틱 시각(w.now, ms)을 씁니다 — 테스트가 시간을 직접 넘길 수 있게.
 */

let rng = Math.random;
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
  /** 플레이어만 */
  mover?: Mover;
};

/** 방이 제공하는 것 */
export interface World {
  now: number;
  ev: Ev[];
  unit(id: number): Unit | undefined;
  /** 피해 뒤 처리 (몹 위협 수치) */
  damaged(src: Unit, tgt: Unit, amount: number, threat: number): void;
  killed(u: Unit, by: Unit | undefined): void;
  /** 넉백 등 강제 이동 (벽 충돌 포함) */
  push(u: Unit, dx: number, dy: number): void;
}

export function makeUnit(o: { id: number; kind: "p" | "m"; name: string; el: ElementId; lv: number; x: number; y: number; r: number; base: Stats; mover?: Mover }): Unit {
  const u: Unit = {
    ...o, hp: 0, mp: 0, en: 0, st: finalStats(o.base, []), fx: [], dr: new Map(), ccImmune: 0, combat: -1e9,
    dead: false, evade: false, block: { move: false, atk: false, skill: false }, fxDirty: false, statsDirty: true,
  };
  recalc(u);
  u.hp = u.st.hp;
  u.mp = u.st.mana;
  u.en = u.st.energy;
  return u;
}

/** 기본 스탯 · 속성 패시브 · 효과를 합쳐 최종 스탯과 행동 제한을 다시 계산 */
export function recalc(u: Unit) {
  const mods: Mod[] = u.kind === "p" ? [...ELEMENTS[u.el].mods] : [];
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
  return true;
}

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
  tgt.hp -= absorb(w, tgt, dmg);
  tgt.combat = w.now;
  if (src) src.combat = w.now;
  if (has(tgt, "sleep")) removeEffect(w, tgt, "sleep");
  if (tgt.hp <= 0) die(w, tgt, src);
}

export function die(w: World, u: Unit, by: Unit | undefined) {
  if (u.dead) return;
  u.dead = true;
  u.hp = 0;
  u.fx = [];
  u.fxDirty = true;
  recalc(u);
  w.ev.push(["d", u.id]);
  w.killed(u, by);
}

export type HitSpec = Hit & { threat: number; proc?: boolean; fx?: FxSpec[]; basic?: boolean };

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
  const crit = rand() < src.st.crit;
  const proc = h.proc && h.el ? ELEMENT_PROC[h.el] : undefined;
  let dmg = computeDamage(src.st, tgt.st, { ...h, power: (h.power ?? 0) + (proc?.power ?? 0) }, tgt.el, crit);
  if (h.cat !== "magical" && has(tgt, "freeze")) {
    dmg = Math.round(dmg * 1.3);
    removeEffect(w, tgt, "freeze");
  }
  if (h.el === "electric" && has(tgt, "wet")) dmg = Math.round(dmg * 1.3);
  w.ev.push(["h", src.id, tgt.id, dmg, crit ? H_CRIT : 0, h.el ?? ""]);
  loseHp(w, src, tgt, dmg);
  const vamp = h.cat === "magical" ? src.st.spellVamp : src.st.lifesteal;
  if (vamp > 0) applyHeal(w, src, src, dmg * vamp, false);
  w.damaged(src, tgt, dmg, h.threat);
  if (tgt.dead) return dmg;

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
  loseHp(w, src, tgt, dmg);
  if (src && !tgt.dead) w.damaged(src, tgt, dmg, 1);
}

/** 치유. computed = 이미 healAmount 를 거친 값(지속 회복 틱) */
export function applyHeal(w: World, src: Unit, tgt: Unit, amount: number, computed: boolean) {
  if (tgt.dead || amount <= 0) return;
  const v = Math.round(computed ? amount : amount * (1 + tgt.st.healTaken));
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
  u.fx.map((e) => [e.id, Math.max(0, Math.round(e.until - w.now)), e.stacks, Math.round(e.dur), Math.round(e.v * 100) / 100]);
