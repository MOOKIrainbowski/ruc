/**
 * 영지 · 국가 · 길드 레벨 (P14, §21-4 베타 편입 · D96~D98).
 * 영지 = 햇살 초원의 네 구역. 한 주(월요일 0시 KST) 동안 길드원이 그 구역에서 몹을 잡아 쌓은 영향력이 가장 큰 길드가 다음 주 영주.
 * 영주 길드(와 그 국가)의 길드원은 그 영지에서 "영지의 가호"(경험치 +10% · 이동 속도 +5%). 영지에서 누가 몹을 잡든 영주 길드가 길드 경험치(세금)를 받음.
 * 국가 = 영지를 가진 길드가 세우고, 다른 길드가 들어옴. 국가 채팅(/n) · 이름표 «국가».
 */
export type Territory = { id: number; name: string; x0: number; y0: number; x1: number; y1: number };
/** 맵 크기 대비 비율 (초원 네 구역) */
export const TERRITORIES: Territory[] = [
  { id: 1, name: "바람 언덕", x0: 0, y0: 0, x1: 0.5, y1: 0.5 },
  { id: 2, name: "햇살 들판", x0: 0.5, y0: 0, x1: 1, y1: 0.5 },
  { id: 3, name: "이끼 숲", x0: 0, y0: 0.5, x1: 0.5, y1: 1 },
  { id: 4, name: "늑대 골짜기", x0: 0.5, y0: 0.5, x1: 1, y1: 1 },
];
/** (x, y) px 가 있는 영지 — 맵 크기 wpx × hpx */
export const terrAt = (x: number, y: number, wpx: number, hpx: number) =>
  TERRITORIES.find((t) => x >= t.x0 * wpx && x < t.x1 * wpx && y >= t.y0 * hpx && y < t.y1 * hpx);

const H = 3_600_000;
const D = 24 * H;
/** 주 번호 — 월요일 0시(KST) 에 바뀜 */
export const weekOf = (now: number) => Math.floor((now + 9 * H - 4 * D) / (7 * D));
export const weekEnd = (week: number) => (week + 1) * 7 * D + 4 * D - 9 * H;

export const REALM = {
  /** 영지의 가호: 경험치 +10% (이동 속도는 효과 정의) */
  buffExp: 0.1,
  /** 국가 세우기 비용 · 이름 */
  nationRuc: 3000,
  nationNoticeMax: 80,
};
export const validNationName = (s: unknown): s is string => typeof s === "string" && /^[가-힣a-zA-Z0-9]{2,10}$/.test(s);

/** 길드 레벨 (P14): 길드 경험치 = 길드원의 몹 처치(등급 배율) · 던전 클리어 · 영지 세금 */
export const GUILD_XP = [0, 200, 500, 1000, 1800, 3000, 4500, 6500, 9000, 12000];
export const guildLevel = (xp: number) => GUILD_XP.filter((x) => xp >= x).length;
/** 다음 레벨까지 필요한 누적 경험치 (최대면 null) */
export const guildNext = (xp: number) => GUILD_XP[guildLevel(xp)] ?? null;
/** 레벨당 정원 +3 (1레벨 30 → 10레벨 57) · 길드 창고 18칸 + 2레벨마다 9칸 (최대 63) */
export const guildMaxMembers = (lv: number) => 30 + (lv - 1) * 3;
export const guildBankCap = (lv: number) => 18 + 9 * Math.floor(lv / 2);
