// 개발 캐릭터 준비 (로컬 개발 서버 전용): 개발 티켓 → 캐릭터 만들기 → 레벨 → 광장 직업 교관 앞 → 1차 · 2차 전직.
// 사용: node RUC_RPG/scripts/devchar.mjs <개발 이름> <닉네임> <속성> <레벨> [계열] [세부 직업] [보조 속성]
import { createRequire } from "node:module";
const require = createRequire(new URL("../server/package.json", import.meta.url));
const WebSocket = require("ws");
const [name, nick, el = "fire", lv = "30", line, job, sub] = process.argv.slice(2);
const { ticket } = await (await fetch(`http://localhost:3000/api/rpg/ticket?dev=${encodeURIComponent(name)}`, { method: "POST" })).json();
const ws = new WebSocket("ws://localhost:2567", { headers: { origin: "http://localhost:3000" } });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
ws.on("message", (d, bin) => { if (bin) return; const m = JSON.parse(d.toString()); if (["error", "need_create", "joined", "prog"].includes(m.t)) console.log(m.t, m.msg ?? m.prog?.job ?? m.prog?.line ?? ""); });
await new Promise((r) => ws.on("open", r));
const send = (m) => ws.send(JSON.stringify(m));
send({ t: "hello", ticket });
await sleep(800);
send({ t: "create", nickname: nick, appearance: { hair: 1, hairColor: 2, skin: 0, eyes: 1 }, element: el });
await sleep(1200);
send({ t: "dev", lv: Number(lv) });
await sleep(400);
send({ t: "dev", map: "plaza", x: 968, y: 232 });
await sleep(1500);
if (line) { send({ t: "job", line }); await sleep(500); }
if (job) { send({ t: "job", job, sub }); await sleep(800); }
ws.close();
console.log("done", name);
