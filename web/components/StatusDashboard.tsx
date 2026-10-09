"use client";

import { useEffect, useState } from "react";
import { DISCORD_INVITE, MC_ADDRESS, SERVER_KEYS, t, type Lang } from "@/lib/content";
import Nav from "./Nav";
import Footer from "./Footer";
import RaidFeedPanel from "./RaidFeedPanel";
import { useStatus } from "./useStatus";

export default function StatusDashboard({ lang }: { lang: Lang }) {
  const c = t(lang);
  const { data, loading, reload, loadedAt, intervalMs } = useStatus();
  const [copied, setCopied] = useState(false);
  // 다음 자동 갱신까지 남은 초
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  const left = loadedAt ? Math.max(0, Math.ceil((loadedAt + intervalMs - now) / 1000)) : null;

  const anyOnline = data?.servers.some((s) => s.online) ?? false;

  const copyAddress = async () => {
    try {
      await navigator.clipboard.writeText(MC_ADDRESS);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      /* 무시 — 주소는 화면에 이미 보입니다. */
    }
  };

  const updated = data
    ? new Date(data.fetchedAt).toLocaleTimeString(lang === "ko" ? "ko-KR" : "en-US")
    : c.status.never;

  return (
    <>
      <Nav lang={lang} />

      <main className="pt-16">
        <div className="mx-auto w-full max-w-6xl px-4 py-12 sm:px-6 sm:py-20">
          <p className="eyebrow mb-3">{c.status.network}</p>
          <h1 className="headline text-2xl sm:text-4xl">{c.status.title}</h1>
          <p className="mt-3 max-w-xl text-[13px] leading-relaxed text-white/60">
            {c.status.lead}
          </p>

          {/* ─── 요약 3칸 ──────────────────────────────────── */}
          <div className="mt-9 grid gap-3 sm:grid-cols-3">
            <div className="glass-strong rounded-2xl p-5">
              <p className="text-[10px] tracking-widest text-white/60">
                {c.status.totalOnline}
              </p>
              {/* 픽셀 폰트는 디자인 크기(11px)의 정수배에서 가장 또렷합니다 → 33px */}
              <p className="headline mt-2 leading-none" style={{ fontSize: "33px" }}>
                <span className={anyOnline ? "accent" : "text-white/55"}>
                  {loading && !data ? "—" : (data?.totalOnline ?? 0)}
                </span>
              </p>
            </div>

            <button
              onClick={copyAddress}
              className="glass glass-hover rounded-2xl p-5 text-left"
            >
              <p className="text-[10px] tracking-widest text-white/60">{c.status.address}</p>
              <p className="mt-2 text-sm text-white/95">{MC_ADDRESS}</p>
              <p className="mt-1 text-[10px] text-ruc-400">
                {copied ? c.hero.copied : c.hero.copyAddress}
              </p>
            </button>

            <div className="glass rounded-2xl p-5">
              <p className="text-[10px] tracking-widest text-white/60">
                {c.status.lastUpdated}
              </p>
              <p className="mt-2 text-sm text-white/85">{updated}</p>
              <div className="mt-1 flex items-center gap-3 text-[10px]">
                <button onClick={reload} className="text-ruc-400 transition-opacity hover:opacity-70">
                  {c.status.refresh}
                </button>
                {left !== null && (
                  <span className="text-white/60" aria-hidden="true">
                    {lang === "ko" ? `${left}초 뒤 자동` : `auto in ${left}s`}
                  </span>
                )}
              </div>
              {/* 진행 막대 — 자동 갱신까지 */}
              {left !== null && (
                <div className="mt-2 h-0.5 w-full overflow-hidden rounded-full bg-white/10" aria-hidden="true">
                  <div
                    className="h-full bg-ruc-400/70 transition-[width] duration-1000 ease-linear"
                    style={{ width: `${100 - (left * 1000 * 100) / intervalMs}%` }}
                  />
                </div>
              )}
            </div>
          </div>

          {/* ─── 서버별 카드 ───────────────────────────────── */}
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            {SERVER_KEYS.map((key) => {
              const s = data?.servers.find((x) => x.key === key);
              const online = Boolean(s?.online);
              const configured = s?.configured ?? false;

              return (
                <div key={key} className="glass rounded-2xl p-6">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <h2 className="headline text-lg">{c.status.serverLabels[key]}</h2>
                      <p className="mt-1 text-[11px] text-white/60">
                        {c.status.serverDesc[key]}
                      </p>
                    </div>
                    <span className="flex shrink-0 items-center gap-1.5 text-[11px]">
                      <span className={`dot ${online ? "dot-on" : "dot-off"}`} aria-hidden="true" />
                      <span className={online ? "text-ruc-400" : "text-white/60"}>
                        {online ? c.strip.online : c.strip.offline}
                      </span>
                    </span>
                  </div>

                  {online ? (
                    <>
                      {/* 인원 게이지 */}
                      <div className="mt-5 h-1.5 w-full overflow-hidden rounded-full bg-white/10">
                        <div
                          className="h-full rounded-full bg-ruc-400 transition-[width] duration-500"
                          style={{
                            width: `${Math.min(
                              100,
                              s!.maxPlayers > 0 ? (s!.players / s!.maxPlayers) * 100 : 0,
                            )}%`,
                          }}
                        />
                      </div>
                      <dl className="mt-4 grid grid-cols-3 gap-3 text-[11px]">
                        <div>
                          <dt className="text-white/60">{c.status.players}</dt>
                          <dd className="mt-0.5 text-white/90">
                            {s!.players} / {s!.maxPlayers}
                          </dd>
                        </div>
                        <div>
                          <dt className="text-white/60">{c.status.latency}</dt>
                          <dd className="mt-0.5 text-white/90">
                            {s!.latencyMs !== null ? `${s!.latencyMs}ms` : "—"}
                          </dd>
                        </div>
                        <div>
                          <dt className="text-white/60">{c.status.version}</dt>
                          <dd className="mt-0.5 truncate text-white/90">{s!.version ?? "—"}</dd>
                        </div>
                      </dl>
                    </>
                  ) : (
                    <p className="mt-5 text-[11px] text-white/60">
                      {configured ? c.strip.offline : c.status.offlineNote}
                    </p>
                  )}
                </div>
              );
            })}
          </div>

          {/* ─── 드래곤 알 · 현상금 (게임 → 디스코드 피드) — 문구가 한국어라 한국어 페이지만 ─── */}
          {lang === "ko" && <RaidFeedPanel />}

          {/* ─── 공지 + 바로가기 ───────────────────────────── */}
          <div className="mt-4 grid gap-3 lg:grid-cols-[2fr_1fr]">
            <div className="glass rounded-2xl p-6">
              <p className="eyebrow mb-4">{c.status.notices}</p>
              {/* 타임라인 — 왼쪽 세로줄 + 점 */}
              <ul className="space-y-3.5 border-l border-white/15 pl-4">
                {c.status.noticeItems.map((n, i) => (
                  <li
                    key={i}
                    className="relative flex flex-wrap items-baseline gap-x-3 gap-y-1 before:absolute before:-left-[21px] before:top-1.5 before:h-2 before:w-2 before:rounded-full before:bg-ruc-400 first:before:shadow-[0_0_8px_#93e93e]"
                  >
                    <span className="text-[10px] text-white/60">{n.date}</span>
                    <span className="rounded-full bg-ruc-400/15 px-2 py-0.5 text-[9px] text-ruc-300">
                      {n.tag}
                    </span>
                    <span className="text-[12px] text-white/80">{n.title}</span>
                  </li>
                ))}
              </ul>
            </div>

            <div className="glass rounded-2xl p-6">
              <p className="eyebrow mb-4">{c.status.quickLinks}</p>
              <div className="space-y-2.5">
                <a
                  href={DISCORD_INVITE}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="block rounded-xl bg-ruc-400 px-4 py-3 text-center text-[11px] font-bold text-ruc-900 transition-colors hover:bg-ruc-300"
                >
                  {c.nav.goToServer}
                </a>
                <a
                  href="/home"
                  className="glass glass-hover block rounded-xl px-4 py-3 text-center text-[11px] text-white/80"
                >
                  {c.nav.home}
                </a>
              </div>
            </div>
          </div>
        </div>
      </main>

      <Footer lang={lang} />
    </>
  );
}
