"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { DISCORD_INVITE, MC_ADDRESS, path, t, type Lang } from "@/lib/content";
import CopyButton from "./CopyButton";
import NavIcon, { type NavIconName } from "./NavIcon";
import SearchBox from "./SearchBox";
import { useStatus } from "./useStatus";

/**
 * 영어판이 있는 사이트 페이지. 나머지(/home /rules /wiki /charge)는 한국어 전용입니다.
 * 랜딩(/landing · /en/landing)은 독립 페이지라 이 내비를 쓰지 않습니다 (LandingNav).
 * 여기 없는 페이지에서는 EN 토글을 비활성으로 둡니다 — /en/rules 처럼 없는 주소로 보내면 404 가 됩니다.
 */
const EN_PAGES = ["/status"];

function stripLang(pathname: string) {
  return pathname.replace(/^\/en(?=\/|$)/, "") || "/";
}

/**
 * 사이트 상단 바 (2026-10-03 개편).
 *
 * 메뉴는 글자 대신 <b>아이콘</b>입니다. 이름은 마우스를 올리거나 Tab 으로 가면 툴팁으로 보이고,
 * 스크린리더는 aria-label 로 읽습니다. 아이콘이라 휴대폰 폭에도 전부 들어가서 햄버거 메뉴를 없앴습니다.
 *
 * 가운데는 사이트 검색창입니다 (2026-10-05) — 페이지 · 위키 · 규칙 · 충전 상품을 찾습니다.
 * 휴대폰(md 미만)에서는 자리가 없어 돋보기 아이콘만 두고, 누르면 바 전체를 검색창이 덮습니다.
 */
