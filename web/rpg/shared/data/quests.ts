/** NPC 퀘스트 · 튜토리얼 (§19) · 유저 퀘스트 규칙 · 알림 종류 (§22). 서버와 클라이언트가 같이 씀. */

/** 서버가 검증할 수 있는 목표 유형 (§19-3). collect(채집물)는 채집 시스템이 생길 때 */
export type ObjType =
  | "talk"    // target = NPC id
  | "reach"   // target = "fountain" (분수 둘레 네 곳을 모두 지남, n = 4)
  | "roll"    // 구르기
  | "claim"   // 우편 받기
  | "buy"     // 일반 상점 구매
  | "cast"    // target = 슬롯(A 평타 · Q W E R)
  | "kill"    // target = 몹 종류 ("*" = 아무거나)
  | "enhance" // 강화 성공
  | "equip"   // 스킬 슬롯 바꿈
  | "level"   // 레벨 도달 (n = 레벨)
  | "party"   // 파티 만들기 · 들어가기 (P7)
  | "stage"   // 던전 스테이지 도달 (reach_stage, n = 스테이지 번호 — 가장 높이 간 스테이지)
  | "duel";   // 결투 승리 (duel_win)
export type Objective = { type: ObjType; target?: string; n: number };
export type Reward = { exp?: number; ruc?: number; items?: [string, number][] };
export type QuestDef = {
  id: string;
  title: string;
  /** 일지 · 추적 창에 보이는 한 줄 설명 */
  desc: string;
  /** 시작할 때 알림에 띄우는 안내 (키 이름은 게임 설정에 따라 다를 수 있어 일반 표현) */
  hint: string;
  npc: string;
  obj: Objective[];
  reward: Reward;
  /** 끝나면 바로 시작되는 다음 퀘스트 */
  next?: string;
};

/** 분수 둘레 네 곳 (px) — 광장 맵 중앙 (48, 48) 타일 기준. 반경 안에 들어가면 지난 것으로 침 */
export const FOUNTAIN_SPOTS = [
  { x: 48 * 16, y: 41 * 16 }, // 북
  { x: 55 * 16, y: 48 * 16 }, // 동
  { x: 48 * 16, y: 55 * 16 }, // 남
  { x: 41 * 16, y: 48 * 16 }, // 서
];
export const FOUNTAIN_R = 40;

