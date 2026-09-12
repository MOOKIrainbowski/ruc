import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL("https://ruc-server.vercel.app"),
  title: {
    default: "러크 서버 — 4개의 세계, 하나의 경제",
    template: "%s · 러크 서버",
  },
  description:
    "홈 · 레이드 · 국가전 · 평화. 네 개의 마인크래프트 서버가 하나의 화폐 Ruc로 이어집니다. 전투 능력치는 팔지 않습니다.",
  icons: { icon: "/icon.png", apple: "/icon.png" },
  openGraph: {
    title: "러크 서버 — 4개의 세계, 하나의 경제",
    description: "홈 · 레이드 · 국가전 · 평화. 네 개의 서버, 하나의 경제.",
    images: ["/icon.png"],
    type: "website",
  },
};

export const viewport: Viewport = {
  themeColor: "#0a1207",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko">
      <head>
        <link
          rel="preload"
          href="/fonts/Galmuri11.woff2"
          as="font"
          type="font/woff2"
          crossOrigin="anonymous"
        />
        <link
          rel="preload"
          href="/fonts/Galmuri11-Bold.woff2"
          as="font"
          type="font/woff2"
          crossOrigin="anonymous"
        />
      </head>
      <body>
        <div className="bg-layer" aria-hidden="true" />
        <div className="bg-tint" aria-hidden="true" />
        {children}
      </body>
    </html>
  );
}
