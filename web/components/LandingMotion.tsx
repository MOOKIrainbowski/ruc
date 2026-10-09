"use client";

import {
  motion,
  useMotionTemplate,
  useMotionValue,
  useReducedMotion,
  useScroll,
  useSpring,
  useTransform,
  type MotionValue,
} from "motion/react";
import { useEffect, useRef } from "react";

/**
 * 랜딩 연출 (2026-10-09, docs/07-WEB-REDESIGN-PLAN.md Phase 4).
 * 전부 "동작 줄이기" 설정이면 움직이지 않습니다 — 각 컴포넌트가 useReducedMotion 을 봅니다.
 * 레이어 그림이 없어 히어로의 블록은 CSS 로 그립니다 (그림이 생기면 PixelBlock 자리를 <Image> 로).
 */

const spring = { stiffness: 70, damping: 20, mass: 0.6 };

/** 창 기준 마우스 위치 -1 ~ 1 (부드럽게) */
function usePointer() {
  const x = useMotionValue(0);
  const y = useMotionValue(0);
  useEffect(() => {
    const on = (e: PointerEvent) => {
      x.set((e.clientX / window.innerWidth) * 2 - 1);
      y.set((e.clientY / window.innerHeight) * 2 - 1);
    };
    window.addEventListener("pointermove", on);
    return () => window.removeEventListener("pointermove", on);
  }, [x, y]);
  return { x: useSpring(x, spring), y: useSpring(y, spring) };
}

// ── 히어로 ──────────────────────────────────────────────────────────

/** 잔디 블록 하나 — 윗면 연두, 옆면 흙. depth 가 클수록 가깝게(많이) 움직입니다. */
function PixelBlock({
  left,
  top,
  size,
  depth,
  px,
  py,
  scroll,
}: {
  left: string;
  top: string;
  size: number;
  depth: number;
  px: MotionValue<number>;
  py: MotionValue<number>;
  scroll: MotionValue<number>;
}) {
  const x = useTransform(px, (v) => v * depth * 28);
  const mouseY = useTransform(py, (v) => v * depth * 18);
  const scrollY = useTransform(scroll, [0, 1], [0, -depth * 220]);
  const y = useTransform(() => mouseY.get() + scrollY.get());
  const rotateY = useTransform(px, (v) => 35 + v * 25);
  return (
    <motion.div
      aria-hidden="true"
      className="pointer-events-none absolute [transform-style:preserve-3d]"
      style={{ left, top, width: size, height: size, x, y, rotateX: -22, rotateY, opacity: 0.35 + depth * 0.25 }}
    >
      <motion.div
        className="absolute inset-0 border-2 border-black/40"
        animate={{ y: [0, -10, 0] }}
        transition={{ duration: 4 + depth * 2, repeat: Infinity, ease: "easeInOut" }}
        style={{
          background: "linear-gradient(#93e93e 0 28%, #6aa52c 28% 36%, #7a5534 36% 100%)",
          boxShadow: "inset -6px -6px 0 rgba(0,0,0,0.25), 0 0 30px rgba(147,233,62,0.25)",
          imageRendering: "pixelated",
        }}
      />
    </motion.div>
  );
}

const BLOCKS = [
  { left: "6%", top: "18%", size: 46, depth: 1 },
  { left: "86%", top: "14%", size: 62, depth: 1.4 },
  { left: "14%", top: "64%", size: 34, depth: 0.6 },
  { left: "78%", top: "62%", size: 40, depth: 0.8 },
  { left: "92%", top: "40%", size: 26, depth: 0.4 },
  { left: "2%", top: "42%", size: 22, depth: 0.3 },
];

/**
 * 히어로 껍데기 — 스크롤하면 아이콘 · 글이 다른 속도로 올라가며 흐려지고,
 * 뒤의 블록은 마우스 · 스크롤에 깊이만큼 움직입니다.
 */
export function ParallaxHero({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }) {
  const reduce = useReducedMotion();
  const ref = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start start", "end start"] });
  const { x: px, y: py } = usePointer();
  const iconY = useTransform(scrollYProgress, [0, 1], [0, -140]);
  const iconRotX = useTransform(py, (v) => v * -14);
  const iconRotY = useTransform(px, (v) => v * 18);
  const textY = useTransform(scrollYProgress, [0, 1], [0, -60]);
  const fade = useTransform(scrollYProgress, [0, 0.8], [1, 0]);

  if (reduce) {
    return (
      <div ref={ref}>
        {icon}
        {children}
      </div>
    );
  }
  return (
    <div ref={ref} className="relative [perspective:900px]">
      <div className="pointer-events-none absolute inset-x-[-30vw] inset-y-0 -z-10 hidden sm:block">
        {BLOCKS.map((b) => (
          <PixelBlock key={b.left + b.top} {...b} px={px} py={py} scroll={scrollYProgress} />
        ))}
      </div>
      <motion.div style={{ y: iconY, rotateX: iconRotX, rotateY: iconRotY, opacity: fade }}>{icon}</motion.div>
      <motion.div style={{ y: textY, opacity: fade }}>{children}</motion.div>
    </div>
  );
}