const T = (q: QuestDef) => q;
export const TUTORIAL: QuestDef[] = [
  T({ id: "tut_talk", title: "첫 인사", desc: "안내원 루미에게 말을 걸어 보자.", hint: "광장 남쪽의 루미 근처에서 F 키로 말을 걸어 보세요.", npc: "lumi",
    obj: [{ type: "talk", target: "lumi", n: 1 }], reward: { exp: 20 }, next: "tut_fountain" }),
  T({ id: "tut_fountain", title: "분수 한 바퀴", desc: "분수 둘레를 한 바퀴 돌며 네 곳(북 · 동 · 남 · 서)을 지나자. 미니맵(M으로 큰 지도)을 보면 편해요.", hint: "WASD로 걷고 Shift로 달려요. 달리면 스태미나가 줄어요.", npc: "lumi",
    obj: [{ type: "reach", target: "fountain", n: 4 }], reward: { exp: 30 }, next: "tut_roll" }),
  T({ id: "tut_roll", title: "데구루루", desc: "Space 로 구르기를 3번 해 보자. 구르는 동안은 공격을 맞지 않아요.", hint: "Space 키로 구릅니다. 스태미나를 써요.", npc: "lumi",
    obj: [{ type: "roll", n: 3 }], reward: { exp: 40, ruc: 100, items: [["hp_potion_s", 3]] }, next: "tut_mail" }),
  T({ id: "tut_mail", title: "우편함 확인", desc: "광장 남서쪽 우편함에서 방금 온 보상 우편을 받자.", hint: "우편함(또는 집배원 핍) 앞에서 F를 누르고 '받기'를 눌러요.", npc: "pip",
    obj: [{ type: "claim", n: 1 }], reward: { exp: 40 }, next: "tut_shop" }),
  T({ id: "tut_shop", title: "첫 쇼핑", desc: "주황 천막(일반 상점)에서 물건을 하나 사자.", hint: "일반 상점은 6시간마다 진열이 바뀌어요. 산 물건은 우편으로 와요.", npc: "mir",
    obj: [{ type: "buy", n: 1 }], reward: { exp: 60, ruc: 300, items: [["enhance_stone", 3]] }, next: "tut_attack" }),
  T({ id: "tut_attack", title: "첫 전투", desc: "남쪽 '햇살 초원'으로 나가 평타(좌클릭) 3번과 Q 스킬 1번을 써 보자. 광장은 안전지대라 공격할 수 없어요.", hint: "광장은 안전지대예요. 남쪽 출구 '햇살 초원'으로 나가세요. 좌클릭 = 평타, Q = 스킬.", npc: "lumi",
    obj: [{ type: "cast", target: "A", n: 3 }, { type: "cast", target: "Q", n: 1 }], reward: { exp: 60 }, next: "tut_slime" }),
  T({ id: "tut_slime", title: "슬라임 사냥", desc: "초원의 슬라임을 5마리 처치하자.", hint: "처치하면 경험치와 RUC, 가끔 아이템이 나와요. 바닥 아이템은 F로 주워요.", npc: "lumi",
    obj: [{ type: "kill", target: "slime", n: 5 }], reward: { exp: 150, ruc: 500, items: [["wood_sword", 1], ["enhance_stone", 5]] }, next: "tut_enhance" }),
  T({ id: "tut_enhance", title: "대장간 체험", desc: "광장 북쪽 강화대에서 장비를 +1 강화해 보자. (우편의 나무 검과 강화석을 써요)", hint: "강화대(대장장이 볼트) 앞에서 F. 장비를 고르고 강화석을 넣어요.", npc: "volt",
    obj: [{ type: "enhance", n: 1 }], reward: { exp: 100 }, next: "tut_skill" }),
  T({ id: "tut_skill", title: "스킬 정리", desc: "K 키로 스킬창을 열어 스킬 슬롯을 한 번 바꿔 보자. (전투 중에는 바꿀 수 없어요)", hint: "K 키 = 스킬창. 스킬을 눌러 슬롯에 장착해요.", npc: "owen",
    obj: [{ type: "equip", n: 1 }], reward: { exp: 100 }, next: "tut_party" }),
  T({ id: "tut_party", title: "함께라면", desc: "P 키로 파티창을 열어 파티를 만들거나 다른 모험가의 파티에 들어가자. 혼자여도 파티를 만들 수 있어요.", hint: "P = 파티창. 파티 중에는 G 를 누르고 있으면 핑 휠, Alt+클릭은 빠른 핑이에요.", npc: "dario",
    obj: [{ type: "party", n: 1 }], reward: { exp: 120, items: [["hp_potion_m", 3]] }, next: "tut_dungeon" }),
  T({ id: "tut_dungeon", title: "고목의 유적", desc: "광장 북쪽 '고대 유적의 문'으로 던전에 들어가 1스테이지를 정화하자. 파티장이 입장을 확인해요.", hint: "던전에서 쓰러지면 파티원이 부활시키거나 공용 부활(3회)을 쓸 수 있어요. 스테이지마다 포션은 5개까지.", npc: "dario",
    obj: [{ type: "stage", target: "ruins", n: 1 }], reward: { exp: 250, ruc: 300, items: [["enhance_stone", 3]] }, next: "tut_lv10" }),
  T({ id: "tut_lv10", title: "10레벨의 문턱", desc: "초원에서 사냥하며 레벨 10에 도달하자. 고블린과 덩굴늑대를 상대해 볼 만해요.", hint: "포션(숫자키)으로 체력을 관리하며 사냥하세요. 힘들면 광장으로 돌아와 쉬어도 돼요.", npc: "lumi",
    obj: [{ type: "level", n: 10 }], reward: { exp: 0, ruc: 500, items: [["hp_potion_s", 5]] }, next: "tut_job" }),
  T({ id: "tut_job", title: "첫 전직", desc: "직업 교관 세라에게 말을 걸어 1차 전직을 하자.", hint: "광장 북동쪽의 세라 앞에서 F → 계열을 고르면 전직해요.", npc: "sera",
    obj: [{ type: "talk", target: "sera", n: 1 }], reward: { exp: 0, ruc: 1000 } }),
];
export const QUESTS: Record<string, QuestDef> = Object.fromEntries(TUTORIAL.map((q) => [q.id, q]));
export const FIRST_QUEST = TUTORIAL[0].id;

