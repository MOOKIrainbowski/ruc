/**
 * 게임 → 웹 피드 (2026-10-09, docs/08 B).
 *
 * 약탈 서버(RucRaid)가 10분마다 · 알 주인이 바뀔 때 디스코드 비공개 "피드" 채널의 상태 메시지 하나(`RUCFEED <json>`)를
 * 고쳐 쓰고, 4개 서버가 같은 채널에 연대기 줄을 올립니다. 웹은 봇 토큰으로 그 채널을 읽습니다. 게임 DB(집 PC)에 직접 붙지 않는 이유는
 * docs/08 "웹으로 데이터 보내는 길" 참고.
 *
 * 환경변수 (Vercel): DISCORD_BOT_TOKEN · FEED_CHANNEL_ID. 없으면 null — 화면은 안내만 띄웁니다.
 */

export type RaidFeed = {
  season: string;
  egg: { holder: string | null; since: number | null; online: boolean };
  top: { name: string; seconds: number }[];
  bounty: { pool: number; wanted: number };
  at: number;
};

type Message = { id: string; content?: string; timestamp: string; webhook_id?: string };

/**
 * 피드 채널의 웹훅 메시지, 최근 것부터. 상태 메시지 하나(고쳐 쓰임)와 연대기 줄이 섞여 있습니다.
 * 같은 주소의 fetch 는 Next 가 한 번만 보내므로 상태 · 연대기가 같이 써도 요청은 그대로입니다.
 */
async function feedMessages(): Promise<Message[] | null> {
  const token = process.env.DISCORD_BOT_TOKEN?.trim();
  const channel = process.env.FEED_CHANNEL_ID?.trim();
  if (!token || !channel) return null;
  const out: Message[] = [];
  let before = "";
  try {
    // ponytail: 최근 500건까지만 (요청 5번). 연대기가 더 쌓이면 시즌별 아카이브로.
    for (let page = 0; page < 5; page++) {
      const res = await fetch(
        `https://discord.com/api/v10/channels/${channel}/messages?limit=100${before && `&before=${before}`}`,
        { headers: { Authorization: `Bot ${token}` }, next: { revalidate: 60 } },
      );
      if (!res.ok) return out.length ? out : null;
      const messages = (await res.json()) as Message[];
      out.push(...messages.filter((m) => m.webhook_id && m.content));
      if (messages.length < 100) break;
      before = messages[messages.length - 1].id;
    }
  } catch {
    // 디스코드 장애 — 읽은 데까지만
  }
  return out;
}

export async function getRaidFeed(): Promise<RaidFeed | null> {
  for (const m of (await feedMessages()) ?? []) {
    if (!m.content!.startsWith("RUCFEED ")) continue;
    try {
      const data = JSON.parse(m.content!.slice(8));
      if (data?.type === "raid") return data as RaidFeed;
    } catch {
      // 잘못된 줄 — 다음 것
    }
  }
  return null;
}

/** 3612 → "1시간 0분" */
export function formatReign(seconds: number) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return h > 0 ? `${h}시간 ${m}분` : `${m}분`;
}

export type ChronicleEntry = { id: string; text: string; at: string };

/** 러크 연대기 (docs/08 E) — 피드 채널에서 상태 메시지(RUCFEED)를 뺀 나머지 웹훅 줄. 설정 전이면 null. */
export async function getChronicle(): Promise<ChronicleEntry[] | null> {
  const messages = await feedMessages();
  if (!messages) return null;
  return messages
    .filter((m) => !m.content!.startsWith("RUCFEED "))
    .map((m) => ({ id: m.id, text: m.content!, at: m.timestamp }));
}
