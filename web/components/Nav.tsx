"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { DISCORD_INVITE, t, type Lang } from "@/lib/content";

/** 현재 경로에서 언어만 바꾼 경로를 만듭니다. (/status ↔ /en/status) */
function swapLang(pathname: string, to: Lang) {
  const stripped = pathname.replace(/^\/en(?=\/|$)/, "") || "/";
  if (to === "ko") return stripped;
  return stripped === "/" ? "/en" : `/en${stripped}`;
}

export default function Nav({ lang }: { lang: Lang }) {
  const c = t(lang);
  const pathname = usePathname() || "/";
  const home = lang === "ko" ? "/" : "/en";
  const statusHref = lang === "ko" ? "/status" : "/en/status";
  const onStatus = pathname.endsWith("/status");

  return (
    <header className="glass-nav fixed top-0 left-0 right-0 z-50">
      <nav className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-3 px-4 sm:px-6">
        {/* 좌측: 아이콘 + "Ruc Server" (§7.3) */}
        <Link href={home} className="group flex items-center gap-2.5 shrink-0">
          <Image
            src="/icon.png"
            alt=""
            width={34}
            height={34}
            className="h-[34px] w-[34px] transition-transform group-hover:scale-110"
            priority
          />
          <span className="headline text-[15px] sm:text-base tracking-tight">
            Ruc<span className="accent"> Server</span>
          </span>
        </Link>

        {/* 우측: 언어 토글 → "서버 가기" (§7.3) */}
        <div className="flex items-center gap-2 sm:gap-3">
          <Link
            href={statusHref}
            className={`hidden sm:inline-block px-3 py-2 text-xs transition-colors ${
              onStatus ? "text-ruc-400" : "text-white/70 hover:text-white"
            }`}
          >
            {c.nav.status}
          </Link>

          {/* KO / EN 토글 스위치 */}
          <div
            className="glass flex items-center rounded-full p-0.5 text-[11px]"
            role="group"
            aria-label="Language"
          >
            <Link
              href={swapLang(pathname, "ko")}
              aria-current={lang === "ko" ? "true" : undefined}
              className={`rounded-full px-2.5 py-1 transition-colors ${
                lang === "ko"
                  ? "bg-ruc-400 text-ruc-900 font-bold"
                  : "text-white/60 hover:text-white"
              }`}
            >
              KO
            </Link>
            <Link
              href={swapLang(pathname, "en")}
              aria-current={lang === "en" ? "true" : undefined}
              className={`rounded-full px-2.5 py-1 transition-colors ${
                lang === "en"
                  ? "bg-ruc-400 text-ruc-900 font-bold"
                  : "text-white/60 hover:text-white"
              }`}
            >
              EN
            </Link>
          </div>

          <a
            href={DISCORD_INVITE}
            target="_blank"
            rel="noopener noreferrer"
            className="rounded-full bg-ruc-400 px-3.5 py-2 text-[11px] sm:text-xs font-bold text-ruc-900 shadow-[0_0_20px_rgba(147,233,62,0.35)] transition-all hover:bg-ruc-300 hover:shadow-[0_0_28px_rgba(147,233,62,0.55)]"
          >
            {c.nav.goToServer}
          </a>
        </div>
      </nav>
    </header>
  );
}
