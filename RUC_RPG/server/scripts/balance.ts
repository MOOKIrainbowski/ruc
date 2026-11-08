/**
 * 밸런스 시뮬레이션 (§30 P8): ★ 직업 6개를 실제 서버 엔진(시전 · 쿨 · 자원 · 시전 시간 · 패시브 · 원소 반응)으로 돌려 비교.
 *   node scripts/balance.ts [레벨=35] [초=60]
 * - 딜: 같은 레벨 · 같은 등급 장비로 허수아비(고대 수목 기사 상급 스탯, HP 무한)에게 쿨이 돈 스킬부터 R > E > Q > W, 없으면 평타. 붙어서 침
 * - 버팀: 같은 허수아비의 물리 · 마법 일반 공격을 몇 대 맞고 쓰러지는지 (보호막 · 회복 제외)
 * - 딜러 4직업(전투기사 · 닌자 · 궁수 · 원소술사)은 중앙값 ±25% 밖이면 표시. 수호기사 · 사제는 역할상 딜이 낮은 게 정상
 */
import { rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";

process.env.RPG_DB_FILE = `balance-${process.pid}.sqlite`;
const LV = Number(process.argv[2]) || 35;
const SECS = Number(process.argv[3]) || 60;
const { TICK_MS, SIM_MS } = await import("../../../web/rpg/shared/constants.ts");
const { loadMap } = await import("../../../web/rpg/shared/map.ts");
const { computeDamage, finalStats } = await import("../../../web/rpg/shared/combat.ts");
const { MOBS, mobStats } = await import("../../../web/rpg/shared/data/mobs.ts");
const { JOBS, LINES } = await import("../../../web/rpg/shared/data/jobs.ts");
const { createCharacter, db } = await import("../src/db.ts");
const { recalc, setRandom } = await import("../src/combat.ts");
const { give, refreshGear, use } = await import("../src/items.ts");
const { changeJob, setLevel } = await import("../src/progress.ts");
const { Room, buildPlayer } = await import("../src/room.ts");

const map = loadMap(JSON.parse(readFileSync(new URL("../../../web/rpg/shared/data/maps/field.json", import.meta.url), "utf8")));
const ap = { hair: 0, hairColor: 0, skin: 0, eyes: 0 };
const WEAPON: Record<string, string> = { tank: "fang_sword", warrior: "fang_sword", assassin: "ancient_blade", ranged: "ancient_bow", mage: "ancient_staff", support: "ancient_staff" };
const STAR = Object.entries(JOBS).filter(([, j]) => j.star);
let seed = 7;
setRandom(() => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32)); // 실행마다 같은 결과

type Out = { job: string; line: string; dps: number; phys: number; mag: number; res: string };
const rows: Out[] = [];
for (const [id, job] of STAR) {
  const room = new Room("field", 99, map, 0);
  for (const m of room.mobs.values()) room.mobs.delete(m.id);
  room.zones = [];
  // 속성: 모두 불, 원소술사만 물 + 보조 전기 (반응이 직업의 핵심 — 과전류)
  const c = createCharacter(`bal-${id}`, `밸런스${rows.length}`, id === "elementalist" ? "water" : "fire", ap)!;
  const p = buildPlayer({ readyState: 0, send() {} } as never, c.discord_id, c, 600, 600);
  room.add(p);
  setLevel(p, LV);
  changeJob(p, { line: job.line });
  changeJob(p, { job: id, sub: "electric" });
  give(p, WEAPON[job.line], 1, "advanced", "balance");
  const w = p.items.find((i) => i.tpl === WEAPON[job.line])!;
  use(p, [w.loc, w.slot]);
  refreshGear(p); // 장비 스탯 · 무기 평타
  // 허수아비: 고대 수목 기사 상급 스탯 · 움직이지 않음
  const dummy = room.addMob({ mob: "purify_orb", count: 0, lv: [LV, LV], grade: "high", x: 640, y: 600, r: 0, alive: 0, respawn: [] })!;
  const base = mobStats(MOBS.tree_knight, LV, "high");
  dummy.base = { ...base, hp: 1e9 };
  dummy.el = "none";
  recalc(dummy);
  dummy.hp = dummy.st.hp;
  let now = 0;
  let seq = 0;
  for (let tick = 0; tick < (SECS * 1000) / TICK_MS; tick++) {
    p.mover.x = p.x = dummy.x - 26;
    p.mover.y = p.y = dummy.y;
    p.hp = p.st.hp; // 버팀은 따로 잼
    for (let k = 0; k < 3; k++) {
      const sim = (p.steps + 1) * SIM_MS;
      const slot = (["R", "E", "Q", "W"] as const).find((s) => p.slots[s] && sim >= (p.cd[p.slots[s]!] ?? 0)) ?? "A";
      p.inputs.push({ seq: seq++, mx: 0, my: 0, run: false, k: slot, ax: Math.round(dummy.x), ay: Math.round(dummy.y) });
    }
    now += TICK_MS;
    room.tick(now);
  }
  const dps = (1e9 - dummy.hp) / SECS;
  const atk = finalStats(base, []);
  const hits = (cat: "physical" | "magical") => p.st.hp / computeDamage(atk, p.st, { base: 0, atkRatio: 1, apRatio: 0, cat, el: null } as never, p.el, false);
  rows.push({ job: job.name, line: LINES[job.line].name, dps, phys: hits("physical"), mag: hits("magical"), res: `${p.slots.A} · ${Math.round(LINES[job.line].res === "mana" ? p.mp : p.en)}/${Math.round(LINES[job.line].res === "mana" ? p.st.mana : p.st.energy)}` });
}

const dealers = rows.filter((r) => !["탱커", "서포터"].includes(r.line)).map((r) => r.dps).sort((a, b) => a - b);
const med = (dealers[1] + dealers[2]) / 2;
console.log(`\n밸런스 시뮬레이션 — Lv${LV} ★ 직업, 허수아비(고대 수목 기사 상급 Lv${LV}) ${SECS}초, 고급 무기\n`);
console.log("직업".padEnd(8), "계열".padEnd(8), "DPS".padStart(8), "딜러 중앙값 대비".padStart(10), "물리 버팀(대)".padStart(10), "마법 버팀(대)".padStart(10), "  평타 · 끝난 뒤 자원");
for (const r of rows) {
  const dealer = !["탱커", "서포터"].includes(r.line);
  const ratio = r.dps / med;
  const flag = dealer && Math.abs(ratio - 1) > 0.25 ? (ratio > 1 ? "  ▲ 너무 셈" : "  ▼ 너무 약함") : "";
  console.log(r.job.padEnd(8), r.line.padEnd(8), r.dps.toFixed(0).padStart(8), `${(ratio * 100).toFixed(0)}%`.padStart(12), r.phys.toFixed(1).padStart(12), r.mag.toFixed(1).padStart(12), `  ${r.res}`, flag);
}
db.close();
for (const ext of ["", "-wal", "-shm"]) rmSync(fileURLToPath(new URL(`../data/${process.env.RPG_DB_FILE}${ext}`, import.meta.url)), { force: true });
