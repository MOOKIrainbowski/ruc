import { baseStats, type Stats } from "../character.ts";

/**
 * 직업 (§9). 1차 전직(Lv10) = 계열 6개 중 하나 → 스탯 배율 · 계열 스킬 · 잠재력 +30,
 * 2차 전직(Lv30) = 계열 안 세부 직업 → 전용 패시브 · 전용 스킬. P9 에서 세부 직업 30개 모두 구현 (★).
 * 암살자 · 원거리 딜러의 S*(공격력 또는 주문력)는 물리가 기본이고, 마법형(나이트워커 · 마궁사)은 2차 전직 때
 * 공격력 ↔ 주문력 등급을 뒤집고 잠재력 30 을 마법으로 옮기며 마나를 씀 (D28 · D80). 혼합형(마검사)은 주문력 = 공격력 등급, 15/15, 마나 + 기력.
 */

/** §6-2 직업 등급 배율 — 1차 전직 뒤 기본값과 성장량에 곱함 */
export const STAT_GRADE = { S: 1.5, A: 1.25, B: 1, C: 0.85, D: 0.7 } as const;
type G = keyof typeof STAT_GRADE;
type GradeKey = "hp" | "stamina" | "def" | "atk" | "ap" | "atkSpeed" | "moveSpeed" | "spirit";

export type LineId = "tank" | "warrior" | "assassin" | "mage" | "ranged" | "support";
export type Line = { name: string; role: string; res: "energy" | "mana"; pot: "phys" | "mag"; color: string; icon: string; reach: string; g: Record<GradeKey, G> };

export const LINES: Record<LineId, Line> = {
  tank: { name: "탱커", role: "1선에서 팀원 대신 적의 공격을 받아냅니다", res: "energy", pot: "phys", color: "#9AA3AD", icon: "shield", reach: "근접", g: { hp: "S", stamina: "S", def: "S", atk: "C", ap: "D", atkSpeed: "C", moveSpeed: "C", spirit: "B" } },
  warrior: { name: "전사", role: "높은 근접 전투력과 적당한 탱킹", res: "energy", pot: "phys", color: "#E5484D", icon: "sword", reach: "근접", g: { hp: "A", stamina: "A", def: "A", atk: "A", ap: "C", atkSpeed: "B", moveSpeed: "B", spirit: "C" } },
  assassin: { name: "암살자", role: "기동력과 월등한 순간 화력", res: "energy", pot: "phys", color: "#6B3FA0", icon: "target", reach: "근접 · 중거리", g: { hp: "D", stamina: "C", def: "D", atk: "S", ap: "D", atkSpeed: "A", moveSpeed: "S", spirit: "C" } },
  mage: { name: "마법사", role: "후방에서 폭발적인 마법 피해와 디버프", res: "mana", pot: "mag", color: "#9B5DE5", icon: "star", reach: "220px", g: { hp: "D", stamina: "C", def: "D", atk: "D", ap: "S", atkSpeed: "B", moveSpeed: "C", spirit: "B" } },
  ranged: { name: "원거리 딜러", role: "가장 긴 사거리에서 평타 · 스킬로 폭딜", res: "energy", pot: "phys", color: "#F5C542", icon: "bow", reach: "300px", g: { hp: "C", stamina: "C", def: "D", atk: "S", ap: "D", atkSpeed: "S", moveSpeed: "B", spirit: "C" } },
  support: { name: "서포터", role: "디버프 해제 · 버프 · 체력 회복", res: "mana", pot: "mag", color: "#4CC764", icon: "cross", reach: "중거리", g: { hp: "D", stamina: "C", def: "D", atk: "D", ap: "B", atkSpeed: "B", moveSpeed: "B", spirit: "S" } },
};
export const LINE_IDS = Object.keys(LINES) as LineId[];

export type Job = { name: string; line: LineId; star: boolean; concept: string; passive: { name: string; desc: string }; kind?: "magic" | "hybrid" };
const j = (line: LineId, name: string, concept: string, pName: string, pDesc: string, kind?: "magic" | "hybrid"): Job => ({ name, line, star: true, concept, passive: { name: pName, desc: pDesc }, ...(kind ? { kind } : {}) });

