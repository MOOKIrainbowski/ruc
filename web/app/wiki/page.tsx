import Link from "next/link";
import PageShell from "@/components/PageShell";
import WikiLayout from "@/components/WikiLayout";
import { groupedDocs } from "@/lib/wiki";
import { banner } from "@/lib/og";

export const metadata = {
  title: "러크 위키",
  description: "러크 서버 접속 방법, 이용 가이드, 고유 기능, MOOKI 봇 명령어, FAQ.",
  ...banner("wiki", "러크 위키", "러크 서버 접속 방법, 이용 가이드, 고유 기능, MOOKI 봇 명령어, FAQ."),
};

export default function Page() {
  // 첫 분류(시작하기)는 순서대로 읽는 길이라 번호 단계로 따로 강조합니다.
  const [start, ...groups] = groupedDocs();
  return (
    <PageShell
      wide
      eyebrow="RUC WIKI"
      title="러크 위키"
      lead="접속부터 고유 기능까지. 처음이라면 1번부터 차례로."
    >
      <WikiLayout>
        <section aria-labelledby="start-path" className="glass-strong mb-10 rounded-2xl p-5 sm:p-6">
          <h2 id="start-path" className="headline text-base text-ruc-300">
            처음이라면 — {start.category}
          </h2>
          <ol className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {start.docs.map((d, i) => (
              <li key={d.slug}>
                <Link href={`/wiki/${d.slug}`} className="glass glass-hover flex h-full gap-3 rounded-xl p-4">
                  <span
                    aria-hidden="true"
                    className="headline flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-ruc-400 text-[13px] text-ruc-900"
                  >
                    {i + 1}
                  </span>
                  <span>
                    <span className="block text-[13px] text-white">{d.title}</span>
                    <span className="mt-1 block text-[11.5px] leading-relaxed text-white/70">{d.description}</span>
                  </span>
                </Link>
              </li>
            ))}
          </ol>
        </section>

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
