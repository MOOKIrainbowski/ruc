"use client";

import Image from "next/image";
import Link from "next/link";
import { useState } from "react";
import { DISCORD_INVITE, MC_ADDRESS, t, type Lang } from "@/lib/content";
import LandingNav from "./LandingNav";
import { Magnetic, ParallaxHero, RevealText, StickyScenes, TiltCard, ZoomIn } from "./LandingMotion";
import StatusStrip from "./StatusStrip";

/**
 * 랜딩(소개) — 처음 온 사람을 위한 독립 페이지.
 *
 * 2026-10-03 간소화: 11개 섹션 → 4개 (히어로 · 한눈에 · 서버 · 마지막 CTA).
 * 국가전 타임라인 · 드래곤 알 · 평판 · 후원 등급 · 로드맵 · FAQ 는 위키와 /charge 가 맡습니다.
 * 랜딩의 할 일은 하나 — "무엇인지 알고 → 들어오게" 하는 것입니다.
 */

function Section({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <section className={`mx-auto w-full max-w-5xl px-4 sm:px-6 ${className}`}>{children}</section>;
}

const primaryBtn =
  "rounded-xl bg-ruc-400 px-6 py-3.5 text-xs font-bold text-ruc-900 shadow-[0_0_30px_rgba(147,233,62,0.4)] transition-all hover:bg-ruc-300 hover:shadow-[0_0_44px_rgba(147,233,62,0.6)]";
const secondaryBtn = "glass glass-hover rounded-xl px-6 py-3.5 text-xs text-white/90";

export default function Landing({ lang }: { lang: Lang }) {
  const c = t(lang);
  const [copied, setCopied] = useState(false);

  const copyAddress = async () => {
    try {
      await navigator.clipboard.writeText(MC_ADDRESS);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      /* 클립보드 권한이 없으면 조용히 넘어갑니다 — 주소는 화면에 이미 보입니다. */
    }
  };

  const ctas = (
    <div className="flex flex-wrap items-center justify-center gap-3">
      <Magnetic>
        <Link href="/home" className={`inline-block ${primaryBtn}`}>
          {c.nav.enter} →
        </Link>
      </Magnetic>
      <a href={DISCORD_INVITE} target="_blank" rel="noopener noreferrer" className={secondaryBtn}>
        {c.hero.ctaDiscord}
      </a>
    </div>
  );

  return (
    <>
      {/* 랜딩은 독립 페이지 — 사이트 내비 대신 입장 버튼만 있는 전용 헤더 */}
      <LandingNav lang={lang} />

      {/* 히어로 블록이 화면 밖까지 뻗으므로 가로를 자릅니다 (clip 은 sticky 를 깨지 않음) */}
      <main className="overflow-x-clip pt-16">
        {/* ─── 1. 히어로 ─────────────────────────────────────── */}
        <Section className="pt-14 pb-10 text-center sm:pt-24 sm:pb-14">
          <ParallaxHero
            icon={
              <Image
                src="/icon.png"
                alt="Ruc Server"
                width={128}
                height={128}
                priority
                className="mx-auto mb-7 h-24 w-24 drop-shadow-[0_0_40px_rgba(147,233,62,0.35)] sm:h-32 sm:w-32"
              />
            }
          >
            <p className="eyebrow mb-4">{c.hero.eyebrow}</p>
            <h1 className="headline text-3xl leading-tight sm:text-6xl">
              <RevealText text={c.hero.title[0]} />
              <br />
              <RevealText text={c.hero.title[1]} delay={0.25} className="accent" />
            </h1>
            <p className="mx-auto mt-6 max-w-md text-[13px] leading-relaxed text-white/75 sm:text-sm">{c.hero.sub}</p>
          </ParallaxHero>

          <button
            onClick={copyAddress}
            className="glass glass-hover mx-auto mt-8 flex items-center gap-3 rounded-xl px-5 py-3 text-xs"
          >
            <span className="text-white/50">▸</span>
            <span className="text-white/95">{MC_ADDRESS}</span>
            <span className="text-ruc-400">{copied ? c.hero.copied : c.hero.copyAddress}</span>
          </button>

          <div className="mt-6">{ctas}</div>

          <div className="mt-10">
            <StatusStrip lang={lang} />
          </div>
        </Section>

        {/* ─── 2. 한눈에 ─────────────────────────────────────── */}
        <Section className="py-14 sm:py-20">
          <p className="eyebrow mb-3 text-center">{c.highlights.eyebrow}</p>
          <h2 className="headline mb-10 text-center text-2xl sm:text-3xl">{c.highlights.heading}</h2>
          <StickyScenes
            items={c.highlights.items}
            fallback={
          <ul className="grid gap-4 sm:grid-cols-3">
                {c.highlights.items.map((h) => (
                  <li key={h.title} className="glass rounded-2xl p-6 text-center">
                    <span
                      aria-hidden="true"
                      className="headline mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-lg border border-ruc-400/40 bg-ruc-400/10 text-xl text-ruc-400"
                    >
                      {h.glyph}
                    </span>
                    <h3 className="headline text-base">{h.title}</h3>
                    <p className="mt-2 text-[12px] leading-relaxed text-white/70">{h.desc}</p>
                  </li>
                ))}
              </ul>
            }
          />
        </Section>

        {/* ─── 3. 서버 ───────────────────────────────────────── */}
        <Section className="py-14 sm:py-20">
          <p className="eyebrow mb-3 text-center">{c.modes.eyebrow}</p>
          <h2 className="headline mb-10 text-center text-2xl sm:text-3xl">{c.modes.heading}</h2>
          <ul className="grid grid-cols-2 gap-3 [perspective:1000px] lg:grid-cols-4">
            {c.modes.items.map((m, i) => (
              <TiltCard key={m.key} index={i} muted={m.paused} className="glass rounded-2xl p-5">
                <div className="mb-2 flex items-center justify-between gap-2">
                  <h3 className="headline text-lg">{m.name}</h3>
                  <span
                    className={`rounded-full px-2 py-0.5 text-[9px] ${
                      m.paused ? "bg-white/10 text-white/60" : "bg-ruc-400/20 text-ruc-300"
                    }`}
                  >
                    {m.paused ? c.modes.paused : c.modes.live}
                  </span>
                </div>
                <p className="text-[10px] tracking-[0.2em] text-ruc-400/80">{m.tag}</p>
                <p className="mt-2 text-[12px] leading-relaxed text-white/75">{m.hook}</p>
              </TiltCard>
            ))}
          </ul>
        </Section>

        {/* ─── 4. 마지막 CTA ─────────────────────────────────── */}
        <Section className="py-16 text-center sm:py-24">
          <ZoomIn className="glass-strong rounded-3xl px-6 py-12 sm:px-12 sm:py-16">
            <h2 className="headline text-2xl sm:text-4xl">{c.finalCta.heading}</h2>
            <p className="mx-auto mt-4 mb-8 max-w-md text-[13px] leading-relaxed text-white/70">{c.finalCta.lead}</p>
            {ctas}
          </ZoomIn>
        </Section>
      </main>

      {/* 랜딩 전용 푸터 — 사이트 링크 없이 한 줄 */}
      <footer className="mt-10 border-t border-white/8">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 px-4 py-8 sm:px-6">
          <div className="flex items-center gap-2.5">
            <Image src="/icon.png" alt="" width={24} height={24} className="h-6 w-6" />
            <span className="text-[11px] text-white/60">{c.footer.tagline}</span>
          </div>
          <span className="text-[11px] text-white/40">
            © 2026 {c.footer.madeWith} · {c.footer.disclaimer}
          </span>
        </div>
      </footer>
    </>
  );
}
