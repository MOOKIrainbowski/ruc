import crypto from "node:crypto";
import { AGREE_CHANNEL_ID, bot, channelMessages, openThread, secret, type Message } from "./discord";

/**
 * 이용약관 동의 (2026-10-13).
 *
 * 1. 게임 서버(RucCore TermsService)가 처음 들어온 플레이어에게 서명한 링크를 보냅니다:
 *    /terms/agree?u=<uuid>&n=<닉네임>&t=<발급 초>&s=<HMAC(u|n|t)>
 *    서명 키 = RUC_TERMS_SECRET (게임 config 의 terms.secret 과 같은 값). 남의 UUID 로 동의할 수 없게 하는 장치입니다.
 * 2. 디스코드로 로그인한 사람이 동의하면 "📝ㅣ약관동의" 채널에 `RUCAGREE {json}` 한 줄을 남깁니다.
 * 3. 게임 서버가 /api/terms/agreements 를 주기적으로 읽어 DB 에 적습니다 (웹은 집 PC 의 게임 DB 에 닿지 않습니다).
 */

export const AGREE_TAG = "ruc-agree";
const LINK_DAYS = 7;

export type AgreeLink = { u: string; n: string; t: string; s: string };
export type Agreement = { id: string; uuid: string; name: string; discord: string; version: string; at: number };

export function hmac(text: string) {
  return crypto.createHmac("sha256", secret("terms")).update(text).digest("hex");
}

function equal(a: string, b: string) {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

/** 링크가 게임 서버가 만든 것이고 아직 유효한가. 문제가 있으면 이유. */
export function checkLink(l: Partial<AgreeLink>): string | null {
  if (!secret("terms")) return "웹 설정이 아직 끝나지 않았습니다 (RUC_TERMS_SECRET)";
  if (!l.u || !l.n || !l.t || !l.s) return "링크가 잘렸습니다. 게임 안의 링크를 다시 눌러 주세요";
  if (!/^[0-9a-f-]{36}$/i.test(l.u) || !/^\w{1,16}$/.test(l.n) || !/^\d+$/.test(l.t)) return "링크 형식이 올바르지 않습니다";
  if (!equal(hmac(`${l.u}|${l.n}|${l.t}`), l.s)) return "링크 서명이 맞지 않습니다";
  if (Date.now() / 1000 - Number(l.t) > LINK_DAYS * 86400) return "만료된 링크입니다. 게임에 다시 접속하면 새 링크가 옵니다";
  return null;
}

function parse(m: Message): Agreement | null {
  try {
    return { id: m.id, ...JSON.parse(m.content.slice(9)) };
  } catch {
    return null;
  }
}

/** ponytail: 최근 500건을 훑음 — 동의자가 많아지면 게임 서버가 알려 주는 방식으로 */
export async function findAgreement(uuid: string): Promise<Agreement | null> {
  const list = await channelMessages(AGREE_CHANNEL_ID, "RUCAGREE ", [AGREE_TAG]);
  for (const m of list) {
    const a = parse(m);
    if (a?.uuid === uuid) return a;
  }
  return null;
}

export async function recordAgreement(a: Omit<Agreement, "id">) {
  await openThread(AGREE_CHANNEL_ID);
  return bot(`/channels/${AGREE_CHANNEL_ID}/messages`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content: `RUCAGREE ${JSON.stringify(a)}`, allowed_mentions: { parse: [] } }),
  });
}

/**
 * 게임 서버용 — after 이후의 동의, 오래된 것부터 최대 100건.
 * last = 이번에 읽은 메시지 중 가장 최근 ID (동의가 아닌 메시지도 포함 — 다음 요청의 after). more = 더 있음.
 */
export async function agreementsAfter(after: string) {
  const list = (await bot(`/channels/${AGREE_CHANNEL_ID}/messages?limit=100&after=${after}`, {
    cache: "no-store",
  })) as Message[];
  const sorted = [...list].sort((x, y) => (BigInt(x.id) < BigInt(y.id) ? -1 : 1));
  const items = sorted
    .filter((m) => m.author.bot && m.content.startsWith("RUCAGREE "))
    .map(parse)
    .filter((a): a is Agreement => a !== null);
  return { items, last: sorted.at(-1)?.id ?? after, more: list.length === 100 };
}

export function checkApiSig(after: string, sig: string | null) {
  return !!secret("terms") && !!sig && equal(hmac(`agreements:${after}`), sig);
}
