import type { ServerKey } from "./content";

/**
 * 각 모드의 실제 접속 주소.
 * Phase 2에서 Velocity 프록시를 세우면 환경변수로 실제 주소를 넣습니다.
 * 값이 없으면 상태 API가 해당 서버를 "준비 중"으로 표시합니다.
 */
export const SERVER_HOSTS: Record<ServerKey, string | undefined> = {
  home: process.env.MC_HOST_HOME,
  raid: process.env.MC_HOST_RAID,
  war: process.env.MC_HOST_WAR,
  peace: process.env.MC_HOST_PEACE,
};

export type ServerStatus = {
  key: ServerKey;
  online: boolean;
  players: number;
  maxPlayers: number;
  version: string | null;
  latencyMs: number | null;
  /** 주소 자체가 아직 설정되지 않은 경우 (Phase 2 이전) */
  configured: boolean;
};

export type StatusPayload = {
  servers: ServerStatus[];
  totalOnline: number;
  fetchedAt: string;
};

/**
 * mcstatus.io 공개 API로 서버를 조회합니다.
 *
 * 왜 raw TCP 핑이 아니라 HTTP API인가:
 * Vercel 서버리스 함수에서 임의 포트로 나가는 TCP 소켓은 불안정하고, 콜드스타트마다
 * 타임아웃이 잡힙니다. mcstatus.io는 자체적으로 캐시까지 해주므로 이쪽이 확실합니다.
 */
async function queryServer(key: ServerKey, host: string | undefined): Promise<ServerStatus> {
  const empty: ServerStatus = {
    key,
    online: false,
    players: 0,
    maxPlayers: 0,
    version: null,
    latencyMs: null,
    configured: Boolean(host),
  };

  if (!host) return empty;

  const started = Date.now();
  try {
    const res = await fetch(`https://api.mcstatus.io/v2/status/java/${encodeURIComponent(host)}`, {
      headers: { accept: "application/json" },
      // 서버 상태는 30초 캐시 — 새로고침 연타로 외부 API를 때리지 않게.
      next: { revalidate: 30 },
    });

    if (!res.ok) return empty;

    const data = (await res.json()) as {
      online?: boolean;
      players?: { online?: number; max?: number };
      version?: { name_clean?: string };
    };

    if (!data.online) return empty;

    return {
      key,
      online: true,
      players: data.players?.online ?? 0,
      maxPlayers: data.players?.max ?? 0,
      version: data.version?.name_clean ?? null,
      latencyMs: Date.now() - started,
      configured: true,
    };
  } catch {
    // 네트워크 실패는 "오프라인"으로 표시합니다. 사이트가 깨지면 안 됩니다.
    return empty;
  }
}

export async function getNetworkStatus(): Promise<StatusPayload> {
  const entries = Object.entries(SERVER_HOSTS) as [ServerKey, string | undefined][];
  const servers = await Promise.all(entries.map(([key, host]) => queryServer(key, host)));

  return {
    servers,
    totalOnline: servers.reduce((sum, s) => sum + s.players, 0),
    fetchedAt: new Date().toISOString(),
  };
}
