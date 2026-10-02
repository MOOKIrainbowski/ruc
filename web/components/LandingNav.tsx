import Image from "next/image";
import Link from "next/link";
import { t, type Lang } from "@/lib/content";

/**
 * 랜딩(소개) 전용 헤더.
 *
 * 랜딩은 처음 온 사람을 위한 독립 페이지입니다 (2026-10-02 소유자 결정). 사이트 내비
 * (홈 · 규칙 · 위키 · 충전 · 상태)를 보여 주지 않고, 할 일은 하나 — <b>러크 홈페이지로 입장</b>.
 * 언어 전환은 랜딩 두 벌(/landing · /en/landing) 사이에서만 합니다.
 */
export default function LandingNav({ lang }: { lang: Lang }) {
  const c = t(lang);
  const langClass = (active: boolean) =>
    `rounded px-2 py-1 transition-colors ${
      active ? "bg-ruc-400 text-ruc-900 font-bold" : "text-white/70 hover:text-white"
    }`;

  return (
    <header className="site-bar fixed top-0 left-0 right-0 z-50">
      <nav
        aria-label="Ruc Server"
        className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-3 px-4 sm:px-6"
      >
        <span className="flex shrink-0 items-center gap-2.5">
          <Image src="/icon.png" alt="" width={34} height={34} className="h-[34px] w-[34px]" priority />
          <span className="headline text-[15px] tracking-tight sm:text-base">
            Ruc<span className="accent"> Server</span>
          </span>
        </span>

        <div className="flex items-center gap-2 sm:gap-3">
          <div className="flex items-center rounded-md border border-white/10 p-0.5 text-[11px]" role="group" aria-label="Language">
            <Link href="/landing" aria-current={lang === "ko" ? "true" : undefined} className={langClass(lang === "ko")}>
              KO
            </Link>
            <Link href="/en/landing" aria-current={lang === "en" ? "true" : undefined} className={langClass(lang === "en")}>
              EN
            </Link>
          </div>
          <Link
            href="/home"
            className="rounded-md bg-ruc-400 px-3.5 py-2 text-[11px] font-bold text-ruc-900 shadow-[0_0_20px_rgba(147,233,62,0.35)] transition-all hover:bg-ruc-300 hover:shadow-[0_0_28px_rgba(147,233,62,0.55)] sm:text-xs"
          >
            {c.nav.enter} →
          </Link>
        </div>
      </nav>
    </header>
  );
}
