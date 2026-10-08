// 사이트 전체 문안. 한국어 기본 / 영어 (§6.3, §7.4)
// 새 문안을 추가할 때는 반드시 ko/en 양쪽에 넣으세요 — 타입이 강제합니다.

export type Lang = "ko" | "en";

export const DISCORD_INVITE = "https://discord.gg/K3Z5CDn3GK";

/** 서버 접속 주소. Phase 2에서 실제 주소로 교체. */
export const MC_ADDRESS = process.env.NEXT_PUBLIC_MC_ADDRESS ?? "play.rucserver.kr";

// 주의: 아래 키("raid" 등)는 화면에 보이는 이름이 아니라 내부 식별자입니다.
// 환경변수(MC_HOST_RAID)와 API 응답에 그대로 쓰이므로 바꾸지 마세요.
// 표시 이름은 serverLabels / modes.items.name 에서만 바꿉니다.
export const SERVER_KEYS = ["home", "raid", "war", "peace"] as const;
export type ServerKey = (typeof SERVER_KEYS)[number];

type Copy = {
  nav: {
    goToServer: string;
    status: string;
    landing: string;
    /** 랜딩 → 러크 홈페이지(/home) 입장 버튼 */
    enter: string;
    home: string;
    rules: string;
    wiki: string;
    charge: string;
    menu: string;
    /** 한국어 전용 페이지에서 EN 토글에 붙는 안내 */
    koOnly: string;
    /** 상단 바 검색창 */
    search: string;
    searchPlaceholder: string;
    searchClose: string;
  };
  hero: {
    eyebrow: string;
    title: string[];
    sub: string;
    ctaDiscord: string;
    copyAddress: string;
    copied: string;
  };
  strip: { label: string; online: string; offline: string; players: string; loading: string };
  /** 랜딩 "한눈에" — 카드 3장 (2026-10-03 간소화) */
  highlights: {
    eyebrow: string;
    heading: string;
    items: { glyph: string; title: string; desc: string }[];
  };
  modes: {
    eyebrow: string;
    heading: string;
    items: { key: ServerKey; name: string; tag: string; hook: string; paused?: boolean }[];
    live: string;
    paused: string;
  };
  finalCta: { heading: string; lead: string; button: string };
  footer: { tagline: string; madeWith: string; links: { label: string; href: string }[] };
  status: {
    title: string;
    lead: string;
    network: string;
    totalOnline: string;
    address: string;
    lastUpdated: string;
    refresh: string;
    never: string;
    notices: string;
    quickLinks: string;
    serverLabels: Record<ServerKey, string>;
    serverDesc: Record<ServerKey, string>;
    offlineNote: string;
    players: string;
    latency: string;
    version: string;
    noticeItems: { date: string; tag: string; title: string }[];
  };
};

