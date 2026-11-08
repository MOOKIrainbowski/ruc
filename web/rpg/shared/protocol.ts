import type { FullStats } from "./combat.ts";
import type { RoomKind } from "./constants.ts";
import type { Appearance } from "./data/appearance.ts";
import type { Price } from "./data/economy.ts";
import type { GatherRow, Item, ItemPos, Rarity } from "./data/items.ts";
import type { ElementId } from "./data/elements.ts";
import type { LineId } from "./data/jobs.ts";
import type { Grade } from "./data/mobs.ts";
import type { Slot } from "./data/skills.ts";
import type { Noti, QState, QuestView } from "./data/quests.ts";
import type { DungeonState } from "./data/dungeons.ts";
import type { PartyAd, PartyVitals, PartyView, PingKind } from "./data/party.ts";
import type { ChatChannel } from "./data/chat.ts";
import type { SocialView } from "./data/social.ts";
import type { Progress } from "./progress.ts";
import type { MoveInput, Mover } from "./movement.ts";

/** 네트워크 메시지 (§27). 베타는 JSON (DECISIONS D4). 필드 이름은 짧게. */

/** 플레이어는 ap(외형) · look(옷 색을 바꾸는 장비 템플릿 id) · tt(칭호 id), 몹은 mob(종류) · grade */
/** pet = 소환수 · 설치물의 주인 id (P9) — 몹 그림(mob) 또는 주인 모습(ap, 잔상) */
export type EntityInfo = { id: number; name: string; el: string; lv: number; ap?: Appearance; look?: string[]; jb?: string; tt?: string; mob?: string; grade?: Grade; pet?: number; gd?: string };
/** 스냅샷 한 줄: [id, x, y, dir, flags, HP 천분율, 마나 또는 기력 천분율] */
export type EntityRow = [number, number, number, number, number, number, number];
export const F_MOVING = 1;
export const F_RUNNING = 2;
export const F_ROLL = 4;
export const F_DEAD = 8;
export const F_CAST = 16;

/** 내 상태: [HP, 최대, 마나, 최대, 기력, 최대, 보호막, SLOTS 순서(A Q W E R)로 ack 시점의 남은 쿨(ms), 포션 공유 쿨(ms)] */
export type Vitals = number[];
/** 걸린 효과 한 줄: [효과 id, 남은 ms, 스택, 전체 ms, 값] */
export type FxRow = [string, number, number, number, number];

/** 피해 표시 플래그 */
export const H_CRIT = 1;
export const H_HEAL = 2;
export const H_MISS = 4;
export const H_IMMUNE = 8;
export const H_DOT = 16;
export const H_RESIST = 32;
export const H_COUNTER = 64;

