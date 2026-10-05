import raw from "@/content/products.json";

// 상품은 content/products.json, 계좌는 환경변수입니다.
// 저장소가 공개라서 계좌번호는 절대 파일에 적지 않습니다 (.env.local / Vercel 환경변수).

export type Product = {
  id: string;
  name: string;
  /** 원 단위 정수. 없으면 현금 · RUC 로 팔지 않는 상품 (Gold 전용) */
  price?: number;
  /** Gold 가격 — 게임 안 /등급 구매 (실제 값은 RucCore config.yml rank-shop) */
  gold?: number;
  period: string;
  deliver: string[];
  /** member · ruc · convenience (CATEGORIES) */
  category: string;
  /** false 면 '준비 중' — 봇도 주문을 받지 않습니다 */
  available: boolean;
  /** 마크 서버 지급 명세 (봇이 읽음). 웹에서는 쓰지 않습니다. */
  grants: string;
  discordRoles: string[];
};

export type ProductsData = {
  reviewNote?: string;
  /** 입금자명 = 접두 + 주문 코드 4자리 (예: R4821) */
  orderCodePrefix: string;
  /** 주문 후 이 시간 안에 입금해야 합니다 */
  orderTtlMinutes: number;
  /** RUC 로 사면 깎아 주는 비율 (%) */
  rucDiscountPercent: number;
  products: Product[];
};

export const products: ProductsData = raw;

export type BankAccount = { bank: string; number: string; holder: string };

/**
 * 충전 기능을 켰는지. Vercel Hobby 는 상업적 이용이 금지라서(docs/03-DEPLOY.md),
 * 통신판매업 신고와 요금제가 정리되기 전까지 운영에서는 꺼 둡니다 (Q5).
 */
export function chargeEnabled() {
  return process.env.CHARGE_ENABLED === "true";
}

/** 세 값이 다 있어야 계좌를 보여 줍니다. 하나라도 빠지면 null. */
export function bankAccount(): BankAccount | null {
  const bank = process.env.TOSS_BANK?.trim();
  const number = process.env.TOSS_ACCOUNT?.trim();
  const holder = process.env.TOSS_HOLDER?.trim();
  if (!bank || !number || !holder) return null;
  return { bank, number, holder };
}

export function won(n: number) {
  return `${n.toLocaleString("ko-KR")}원`;
}

/** RUC 결제 가격 (1 RUC = 1원). RUC 충전 상품 · 현금 가격 없는 상품은 null. 봇(payment.js)과 같은 계산. */
export function rucPrice(p: Product): number | null {
  if (!p.price || /(^|,)ruc:/.test(p.grants)) return null;
  return Math.round((p.price * (100 - products.rucDiscountPercent)) / 100);
}

export function num(n: number) {
  return n.toLocaleString("ko-KR");
}

/** 충전 페이지의 세 묶음. 상품의 category 가 slug 입니다. 순서 = 화면 순서. */
export type Category = { slug: string; name: string; summary: string; glyph: string };

export const CATEGORIES: Category[] = [
  {
    slug: "member",
    name: "멤버 등급",
    summary: "VIP · SVIP 는 게임에서 번 Gold 로, MVP 이상은 현금 또는 RUC 로. 30일 단위입니다.",
    glyph: "★",
  },
  {
    slug: "ruc",
    name: "RUC 충전",
    summary: "1 RUC = 1원. MVP 이상 등급과 상품을 RUC 로 사면 할인됩니다.",
    glyph: "◆",
  },
  {
    slug: "convenience",
    name: "편의",
    summary: "엔더상자 확장 · 후원 칭호처럼 한 번 사면 계속 쓰는 상품입니다.",
    glyph: "✚",
  },
];

export function category(slug: string): Category | undefined {
  return CATEGORIES.find((c) => c.slug === slug);
}

export function productsIn(slug: string): Product[] {
  return products.products.filter((p) => p.category === slug);
}

/** 상품 한 줄 가격 — 현금이 있으면 원, 없으면 Gold. */
export function priceText(p: Product) {
  return p.price ? won(p.price) : `${num(p.gold ?? 0)} Gold`;
}
