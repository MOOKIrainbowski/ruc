import raw from "@/content/products.json";

// 상품은 content/products.json, 계좌는 환경변수입니다.
// 저장소가 공개라서 계좌번호는 절대 파일에 적지 않습니다 (.env.local / Vercel 환경변수).

export type Product = {
  id: string;
  name: string;
  /** 원 단위 정수 */
  price: number;
  period: string;
  deliver: string[];
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