export const content: Record<Lang, Copy> = {
  ko: {
    nav: {
      goToServer: "서버 가기",
      status: "서버 상태",
      landing: "소개",
      enter: "러크 홈페이지 입장",
      home: "홈",
      rules: "규칙",
      wiki: "위키",
      charge: "충전",
      menu: "메뉴",
      koOnly: "이 페이지는 아직 한국어만 있습니다",
      search: "사이트 검색",
      searchPlaceholder: "위키 · 규칙 · 상품 검색  ( Ctrl K )",
      searchClose: "검색 닫기",
    },
    hero: {
      eyebrow: "Season 1",
      title: ["Ruc Server", "Season 1"],
      sub: "모든 서버가 지갑 하나를 쓰는 마인크래프트 네트워크.",
      ctaDiscord: "디스코드 참여하기",
      copyAddress: "주소 복사",
      copied: "복사됨!",
    },
    strip: {
      label: "지금 서버 상태",
      online: "온라인",
      offline: "오프라인",
      players: "명",
      loading: "확인 중…",
    },
    highlights: {
      eyebrow: "AT A GLANCE",
      heading: "러크가 다른 세 가지.",
      items: [
        { glyph: "₩", title: "하나의 지갑", desc: "Gold · 레벨 모든 서버 공용." },
        { glyph: "⚔", title: "도망은 없다", desc: "약탈 서버 전투 중 접속 종료 = 전부 잃음." },
        { glyph: "✓", title: "돈으로 못 사는 강함", desc: "판매는 꾸미기 · 편의뿐. 능력치 판매 없음." },
      ],
    },
    modes: {
      eyebrow: "SERVERS",
      heading: "네 개의 서버, 네 가지 규칙.",
      items: [
        { key: "home", name: "홈", tag: "HUB", hook: "첫 도착 광장 · 서버 이동." },
        { key: "raid", name: "약탈", tag: "PVP", hook: "PvP · 약탈 허용. 도주 = 처형." },
        { key: "war", name: "국가전", tag: "WAR", hook: "길드 · 국가 · 영토 전쟁.", paused: true },
        { key: "peace", name: "평화", tag: "PEACE", hook: "살해 차단.", paused: true },
      ],
      live: "운영 중",
      paused: "정지 중",
    },
    finalCta: {
      heading: "준비됐다면, 들어오세요.",
      lead: "공지 · 인증 · 신고는 디스코드에서.",
      button: "디스코드 참여하기",
    },
    footer: {
      tagline: "Ruc Server, Season 1",
      madeWith: "러크 서버",
      links: [
        { label: "홈", href: "/home" },
        { label: "규칙", href: "/rules" },
        { label: "위키", href: "/wiki" },
        { label: "충전", href: "/charge" },
        { label: "서버 상태", href: "/status" },
        { label: "디스코드", href: DISCORD_INVITE },
      ],
    },
    status: {
      title: "서버 상태",
      lead: "서버 · 접속자 실시간 상태.",
      network: "네트워크",
      totalOnline: "전체 접속자",
      address: "접속 주소",
      lastUpdated: "마지막 갱신",
      refresh: "새로고침",
      never: "—",
      notices: "공지",
      quickLinks: "바로가기",
      serverLabels: { home: "홈", raid: "약탈", war: "국가전", peace: "평화" },
      serverDesc: {
        home: "첫 도착 광장",
        raid: "전투 중 접속 종료 = 처형",
        war: "국가만 입장",
        peace: "살해 차단",
      },
      offlineNote: "서버 준비 중입니다",
      players: "접속자",
      latency: "응답",
      version: "버전",
      noticeItems: [
        { date: "2026-09-12", tag: "개발", title: "웹사이트 1차 공개 — 실시간 서버 상태 대시보드 오픈" },
        { date: "2026-09-12", tag: "정책", title: "접속 시 디스코드 인증 의무화 결정" },
        { date: "2026-09-12", tag: "로드맵", title: "홈 서버(Phase 2) 구축 착수" },
      ],
    },
  },

  en: {
    nav: {
      goToServer: "Go to Server",
      status: "Server Status",
      landing: "About",
      enter: "Enter Ruc Home",
      home: "Home",
      rules: "Rules",
      wiki: "Wiki",
      charge: "Top-up",
      menu: "Menu",
      koOnly: "This page is Korean only for now",
      search: "Search the site",
      searchPlaceholder: "Search (content is in Korean)  ( Ctrl K )",
      searchClose: "Close search",
    },
    hero: {
      eyebrow: "MINECRAFT SERVER NETWORK",
      title: ["Ruc Server", "Season 1"],
      sub: "A Minecraft network where every server shares one wallet.",
      ctaDiscord: "Join the Discord",
      copyAddress: "Copy address",
      copied: "Copied!",
    },
    strip: {
      label: "Live status",
      online: "Online",
      offline: "Offline",
      players: "players",
      loading: "Checking…",
    },
    highlights: {
      eyebrow: "AT A GLANCE",
      heading: "Three things make Ruc different.",
      items: [
        { glyph: "₩", title: "One wallet", desc: "Gold and your level follow you to every server." },
        { glyph: "⚔", title: "No running away", desc: "Log out mid-fight on the Raiding Server and you lose it all." },
        { glyph: "✓", title: "Power can't be bought", desc: "Support only buys cosmetics and convenience." },
      ],
    },
    modes: {
      eyebrow: "SERVERS",
      heading: "Four servers, four rulebooks.",
      items: [
        { key: "home", name: "Home", tag: "HUB", hook: "The safe plaza everyone lands in first." },
        { key: "raid", name: "Raiding", tag: "PVP", hook: "PvP and looting. No running away." },
        { key: "war", name: "Nation War", tag: "WAR", hook: "Guilds become nations and take land.", paused: true },
        { key: "peace", name: "Peace", tag: "PEACE", hook: "No one can kill you here.", paused: true },
      ],
      live: "Live",
      paused: "Paused",
    },
    finalCta: {
      heading: "Ready? Come on in.",
      lead: "Announcements, verification and reports all run on Discord.",
      button: "Join the Discord",
    },
    footer: {
      tagline: "Four worlds, one economy.",
      madeWith: "Ruc Server",
      links: [
        { label: "Home", href: "/home" },
        { label: "Rules", href: "/rules" },
        { label: "Wiki", href: "/wiki" },
        { label: "Server status", href: "/en/status" },
        { label: "Discord", href: DISCORD_INVITE },
      ],
    },
    status: {
      title: "Server Status",
      lead: "Everything you need, without opening Discord.",
      network: "Network",
      totalOnline: "Players online",
      address: "Server address",
      lastUpdated: "Last updated",
      refresh: "Refresh",
      never: "—",
      notices: "Announcements",
      quickLinks: "Quick links",
      serverLabels: { home: "Home", raid: "Raiding Server", war: "Nation War", peace: "Peace" },
      serverDesc: {
        home: "The plaza everyone lands in first",
        raid: "Combat-log and lose everything",
        war: "Nation members only",
        peace: "Direct and indirect kills blocked",
      },
      offlineNote: "Server not live yet",
      players: "Players",
      latency: "Latency",
      version: "Version",
      noticeItems: [
        { date: "2026-09-12", tag: "Dev", title: "Website v1 — live server status dashboard is up" },
        { date: "2026-09-12", tag: "Policy", title: "Discord verification on join is now required" },
        { date: "2026-09-12", tag: "Roadmap", title: "Home server (Phase 2) construction started" },
      ],
    },
  },
};

export function t(lang: Lang) {
  return content[lang];
}

/** §7.8 URL 규칙: 한국어는 루트, 영어는 /en 접두. */
export function path(lang: Lang, p: string) {
  const clean = p === "/" ? "" : p;
  return lang === "ko" ? clean || "/" : `/en${clean}`;
}