/**
 * 방 이벤트 (모두에게):
 *  ["h", 때린 id, 맞은 id, 양, 플래그, 속성]      피해 · 치유
 *  ["c", id, 스킬 id, 조준 x, y]                   시전 · 몹 공격 모션
 *  ["p", 투사체 id, 주인 id, 종류, 속성, x, y, 초당 vx, vy, 사거리, 입력 seq]
 *  ["px", 투사체 id]                               투사체 소멸
 *  ["w", "circle"|"line", x, y, 각도(rad), 크기, 폭, ms, 편("p" = 플레이어 스킬)]   바닥 경고 (§10-2)
 *  ["wl", x1, y1, x2, y2, ms]                      적 투사체를 막는 벽 (성역의 방패)
 *  ["rx", 대상 id, 반응 이름]                      원소 반응 (§12-3)
 *  ["rv", id]                                      부활
 *  ["gx", x, y, 반경, 속성 | "heal"]                 범위 스킬 터짐 (그림용)
 *  ["job", id, 계열, 세부 직업]                      전직
 *  ["f", id, FxRow[]]                              효과 목록 바뀜
 *  ["d", id]                                       쓰러짐
 *  ["lv", id, 레벨]
 *  ["dr", 드롭 id, 템플릿, 희귀도, 개수, x, y]     바닥 아이템 (처치 기여자에게는 개인 이벤트로 먼저, 30초 뒤 모두에게)
 *  ["dx", 드롭 id, 주운 id(0 = 사라짐)]
 *  ["eq", id, look[]]                               옷 색이 바뀌는 장비를 바꿔 입음
 *  ["tt", id, 칭호 id]                              칭호 바꿈
 *  ["bp", 보스 id, 페이즈 이름]                       보스 페이즈 전환 (§20-4)
 *  ["wp", x, y, 반경]                               집결 장판 (보스 stack — 다 같이 들어가야 덜 아픔)
 * 개인 이벤트:
 *  ["cf", seq, 이유]                               시전 거부 → 예측 취소
 *  ["xp", 얻은 양, 현재 경험치, 레벨]
 *  ["dead", 부활까지 ms]
 *  ["get", 템플릿, 개수, 희귀도]                    주움
 *  ["du", 아이템 id, 내구도]                         내구도 바뀜
 *  ["sk", 스킬 id, 레벨, "learn" | "lv" | "grade"]  새로 배움 · 스킬 레벨업 · 등급 오름
 *  ["ruc", 양]                                      몹 처치 RUC (베타 지갑)
 *  ["pl", 템플릿, 희귀도, 받은 사람 이름]             파티 드롭 분배 결과 (§21-2 — 파티 채팅 대신)
 *  ["duel", "start" | "end", 상대 엔티티 id[], 시작까지 ms | 결과("win" | "lose" | "draw")]
 */
export type Ev = (string | number | FxRow[] | string[] | number[])[];
export type DropRow = ["dr", number, string, Rarity, number, number, number];

export type You = {
  id: number;
  nickname: string;
  level: number;
  exp: number;
  element: string;
  appearance: Appearance;
  ruc: number;
  kda: [number, number, number];
  settings: Record<string, unknown> | null;
  slots: Partial<Record<Slot, string>>;
  prog: Progress;
  /** GM (§28) — F8 GM 창 */
  gm?: boolean;
  /** 내 이름표: 칭호 · 길드 (P10) */
  tt?: string;
  gd?: string;
  /** 창고 확장 장수 (P12) */
  tabs?: number;
};

export type ChannelInfo = { ch: number; n: number; cap: number };

