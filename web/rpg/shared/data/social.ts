/**
 * 소셜 (P10, D86~D89): 친구 · 차단 · 귓속말 · 접속 알림 · 길드 기초 · 채팅 저장.
 * 길드 등급은 길드장 · 길드원 둘뿐 (§21-4 의 영지 · 국가는 아직 자리만).
 */
export const FRIEND = { max: 50, blockMax: 100 };
export const GUILD = { max: 30, createRuc: 1000, noticeMax: 80 };
/** 채팅 저장 기간 · 접속할 때 다시 보여 줄 줄 수 */
export const CHAT_LOG = { keepDays: 7, history: 30 };

/** 길드 이름: 한글 · 영문 · 숫자 2~10자 (욕설은 서버가 따로 거름) */
export const validGuildName = (s: unknown): s is string => typeof s === "string" && /^[가-힣a-zA-Z0-9]{2,10}$/.test(s);

export type FriendRow = { cid: number; name: string; lv: number; jb: string; on: boolean; where: string };
export type GuildMember = { cid: number; name: string; lv: number; jb: string; master: boolean; on: boolean };
export type GuildView = { id: number; name: string; notice: string; members: GuildMember[] };
/** 소셜 창 데이터: 친구 · 받은 친구 신청 · 차단 목록 · 내 길드 */
export type SocialView = { friends: FriendRow[]; pending: { cid: number; name: string }[]; blocked: { cid: number; name: string }[]; guild: GuildView | null };
