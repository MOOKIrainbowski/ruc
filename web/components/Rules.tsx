"use client";

import { useEffect, useRef, useState } from "react";
import CopyButton from "@/components/CopyButton";
import { SITE_RULES, sectionText, type Rule, type RuleSection, type RulesData } from "@/lib/rules";

/** "4~6단계" → 4. 숫자가 없으면(— · 자동) null */
function severity(sanction: string): number | null {
  const m = sanction.match(/(\d+)/);
  return m ? Number(m[1]) : null;
}

function badgeClass(sanction: string) {
  const n = severity(sanction);
  if (n === null) return "border-white/15 bg-white/5 text-white/70";
  if (n <= 3) return "border-ruc-400/35 bg-ruc-400/10 text-ruc-300";
  if (n <= 7) return "border-amber-400/35 bg-amber-400/10 text-amber-200";
  return "border-red-400/40 bg-red-500/10 text-red-300";
}

const ACTION_BTN =
  "rounded-lg border border-white/15 bg-white/5 px-3 py-1.5 text-[11px] text-white/80 transition-colors hover:bg-white/10 hover:text-white";

/** 섹션 하나를 .txt 로 복사 · 다운로드 — 디스코드 공지에 붙이거나 보관용. */
export function TextActions({ text, filename, label }: { text: string; filename: string; label: string }) {
  const download = () => {
    // BOM 을 붙여야 윈도우 메모장이 한글을 UTF-8 로 엽니다.
    const url = URL.createObjectURL(new Blob([String.fromCharCode(0xfeff) + text], { type: "text/plain;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  };
  return (
    <div className="flex flex-wrap gap-2">
      <CopyButton value={text} label={`${label} 규칙 복사`} toastText={`${label} 규칙을 복사했습니다`} className={ACTION_BTN}>
        복사
      </CopyButton>
      <button type="button" onClick={download} aria-label={`${label} 규칙 .txt 다운로드`} className={ACTION_BTN}>
        .txt 다운로드
      </button>
    </div>
  );
}

export default function Rules({ data }: { data: RulesData }) {
  const ids = data.sections.map((s) => s.id);
  const [active, setActive] = useState(ids[0]);
  const [q, setQ] = useState("");
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);

  // #discord 는 그 탭을, #rule-0.5 는 그 조항이 있는 탭을 열고 조항으로 내려갑니다 (디스코드 공지에 링크 걸기).
  useEffect(() => {
    const fromHash = () => {
      const h = decodeURIComponent(window.location.hash.slice(1));
      if (ids.includes(h)) return setActive(h);
      const no = h.startsWith("rule-") ? h.slice(5) : null;
      const owner = no && data.sections.find((s) => s.groups.some((g) => g.rules.some((r) => r.no === no)));
      if (!owner) return;
      setQ("");
      setActive(owner.id);
      // 탭이 바뀐 뒤에야 조항이 화면에 생깁니다.
      requestAnimationFrame(() => document.getElementById(h)?.scrollIntoView({ block: "center" }));
    };
    fromHash();
    window.addEventListener("hashchange", fromHash);
    return () => window.removeEventListener("hashchange", fromHash);
    // ids 는 정적 데이터라 다시 계산할 필요가 없습니다.
  }, []);

  const select = (id: string, focus = false) => {
    setQ("");
    setActive(id);
    history.replaceState(null, "", `#${id}`);
    if (focus) tabRefs.current[ids.indexOf(id)]?.focus();
  };

  // WAI-ARIA 탭 패턴: ←/→ 로 이동, Home/End 로 처음·끝
  const onKeyDown = (e: React.KeyboardEvent, i: number) => {
    const last = ids.length - 1;
    const next =
      e.key === "ArrowRight" ? (i === last ? 0 : i + 1)
      : e.key === "ArrowLeft" ? (i === 0 ? last : i - 1)
      : e.key === "Home" ? 0
      : e.key === "End" ? last
      : null;
    if (next === null) return;
    e.preventDefault();
    select(ids[next], true);
  };

  const section = data.sections.find((s) => s.id === active) ?? data.sections[0];

  // 검색 중에는 탭과 상관없이 모든 분류에서 찾습니다 — 어느 탭에 있는지 몰라도 되게.
  const terms = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const matches = (r: Rule) => terms.every((t) => `${r.no} ${r.text} ${r.sanction}`.toLowerCase().includes(t));
  const shown: RuleSection[] = terms.length
    ? data.sections
        .map((s) => ({ ...s, groups: s.groups.map((g) => ({ ...g, rules: g.rules.filter(matches) })).filter((g) => g.rules.length) }))
        .filter((s) => s.groups.length)
    : [section];
  const hits = shown.reduce((n, s) => n + s.groups.reduce((m, g) => m + g.rules.length, 0), 0);

  return (
    <div>
      <label htmlFor="rule-filter" className="sr-only">
        규칙 검색
      </label>
      <input
        id="rule-filter"
        type="search"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        onKeyDown={(e) => e.key === "Escape" && setQ("")}
        placeholder="조항 검색 — 예: 부계정 · 매크로 · 8단계"
        autoComplete="off"
        className="search-input mb-3 h-10 w-full rounded-xl px-4 text-[13px] text-white placeholder:text-white/50"
      />
      <div
        role="tablist"
        aria-label="규칙 분류"
        className="glass sticky top-[4.5rem] z-10 flex gap-1 overflow-x-auto rounded-xl p-1"
      >
        {data.sections.map((s, i) => {
          const selected = s.id === active;
          return (
            <button
              key={s.id}
              ref={(el) => {
                tabRefs.current[i] = el;
              }}
              type="button"
              role="tab"
              id={`tab-${s.id}`}
              aria-selected={selected}
              aria-controls={`panel-${s.id}`}
              tabIndex={selected ? 0 : -1}
              onClick={() => select(s.id)}
              onKeyDown={(e) => onKeyDown(e, i)}
              className={`flex-1 whitespace-nowrap rounded-lg px-4 py-2.5 text-xs transition-colors ${
                selected
                  ? "bg-ruc-400 font-bold text-ruc-900"
                  : "text-white/75 hover:bg-white/6 hover:text-white"
              }`}
            >
              {s.label}
            </button>
          );
        })}
      </div>

      <div
        role="tabpanel"
        id={`panel-${section.id}`}
        aria-labelledby={`tab-${section.id}`}
        tabIndex={0}
        className="mt-6"
      >
        {terms.length === 0 ? (
          <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <p className="text-[12px] leading-relaxed text-white/70">{section.intro}</p>
            <TextActions
              text={sectionText(data, section)}
              filename={`ruc-rules-${section.id}.txt`}
              label={section.label}
            />
          </div>
        ) : (
          <p role="status" className="mb-6 text-[12px] text-white/70">
            {hits > 0 ? `모든 분류에서 ${hits}개 조항을 찾았습니다.` : `“${q}” 에 맞는 조항이 없습니다.`}
          </p>
        )}

        <div className="space-y-6">
          {shown.flatMap((s) => s.groups.map((g) => ({ s, g }))).map(({ s, g }) => (
            <section key={g.no} aria-labelledby={`g-${g.no}`} className="glass rounded-2xl p-5 sm:p-7">
              <h2 id={`g-${g.no}`} className="headline flex items-baseline gap-3 text-base sm:text-lg">
                <span className="text-ruc-400">{g.no}.</span>
                {g.title}
                {terms.length > 0 && <span className="text-[11px] font-normal text-white/55">{s.label}</span>}
              </h2>
              <ol className="mt-4 divide-y divide-white/8">
                {g.rules.map((r) => (
                  <li
                    key={r.no}
                    id={`rule-${r.no}`}
                    className="flex scroll-mt-40 flex-col gap-2 py-3.5 target:rounded-lg target:bg-ruc-400/10 sm:flex-row sm:items-start sm:gap-4"
                  >
                    {/* 번호를 누르면 이 조항으로 바로 오는 링크를 복사합니다 (#rule-0.5). */}
                    <CopyButton
                      value={`${SITE_RULES}#rule-${r.no}`}
                      label={`${r.no} 조항 링크 복사`}
                      toastText={`${r.no} 조항 링크를 복사했습니다`}
                      className="group/no flex w-12 shrink-0 items-center gap-1 self-start text-left text-[11px] text-ruc-300 hover:text-ruc-200"
                    >
                      {r.no}
                      <span aria-hidden="true" className="text-white/0 transition-colors group-hover/no:text-white/50 group-focus-visible/no:text-white/50">#</span>
                    </CopyButton>
                    <p className="flex-1 text-[12.5px] leading-relaxed text-white/90">{r.text}</p>
                    <span
                      className={`self-start whitespace-nowrap rounded-full border px-2.5 py-1 text-[10px] ${badgeClass(
                        r.sanction,
                      )}`}
                    >
                      <span className="sr-only">제재: </span>
                      {r.sanction}
                    </span>
                  </li>
                ))}
              </ol>
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}
