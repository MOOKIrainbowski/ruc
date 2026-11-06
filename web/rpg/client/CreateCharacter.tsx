"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { CHAR_H, CHAR_W } from "../shared/constants";
import { EYES, HAIR_COLORS, HAIR_STYLES, SKINS, type Appearance } from "../shared/data/appearance";
import { ELEMENTS, ELEMENT_IDS, type ElementId } from "../shared/data/elements";
import { FRAMES, characterSheet } from "./art/character";
import { t } from "./i18n";

/** 캐릭터 생성 (§8-1): 닉네임 · 외형 · 주 속성 */
export default function CreateCharacter({ defaultName, error, onSubmit }: { defaultName: string; error: string; onSubmit: (nickname: string, ap: Appearance, el: ElementId) => void }) {
  const [name, setName] = useState(defaultName.length >= 2 ? defaultName : "");
  const [ap, setAp] = useState<Appearance>({ hair: 0, hairColor: 0, skin: 0, eyes: 0 });
  const [el, setEl] = useState<ElementId>("fire");
  const [dir, setDir] = useState(0);
  const sheet = useMemo(() => (typeof document === "undefined" ? null : characterSheet(ap)), [ap]);
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    let f = 0;
    const draw = () => {
      const ctx = ref.current?.getContext("2d");
      if (!ctx || !sheet) return;
      ctx.imageSmoothingEnabled = false;
      ctx.clearRect(0, 0, CHAR_W * 3, CHAR_H * 3);
      ctx.drawImage(sheet, (FRAMES + (f++ % FRAMES)) * CHAR_W, dir * CHAR_H, CHAR_W, CHAR_H, 0, 0, CHAR_W * 3, CHAR_H * 3);
    };
    draw();
    const id = setInterval(draw, 125);
    return () => clearInterval(id);
  }, [sheet, dir]);

  const pick = (k: keyof Appearance, n: number, colors?: string[]) => (
    <div className="flex flex-wrap gap-1.5">
      {Array.from({ length: n }, (_, i) => (
        <button
          key={i}
          type="button"
          className="rpg-btn !px-2 !py-1"
          data-on={ap[k] === i}
          style={colors ? { background: colors[i], width: 28, height: 24 } : undefined}
          onClick={() => setAp({ ...ap, [k]: i })}
          aria-label={`${k} ${i + 1}`}
        >
          {colors ? "" : k === "hair" ? HAIR_STYLES[i] : i + 1}
        </button>
      ))}
    </div>
  );

  return (
    <div className="rpg-modal-bg">
      <form
        className="rpg-panel relative w-[760px] max-w-[96vw] p-6"
        onSubmit={(e) => { e.preventDefault(); onSubmit(name.trim(), ap, el); }}
      >
        <h2 className="text-xl font-bold">{t("create.title")}</h2>
        <p className="mt-1 text-[12px] text-[#6d513b]">{t("create.lead")}</p>
        <div className="mt-5 flex gap-6">
          <div className="flex flex-col items-center gap-2">
            <canvas ref={ref} width={CHAR_W * 3} height={CHAR_H * 3} className="rpg-pixel rounded bg-[#8CC63F]" />
            <button type="button" className="rpg-btn" onClick={() => setDir((dir + 1) % 8)}>{t("create.turn")} ↻</button>
          </div>
          <div className="flex-1 space-y-3 text-[12px]">
            <label className="block">
              {t("create.nickname")}
              <input className="rpg-input mt-1 block w-60" value={name} maxLength={12} onChange={(e) => setName(e.target.value)} autoFocus />
            </label>
            <div>{t("create.hair")}{pick("hair", HAIR_STYLES.length)}</div>
            <div>{t("create.hairColor")}{pick("hairColor", HAIR_COLORS.length, HAIR_COLORS.map((c) => c[1]))}</div>
            <div className="flex gap-6">
              <div>{t("create.skin")}{pick("skin", SKINS.length, SKINS.map((c) => c[1]))}</div>
              <div>{t("create.eyes")}{pick("eyes", EYES.length, EYES)}</div>
            </div>
          </div>
        </div>
        <div className="mt-4 text-[12px]">
          {t("create.element")} <span className="text-[#8c6642]">— {t("create.elementNote")}</span>
          <div className="mt-1.5 grid grid-cols-6 gap-1.5">
            {ELEMENT_IDS.map((id) => (
              <button key={id} type="button" className="rpg-btn !px-1" data-on={el === id} onClick={() => setEl(id)}>
                <span style={{ color: ELEMENTS[id].color, textShadow: "0 1px 0 #3a2a1e" }}>●</span> {ELEMENTS[id].name}
              </button>
            ))}
          </div>
          <p className="mt-2 min-h-5">
            <b style={{ color: "#5a3b2a" }}>{ELEMENTS[el].name}의 가호</b> — {ELEMENTS[el].passive}
          </p>
        </div>
        {error && <p className="mt-2 text-[12px] font-bold text-[#c0392b]">{error}</p>}
        <div className="mt-4 text-right">
          <button className="rpg-btn !px-6 !py-2 !text-sm" disabled={name.trim().length < 2}>{t("create.submit")}</button>
        </div>
      </form>
    </div>
  );
}
