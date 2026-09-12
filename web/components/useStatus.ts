"use client";

import { useCallback, useEffect, useState } from "react";
import type { StatusPayload } from "@/lib/servers";

/** /api/status 폴링. 서버 상태는 자주 바뀌므로 45초마다 갱신합니다. */
export function useStatus(intervalMs = 45_000) {
  const [data, setData] = useState<StatusPayload | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/status", { cache: "no-store" });
      if (!res.ok) throw new Error(String(res.status));
      setData((await res.json()) as StatusPayload);
    } catch {
      // 조회 실패 시 직전 값을 유지합니다. 화면이 갑자기 비는 것보다 낫습니다.
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    const id = setInterval(load, intervalMs);
    // 탭을 다시 보면 즉시 갱신
    const onVisible = () => document.visibilityState === "visible" && load();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [load, intervalMs]);

  return { data, loading, reload: load };
}
