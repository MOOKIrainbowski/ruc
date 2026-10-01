"use client";

import { useRouter } from "next/navigation";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import type { WikiSearchEntry } from "@/lib/wiki";

/**
 * 클라이언트 측 위키 검색. 문서가 수십 개라 색인을 통째로 내려도 몇 KB 입니다.
 * 띄어쓰기로 나눈 단어가 전부 들어 있는 문서만 보여 주고,
 * 제목 > 설명 > 본문 순으로 점수를 매깁니다.
 */
function score(e: WikiSearchEntry, terms: string[]) {
  const title = e.title.toLowerCase();
  const desc = e.description.toLowerCase();
  const text = e.text.toLowerCase();
  let s = 0;
  for (const t of terms) {
    if (title.includes(t)) s += 10;
    else if (desc.includes(t)) s += 4;
    else if (text.includes(t)) s += 1;
    else return 0;
  }
  return s;
}

function snippet(text: string, term: string) {
  const i = text.toLowerCase().indexOf(term);
  if (i < 0) return text.slice(0, 70);
  const start = Math.max(0, i - 24);
  return (start > 0 ? "…" : "") + text.slice(start, start + 70) + "…";
}

export default function WikiSearch({ index }: { index: WikiSearchEntry[] }) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [cursor, setCursor] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listId = useId();

  const terms = useMemo(() => q.trim().toLowerCase().split(/\s+/).filter(Boolean), [q]);
  const results = useMemo(() => {
    if (terms.length === 0) return [];
    return index
      .map((e) => ({ e, s: score(e, terms) }))
      .filter((r) => r.s > 0)
      .sort((a, b) => b.s - a.s)
      .slice(0, 8)
      .map((r) => r.e);
  }, [terms, index]);

  // "/" 키로 검색창에 바로 들어갑니다 (입력 중일 때는 제외).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (e.key !== "/" || el.closest("input, textarea, [contenteditable]")) return;
      e.preventDefault();
      inputRef.current?.focus();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => setCursor(0), [q]);

  const go = (slug: string) => {
    setQ("");
    router.push(`/wiki/${slug}`);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (results.length === 0) {
      if (e.key === "Escape") setQ("");
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setCursor((c) => (c + 1) % results.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setCursor((c) => (c - 1 + results.length) % results.length);
    } else if (e.key === "Enter") {
      e.preventDefault();
      go(results[cursor].slug);
    } else if (e.key === "Escape") {
      setQ("");
    }
  };

  const open = terms.length > 0;

  return (
    <div className="relative">
      <label htmlFor={`${listId}-input`} className="sr-only">
        위키 검색
      </label>
      <input
        ref={inputRef}
        id={`${listId}-input`}
        type="search"
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={open && results[cursor] ? `${listId}-${results[cursor].slug}` : undefined}
        value={q}
        onChange={(e) => setQ(e.target.value)}
        onKeyDown={onKeyDown}
        placeholder="위키 검색  ( / )"
        autoComplete="off"
        className="glass w-full rounded-xl px-4 py-3 text-[13px] text-white placeholder:text-white/50 focus:border-ruc-400/60"
      />

      {open && (
        <ul
          id={listId}
          role="listbox"
          aria-label="검색 결과"
          className="glass-strong absolute inset-x-0 top-full z-30 mt-2 max-h-[60vh] overflow-y-auto rounded-xl p-1.5"
        >
          {results.length === 0 ? (
            <li className="px-3 py-3 text-[12px] text-white/65">
              &ldquo;{q}&rdquo; 에 맞는 문서가 없습니다.
            </li>
          ) : (
            results.map((r, i) => (
              <li
                key={r.slug}
                id={`${listId}-${r.slug}`}
                role="option"
                aria-selected={i === cursor}
                onMouseDown={(e) => {
                  e.preventDefault(); // 입력창 blur 보다 먼저 이동
                  go(r.slug);
                }}
                onMouseEnter={() => setCursor(i)}
                className={`cursor-pointer rounded-lg px-3 py-2.5 ${
                  i === cursor ? "bg-ruc-400/15" : ""
                }`}
              >
                <p className="text-[12.5px] text-white">
                  {r.title}
                  <span className="ml-2 text-[10px] text-white/55">{r.category}</span>
                </p>
                <p className="mt-0.5 line-clamp-2 text-[11px] leading-snug text-white/65">
                  {snippet(r.text, terms[terms.length - 1])}
                </p>
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  );
}
