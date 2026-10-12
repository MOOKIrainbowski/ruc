import { redirect } from "next/navigation";
import PageShell from "@/components/PageShell";
import { memberAdmin } from "@/lib/discord";
import { getSession } from "@/lib/session";

/** 관리자만 — 아니면 로그인으로 · 로그인했지만 관리자가 아니면 안내. */
export async function requireAdmin(next: string) {
  const s = await getSession();
  if (!s) redirect(`/login?next=${encodeURIComponent(next)}`);
  const m = await memberAdmin(s.id).catch(() => null);
  return m?.admin ? s : null;
}

export function NotAdmin() {
  return (
    <PageShell eyebrow="ADMIN" title="관리자 전용" lead="러크 디스코드에서 관리자 역할(Owner · Manager)이 있는 계정만 들어올 수 있습니다.">
      <a href="/api/auth/logout?next=/login" className="text-[13px] text-ruc-400 underline">
        다른 계정으로 로그인
      </a>
    </PageShell>
  );
}
