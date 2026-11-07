/**
 * 개발용 봇 — 동기화 확인 · 부하 테스트(§29: 50명). 서버를 --dev 로 띄운 뒤:
 *   node scripts/bots.ts [인원=1] [ws 주소=ws://localhost:2567] [field]
 * 봇마다 사각형을 그리며 걷고 가끔 달립니다. field 를 붙이면 햇살 초원 슬라임 언덕으로 가서 마력 화살을 쏩니다.
 */
import { readFileSync } from "node:fs";
import { WebSocket } from "ws";
import { SIM_MS } from "../../../web/rpg/shared/constants.ts";
import { loadMap, type TiledMap } from "../../../web/rpg/shared/map.ts";
import { DEV_TICKET_SECRET, signTicket } from "../../../web/rpg/shared/ticket.ts";

const n = Number(process.argv[2]) || 1;
const url = process.argv[3] || "ws://localhost:2567";
const field = process.argv[4] === "field";
const MOVES = [[1, 0], [0, 1], [-1, 0], [0, -1]];
const fieldMap = loadMap(JSON.parse(readFileSync(new URL("../../../web/rpg/shared/data/maps/field.json", import.meta.url), "utf8")) as TiledMap);
const hill = fieldMap.objects.find((o) => o.type === "spawn_zone" && o.name === "슬라임 언덕")!;

for (let i = 1; i <= n; i++) {
  const name = `봇${i}`;
  const ws = new WebSocket(url);
  const send = (m: object) => ws.send(JSON.stringify(m));
  let seq = 0;
  let x = 0;
  let y = 0;
  ws.on("open", () => send({ t: "hello", ticket: signTicket({ sub: `bot-${i}`, name, avatar: null }, DEV_TICKET_SECRET) }));
  ws.on("message", (d) => {
    const m = JSON.parse(String(d));
    if (m.t === "needCreate") send({ t: "create", nickname: name, appearance: { hair: i % 6, hairColor: i % 8, skin: i % 4, eyes: i % 4 }, element: ["water", "fire", "ice", "electric"][i % 4] });
    if (m.t === "s") ({ x, y } = m.ack.m);
    if (m.t === "joined") {
      console.log(`${name} 입장 (${m.room.kind} ${m.room.ch}채널)`);
      if (field && m.room.kind !== "field") send({ t: "dev", map: "field", x: hill.x + ((i * 37) % 160) - 80, y: hill.y - hill.height / 2 + ((i * 53) % 120) - 60 });
      if (seq > 0) return;
      setInterval(() => {
        const leg = Math.floor(seq / 90) % 4; // 1.5초마다 방향 전환
        const [mx, my] = MOVES[(leg + i) % 4];
        const a = (seq * 0.37 + i) % (Math.PI * 2);
        const shoot = field && seq % 100 === i % 100 ? { k: "Q", ax: Math.round(x + Math.cos(a) * 120), ay: Math.round(y + Math.sin(a) * 120) } : {};
        send({ t: "in", seq: seq++, mx, my, run: seq % 600 > 450, ...shoot });
      }, SIM_MS);
    }
    if (m.t === "kicked") console.log(`${name} 끊김: ${m.reason}`);
  });
}
