import PageShell from "@/components/PageShell";
import Rules, { TextActions } from "@/components/Rules";
import { rules, sanctionsText } from "@/lib/rules";
import { banner } from "@/lib/og";

export const metadata = {
  title: "서버 규칙",
  description: "러크 서버 디스코드 · 마인크래프트 규칙과 제재 단계.",
  ...banner("rules", "러크 서버 규칙", "러크 서버 디스코드 · 마인크래프트 규칙과 제재 단계."),
};

/** 단계가 오를수록 진해지는 붉은 배경 (히트맵) — 1단계 거의 투명, 10단계 0.25 */
function heat(tier: number) {
  return { backgroundColor: `rgba(239, 68, 68, ${(tier * 0.025).toFixed(3)})` };
}

function tierClass(tier: number) {
  if (tier <= 3) return "text-ruc-300";
  if (tier <= 7) return "text-amber-200";
  return "text-red-300";
}

export default function Page() {
  const { sanctions } = rules;
  return (
    <PageShell
      eyebrow="RULES"
      title="서버 규칙"
      lead={rules.intro}
      meta={
        <>
          최종 수정 <time dateTime={rules.updatedAt}>{rules.updatedAt}</time>
        </>
      }
    >
      {rules.reviewNote && (
        <p
          role="note"
          className="mb-8 rounded-xl border border-amber-400/40 bg-amber-400/10 px-4 py-3 text-[12px] leading-relaxed text-amber-100"
        >
          {rules.reviewNote}
        </p>
      )}

      <Rules data={rules} />

      <section id="sanctions" aria-labelledby="sanctions-title" className="mt-14">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <h2 id="sanctions-title" className="headline text-xl sm:text-2xl">
            {sanctions.title}
          </h2>
          <TextActions text={sanctionsText(rules)} filename="ruc-rules-sanctions.txt" label={sanctions.title} />
        </div>
        <p className="mt-3 max-w-2xl text-[12px] leading-relaxed text-white/70">{sanctions.intro}</p>

        {/* 휴대폰: 단계마다 카드. sm 이상: 표 */}
        <ol className="mt-6 space-y-2.5 sm:hidden">
          {sanctions.tiers.map((t) => (
            <li key={t.tier} className="glass rounded-xl p-4 text-[11.5px]" style={heat(t.tier)}>
              <p className={`headline text-sm ${tierClass(t.tier)}`}>{t.tier}단계</p>
              <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
                <dt className="text-white/60">디스코드</dt>
                <dd className="text-white/90">{t.discord}</dd>
                <dt className="text-white/60">마인크래프트</dt>
                <dd className="text-white/90">{t.minecraft}</dd>
                <dt className="text-white/60">Gold 몰수</dt>
                <dd className="text-white/85">{t.confiscate}</dd>
                {t.extra !== "—" && (
                  <>
                    <dt className="text-white/60">추가</dt>
                    <dd className="text-white/80">{t.extra}</dd>
                  </>
                )}
              </dl>
            </li>
          ))}
        </ol>

        <div className="glass mt-6 hidden overflow-x-auto rounded-2xl sm:block" tabIndex={0} aria-label="제재 단계 표">
          <table className="w-full min-w-[640px] text-left text-[11.5px]">
            <thead className="border-b border-white/12 text-[10px] tracking-wider text-white/60">
              <tr>
                <th scope="col" className="px-4 py-3">단계</th>
                <th scope="col" className="px-4 py-3">디스코드</th>
                <th scope="col" className="px-4 py-3">마인크래프트</th>
                <th scope="col" className="px-4 py-3">Gold 몰수</th>
                <th scope="col" className="px-4 py-3">추가</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/8">
              {sanctions.tiers.map((t) => (
                <tr key={t.tier} style={heat(t.tier)}>
                  <th scope="row" className={`headline px-4 py-3 ${tierClass(t.tier)}`}>
                    {t.tier}
                  </th>
                  <td className="px-4 py-3 text-white/90">{t.discord}</td>
                  <td className="px-4 py-3 text-white/90">{t.minecraft}</td>
                  <td className="px-4 py-3 text-white/80">{t.confiscate}</td>
                  <td className="px-4 py-3 text-white/70">{t.extra}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <ul className="mt-5 space-y-2 text-[11.5px] leading-relaxed text-white/70">
          {sanctions.notes.map((n) => (
            <li key={n} className="flex gap-2">
              <span aria-hidden="true" className="text-ruc-400">
                ·
              </span>
              {n}
            </li>
          ))}
        </ul>
      </section>
    </PageShell>
  );
}
