import type { ElementId } from "../../../web/rpg/shared/data/elements.ts";
import { ELEMENTS } from "../../../web/rpg/shared/data/elements.ts";
import { basicOf } from "../../../web/rpg/shared/data/items.ts";
import { JOBS, JOB_LV, JOB_POTENTIAL, JOB_POT_SHIFT, LINES, jobStats, type LineId } from "../../../web/rpg/shared/data/jobs.ts";
import { GRADES } from "../../../web/rpg/shared/data/mobs.ts";
import { APPRENTICE_SLOTS, SKILLS, canLearn, type Slot } from "../../../web/rpg/shared/data/skills.ts";
import { MASTERY_MOB, POT_GAIN, addMastery, autoLearn, potOf, slotsOf, startLevel, type Learned, type Progress, type SkillGrade } from "../../../web/rpg/shared/progress.ts";
import type { S2C } from "../../../web/rpg/shared/protocol.ts";
import { recalc } from "./combat.ts";
import { loadSkills, saveJob, saveProgress, saveSkill, type CharacterRow } from "./db.ts";
import { expToNext } from "../../../web/rpg/shared/character.ts";
import { quest } from "./quests.ts";
import type { Player } from "./room.ts";

/**
 * 성장 (§7 · §9 · §10-3): 전직 · 스킬 습득 · 숙련도 · 스킬 레벨 · 잠재력.
 * 숙련도는 자주 바뀌므로 메모리에 쌓고 30초 저장 · 접속 종료 때 저장, 레벨업 · 습득 · 장착 · 전직은 바로 저장.
 */

export function loadProgress(c: CharacterRow): Progress {
  return {
    line: (c.job_tier1 as LineId) || null, job: c.job_tier2 || null, sub: (c.job_sub as ElementId) || null,
    pot: [c.potential_phys ?? 10, c.potential_mag ?? 10], skills: loadSkills(c.id),
  };
}

/** 레벨 · 계열 · 잠재력 → 기본 스탯 */
export const charBase = (p: Player) => jobStats(p.char.level, p.prog.line, p.prog.pot, p.prog.job);

const send = (p: Player, m: S2C) => p.ws.readyState === 1 && p.ws.send(JSON.stringify(m));
export const learnedOf = (p: Player, id: string) => p.prog.skills.find((l) => l.id === id);

/** 슬롯 · 직업을 다시 맞춤 (평타 A 는 무기) */
export function refreshSlots(p: Player) {
  p.slots = slotsOf(p.prog, basicOf(p.items));
  p.job = p.prog.job;
}

export function sendProg(p: Player) {
  p.progDirty = false;
  send(p, { t: "prog", prog: p.prog, slots: p.slots });
}

/** 스킬 습득 (§10-3): 시작 레벨 = 1 + 잠재력/40, 습득하면 그 계열 잠재력 + 난이도. 빈 슬롯이면 바로 장착 */
export function learn(p: Player, id: string, grade: SkillGrade): Learned {
  const sk = SKILLS[id];
  const l: Learned = { id, grade, lv: startLevel(potOf(sk, p.prog.pot), p.char.level), mastery: 0, slot: null };
  const gain = POT_GAIN[sk.difficulty];
  if (sk.category === "hybrid") { p.prog.pot[0] += gain / 2; p.prog.pot[1] += gain / 2; }
  else p.prog.pot[sk.category === "physical" ? 0 : 1] += gain;
  if (!p.prog.skills.some((x) => x.slot === sk.slot)) l.slot = sk.slot;
  p.prog.skills.push(l);
  saveSkill(p.char.id, l);
  saveJob(p.char.id, p.prog.line, p.prog.job, p.prog.sub, p.prog.pot);
  p.out.push(["sk", id, l.lv, "learn"]);
  p.progDirty = true;
  return l;
}