/** 세부 직업 (§9-3) */
export const JOBS: Record<string, Job> = {
  guardian: j("tank", "수호기사", "방패 · 도발 · 아군 보호막", "수호의 맹세", "근처(6칸) 아군이 받는 피해의 15%를 대신 받습니다. 대신 받은 피해는 20% 줄어듭니다"),
  berserker: j("tank", "광전사", "HP 가 낮을수록 강해지는 흡혈 탱커", "피의 광기", "잃은 HP 10%마다 흡혈 +2%, 공속 +3%"),
  earthwarden: j("tank", "대지수호자", "흙 · 철 결계, 지형 생성", "대지의 뿌리", "정지 중 방어 +20%, 넉백 면역"),
  paladin: j("tank", "성기사", "빛 속성 탱커 + 소량 힐", "신성한 방벽", "보호막을 받으면 보호막량의 10%만큼 주변 아군 회복"),
  battle_knight: j("warrior", "전투기사", "돌진 · 연속 베기, 안정적인 근접 딜탱", "기사도", "같은 대상을 3번 연속 때리면 다음 공격 피해 +30%"),
  spellblade: j("warrior", "마검사", "검에 속성 마법을 실음. 마나 + 기력", "마검 공명", "평타가 주 속성 추가 피해 (주문력 30%)", "hybrid"),
  gladiator: j("warrior", "검투사", "결투 특화, 1:1 반격", "투기장의 함성", "근처 적이 1명뿐이면 피해 +15%"),
  lancer: j("warrior", "창술사", "긴 근접 사거리, 찌르기 관통", "간격 지배", "사거리 끝에서 맞히면 피해 +20%"),
  monk: j("warrior", "권사", "맨손 연타, 콤보", "연환", "평타 4타째에 짧은 에어본"),
  ninja: j("assassin", "닌자", "물리, 순간이동 · 표창, 폭딜", "그림자 걸음", "3초 동안 전투하지 않으면 이동 속도 +25%"),
  nightwalker: j("assassin", "나이트워커", "어둠 속성 마법 암살, 은신", "밤의 장막", "은신을 깨는 첫 공격은 치명타 확정", "magic"),
  phantom: j("assassin", "환영자객", "분신으로 혼란 · 교란", "잔상", "회피 시 2초간 남는 분신이 적의 타깃을 끔"),
  scout: j("assassin", "정찰자", "높은 이속으로 정보 수집", "매의 눈", "미니맵 시야 +50%, 주변 25칸에서 발견한 적을 파티 미니맵에 5초 공유"),
  elementalist: j("mage", "원소술사", "보조 속성 1개를 더 쓰고 원소 반응에 특화", "원소 조화", "원소 반응 피해 +25%"),
  arcanist: j("mage", "비전술사", "무속성 순수 마력, 마나 효율", "비전 순환", "스킬 적중 시 마나 2% 환급"),
  summoner: j("mage", "소환사", "정령 · 골렘 소환", "계약의 끈", "소환수가 주문력의 60%를 물려받음"),
  warlock: j("mage", "흑마법사", "저주 · 도트 · 흡혈", "영혼 수확", "디버프가 걸린 적을 처치하면 HP · 마나 회복"),
  alchemist: j("mage", "연금술사", "투척 플라스크 · 장판", "촉매", "포션 효과 +30%, 포션 쿨 −20%"),
  illusionist: j("mage", "환술사", "매혹 · 혼란 · 환영", "몽환", "정신계 디버프(매혹 · 혼란 · 공포 · 수면) 지속 +20%"),
  cleric: j("mage", "백마법사", "빛 속성 딜 + 정화", "성광", "어둠 속성 적에게 피해 +25%"),
  archer: j("ranged", "궁수", "표준 활, 기동 사격", "바람 읽기", "움직이면서 쏴도 피해가 줄지 않습니다 (다른 직업은 이동 중 물리 사격 피해 −20%)"),
  sniper: j("ranged", "스나이퍼", "초장거리 차지샷", "집중", "1.5초 정지할 때마다 다음 공격 피해 +10% (최대 +50%)"),
  hunter: j("ranged", "헌터", "덫 · 동물 동료", "사냥감 표식", "표식 대상에게 받는 피해 +10%"),
  thrower: j("ranged", "투척수", "단검 · 폭탄 투척, 중거리 범위", "손재주", "투척 스킬 2회 충전"),
  magic_archer: j("ranged", "마궁사", "마법 화살 (주문력 기반)", "마력 화살촉", "평타가 30% 확률로 속성 효과", "magic"),
  priest: j("support", "힐러(사제)", "단일 · 광역 힐, 부활", "치유의 손길", "체력 30% 이하 아군에게 주는 치유 +30%"),
  bard: j("support", "버퍼(음유시인)", "노래 오라 버프", "선율", "주변 10칸 아군의 공속 · 이속 +5% (오라)"),
  engineer: j("support", "엔지니어", "포탑 · 회복 장치 설치", "정비", "설치물 지속 시간 +30%, 설치 스킬 쿨 −15%"),
  shaman: j("support", "주술사", "토템, 디버프 해제 · 부여", "조상의 가호", "디버프 해제 시 대상에게 1.5초 보호막"),
  spiritcaller: j("support", "정령사", "정령과 계약해 아군에게 정령을 붙임", "정령 친화", "아군 버프에 시전자 속성 효과가 추가됨"),
};

