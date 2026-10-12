"use client";

import { useState } from "react";

type Revision = { id: string; by: string; at: number; url: string };

/** 관리자 문서 편집기 — 저장하면 디스코드 저장 채널에 새 판이 올라가고 페이지가 바로 갱신됩니다. */
export default function DocEditor({
  slug,
  href,
  kind,
  initial,
  history,
}: {
  slug: string;
  href: string;
  kind: "md" | "json";
  initial: string;
  history: Revision[];
}) {
  const [text, setText] = useState(initial);
  const [saved, setSaved] = useState(initial);
  const [state, setState] = useState<{ busy?: boolean; ok?: boolean; error?: string }>({});

  async function save() {
    setState({ busy: true });
    const res = await fetch(`/api/admin/docs/${slug}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    }).catch(() => null);
    const body = res ? await res.json().catch(() => ({})) : { error: "서버에 연결하지 못했습니다" };
    if (res?.ok) setSaved(text);
    setState(res?.ok ? { ok: true } : { error: body.error || `저장 실패 (${res?.status})` });
  }

  function download() {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([text], { type: "text/plain;charset=utf-8" }));
    a.download = `${slug}.${kind}`;
    a.click();
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_260px]">
      <div className="min-w-0 space-y-3">
        <textarea
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            setState({});
          }}
          spellCheck={false}
          aria-label="문서 본문"
          className="glass h-[70vh] w-full resize-y rounded-2xl p-5 font-mono text-[12.5px] leading-relaxed text-white/90 outline-none focus:ring-2 focus:ring-ruc-400/50"
        />
        <div className="flex flex-wrap items-center gap-3 text-[12px]">
          <button
            onClick={save}
            disabled={text === saved || state.busy}
            className="rounded-lg bg-ruc-400 px-4 py-2 font-bold text-ruc-900 transition-colors hover:bg-ruc-300 disabled:opacity-40"
          >
            {state.busy ? "저장 중…" : "저장 · 바로 공개"}
          </button>
          <button onClick={download} className="rounded-lg border border-white/15 px-3 py-2 text-white/75 hover:text-white">
            현재 판 내려받기
          </button>
          <a href={href} target="_blank" rel="noopener noreferrer" className="text-white/60 hover:text-ruc-400">
            페이지 보기 ↗
          </a>
          {state.ok && <span role="status" className="text-ruc-300">저장했습니다. 페이지에 바로 반영됩니다.</span>}
          {state.error && <span role="alert" className="text-red-300">{state.error}</span>}
        </div>
        <p className="text-[11px] leading-relaxed text-white/50">
          {kind === "md"
            ? "마크다운입니다. 맨 위 머리말(--- title · description · updated ---)은 지우지 마세요. HTML 태그는 글자로 보입니다."
            : "JSON 입니다. 형식이 틀리면 저장되지 않습니다. updatedAt 도 함께 고쳐 주세요."}
        </p>
      </div>
      <aside aria-label="수정 이력" className="space-y-2 text-[11.5px]">
        <p className="eyebrow mb-2">수정 이력</p>
        {history.length === 0 && <p className="text-white/50">웹에서 고친 적이 없습니다 (저장소 파일).</p>}
        {history.map((r) => (
          <a key={r.id} href={r.url} target="_blank" rel="noopener noreferrer" className="glass glass-hover block rounded-lg px-3 py-2">
            <span className="block text-white/85">{r.by}</span>
            <span className="text-white/50">{new Date(r.at).toLocaleString("ko-KR")}</span>
          </a>
        ))}
      </aside>
    </div>
  );
}
