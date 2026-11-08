/** 파티 (§21) · 핑 (§21-3) · 결투 · K/D/A (§13-3) · 칭호 (§20-3). 서버와 클라이언트가 같이 씀. */

export const PARTY = {
  max: 5,
  /** 보상 가중치 (§21-2): 파티장 1.5 · 나머지 1 — RUC · 드롭만, 경험치는 균등 */
  leaderWeight: 1.5,
  /** 경험치를 나눠 받는 반경 (20타일) */
  expRange: 320,
  /** 파티 보너스: 함께 받는 인원당 +5% (2명 이상일 때) */
  expBonus: 0.05,
  /** 초대 · 가입 신청 유효 시간 */
  askMs: 120_000,
  /** 접속이 끊긴 파티원을 남겨 두는 시간 (새로고침해도 파티 유지) */
  offlineMs: 60_000,
  noteMax: 30,
};

export const PINGS = {
  omw: { name: "가는 중", icon: "➜", color: "#4CC764" },
  help: { name: "지원 요청", icon: "✚", color: "#3BA7FF" },
  back: { name: "후퇴!", icon: "↩", color: "#F5C542" },
  attack: { name: "총공격!", icon: "⚔", color: "#E5484D" },
  danger: { name: "위험 · 주의", icon: "!", color: "#FF8A1F" },
  gather: { name: "여기로 집결", icon: "◎", color: "#C9A0F0" },
  enemy: { name: "적 발견", icon: "◉", color: "#ff6b6b" },
} as const;
export type PingKind = keyof typeof PINGS;
/** 핑 휠 순서 (위에서 시계 방향) */
export const PING_WHEEL: PingKind[] = ["attack", "omw", "help", "gather", "back", "enemy", "danger"];
/** 3초 표시 · 도배 방지 5초에 3번 */
export const PING = { ms: 3000, burst: 3, windowMs: 5000 };

/** 결투 (§13-3): 신청은 15초 안에 수락, 3초 뒤 시작, 3분이면 무승부, 서로 20타일 안 */
export const DUEL = { askMs: 15_000, countdownMs: 3000, maxMs: 180_000, range: 320 };
/** K/D/A: 시즌 단위 · 처치 전 10초 안에 피해 · 디버프를 준 사람은 어시스트 */
export const KDA = { season: "beta1", assistMs: 10_000 };

/** 칭호 — 네임 플레이트 칭호 자리에 「」로 */
export const TITLES: Record<string, string> = {
  ruins_clear: "고목을 쓰러뜨린 자",
  first_purifier: "첫 번째 정화자",
};

/** total 을 가중치 비례 정수로 나눔 (가장 큰 나머지 방식 — 합이 항상 total) */
export function splitWeighted(total: number, weights: number[]): number[] {
  const sum = weights.reduce((a, b) => a + b, 0);
  if (!sum || total <= 0) return weights.map(() => 0);
  const raw = weights.map((w) => (total * w) / sum);
  const out = raw.map(Math.floor);
  let left = total - out.reduce((a, b) => a + b, 0);
  const order = raw.map((v, i) => [v - Math.floor(v), i] as const).sort((a, b) => b[0] - a[0] || a[1] - b[1]);
  for (const [, i] of order) { if (left <= 0) break; out[i]++; left--; }
  return out;
}

/** 파티 RUC · 드롭 가중치 (파티장 1.5) */
export const partyWeights = (ids: number[], leader: number) => ids.map((id) => (id === leader ? PARTY.leaderWeight : 1));

/** 가중치 랜덤 뽑기 — r 은 0..1 난수. 반환 = 인덱스 */
export function pickWeighted(weights: number[], r: number): number {
  const sum = weights.reduce((a, b) => a + b, 0);
  let x = r * sum;
  for (let i = 0; i < weights.length; i++) if ((x -= weights[i]) < 0) return i;
  return weights.length - 1;
}

/** 파티 경험치: n명이 균등하게, 2명 이상이면 인원당 +5% (§21-2) */
export const partyExp = (base: number, n: number) => (n <= 1 ? base : Math.max(1, Math.round((base * (1 + PARTY.expBonus * n)) / n)));

/** 서버 → 클라 파티 화면 */
export type PartyMember = { cid: number; name: string; lv: number; jb: string; online: boolean; eid: number; where: string; ch: number };
export type PartyView = { id: number; leader: number; open: boolean; note: string; members: PartyMember[]; requests: { cid: number; name: string; lv: number }[]; dungeon: boolean };
/** 파티원 상태 한 줄: [캐릭터 id, HP 천분율, 자원 천분율, x, y, 방 종류, 채널, 쓰러짐 1/0] */
export type PartyVitals = [number, number, number, number, number, string, number, number];
/** 모집 중인 파티 (파티창의 모집 탭) */
export type PartyAd = { id: number; leader: string; lv: number; n: number; note: string };
