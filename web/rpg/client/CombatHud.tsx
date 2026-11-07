"use client";

import { useRef, useState } from "react";
import { expToNext } from "../shared/character";
import type { FullStats } from "../shared/combat";
import { effectDef, effectDesc } from "../shared/data/effects";
import { ELEMENTS, type ElementId } from "../shared/data/elements";
import { SKILLS, type Slot } from "../shared/data/skills";
import type { FxRow, You } from "../shared/protocol";
import { effectIcon, iconUrl, skillIcon, statIcon } from "./art/icons";
import type { HudState } from "./game";
import { t, type StrKey } from "./i18n";
import { keyLabel, type Settings } from "./settings";

/** 하단 전투 HUD (§23-1 · §23-2): 버프 줄 → 스킬 아이콘 → 체력 · 스태미나 바, 양옆 마나 · 기력 구슬, 마나 구슬 왼쪽 스탯창 */

const secs = (ms: number) => (ms >= 10_000 ? Math.ceil(ms / 1000) : (ms / 1000).toFixed(1));

function Orb({ cur, max, color, label }: { cur: number; max: number; color: string; label: string }) {
  return (
    <div className="rpg-orb pointer-events-auto" title={label}>
      <div className="rpg-orb-fill" style={{ height: `${Math.max(0, Math.min(1, cur / Math.max(1, max))) * 100}%`, background: color }} />
      <span className="rpg-orb-text">{Math.floor(cur)}/{Math.round(max)}</span>
    </div>
  );
}

function Bar({ cur, max, color, shield = 0, label, warn }: { cur: number; max: number; color: string; shield?: number; label: string; warn?: boolean }) {
  const pct = Math.max(0, Math.min(1, cur / Math.max(1, max))) * 100;
  const sh = Math.min(100 - pct, (shield / Math.max(1, max)) * 100);
  return (
    <div className={`rpg-bar w-[222px] ${warn ? "rpg-blink" : ""}`} title={label}>
      <div className="rpg-bar-lag" style={{ width: `${pct}%` }} />
      <div className="rpg-bar-fill" style={{ width: `${pct}%`, background: color }} />
      {sh > 0 && <div style={{ left: `${pct}%`, width: `${sh}%`, background: "rgba(255,255,255,0.55)" }} />}
      <span className="rpg-bar-text">{label} {Math.ceil(cur)}/{Math.round(max)}{shield > 0 ? ` (+${Math.round(shield)})` : ""}</span>
    </div>
  );
}

function SkillSlot({ slot, keyName, id, cd, element }: { slot: Slot; keyName: string; id?: string; cd?: [number, number, boolean]; element: ElementId }) {
  const sk = id ? SKILLS[id] : undefined;
  const bg = sk ? (sk.elementInherit ? ELEMENTS[element].color : sk.category === "magical" ? "#9B5DE5" : sk.heal ? "#4CC764" : "#9AA3AD") : "#6f7680";
  const [left, total, ok] = cd ?? [0, 1, true];
  const done = 1 - left / Math.max(1, total);
  return (
    <div className="group relative pointer-events-auto">
      <div className="rpg-slot">
        <img src={iconUrl(skillIcon(sk ? sk.icon : "lock", bg))} alt={sk?.name ?? t("hud.locked")} />
        {left > 0 && <div className="rpg-slot-cover" style={{ background: `conic-gradient(transparent ${done * 360}deg, rgba(10,6,16,0.72) 0)` }} />}
        {!ok && sk && <div className="rpg-slot-cover" style={{ background: "rgba(229,72,77,0.4)" }} />}
        {left > 0 && <span className="rpg-num inset-0 flex items-center justify-center text-[13px]">{secs(left)}</span>}
      </div>
      <div className="mt-0.5 text-center text-[10px] text-white/90 [text-shadow:0_1px_0_#1b1420]">{slot === "W" ? `W(${keyName})` : keyName}</div>
      <div className="rpg-tip rpg-panel">
        {sk ? (
          <>
            <b>{sk.name}</b> <span className="text-[#8c6642]">{slot === "W" ? "W" : slot}</span>
            <p className="mt-1">{sk.desc}</p>
            <p className="mt-1 text-[#8c6642]">
              {t("hud.cost")} {[sk.cost.mana && `${t("hud.mana")} ${sk.cost.mana}`, sk.cost.energy && `${t("hud.energy")} ${sk.cost.energy}`, sk.cost.stamina && `${t("hud.stamina")} ${sk.cost.stamina}`].filter(Boolean).join(" · ")}
              {" · "}{t("hud.cooldown", { s: sk.cooldownMs / 1000 })}{sk.castMs ? ` · ${t("hud.castTime", { s: sk.castMs / 1000 })}` : ""}
            </p>
          </>
        ) : (
          t("hud.locked")
        )}
      </div>
    </div>
  );
}

