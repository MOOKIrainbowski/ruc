import Link from "next/link";
import PageShell from "@/components/PageShell";
import WikiLayout from "@/components/WikiLayout";
import { groupedDocs } from "@/lib/wiki";

export const metadata = {
  title: "러크 위키",
  description: "러크 서버 접속 방법, 이용 가이드, 고유 기능, MOOKI 봇 명령어, FAQ.",
};

export default function Page() {
  const groups = groupedDocs();
  return (
    <PageShell
      wide
      eyebrow="RUC WIKI"
      title="러크 위키"
      lead="접속 방법부터 러크만의 기능까지. 처음이라면 '시작하기' 부터 읽어 주세요."
    >
      <WikiLayout>
        {/* Wynncraft 위키식 분류 카드 */}
        <div className="space-y-8">
          {groups.map((g) => (
            <section key={g.category} aria-labelledby={`cat-${g.category}`}>
              <h2 id={`cat-${g.category}`} className="headline mb-3 text-base text-ruc-300">
                {g.category}
              </h2>
              <ul className="grid gap-3 sm:grid-cols-2">
                {g.docs.map((d) => (
                  <li key={d.slug}>
                    <Link
                      href={`/wiki/${d.slug}`}
                      className="glass glass-hover block h-full rounded-xl p-4"
                    >
                      <p className="text-[13px] text-white">{d.title}</p>
                      <p className="mt-1.5 text-[11.5px] leading-relaxed text-white/70">
                        {d.description}
                      </p>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      </WikiLayout>
    </PageShell>
  );
}
