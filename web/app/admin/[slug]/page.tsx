import { notFound } from "next/navigation";
import DocEditor from "@/components/DocEditor";
import PageShell from "@/components/PageShell";
import { currentText, docKey, history } from "@/lib/docstore";
import { NotAdmin, requireAdmin } from "@/components/AdminGate";

export const metadata = { title: "문서 편집", robots: { index: false } };

export default async function Page({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const key = docKey(slug);
  if (!key) notFound();
  if (!(await requireAdmin(`/admin/${slug}`))) return <NotAdmin />;
  const [{ text, revision }, revs] = await Promise.all([currentText(slug), history(slug)]);
  return (
    <PageShell
      wide
      eyebrow="ADMIN · 편집"
      title={key.title}
      meta={revision ? `지금 판: ${revision.by} · ${new Date(revision.at).toLocaleString("ko-KR")}` : "지금 판: 저장소 파일"}
    >
      <DocEditor slug={slug} href={key.href} kind={key.kind} initial={text} history={revs} />
    </PageShell>
  );
}
