import { num, priceText, products, rucPrice, type Product } from "@/lib/charge";

/** 충전 상품 카드 한 장 — /charge/[category] 에서 씁니다. */
export default function ProductCard({ p }: { p: Product }) {
  const ruc = rucPrice(p);
  return (
    <li className={`glass flex flex-col rounded-2xl p-5 sm:p-6 ${p.available ? "" : "opacity-75"}`}>
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="headline text-lg">{p.name}</h3>
        <span className="text-[10px] tracking-wider text-white/60">
          {p.available ? p.period : `${p.period} · 준비 중`}
        </span>
      </div>
      <p className="headline mt-2 text-2xl text-ruc-400">{priceText(p)}</p>
      {ruc !== null && (
        <p className="mt-1 text-[11.5px] text-sky-200">
          또는 <strong>{num(ruc)} RUC</strong>{" "}
          <span className="text-white/60">({products.rucDiscountPercent}% 할인)</span>
        </p>
      )}
      {!p.price && (
        <p className="mt-1 text-[11.5px] text-amber-200/90">
          게임 안에서 <code className="inline-code">/등급 구매 {p.id}</code>
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
  );
}
