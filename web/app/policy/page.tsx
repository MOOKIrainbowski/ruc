import Link from "next/link";
import PageShell from "@/components/PageShell";
import { listPolicies } from "@/lib/policy";

export const metadata = {
  title: "정책 · 약관",
  description: "러크 서버 이용약관, 개인정보처리방침, 환불 정책, 운영정책, 보호자 동의 절차.",
};

export default function Page() {
  return (
    <PageShell eyebrow="POLICY" title="정책 · 약관" lead="러크 서버를 이용할 때 적용되는 약관과 정책입니다.">
      <ul className="grid gap-3 sm:grid-cols-2">
        {listPolicies().map((p) => (
          <li key={p.slug}>
            <Link href={`/policy/${p.slug}`} className="glass glass-hover block h-full rounded-xl p-5">
              <p className="text-[14px] text-white">{p.title}</p>
              <p className="mt-1.5 text-[11.5px] leading-relaxed text-white/70">{p.description}</p>
            </Link>
          </li>
        ))}
      </ul>
    </PageShell>
  );
}
