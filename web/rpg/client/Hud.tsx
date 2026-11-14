"use client";

import { useEffect, useRef, useState } from "react";
import { DIRS, DIR_KO, TILE, type RoomKind } from "../shared/constants";
import { ROOM_NAME } from "../shared/data/dungeons";
import { MOB_CHOICES, NPCS } from "../shared/data/quests";
import { prop, type GameMap, type TiledObject } from "../shared/map";
import type { ChannelInfo, You } from "../shared/protocol";
import type { HudState } from "./game";
import { t, type StrKey } from "./i18n";
import { PINGS } from "../shared/data/party";

/**
 * 미니맵 · 전체 지도 (2026-11-14 베타 피드백 "점만 찍혀 있어 정보를 얻기 어렵다"):
 * 시설마다 모양 있는 아이콘(천막 · 포털 고리 · 우편함 · 모루 · 게시판 · 분수 · 건물 윤곽 · NPC), 사냥터는 반투명 구역,
 * 퀘스트 목표는 금색 별. 전체 지도(M)는 이름표를 붙이고 마우스를 올리면 설명 창.
 */
type Marker = { x: number; y: number; kind: string; title: string; desc: string; r: number; color: string; obj?: TiledObject };

const MOB_NAME: Record<string, string> = Object.fromEntries(MOB_CHOICES);
const PORTAL_COLOR: Record<string, string> = { dungeon: "#B57BFF", arena: "#E5484D", next: "#F2C94C" };

/** 지도에 그릴 고정 표시 (맵이 바뀔 때만 다시 만듦) */
function staticMarkers(map: GameMap): Marker[] {
  const out: Marker[] = [];
  for (const o of map.objects) {
    const at = { x: o.x, y: o.y - Math.min(o.height, 32) / 2, obj: o };
    switch (o.type) {
      case "npc": {
        const id = String(prop(o, "npc"));
        out.push({ ...at, kind: "npc", title: `${o.name} · ${prop(o, "role") ?? ""}`, desc: t("map.desc.npc", { place: NPCS[id]?.place ?? t("map.desc.talk") }), r: 3, color: "#FFE14D" });
        break;
      }
      case "portal": {
        const to = String(prop(o, "target") ?? "");
        const name = to === "next" ? t("map.desc.next") : ROOM_NAME[to as RoomKind] ?? to;
        out.push({ ...at, kind: "portal", title: o.name, desc: t("map.desc.portal", { to: name }), r: 4, color: PORTAL_COLOR[to] ?? "#4CC764" });
        break;
      }
      case "tent_shop": case "tent_market": case "mailbox": case "anvil": case "board": case "workbench": case "fountain": case "campfire": case "well":
        out.push({ ...at, kind: o.type, title: o.name, desc: t(`map.desc.${o.type}` as StrKey), r: o.type === "fountain" ? 5 : 3, color: ICON_COLOR[o.type] });
        break;
      case "building":
        out.push({ ...at, y: o.y - o.height / 2, kind: "building", title: o.name, desc: t(prop(o, "role") === "storage" ? "map.desc.storage" : "map.desc.smithy"), r: 4, color: "#a36a3c" });
        break;
      case "spawn_zone": {
        const g = String(prop(o, "grade") ?? "normal");
        out.push({ x: o.x, y: o.y - o.height / 2, kind: "zone", title: o.name, desc: t(g === "normal" ? "map.desc.zone" : "map.desc.boss", { mob: MOB_NAME[String(prop(o, "mob"))] ?? String(prop(o, "mob")), lv: String(prop(o, "lv") ?? "").replace("-", "~") }), r: o.width / 2, color: g === "normal" ? "#E5484D" : "#ff8a1f", obj: o });
        break;
      }
    }
  }
  return out;
}
const ICON_COLOR: Record<string, string> = { tent_shop: "#FF9F43", tent_market: "#1FB5A8", mailbox: "#3b6fd6", anvil: "#9AA3AD", board: "#c98d58", workbench: "#6fbf4a", fountain: "#5EC8F0", campfire: "#FF7A2A", well: "#5EC8F0" };

