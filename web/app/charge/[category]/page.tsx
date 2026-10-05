import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import PageShell from "@/components/PageShell";
import ProductCard from "@/components/ProductCard";
import { CATEGORIES, category, chargeEnabled, products, productsIn } from "@/lib/charge";
import { banner } from "@/lib/og";

type Params = { category: string };

export function generateStaticParams(): Params[] {
  return CATEGORIES.map((c) => ({ category: c.slug }));
}
export const dynamicParams = false;

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const c = category((await params).category);
  return c
    ? { title: `${c.name} · 충전`, description: c.summary, ...banner("charge", `${c.name} · 러크 서버 충전`, c.summary) }
    : {};
}

export default async function Page({ params }: { params: Promise<Params> }) {
  const c = category((await params).category);
  if (!c) notFound();
  const list = productsIn(c.slug);

  return (
    <PageShell eyebrow="SUPPORT · 충전" title={c.name} lead={c.summary}>
      {/* 세 묶음 사이를 오가는 탭 */}
      <nav aria-label="충전 상품 분류" className="mb-8 flex flex-wrap gap-2">
        <Link href="/charge" className="glass glass-hover rounded-lg px-3.5 py-2 text-xs text-white/80">
          ← 충전 안내
        </Link>
        {CATEGORIES.map((x) => (
          <Link
            key={x.slug}
            href={`/charge/${x.slug}`}
            aria-current={x.slug === c.slug ? "page" : undefined}
            className={
              x.slug === c.slug
                ? "rounded-lg bg-ruc-400 px-3.5 py-2 text-xs font-bold text-ruc-900"
                : "glass glass-hover rounded-lg px-3.5 py-2 text-xs text-white/90"
            }
          >
            {x.glyph} {x.name}
          </Link>
        ))}
      </nav>

      {!chargeEnabled() && (
        <p
          role="note"
          className="mb-6 rounded-xl border border-amber-400/40 bg-amber-400/10 px-4 py-3 text-[12px] leading-relaxed text-amber-100"
        >
          충전은 아직 준비 중입니다. 아래 상품 구성은 미리보기입니다.
        </p>
      )}
      {products.reviewNote && <p className="mb-4 text-[11px] text-amber-200/90">{products.reviewNote}</p>}

      <ul className="grid gap-4 sm:grid-cols-2">
        {list.map((p) => (
          <ProductCard key={p.id} p={p} />
        ))}
      </ul>

      <p className="glass mt-8 rounded-xl px-4 py-3 text-[12px] leading-relaxed text-white/80">
        구매: 디스코드 <code className="inline-code">/충전</code> · Gold 상품은 게임{" "}
        <code className="inline-code">/등급 구매</code> ·{" "}
        <Link href="/charge#steps-title" className="link">
          입금 절차
        </Link>
      </p>
    </PageShell>
  );
}
