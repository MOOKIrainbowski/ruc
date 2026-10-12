import Link from "next/link";
import { NotAdmin, requireAdmin } from "@/components/AdminGate";
import PageShell from "@/components/PageShell";
import { editableDocs, history } from "@/lib/docstore";

export const metadata = { title: "관리", robots: { index: false } };

export default async function Page() {
  const s = await requireAdmin("/admin");
  if (!s) return <NotAdmin />;
  const docs = await Promise.all(editableDocs().map(async (d) => ({ ...d, last: (await history(d.slug, 1))[0] })));
  return (
    <PageShell eyebrow="ADMIN" title="문서 관리" lead={`${s.name} 님 — 저장하면 웹사이트에 바로 반영됩니다. 모든 판은 디스코드 🗂️ㅣ웹문서 채널에 남습니다.`}>
      <ul className="grid gap-3 sm:grid-cols-2">
        {docs.map((d) => (
          <li key={d.slug}>
            <Link href={`/admin/${d.slug}`} className="glass glass-hover block h-full rounded-xl p-5">
              <p className="text-[14px] text-white">{d.title}</p>
              <p className="mt-1.5 text-[11.5px] text-white/60">
                {d.last ? `웹 편집 ${d.last.by} · ${new Date(d.last.at).toLocaleString("ko-KR")}` : "저장소 파일 그대로"}
              </p>
            </Link>
          </li>
        ))}
      </ul>
    </PageShell>
  );
}
