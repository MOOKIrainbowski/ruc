import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,

  // 정책 · 규칙 페이지가 요청 시점에(ISR) content/ 파일을 읽습니다 — 서버 함수에 같이 실어 보냅니다.
  outputFileTracingIncludes: { "/**": ["./content/policy/**", "./content/rules.json"] },

  // 랜딩(홍보)과 홈(이용자 허브)을 분리했습니다 (2026-10-01).
  // `/` 는 지금 랜딩으로 보냅니다. 나중에 `/home` 으로 바꿀 수 있게
  // 영구(308)가 아니라 임시(307) 리디렉트입니다 — 308 은 브라우저가 캐시합니다.
  async redirects() {
    return [
      { source: "/", destination: "/landing", permanent: false },
      { source: "/en", destination: "/en/landing", permanent: false },
      // 단수형으로 적는 사람이 많아서 (2026-10-05) — 404 면 링크 미리보기도 기본 아이콘이 됩니다.
      { source: "/rule", destination: "/rules", permanent: true },
    ];
  },
};

export default nextConfig;
