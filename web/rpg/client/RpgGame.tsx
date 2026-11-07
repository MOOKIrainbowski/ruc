"use client";

import "./rpg.css";
import { useCallback, useEffect, useRef, useState } from "react";
import type { FullStats } from "../shared/combat";
import type { RoomKind } from "../shared/constants";
import { loadMap, type GameMap, type TiledMap } from "../shared/map";
import type { ChannelInfo, S2C, You } from "../shared/protocol";
import { CombatHud, DeathOverlay } from "./CombatHud";
import CreateCharacter from "./CreateCharacter";
import type { Game, HudState } from "./game";
import { ChannelPicker, Compass, Minimap, TopRight, WorldMap } from "./Hud";
import { t, type StrKey } from "./i18n";
import { Net } from "./net";
import SettingsModal from "./SettingsModal";
import { loadLocal, mergeSettings, saveLocal, type Settings } from "./settings";

type Phase = "loading" | "create" | "play" | "closed";

/** 맵은 들어갈 때 불러옴 (§29 초기 로딩) */
const MAP_JSON: Record<RoomKind, () => Promise<{ default: unknown }>> = {
  plaza: () => import("../shared/data/maps/plaza.json"),
  field: () => import("../shared/data/maps/field.json"),
};
const MAP_NAME: Record<RoomKind, string> = { plaza: "햇살광장 솔라스", field: "햇살 초원" };
const mapCache = new Map<RoomKind, { map: GameMap; overview: HTMLCanvasElement }>();