function FxIcon({ r }: { r: FxRow }) {
  const [id, left, stacks, dur, v] = r;
  const d = effectDef(id);
  const done = dur > 0 ? 1 - left / dur : 0;
  return (
    <div className="group relative pointer-events-auto">
      <div className={`relative h-8 w-8 ${dur > 0 && left < 3000 ? "rpg-blink" : ""}`}>
        <img src={iconUrl(effectIcon(id))} alt={d?.name} className="rpg-pixel h-8 w-8" />
        {dur > 0 && <div className="absolute inset-0" style={{ background: `conic-gradient(rgba(10,6,16,0.6) ${done * 360}deg, transparent 0)` }} />}
        {stacks > 1 && <span className="rpg-num bottom-0 right-0.5">{stacks}</span>}
      </div>
      <div className="rpg-tip rpg-panel !w-48">
        <b>{d?.name}</b>
        <p>{effectDesc(id, v)}</p>
        {dur > 0 && <p className="text-[#8c6642]">{t("hud.remain", { s: secs(left) })}</p>}
      </div>
    </div>
  );
}

/** 스탯창 행: [키, 글리프, 색, 값] (§6-1 색 · 아이콘) */
type Row = [StrKey, string, string, number | string];
function statRows(s: FullStats, mode: number): Row[] {
  const r = (n: number) => Math.round(n * 10) / 10;
  const p = (n: number) => `${Math.round(n * 100)}%`;
  const base: Row[] = [
    ["stat.hp", "heart", "#4CC764", r(s.hp)],
    ["stat.atk", "sword", "#E5484D", r(s.atk)],
    ["stat.ap", "star", "#9B5DE5", r(s.ap)],
    ["stat.pdef", "shield", "#9AA3AD", r(s.pdef)],
    ["stat.mdef", "rune", "#B39DDB", r(s.mdef)],
    ["stat.moveSpeed", "wing", "#3FC8E8", r(s.moveSpeed)],
  ];
  if (mode === 0) return base;
  if (mode === 2) {
    const el = Object.entries(s.elDef).filter(([, v]) => v > 0).map(([e, v]) => `${ELEMENTS[e as ElementId].name} ${r(v)}`).join(" · ") || "—";
    return [
      ["stat.crit", "star", "#F2C94C", p(s.crit)],
      ["stat.critDmg", "star", "#F2C94C", p(s.critDmg)],
      ["stat.pen", "crack", "#9AA3AD", `${p(s.penPhys)} / ${p(s.penMag)}`],
      ["stat.cdr", "clock", "#3FC8E8", p(s.cdr)],
      ["stat.tenacity", "fist", "#FF8A1F", p(s.tenacity)],
      ["stat.vamp", "drop", "#E5484D", `${p(s.lifesteal)} / ${p(s.spellVamp)}`],
      ["stat.elDef", "ring", "#F2F2F2", el],
    ];
  }
  return [
    base[0],
    ["stat.stamina", "foot", "#C9A27A", r(s.stamina)],
    ["stat.mana", "drop", "#2F7BFF", r(s.mana)],
    ["stat.energy", "flame", "#FF8A1F", r(s.energy)],
    base[1], base[2],
    ["stat.atkSpeed", "bolt", "#F5C542", r(s.atkSpeed)],
    base[5], base[3], base[4],
    ["stat.spirit", "lotus", "#FF7EB6", r(s.spirit)],
    ["stat.regen", "heartPlus", "#9BE15D", r(s.regen)],
    ["stat.endurance", "hourglass", "#8D6E63", r(s.endurance)],
    ["stat.potential", "seed", "#F2C94C", `${r(s.potentialPhys)} / ${r(s.potentialMag)}`],
    ["stat.luck", "clover", "#2ECC71", r(s.luck)],
  ];
}

