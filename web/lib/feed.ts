/**
 * 게임 → 웹 피드 (2026-10-09, docs/08 B).
 *
 * 약탈 서버(RucRaid)가 10분마다 · 알 주인이 바뀔 때 디스코드 비공개 "피드" 채널에 `RUCFEED <json>` 을 올립니다.
 * 웹은 봇 토큰으로 그 채널의 최근 메시지를 읽어 가장 새 줄을 씁니다. 게임 DB(집 PC)에 직접 붙지 않는 이유는
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

export async function getRaidFeed(): Promise<RaidFeed | null> {
  const token = process.env.DISCORD_BOT_TOKEN?.trim();
  const channel = process.env.FEED_CHANNEL_ID?.trim();
  if (!token || !channel) return null;
  try {
    const res = await fetch(`https://discord.com/api/v10/channels/${channel}/messages?limit=20`, {
      headers: { Authorization: `Bot ${token}` },
      next: { revalidate: 60 },
    });
    if (!res.ok) return null;
    const messages = (await res.json()) as { content?: string }[];
    // 최근 것부터 옵니다.
    for (const m of messages) {
      if (!m.content?.startsWith("RUCFEED ")) continue;
      const data = JSON.parse(m.content.slice(8));
      if (data?.type === "raid") return data as RaidFeed;
    }
  } catch {
    // 디스코드 장애 · 잘못된 줄 — 위젯만 비웁니다.
  }
  return null;
}

/** 3612 → "1시간 0분" */
export function formatReign(seconds: number) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return h > 0 ? `${h}시간 ${m}분` : `${m}분`;
}
