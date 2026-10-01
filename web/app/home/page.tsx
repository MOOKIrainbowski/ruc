import Link from "next/link";
import CopyButton from "@/components/CopyButton";
import PageShell from "@/components/PageShell";
import StatusStrip from "@/components/StatusStrip";
import { DISCORD_INVITE, MC_ADDRESS } from "@/lib/content";

export const metadata = {
  title: "홈",
  description: "러크 서버 이용자 허브 — 충전, 디스코드, 규칙, 위키.",
};

type Card = {
  href: string;
  title: string;
  desc: string;
  /** 카드 왼쪽 위 픽셀 글리프 */
  glyph: string;
  external?: boolean;
};

const CARDS: Card[] = [
  {
    href: "/charge",
    title: "충전 · 결제 안내",
    desc: "후원 상품과 가격, 토스 계좌 입금 방법을 안내합니다.",
    glyph: "₩",
  },
  {
    href: DISCORD_INVITE,
    title: "디스코드 서버",
    desc: "공지 · 인증 · 신고 · 길드 모집. 접속 전에 꼭 들어와 주세요.",
    glyph: "#",
    external: true,
  },
  {
    href: "/rules",
    title: "서버 규칙",
    desc: "디스코드와 마인크래프트에서 지켜야 할 것, 어기면 받는 제재.",
    glyph: "§",
  },
  {
    href: "/wiki",
    title: "러크 위키",
    desc: "접속 방법부터 Shift+F 메뉴, 우편함, 칭호, MOOKI 명령어까지.",
    glyph: "?",
  },
];

const cardClass =
  "glass glass-hover group flex h-full flex-col rounded-2xl p-6 sm:p-7";

function CardBody({ card }: { card: Card }) {
  return (
    <>
      <div className="mb-5 flex items-center justify-between">
        <span
          aria-hidden="true"
          className="headline flex h-11 w-11 items-center justify-center rounded-lg border border-ruc-400/40 bg-ruc-400/10 text-lg text-ruc-400"
        >
          {card.glyph}
        </span>
        <span
          aria-hidden="true"
          className="text-sm text-white/40 transition-transform group-hover:translate-x-1 group-hover:text-ruc-400"
        >
          {card.external ? "↗" : "→"}
        </span>
      </div>
      <h2 className="headline text-lg sm:text-xl">{card.title}</h2>
      <p className="mt-2 text-[12px] leading-relaxed text-white/70">{card.desc}</p>
    </>
  );
}

export default function Page() {
  return (
    <PageShell
      eyebrow="RUC HUB"
      title={"무엇을 찾고 계신가요?"}
      lead="러크 서버를 이용하는 데 필요한 곳을 한데 모았습니다."
    >
      <ul className="grid gap-4 sm:grid-cols-2">
        {CARDS.map((card) => (
          <li key={card.href}>
            {card.external ? (
              <a href={card.href} target="_blank" rel="noopener noreferrer" className={cardClass}>
                <CardBody card={card} />
                <span className="sr-only"> (새 창)</span>
              </a>
            ) : (
              <Link href={card.href} className={cardClass}>
                <CardBody card={card} />
              </Link>
            )}
          </li>
        ))}
      </ul>

      {/* 자주 쓰는 것: 접속 주소 + 실시간 상태 */}
      <section aria-label="접속 정보" className="mt-10 space-y-4">
        <div className="glass flex flex-wrap items-center justify-between gap-3 rounded-2xl px-5 py-4">
          <div>
            <p className="text-[10px] tracking-widest text-white/60">접속 주소 · Java 1.21.x</p>
            <p className="mt-1 text-sm text-white">{MC_ADDRESS}</p>
          </div>
          <CopyButton
            value={MC_ADDRESS}
            label="접속 주소 복사"
            toastText="접속 주소를 복사했습니다"
            className="rounded-lg bg-ruc-400 px-4 py-2.5 text-xs font-bold text-ruc-900 transition-colors hover:bg-ruc-300"
          >
            주소 복사
          </CopyButton>
        </div>
        <StatusStrip lang="ko" />
      </section>
    </PageShell>
  );
}
