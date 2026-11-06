/**
 * 한국어 조사 (§0-8). 받침 유무로 고릅니다. 한글이 아니면(영문 · 숫자) 받침 없음으로 칩니다.
 * josa("러크", "이/가") → "러크가", josa("검", "을/를") → "검을", josa("길", "으로/로") → "길로"
 */
export function josa(word: string, pair: "이/가" | "을/를" | "은/는" | "과/와" | "으로/로" | "아/야"): string {
  const code = word.charCodeAt(word.length - 1) - 0xac00;
  const hangul = code >= 0 && code <= 11171;
  const jong = hangul ? code % 28 : 0;
  const [withFinal, without] = pair.split("/");
  // "으로" 는 ㄹ 받침(8) 뒤에서 "로"
  const useFinal = jong !== 0 && !(pair === "으로/로" && jong === 8);
  return word + (useFinal ? withFinal : without);
}

/** "{name}이/가 {item}을/를" 같은 틀을 채웁니다. 자리표시자 바로 뒤의 "x/y" 를 조사로 처리. */
export function fmt(template: string, vars: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}(이\/가|을\/를|은\/는|과\/와|으로\/로|아\/야)?/g, (_, k: string, p?: string) => {
    const v = String(vars[k] ?? "");
    return p ? josa(v, p as Parameters<typeof josa>[1]) : v;
  });
}
