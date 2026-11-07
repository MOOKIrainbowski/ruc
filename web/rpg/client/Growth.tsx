"use client";

import { useState } from "react";
import { ELEMENTS, ELEMENT_IDS, type ElementId } from "../shared/data/elements";
import { JOBS, JOB_LV, LINES, LINE_IDS, STAT_GRADE, jobName, type LineId } from "../shared/data/jobs";
import { SKILLS, canLearn, type SkillDef, type Slot } from "../shared/data/skills";
import { GRADE, needMastery, skillNums, type Learned } from "../shared/progress";
import type { C2S, You } from "../shared/protocol";
import { iconUrl, skillIcon } from "./art/icons";
import { t, type StrKey } from "./i18n";

/** 스킬창(K) · 직업 교관 창 (§9 · §10). 조작은 서버로 — 서버가 prog 를 다시 보내면 그립니다. */

/** 스킬 아이콘 배경: 주 속성 · 고정 속성 · 보조 속성 색, 아니면 계열 색 (견습 공통은 범주 색) */
export function skillBg(sk: SkillDef, you: You): string {
  if (sk.elementInherit) return ELEMENTS[you.element as ElementId].color;
  if (sk.el) return ELEMENTS[sk.el].color;
  if (sk.sub && you.prog.sub) return ELEMENTS[you.prog.sub].color;
  const line = sk.job.find((j) => j in LINES) ?? (JOBS[sk.job[0]]?.line as string | undefined);
  if (line) return LINES[line as LineId].color;
  return sk.category === "magical" ? "#9B5DE5" : sk.heal ? "#4CC764" : "#9AA3AD";
}

/** 스킬 설명 줄: 소모 · 쿨 · 시전 · 사거리 · 위력 (등급 · 레벨 반영) */
export function SkillInfo({ sk, l }: { sk: SkillDef; l?: Learned }) {
  const n = skillNums(sk, l, 0);
  const cost = [n.cost.mana && `${t("hud.mana")} ${n.cost.mana}`, n.cost.energy && `${t("hud.energy")} ${n.cost.energy}`, n.cost.stamina && `${t("hud.stamina")} ${n.cost.stamina}`].filter(Boolean).join(" · ");
  return (
    <>
      <p className="mt-1">{sk.desc}</p>
      <p className="mt-1 text-[#8c6642]">
        {cost && `${t("hud.cost")} ${cost} · `}{t("hud.cooldown", { s: Math.round(n.cooldownMs / 100) / 10 })}
        {sk.castMs ? ` · ${t("hud.castTime", { s: sk.castMs / 1000 })}` : ""}
        {n.range ? ` · ${t("sk.range", { r: Math.round(n.range) })}` : ""}
        {l ? ` · ${t("sk.power", { p: Math.round(n.power * 100) / 100 })}` : ""}
      </p>
    </>
  );
}

function SkillRow({ sk, l, you, locked, send }: { sk: SkillDef; l?: Learned; you: You; locked?: string; send: (m: C2S) => void }) {
  const need = l ? needMastery(l.lv) : 1;
  const capped = !!l && l.lv >= you.level && l.mastery >= need;
  return (
    <div className="group relative flex items-center gap-2 rounded px-1.5 py-1 hover:bg-[#e8d3a9]" style={{ opacity: locked ? 0.55 : 1 }}>
      <img src={iconUrl(skillIcon(locked ? "lock" : sk.icon, skillBg(sk, you)))} alt="" className="rpg-pixel h-8 w-8" />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-1.5">
          <b className="truncate">{sk.name}</b>
          {l && <span className="text-[10px] text-[#8c6642]">Lv{l.lv} · {GRADE[l.grade].name}</span>}
          {locked && <span className="text-[10px] text-[#8c6642]">{locked}</span>}
        </div>
        {l && (
          <div className="mt-0.5 h-1.5 overflow-hidden rounded bg-[#3a2a1e]" title={capped ? t("sk.maxed") : t("sk.mastery", { m: Math.floor(l.mastery), n: need })}>
            <div className="h-full" style={{ width: `${Math.min(100, (l.mastery / need) * 100)}%`, background: capped ? "#E5484D" : "#9be564" }} />
          </div>
        )}
      </div>
      {l && (l.slot ? (
        <button className="rpg-btn !px-2 !py-0.5 !text-[10px]" data-on onClick={() => send({ t: "equip", skill: l.id, slot: null })}>{t("sk.equipped")}</button>
      ) : (
        <button className="rpg-btn !px-2 !py-0.5 !text-[10px]" onClick={() => send({ t: "equip", skill: l.id, slot: sk.slot })}>{t("sk.equip")}</button>
      ))}
      <div className="rpg-tip rpg-panel !left-auto !right-0 !translate-x-0">
        <b>{sk.name}</b> <span className="text-[#8c6642]">{sk.slot === "W" ? "W(C)" : sk.slot}</span>
        <SkillInfo sk={sk} l={l} />
        {l && <p className="text-[#8c6642]">{capped ? t("sk.maxed") : t("sk.mastery", { m: Math.floor(l.mastery), n: need })}</p>}
      </div>
    </div>
  );
}