/** 목표 한 줄 표기 */
export function objText(o: Objective, got: number): string {
  const n = Math.min(got, o.n);
  const what: Record<ObjType, string> = {
    talk: `${NPCS[o.target ?? ""]?.name ?? "NPC"}에게 말 걸기`,
    reach: "분수 둘레 지나기",
    roll: "구르기",
    claim: "우편 받기",
    buy: "일반 상점에서 구매",
    cast: o.target === "A" ? "평타 사용" : `${o.target} 스킬 사용`,
    kill: `${o.target === "*" ? "몬스터" : MOB_NAME[o.target ?? ""] ?? o.target} 처치`,
    enhance: "강화 성공",
    equip: "스킬 슬롯 바꾸기",
    level: "레벨 도달",
    party: "파티 만들기 · 들어가기",
    stage: `고목의 유적 ${o.n}스테이지 정화`,
    duel: "결투 승리",
  };
  return o.type === "level" ? `Lv.${o.n} 도달 (현재 ${n})` : o.n > 1 ? `${what[o.type]} ${n}/${o.n}` : `${what[o.type]} ${n >= o.n ? "✔" : ""}`.trim();
}
const MOB_NAME: Record<string, string> = {
  slime: "슬라임", rabbit: "토끼정령", goblin: "고블린", wolf: "덩굴늑대",
  sprout_slime: "새싹 슬라임", shroom_shaman: "버섯 주술사", moss_golem: "이끼 골렘", shadow_vine: "그림자 덩굴", tree_knight: "고대 수목 기사", twin_witch: "쌍둥이 꽃의 마녀",
  dusk_imp: "황혼 임프", stone_boar: "바위 멧돼지", frost_harpy: "서리 하피", ember_golem: "잿불 골렘", shade_knight: "그림자 기사", storm_drake: "폭풍 비룡",
};
export const MOB_CHOICES = Object.entries(MOB_NAME);

/** NPC 소개 · 평소 대사 (§19-1). 대화창에서 쓰고, 루미는 튜토리얼 진행에 따라 안내를 덧붙임 */
export type NpcInfo = { name: string; role: string; lines: string[]; place?: string };
export const NPCS: Record<string, NpcInfo> = {
  lumi: { name: "루미", role: "안내원", lines: ["어서 와요! 저는 안내원 루미예요. 햇살광장 솔라스에 온 걸 환영해요.", "모르는 게 있으면 언제든 말 걸어요. 퀘스트는 J 키로 볼 수 있어요."] },
  volt: { name: "볼트", role: "대장장이", place: "대장간 열기", lines: ["강화는 운이 반, 준비가 반이야. 보호 주문서 없이 +7 넘기는 건 추천 안 해.", "장비가 닳았으면 수리도 해 주지."] },
  mir: { name: "미르", role: "연금술사", place: "작업대 열기", lines: ["안 쓰는 장비 세 개를 가져오면 새 장비 하나로 바꿔 줄게요. 뭐가 나올지는 몰라요, 후후."] },
  sera: { name: "세라", role: "직업 교관", place: "전직하기", lines: ["Lv.10이 되면 1차 전직을, Lv.30이 되면 2차 전직을 할 수 있어요. 어떤 길을 걸을지 잘 생각해 보세요."] },
  owen: { name: "오웬", role: "스킬 교관", place: "스킬창 열기", lines: ["스킬은 쓸수록 숙련도가 쌓여서 강해져. 스킬북은 몬스터가 가끔 떨어뜨리지."] },
  pip: { name: "핍", role: "우편 집배원", place: "우편함 열기", lines: ["우편은 30일 동안 보관돼요. 받지 않은 우편이 있으면 알려 드릴게요!"] },
  dario: { name: "다리오", role: "유적 탐험가", lines: [
    "북쪽 '고대 유적의 문' 너머가 고목의 유적이야. 균형이 깨진 정령들이 우글거리지. 열 개의 방 끝에 고목왕 엘드라가 있어.",
    "혼자 가도 되지만 파티를 꾸리는 게 좋아. P 키로 파티창을 열어 봐. 파티장이 문 앞에서 입장을 확인하면 다 같이 들어가지.",
    "안에선 쓰러져도 바로 광장으로 안 돌아와. 동료가 일으켜 주거나 공용 부활(3번)을 쓰면 돼. 다 쓰러지면… 처음부터야.",
    "동쪽 다리 건너 결투장에선 언제든 한판 붙을 수 있어. 초원에선 P 창에서 결투를 신청하고.",
  ] },
};

