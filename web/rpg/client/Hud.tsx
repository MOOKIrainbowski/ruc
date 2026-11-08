"use client";

import { useEffect, useRef, useState } from "react";
import { DIRS, DIR_KO, TILE } from "../shared/constants";
import type { GameMap } from "../shared/map";
import type { ChannelInfo, You } from "../shared/protocol";
import type { HudState } from "./game";
import { t, type StrKey } from "./i18n";
import { PINGS } from "../shared/data/party";

/** 미니맵 점 색 (§23-2) */
const OBJ_DOT: Record<string, string> = { npc: "#FFE14D", tent_shop: "#FF9F43", tent_market: "#1FB5A8", portal: "#B57BFF", mailbox: "#3b6fd6" };

function drawMap(ctx: CanvasRenderingContext2D, overview: HTMLCanvasElement, map: GameMap, s: HudState, size: number, tiles: number, full: boolean) {
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
  const dot = (x: number, y: number, r: number, c: string) => {
    const [px, py] = at(x, y);
    ctx.fillStyle = "#1b1420";
    ctx.fillRect(Math.round(px - r - 1), Math.round(py - r - 1), r * 2 + 2, r * 2 + 2);
    ctx.fillStyle = c;
    ctx.fillRect(Math.round(px - r), Math.round(py - r), r * 2, r * 2);
  };
  for (const o of map.objects) if (OBJ_DOT[o.type]) dot(o.x, o.y - 4, o.type === "portal" ? 3 : 2, OBJ_DOT[o.type]);
  // 파티원 초록 · 적대 플레이어 빨강 (§23-2)
  for (const o of s.others) dot(o.x, o.y, o.mob ? 1 : 2, o.mob ? "#E5484D" : o.foe ? "#ff3b3b" : o.party ? "#4CC764" : "#8fdcff");
  // 정찰자 파티원이 본 몹 (주황)
  for (const o of s.spots) dot(o.x, o.y, 1, "#FF9F43");
  // 핑 (§21-3)
  for (const m of s.marks) {
    const [px, py] = at(m.x, m.y);
    ctx.strokeStyle = PINGS[m.k].color;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(px, py, 5 + (Date.now() % 600) / 120, 0, Math.PI * 2);
    ctx.stroke();
  }
  // 나: 바라보는 쪽으로 삼각형
  const [mx, my] = at(s.x, s.y);
  const a = ((90 - s.dir * 45) * Math.PI) / 180;
  ctx.fillStyle = "#ffffff";
  ctx.strokeStyle = "#1b1420";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(mx + Math.cos(a) * 6, my + Math.sin(a) * 6);
  ctx.lineTo(mx + Math.cos(a + 2.5) * 5, my + Math.sin(a + 2.5) * 5);
  ctx.lineTo(mx + Math.cos(a - 2.5) * 5, my + Math.sin(a - 2.5) * 5);
  ctx.closePath();
  ctx.stroke();
  ctx.fill();
}

/** wide = 정찰자 「매의 눈」: 미니맵 시야 +50% */
export function Minimap({ map, overview, hud, size, wide, onOpenFull }: { map: GameMap; overview: HTMLCanvasElement; hud: HudState; size: number; wide: boolean; onOpenFull: () => void }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [tiles, setTiles] = useState(40);
  useEffect(() => {
    const ctx = ref.current?.getContext("2d");
    if (ctx) drawMap(ctx, overview, map, hud, size, tiles * (wide ? 1.5 : 1), false);
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
  useEffect(() => {
    const ctx = ref.current?.getContext("2d");
    if (ctx) drawMap(ctx, overview, map, hud, size, map.w, true);
  }, [hud, map, overview]);
  return (
    <div className="rpg-modal-bg" onClick={onClose}>
      <div className="rpg-panel relative p-4" onClick={(e) => e.stopPropagation()}>
        <button className="rpg-x" onClick={onClose} aria-label={t("hud.close")}>✕</button>
        <h2 className="mb-2 text-base font-bold">{t("hud.full")} — {title}</h2>
        <canvas ref={ref} width={size} height={size} className="rpg-pixel block" />
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
