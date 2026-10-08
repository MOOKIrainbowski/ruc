"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { search, snippet, toTerms, type SearchEntry } from "@/lib/search";

/**
 * 검색창 — 상단 바(사이트 전체)와 위키(위키 문서만)가 같이 씁니다.
 *
 * - 상단 바: `src` 로 색인을 받아 옵니다. 처음 포커스할 때 한 번만 받습니다.
 *   결과는 입력창 아래에 겹쳐 뜨는 목록(dropdown)이고, 뒤가 비치지 않게 불투명합니다.
 * - 위키: `entries` 를 서버에서 바로 넘깁니다. 결과는 입력창 아래에 끼워 넣어(inline)
 *   아래 내용을 밀어내므로 다른 글자와 겹치지 않습니다.
 *
 * 포커스가 빠지면 결과를 닫습니다. 결과를 누를 때는 mousedown 에서 이동해서
 * 입력창의 blur 보다 먼저 처리됩니다.
 */
export default function SearchBox({
  entries,
  src,
  label,
  placeholder,
  variant = "dropdown",
  hotkey = false,
  autoFocus = false,
  onDone,
  inputClassName = "",
}: {
  entries?: SearchEntry[];
  src?: string;
  label: string;
  placeholder: string;
  variant?: "dropdown" | "inline";
  /** "/" · Ctrl/Cmd+K 로 이 입력창에 바로 들어갑니다. 한 화면에 하나만 켜세요. */
  hotkey?: boolean;
  autoFocus?: boolean;
  /** 결과로 이동했거나 Esc 로 닫았을 때 (휴대폰 상단 바의 펼친 검색창을 접을 때) */
  onDone?: () => void;
  inputClassName?: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [q, setQ] = useState("");
  const [cursor, setCursor] = useState(0);
  const [focused, setFocused] = useState(autoFocus);
  const [loaded, setLoaded] = useState<SearchEntry[] | null>(entries ?? null);
  const [failed, setFailed] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const listId = useId();

  const index = entries ?? loaded;

  const load = () => {
    if (index || !src) return;
    fetch(src)
      .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
      .then((data: SearchEntry[]) => setLoaded(data))
      .catch(() => setFailed(true));
  };

  const terms = useMemo(() => toTerms(q), [q]);
  const results = useMemo(() => (index ? search(index, terms) : []), [index, terms]);

  useEffect(() => {
    if (!hotkey) return;
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      // Ctrl/Cmd+K 는 다른 입력창 안에서도 받습니다 (브라우저 주소창 검색 단축키를 덮음).
      const palette = e.key.toLowerCase() === "k" && (e.ctrlKey || e.metaKey);
      if (!palette && (e.key !== "/" || el.closest("input, textarea, [contenteditable]"))) return;
      e.preventDefault();
      inputRef.current?.focus();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [hotkey]);

  useEffect(() => {
    if (autoFocus) {
      inputRef.current?.focus();
      load();
    }
    // 처음 한 번만
  }, []);

  useEffect(() => setCursor(0), [q]);

  const go = (href: string) => {
    setQ("");
    inputRef.current?.blur();
    onDone?.();
    const [path, hash] = href.split("#");
    // 같은 페이지 안의 #이동(규칙 탭)은 router 로는 hashchange 가 안 생깁니다.
    if (hash && path === pathname) window.location.hash = hash;
    else router.push(href);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      setQ("");
      inputRef.current?.blur();
      onDone?.();
      return;
    }
    if (results.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setCursor((c) => (c + 1) % results.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setCursor((c) => (c - 1 + results.length) % results.length);
    } else if (e.key === "Enter") {
      e.preventDefault();
      go(results[cursor].href);
    }
  };

  const open = focused && terms.length > 0;
  const message = failed
    ? "검색 목록을 불러오지 못했습니다. 잠시 뒤 다시 시도해 주세요."
    : !index
      ? "불러오는 중…"
      : results.length === 0
        ? `“${q}” 에 맞는 결과가 없습니다.`
        : null;

  return (
    <div className="relative">
      <label htmlFor={`${listId}-input`} className="sr-only">
        {label}
      </label>
      {/* 돋보기는 입력창 기준으로 둡니다 — 바깥 div 기준이면 결과가 펼쳐질 때 같이 내려갑니다. */}
      <div className="relative">
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          strokeLinecap="round"
          aria-hidden="true"
          className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-white/50"
        >
          <circle cx="11" cy="11" r="6.5" />
          <path d="m16 16 4.5 4.5" />
        </svg>
        <input
          ref={inputRef}
          id={`${listId}-input`}
          type="search"
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={open && results[cursor] ? `${listId}-${cursor}` : undefined}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={onKeyDown}
          onFocus={() => {
            setFocused(true);
            load();
          }}
          onBlur={() => setFocused(false)}
          placeholder={placeholder}
          autoComplete="off"
          className={`search-input w-full rounded-xl pl-9 pr-3 text-[13px] text-white placeholder:text-white/50 ${inputClassName}`}
        />
      </div>

      {open && (
        <ul
          id={listId}
          role="listbox"
          aria-label="검색 결과"
          className={`search-results rounded-xl p-1.5 ${
            variant === "dropdown"
              ? "absolute inset-x-0 top-full z-50 mt-2 max-h-[70vh] overflow-y-auto"
              : "mt-2"
          }`}
        >
          {message ? (
            <li className="px-3 py-3 text-[12px] text-white/65">{message}</li>
          ) : (
            results.map((r, i) => (
              <li
                key={`${r.href}-${r.title}`}
                id={`${listId}-${i}`}
                role="option"
                aria-selected={i === cursor}
                onMouseDown={(e) => {
                  e.preventDefault(); // 입력창 blur 보다 먼저 이동
                  go(r.href);
                }}
                onMouseEnter={() => setCursor(i)}
                className={`cursor-pointer rounded-lg px-3 py-2.5 ${i === cursor ? "bg-ruc-400/15" : ""}`}
              >
                <p className="text-[12.5px] text-white">
                  {r.title}
                  <span className="ml-2 text-[10px] text-white/55">{r.category}</span>
                </p>
                <p className="mt-0.5 line-clamp-2 text-[11px] leading-snug text-white/65">
                  {snippet(r, terms[terms.length - 1])}
                </p>
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  );
}