/** 글자 하나씩 떠오르는 제목 줄. 스크린리더는 원문 한 번만 읽습니다. */
export function RevealText({ text, delay = 0, className }: { text: string; delay?: number; className?: string }) {
  const reduce = useReducedMotion();
  if (reduce) return <span className={className}>{text}</span>;
  return (
    <span className={className} aria-label={text}>
      {[...text].map((ch, i) => (
        <motion.span
          key={i}
          aria-hidden="true"
          className="inline-block"
          initial={{ opacity: 0, y: "0.5em", rotateX: -70 }}
          animate={{ opacity: 1, y: 0, rotateX: 0 }}
          transition={{ delay: delay + i * 0.035, duration: 0.45, ease: [0.2, 0.8, 0.2, 1] }}
        >
          {ch === " " ? " " : ch}
        </motion.span>
      ))}
    </span>
  );
}

// ── 한눈에: 스크롤 고정 장면 ─────────────────────────────────────────

type Highlight = { glyph: string; title: string; desc: string };

function Scene({ item, i, n, p }: { item: Highlight; i: number; n: number; p: MotionValue<number> }) {
  const a = i / n;
  const b = (i + 1) / n;
  // 처음 장면은 처음부터 보이고, 마지막 장면은 끝까지 남습니다.
  const input = i === 0 ? [0, b - 0.06, b] : i === n - 1 ? [a, a + 0.06, 1] : [a, a + 0.06, b - 0.06, b];
  const output = i === 0 ? [1, 1, 0] : i === n - 1 ? [0, 1, 1] : [0, 1, 1, 0];
  const opacity = useTransform(p, input, output);
  const y = useTransform(opacity, [0, 1], [30, 0]);
  return (
    <motion.div style={{ opacity, y }} className="absolute inset-0 flex flex-col items-center justify-center px-4 text-center">
      <p className="text-[11px] tracking-[0.3em] text-ruc-300">
        {String(i + 1).padStart(2, "0")} / {String(n).padStart(2, "0")}
      </p>
      <h3 className="headline mt-4 text-2xl sm:text-4xl">{item.title}</h3>
      <p className="mx-auto mt-4 max-w-md text-[13px] leading-relaxed text-white/75 sm:text-sm">{item.desc}</p>
    </motion.div>
  );
}

/** 회전하는 3D 블록 — 앞면에 지금 장면의 글리프 */
function SpinBlock({ items, p }: { items: Highlight[]; p: MotionValue<number> }) {
  const rotateY = useTransform(p, [0, 1], [-20, 360 * (items.length - 1) - 20]);
  const rotateX = useTransform(p, [0, 0.5, 1], [-18, 12, -18]);
  const glyph = useTransform(p, (v) => items[Math.min(items.length - 1, Math.floor(v * items.length))].glyph);
  const s = 112;
  const face = "absolute inset-0 flex items-center justify-center border-2 border-ruc-400/60 bg-ruc-900/80 text-4xl text-ruc-400 headline";
  return (
    <div aria-hidden="true" className="[perspective:700px]">
      <motion.div className="relative [transform-style:preserve-3d]" style={{ width: s, height: s, rotateX, rotateY }}>
        {[0, 90, 180, 270].map((deg) => (
          <motion.div
            key={deg}
            className={face}
            style={{ transform: `rotateY(${deg}deg) translateZ(${s / 2}px)`, boxShadow: "inset 0 0 24px rgba(147,233,62,0.25)" }}
          >
            {glyph}
          </motion.div>
        ))}
        <div className={face} style={{ transform: `rotateX(90deg) translateZ(${s / 2}px)`, background: "#93e93e" }} />
        <div className={face} style={{ transform: `rotateX(-90deg) translateZ(${s / 2}px)` }} />
      </motion.div>
    </div>
  );
}

