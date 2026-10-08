import Link from "next/link";
import CopyButton from "@/components/CopyButton";
import PageShell from "@/components/PageShell";
import { bankAccount, CATEGORIES, chargeEnabled, products, productsIn } from "@/lib/charge";
import { DISCORD_INVITE } from "@/lib/content";
import { banner } from "@/lib/og";

export const metadata = {
  title: "충전 · 결제 안내",
  description: "러크 서버 멤버 등급 · RUC 충전 · 편의 상품과 토스 계좌 입금 방법.",
  ...banner("charge", "러크 서버 충전 · 결제 안내", "멤버 등급 · RUC 충전 · 편의 상품과 토스 계좌 입금 방법."),
};

const btnPrimary =
  "rounded-lg bg-ruc-400 px-4 py-2.5 text-xs font-bold text-ruc-900 transition-colors hover:bg-ruc-300";
const btnGhost =
  "glass glass-hover rounded-lg px-4 py-2.5 text-xs text-white/90";

export default function Page() {
  const enabled = chargeEnabled();
  const account = enabled ? bankAccount() : null;
  const code = `${products.orderCodePrefix}4821`;

  const steps = [
    {
      title: "디스코드에서 주문하기",
      body: (
        <>
          디스코드 <code className="inline-code">/충전</code> → 상품 선택 → <strong>주문 코드</strong>(예:{" "}
          <code className="inline-code">{code}</code>) · 금액 안내.{" "}
          <Link href="/wiki/verify" className="link">계정 인증</Link> 필수.
        </>
      ),
    },
    {
      title: "토스 계좌로 입금하기",
      body: (
        <>
          <strong>정확한 금액</strong> 입금 · <strong>입금자명 = 주문 코드</strong> ·{" "}
          {products.orderTtlMinutes}분 이내.
        </>
      ),
    },
    {
      title: "자동 확인 · 우편함 지급",
      body: (
        <>
          확인 시 디스코드 알림 · <Link href="/wiki/mailbox" className="link">우편함</Link> 지급 (30일 보관).
        </>
      ),
    },
    {
      title: "문제가 생겼다면",
      body: (
        <>
          입금자명 · 금액이 다르면 수동 확인. 디스코드 <code className="inline-code">/ticket</code> →{" "}
          <strong>주문 코드 · 입금 시각 · 금액</strong>.
        </>
      ),
    },
  ];

  return (
    <PageShell
      eyebrow="SUPPORT"
      title="충전 · 결제 안내"
      lead={"무료 서버. 판매 수익은 운영비로 쓰입니다."}
    >
      {!enabled && (
        <p
          role="note"
          className="mb-8 rounded-xl border border-amber-400/40 bg-amber-400/10 px-4 py-3 text-[12px] leading-relaxed text-amber-100"
        >
          충전은 아직 준비 중입니다. 열리면 디스코드 공지로 알려 드립니다. 아래 상품 구성은 미리보기입니다.
        </p>
      )}

      {/* Tebex 스토어 공통 패턴 — 상품 위에 원칙을 고정합니다 */}
      <p className="glass mb-8 flex items-start gap-2.5 rounded-xl px-4 py-3 text-[12px] leading-relaxed text-ruc-200">
        <span aria-hidden="true" className="text-ruc-400">✓</span>
        전투 능력치 · 장비 · 강화 재료는 판매하지 않습니다.
      </p>

      {/* ─── 상품 분류 — 누르면 /charge/<분류> ───────────────── */}
      <section aria-labelledby="products-title">
        <h2 id="products-title" className="headline mb-4 text-xl">
          상품
        </h2>
        <p className="mb-5 text-[12px] leading-relaxed text-white/80">
          <strong className="text-white">Gold</strong> = 게임 화폐 · <strong className="text-white">RUC</strong> = 충전
          화폐 (RUC 결제 {products.rucDiscountPercent}% 할인) · 잔고 <code className="inline-code">/등급</code>
        </p>
        <ul className="grid gap-4 sm:grid-cols-3">
          {CATEGORIES.map((c) => {
            const list = productsIn(c.slug);
            return (
              <li key={c.slug}>
                <Link
                  href={`/charge/${c.slug}`}
                  className="glass glass-hover group flex h-full flex-col rounded-2xl p-5 sm:p-6"
                >
                  <span aria-hidden="true" className="headline text-2xl text-ruc-400">
                    {c.glyph}
                  </span>
                  <h3 className="headline mt-3 text-lg">{c.name}</h3>
                  <p className="mt-2 flex-1 text-[12px] leading-relaxed text-white/75">{c.summary}</p>
                  <p className="mt-4 text-[11px] text-white/60">
                    상품 {list.length}개 · {list.map((p) => p.name).join(" · ")}
                  </p>
                  <span className="mt-4 inline-block rounded-lg bg-ruc-400 px-4 py-2.5 text-center text-xs font-bold text-ruc-900 transition-colors group-hover:bg-ruc-300">
                    상품 보기 →
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      </section>

      {/* ─── 입금 계좌 ─────────────────────────────────────── */}
      <section aria-labelledby="account-title" className="mt-14">
        <h2 id="account-title" className="headline mb-4 text-xl">
          입금 계좌
        </h2>

        {account ? (
          <div className="glass-strong rounded-2xl p-5 sm:p-7">
            <dl className="grid gap-4 sm:grid-cols-3">
              <div>
                <dt className="text-[10px] tracking-widest text-white/60">은행</dt>
                <dd className="mt-1 text-sm text-white">{account.bank}</dd>
              </div>
              <div className="sm:col-span-2">
                <dt className="text-[10px] tracking-widest text-white/60">계좌번호</dt>
                <dd className="headline mt-1 text-xl tracking-wide text-ruc-300 sm:text-2xl">
                  {account.number}
                </dd>
              </div>
              <div>
                <dt className="text-[10px] tracking-widest text-white/60">예금주</dt>
                <dd className="mt-1 text-sm text-white">{account.holder}</dd>
              </div>
              <div className="sm:col-span-2">
                <dt className="text-[10px] tracking-widest text-white/60">입금자명</dt>
                <dd className="mt-1 text-sm text-white">
                  주문 코드 <span className="text-white/65">(예: {code})</span>
                </dd>
              </div>
            </dl>

            <div className="mt-6 flex flex-wrap gap-2.5">
              {/* 숫자만 복사 — 은행 앱마다 하이픈 처리가 달라서 */}
              <CopyButton
                value={account.number.replace(/\D/g, "")}
                label="계좌번호 복사"
                toastText="계좌번호를 복사했습니다"
                className={btnPrimary}
              >
                계좌번호 복사
              </CopyButton>
              {/* 토스 · 대부분의 은행 앱은 "은행명 계좌번호" 를 붙여 넣으면 은행까지 자동으로 고릅니다 */}
              <CopyButton
                value={`${account.bank} ${account.number.replace(/\D/g, "")}`}
                label="은행명과 계좌번호 함께 복사"
                toastText="은행명과 계좌번호를 복사했습니다"
                className={btnGhost}
              >
                은행명 + 계좌번호 복사
              </CopyButton>
            </div>
          </div>
        ) : (
          <div className="glass rounded-2xl p-5 text-[12px] leading-relaxed text-white/75">
            {enabled
              ? "계좌 정보가 아직 설정되지 않았습니다. 운영진에게 문의해 주세요."
              : "충전이 열리면 여기에 입금 계좌가 표시됩니다."}
          </div>
        )}
      </section>

      {/* ─── 입금 절차 ─────────────────────────────────────── */}
      <section aria-labelledby="steps-title" className="mt-14">
        <h2 id="steps-title" className="headline mb-4 text-xl">
          입금 절차
        </h2>
        <ol className="space-y-3">
          {steps.map((s, i) => (
            <li key={s.title} className="glass flex gap-4 rounded-2xl p-5">
              <span
                aria-hidden="true"
                className="headline flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-ruc-400/40 bg-ruc-400/10 text-ruc-400"
              >
                {i + 1}
              </span>
              <div>
                <h3 className="text-[13.5px] font-bold text-white">{s.title}</h3>
                <p className="mt-1.5 text-[12px] leading-relaxed text-white/80">{s.body}</p>
              </div>
            </li>
          ))}
        </ol>

        <div className="mt-5 rounded-xl border border-ruc-400/30 bg-ruc-400/8 px-4 py-3 text-[12px] leading-relaxed text-ruc-100">
          <strong className="text-white">입금자명 = 주문 코드</strong> (닉네임 X)
        </div>
      </section>

      {/* ─── 유의사항 ──────────────────────────────────────── */}
      <section aria-labelledby="notice-title" className="mt-14">
        <h2 id="notice-title" className="headline mb-4 text-xl">
          유의사항
        </h2>
        <ul className="glass space-y-2.5 rounded-2xl p-5 text-[11.5px] leading-relaxed text-white/80 sm:p-6">
          <li>· 상품은 지급된 순간 사용이 시작된 것으로 봅니다. 지급 전에는 전액 환불됩니다.</li>
          <li>· 지급 후 서버 오류로 상품을 쓸 수 없게 되면 남은 기간만큼 연장하거나 환불합니다.</li>
          <li>· 만 19세 미만은 보호자의 동의를 받고 후원해 주세요. 보호자 동의 없는 결제는 환불을 요청할 수 있습니다.</li>
          <li>· 제재(7단계 이상)를 받으면 후원 혜택이 정지됩니다. 이미 받은 혜택은 환불되지 않습니다.</li>
          <li>· 다른 사람 명의로 입금하거나 상품을 되파는 것은 금지입니다 (<Link href="/rules" className="link">규칙 0.5 · 0.11</Link>).</li>
          <li className="text-white/60">· TODO: 운영진 검토 — 통신판매업 신고번호 · 사업자 정보 · 환불 정책 확정 후 기재</li>
        </ul>
        <p className="mt-5 text-[12px] text-white/75">
          문의는{" "}
          <a href={DISCORD_INVITE} target="_blank" rel="noopener noreferrer" className="link">
            디스코드
          </a>{" "}
          <code className="inline-code">/ticket</code> 으로 해 주세요.
        </p>
      </section>
    </PageShell>
  );
}
