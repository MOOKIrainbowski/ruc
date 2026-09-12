"use client";

import Image from "next/image";
import Link from "next/link";
import { useState } from "react";
import { DISCORD_INVITE, MC_ADDRESS, t, type Lang } from "@/lib/content";
import Nav from "./Nav";
import StatusStrip from "./StatusStrip";

function Section({
  id,
  children,
  className = "",
}: {
  id?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section id={id} className={`mx-auto w-full max-w-6xl px-4 sm:px-6 ${className}`}>
      {children}
    </section>
  );
}

function Eyebrow({ children }: { children: React.ReactNode }) {
  return <p className="eyebrow mb-3">{children}</p>;
}

function Heading({ children }: { children: string }) {
  return (
    <h2 className="headline whitespace-pre-line text-2xl sm:text-4xl mb-4">{children}</h2>
  );
}

function Lead({ children }: { children: React.ReactNode }) {
  return (
    <p className="max-w-2xl whitespace-pre-line text-[13px] leading-relaxed text-white/65">
      {children}
    </p>
  );
}

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

  const statusHref = lang === "ko" ? "/status" : "/en/status";

  return (
    <>
      <Nav lang={lang} />

      <main className="pt-16">
        {/* ─── 1. 히어로 (§7.2-1) ─────────────────────────────── */}
        <Section className="pt-14 pb-8 sm:pt-24 sm:pb-12 text-center">
          <Image
            src="/icon.png"
            alt="Ruc Server"
            width={128}
            height={128}
            priority
            className="mx-auto mb-7 h-24 w-24 sm:h-32 sm:w-32 drop-shadow-[0_0_40px_rgba(147,233,62,0.35)]"
          />

          <p className="eyebrow mb-4">{c.hero.eyebrow}</p>

          <h1 className="headline text-3xl leading-tight sm:text-6xl">
            {c.hero.title[0]}
            <br />
            <span className="accent">{c.hero.title[1]}</span>
          </h1>

          <p className="mx-auto mt-6 max-w-xl whitespace-pre-line text-[13px] leading-relaxed text-white/70 sm:text-sm">
            {c.hero.sub}
          </p>

          {/* 접속 주소 복사 */}
          <button
            onClick={copyAddress}
            className="glass glass-hover mx-auto mt-8 flex items-center gap-3 rounded-xl px-5 py-3 text-xs"
          >
            <span className="text-white/45">▸</span>
            <span className="text-white/95">{MC_ADDRESS}</span>
            <span className="text-ruc-400">{copied ? c.hero.copied : c.hero.copyAddress}</span>
          </button>

          {/* 필수 디스코드 CTA #1 (§7.2-4) */}
          <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
            <a
              href={DISCORD_INVITE}
              target="_blank"
              rel="noopener noreferrer"
              className="rounded-xl bg-ruc-400 px-6 py-3.5 text-xs font-bold text-ruc-900 shadow-[0_0_30px_rgba(147,233,62,0.4)] transition-all hover:bg-ruc-300 hover:shadow-[0_0_44px_rgba(147,233,62,0.6)]"
            >
              {c.hero.ctaDiscord}
            </a>
            <Link
              href={statusHref}
              className="glass glass-hover rounded-xl px-6 py-3.5 text-xs text-white/85"
            >
              {c.hero.ctaStatus}
            </Link>
          </div>
        </Section>

        {/* ─── 2. 실시간 상태 스트립 (D8 #2) ──────────────────── */}
        <Section className="pb-20">
          <StatusStrip lang={lang} />
        </Section>

        {/* ─── 3. 문제 → 해결 → 기능 (§7.2-2, §7.2-3) ────────── */}
        <Section id="why" className="py-16 sm:py-24">
          <Eyebrow>{c.problem.eyebrow}</Eyebrow>
          <Heading>{c.problem.heading}</Heading>
          <Lead>{c.problem.lead}</Lead>

          <div className="mt-12 space-y-5">
            {c.problem.items.map((item, i) => (
              <div key={i} className="glass rounded-2xl p-6 sm:p-8">
                {/* 문제 */}
                <p className="text-sm text-white/45 sm:text-base">{item.problem}</p>

                {/* 해결 */}
                <p className="headline mt-3 text-base leading-snug text-white sm:text-xl">
                  {item.solution}
                </p>

                {/* 해결하는 기능 — 해결 문구 바로 아래 (§7.2-3) */}
                <div className="mt-5 border-l-2 border-ruc-400/60 pl-4">
                  <p className="text-[11px] font-bold tracking-wider text-ruc-400">
                    {item.feature}
                  </p>
                  <p className="mt-1.5 text-xs leading-relaxed text-white/60">
                    {item.featureDesc}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </Section>

        {/* ─── 4. 4개 모드 (D8 #4) ────────────────────────────── */}
        <Section id="modes" className="py-16 sm:py-24">
          <Eyebrow>{c.modes.eyebrow}</Eyebrow>
          <Heading>{c.modes.heading}</Heading>
          <Lead>{c.modes.lead}</Lead>

          <div className="mt-10 grid gap-4 sm:grid-cols-2">
            {c.modes.items.map((m) => (
              <div key={m.key} className="glass glass-hover rounded-2xl p-6">
                <div className="mb-3 flex items-baseline justify-between gap-3">
                  <h3 className="headline text-xl">{m.name}</h3>
                  <span className="text-[10px] tracking-[0.2em] text-ruc-400/80">{m.tag}</span>
                </div>
                <p className="text-[13px] leading-relaxed text-white/80">{m.hook}</p>
                <p className="mt-4 border-t border-white/10 pt-3 text-[11px] text-white/45">
                  {m.rule}
                </p>
              </div>
            ))}
          </div>
        </Section>

        {/* ─── 5. 국가전 타임라인 (D8 #5) ─────────────────────── */}
        <Section id="war" className="py-16 sm:py-24">
          <Eyebrow>{c.war.eyebrow}</Eyebrow>
          <Heading>{c.war.heading}</Heading>
          <Lead>{c.war.lead}</Lead>

          <ol className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {c.war.steps.map((s) => (
              <li key={s.n} className="glass rounded-2xl p-5">
                <span className="headline block text-3xl text-ruc-400/35">{s.n}</span>
                <h3 className="headline mt-2 text-sm">{s.title}</h3>
                <p className="mt-2.5 text-[11px] leading-relaxed text-white/60">{s.desc}</p>
              </li>
            ))}
          </ol>
        </Section>

        {/* ─── 6. 드래곤 알 (D8 #6) ───────────────────────────── */}
        <Section id="egg" className="py-16 sm:py-24">
          <div className="glass-strong rounded-3xl p-7 sm:p-12">
            <Eyebrow>{c.egg.eyebrow}</Eyebrow>
            <Heading>{c.egg.heading}</Heading>
            <Lead>{c.egg.lead}</Lead>

            <ul className="mt-8 flex flex-wrap gap-2.5">
              {c.egg.buffs.map((b) => (
                <li
                  key={b}
                  className="rounded-full border border-ruc-400/30 bg-ruc-400/10 px-3.5 py-1.5 text-[11px] text-ruc-200"
                >
                  {b}
                </li>
              ))}
            </ul>

            <p className="mt-7 border-l-2 border-white/20 pl-4 text-[11px] leading-relaxed text-white/50">
              {c.egg.cost}
            </p>
          </div>
        </Section>

        {/* ─── 7. 평판 시스템 (D8 #7) ─────────────────────────── */}
        <Section id="reputation" className="py-16 sm:py-24">
          <Eyebrow>{c.rep.eyebrow}</Eyebrow>
          <Heading>{c.rep.heading}</Heading>
          <Lead>{c.rep.lead}</Lead>

          <div className="mt-10 grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7">
            {c.rep.tiers.map((tier) => (
              <div key={tier.name} className="glass rounded-xl p-4 text-center">
                <span
                  className="mx-auto mb-2.5 block h-8 w-8 rounded-md"
                  style={{
                    background: tier.color,
                    boxShadow: `0 0 18px ${tier.color}60`,
                  }}
                  aria-hidden="true"
                />
                <p className="text-xs text-white/90">{tier.name}</p>
                <p className="mt-1 text-[10px] leading-tight text-white/45">{tier.desc}</p>
              </div>
            ))}
          </div>

          <p className="mt-6 text-[11px] text-ruc-300/80">{c.rep.note}</p>
        </Section>

        {/* ─── 8. 후원 등급 (D8 #8) ───────────────────────────── */}
        <Section id="support" className="py-16 sm:py-24">
          <Eyebrow>{c.tiers.eyebrow}</Eyebrow>
          <Heading>{c.tiers.heading}</Heading>
          <Lead>{c.tiers.lead}</Lead>

          <div className="mt-9 glass rounded-2xl overflow-hidden">
            {c.tiers.rows.map((row, i) => (
              <div
                key={row.name}
                className={`flex flex-wrap items-baseline gap-x-4 gap-y-1 px-5 py-4 sm:px-7 ${
                  i > 0 ? "border-t border-white/8" : ""
                } ${i === c.tiers.rows.length - 1 ? "bg-ruc-400/8" : ""}`}
              >
                <span
                  className={`headline w-20 shrink-0 text-sm ${
                    i === c.tiers.rows.length - 1 ? "accent" : "text-white/90"
                  }`}
                >
                  {row.name}
                </span>
                <span className="w-12 shrink-0 text-[10px] text-white/35">{row.price}</span>
                <span className="text-[11px] leading-relaxed text-white/60">{row.perks}</span>
              </div>
            ))}
          </div>

          <p className="mt-5 flex items-start gap-2 text-[11px] leading-relaxed text-ruc-300">
            <span aria-hidden="true">✓</span>
            {c.tiers.notP2W}
          </p>
        </Section>

        {/* ─── 9. 로드맵 (D8 #9) ──────────────────────────────── */}
        <Section id="roadmap" className="py-16 sm:py-24">
          <Eyebrow>{c.roadmap.eyebrow}</Eyebrow>
          <Heading>{c.roadmap.heading}</Heading>

          <div className="mt-10 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {c.roadmap.items.map((item) => (
              <div key={item.phase} className="glass rounded-xl p-5">
                <div className="mb-2 flex items-center justify-between gap-2">
                  <span className="text-[10px] tracking-widest text-white/35">{item.phase}</span>
                  <span
                    className={`rounded-full px-2 py-0.5 text-[9px] ${
                      item.state === "done"
                        ? "bg-ruc-400/20 text-ruc-300"
                        : item.state === "wip"
                          ? "bg-amber-400/20 text-amber-300"
                          : "bg-white/8 text-white/40"
                    }`}
                  >
                    {c.roadmap.stateLabel[item.state]}
                  </span>
                </div>
                <h3 className="headline text-sm">{item.title}</h3>
                <p className="mt-1.5 text-[11px] text-white/50">{item.desc}</p>
              </div>
            ))}
          </div>
        </Section>

        {/* ─── 10. FAQ (D8 #10) ───────────────────────────────── */}
        <Section id="faq" className="py-16 sm:py-24">
          <Eyebrow>{c.faq.eyebrow}</Eyebrow>
          <Heading>{c.faq.heading}</Heading>

          <div className="mt-9 space-y-3">
            {c.faq.items.map((item) => (
              <details key={item.q} className="glass group rounded-xl px-5 py-4">
                <summary className="cursor-pointer list-none text-[13px] text-white/90 marker:content-none">
                  <span className="mr-2 text-ruc-400 group-open:hidden">+</span>
                  <span className="mr-2 hidden text-ruc-400 group-open:inline">−</span>
                  {item.q}
                </summary>
                <p className="mt-3 pl-5 text-[11px] leading-relaxed text-white/60">{item.a}</p>
              </details>
            ))}
          </div>
        </Section>

        {/* ─── 11. 최종 CTA (§7.2-4 필수) ─────────────────────── */}
        <Section className="py-20 sm:py-28 text-center">
          <div className="glass-strong rounded-3xl px-6 py-14 sm:px-12 sm:py-20">
            <h2 className="headline text-2xl sm:text-4xl">{c.finalCta.heading}</h2>
            <p className="mx-auto mt-4 max-w-md text-[13px] leading-relaxed text-white/65">
              {c.finalCta.lead}
            </p>
            <a
              href={DISCORD_INVITE}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-9 inline-block rounded-xl bg-ruc-400 px-9 py-4 text-xs font-bold text-ruc-900 shadow-[0_0_36px_rgba(147,233,62,0.45)] transition-all hover:bg-ruc-300 hover:shadow-[0_0_52px_rgba(147,233,62,0.65)]"
            >
              {c.finalCta.button}
            </a>
          </div>
        </Section>
      </main>

      <Footer lang={lang} />
    </>
  );
}

export function Footer({ lang }: { lang: Lang }) {
  const c = t(lang);
  return (
    <footer className="mt-10 border-t border-white/8">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 px-4 py-8 sm:px-6">
        <div className="flex items-center gap-2.5">
          <Image src="/icon.png" alt="" width={24} height={24} className="h-6 w-6" />
          <span className="text-[11px] text-white/50">{c.footer.tagline}</span>
        </div>
        <div className="flex flex-wrap items-center gap-5 text-[11px]">
          {c.footer.links.map((l) => (
            <a
              key={l.label}
              href={l.href}
              target={l.href.startsWith("http") ? "_blank" : undefined}
              rel={l.href.startsWith("http") ? "noopener noreferrer" : undefined}
              className="text-white/50 transition-colors hover:text-ruc-400"
            >
              {l.label}
            </a>
          ))}
          <span className="text-white/25">© 2026 {c.footer.madeWith}</span>
        </div>
      </div>
    </footer>
  );
}
