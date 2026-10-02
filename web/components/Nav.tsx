"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { DISCORD_INVITE, path, t, type Lang } from "@/lib/content";

/**
 * 영어판이 있는 사이트 페이지. 나머지(/home /rules /wiki /charge)는 한국어 전용입니다.
 * 랜딩(/landing · /en/landing)은 독립 페이지라 이 내비를 쓰지 않습니다 (LandingNav).
 *
 * (2026-10-01 결정). 여기 없는 페이지에서는 EN 토글을 비활성으로 둡니다 —
 * /en/rules 처럼 없는 주소로 보내면 404 가 됩니다.
 */
const EN_PAGES = ["/status"];

function stripLang(pathname: string) {
  return pathname.replace(/^\/en(?=\/|$)/, "") || "/";
}

export default function Nav({ lang }: { lang: Lang }) {
  const c = t(lang);
  const pathname = usePathname() || "/";
  const current = stripLang(pathname);
  const hasEn = EN_PAGES.includes(current);

  const [open, setOpen] = useState(false);
  const toggleRef = useRef<HTMLButtonElement>(null);

  // 페이지를 옮기면 모바일 메뉴를 닫습니다.
  useEffect(() => setOpen(false), [pathname]);

  // Esc 로 닫고, 포커스를 메뉴 버튼으로 되돌립니다 (키보드 사용자가 길을 잃지 않게).
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        toggleRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  // 한국어 전용 페이지는 영어 화면에서도 한국어 주소로 연결합니다.
  const links = [
    { href: "/home", match: "/home", label: c.nav.home },
    { href: "/rules", match: "/rules", label: c.nav.rules },
    { href: "/wiki", match: "/wiki", label: c.nav.wiki },
    { href: "/charge", match: "/charge", label: c.nav.charge },
    { href: path(lang, "/status"), match: "/status", label: c.nav.status },
  ];
  const isActive = (match: string) => current === match || current.startsWith(`${match}/`);

  const langClass = (active: boolean) =>
    `rounded-full px-2.5 py-1 transition-colors ${
      active ? "bg-ruc-400 text-ruc-900 font-bold" : "text-white/70 hover:text-white"
    }`;

  return (
    <header className="glass-nav fixed top-0 left-0 right-0 z-50">
      <nav
        aria-label={c.nav.menu}
        className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-3 px-4 sm:px-6"
      >
        {/* 좌측: 아이콘 + "Ruc Server" (§7.3) — 러크 홈페이지 홈으로 */}
        <Link href="/home" className="group flex shrink-0 items-center gap-2.5">
          <Image
            src="/icon.png"
            alt=""
            width={34}
            height={34}
            className="h-[34px] w-[34px] transition-transform group-hover:scale-110"
            priority
          />
          <span className="headline text-[15px] tracking-tight sm:text-base">
            Ruc<span className="accent"> Server</span>
          </span>
        </Link>

        {/* 데스크톱 링크 */}
        <ul className="hidden items-center gap-1 lg:flex">
          {links.map((l) => (
            <li key={l.match}>
              <Link
                href={l.href}
                aria-current={isActive(l.match) ? "page" : undefined}
                className={`rounded-lg px-3 py-2 text-xs transition-colors ${
                  isActive(l.match) ? "text-ruc-400" : "text-white/75 hover:text-white"
                }`}
              >
                {l.label}
              </Link>
            </li>
          ))}
        </ul>

        {/* 우측: 언어 토글 → "서버 가기" (§7.3) → 모바일 메뉴 버튼 */}
        <div className="flex items-center gap-2 sm:gap-3">
          <div
            className="glass flex items-center rounded-full p-0.5 text-[11px]"
            role="group"
            aria-label="Language"
          >
            <Link
              href={current}
              aria-current={lang === "ko" ? "true" : undefined}
              className={langClass(lang === "ko")}
            >
              KO
            </Link>
            {hasEn ? (
              <Link
                href={path("en", current)}
                aria-current={lang === "en" ? "true" : undefined}
                className={langClass(lang === "en")}
              >
                EN
              </Link>
            ) : (
              <span
                aria-disabled="true"
                title={c.nav.koOnly}
                className="cursor-not-allowed rounded-full px-2.5 py-1 text-white/35"
              >
                EN
                <span className="sr-only"> — {c.nav.koOnly}</span>
              </span>
            )}
          </div>

          <a
            href={DISCORD_INVITE}
            target="_blank"
            rel="noopener noreferrer"
            className="hidden rounded-full bg-ruc-400 px-3.5 py-2 text-[11px] font-bold text-ruc-900 shadow-[0_0_20px_rgba(147,233,62,0.35)] transition-all hover:bg-ruc-300 hover:shadow-[0_0_28px_rgba(147,233,62,0.55)] sm:inline-block sm:text-xs"
          >
            {c.nav.goToServer}
          </a>

          <button
            ref={toggleRef}
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            aria-controls="mobile-menu"
            aria-label={c.nav.menu}
            className="glass flex h-9 w-9 items-center justify-center rounded-lg lg:hidden"
          >
            {/* 픽셀 느낌의 햄버거 / X */}
            <span aria-hidden="true" className="text-sm leading-none text-white/90">
              {open ? "✕" : "☰"}
            </span>
          </button>
        </div>
      </nav>

      {/* 모바일 메뉴 */}
      <div
        id="mobile-menu"
        hidden={!open}
        className="border-t border-white/10 bg-[rgba(10,20,8,0.92)] backdrop-blur-xl lg:hidden"
      >
        <ul className="mx-auto grid max-w-6xl gap-1 px-4 py-3 sm:grid-cols-2 sm:px-6">
          {links.map((l) => (
            <li key={l.match}>
              <Link
                href={l.href}
                aria-current={isActive(l.match) ? "page" : undefined}
                className={`block rounded-lg px-3 py-3 text-[13px] transition-colors ${
                  isActive(l.match)
                    ? "bg-ruc-400/12 text-ruc-400"
                    : "text-white/85 hover:bg-white/6 hover:text-white"
                }`}
              >
                {l.label}
              </Link>
            </li>
          ))}
          <li className="sm:hidden">
            <a
              href={DISCORD_INVITE}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-1 block rounded-lg bg-ruc-400 px-3 py-3 text-center text-[13px] font-bold text-ruc-900"
            >
              {c.nav.goToServer}
            </a>
          </li>
        </ul>
      </div>
    </header>
  );
}
