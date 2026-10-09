"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { formatReign, type RaidFeed } from "@/lib/feed";

/**
 * 상태 페이지의 드래곤 알 · 현상금 칸 (docs/08 A · B). /api/feed 를 1분마다 다시 읽고,
 * "몇 시간째" 는 1초마다 화면에서 셉니다. 피드가 없으면(설정 전 · 서버 꺼짐) 설명만.
 */
export default function RaidFeedPanel() {
  const [feed, setFeed] = useState<RaidFeed | null | undefined>(undefined);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const load = () =>
      fetch("/api/feed")
        .then((r) => (r.ok ? r.json() : null))
        .then(setFeed)
        .catch(() => setFeed(null));
    load();
    const poll = setInterval(load, 60_000);
    const tick = setInterval(() => setNow(Date.now()), 1000);
    return () => {
      clearInterval(poll);
      clearInterval(tick);
    };
  }, []);

  // 피드가 30분 넘게 안 왔으면 약탈 서버가 꺼진 것으로 봅니다.
  const stale = feed && now - feed.at > 30 * 60_000;
  const holder = feed?.egg.holder;
  const reign = feed?.egg.since ? Math.max(0, Math.floor((now - feed.egg.since) / 1000)) : 0;

  return (
    <div className="mt-4 grid gap-3 lg:grid-cols-2">
      <div className="glass rounded-2xl p-6">
        <p className="eyebrow mb-4">드래곤 알 · {feed?.season ?? "S1"}</p>
        {feed === undefined ? (
          <p className="text-[12px] text-white/60">불러오는 중…</p>
        ) : !feed || stale ? (
          <p className="text-[12px] leading-relaxed text-white/70">
            약탈 서버에 단 하나. 쥐고 있는 시간이 쌓이고, 시즌 1위는 광장에 이름이 남습니다.{" "}
            <Link href="/wiki/raid" className="link">자세히</Link>
          </p>
        ) : (
          <>
            <p className="text-[11px] text-white/60">지금 주인</p>
            <p className="headline mt-1 text-2xl">
              {holder ? <span className="accent">{holder}</span> : <span className="text-white/60">없음 — 차지하러 오세요</span>}
            </p>
            {holder && (
              <p className="mt-1 text-[11px] text-white/70">
                {feed.egg.online ? `${formatReign(reign)}째 통치 중` : "접속 종료 — 알은 그의 인벤토리에"}
              </p>
            )}
            {feed.top.length > 0 && (
              <ol className="mt-4 space-y-1 text-[12px]">
                {feed.top.map((t, i) => (
                  <li key={t.name} className="flex justify-between gap-3">
                    <span className={i === 0 ? "text-ruc-300" : "text-white/85"}>
                      {i + 1}. {t.name}
                    </span>
                    <span className="text-white/60">{formatReign(t.seconds)}</span>
                  </li>
                ))}
              </ol>
            )}
          </>
        )}
      </div>

      <div className="glass rounded-2xl p-6">
        <p className="eyebrow mb-4">현상금</p>
        {feed && !stale ? (
          <>
            <p className="text-[11px] text-white/60">현상금 풀</p>
            <p className="headline mt-1 text-2xl text-amber-200">{feed.bounty.pool.toLocaleString("ko-KR")} Gold</p>
            <p className="mt-1 text-[11px] text-white/70">지금 수배자 {feed.bounty.wanted}명 · 처치하면 풀의 10% (최소 2,000)</p>
            <Link href="/chronicle" className="link mt-3 inline-block text-[11px]">러크 연대기 →</Link>
          </>
        ) : (
          <p className="text-[12px] leading-relaxed text-white/70">
            평판 보라 이하는 약탈 서버의 수배자. 현상금은 제재로 몰수된 Gold 에서 나옵니다.{" "}
            <Link href="/wiki/raid" className="link">자세히</Link>
          </p>
        )}
      </div>
    </div>
  );
}