export function SkillWindow({ you, send, onClose }: { you: You; send: (m: C2S) => void; onClose: () => void }) {
  const { prog } = you;
  const job = prog.job ? JOBS[prog.job] : null;
  // 이 직업이 배울 수 있는데 아직 못 배운 스킬 (레벨 · 2차 전직 조건)
  const future = Object.values(SKILLS).filter((sk) => !sk.hidden && sk.slot !== "A" && !prog.skills.some((l) => l.id === sk.id) &&
    (canLearn(sk, prog.line, prog.job) || (prog.line && !prog.job && sk.job.some((j) => JOBS[j]?.line === prog.line && JOBS[j].star))));
  return (
    <div className="rpg-modal-bg">
      <div className="rpg-panel relative w-[560px] max-w-[96vw] p-4 text-[12px]">
        <button className="rpg-x" onClick={onClose} aria-label={t("hud.close")}>✕</button>
        <h2 className="text-base font-bold">{t("sk.title")}</h2>
        <p className="mt-0.5 text-[#8c6642]">
          {t("sk.job")}: <b className="text-[#3a2a1e]">{jobName(prog.line, null)}{job ? ` → ${job.name}` : ""}</b>
          {prog.sub ? ` · 보조 속성 ${ELEMENTS[prog.sub].name}` : ""} · {t("sk.potential", { p: Math.round(prog.pot[0]), m: Math.round(prog.pot[1]) })}
        </p>
        {job && (
          <div className="mt-2 rounded bg-[#e8d3a9] px-2 py-1.5">
            <b>{t("sk.passive")} · {job.passive.name}</b>
            <p>{job.passive.desc}</p>
          </div>
        )}
        <div className="mt-2 max-h-[56vh] space-y-2 overflow-y-auto pr-1">
          {(["Q", "W", "E", "R"] as Slot[]).map((slot) => {
            const learned = prog.skills.filter((l) => SKILLS[l.id]?.slot === slot);
            const later = future.filter((sk) => sk.slot === slot);
            return (
              <section key={slot}>
                <h3 className="mb-0.5 font-bold text-[#8c6642]">{slot === "W" ? "W (C)" : slot === "R" ? "R / X" : slot}</h3>
                {learned.map((l) => <SkillRow key={l.id} sk={SKILLS[l.id]} l={l} you={you} send={send} />)}
                {later.map((sk) => {
                  const forJob = sk.job.find((j) => JOBS[j]);
                  const lock = forJob && !prog.job ? t("sk.lockedJob", { job: JOBS[forJob].name }) : t("sk.locked", { lv: sk.learnLv ?? JOB_LV.tier1 });
                  return <SkillRow key={sk.id} sk={sk} you={you} locked={lock} send={send} />;
                })}
                {!learned.length && !later.length && <p className="px-1.5 text-[#9e917c]">{t("sk.none")}</p>}
              </section>
            );
          })}
        </div>
        <p className="mt-2 text-[10px] text-[#8c6642]">{t("sk.help")}</p>
      </div>
    </div>
  );
}

const GRADE_KEYS = ["hp", "stamina", "def", "atk", "ap", "atkSpeed", "moveSpeed", "spirit"] as const;
const gradeColor = (g: keyof typeof STAT_GRADE) => ({ S: "#E5484D", A: "#FF8A1F", B: "#3a2a1e", C: "#8c6642", D: "#9e917c" })[g];

