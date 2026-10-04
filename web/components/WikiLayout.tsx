import Link from "next/link";
import { groupedDocs, searchIndex, type WikiHeading } from "@/lib/wiki";
import SearchBox from "./SearchBox";

/**
 * 위키 3단 레이아웃 (블릭 · GitBook 패턴).
 * 맨 위: 검색 (가로 전체) / 왼쪽: 문서 목록 / 가운데: 본문 / 오른쪽(xl 이상): 이 문서의 목차
 * 모바일에서는 문서 목록을 접힌 상태로 둡니다.
 *
 * 검색은 사이드바 밖에 둡니다 (2026-10-05). 사이드바는 스크롤 영역이라 포커스 테두리가
 * 잘렸고, 결과 목록이 문서 목록 위에 겹쳐 떴습니다. 지금은 결과가 검색창 아래에
 * 끼워져 아래 내용을 밀어냅니다.
 */
export default function WikiLayout({
  activeSlug,
  toc,
  children,
}: {
  activeSlug?: string;
  toc?: WikiHeading[];
  children: React.ReactNode;
}) {
  const groups = groupedDocs();
  const index = searchIndex();

  const tree = (
    <nav aria-label="위키 문서 목록" className="space-y-5">
      {groups.map((g) => (
        <div key={g.category}>
          <p className="mb-2 text-[10px] tracking-[0.18em] text-ruc-300">{g.category}</p>
          <ul className="space-y-0.5 border-l border-white/10">
            {g.docs.map((d) => {
              const active = d.slug === activeSlug;
              return (
                <li key={d.slug}>
                  <Link
                    href={`/wiki/${d.slug}`}
                    aria-current={active ? "page" : undefined}
                    className={`-ml-px block border-l-2 py-1.5 pl-3 pr-2 text-[12px] leading-snug transition-colors ${
                      active
                        ? "border-ruc-400 text-ruc-400"
                        : "border-transparent text-white/75 hover:border-white/30 hover:text-white"
                    }`}
                  >
                    {d.title}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );

  return (
    <>
      <div className="mb-8 max-w-xl">
        <SearchBox
          entries={index}
          label="위키 검색"
          placeholder="위키 검색  ( / )"
          variant="inline"
          hotkey
          inputClassName="py-3"
        />
      </div>
      <div className="grid gap-8 lg:grid-cols-[220px_minmax(0,1fr)] xl:grid-cols-[220px_minmax(0,1fr)_180px]">
        <aside className="lg:sticky lg:top-24 lg:max-h-[calc(100vh-7rem)] lg:self-start lg:overflow-y-auto lg:pr-2">
          {/* 데스크톱: 펼친 목록 */}
          <div className="hidden lg:block">{tree}</div>
          {/* 모바일: 접힌 목록 */}
          <details className="glass rounded-xl px-4 py-3 lg:hidden">
            <summary className="cursor-pointer text-[12px] text-white/85">문서 목록</summary>
            <div className="mt-4">{tree}</div>
          </details>
        </aside>

        <div className="min-w-0">{children}</div>

        {toc && toc.length > 0 && (
          <aside className="hidden xl:block">
            <nav aria-label="이 문서의 목차" className="sticky top-24">
              <p className="mb-2 text-[10px] tracking-[0.18em] text-white/60">이 문서에서</p>
              <ul className="space-y-1.5 text-[11.5px]">
                {toc.map((h) => (
                  <li key={h.id}>
                    <a href={`#${h.id}`} className="text-white/70 transition-colors hover:text-ruc-400">
                      {h.text}
                    </a>
                  </li>
                ))}
              </ul>
            </nav>
          </aside>
        )}
      </div>
    </>
  );
}
