// 헤드리스 크롬으로 화면 캡처 (브라우저 확장이 안 붙을 때 · 시각 확인용). 개발 서버 둘(웹 3000 · 게임 2567)이 떠 있어야 함.
// 사용: node RUC_RPG/scripts/shot.mjs <url> <out.png> [기다릴 ms] [캡처 전에 실행할 JS] [clipX,clipY,clipW,clipH,scale]
// 예:   node RUC_RPG/scripts/shot.mjs "http://localhost:3000/rpg?dev=테스터" shot.png 14000 "(async()=>{window.__rpg.net.send({t:'dev',map:'field',x:448,y:1280});await new Promise(r=>setTimeout(r,3000));return 'ok'})()"
// 게임 안에서 window.__rpg(개발 모드 전용)로 순간이동 · 아이템 · 설정을 바꿀 수 있음. 키 입력은 window.dispatchEvent(new KeyboardEvent("keydown",{code:"KeyJ"}))
import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";
import { createRequire } from "node:module";
const require = createRequire(new URL("../server/package.json", import.meta.url)); // ws 는 서버 node_modules 것을 씀
const WebSocket = require("ws");
const [url, out, waitMs = "15000", js = "", clip = ""] = process.argv.slice(2);
const port = 9400 + Math.floor(Math.random() * 300);
const chrome = spawn("C:/Program Files/Google/Chrome/Application/chrome.exe", [
  "--headless=new", `--remote-debugging-port=${port}`, "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist",
  "--window-size=1536,800", `--user-data-dir=${process.env.TEMP}/ruc-cdp-${port}`, "about:blank",
], { stdio: "ignore" });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let targets;
for (let i = 0; i < 40; i++) {
  try { targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json(); if (targets.some((t) => t.type === "page")) break; } catch {}
  await sleep(500);
}
const page = targets.find((t) => t.type === "page");
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r) => ws.on("open", r));
let id = 0;
const pending = new Map();
ws.on("message", (m) => { const d = JSON.parse(m); if (d.id && pending.has(d.id)) { pending.get(d.id)(d); pending.delete(d.id); } });
const call = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
await call("Page.enable");
await call("Emulation.setDeviceMetricsOverride", { width: 1536, height: 800, deviceScaleFactor: 1, mobile: false });
await call("Page.navigate", { url });
await sleep(Number(waitMs));
if (js) { const r = await call("Runtime.evaluate", { expression: js, awaitPromise: true, returnByValue: true }); console.log("js:", JSON.stringify(r.result?.result?.value ?? r.result?.exceptionDetails?.text)); await sleep(2500); }
const params = { format: "png" };
if (clip) { const [x, y, width, height, scale = 1] = clip.split(",").map(Number); params.clip = { x, y, width, height, scale }; }
const shot = await call("Page.captureScreenshot", params);
writeFileSync(out, Buffer.from(shot.result.data, "base64"));
console.log("saved", out);
ws.close();
chrome.kill();
process.exit(0);
