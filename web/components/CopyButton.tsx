"use client";

import { useEffect, useRef, useState } from "react";

/**
 * 클립보드 복사.
 *
 * Clipboard API 는 HTTPS(또는 localhost)에서만 있고, 일부 인앱 브라우저
 * (카카오톡·디스코드 내장 브라우저 등)에서는 권한 오류로 거부됩니다.
 * 모바일에서 계좌번호를 복사하는 사람이 대부분 그 경로로 들어오므로,
 * 실패하면 숨긴 textarea + execCommand 로 한 번 더 시도합니다.
 */
async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* 아래 대체 경로로 */
  }
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    // iOS 는 화면 밖 요소를 선택하지 못해서, 화면 안에 투명하게 둡니다.
    ta.style.position = "fixed";
    ta.style.top = "0";
    ta.style.left = "0";
    ta.style.opacity = "0";
    ta.style.fontSize = "16px"; // iOS 확대 방지
    document.body.appendChild(ta);
    ta.select();
    ta.setSelectionRange(0, text.length);
    const ok = document.execCommand("copy");
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}

export default function CopyButton({
  value,
  label,
  toastText,
  failText = "복사하지 못했습니다. 길게 눌러 직접 복사해 주세요.",
  className = "",
  children,
}: {
  value: string;
  /** 버튼의 접근성 이름 */
  label: string;
  /** 복사 성공 토스트 문구 */
  toastText: string;
  failText?: string;
  className?: string;
  children: React.ReactNode;
}) {
  const [toast, setToast] = useState<{ ok: boolean } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  const onClick = async () => {
    const ok = await copyText(value);
    setToast({ ok });
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setToast(null), ok ? 1800 : 4000);
  };

  return (
    <>
      <button type="button" onClick={onClick} aria-label={label} className={className}>
        {children}
      </button>

      {/* 스크린리더도 결과를 듣도록 live region 은 항상 둡니다. */}
      <div
        role="status"
        aria-live="polite"
        className="pointer-events-none fixed inset-x-0 bottom-6 z-[60] flex justify-center px-4"
      >
        {toast && (
          <span
            className={`glass-strong rounded-full px-5 py-3 text-xs ${
              toast.ok ? "text-ruc-300" : "text-amber-300"
            }`}
          >
            {toast.ok ? `✓ ${toastText}` : failText}
          </span>
        )}
      </div>
    </>
  );
}
