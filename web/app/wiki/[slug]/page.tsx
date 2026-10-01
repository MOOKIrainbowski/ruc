import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import PageShell from "@/components/PageShell";
import WikiLayout from "@/components/WikiLayout";
import { getDoc, listDocs, listSlugs } from "@/lib/wiki";

type Params = { slug: string };

// content/wiki 에 md 를 넣으면 빌드할 때 페이지가 생깁니다.
export function generateStaticParams(): Params[] {
  return listSlugs().map((slug) => ({ slug }));
}
export const dynamicParams = false;

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const { slug } = await params;
  const doc = getDoc(slug);
  if (!doc) return {};
  return { title: `${doc.title} · 위키`, description: doc.description };
}

export default async function Page({ params }: { params: Promise<Params> }) {
  const { slug } = await params;
  const doc = getDoc(slug);
  if (!doc) notFound();

  // 이전 / 다음 문서 (사이드바와 같은 순서)
  const all = listDocs();
  const i = all.findIndex((d) => d.slug === slug);
  const prev = i > 0 ? all[i - 1] : null;
  const next = i < all.length - 1 ? all[i + 1] : null;

  return (
    <PageShell
      wide
      eyebrow={`WIKI · ${doc.category}`}
      title={doc.title}
      lead={doc.description}
      meta={
        doc.updated && (
          <>
            최종 수정 <time dateTime={doc.updated}>{doc.updated}</time>
          </>
        )
      }
    >
      <WikiLayout activeSlug={slug} toc={doc.headings}>
        <article
          className="wiki-prose glass rounded-2xl px-5 py-6 sm:px-8 sm:py-8"
          // 본문은 저장소 안의 md 파일(운영진 작성)에서만 옵니다 — 이용자 입력이 아닙니다.
          dangerouslySetInnerHTML={{ __html: doc.html }}
        />

        <nav aria-label="이전 · 다음 문서" className="mt-6 grid gap-3 sm:grid-cols-2">
          {prev ? (
            <Link href={`/wiki/${prev.slug}`} className="glass glass-hover rounded-xl px-4 py-3">
              <span className="block text-[10px] text-white/60">← 이전</span>
              <span className="mt-1 block text-[12.5px] text-white">{prev.title}</span>
            </Link>
          ) : (
            <span />
          )}
          {next && (
            <Link
              href={`/wiki/${next.slug}`}
              className="glass glass-hover rounded-xl px-4 py-3 text-right"
            >
              <span className="block text-[10px] text-white/60">다음 →</span>
              <span className="mt-1 block text-[12.5px] text-white">{next.title}</span>
            </Link>
          )}
        </nav>
      </WikiLayout>
    </PageShell>
  );
}
