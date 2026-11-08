"use client";

import { useEffect, useRef, useState } from "react";
import type { Settings } from "./settings";
import { t } from "./i18n";

/**
 * 모바일 터치 조작 (P16, §1 플랫폼 베타 편입 · D102).
 * 게임은 그대로 키보드 · 마우스 입력만 받고, 이 화면이 설정의 키를 대신 눌러 줌(합성 키 이벤트) — 키 설정을 바꿔도 그대로 따라감.
 * 왼쪽 = 이동 스틱(끝까지 밀면 달리기), 오른쪽 = 공격(누르고 있기) · Q · W · E · R · 구르기 · 상호작용 · 포션, 위 = 창 단추.
 * 조준은 가장 가까운 적(없으면 바라보는 쪽) — game.touchAim().
 */
type GameApi = { touchAim: () => void; setAttack: (on: boolean) => void; useHotbar: () => void } | null;

const key = (type: "keydown" | "keyup", code: string) => window.dispatchEvent(new KeyboardEvent(type, { code, bubbles: true }));
const tap = (code: string) => { key("keydown", code); setTimeout(() => key("keyup", code), 60); };

/** 터치 조작을 쓸까: 설정 auto 면 손가락 화면(coarse pointer)일 때 */
export function useTouch(mode: Settings["touch"]) {
  const [coarse, setCoarse] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(pointer: coarse)");
    const on = () => setCoarse(mq.matches);
    on();
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return mode === "on" || (mode === "auto" && coarse);
}

function Stick({ keys }: { keys: Settings["keys"] }) {
  const base = useRef<HTMLDivElement>(null);
  const held = useRef(new Set<string>());
  const [knob, setKnob] = useState({ x: 0, y: 0 });
  const set = (want: Set<string>) => {
    for (const c of held.current) if (!want.has(c)) key("keyup", c);
    for (const c of want) if (!held.current.has(c)) key("keydown", c);
    held.current = want;
  };
  const move = (cx: number, cy: number) => {
    const r = base.current!.getBoundingClientRect();
    const R = r.width / 2;
    let dx = cx - (r.left + R);
    let dy = cy - (r.top + R);
    const len = Math.hypot(dx, dy);
    if (len > R) { dx = (dx / len) * R; dy = (dy / len) * R; }
    setKnob({ x: dx, y: dy });
    const want = new Set<string>();
    if (len > R * 0.25) {
      const a = Math.atan2(dy, dx);
      if (Math.cos(a) > 0.38) want.add(keys.right);
      if (Math.cos(a) < -0.38) want.add(keys.left);
      if (Math.sin(a) > 0.38) want.add(keys.down);
      if (Math.sin(a) < -0.38) want.add(keys.up);
      if (len > R * 0.92) want.add(keys.run);
    }
    set(want);
  };
  const end = () => { setKnob({ x: 0, y: 0 }); set(new Set()); };
  useEffect(() => end, []); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div
      ref={base}
      className="pointer-events-auto relative h-36 w-36 rounded-full border-4 border-[#c9a24a]/70 bg-[rgba(20,14,28,0.35)]"
      style={{ touchAction: "none" }}
      onPointerDown={(e) => { try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* 합성 이벤트 */ } move(e.clientX, e.clientY); }}
      onPointerMove={(e) => { if (e.buttons || e.pointerType === "touch") move(e.clientX, e.clientY); }}
      onPointerUp={end}
      onPointerCancel={end}
    >
      <div className="absolute left-1/2 top-1/2 h-14 w-14 rounded-full border-2 border-[#ffe9a8] bg-[rgba(255,233,168,0.35)]" style={{ transform: `translate(calc(-50% + ${knob.x}px), calc(-50% + ${knob.y}px))` }} />
    </div>
  );
}

function Btn({ label, size = 56, onDown, onUp, className = "" }: { label: string; size?: number; onDown: () => void; onUp?: () => void; className?: string }) {
  return (
    <button
      className={`pointer-events-auto flex items-center justify-center rounded-full border-2 border-[#c9a24a] bg-[rgba(40,28,52,0.75)] text-[13px] font-bold text-[#ffe9a8] shadow-[0_3px_0_#0a0610] active:translate-y-px active:bg-[rgba(90,60,40,0.85)] ${className}`}
      style={{ width: size, height: size, touchAction: "none" }}
      onPointerDown={(e) => { e.preventDefault(); onDown(); }}
      onPointerUp={() => onUp?.()}
      onPointerCancel={() => onUp?.()}
      onContextMenu={(e) => e.preventDefault()}
    >
      {label}
    </button>
  );
}

export function TouchControls({ keys, game }: { keys: Settings["keys"]; game: () => GameApi }) {
  const aimTimer = useRef(0);
  const skill = (code: string) => ({ onDown: () => { game()?.touchAim(); key("keydown", code); }, onUp: () => key("keyup", code) });
  const attack = {
    onDown: () => {
      const g = game();
      g?.touchAim();
      g?.setAttack(true);
      clearInterval(aimTimer.current);
      aimTimer.current = window.setInterval(() => game()?.touchAim(), 200); // 누르고 있는 동안 계속 가장 가까운 적
    },
    onUp: () => { clearInterval(aimTimer.current); game()?.setAttack(false); },
  };
  useEffect(() => () => clearInterval(aimTimer.current), []);
  return (
    <div className="pointer-events-none absolute inset-0 z-20 select-none" style={{ touchAction: "none" }}>
      {/* 위: 창 단추 */}
      <div className="absolute left-1/2 top-2 flex -translate-x-1/2 gap-1">
        {([["🎒", keys.inventory], ["📖", keys.skills], ["📜", keys.journal], ["👥", keys.party], ["🤝", keys.social], ["🗺", keys.map], ["💬", keys.chat], ["⚙", "Escape"]] as const).map(([l, c]) => (
          <Btn key={c} label={l} size={38} onDown={() => tap(c)} />
        ))}
      </div>
      {/* 왼쪽 아래: 이동 스틱 */}
      <div className="absolute bottom-6 left-6"><Stick keys={keys} /></div>
      {/* 오른쪽 아래: 공격 · 스킬 */}
      <div className="absolute bottom-5 right-5 grid grid-cols-3 items-end gap-2">
        <Btn label="R" {...skill(keys.skillR)} />
        <Btn label="E" {...skill(keys.skillE)} />
        <Btn label={t("touch.potion")} size={48} onDown={() => game()?.useHotbar()} />
        <Btn label="W" {...skill(keys.skillW)} />
        <Btn label="Q" {...skill(keys.skillQ)} />
        <Btn label={t("touch.interact")} size={48} onDown={() => tap(keys.interact)} />
        <Btn label={t("touch.dodge")} size={56} onDown={() => tap(keys.dodge)} />
        <Btn label={t("touch.attack")} size={84} className="col-span-2 justify-self-end" {...attack} />
      </div>
    </div>
  );
}

/** 세로 화면 안내 */
export function RotateHint() {
  const [portrait, setPortrait] = useState(false);
  useEffect(() => {
    const on = () => setPortrait(window.innerHeight > window.innerWidth);
    on();
    window.addEventListener("resize", on);
    return () => window.removeEventListener("resize", on);
  }, []);
  if (!portrait) return null;
  return (
    <div className="absolute inset-0 z-50 flex flex-col items-center justify-center bg-[rgba(10,6,16,0.9)] text-center text-[#ffe9a8]">
      <div className="text-5xl">📱↻</div>
      <p className="mt-3 text-base font-bold">{t("touch.rotate")}</p>
    </div>
  );
}
