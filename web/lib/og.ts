import type { Metadata } from "next";

/**
 * 디스코드 · SNS 링크 미리보기 큰 이미지 (1200×628, public/banner/).
 * 페이지에서 openGraph 를 주면 layout 의 openGraph 를 통째로 덮으므로 제목 · 설명도 같이 넣습니다.
 */
export function banner(image: "wiki" | "status" | "rules", title: string, description: string): Metadata {
  const url = `/banner/ruc${image}.png`;
  return {
    openGraph: {
      title,
      description,
      type: "website",
      siteName: "러크 서버",
      images: [{ url, width: 1200, height: 628, alt: title }],
    },
    twitter: { card: "summary_large_image", title, description, images: [url] },
  };
}