export default function Nav({ lang }: { lang: Lang }) {
  const c = t(lang);
  const pathname = usePathname() || "/";
  const current = stripLang(pathname);
  const hasEn = EN_PAGES.includes(current);
  const [searchOpen, setSearchOpen] = useState(false);
  // ponytail: /status · 랜딩 상태 띠와 따로 폴링합니다 (45초에 요청 1건 더). 늘어나면 Context 로 하나로.
  const { data: status } = useStatus();
  const live = Boolean(status?.servers.some((s) => s.online));
  // 위키에는 위키 전용 검색창이 따로 있어 "/" 단축키를 그쪽에 줍니다.
  const searchHotkey = !(current === "/wiki" || current.startsWith("/wiki/"));
  const searchProps = {
    src: "/api/search",
    label: c.nav.search,
    placeholder: c.nav.searchPlaceholder,
  };

  // 한국어 전용 페이지는 영어 화면에서도 한국어 주소로 연결합니다.
  const links: { href: string; match: string; label: string; icon: NavIconName }[] = [
    { href: "/home", match: "/home", label: c.nav.home, icon: "home" },
    { href: "/rules", match: "/rules", label: c.nav.rules, icon: "rules" },
    { href: "/wiki", match: "/wiki", label: c.nav.wiki, icon: "wiki" },
    { href: "/charge", match: "/charge", label: c.nav.charge, icon: "charge" },
    { href: path(lang, "/status"), match: "/status", label: c.nav.status, icon: "status" },
  ];
  const isActive = (match: string) => current === match || current.startsWith(`${match}/`);

  const langClass = (active: boolean) =>
    `rounded px-2 py-1 transition-colors ${
      active ? "bg-ruc-400 text-ruc-900 font-bold" : "text-white/70 hover:text-white"
    }`;

  const iconBtn = (active: boolean) =>
    `nav-icon group relative flex h-8 w-8 items-center sm:h-9 sm:w-9 justify-center rounded-md border transition-colors ${
      active
        ? "border-ruc-400 bg-ruc-400 text-ruc-900"
        : "border-white/10 bg-white/[0.04] text-white/80 hover:border-ruc-400/60 hover:text-ruc-300"
    }`;

  return (
    <header className="site-bar fixed top-0 left-0 right-0 z-50">
      <nav
        aria-label={c.nav.menu}
        className="relative mx-auto flex h-16 max-w-6xl items-center gap-2 px-4 sm:px-6 md:gap-4"
      >
        {/* 좌측: 아이콘 + "Ruc Server" — 러크 홈페이지 홈으로. 좁은 화면에서는 아이콘만 */}
        {/* 휴대폰 폭이 모자랄 때 (검색 버튼이 생겨서): 영어판이 있는 페이지는 로고를, 없는 페이지는
            어차피 비활성인 KO/EN 토글을 숨깁니다. 로고가 하는 일(/home)은 집 아이콘이 똑같이 합니다. */}
        <Link
          href="/home"
          className={`group shrink-0 items-center gap-2.5 ${hasEn ? "hidden sm:flex" : "flex"}`}
          aria-label="Ruc Server"
        >
          <Image
            src="/icon.png"
            alt=""
            width={34}
            height={34}
            className="h-[34px] w-[34px] transition-transform group-hover:scale-110"
            priority
          />
          <span className="headline hidden text-base tracking-tight sm:inline">
            Ruc<span className="accent"> Server</span>
          </span>
        </Link>

        {/* 가운데: 사이트 검색 (md 이상) */}
        <div className="mx-auto hidden min-w-0 max-w-md flex-1 md:block">
          <SearchBox {...searchProps} hotkey={searchHotkey} inputClassName="h-9 rounded-lg" />
        </div>

        {/* 접속 주소 복사 + 살아 있는 서버 점 (lg 이상 — 휴대폰은 /home 접속 패널) */}
        <CopyButton
          value={MC_ADDRESS}
          label={`${c.hero.copyAddress}: ${MC_ADDRESS}`}
          toastText={`${MC_ADDRESS} ${c.hero.copied}`}
          className="hidden shrink-0 items-center gap-2 rounded-md border border-white/10 bg-white/[0.04] px-2.5 py-1.5 text-[11px] text-white/85 transition-colors hover:border-ruc-400/60 hover:text-ruc-300 lg:flex"
        >
          <span className={`dot ${live ? "dot-on" : "dot-off"}`} aria-hidden="true" />
          {MC_ADDRESS}
          {live && (
            <span className="text-ruc-400" aria-hidden="true">{status?.totalOnline}</span>
          )}
        </CopyButton>

        <div className="ml-auto flex items-center gap-1 sm:gap-2 md:ml-0">
          {/* 휴대폰: 돋보기 → 바 전체를 덮는 검색창 */}
          <button
            type="button"
            onClick={() => setSearchOpen(true)}
            aria-label={c.nav.search}
            className={`${iconBtn(false)} md:hidden`}
          >
            <NavIcon name="search" />
          </button>
          <ul className="flex items-center gap-1 sm:gap-2">
            {links.map((l) => {
              const active = isActive(l.match);
              return (
                <li key={l.match}>
                  <Link
                    href={l.href}
                    aria-label={l.label}
                    aria-current={active ? "page" : undefined}
                    className={iconBtn(active)}
                  >
                    <NavIcon name={l.icon} />
                    <span className="nav-tip" aria-hidden="true">{l.label}</span>
                  </Link>
                </li>
              );
            })}
            <li>
              <a
                href={DISCORD_INVITE}
                target="_blank"
                rel="noopener noreferrer"
                aria-label={c.nav.goToServer}
                className={`${iconBtn(false)} !border-ruc-400/50 !text-ruc-400`}
              >
                <NavIcon name="discord" />
                <span className="nav-tip" aria-hidden="true">{c.nav.goToServer}</span>
              </a>
            </li>
          </ul>

          <span aria-hidden="true" className="mx-0.5 hidden h-6 w-px bg-white/15 sm:block" />

          {/* KO / EN */}
          <div
            className={`items-center rounded-md border border-white/10 p-0.5 text-[11px] ${hasEn ? "flex" : "hidden sm:flex"}`}
            role="group"
            aria-label="Language"
          >
            <Link href={current} aria-current={lang === "ko" ? "true" : undefined} className={langClass(lang === "ko")}>
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
              <span aria-disabled="true" title={c.nav.koOnly} className="cursor-not-allowed rounded px-2 py-1 text-white/35">
                EN
                <span className="sr-only"> — {c.nav.koOnly}</span>
              </span>
            )}
          </div>
        </div>

        {searchOpen && (
          <div className="absolute inset-0 flex items-center gap-2 bg-black px-4 sm:px-6 md:hidden">
            <div className="min-w-0 flex-1">
              <SearchBox
                {...searchProps}
                autoFocus
                onDone={() => setSearchOpen(false)}
                inputClassName="h-10 rounded-lg"
              />
            </div>
            <button
              type="button"
              onClick={() => setSearchOpen(false)}
              aria-label={c.nav.searchClose}
              className={iconBtn(false)}
            >
              <NavIcon name="close" />
            </button>
          </div>
        )}
      </nav>
    </header>
  );
}
