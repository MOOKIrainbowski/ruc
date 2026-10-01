import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,

  // 랜딩(홍보)과 홈(이용자 허브)을 분리했습니다 (2026-10-01).
  // `/` 는 지금 랜딩으로 보냅니다. 나중에 `/home` 으로 바꿀 수 있게
  // 영구(308)가 아니라 임시(307) 리디렉트입니다 — 308 은 브라우저가 캐시합니다.
  async redirects() {
    return [
      { source: "/", destination: "/landing", permanent: false },
      { source: "/en", destination: "/en/landing", permanent: false },
    ];
  },
};

export default nextConfig;