export type C2S =
  | { t: "hello"; ticket: string }
  | { t: "create"; nickname: string; appearance: Appearance; element: string }
  | ({ t: "in" } & MoveInput)
  | { t: "ping"; c: number; r?: number }
  | { t: "settings"; data: Record<string, unknown> }
  | { t: "channel"; ch: number }
  /** 상호작용(F): 포털 등 맵 오브젝트 id */
  | { t: "use"; oid: number }
  /** 전직 (§9-1): 1차 = 계열, 2차 = 세부 직업 (원소술사는 보조 속성) — 직업 교관 근처에서 */
  | { t: "job"; line?: LineId; job?: string; sub?: ElementId }
  /** 스킬 슬롯 장착 · 해제 (비전투 상태, §10-1) */
  | { t: "equip"; skill: string; slot: Slot | null }
  /**
   * 경제 (P5): 우편(mail · claim · claimAll) · 일반 상점(shop · buy) · 유저 상점(market · sell · mbuy · cancel) ·
   * 대장간(enhance · enchant · repair) · 분해(disassemble) · 재조합(recombine). rid = 요청 id (같은 요청이 두 번 와도 한 번만)
   */
  | {
      t: "econ"; op: string; id?: number; a?: ItemPos | "all"; b?: ItemPos; n?: number; cycle?: number; prices?: Price[]; opt?: number;
      list?: ItemPos[]; blessed?: boolean; protect?: boolean; slot?: number; rid?: string;
    }
  /** 아이템 (§15): 옮기기(n = 나눌 개수) · 사용/장착 · 버리기 · 정렬 */
  | { t: "item"; op: "move" | "use" | "drop" | "sort"; a?: ItemPos; b?: ItemPos; n?: number; loc?: "inventory" | "storage" }
  /**
   * 퀘스트 (P6): 추적(track) · 게시판(board) · 유저 퀘스트 등록(create) · 수락(accept) · 포기(abandon) · 전달(deliver) · 내리기(cancel) · 신고(report)
   */
  | {
      t: "quest"; op: "track" | "board" | "create" | "accept" | "abandon" | "deliver" | "cancel" | "report"; id?: string | number; on?: boolean;
      title?: string; kind?: "kill" | "deliver" | "stage" | "duel" | "collect"; target?: string; n?: number; ruc?: number; list?: ItemPos[]; slots?: number; days?: number; rid?: string;
    }
  /** 알림 읽음 처리 (id 없으면 모두 읽음은 readAll) */
  | { t: "noti"; op: "read" | "readAll"; id?: number }
  /**
   * 파티 (§21, P7): 만들기 · 초대(name) · 초대 수락/거절(id) · 가입 신청(id) · 신청 승인/거절(cid) · 추방 · 위임 · 탈퇴 · 해산 · 모집 공개(open, note) · 모집 목록
   */
  | { t: "party"; op: "create" | "invite" | "accept" | "decline" | "request" | "approve" | "reject" | "kick" | "promote" | "leave" | "disband" | "open" | "list"; name?: string; id?: number; cid?: number; on?: boolean; note?: string }
  /** 핑 (§21-3): 파티원에게 월드 좌표 */
  | { t: "mark"; k: PingKind; x: number; y: number }
  /** 결투 (§13-3): 신청(name, party = 파티 대 파티) · 수락 · 거절 */
  | { t: "duel"; op: "ask" | "accept" | "decline"; name?: string; party?: boolean; id?: number }
  /** 던전 (§20-4): 입장 확인(파티장) · 공용 부활 · 나가기(중간 포기) */
  | { t: "dungeon"; op: "enter" | "revive" | "leave" }
  /** 칭호 고르기 (null = 떼기) · 현황판(Tab) */
  | { t: "title"; id: string | null }
  | { t: "who" }
  /** 채집 (P13): 채집 지점 id */
  | { t: "gather"; id: number }
  /** 채팅 (§5 Enter): 같은 방 · 파티 · 길드. "/p 말" = 파티, "/g 말" = 길드, "/w 닉 말" · "/r 말" = 귓속말, "/gm …" = GM 명령 */
  | { t: "chat"; ch?: "room" | "party" | "guild"; text: string }
  /** 친구 (P10): 신청(name) · 수락/거절/삭제(cid) · 차단(name 또는 cid) · 차단 해제(cid) */
  | { t: "friend"; op: "request" | "accept" | "decline" | "remove" | "block" | "unblock" | "gift"; name?: string; cid?: number; a?: ItemPos; n?: number }
  /** 길드 (P10): 만들기(name) · 초대(name) · 초대 수락/거절(id) · 가입 신청(name = 길드 이름) · 승인/거절(cid) · 탈퇴 · 추방 · 위임(cid) · 공지(text) · 해산 */
  | { t: "guild"; op: "create" | "invite" | "accept" | "decline" | "apply" | "approve" | "reject" | "leave" | "kick" | "promote" | "notice" | "disband"; name?: string; id?: number; cid?: number; text?: string }
  /** 버그 제보 (§28): 설명 · 스크린샷(JPEG data URL) · 클라이언트 로그 */
  | { t: "bug"; text: string; img?: string; log?: string[] }
  /** GM 창 (F8): 접속자 · 버그 제보 목록, bug = 그 제보의 스크린샷 */
  | { t: "gm"; bug?: number }
  /** 개발 모드 전용: 순간이동 · 아이템 받기 · 레벨 · 던전 스테이지 건너뛰기(stage) */
  | { t: "dev"; map?: RoomKind; x?: number; y?: number; give?: string; rarity?: Rarity; n?: number; lv?: number; stage?: number };

