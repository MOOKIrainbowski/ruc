import { products } from "@/lib/charge";
import { rules } from "@/lib/rules";
import type { SearchEntry } from "@/lib/search";
import { searchIndex } from "@/lib/wiki";

// 상단 바 검색창의 색인. 빌드할 때 한 번 만들어 정적 파일로 내려갑니다 —
// 내용이 전부 저장소 안의 파일이라 요청마다 다시 만들 이유가 없습니다.
// 검색창에 처음 포커스가 갈 때 한 번만 받아 갑니다 (components/SearchBox.tsx).
export const dynamic = "force-static";

const PAGES: SearchEntry[] = [
  { href: "/home", title: "홈", category: "페이지", description: "러크 서버 이용자 허브 — 충전, 디스코드, 규칙, 위키.", text: "접속 주소 서버 상태" },
  { href: "/rules", title: "서버 규칙", category: "페이지", description: "디스코드 · 마인크래프트 규칙과 제재 단계.", text: "" },
  { href: "/wiki", title: "러크 위키", category: "페이지", description: "접속 방법, 이용 가이드, 고유 기능, MOOKI 봇 명령어, FAQ.", text: "" },
  { href: "/charge", title: "충전 · 결제 안내", category: "페이지", description: "후원 상품과 가격, 토스 계좌 입금 방법.", text: "후원 결제 계좌 입금" },
  { href: "/status", title: "서버 상태", category: "페이지", description: "서버가 켜져 있는지, 지금 몇 명이 접속해 있는지.", text: "온라인 접속자 핑" },
  { href: "/landing", title: "러크 서버 소개", category: "페이지", description: "홈 · 약탈 · 국가전 · 평화. 네 개의 서버, 하나의 경제.", text: "" },
];

function ruleEntries(): SearchEntry[] {
  const out: SearchEntry[] = [];
  for (const s of rules.sections) {
    for (const g of s.groups) {
      out.push({
        // /rules#<분류> 는 그 탭을 열어 줍니다 (components/Rules.tsx).
        href: `/rules#${s.id}`,
        title: `${g.no}. ${g.title}`,
        category: `규칙 · ${s.label}`,
        description: "",
        text: g.rules.map((r) => `${r.no} ${r.text}`).join(" "),
      });
    }
  }
  out.push({
    href: "/rules#sanctions",
    title: rules.sanctions.title,
    category: "규칙",
    description: rules.sanctions.intro,
    text: rules.sanctions.notes.join(" "),
  });
  return out;
}

function productEntries(): SearchEntry[] {
  return products.products.map((p) => ({
    href: "/charge",
    title: p.name,
    category: "충전",
    description: `${p.price ? `${p.price.toLocaleString("ko-KR")}원` : `${(p.gold ?? 0).toLocaleString("ko-KR")} Gold`} · ${p.period}`,
    text: p.deliver.join(" "),
  }));
}

export function GET() {
  // 위키 분류(시작하기 · FAQ …)만 보이면 어디 있는 글인지 모르므로 "위키 · " 를 붙입니다.
  const wiki = searchIndex().map((e) => ({ ...e, category: `위키 · ${e.category}` }));
  const index: SearchEntry[] = [...PAGES, ...wiki, ...ruleEntries(), ...productEntries()];
  return Response.json(index);
}
