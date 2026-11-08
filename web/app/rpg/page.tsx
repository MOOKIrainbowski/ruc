import Link from "next/link";
import { rpgOpen } from "@/lib/rpg";
import { getSession } from "@/lib/session";
import RpgGame from "@/rpg/client/RpgGame";

/** 모바일 (P16): 손가락으로 확대되지 않게 */
export const viewport = { width: "device-width", initialScale: 1, maximumScale: 1, userScalable: false };

export const metadata = {
  title: "RPG 베타",
  description: "러크 RPG 베타 — 브라우저에서 즐기는 2D 픽셀 액션 RPG.",
  robots: { index: false },
};

/** 러크 RPG (RUC_RPG/RUC_RPG_PROMPT.md). 디스코드 로그인 필수 (§1). */
export default async function Page({ searchParams }: { searchParams: Promise<{ dev?: string }> }) {
  const open = rpgOpen();
  const session = await getSession();
  const dev = process.env.NODE_ENV === "development" ? (await searchParams).dev : undefined;
  if (open && (session || dev)) return <RpgGame dev={dev} />;

  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <div className="glass-strong w-full max-w-md rounded-2xl p-8 text-center">
        <p className="eyebrow mb-3">RUC CHRONICLE · BETA</p>
        <h1 className="headline text-3xl">러크 RPG</h1>
        <p className="mt-4 text-[13px] leading-relaxed text-white/75">
          정령의 대륙 루크리아로 떠나는 픽셀 액션 RPG.
          <br />
          {open ? "디스코드 계정으로 로그인해야 입장할 수 있습니다." : "게임 서버 오픈을 준비하고 있습니다. 조금만 기다려 주세요!"}
        </p>
        {open ? (
          <a
            href="/api/auth/login?next=/rpg"
            className="mt-7 inline-block rounded-lg bg-ruc-400 px-6 py-3 text-sm font-bold text-ruc-900 transition-colors hover:bg-ruc-300"
          >
            디스코드로 로그인
          </a>
        ) : (
          <p className="mt-7 inline-block rounded-lg border border-white/15 px-6 py-3 text-sm text-white/60">오픈 준비 중</p>
        )}
        <p className="mt-5 text-[11px] text-white/50">
          PC · 키보드와 마우스 전용 ·{" "}
          <Link href="/home" className="underline-offset-2 hover:underline">
            홈으로
          </Link>
        </p>
      </div>
    </main>
  );
}
