import PageShell from "@/components/PageShell";
import { getChronicle } from "@/lib/feed";
import { banner } from "@/lib/og";

export const revalidate = 300;

export const metadata = {
  title: "러크 연대기",
  description: "드래곤 알의 주인, 큰 현상금, 새 길드, 레벨 이정표 — 러크 서버의 역사가 저절로 쓰입니다.",
  ...banner("status", "러크 연대기", "러크 서버의 역사가 저절로 쓰입니다."),
};

/** 디스코드 굵게(**…**)만 살립니다 — 연대기 줄은 플러그인이 쓰는 문구라 그 외 서식은 없습니다. */
function Line({ text }: { text: string }) {
  return (
    <>
      {text.split("**").map((part, i) =>
        i % 2 ? <strong key={i} className="text-ruc-300">{part}</strong> : part,
      )}
    </>
  );
}

const DAY = new Intl.DateTimeFormat("ko-KR", { dateStyle: "long", timeZone: "Asia/Seoul" });
const TIME = new Intl.DateTimeFormat("ko-KR", { timeStyle: "short", timeZone: "Asia/Seoul" });

export default async function Page() {
  const entries = await getChronicle();
  // 날짜별로 묶습니다 (최근 날짜부터).
  const days = new Map<string, NonNullable<typeof entries>>();
  for (const e of entries ?? []) {
    const d = DAY.format(new Date(e.at));
    days.set(d, [...(days.get(d) ?? []), e]);
  }

  return (
    <PageShell
      eyebrow="CHRONICLE"
      title="러크 연대기"
      lead={"드래곤 알의 주인이 바뀔 때, 큰 현상금이 걸린 수배자가 쓰러질 때, 새 길드가 세워질 때, 누군가 Lv.50 · Lv.100 에 닿을 때.\n서버의 역사가 여기에 저절로 쓰입니다."}
    >
      {!entries || entries.length === 0 ? (
        <p className="glass rounded-2xl p-6 text-[13px] text-white/70">
          {entries ? "아직 기록이 없습니다. 첫 줄의 주인공이 되어 보세요." : "연대기를 불러오지 못했습니다. 잠시 뒤 다시 와 주세요."}
        </p>
      ) : (
        <div className="space-y-8">
          {[...days].map(([day, list]) => (
            <section key={day}>
              <h2 className="eyebrow mb-3">{day}</h2>
              <ol className="glass divide-y divide-white/5 rounded-2xl">
                {list.map((e) => (
                  <li key={e.id} className="flex gap-4 px-5 py-3 text-[13px] leading-relaxed">
                    <time dateTime={e.at} className="w-14 shrink-0 text-white/50">{TIME.format(new Date(e.at))}</time>
                    <span className="min-w-0 break-words text-white/85"><Line text={e.text} /></span>
                  </li>
                ))}
              </ol>
            </section>
          ))}
        </div>
      )}
    </PageShell>
  );
}
