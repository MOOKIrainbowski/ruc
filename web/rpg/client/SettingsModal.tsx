"use client";

import { useEffect, useState } from "react";
import { t, type StrKey } from "./i18n";
import { ACTIONS_KEYS, DEFAULT_KEYS, keyLabel, type KeyAction, type Settings } from "./settings";

type Tab = "screen" | "ui" | "keys" | "sound";

/** 설정 팝업 (§24). Esc · X 로 닫힘 — Esc 는 RpgGame 이 처리하고, 키 입력 대기 중이면 여기서 먼저 가로챕니다. */
export default function SettingsModal({ s, onChange, onClose, onCapture }: { s: Settings; onChange: (s: Settings) => void; onClose: () => void; onCapture: (on: boolean) => void }) {
  const [tab, setTab] = useState<Tab>("screen");
  const [wait, setWait] = useState<KeyAction | null>(null);
  const [note, setNote] = useState("");
  const set = <K extends keyof Settings>(k: K, v: Settings[K]) => onChange({ ...s, [k]: v });

  useEffect(() => {
    onCapture(!!wait);
    if (!wait) return;
    const down = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopImmediatePropagation();
      setWait(null);
      if (e.code === "Escape") return;
      const keys = { ...s.keys };
      // 키 충돌: 이미 쓰는 동작과 맞바꿈
      const clash = (Object.keys(keys) as KeyAction[]).find((a) => a !== wait && keys[a] === e.code);
      if (clash) {
        keys[clash] = keys[wait];
        setNote(t("settings.swapped", { a: ACTIONS_KEYS[clash] }));
      } else setNote("");
      keys[wait] = e.code;
      onChange({ ...s, keys });
    };
    window.addEventListener("keydown", down, true);
    return () => window.removeEventListener("keydown", down, true);
  }, [wait, s, onChange, onCapture]);

  const row = (label: StrKey, control: React.ReactNode) => (
    <div className="flex items-center justify-between gap-4 py-1.5">
      <span>{t(label)}</span>
      <div className="flex gap-1">{control}</div>
    </div>
  );
  const choice = <K extends keyof Settings>(k: K, opts: [Settings[K], string][]) =>
    opts.map(([v, label]) => (
      <button key={String(v)} className="rpg-btn !px-2 !py-1" data-on={s[k] === v} onClick={() => set(k, v)}>{label}</button>
    ));
  const onOff = (k: "shadows" | "shake" | "damageNumbers") => choice(k, [[true, t("settings.on")], [false, t("settings.off")]]);
  const slider = (k: "interfaceScale" | "uiScale" | "hudScale" | "volMaster" | "volBgm" | "volSfx" | "minimapSize", min: number, max: number, stepN: number, unit = "%") => (
    <>
      <input type="range" className="rpg-range" min={min} max={max} step={stepN} value={s[k]} onChange={(e) => set(k, Number(e.target.value))} />
      <span className="w-12 text-right">{s[k]}{unit}</span>
    </>
  );

  return (
    <div className="rpg-modal-bg">
      <div className="rpg-panel relative w-[560px] max-w-[96vw] p-5 text-[12px]" style={{ zoom: s.uiScale / 100 }}>
        <button className="rpg-x" onClick={onClose} aria-label="닫기">✕</button>
        <h2 className="text-base font-bold">{t("settings.title")}</h2>
        <div className="mt-3 flex gap-1">
          {(["screen", "ui", "keys", "sound"] as Tab[]).map((x) => (
            <button key={x} className="rpg-btn" data-on={tab === x} onClick={() => setTab(x)}>{t(`settings.tab.${x}` as StrKey)}</button>
          ))}
        </div>
        <div className="mt-3 max-h-[60vh] overflow-y-auto pr-1">
          {tab === "screen" && (
            <>
              {row("settings.fps", choice("fpsLimit", [[30, "30"], [60, "60"], [120, "120"], [144, "144"], [0, t("settings.unlimited")]]))}
              {row("settings.quality", choice("quality", [["low", t("settings.quality.low")], ["medium", t("settings.quality.medium")], ["high", t("settings.quality.high")]]))}
              {row("settings.shadows", onOff("shadows"))}
              {row("settings.zoom", choice("zoom", [[0, t("settings.auto")], [2, "×2"], [3, "×3"], [4, "×4"]]))}
              {row("settings.shake", onOff("shake"))}
              {row("settings.damageNumbers", onOff("damageNumbers"))}
            </>
          )}
          {tab === "ui" && (
            <>
              {row("settings.interfaceScale", slider("interfaceScale", 75, 150, 5))}
              {row("settings.uiScale", slider("uiScale", 75, 150, 5))}
              {row("settings.hudScale", slider("hudScale", 75, 150, 5))}
              {row("settings.minimapSize", slider("minimapSize", 120, 240, 20, "px"))}
              {row("settings.nameplates", choice("nameplates", [["all", t("settings.nameplates.all")], ["party", t("settings.nameplates.party")], ["me", t("settings.nameplates.me")]]))}
            </>
          )}
          {tab === "keys" && (
            <>
              {row("settings.castMode", choice("castMode", [["quick", t("settings.castMode.quick")], ["indicator", t("settings.castMode.indicator")]]))}
              {(Object.keys(ACTIONS_KEYS) as KeyAction[]).map((a) => (
                <div key={a} className="flex items-center justify-between py-1">
                  <span>{ACTIONS_KEYS[a]}</span>
                  <button className="rpg-btn min-w-24 !py-1" data-on={wait === a} onClick={() => setWait(a)}>
                    {wait === a ? t("settings.pressKey") : keyLabel(s.keys[a])}
                  </button>
                </div>
              ))}
              <div className="mt-2 flex items-center justify-between">
                <span className="text-[#8c6642]">{note}</span>
                <button className="rpg-btn" onClick={() => { setNote(""); set("keys", { ...DEFAULT_KEYS }); }}>{t("settings.resetKeys")}</button>
              </div>
            </>
          )}
          {tab === "sound" && (
            <>
              {row("settings.volMaster", slider("volMaster", 0, 100, 5))}
              {row("settings.volBgm", slider("volBgm", 0, 100, 5))}
              {row("settings.volSfx", slider("volSfx", 0, 100, 5))}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