export function StickyScenes({
  items,
  fallback,
}: {
  items: Highlight[];
  /** 동작 줄이기일 때 보여 줄 기존 카드 그리드 */
  fallback: React.ReactNode;
}) {
  const reduce = useReducedMotion();
  const ref = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start start", "end end"] });
  const p = useSpring(scrollYProgress, { stiffness: 120, damping: 30 });
  const bar = useTransform(p, [0, 1], ["0%", "100%"]);
  if (reduce) return <>{fallback}</>;
  return (
    <div ref={ref} style={{ height: `${items.length * 90}vh` }} className="relative">
      <div className="sticky top-16 flex h-[calc(100vh-4rem)] flex-col items-center justify-center">
        <SpinBlock items={items} p={p} />
        <div className="relative mt-10 h-56 w-full max-w-2xl">
          {items.map((item, i) => (
            <Scene key={item.title} item={item} i={i} n={items.length} p={p} />
          ))}
        </div>
        <div className="mt-2 h-0.5 w-40 overflow-hidden rounded-full bg-white/15" aria-hidden="true">
          <motion.div className="h-full bg-ruc-400" style={{ width: bar }} />
        </div>
      </div>
    </div>
  );
}

// ── 서버 카드: 3D 틸트 + 빛 ──────────────────────────────────────────

export function TiltCard({
  children,
  index,
  className = "",
  muted = false,
}: {
  children: React.ReactNode;
  index: number;
  className?: string;
  /** 정지 중인 서버 — 흑백 */
  muted?: boolean;
}) {
  const reduce = useReducedMotion();
  const mx = useMotionValue(0.5);
  const my = useMotionValue(0.5);
  const rotateX = useSpring(useTransform(my, [0, 1], [10, -10]), spring);
  const rotateY = useSpring(useTransform(mx, [0, 1], [-12, 12]), spring);
  const gx = useTransform(mx, (v) => `${v * 100}%`);
  const gy = useTransform(my, (v) => `${v * 100}%`);
  const glare = useMotionTemplate`radial-gradient(circle at ${gx} ${gy}, rgba(186,217,83,0.28), transparent 55%)`;
  const tone = muted ? "grayscale opacity-60 hover:opacity-80" : "";

  if (reduce) return <li className={`${className} ${tone}`}>{children}</li>;
  return (
    <motion.li
      className={`relative [transform-style:preserve-3d] ${className} ${tone}`}
      style={{ rotateX, rotateY }}
      initial={{ opacity: 0, y: 50, rotateX: 30 }}
      whileInView={{ opacity: 1, y: 0, rotateX: 0 }}
      viewport={{ once: true, margin: "-60px" }}
      transition={{ delay: index * 0.09, duration: 0.6, ease: [0.2, 0.8, 0.2, 1] }}
      onPointerMove={(e) => {
        const r = e.currentTarget.getBoundingClientRect();
        mx.set((e.clientX - r.left) / r.width);
        my.set((e.clientY - r.top) / r.height);
      }}
      onPointerLeave={() => {
        mx.set(0.5);
        my.set(0.5);
      }}
    >
      {children}
      <motion.div aria-hidden="true" className="pointer-events-none absolute inset-0 rounded-2xl" style={{ background: glare }} />
    </motion.li>
  );
}

// ── 마지막 CTA ──────────────────────────────────────────────────────

/** 스크롤해 들어오면 멀리서 다가오듯 커집니다. */
export function ZoomIn({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  const reduce = useReducedMotion();
  const ref = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start end", "center center"] });
  const scale = useTransform(scrollYProgress, [0, 1], [0.82, 1]);
  const opacity = useTransform(scrollYProgress, [0, 0.6], [0.3, 1]);
  const rotateX = useTransform(scrollYProgress, [0, 1], [18, 0]);
  return (
    <div ref={ref} className="[perspective:1000px]">
      <motion.div className={className} style={reduce ? undefined : { scale, opacity, rotateX }}>
        {children}
      </motion.div>
    </div>
  );
}

/** 마우스를 가까이 대면 버튼이 살짝 끌려옵니다. */
export function Magnetic({ children }: { children: React.ReactNode }) {
  const reduce = useReducedMotion();
  const x = useSpring(0, { stiffness: 200, damping: 15 });
  const y = useSpring(0, { stiffness: 200, damping: 15 });
  if (reduce) return <>{children}</>;
  return (
    <motion.span
      className="inline-block"
      style={{ x, y }}
      onPointerMove={(e) => {
        const r = e.currentTarget.getBoundingClientRect();
        x.set((e.clientX - r.left - r.width / 2) * 0.3);
        y.set((e.clientY - r.top - r.height / 2) * 0.4);
      }}
      onPointerLeave={() => {
        x.set(0);
        y.set(0);
      }}
    >
      {children}
    </motion.span>
  );
}