/** 직업 교관 세라 (§9-1): 1차 = 계열, 2차 = 세부 직업 (원소술사는 보조 속성) */
export function JobDialog({ you, send, onClose }: { you: You; send: (m: C2S) => void; onClose: () => void }) {
  const { prog } = you;
  const [pick, setPick] = useState<string | null>(null);
  const [sub, setSub] = useState<ElementId | null>(null);
  const tier = !prog.line ? 1 : !prog.job ? 2 : 0;
  const need = tier === 1 ? JOB_LV.tier1 : JOB_LV.tier2;
  const lineCard = (id: LineId) => {
    const l = LINES[id];
    return (
      <button key={id} className="rpg-panel !rounded-lg p-2 text-left !shadow-none" style={{ outline: valid === id ? `3px solid ${l.color}` : undefined }} onClick={() => setPick(id)}>
        <div className="flex items-center gap-1.5">
          <img src={iconUrl(skillIcon(l.icon, l.color))} alt="" className="rpg-pixel h-6 w-6" />
          <b>{l.name}</b>
        </div>
        <p className="mt-0.5 text-[11px]">{l.role}</p>
        <div className="mt-1 grid grid-cols-4 gap-x-1 text-[10px]">
          {GRADE_KEYS.map((k) => <span key={k}>{t(`job.stat.${k}` as StrKey)} <b style={{ color: gradeColor(l.g[k]) }}>{l.g[k]}</b></span>)}
        </div>
        <p className="mt-1 text-[10px] text-[#8c6642]">{t("job.res")} {l.res === "mana" ? t("hud.mana") : t("hud.energy")} · {t("job.reach")} {l.reach}</p>
      </button>
    );
  };
  const jobs = prog.line ? Object.entries(JOBS).filter(([, j]) => j.line === prog.line) : [];
  // 전직에 성공하면 같은 창이 다음 단계로 바뀌므로 지난 단계의 선택은 버림
  const valid = pick && (tier === 1 ? pick in LINES : pick in JOBS) ? pick : null;
  const ok = valid && (tier === 1 || valid !== "elementalist" || sub);
  const name = valid ? (tier === 1 ? LINES[valid as LineId].name : JOBS[valid].name) : "";
  return (
    <div className="rpg-modal-bg">
      <div className="rpg-panel relative w-[640px] max-w-[96vw] p-4 text-[12px]">
        <button className="rpg-x" onClick={onClose} aria-label={t("hud.close")}>✕</button>
        <h2 className="text-base font-bold">{t("job.title")}</h2>
        {tier === 0 ? (
          <p className="mt-2">{t("job.done", { job: jobName(prog.line, prog.job) })}</p>
        ) : you.level < need ? (
          <>
            <p className="mt-2">{tier === 1 ? t("job.lead1") : t("job.lead2", { line: LINES[prog.line!].name })}</p>
            <p className="mt-1 font-bold">{t("job.notYet", { lv: you.level, need })}</p>
            {tier === 2 && <ul className="mt-2 space-y-1">{jobs.map(([id, j]) => <li key={id}><b>{j.star ? "★ " : ""}{j.name}</b> — {j.concept} · <i>{j.passive.name}</i></li>)}</ul>}
          </>
        ) : (
          <>
            <p className="mt-1 font-bold">{tier === 1 ? t("job.pickLine") : t("job.pickJob")}</p>
            {tier === 1 ? (
              <div className="mt-2 grid grid-cols-3 gap-2">{LINE_IDS.map(lineCard)}</div>
            ) : (
              <div className="mt-2 grid grid-cols-2 gap-2">
                {jobs.map(([id, j]) => (
                  <button key={id} disabled={!j.star} className="rpg-panel !rounded-lg p-2 text-left !shadow-none disabled:opacity-50" style={{ outline: valid === id ? `3px solid ${LINES[j.line].color}` : undefined }} onClick={() => setPick(id)}>
                    <b>{j.star ? "★ " : ""}{j.name}</b> {!j.star && <span className="text-[10px] text-[#8c6642]">({t("job.soon")})</span>}
                    <p className="text-[11px]">{j.concept}</p>
                    <p className="mt-0.5 text-[10px] text-[#8c6642]">{t("sk.passive")} · <b>{j.passive.name}</b>: {j.passive.desc}</p>
                  </button>
                ))}
              </div>
            )}
            {valid === "elementalist" && (
              <div className="mt-2">
                <b>{t("job.sub")}</b>
                <div className="mt-1 flex flex-wrap gap-1">
                  {ELEMENT_IDS.filter((e) => e !== you.element && e !== "none").map((e) => (
                    <button key={e} className="rpg-btn !px-2 !py-0.5 !text-[11px]" data-on={sub === e} onClick={() => setSub(e)} style={{ color: ELEMENTS[e].color }}>{ELEMENTS[e].name}</button>
                  ))}
                </div>
              </div>
            )}
            <div className="mt-3 flex justify-end">
              <button className="rpg-btn" disabled={!ok} onClick={() => send(tier === 1 ? { t: "job", line: valid as LineId } : { t: "job", job: valid!, sub: sub ?? undefined })}>
                {ok ? t("job.confirm", { name }) : "…"}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
