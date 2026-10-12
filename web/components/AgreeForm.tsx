"use client";

import { useState } from "react";

/** 이용약관 동의 버튼 — 게임이 준 링크 값(u · n · t · s)을 그대로 보냅니다. */
export default function AgreeForm({ link }: { link: { u: string; n: string; t: string; s: string } }) {
  const [checked, setChecked] = useState(false);
  const [state, setState] = useState<{ busy?: boolean; done?: boolean; error?: string }>({});

  async function agree() {
    setState({ busy: true });
    const res = await fetch("/api/terms/agree", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(link),
    }).catch(() => null);
    const body = res ? await res.json().catch(() => ({})) : { error: "서버에 연결하지 못했습니다" };
    setState(res?.ok ? { done: true } : { error: body.error || `실패 (${res?.status})` });
  }

  if (state.done) {
    return (
      <p role="status" className="glass-strong rounded-2xl p-6 text-[14px] text-ruc-200">
        <strong className="text-ruc-300">{link.n}</strong> 님, 동의해 주셔서 감사합니다. 게임 안에는 1분 안에 반영됩니다.
      </p>
    );
  }
  return (
    <div className="glass-strong space-y-4 rounded-2xl p-6">
      <label className="flex items-start gap-3 text-[13px] leading-relaxed text-white/85">
        <input
          type="checkbox"
          checked={checked}
          onChange={(e) => setChecked(e.target.checked)}
          className="mt-1 h-4 w-4 accent-[#93e93e]"
        />
        <span>
          <a href="/policy/terms" target="_blank" className="text-ruc-300 underline">서비스 이용약관</a>,{" "}
          <a href="/policy/privacy" target="_blank" className="text-ruc-300 underline">개인정보처리방침</a>,{" "}
          <a href="/policy/operation" target="_blank" className="text-ruc-300 underline">운영정책</a>을 읽었고 동의합니다.
          <span className="mt-1 block text-[11.5px] text-white/55">
            만 14세 미만이면{" "}
            <a href="/policy/guardian-consent" target="_blank" className="underline">보호자 동의 절차</a>를 먼저 거쳐 주세요.
          </span>
        </span>
      </label>
      <button
        onClick={agree}
        disabled={!checked || state.busy}
        className="rounded-lg bg-ruc-400 px-5 py-2.5 text-[13px] font-bold text-ruc-900 transition-colors hover:bg-ruc-300 disabled:opacity-40"
      >
        {state.busy ? "처리 중…" : `${link.n} 계정으로 동의하기`}
      </button>
      {state.error && <p role="alert" className="text-[12px] text-red-300">{state.error}</p>}
    </div>
  );
}