export type S2C =
  | { t: "needCreate"; defaultName: string }
  | { t: "createError"; msg: string }
  | {
      t: "joined"; you: You; room: { kind: RoomKind; ch: number }; me: Mover; ents: EntityInfo[]; fx: [number, FxRow[]][];
      channels: ChannelInfo[]; stats: FullStats; items: Item[]; drops: DropRow[]; nodes?: GatherRow[];
    }
  | { t: "spawn"; e: EntityInfo }
  | { t: "despawn"; id: number }
  /** 스냅샷 (10Hz 바이너리 프레임을 snapshot.ts decodeSnapshot 으로 푼 모양): e = 바뀐 엔티티의 지금 줄, g = 시야 밖으로 나간 id */
  | { t: "s"; st: number; ack: { seq: number; m: Mover }; v: Vitals; e: EntityRow[]; g?: number[]; ev?: Ev[]; pe?: Ev[] }
  | { t: "stats"; s: FullStats }
  | { t: "inv"; items: Item[] }
  /** 베타 지갑 잔액 · 서버 공지(+10 강화) · 알림(새 우편) · 경제 화면 데이터 */
  | { t: "ruc"; ruc: number }
  | { t: "notice"; text: string }
  | { t: "notify"; kind: "mail"; n: number }
  | { t: "econ"; view: "mail" | "shop" | "market" | "enhanced" | "recombined"; data: unknown }
  /** 퀘스트 (P6): 진행 중 · 끝난 NPC 퀘스트 / 시작·완료 팝업 / 유저 퀘스트 게시판 */
  | { t: "qs"; active: QState[]; done: string[] }
  | { t: "qpop"; kind: "start" | "done"; title: string; text: string }
  | { t: "quest"; view: "board"; data: Pick<QuestView, "board" | "mine" | "taken"> }
  | { t: "uqp"; id: number; prog: number }
  /** 알림 (§22): 새 알림 한 건(toast = 오른쪽 아래 토스트) / 접속 때 목록 */
  | { t: "noti"; n: Noti; toast: boolean }
  | { t: "notis"; list: Noti[] }
  /** 성장 상태 (전직 · 스킬 · 숙련도) 바뀜 */
  | { t: "prog"; prog: Progress; slots: Partial<Record<Slot, string>> }
  /** tk = 서버 틱 처리 시간 ms (F3 디버그 오버레이) */
  | { t: "pong"; c: number; tk?: number }
  | { t: "channels"; list: ChannelInfo[] }
  | { t: "kicked"; reason: "dup" | "rate" | "auth" | "server" | "banned" | "gm" }
  /** 채팅 한 줄 (ch: 방 · 파티 · 시스템 · 운영 · 길드 · 귓속말 — 귓속말은 to = 받는 사람) */
  | { t: "chat"; ch: ChatChannel; from: string; text: string; at: number; to?: string }
  /** 소셜 창 (P10): 친구 · 받은 신청 · 차단 · 길드 */
  | { t: "social"; s: SocialView }
  /** 창고 확장 장수 (P12) */
  | { t: "tabs"; n: number }
  /** GM 창 데이터 */
  | { t: "gm"; players?: { name: string; lv: number; where: string; ch: number; x: number; y: number; party: boolean; muted: boolean }[]; bugs?: { id: number; name: string; place: string; text: string; at: number; img: boolean }[]; bug?: { id: number; img: string | null; log: string[] } | null }
  /** 파티 (P7): 내 파티(없으면 null) · 파티원 상태(2Hz) · 모집 중인 파티 · 핑 */
  | { t: "party"; party: PartyView | null }
  | { t: "pv"; v: PartyVitals[] }
  | { t: "ads"; list: PartyAd[] }
  | { t: "mark"; k: PingKind; x: number; y: number; from: string }
  /** 확인 창: 결투 신청 받음 · 던전 입장 확인(파티장) */
  | { t: "ask"; kind: "duel"; id: number; from: string; party: boolean }
  | { t: "ask"; kind: "dungeon"; members: string[]; recommend: string }
  /** K/D/A · 칭호 목록 · 현황판 · 던전 상태(없으면 null) */
  | { t: "kda"; kda: [number, number, number] }
  | { t: "titles"; list: string[]; on: string | null }
  | { t: "who"; list: { name: string; lv: number; jb: string; kda: [number, number, number]; party: boolean }[] }
  | { t: "dg"; s: DungeonState | null }
  | { t: "error"; msg: string };
