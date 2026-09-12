// 사이트 전체 문안. 한국어 기본 / 영어 (§6.3, §7.4)
// 새 문안을 추가할 때는 반드시 ko/en 양쪽에 넣으세요 — 타입이 강제합니다.

export type Lang = "ko" | "en";

export const DISCORD_INVITE = "https://discord.gg/sTVAJ38ea";

/** 서버 접속 주소. Phase 2에서 실제 주소로 교체. */
export const MC_ADDRESS = process.env.NEXT_PUBLIC_MC_ADDRESS ?? "play.rucserver.kr";

// 주의: 아래 키("raid" 등)는 화면에 보이는 이름이 아니라 내부 식별자입니다.
// 환경변수(MC_HOST_RAID)와 API 응답에 그대로 쓰이므로 바꾸지 마세요.
// 표시 이름은 serverLabels / modes.items.name 에서만 바꿉니다.
export const SERVER_KEYS = ["home", "raid", "war", "peace"] as const;
export type ServerKey = (typeof SERVER_KEYS)[number];

type Copy = {
  nav: { goToServer: string; status: string; landing: string };
  hero: {
    eyebrow: string;
    title: string[];
    titleAccent: string;
    sub: string;
    ctaDiscord: string;
    ctaStatus: string;
    copyAddress: string;
    copied: string;
  };
  strip: { label: string; online: string; offline: string; players: string; loading: string };
  problem: {
    eyebrow: string;
    heading: string;
    lead: string;
    items: { problem: string; solution: string; feature: string; featureDesc: string }[];
  };
  modes: {
    eyebrow: string;
    heading: string;
    lead: string;
    items: { key: ServerKey; name: string; tag: string; hook: string; rule: string }[];
  };
  war: {
    eyebrow: string;
    heading: string;
    lead: string;
    steps: { n: string; title: string; desc: string }[];
  };
  egg: { eyebrow: string; heading: string; lead: string; buffs: string[]; cost: string };
  rep: {
    eyebrow: string;
    heading: string;
    lead: string;
    tiers: { name: string; color: string; desc: string }[];
    note: string;
  };
  tiers: {
    eyebrow: string;
    heading: string;
    lead: string;
    notP2W: string;
    rows: { name: string; price: string; perks: string }[];
  };
  roadmap: {
    eyebrow: string;
    heading: string;
    items: { phase: string; title: string; state: "done" | "wip" | "todo"; desc: string }[];
    stateLabel: Record<"done" | "wip" | "todo", string>;
  };
  faq: { eyebrow: string; heading: string; items: { q: string; a: string }[] };
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
    nav: { goToServer: "서버 가기", status: "서버 상태", landing: "소개" },
    hero: {
      eyebrow: "MINECRAFT SERVER NETWORK",
      title: ["4개의 세계,", "하나의 경제."],
      titleAccent: "러크 서버",
      sub: "안전한 광장에서 시작해, 원하는 만큼만 위험해지세요.\n약탈 · 국가전 · 평화 — 어디서 벌든 Ruc는 하나로 이어집니다.",
      ctaDiscord: "디스코드 참여하기",
      ctaStatus: "실시간 서버 상태",
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
    problem: {
      eyebrow: "WHY RUC",
      heading: "다른 서버에서 지쳤던\n바로 그 이유들.",
      lead: "규칙으로 부탁하지 않습니다. 애초에 안 되게 만들었습니다.",
      items: [
        {
          problem: "“결국 돈 쓴 사람이 이긴다”",
          solution: "후원 혜택은 꾸미기와 편의뿐입니다. 전투 능력치는 어떤 등급으로도 살 수 없습니다.",
          feature: "후원 등급 설계",
          featureDesc: "무기·방어구·강화 재료는 어떤 등급에서도 팔지 않습니다.",
        },
        {
          problem: "“불리하면 렉 걸린 척 나가버린다”",
          solution: "약탈 서버에서 전투 중 접속을 끊으면, 재접속하는 순간 죽습니다.",
          feature: "콤벳로그 처형",
          featureDesc: "아이템은 떨어지지도 않고 사라지고, 경험치도 초기화됩니다.",
        },
        {
          problem: "“처음 만난 사람을 믿을 수가 없다”",
          solution: "모든 플레이어에게 7단계 평판 색이 붙습니다. 이름만 봐도 전력이 보입니다.",
          feature: "평판 시스템",
          featureDesc: "제재를 받으면 내려가고, 함께 플레이한 사람의 추천으로 올라갑니다.",
        },
      ],
    },
    modes: {
      eyebrow: "FOUR MODES",
      heading: "네 개의 서버,\n전부 다른 규칙.",
      lead: "접속하면 먼저 홈 광장에 떨어집니다. 그다음은 당신이 정합니다.",
      items: [
        {
          key: "home",
          name: "홈",
          tag: "HUB",
          hook: "모두가 처음 도착하는 안전한 광장.",
          rule: "PvP 불가 · 블록 파괴/설치 불가",
        },
        {
          key: "raid",
          name: "약탈",
          tag: "PVP",
          hook: "도망칠 곳은 없습니다. 끝까지 싸우세요.",
          rule: "전투 중 접속 종료 시 아이템·경험치 전부 소멸",
        },
        {
          key: "war",
          name: "국가전",
          tag: "WAR",
          hook: "길드가 국가가 되고, 국가가 땅을 빼앗습니다.",
          rule: "국가 소속만 입장 가능 · 전쟁 시간대에만 개전",
        },
        {
          key: "peace",
          name: "평화",
          tag: "PEACE",
          hook: "건축과 생존에만 집중하고 싶다면.",
          rule: "직접·간접 살해 전부 차단",
        },
      ],
    },
    war: {
      eyebrow: "NATION WAR",
      heading: "땅은 주어지지 않습니다.\n지켜낸 만큼만 내 것입니다.",
      lead: "길드원이 일정 수를 넘으면 국가로 인정받습니다.",
      steps: [
        { n: "01", title: "국가 수립", desc: "길드원이 기준치를 넘으면 국가로 승격됩니다." },
        { n: "02", title: "코어 제작", desc: "혼자서는 못 만듭니다. 길드 전체가 모아야 하나 나옵니다." },
        { n: "03", title: "전쟁 시간대", desc: "접속자가 가장 많은 시간대에만 개전합니다." },
        { n: "04", title: "코어 설치 · 방어", desc: "코어를 박고 버티세요. 지켜내면 그 영토는 국가의 것입니다." },
      ],
    },
    egg: {
      eyebrow: "DRAGON EGG",
      heading: "전 서버에 단 두 개.",
      lead: "약탈에 하나, 평화에 하나. 들고만 있으면 어느 서버에서든 효과가 따라옵니다.",
      buffs: [
        "최대 체력 +2칸",
        "성급함 I",
        "Ruc 획득량 +15%",
        "경험치 획득량 +10%",
        "비전투 시 재생 I",
      ],
      cost: "대신 위치가 주기적으로 드러나고, 죽으면 떨어뜨립니다.",
    },
    rep: {
      eyebrow: "REPUTATION",
      heading: "이름 옆의 색 하나로\n충분합니다.",
      lead: "거래를 해도 되는 사람인지, 길드에 받아도 되는 사람인지 바로 보입니다.",
      tiers: [
        { name: "초록", color: "#4ade80", desc: "최상위 신뢰" },
        { name: "노랑", color: "#facc15", desc: "양호" },
        { name: "빨강", color: "#ef4444", desc: "신규 기본값" },
        { name: "보라", color: "#a855f7", desc: "주의" },
        { name: "파랑", color: "#3b82f6", desc: "경고 이력" },
        { name: "남색", color: "#1e3a8a", desc: "제재 이력" },
        { name: "검정", color: "#27272a", desc: "거래 제한" },
      ],
      note: "모두가 빨강에서 시작합니다. 초록은 받는 게 아니라 쌓는 것입니다.",
    },
    tiers: {
      eyebrow: "SUPPORT",
      heading: "후원은 응원이지,\n무기가 아닙니다.",
      lead: "꾸미기 · 편의 · 소속감. 저희가 파는 건 이 세 가지뿐입니다.",
      notP2W: "어떤 등급도 전투 능력치·장비·강화 재료를 제공하지 않습니다.",
      rows: [
        { name: "Ruc", price: "무료", perks: "기본 /home 1개 · 모든 서버 접속" },
        { name: "VIP", price: "—", perks: "/home 2개 · 채팅 색상 · 코스메틱 3종" },
        { name: "SVIP", price: "—", perks: "/home 3개 · 커스텀 입장 메시지 · /nick" },
        { name: "MVP", price: "—", perks: "/home 5개 · 코스메틱 펫 · 후원자 라운지" },
        { name: "Prime", price: "—", perks: "/home 8개 · 시즌 한정 코스메틱 · /ec" },
        { name: "Premium", price: "—", perks: "/home 12개 · 신규 모드 선행 접속 · /craft" },
        { name: "Elite", price: "—", perks: "/home 20개 · 커스텀 칭호 · 홈 서버 개인 조형물" },
      ],
    },
    roadmap: {
      eyebrow: "ROADMAP",
      heading: "지금 어디까지 왔는지\n숨기지 않습니다.",
      items: [
        { phase: "Phase 0", title: "기반 · 보안", state: "done", desc: "저장소 구성, 봇 안정화" },
        { phase: "Phase 1", title: "웹사이트", state: "wip", desc: "랜딩 · 실시간 상태" },
        { phase: "Phase 2", title: "홈 서버", state: "todo", desc: "광장, 디스코드 인증" },
        { phase: "Phase 3", title: "약탈 서버", state: "todo", desc: "콤벳로그 처형, 드래곤 알" },
        { phase: "Phase 4", title: "국가전 서버", state: "todo", desc: "길드 · 코어 · 영토 전쟁" },
        { phase: "Phase 5", title: "평화 서버", state: "todo", desc: "간접 살해 전면 차단" },
      ],
      stateLabel: { done: "완료", wip: "진행 중", todo: "예정" },
    },
    faq: {
      eyebrow: "FAQ",
      heading: "자주 묻는 것들",
      items: [
        { q: "무료인가요?", a: "네. 모든 서버와 콘텐츠가 무료입니다." },
        {
          q: "접속하려면 디스코드가 필요한가요?",
          a: "네. 첫 접속 시 홈 서버 인증 구역에서 6자리 코드를 받아 디스코드에 입력하면 바로 풀립니다. 그리핑과 부계정 공격을 막기 위한 절차입니다.",
        },
        { q: "어떤 버전인가요?", a: "자바 에디션 1.21.x입니다." },
        { q: "모바일(베드락)로 접속되나요?", a: "현재는 자바 에디션 전용입니다." },
        { q: "혼자 해도 되나요?", a: "됩니다. 국가전만 길드 소속이 필요합니다." },
        { q: "신고는 어떻게 하나요?", a: "인게임에서 /신고 를 입력하면 디스코드 신고 채널로 연결됩니다." },
      ],
    },
    finalCta: {
      heading: "먼저 디스코드부터.",
      lead: "공지, 신고, 서버 상태, 길드 모집까지 전부 디스코드에서 돌아갑니다.",
      button: "디스코드 참여하기",
    },
    footer: {
      tagline: "4개의 세계, 하나의 경제.",
      madeWith: "러크 서버",
      links: [
        { label: "서버 상태", href: "/status" },
        { label: "디스코드", href: DISCORD_INVITE },
      ],
    },
    status: {
      title: "서버 상태",
      lead: "디스코드에 들어가지 않아도, 여기서 전부 확인할 수 있습니다.",
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
        home: "모두가 처음 도착하는 광장",
        raid: "전투 중 접속 종료 시 전부 소멸",
        war: "국가 소속만 입장 가능",
        peace: "직접·간접 살해 전면 차단",
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
    nav: { goToServer: "Go to Server", status: "Server Status", landing: "About" },
    hero: {
      eyebrow: "MINECRAFT SERVER NETWORK",
      title: ["Four worlds,", "one economy."],
      titleAccent: "Ruc Server",
      sub: "Start safe in the plaza. Get as dangerous as you want.\nRaiding Server, Nation War, Peace — whatever you earn, Ruc carries across all of it.",
      ctaDiscord: "Join the Discord",
      ctaStatus: "Live server status",
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
    problem: {
      eyebrow: "WHY RUC",
      heading: "The exact reasons\nyou quit other servers.",
      lead: "We don't ask players nicely. We made it impossible.",
      items: [
        {
          problem: "“Whoever spends the most just wins.”",
          solution: "Supporter perks are cosmetics and convenience. Combat power is not for sale at any tier.",
          feature: "Supporter tier design",
          featureDesc: "No tier sells weapons, armor, or upgrade materials.",
        },
        {
          problem: "“They 'lag out' the moment they're losing.”",
          solution: "Disconnect mid-fight on the Raiding Server and you die the instant you reconnect.",
          feature: "Combat-log execution",
          featureDesc: "Your items don't even hit the ground, and your XP resets to zero.",
        },
        {
          problem: "“You can't tell if a stranger is trustworthy.”",
          solution: "Every player carries a 7-tier reputation color. You can read their record from their name.",
          feature: "Reputation system",
          featureDesc: "It drops on punishments and rises through endorsements from people you played with.",
        },
      ],
    },
    modes: {
      eyebrow: "FOUR MODES",
      heading: "Four servers,\nfour different rulebooks.",
      lead: "You always land in the Home plaza first. Where you go next is up to you.",
      items: [
        { key: "home", name: "Home", tag: "HUB", hook: "The safe plaza everyone lands in first.", rule: "No PvP · No building or breaking" },
        { key: "raid", name: "Raiding Server", tag: "PVP", hook: "There's nowhere to run. Finish the fight.", rule: "Combat-log and lose every item and all XP" },
        { key: "war", name: "Nation War", tag: "WAR", hook: "Guilds become nations. Nations take land.", rule: "Nation members only · War windows only" },
        { key: "peace", name: "Peace", tag: "PEACE", hook: "For building and surviving, nothing else.", rule: "Direct and indirect kills both blocked" },
      ],
    },
    war: {
      eyebrow: "NATION WAR",
      heading: "Land isn't given.\nYou keep what you hold.",
      lead: "Pass the member threshold and your guild is recognized as a Nation.",
      steps: [
        { n: "01", title: "Found a nation", desc: "Pass the member threshold and your guild becomes a Nation." },
        { n: "02", title: "Build a Core", desc: "Nobody builds one alone. It takes a whole guild." },
        { n: "03", title: "War window", desc: "War only opens during peak hours." },
        { n: "04", title: "Place and defend", desc: "Plant your Core and hold it. Defend it, and the territory is yours." },
      ],
    },
    egg: {
      eyebrow: "DRAGON EGG",
      heading: "Only two exist. Network-wide.",
      lead: "One on the Raiding Server, one on Peace. Just hold it and the buffs follow you across every server.",
      buffs: ["+2 hearts max health", "Haste I", "+15% Ruc gain", "+10% XP gain", "Regeneration I out of combat"],
      cost: "In exchange, your position is revealed periodically, and you drop it when you die.",
    },
    rep: {
      eyebrow: "REPUTATION",
      heading: "One color next to a name\nis enough.",
      lead: "Safe to trade with? Safe to recruit? You can see it at a glance.",
      tiers: [
        { name: "Green", color: "#4ade80", desc: "Highest trust" },
        { name: "Yellow", color: "#facc15", desc: "Good standing" },
        { name: "Red", color: "#ef4444", desc: "Everyone starts here" },
        { name: "Purple", color: "#a855f7", desc: "Caution" },
        { name: "Blue", color: "#3b82f6", desc: "Warned before" },
        { name: "Indigo", color: "#1e3a8a", desc: "Repeat offender" },
        { name: "Dark", color: "#27272a", desc: "Trade restricted" },
      ],
      note: "Everyone starts at Red. Green isn't granted — it's earned.",
    },
    tiers: {
      eyebrow: "SUPPORT",
      heading: "Support is a cheer,\nnot a weapon.",
      lead: "Cosmetics, convenience, belonging. That's the entire list of what we sell.",
      notP2W: "No tier grants combat stats, gear, or upgrade materials.",
      rows: [
        { name: "Ruc", price: "Free", perks: "1 /home · access to every server" },
        { name: "VIP", price: "—", perks: "2 homes · chat color · 3 cosmetics" },
        { name: "SVIP", price: "—", perks: "3 homes · custom join message · /nick" },
        { name: "MVP", price: "—", perks: "5 homes · cosmetic pets · supporter lounge" },
        { name: "Prime", price: "—", perks: "8 homes · seasonal cosmetics · /ec" },
        { name: "Premium", price: "—", perks: "12 homes · early access to new modes · /craft" },
        { name: "Elite", price: "—", perks: "20 homes · custom title · personal statue in Home" },
      ],
    },
    roadmap: {
      eyebrow: "ROADMAP",
      heading: "We don't hide\nwhere we actually are.",
      items: [
        { phase: "Phase 0", title: "Foundation & security", state: "done", desc: "Repo setup, bot stabilized" },
        { phase: "Phase 1", title: "Website", state: "wip", desc: "Landing + live status" },
        { phase: "Phase 2", title: "Home server", state: "todo", desc: "Plaza, Discord verification" },
        { phase: "Phase 3", title: "Raiding Server", state: "todo", desc: "Combat-log execution, Dragon Egg" },
        { phase: "Phase 4", title: "Nation War server", state: "todo", desc: "Guilds, Cores, territory war" },
        { phase: "Phase 5", title: "Peace server", state: "todo", desc: "Full indirect-kill blocking" },
      ],
      stateLabel: { done: "Done", wip: "In progress", todo: "Planned" },
    },
    faq: {
      eyebrow: "FAQ",
      heading: "Common questions",
      items: [
        { q: "Is it free?", a: "Yes. Every server and all content is free." },
        {
          q: "Do I need Discord to play?",
          a: "Yes. On your first join you'll get a 6-digit code in the Home verification area — enter it in Discord and you're in. It keeps griefers and throwaway alts out.",
        },
        { q: "Which version?", a: "Java Edition 1.21.x." },
        { q: "Can I join on mobile (Bedrock)?", a: "Java Edition only for now." },
        { q: "Can I play solo?", a: "Yes. Only Nation War requires a guild." },
        { q: "How do I report someone?", a: "Type /report in game and you'll be pointed to the Discord report channel." },
      ],
    },
    finalCta: {
      heading: "Start with the Discord.",
      lead: "Announcements, reports, server status, guild recruiting — it all runs there.",
      button: "Join the Discord",
    },
    footer: {
      tagline: "Four worlds, one economy.",
      madeWith: "Ruc Server",
      links: [
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
