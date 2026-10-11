import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import PageShell from "@/components/PageShell";
import { getPolicy, listPolicies } from "@/lib/policy";

type Params = { slug: string };

export function generateStaticParams(): Params[] {
  return listPolicies().map(({ slug }) => ({ slug }));
}
export const dynamicParams = false;

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const { slug } = await params;
  const doc = getPolicy(slug);
  return doc ? { title: `${doc.title} · 러크 서버`, description: doc.description } : {};
}

export default async function Page({ params }: { params: Promise<Params> }) {
  const { slug } = await params;
  const doc = getPolicy(slug);
  if (!doc) notFound();

  return (
    <PageShell
      eyebrow="POLICY"
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
      <div className="grid gap-8 lg:grid-cols-[1fr_220px]">
        <article
          className="wiki-prose glass min-w-0 rounded-2xl px-5 py-6 sm:px-8 sm:py-8"
          // 본문은 저장소 안의 md 파일(운영진 작성)에서만 옵니다 — 이용자 입력이 아닙니다.
          dangerouslySetInnerHTML={{ __html: doc.html }}
        />
        <nav aria-label="정책 문서" className="space-y-2 text-[12px] lg:sticky lg:top-24 lg:self-start">
          <p className="eyebrow mb-3">정책 문서</p>
          {listPolicies().map((p) => (
            <Link
              key={p.slug}
              href={`/policy/${p.slug}`}
              aria-current={p.slug === slug ? "page" : undefined}
              className={`block rounded-lg px-3 py-2 transition-colors ${
                p.slug === slug ? "bg-white/10 text-white" : "text-white/60 hover:text-ruc-400"
              }`}
            >
              {p.title}
            </Link>
          ))}
        </nav>
      </div>
    </PageShell>
  );
}
