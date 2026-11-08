import type { RoomKind } from "../constants.ts";
import type { Grade } from "./mobs.ts";

/** 맵 이름 (미니맵 · 채널 · 전체 지도) */
export const ROOM_NAME: Record<RoomKind, string> = { plaza: "햇살광장 솔라스", field: "햇살 초원", arena: "결투장", dungeon: "고목의 유적", highland: "황혼 고원" };

/**
 * 던전 "고목의 유적" (§20-3 · §20-4). 풀 속성, 권장 Lv10~30, 1~5인.
 * 스테이지마다 groups 의 몹이 유적 북쪽 광장에 나타남 (waves = 한 마리씩 차례로). 몹 HP × (1 + 0.6 × (인원 − 1)).
 * ruc = 스테이지 클리어 보상 (파티 가중치로 나눔). 클리어 → 30초 정비 → 다음 스테이지 포털이 열림.
 */
export type StageGroup = { mob: string; n: number; grade: Grade };
export type Stage = { name: string; lv: number; groups: StageGroup[]; ruc: number; boss?: boolean; waves?: boolean; limitMs?: number };

export const RUINS = {
  name: "고목의 유적",
  recommend: "권장 Lv10~30 · 1~5인",
  restMs: 30_000,
  /** 파티 공용 부활 횟수 · 쓰러지고 이만큼 지나야 쓸 수 있음 · 부활 HP 비율 */
  revives: 3,
  reviveDelayMs: 10_000,
  revivePct: 0.5,
  /** 스테이지마다 쓸 수 있는 포션 수 (회복 제한) */
  potionsPerStage: 5,
  hpPerMember: 0.6,
  /** 실패 · 클리어 뒤 광장으로 돌아가기까지 */
  returnMs: 8000,
  stages: [
    { name: "새싹의 회랑", lv: 6, groups: [{ mob: "sprout_slime", n: 12, grade: "normal" }], ruc: 30 },
    { name: "고블린 약탈대", lv: 8, groups: [{ mob: "goblin", n: 8, grade: "normal" }, { mob: "goblin", n: 4, grade: "low" }], ruc: 50 },
    { name: "덩굴 늑대 굴", lv: 11, groups: [{ mob: "wolf", n: 10, grade: "low" }], ruc: 70 },
    { name: "포자의 제단", lv: 13, groups: [{ mob: "shroom_shaman", n: 6, grade: "mid" }], ruc: 90 },
    { name: "성난 숲정령", lv: 15, groups: [{ mob: "fern", n: 1, grade: "calamity" }], ruc: 200, boss: true },
    { name: "이끼 덮인 수문", lv: 17, groups: [{ mob: "moss_golem", n: 4, grade: "mid" }, { mob: "moss_golem", n: 3, grade: "high" }], ruc: 140 },
    { name: "그림자 뿌리", lv: 19, groups: [{ mob: "shadow_vine", n: 6, grade: "high" }], ruc: 170 },
    { name: "고대 수목 기사단", lv: 21, groups: [{ mob: "tree_knight", n: 2, grade: "minor" }, { mob: "tree_knight", n: 4, grade: "high" }], ruc: 210 },
    { name: "쌍둥이 꽃의 정원", lv: 23, groups: [{ mob: "twin_witch", n: 3, grade: "minor" }], ruc: 260, waves: true },
    { name: "고목왕의 옥좌", lv: 26, groups: [{ mob: "eldra", n: 1, grade: "catastrophe" }], ruc: 0, boss: true, limitMs: 15 * 60_000 },
  ] as Stage[],
  /** 완전 클리어 보상 (§20-3): 파티 총 RUC (가중치로 나눔) · 한 사람마다 신화 장비 1(전설 5% + 운) · 강화석 10 · 축복 강화석 1 · 칭호 */
  clear: {
    ruc: 5000,
    gear: ["ancient_blade", "ancient_staff", "ancient_bow", "ancient_mail", "twin_ring"],
    legendary: 0.05,
    items: [["enhance_stone", 10], ["blessed_stone", 1]] as [string, number][],
    title: "ruins_clear",
    firstTitle: "first_purifier",
  },
};

/** 전설이 나올 확률: 5% + 운 × 0.05%p (§20-3 운 보정) */
export const legendaryChance = (luck: number) => Math.min(0.5, RUINS.clear.legendary + luck * 0.0005);
/** 인원 보정 (§20-3) */
export const memberHp = (n: number) => 1 + RUINS.hpPerMember * Math.max(0, n - 1);

/** 클라이언트에 보내는 던전 상태 */
export type DungeonState = {
  stage: number;
  total: number;
  name: string;
  /** fight = 전투 · rest = 정비(포털 잠김) · open = 다음 포털 열림 · clear = 완전 클리어 · fail = 실패 */
  phase: "fight" | "rest" | "open" | "clear" | "fail";
  /** 남은 몹 · 다음 단계까지 ms (정비 · 보스 제한 · 귀환) · 공용 부활 · 이번 스테이지 남은 포션 */
  left: number;
  ms: number;
  revives: number;
  potions: number;
  /** 보스 엔티티 id · 이름 · 페이즈 이름 */
  boss?: { id: number; name: string; phase: string };
};