/** 아이콘 하나 (화면 px, 크기 s = 반지름) — 모양으로 구별되게 */
function icon(ctx: CanvasRenderingContext2D, m: Marker, px: number, py: number, s: number) {
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = "#1b1420";
  ctx.fillStyle = m.color;
  const path = (pts: number[][]) => { ctx.beginPath(); pts.forEach(([x, y], i) => (i ? ctx.lineTo(px + x, py + y) : ctx.moveTo(px + x, py + y))); ctx.closePath(); ctx.fill(); ctx.stroke(); };
  switch (m.kind) {
    case "portal":
      ctx.beginPath(); ctx.arc(px, py, s + 1, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      ctx.fillStyle = "#1b1420"; ctx.beginPath(); ctx.arc(px, py, (s + 1) * 0.45, 0, Math.PI * 2); ctx.fill();
      return;
    case "tent_shop": case "tent_market":
      path([[0, -s - 1], [s + 1, s], [-s - 1, s]]);
      return;
    case "mailbox":
      ctx.fillRect(px - s, py - s * 0.7, s * 2, s * 1.4); ctx.strokeRect(px - s, py - s * 0.7, s * 2, s * 1.4);
      ctx.beginPath(); ctx.moveTo(px - s, py - s * 0.7); ctx.lineTo(px, py + 0.5); ctx.lineTo(px + s, py - s * 0.7); ctx.stroke();
      return;
    case "anvil":
      path([[-s - 1, -s * 0.6], [s + 1, -s * 0.6], [s * 0.4, 0], [s * 0.6, s], [-s * 0.6, s], [-s * 0.4, 0]]);
      return;
    case "board": case "workbench": case "building":
      ctx.fillRect(px - s, py - s, s * 2, s * 2); ctx.strokeRect(px - s, py - s, s * 2, s * 2);
      return;
    case "npc":
      ctx.beginPath(); ctx.arc(px, py, s, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      return;
    default:
      ctx.beginPath(); ctx.arc(px, py, s, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  }
}

/** 별 (퀘스트 목표) */
function star(ctx: CanvasRenderingContext2D, px: number, py: number, r: number) {
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    const rr = i % 2 ? r * 0.45 : r;
    ctx[i ? "lineTo" : "moveTo"](px + Math.cos(a) * rr, py + Math.sin(a) * rr);
  }
  ctx.closePath();
  ctx.fillStyle = "#FFE14D";
  ctx.strokeStyle = "#5a4214";
  ctx.lineWidth = 1.5;
  ctx.fill();
  ctx.stroke();
}

function drawMap(ctx: CanvasRenderingContext2D, overview: HTMLCanvasElement, map: GameMap, marks: Marker[], s: HudState, size: number, tiles: number, full: boolean, hover: Marker | null) {
  const scale = size / tiles; // 화면 px / 타일
  const cx = full ? map.w / 2 : s.x / TILE;
  const cy = full ? map.h / 2 : s.y / TILE;
  const ox = cx - tiles / 2;
  const oy = cy - tiles / 2;
  ctx.imageSmoothingEnabled = false;
  ctx.fillStyle = "#1b1420";
  ctx.fillRect(0, 0, size, size);
  ctx.drawImage(overview, ox, oy, tiles, tiles, 0, 0, size, size);
  const at = (x: number, y: number): [number, number] => [(x / TILE - ox) * scale, (y / TILE - oy) * scale];
  const k = full ? 1.4 : Math.max(1, Math.min(1.6, scale / 3)); // 아이콘 크기 배율
  // 사냥터 구역 (반투명) · 건물 윤곽
  for (const m of marks) {
    if (m.kind === "zone") {
      const [px, py] = at(m.x, m.y);
      ctx.globalAlpha = 0.22;
      ctx.fillStyle = m.color;
      ctx.beginPath(); ctx.arc(px, py, (m.r / TILE) * scale, 0, Math.PI * 2); ctx.fill();
      ctx.globalAlpha = 0.7;
      ctx.strokeStyle = m.color;
      ctx.setLineDash([3, 3]); ctx.lineWidth = 1; ctx.stroke(); ctx.setLineDash([]);
      ctx.globalAlpha = 1;
    } else if (m.kind === "building" && m.obj) {
      const o = m.obj;
      const [px, py] = at(o.x - o.width / 2, o.y - o.height);
      ctx.fillStyle = "rgba(163,106,60,0.75)";
      ctx.fillRect(px, py, (o.width / TILE) * scale, (o.height / TILE) * scale);
      ctx.strokeStyle = "#3a2a1e"; ctx.lineWidth = 1;
      ctx.strokeRect(px, py, (o.width / TILE) * scale, (o.height / TILE) * scale);
    }
  }
  for (const m of marks) if (m.kind !== "zone") { const [px, py] = at(m.x, m.y); icon(ctx, m, px, py, m.r * k * (hover === m ? 1.5 : 1)); }
  // 파티원 초록 · 적대 플레이어 빨강 · 몹 빨강(우두머리는 크게) (§23-2)
  for (const o of s.others) {
    const [px, py] = at(o.x, o.y);
    const r = o.mob ? (o.boss ? 3 : 1.5) * k : 2.2 * k;
    ctx.fillStyle = o.mob ? (o.boss ? "#ff8a1f" : "#E5484D") : o.foe ? "#ff3b3b" : o.party ? "#4CC764" : "#8fdcff";
    ctx.strokeStyle = "#1b1420";
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.arc(px, py, r, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  }
  // 정찰자 파티원이 본 몹 (주황)
  for (const o of s.spots) { const [px, py] = at(o.x, o.y); ctx.fillStyle = "#FF9F43"; ctx.fillRect(px - 1.5, py - 1.5, 3, 3); }
  // 핑 (§21-3)
  for (const m of s.marks) {
    const [px, py] = at(m.x, m.y);
    ctx.strokeStyle = PINGS[m.k].color;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(px, py, 5 + (Date.now() % 600) / 120, 0, Math.PI * 2);
    ctx.stroke();
  }
  // 퀘스트 목표: 금색 별 (미니맵 밖이면 가장자리에 붙여서 방향을 알려 줌)
  if (s.goal) {
    let [px, py] = at(s.goal.x, s.goal.y);
    const m = 7;
    px = Math.max(m, Math.min(size - m, px));
    py = Math.max(m, Math.min(size - m, py));
    star(ctx, px, py, (full ? 7 : 5) + Math.sin(Date.now() / 200));
  }
  // 전체 지도: 주요 장소 이름
  if (full) {
    ctx.font = "11px Galmuri11, sans-serif";
    ctx.textAlign = "center";
    ctx.lineWidth = 3;
    ctx.strokeStyle = "rgba(27,20,32,0.85)";
    for (const m of marks) {
      if (!["portal", "zone", "building", "fountain"].includes(m.kind)) continue;
      const [px, py] = at(m.x, m.y);
      const y = m.kind === "zone" ? py : py - m.r * k - 5;
      ctx.fillStyle = m.kind === "zone" ? "#ffd0d0" : "#fff4dc";
      ctx.strokeText(m.title, px, y);
      ctx.fillText(m.title, px, y);
    }
  }
  // 나: 바라보는 쪽으로 삼각형
  const [mx, my] = at(s.x, s.y);
  const a = ((90 - s.dir * 45) * Math.PI) / 180;
  ctx.fillStyle = "#ffffff";
  ctx.strokeStyle = "#1b1420";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(mx + Math.cos(a) * 7, my + Math.sin(a) * 7);
  ctx.lineTo(mx + Math.cos(a + 2.5) * 6, my + Math.sin(a + 2.5) * 6);
  ctx.lineTo(mx + Math.cos(a - 2.5) * 6, my + Math.sin(a - 2.5) * 6);
  ctx.closePath();
  ctx.stroke();
  ctx.fill();
}

const markerCache = new WeakMap<GameMap, Marker[]>();
const markersOf = (map: GameMap) => { let m = markerCache.get(map); if (!m) markerCache.set(map, (m = staticMarkers(map))); return m; };

/** wide = 정찰자 「매의 눈」: 미니맵 시야 +50% */
export function Minimap({ map, overview, hud, size, wide, onOpenFull }: { map: GameMap; overview: HTMLCanvasElement; hud: HudState; size: number; wide: boolean; onOpenFull: () => void }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [tiles, setTiles] = useState(40);
  useEffect(() => {
    const ctx = ref.current?.getContext("2d");
    if (ctx) drawMap(ctx, overview, map, markersOf(map), hud, size, tiles * (wide ? 1.5 : 1), false, null);
  }, [hud, size, tiles, wide, map, overview]);
  return (
    <canvas
      ref={ref}
      width={size}
      height={size}
      className="rpg-pixel block cursor-pointer rounded border-2 border-[#7d4f2b] shadow-[0_3px_0_#3a2a1e]"
      onWheel={(e) => setTiles((v) => Math.max(20, Math.min(80, v + (e.deltaY > 0 ? 10 : -10))))}
      onClick={onOpenFull}
      title={t("hud.full")}
    />
  );
}

export function WorldMap({ map, overview, hud, title, onClose }: { map: GameMap; overview: HTMLCanvasElement; hud: HudState; title: string; onClose: () => void }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const size = Math.max(map.w, map.h) * 6;
  const [hover, setHover] = useState<{ m: Marker; x: number; y: number; w: number; h: number } | null>(null);
  const marks = markersOf(map);
  useEffect(() => {
    const ctx = ref.current?.getContext("2d");
    if (ctx) drawMap(ctx, overview, map, marks, hud, size, Math.max(map.w, map.h), true, hover?.m ?? null);
  }, [hud, map, overview, marks, size, hover]);
  /** 마우스 아래 표시 찾기 (캔버스 css 크기가 실제와 달라도 비율로) — 아이콘 > 사람 · 몹 > 사냥터 구역 순 */
  const pick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const k = size / r.width;
    const tiles = Math.max(map.w, map.h);
    const ox = map.w / 2 - tiles / 2;
    const oy = map.h / 2 - tiles / 2;
    const scale = size / tiles;
    const wx = ((e.clientX - r.left) * k / scale + ox) * TILE;
    const wy = ((e.clientY - r.top) * k / scale + oy) * TILE;
    const near = (x: number, y: number) => Math.hypot(x - wx, y - wy) / TILE * scale; // 화면 px 거리
    const dyn: Marker[] = [
      { x: hud.x, y: hud.y, kind: "you", title: t("map.you"), desc: "", r: 6, color: "#fff" },
      ...(hud.goal ? [{ x: hud.goal.x, y: hud.goal.y, kind: "goal", title: `★ ${t("map.goal")}`, desc: hud.goal.label, r: 7, color: "#FFE14D" }] : []),
      ...hud.others.map((o) => ({ x: o.x, y: o.y, kind: "unit", title: `${o.name} Lv.${o.lv}`, desc: t(o.mob ? "map.mob" : o.foe ? "map.foe" : o.party ? "map.party" : "map.player"), r: 3, color: "" })),
    ];
    let best: Marker | null = null;
    let bd = 10;
    for (const m of [...dyn, ...marks.filter((x) => x.kind !== "zone")]) { const d = near(m.x, m.y); if (d < bd) { bd = d; best = m; } }
    if (!best) for (const m of marks) if (m.kind === "zone" && Math.hypot(m.x - wx, m.y - wy) <= m.r) best = m;
    setHover(best ? { m: best, x: e.clientX - r.left, y: e.clientY - r.top, w: r.width, h: r.height } : null);
  };
  return (
    <div className="rpg-modal-bg" onClick={onClose}>
      <div className="rpg-panel relative p-4" onClick={(e) => e.stopPropagation()}>
        <button className="rpg-x" onClick={onClose} aria-label={t("hud.close")}>✕</button>
        <h2 className="mb-1 text-base font-bold">{t("hud.full")} — {title}</h2>
        <p className="mb-2 text-[11px] text-[#8c6642]">{t("map.hover")}</p>
        <div className="relative">
          <canvas ref={ref} width={size} height={size} className="rpg-pixel block max-h-[calc(100vh_-_160px)] max-w-full" style={{ aspectRatio: "1" }} onMouseMove={pick} onMouseLeave={() => setHover(null)} />
          {hover && (
            <div
              className="rpg-tip !block pointer-events-none !w-auto min-w-[160px] max-w-[260px]"
              style={{ left: hover.x, top: hover.y, bottom: "auto", transform: `translate(${hover.x > hover.w * 0.6 ? "calc(-100% - 12px)" : "12px"}, ${hover.y > hover.h * 0.7 ? "calc(-100% - 8px)" : "8px"})` }}
            >
              <b className="text-[12px] text-[#FFE14D]">{hover.m.title}</b>
              {hover.m.desc && <p className="mt-0.5">{hover.m.desc}</p>}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export function Compass({ dir }: { dir: number }) {
  return <div className="rpg-chip mt-1.5 inline-block">{DIR_KO[dir]} ({DIRS[dir]})</div>;
}

export function ChannelPicker({ room, channels, onPick }: { room: { kind: string; ch: number }; channels: ChannelInfo[]; onPick: (ch: number) => void }) {
  const [open, setOpen] = useState(false);
  const name = t(`hud.${room.kind}` as StrKey);
  return (
    <div className="relative mt-1.5 inline-block pointer-events-auto">
      <button className="rpg-chip" onClick={() => setOpen(!open)}>{t("hud.channel", { room: name, ch: room.ch })} ▾</button>
      {open && (
        <ul className="rpg-chip absolute left-0 top-full z-10 mt-1 min-w-36">
          {channels.map((c) => (
            <li key={c.ch}>
              <button
                className={`block w-full py-0.5 text-left ${c.ch === room.ch ? "text-ruc-400" : ""}`}
                disabled={c.n >= c.cap}
                onClick={() => { setOpen(false); if (c.ch !== room.ch) onPick(c.ch); }}
              >
                {c.ch}채널 <span className="text-white/60">{c.n}/{c.cap}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** 우측 상단: FPS → 핑 → K/D/A → RUC → 알림 → 설정 (§23-2 순서) */
export function TopRight({ fps, ping, you, bell, onSettings }: { fps: number; ping: number; you: You; bell: React.ReactNode; onSettings: () => void }) {
  const pingColor = ping < 60 ? "#4CC764" : ping < 120 ? "#F5C542" : "#E5484D";
  return (
    <div className="pointer-events-auto flex items-center gap-1.5">
      <span className="rpg-chip">FPS {fps}</span>
      <span className="rpg-chip" style={{ color: pingColor }}>{ping}ms</span>
      <span className="rpg-chip">K/D/A {you.kda.join("/")}</span>
      <span className="rpg-chip text-[#F2C94C]" title="베타 지갑 — 마인크래프트 서버 RUC 와 별개입니다">{you.ruc.toLocaleString("ko-KR")} RUC</span>
      {bell}
      <button className="rpg-chip" onClick={onSettings} title="설정 (Esc)" aria-label="설정">⚙</button>
    </div>
  );
}
