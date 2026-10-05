import Link from "next/link";
import CopyButton from "@/components/CopyButton";
import PageShell from "@/components/PageShell";
import { bankAccount, chargeEnabled, num, products, rucPrice, won } from "@/lib/charge";
import { DISCORD_INVITE } from "@/lib/content";

export const metadata = {
  title: "충전 · 결제 안내",
  description: "러크 서버 후원 상품과 토스 계좌 입금 방법.",
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
          디스코드에서 <code className="inline-code">/충전</code> 을 입력하고 상품을 고릅니다. 봇이{" "}
          <strong>주문 코드</strong>(예: <code className="inline-code">{code}</code>)와 입금할 금액을
          알려 줍니다. <Link href="/wiki/verify" className="link">계정 인증</Link>을 마친 사람만
          주문할 수 있습니다 — 그래야 누구에게 지급할지 정확히 압니다.
        </>
      ),
    },
    {
      title: "토스 계좌로 입금하기",
      body: (
        <>
          아래 계좌로 <strong>안내받은 금액을 정확히</strong> 보냅니다. 이때{" "}
          <strong>입금자명(받는 분에게 표시)을 주문 코드로</strong> 바꿔 주세요. 주문 후{" "}
          {products.orderTtlMinutes}분 안에 입금해야 합니다.
        </>
      ),
    },
    {
      title: "자동 확인 · 우편함 지급",
      body: (
        <>
          입금이 확인되면 디스코드로 알림이 가고, 상품은{" "}
          <Link href="/wiki/mailbox" className="link">우편함</Link>으로 도착합니다. 접속해 있지 않아도
          우편함에 보관됩니다 (30일).
        </>
      ),
    },
    {
      title: "문제가 생겼다면",
      body: (
        <>
          입금자명을 잘못 적었거나 금액이 다르면 자동 확인이 되지 않습니다. 디스코드{" "}
          <code className="inline-code">/ticket</code> → 문의에 <strong>주문 코드 · 입금 시각 · 금액</strong>
          을 적어 주시면 운영진이 직접 확인합니다.
        </>
      ),
    },
  ];

  return (
    <PageShell
      eyebrow="SUPPORT"
      title="충전 · 결제 안내"
      lead={"러크는 무료 서버입니다. 후원은 서버 운영비로 쓰이고,\n꾸미기 · 편의 상품으로 감사를 표합니다."}
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
        어떤 상품도 전투 능력치 · 장비 · 강화 재료를 주지 않습니다. 후원하지 않은 사람과 싸움에서
        차이가 나지 않습니다.
      </p>

      {/* ─── 상품 ─────────────────────────────────────────── */}
      <section aria-labelledby="products-title">
        <h2 id="products-title" className="headline mb-4 text-xl">
          상품
        </h2>
        <p className="mb-4 text-[12px] leading-relaxed text-white/80">
          <strong className="text-white">Gold</strong> 는 게임에서 버는 화폐이고,{" "}
          <strong className="text-white">RUC</strong> 는 충전으로 얻는 화폐입니다 (가끔 이벤트로도 드립니다).
          VIP · SVIP 는 Gold 로, MVP 이상은 현금 또는 RUC 로 삽니다. RUC 로 사면{" "}
          {products.rucDiscountPercent}% 할인됩니다. 잔고는 게임 안 <code className="inline-code">/등급</code>.
        </p>
        {products.reviewNote && (
          <p className="mb-4 text-[11px] text-amber-200/90">{products.reviewNote}</p>
        )}
        <ul className="grid gap-4 sm:grid-cols-2">
          {products.products.map((p) => (
            <li
              key={p.id}
              className={`glass flex flex-col rounded-2xl p-5 sm:p-6 ${p.available ? "" : "opacity-75"}`}
            >
              <div className="flex items-baseline justify-between gap-3">
                <h3 className="headline text-lg">{p.name}</h3>
                <span className="text-[10px] tracking-wider text-white/60">
                  {p.available ? p.category : `${p.category} · 준비 중`}
                </span>
              </div>
              <p className="mt-2">
                <span className="headline text-2xl text-ruc-400">
                  {p.price ? won(p.price) : `${num(p.gold ?? 0)} Gold`}
                </span>
                <span className="ml-2 text-[11px] text-white/65">/ {p.period}</span>
              </p>
              {rucPrice(p) !== null && (
                <p className="mt-1 text-[11.5px] text-sky-200">
                  또는 <strong>{num(rucPrice(p)!)} RUC</strong>{" "}
                  <span className="text-white/60">({products.rucDiscountPercent}% 할인)</span>
                </p>
              )}
              {!p.price && (
                <p className="mt-1 text-[11.5px] text-amber-200/90">
                  게임 안에서 <code className="inline-code">/등급 구매 {p.id}</code> 로 삽니다
                </p>
              )}
              <ul className="mt-4 space-y-1.5 border-t border-white/10 pt-4 text-[12px] text-white/85">
                {p.deliver.map((d) => (
                  <li key={d} className="flex gap-2">
                    <span aria-hidden="true" className="text-ruc-400">·</span>
                    {d}
                  </li>
                ))}
              </ul>
            </li>
          ))}
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
          <strong className="text-white">입금자명 규칙</strong> — 입금자명에는 닉네임이 아니라{" "}
          <strong className="text-white">주문 코드</strong>만 적습니다. 닉네임은 길어서 은행 앱에서
          잘리고, 같은 이름의 입금이 겹치면 누구의 것인지 알 수 없습니다.
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
          <li>· 다른 사람 명의로 입금하거나 상품을 되파는 것은 금지입니다 (<Link href="/rules" className="link">규칙 0.5</Link>).</li>
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