/** 레벨업 · 전직 뒤: 자동 습득 + 쌓아 둔 숙련도로 스킬 레벨업 (스킬 레벨 ≤ 플레이어 레벨) */
export function syncSkills(p: Player) {
  for (const sk of autoLearn(p.prog, p.char.level)) learn(p, sk.id, "low");
  // 견습 기본 슬롯 (P3 이전 캐릭터)
  for (const [slot, id] of Object.entries(APPRENTICE_SLOTS)) {
    const l = learnedOf(p, id);
    if (l && !l.slot && !p.prog.skills.some((x) => x.slot === slot)) { l.slot = slot as Slot; saveSkill(p.char.id, l); }
  }
  for (const l of p.prog.skills) {
    if (addMastery(l, 0, p.char.level)) {
      saveSkill(p.char.id, l);
      p.out.push(["sk", l.id, l.lv, "lv"]);
      p.progDirty = true;
    }
  }
  refreshSlots(p);
}

/** 숙련도 (§10-3): × 몹 등급 배율 × (1 + 계열 잠재력 / 100). 레벨이 오르면 바로 저장 */
export function gainMastery(p: Player, id: string, base: number, mobGrade?: string) {
  const l = learnedOf(p, id);
  const sk = SKILLS[id];
  if (!l || !sk) return;
  const gi = mobGrade ? Math.max(0, Object.keys(GRADES).indexOf(mobGrade)) : 0;
  const up = addMastery(l, base * MASTERY_MOB[gi] * (1 + potOf(sk, p.prog.pot) / 100), p.char.level);
  p.progDirty = true;
  p.skillsDirty.add(id);
  if (up) {
    saveSkill(p.char.id, l);
    p.skillsDirty.delete(id);
    p.out.push(["sk", id, l.lv, "lv"]);
  }
}

export function saveDirtySkills(p: Player) {
  for (const id of p.skillsDirty) {
    const l = learnedOf(p, id);
    if (l) saveSkill(p.char.id, l);
  }
  p.skillsDirty.clear();
}

/** 레벨 지정 (개발용 dev · GM /gm level): 경험치는 그 레벨 안으로, 스탯 · 스킬 다시 맞추고 완전 회복 */
export function setLevel(p: Player, lv: number) {
  const c = p.char;
  c.level = Math.max(1, Math.min(40, Math.round(lv) || 1));
  c.exp = Math.min(c.exp, expToNext(c.level) - 1);
  saveProgress(c.id, c.level, c.exp);
  p.lv = c.level;
  p.base = charBase(p);
  syncSkills(p);
  recalc(p);
  p.hp = p.st.hp;
  p.mp = p.st.mana;
  p.en = p.st.energy;
  p.room?.ev.push(["lv", p.id, c.level]);
  p.out.push(["xp", 0, c.exp, c.level]);
  sendProg(p);
}

