"use client";

import { useEffect, useRef, useState } from "react";
import CopyButton from "@/components/CopyButton";
import { sectionText, type RulesData } from "@/lib/rules";

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
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);

  // #discord 처럼 주소로 바로 탭을 열 수 있게 합니다 (디스코드 공지에 링크 걸기).
  useEffect(() => {
    const fromHash = () => {
      const h = window.location.hash.slice(1);
      if (ids.includes(h)) setActive(h);
    };
    fromHash();
    window.addEventListener("hashchange", fromHash);
    return () => window.removeEventListener("hashchange", fromHash);
    // ids 는 정적 데이터라 다시 계산할 필요가 없습니다.
  }, []);

  const select = (id: string, focus = false) => {
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

  return (
    <div>
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
        <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <p className="text-[12px] leading-relaxed text-white/70">{section.intro}</p>
          <TextActions
            text={sectionText(data, section)}
            filename={`ruc-rules-${section.id}.txt`}
            label={section.label}
          />
        </div>

        <div className="space-y-6">
          {section.groups.map((g) => (
            <section key={g.no} aria-labelledby={`g-${g.no}`} className="glass rounded-2xl p-5 sm:p-7">
              <h2 id={`g-${g.no}`} className="headline flex items-baseline gap-3 text-base sm:text-lg">
                <span className="text-ruc-400">{g.no}.</span>
                {g.title}
              </h2>
              <ol className="mt-4 divide-y divide-white/8">
                {g.rules.map((r) => (
                  <li
                    key={r.no}
                    id={`rule-${r.no}`}
                    className="flex flex-col gap-2 py-3.5 sm:flex-row sm:items-start sm:gap-4"
                  >
                    <span className="w-10 shrink-0 text-[11px] text-ruc-300">{r.no}</span>
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