export default function RpgGame({ dev }: { dev?: string }) {
  const host = useRef<HTMLDivElement>(null);
  const net = useRef<Net | null>(null);
  const game = useRef<Game | null>(null);
  const [phase, setPhase] = useState<Phase>("loading");
  const [msg, setMsg] = useState("");
  const [defaultName, setDefaultName] = useState("");
  const [createErr, setCreateErr] = useState("");
  const [you, setYou] = useState<You | null>(null);
  const [room, setRoom] = useState({ kind: "plaza", ch: 1 });
  const [channels, setChannels] = useState<ChannelInfo[]>([]);
  const [hud, setHud] = useState<HudState | null>(null);
  const [ping, setPing] = useState(0);
  const [settings, setSettings] = useState<Settings>(() => mergeSettings());
  const [world, setWorld] = useState<{ map: GameMap; overview: HTMLCanvasElement } | null>(null);
  const [stats, setStats] = useState<FullStats | null>(null);
  const toastTimer = useRef(0);
  const [popups, setPopups] = useState<("settings" | "map")[]>([]);
  const [capturing, setCapturing] = useState(false);

  // ── 접속 ──
  useEffect(() => {
    let alive = true;
    const n = new Net();
    const toast = (text: string) => {
      setMsg(text);
      clearTimeout(toastTimer.current);
      toastTimer.current = window.setTimeout(() => alive && setMsg(""), 2500);
    };
    net.current = n;
    n.onMessage = async (m: S2C) => {
      if (!alive) return;
      switch (m.t) {
        case "needCreate": setDefaultName(m.defaultName); setPhase("create"); return;
        case "createError": setCreateErr(m.msg); return;
        case "kicked": setMsg(t(`kicked.${m.reason}` as StrKey)); setPhase("closed"); return;
        case "channels": setChannels(m.list); return;
        case "error": toast(m.msg); return;
        case "stats": setStats(m.s); game.current?.onMessage(m); return;
        case "joined": {
          setYou(m.you);
          setRoom(m.room);
          setChannels(m.channels);
          setStats(m.stats);
          const s = mergeSettings(loadLocal(), m.you.settings as Partial<Settings>);
          setSettings(s);
          if (game.current) {
            game.current.destroy();
            game.current = null;
          }
          const { Game, mapOverview } = await import("./game");
          let w = mapCache.get(m.room.kind);
          if (!w) {
            const map = loadMap((await MAP_JSON[m.room.kind]()).default as TiledMap);
            w = { map, overview: mapOverview(map) };
            mapCache.set(m.room.kind, w);
          }
          if (!alive || !host.current) return;
          setWorld(w);
          const g = new Game(w.map, m.room.kind, n, m.you, m.me, s, m.stats);
          g.onToast = toast;
          g.onXp = (_, exp, level) => setYou((y) => y && { ...y, exp, level });
          try {
            await g.start(host.current, m.ents, m.fx);
          } catch {
            setMsg(t("noWebgl"));
            setPhase("closed");
            return;
          }
          if (!alive) return g.destroy();
          game.current = g;
          if (process.env.NODE_ENV === "development") (window as unknown as { __rpg: Game }).__rpg = g; // 디버그 · E2E 용
          setPhase("play");
          return;
        }
        default: game.current?.onMessage(m);
      }
    };
    n.onClose = () => alive && setPhase((p) => { if (p !== "closed") setMsg(t("closed")); return "closed"; });
    n.connect(dev).catch((e: Error) => { if (alive) { setMsg(e.message); setPhase("closed"); } });
    return () => {
      alive = false;
      n.close();
      game.current?.destroy();
      game.current = null;
    };
  }, [dev]);

  // HUD 갱신 (10Hz — FPS · 미니맵 · 나침반)
  useEffect(() => {
    if (phase !== "play") return;
    const id = setInterval(() => {
      if (game.current) setHud(game.current.hud());
      setPing(net.current?.rtt ?? 0);
    }, 100);
    return () => clearInterval(id);
  }, [phase]);

  // 설정 반영 · 저장 (서버는 0.5초 몰아서)
  useEffect(() => {
    game.current?.applySettings(settings);
    if (phase !== "play") return;
    saveLocal(settings);
    const id = setTimeout(() => net.current?.send({ t: "settings", data: settings }), 500);
    return () => clearTimeout(id);
  }, [settings, phase]);

  useEffect(() => {
    if (game.current) game.current.inputBlocked = popups.includes("settings");
  }, [popups]);

  // Esc: 가장 위 팝업부터 닫고, 없으면 설정 열기 (§5 · §24). M: 전체 지도
  const toggle = useCallback((p: "settings" | "map") => setPopups((s) => (s.includes(p) ? s.filter((x) => x !== p) : [...s, p])), []);
  useEffect(() => {
    if (phase !== "play") return;
    const down = (e: KeyboardEvent) => {
      if (capturing || (e.target as HTMLElement)?.closest?.("input, textarea")) return;
      if (e.code === "Escape") {
        e.preventDefault();
        setPopups((s) => (s.length ? s.slice(0, -1) : ["settings"]));
      } else if (e.code === settings.keys.map && !popups.includes("settings")) toggle("map");
    };
    window.addEventListener("keydown", down);
    return () => window.removeEventListener("keydown", down);
  }, [phase, capturing, settings.keys.map, popups, toggle]);

  const top = popups[popups.length - 1];

  return (
    <div className="rpg-root" onContextMenu={(e) => e.preventDefault()}>
      <div ref={host} className="absolute inset-0" />

      {phase === "loading" && <div className="absolute inset-0 flex items-center justify-center text-sm text-white/80">{t("loading")}</div>}

      {phase === "create" && (
        <CreateCharacter
          defaultName={defaultName}
          error={createErr}
          onSubmit={(nickname, appearance, element) => { setCreateErr(""); net.current?.send({ t: "create", nickname, appearance, element }); }}
        />
      )}

      {phase === "closed" && (
        <div className="rpg-modal-bg">
          <div className="rpg-panel max-w-sm p-6 text-center text-[13px]">
            <p>{msg || t("closed")}</p>
            <button className="rpg-btn mt-4" onClick={() => location.reload()}>{t("reconnect")}</button>
          </div>
        </div>
      )}

      {phase === "play" && you && hud && world && stats && (
        <div className="pointer-events-none absolute inset-0" style={{ zoom: settings.interfaceScale / 100 }}>
          <div className="absolute left-3 top-3" style={{ zoom: settings.hudScale / 100 }}>
            <div className="pointer-events-auto">
              <Minimap map={world.map} overview={world.overview} hud={hud} size={settings.minimapSize} onOpenFull={() => toggle("map")} />
            </div>
            <Compass dir={hud.dir} />
            <br />
            <ChannelPicker room={room} channels={channels} onPick={(ch) => net.current?.send({ t: "channel", ch })} />
          </div>
          <div className="absolute right-3 top-3" style={{ zoom: settings.hudScale / 100 }}>
            <TopRight fps={hud.fps} ping={ping} you={you} onSettings={() => toggle("settings")} />
          </div>
          <div style={{ zoom: settings.hudScale / 100 }} className="absolute inset-0">
            <CombatHud hud={hud} stats={stats} you={you} settings={settings} />
          </div>
          {msg && <div className="rpg-chip absolute bottom-[200px] left-1/2 -translate-x-1/2 whitespace-nowrap">{msg}</div>}
          {hud.dead > 0 && <DeathOverlay ms={hud.dead} />}
        </div>
      )}

      {phase === "play" && hud && world && popups.includes("map") && (
        <div style={{ zoom: settings.uiScale / 100 }} className="absolute inset-0">
          <WorldMap map={world.map} overview={world.overview} hud={hud} title={MAP_NAME[hud.kind]} onClose={() => toggle("map")} />
        </div>
      )}
      {phase === "play" && top === "settings" && (
        <SettingsModal s={settings} onChange={setSettings} onClose={() => toggle("settings")} onCapture={setCapturing} />
      )}
    </div>
  );
}
