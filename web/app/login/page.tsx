import { redirect } from "next/navigation";
import PageShell from "@/components/PageShell";
import { getSession, safeNext } from "@/lib/session";

export const metadata = { title: "로그인", robots: { index: false } };

type Search = Promise<{ next?: string; error?: string }>;

/** 디스코드 로그인 안내 — 약관 동의 · 관리 화면이 로그인 전이면 여기로 보냅니다. */
export default async function Page({ searchParams }: { searchParams: Search }) {
  const { next, error } = await searchParams;
  const to = safeNext(next);
  if (!error && (await getSession())) redirect(to);
  return (
    <PageShell eyebrow="LOGIN" title="디스코드로 로그인" lead="러크 서버 디스코드 계정으로 로그인합니다. 이름과 프로필 사진만 받습니다.">
      <div className="glass-strong max-w-lg space-y-5 rounded-2xl p-6">
        {error && (
          <p role="alert" className="rounded-lg border border-red-400/40 bg-red-400/10 px-3 py-2 text-[12px] text-red-200">
            {error}
          </p>
        )}
        <a
          href={`/api/auth/login?next=${encodeURIComponent(to)}`}
          className="flex items-center justify-center gap-2 rounded-xl bg-[#5865F2] px-5 py-3 text-[14px] font-bold text-white transition-colors hover:bg-[#4752c4]"
        >
          Discord 로 계속하기
        </a>
        <p className="text-[11.5px] leading-relaxed text-white/55">
          로그인하면 <a href="/policy/privacy" className="underline">개인정보처리방침</a>에 따라 디스코드 사용자 ID · 이름 · 프로필
          사진을 이 브라우저의 로그인 쿠키에만 담습니다. 러크 디스코드의 관리자는 로그인하면 문서 편집 권한을 받습니다.
        </p>
      </div>
    </PageShell>
  );
}
