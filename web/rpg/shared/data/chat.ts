/** 채팅 (§5 Enter · §28 욕설 필터). 서버가 걸러서 보내고, 목록은 여기에 덧붙이면 됨 (확장 가능). */

export const CHAT = {
  maxLen: 100,
  /** 도배 방지: 5초에 5번 */
  burst: 5,
  windowMs: 5000,
  /** 화면에 남기는 줄 수 */
  keep: 60,
};
export type ChatChannel = "room" | "party" | "system" | "gm" | "guild" | "whisper";

/** 기본 욕설 목록 — 글자 사이에 띄어쓰기 · 기호 · 숫자를 끼워 넣어도 걸림 */
export const BANNED = [
  "시발", "씨발", "씨팔", "시팔", "ㅅㅂ", "ㅆㅂ", "병신", "ㅂㅅ", "븅신", "좆", "존나", "ㅈㄴ", "개새끼", "개새기", "새끼", "미친놈", "미친년",
  "닥쳐", "느금", "니애미", "니미", "애미", "지랄", "ㅈㄹ", "꺼져", "엿먹",
  "fuck", "shit", "bitch", "asshole", "cunt", "dick",
];

const esc = (c: string) => c.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
// 글자 사이 끼워 넣기 = 공백 · 숫자 · 문장 부호 · 기호만 (\W 는 한글까지 포함해서 단어를 통째로 삼킴)
const PATTERN = new RegExp(BANNED.map((w) => [...w].map(esc).join("[\\s\\d_\\p{P}\\p{S}]*")).join("|"), "giu");

/** 욕설을 *로 가림 (길이 그대로) */
export const filterChat = (text: string) => text.replace(PATTERN, (m) => "*".repeat([...m].length));

/** 보낼 수 있는 문장으로 다듬기: 줄바꿈 · 연속 공백 정리, 길이 제한. 비면 "" */
export const cleanChat = (raw: unknown) => (typeof raw === "string" ? raw.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, CHAT.maxLen) : "");
