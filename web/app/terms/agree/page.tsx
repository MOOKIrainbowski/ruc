import Link from "next/link";
import { redirect } from "next/navigation";
import AgreeForm from "@/components/AgreeForm";
import PageShell from "@/components/PageShell";
import { getPolicy } from "@/lib/policy";
import { getSession } from "@/lib/session";
import { checkLink, findAgreement } from "@/lib/terms";

export const metadata = { title: "이용약관 동의", robots: { index: false } };

type Search = Promise<{ u?: string; n?: string; t?: string; s?: string }>;

/**
 * 게임에 처음 들어온 플레이어가 채팅 링크로 오는 곳 (RucCore TermsService).
 * 디스코드 로그인 전이면 로그인 페이지로 보냈다가 이 주소로 돌아옵니다.
 */
export default async function Page({ searchParams }: { searchParams: Search }) {
  const q = await searchParams;
  const why = checkLink(q);
  if (why) {
    return (
      <PageShell eyebrow="TERMS" title="이용약관 동의" lead={why}>
        <Link href="/policy/terms" className="text-[13px] text-ruc-400 underline">
          이용약관 읽기
        </Link>
      </PageShell>
    );
  }
  const link = { u: q.u!, n: q.n!, t: q.t!, s: q.s! };
  const session = await getSession();
  if (!session) redirect(`/login?next=${encodeURIComponent(`/terms/agree?${new URLSearchParams(link)}`)}`);

  const [done, terms] = await Promise.all([findAgreement(link.u).catch(() => null), getPolicy("terms")]);
  return (
    <PageShell
      eyebrow="TERMS"
      title="이용약관 동의"
      lead={`마인크래프트 ${link.n} 계정 · 디스코드 ${session.name} 로 동의합니다.`}
    >
      <div className="space-y-6">
        {done ? (
          <p role="status" className="glass-strong rounded-2xl p-6 text-[14px] text-ruc-200">
            이미 동의하셨습니다 ({new Date(done.at).toLocaleString("ko-KR")}). 게임으로 돌아가셔도 됩니다.
          </p>
        ) : (
          <AgreeForm link={link} />
        )}
        {terms && (
          <details className="glass rounded-2xl px-5 py-4">
            <summary className="cursor-pointer text-[13px] text-white/85">서비스 이용약관 전문 보기 (최종 수정 {terms.updated})</summary>
            <article className="wiki-prose mt-4" dangerouslySetInnerHTML={{ __html: terms.html }} />
          </details>
        )}
      </div>
    </PageShell>
  );
}