function StatWindow({ stats, you }: { stats: FullStats; you: You }) {
  const [mode, setMode] = useState(0); // 0 접힘 · 1 펼침 · 2 상세
  const prev = useRef<Record<string, number | string>>({});
  const flash = useRef<Record<string, [string, number]>>({});
  const rows = statRows(stats, mode);
  const now = Date.now();
  for (const [k, , , v] of rows) {
    const old = prev.current[k];
    if (old !== undefined && old !== v && typeof v === "number" && typeof old === "number") flash.current[k] = [v > old ? "rpg-up" : "rpg-down", now];
    prev.current[k] = v;
  }
  const need = expToNext(you.level);
  return (
    <div className="rpg-panel pointer-events-auto absolute bottom-0 right-full mr-2 w-[176px] !rounded-xl px-2.5 py-2 text-[11px]">
      <div className="flex items-baseline justify-between">
        <b>Lv {you.level} · {t("hud.job")}</b>
      </div>
      <div className="mt-1 h-1.5 overflow-hidden rounded bg-[#3a2a1e]" title={`${t("hud.exp")} ${you.exp} / ${need}`}>
        <div className="h-full bg-[#F2C94C]" style={{ width: `${Math.min(100, (you.exp / need) * 100)}%` }} />
      </div>
      <ul className="mt-1.5 space-y-0.5">
        {rows.map(([k, g, c, v]) => {
          const f = flash.current[k];
          const cls = f && now - f[1] < 500 ? f[0] : "";
          return (
            <li key={k} className="flex items-center gap-1.5" title={t(k)}>
              <img src={iconUrl(statIcon(g, c))} alt="" className="rpg-pixel h-4 w-4" />
              <span className="flex-1 truncate text-[#6d513b]">{t(k)}</span>
              <span key={f?.[1]} className={cls}>{v}</span>
            </li>
          );
        })}
      </ul>
      <div className="mt-1.5 flex gap-1">
        <button className="rpg-btn !px-1.5 !py-0.5 !text-[10px]" onClick={() => setMode(mode === 0 ? 1 : 0)}>{mode === 0 ? t("hud.statsMore") : t("hud.statsLess")}</button>
        <button className="rpg-btn !px-1.5 !py-0.5 !text-[10px]" data-on={mode === 2} onClick={() => setMode(mode === 2 ? 1 : 2)}>{t("hud.statsDetail")}</button>
      </div>
    </div>
  );
}

export function CombatHud({ hud, stats, you, settings }: { hud: HudState; stats: FullStats; you: You; settings: Settings }) {
  const [hp, hpMax, mp, mpMax, en, enMax, shield] = hud.v;
  const fx = hud.exhausted ? [...hud.fx, ["exhaust", 0, 1, 0, 0] as FxRow] : hud.fx;
  const buffs = fx.filter((r) => effectDef(r[0])?.buff);
  const debuffs = fx.filter((r) => !effectDef(r[0])?.buff);
  const k = settings.keys;
  const keyOf: Record<Slot, string> = { A: "", Q: keyLabel(k.skillQ), W: keyLabel(k.skillW), E: keyLabel(k.skillE), R: `${keyLabel(k.skillR)}/${keyLabel(k.skillR2)}` };
  return (
    <div className="absolute bottom-3 left-1/2 flex -translate-x-1/2 flex-col items-center gap-1.5">
      {hud.hint && <div className="rpg-chip">[{keyLabel(k.interact)}] {hud.hint}</div>}
      <div className="flex w-[400px] justify-between">
        <div className="flex flex-wrap gap-1">{buffs.map((r) => <FxIcon key={r[0] + r[3]} r={r} />)}</div>
        <div className="flex flex-row-reverse flex-wrap gap-1">{debuffs.map((r) => <FxIcon key={r[0] + r[3]} r={r} />)}</div>
      </div>
      <div className="relative flex items-end gap-2.5">
        <StatWindow stats={stats} you={you} />
        <Orb cur={mp} max={mpMax} color="#2F7BFF" label={t("hud.mana")} />
        <div className="flex flex-col items-center gap-1">
          <div className="flex gap-1.5">
            {(["Q", "W", "E", "R"] as Slot[]).map((s) => <SkillSlot key={s} slot={s} keyName={keyOf[s]} id={you.slots[s]} cd={hud.cds[s]} element={you.element as ElementId} />)}
          </div>
          <Bar cur={hp} max={hpMax} color="#4CC764" shield={shield} label={t("hud.hp")} />
          <Bar cur={hud.stamina} max={hud.staminaMax} color={hud.exhausted ? "#E5484D" : "#C9A27A"} label={t("hud.stamina")} warn={hud.exhausted} />
        </div>
        <Orb cur={en} max={enMax} color="#FF8A1F" label={t("hud.energy")} />
      </div>
    </div>
  );
}

export function DeathOverlay({ ms }: { ms: number }) {
  return (
    <div className="absolute inset-0 flex items-center justify-center bg-[rgba(27,20,32,0.45)]">
      <div className="rpg-panel px-8 py-5 text-center">
        <p className="text-lg font-bold">{t("hud.dead")}</p>
        <p className="mt-1 text-[12px]">{t("hud.respawn", { s: Math.ceil(ms / 1000) })}</p>
        <p className="mt-1 text-[11px] text-[#8c6642]">{t("hud.deathNote")}</p>
      </div>
    </div>
  );
}
