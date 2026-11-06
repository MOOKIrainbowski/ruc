import ko from "../shared/locales/ko.json";
import { fmt } from "../shared/josa";

export type StrKey = keyof typeof ko;
/** 게임 문자열 (§0-8). 자리표시자 뒤 조사는 fmt 가 처리 — "{a}과/와" */
export const t = (k: StrKey, vars?: Record<string, string | number>) => (vars ? fmt(ko[k], vars) : ko[k]);
