import Footer from "./Footer";
import Nav from "./Nav";

/**
 * 한국어 전용 페이지(/home /rules /wiki /charge)의 공통 뼈대.
 * 랜딩·상태 페이지와 같은 Nav · Footer 를 씁니다.
 */
export default function PageShell({
  eyebrow,
  title,
  lead,
  meta,
  wide = false,
  children,
}: {
  eyebrow: string;
  title: string;
  lead?: string;
  /** 제목 아래 작은 줄 — 최종 수정일 등 */
  meta?: React.ReactNode;
  /** 위키처럼 사이드바가 있는 페이지 */
  wide?: boolean;
  children: React.ReactNode;
}) {
  return (
    <>
      <Nav lang="ko" />
      <main className="pt-16">
        <div
          className={`mx-auto w-full px-4 pt-12 pb-20 sm:px-6 sm:pt-16 ${
            wide ? "max-w-6xl" : "max-w-4xl"
          }`}
        >
          <header className="mb-10">
            <p className="eyebrow mb-3">{eyebrow}</p>
            <h1 className="headline whitespace-pre-line text-3xl sm:text-5xl">{title}</h1>
            {lead && (
              <p className="mt-4 max-w-2xl whitespace-pre-line text-[13px] leading-relaxed text-white/75">
                {lead}
              </p>
            )}
            {meta && <div className="mt-4 text-[11px] text-white/60">{meta}</div>}
          </header>
          {children}
        </div>
      </main>
      <Footer lang="ko" />
    </>
  );
}
