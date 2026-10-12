"use client";

import { useEffect, useState } from "react";

export type Me = { id: string; name: string; avatar: string | null; admin: boolean } | null;

// 한 페이지에서 여러 곳(상단 바 · 편집 링크)이 써도 요청은 한 번
let cached: Promise<Me> | null = null;

/** 로그인 상태. undefined = 아직 모름. */
export function useMe(): Me | undefined {
  const [me, setMe] = useState<Me | undefined>(undefined);
  useEffect(() => {
    cached ??= fetch("/api/auth/me", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .catch(() => null);
    cached.then(setMe);
  }, []);
  return me;
}
