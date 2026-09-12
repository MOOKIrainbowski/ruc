"use client";

import { SERVER_KEYS, t, type Lang } from "@/lib/content";
import { useStatus } from "./useStatus";

/**
 * 히어로 바로 아래 얇은 실시간 상태 띠 (D8 #2).
 * "지금 살아있는 서버"라는 증거 역할을 합니다.
 */
export default function StatusStrip({ lang }: { lang: Lang }) {
  const c = t(lang);
  const { data, loading } = useStatus();

  return (
    <div className="glass mx-auto flex max-w-4xl flex-wrap items-center justify-center gap-x-5 gap-y-2.5 rounded-2xl px-5 py-3 text-[11px]">
      <span className="eyebrow !text-[10px]">{c.strip.label}</span>

      {SERVER_KEYS.map((key) => {
        const s = data?.servers.find((x) => x.key === key);
        const online = Boolean(s?.online);
        return (
          <span key={key} className="flex items-center gap-1.5">
            <span className={`dot ${online ? "dot-on" : "dot-off"}`} aria-hidden="true" />
            <span className={online ? "text-white/90" : "text-white/45"}>
              {c.status.serverLabels[key]}
            </span>
            {online && (
              <span className="text-ruc-400">
                {s?.players}
                {lang === "ko" ? c.strip.players : ""}
              </span>
            )}
          </span>
        );
      })}

      {loading && <span className="text-white/40">{c.strip.loading}</span>}
    </div>
  );
}