/** 전직 레벨 · 잠재력 보너스 (§9-1) */
export const JOB_LV = { tier1: 10, tier2: 30, tier3: 60 } as const;
/** 3차 각성 (P15, §9-1 정식 → 베타 · D100): Lv60 · 2차 전직 뒤. 기본 스탯 +10% · 전용 궁극기 피해/치유 +50% · 쿨 −25% · 금빛 망토 테두리 */
export const AWAKEN = { stat: 0.1, ultPower: 1.5, ultCd: 0.75 };
export const AWAKEN_NAME: Record<LineId, string> = { tank: "불굴의 각성", warrior: "전장의 각성", assassin: "그림자의 각성", mage: "원소의 각성", ranged: "매의 각성", support: "성소의 각성" };
export const JOB_POTENTIAL = 30;
/** 견습 · 1차 · 2차 이름 */
export const jobName = (line: LineId | null, job: string | null) => (job ? JOBS[job].name : line ? LINES[line].name : "견습 모험가");

/** 정령사 「정령 친화」(D82): 아군 지원에 붙는 시전자 속성 버프 (4초) · 툴팁 문구 */
export const SPIRIT_BUFF: Record<string, { id: string; ms: number; v?: number; dot?: number; desc: string }> = {
  fire: { id: "power", ms: 4000, v: 0.08, desc: "공격력 · 주문력 +8%" }, water: { id: "dmgdown", ms: 4000, v: 0.08, desc: "받는 피해 −8%" },
  earth: { id: "guard", ms: 4000, v: 10, desc: "방어력 +10" }, grass: { id: "regen_hp", ms: 4000, dot: 4, desc: "지속 회복" },
  wind: { id: "haste", ms: 4000, v: 0.1, desc: "이동 속도 +10%" }, electric: { id: "atkspd", ms: 4000, v: 10, desc: "공격 속도 +10" },
  ice: { id: "tenacity", ms: 4000, v: 0.15, desc: "강인함 +15%" }, light: { id: "shield", ms: 4000, v: 30, desc: "보호막 30" },
  dark: { id: "vamp", ms: 4000, v: 0.06, desc: "흡혈 6%" }, poison: { id: "venom", ms: 4000, desc: "평타 독" },
  iron: { id: "guard", ms: 4000, v: 10, desc: "방어력 +10" }, none: { id: "power", ms: 4000, v: 0.05, desc: "공격력 · 주문력 +5%" },
};

/** 주 자원: 계열 기본 · 마법형 = 마나 · 혼합형 = 둘 다 (null = 견습, 둘 다) */
export function jobRes(line: LineId | null, job: string | null): "energy" | "mana" | "both" | null {
  const k = job ? JOBS[job]?.kind : undefined;
  return k === "magic" ? "mana" : k === "hybrid" ? "both" : line ? LINES[line].res : null;
}

/** 2차 전직 때 잠재력 옮기기 (D80): 마법형은 물리 30 → 마법, 혼합형은 15 */
export const JOB_POT_SHIFT = { magic: 30, hybrid: 15 } as const;

/** 레벨 · 계열 · 잠재력을 반영한 기본 스탯 (장비 · 버프 전). 마법형은 공격력 ↔ 주문력 등급을 뒤집고, 혼합형은 주문력 = 공격력 등급 */
export function jobStats(level: number, line: LineId | null, pot: [number, number], job: string | null = null, awake = false): Stats {
  const s = baseStats(level);
  if (line) {
    const kind = job ? JOBS[job]?.kind : undefined;
    const g0 = LINES[line].g;
    const g = kind === "magic" ? { ...g0, atk: g0.ap, ap: g0.atk } : kind === "hybrid" ? { ...g0, ap: g0.atk } : g0;
    const m = (k: GradeKey) => STAT_GRADE[g[k]];
    s.hp *= m("hp");
    s.stamina *= m("stamina");
    s.pdef *= m("def");
    s.mdef *= m("def");
    s.atk *= m("atk");
    s.ap *= m("ap");
    s.atkSpeed *= m("atkSpeed");
    s.moveSpeed *= m("moveSpeed");
    s.spirit *= m("spirit");
    if (awake) for (const k of ["hp", "atk", "ap", "pdef", "mdef"] as const) s[k] *= 1 + AWAKEN.stat; // 3차 각성
  }
  s.potentialPhys = pot[0];
  s.potentialMag = pot[1];
  return s;
}