// ── 유저 퀘스트 (§19-3) ───────────────────────────────────────────────
export const USER_QUEST = {
  /** 등록자 한 명이 동시에 열어 둘 수 있는 퀘스트 */
  maxActive: 3,
  /** 등록 수수료 (보상 RUC 의 3%, 스팸 방지) */
  feeRate: 0.03,
  /** 받은 사람이 동시에 진행할 수 있는 수 */
  maxTaken: 5,
  maxDays: 7,
  /** 목표 수량 상한 */
  maxN: 100,
  /** 보상 아이템은 1명 한정일 때만 (아이템은 복사되지 않으므로) */
  maxItems: 3,
  maxSlots: 20,
  maxRuc: 1_000_000,
};
/** kill 처치 · deliver 전달 · stage 던전 스테이지 도달(reach_stage) · duel 결투 승리(duel_win) · collect 채집(P13) */
export type UserKind = "kill" | "deliver" | "stage" | "duel" | "collect";
/** collect 목표로 고를 수 있는 채집물 */
export const COLLECT_CHOICES = [["herb", "약초"], ["blue_herb", "푸른 약초"], ["ore", "광석"]] as const;

export const userQuestFee = (ruc: number, slots: number) => Math.ceil(ruc * slots * USER_QUEST.feeRate);

// ── 알림 (§22) ───────────────────────────────────────────────────────
export const NOTI_KINDS = [
  "party_invite", "party_join_request", "party_accepted", "party_kicked", "gift", "mail_unclaimed",
  "quest_complete", "quest_accepted_by", "market_sold", "market_expired", "enhance_broadcast", "system",
  // P10 소셜
  "friend_request", "friend_accepted", "guild_invite", "guild_request", "guild_joined", "guild_kicked",
  // P14 국가
  "nation_invite",
] as const;
export type NotiKind = (typeof NOTI_KINDS)[number];
/** 화면 오른쪽 아래에 토스트로 띄울 중요한 알림 (4초) */
export const NOTI_TOAST: NotiKind[] = ["party_invite", "party_join_request", "quest_complete", "quest_accepted_by", "gift", "market_sold", "friend_request", "guild_invite", "guild_request", "nation_invite"];
export type Noti = { id: number; kind: NotiKind; text: string; at: number; read: boolean; data?: Record<string, unknown> };

/** 일지 · 서버가 주고받는 퀘스트 상태 */
export type QState = { id: string; prog: number[]; tracked: boolean };
export type UserQuestRow = {
  id: number; owner: string; title: string; kind: UserKind; target: string; n: number; ruc: number;
  items: [string, number][]; slots: number; taken: number; left: number; expires: number; mine: boolean; joined: boolean;
};
export type QuestView = { active: QState[]; done: string[]; board: UserQuestRow[]; mine: UserQuestRow[]; taken: (UserQuestRow & { prog: number })[] };
