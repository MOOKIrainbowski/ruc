"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useMe } from "./useMe";

/** 상단 바 오른쪽 — 디스코드 로그인 / 내 이름 · 관리 · 로그아웃. */
export default function AuthBadge() {
  const me = useMe();
  const here = usePathname() || "/";
  if (me === undefined) return <span className="w-14" aria-hidden="true" />;
  if (!me) {
    return (
      <Link
        href={`/login?next=${encodeURIComponent(here)}`}
        className="rounded-lg border border-white/15 px-2.5 py-1.5 text-[11px] whitespace-nowrap text-white/80 transition-colors hover:border-ruc-400 hover:text-ruc-300"
      >
        로그인
      </Link>
    );
  }
  return (
    <span className="flex items-center gap-2 text-[11px] whitespace-nowrap">
      {me.avatar && (
        // eslint-disable-next-line @next/next/no-img-element -- 디스코드 CDN 아바타 (next/image 도메인 설정 불필요)
        <img src={me.avatar} alt="" width={22} height={22} className="h-[22px] w-[22px] rounded-full" />
      )}
      <span className="hidden max-w-24 truncate text-white/80 sm:inline">{me.name}</span>
      {me.admin && (
        <Link href="/admin" className="text-ruc-400 hover:underline">
          관리
        </Link>
      )}
      <a href={`/api/auth/logout?next=${encodeURIComponent(here)}`} className="text-white/50 hover:text-white">
        로그아웃
      </a>
    </span>
  );
}
