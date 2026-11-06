/**
 * 개발용 봇 — 동기화 확인 · 부하 테스트(§29: 50명). 서버를 --dev 로 띄운 뒤:
 *   node scripts/bots.ts [인원=1] [ws 주소=ws://localhost:2567]
 * 봇마다 사각형을 그리며 걷고 가끔 달립니다.
 */
import { WebSocket } from "ws";
import { SIM_MS } from "../../../web/rpg/shared/constants.ts";
import { DEV_TICKET_SECRET, signTicket } from "../../../web/rpg/shared/ticket.ts";

const n = Number(process.argv[2]) || 1;
const url = process.argv[3] || "ws://localhost:2567";
const MOVES = [[1, 0], [0, 1], [-1, 0], [0, -1]];

for (let i = 1; i <= n; i++) {
  const name = `봇${i}`;
  const ws = new WebSocket(url);
  const send = (m: object) => ws.send(JSON.stringify(m));
  let seq = 0;
  ws.on("open", () => send({ t: "hello", ticket: signTicket({ sub: `bot-${i}`, name, avatar: null }, DEV_TICKET_SECRET) }));
  ws.on("message", (d) => {
    const m = JSON.parse(String(d));
    if (m.t === "needCreate") send({ t: "create", nickname: name, appearance: { hair: i % 6, hairColor: i % 8, skin: i % 4, eyes: i % 4 }, element: "water" });
    if (m.t === "joined" && seq === 0) {
      console.log(`${name} 입장 (${m.room.kind} ${m.room.ch}채널)`);
      setInterval(() => {
        const leg = Math.floor(seq / 90) % 4; // 1.5초마다 방향 전환
        const [mx, my] = MOVES[(leg + i) % 4];
        send({ t: "in", seq: seq++, mx, my, run: seq % 600 > 450 });
      }, SIM_MS);
    }
    if (m.t === "kicked") console.log(`${name} 끊김: ${m.reason}`);
  });
}