/** 전직 (§9-1). 1차 = 계열(Lv10), 2차 = 그 계열의 세부 직업(Lv30). 마법형 · 혼합형은 잠재력 일부를 마법으로 (D80). 성공하면 null */
export function changeJob(p: Player, m: { line?: unknown; job?: unknown; sub?: unknown }): string | null {
  const pr = p.prog;
  if (typeof m.line === "string") {
    if (!Object.hasOwn(LINES, m.line)) return "없는 계열입니다";
    if (pr.line) return "이미 1차 전직을 했습니다";
    if (p.char.level < JOB_LV.tier1) return `1차 전직은 Lv${JOB_LV.tier1} 부터입니다`;
    pr.line = m.line as LineId;
    pr.pot[LINES[pr.line].pot === "phys" ? 0 : 1] += JOB_POTENTIAL;
  } else if (typeof m.job === "string") {
    const j = Object.hasOwn(JOBS, m.job) ? JOBS[m.job] : undefined;
    if (!j) return "없는 직업입니다";
    if (!pr.line || j.line !== pr.line) return "그 계열의 직업이 아닙니다";
    if (pr.job) return "이미 2차 전직을 했습니다";
    if (p.char.level < JOB_LV.tier2) return `2차 전직은 Lv${JOB_LV.tier2} 부터입니다`;
    if (m.job === "elementalist") {
      if (typeof m.sub !== "string" || !Object.hasOwn(ELEMENTS, m.sub) || m.sub === p.el || m.sub === "none") return "주 속성과 다른 보조 속성을 골라 주세요";
      pr.sub = m.sub as ElementId;
    }
    pr.job = m.job;
    if (j.kind) {
      const k = Math.min(JOB_POT_SHIFT[j.kind], pr.pot[0]);
      pr.pot[0] -= k;
      pr.pot[1] += k;
    }
  } else return "잘못된 요청입니다";
  saveJob(p.char.id, pr.line, pr.job, pr.sub, pr.pot);
  // 전직으로 새로 배운 스킬은 자기 슬롯에 바로 끼움 (슬롯마다 하나, 바꾸려면 K)
  const before = new Set(pr.skills.map((l) => l.id));
  syncSkills(p);
  for (const l of pr.skills) {
    const slot = SKILLS[l.id].slot;
    if (before.has(l.id) || l.slot || pr.skills.some((o) => o.slot === slot && !before.has(o.id))) continue;
    for (const o of pr.skills) if (o.slot === slot) { o.slot = null; saveSkill(p.char.id, o); }
    l.slot = slot;
    saveSkill(p.char.id, l);
  }
  refreshSlots(p);
  p.base = charBase(p);
  recalc(p);
  p.hp = p.st.hp;
  p.mp = p.st.mana;
  p.en = p.st.energy;
  p.room?.ev.push(["job", p.id, pr.line ?? "", pr.job ?? ""]);
  sendProg(p);
  return null;
}

/** 슬롯 장착 · 해제 (§10-1): 비전투 상태에서만, 스킬은 자기 슬롯(Q · W · E · R)에만 */
export function equip(p: Player, skill: unknown, slot: unknown): string | null {
  const l = typeof skill === "string" ? learnedOf(p, skill) : undefined;
  if (!l) return "배우지 않은 스킬입니다";
  const sk = SKILLS[l.id];
  if (slot !== null && slot !== sk.slot) return "그 슬롯에는 넣을 수 없습니다";
  if (p.room && p.room.now - p.combat < 5000) return "전투 중에는 슬롯을 바꿀 수 없습니다";
  if (p.mover.lock > 0 || p.mover.mv > 0) return "다른 동작 중입니다";
  if (slot) for (const o of p.prog.skills) if (o.slot === slot && o !== l) { o.slot = null; saveSkill(p.char.id, o); }
  l.slot = slot as Slot | null;
  saveSkill(p.char.id, l);
  refreshSlots(p);
  sendProg(p);
  quest(p, "equip");
  return null;
}

const GRADE_ORDER: SkillGrade[] = ["low", "mid", "high", "trans"];

/** 스킬북을 읽을 수 없는 이유 (없으면 null) */
export function bookError(p: Player, id: string, grade: SkillGrade): string | null {
  const sk = SKILLS[id];
  if (!sk || !canLearn(sk, p.prog.line, p.prog.job)) return "지금 직업으로는 배울 수 없는 스킬입니다";
  const l = learnedOf(p, id);
  if (l && GRADE_ORDER.indexOf(grade) <= GRADE_ORDER.indexOf(l.grade)) return "이미 같거나 높은 등급으로 배운 스킬입니다";
  return null;
}

/** 스킬북 (§10-3 · §10-4): 안 배웠으면 배움, 배웠으면 등급을 올림 (숙련도 유지) */
export function readBook(p: Player, id: string, grade: SkillGrade): string | null {
  const err = bookError(p, id, grade);
  if (err) return err;
  const l = learnedOf(p, id);
  if (!l) learn(p, id, grade);
  else {
    l.grade = grade;
    saveSkill(p.char.id, l);
    p.out.push(["sk", id, l.lv, "grade"]);
  }
  refreshSlots(p);
  sendProg(p);
  return null;
}
