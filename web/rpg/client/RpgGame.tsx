"use client";

import "./rpg.css";
import { useCallback, useEffect, useRef, useState } from "react";
import type { FullStats } from "../shared/combat";
import type { RoomKind } from "../shared/constants";
import type { Item } from "../shared/data/items";
import { QUESTS, NOTI_KINDS, type Noti } from "../shared/data/quests";
import { loadMap, type GameMap, type TiledMap } from "../shared/map";
import type { ChannelInfo, S2C, You } from "../shared/protocol";
import { CombatHud, DeathOverlay } from "./CombatHud";
import CreateCharacter from "./CreateCharacter";
import { AlchemyWindow, ForgeWindow, MailWindow, MarketWindow, ShopWindow, type EconData } from "./Economy";
import type { Game, HudState, Place } from "./game";
import { JobDialog, SkillWindow } from "./Growth";
import { ChannelPicker, Compass, Minimap, TopRight, WorldMap } from "./Hud";
import { t, type StrKey } from "./i18n";
import { ItemsWindow } from "./Inventory";
import { Net } from "./net";
import { Bell, Dialogue, Journal, QuestPop, Toasts, Tracker, type BoardData, type QStates } from "./Quests";
import SettingsModal from "./SettingsModal";
import { loadLocal, mergeSettings, saveLocal, type Settings } from "./settings";

type Phase = "loading" | "create" | "play" | "closed";
type Popup = "settings" | "map" | "inventory" | "storage" | "journal" | "dialogue" | Place;
/** 열려 있으면 게임 입력을 막는 팝업 */
const BLOCKING: Popup[] = ["settings", "inventory", "storage", "skills", "job", "mail", "shop", "market", "forge", "alchemy", "journal", "dialogue"];
/** 창이 열릴 때 서버에서 받아 올 목록 */
const FETCH: Partial<Record<Place, string>> = { mail: "mail", shop: "shop", market: "market" };

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
  const [items, setItems] = useState<Item[]>([]);
  const [econ, setEcon] = useState<EconData>({});
  const [notice, setNotice] = useState<{ text: string; at: number } | null>(null);
  const toastTimer = useRef(0);
  // 퀘스트 · 알림 (P6)
  const [qs, setQs] = useState<QStates>({ active: [], done: [] });
  const [board, setBoard] = useState<BoardData | null>(null);
  const [notis, setNotis] = useState<Noti[]>([]);
  const [toasts, setToasts] = useState<{ key: number; text: string }[]>([]);
  const [qpop, setQpop] = useState<{ kind: "start" | "done"; title: string; text: string; at: number } | null>(null);
  const [npc, setNpc] = useState("");
  const [journalTab, setJournalTab] = useState<"active" | "done" | "board">("active");
  const marks = useRef<string[]>([]);
  const [popups, setPopups] = useState<Popup[]>([]);
  const toast = useCallback((text: string) => {
    setMsg(text);
    clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setMsg(""), 2500);
  }, []);
  const [capturing, setCapturing] = useState(false);

  // ── 접속 ──
  useEffect(() => {
    let alive = true;
    const n = new Net();
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
        case "ruc":
          if (game.current) game.current.you.ruc = m.ruc;
          setYou((y) => y && { ...y, ruc: m.ruc });
          return;
        case "notice": setNotice({ text: m.text, at: Date.now() }); return;
        case "qs":
          setQs({ active: m.active, done: m.done });
          // 머리 위 ! : 지금 퀘스트가 말을 걸라고 하는 NPC
          marks.current = m.active.flatMap((a) => QUESTS[a.id]?.obj.flatMap((o, i) => (o.type === "talk" && (a.prog[i] ?? 0) < o.n && o.target ? [o.target] : [])) ?? []);
          game.current?.setNpcMarks(marks.current);
          return;
        case "qpop": setQpop({ kind: m.kind, title: m.title, text: m.text, at: Date.now() }); return;
        case "quest": setBoard(m.data); return;
        case "uqp": setBoard((b) => b && { ...b, taken: b.taken.map((r) => (r.id === m.id ? { ...r, prog: m.prog } : r)) }); return;
        case "notis": setNotis(m.list.filter((x) => NOTI_KINDS.includes(x.kind))); return;
        case "noti": {
          setNotis((l) => [m.n, ...l].slice(0, 50));
          if (m.toast) {
            const key = m.n.id;
            setToasts((l) => [...l, { key, text: m.n.text }].slice(-4));
            setTimeout(() => setToasts((l) => l.filter((x) => x.key !== key)), 4000);
          }
          return;
        }
        case "notify": if (m.n) toast(t("ec.mailWaiting", { n: m.n })); return;
        case "econ":
          setEcon((e) => ({ ...e, [m.view]: m.view === "enhanced" || m.view === "recombined" ? { ...(m.data as object), at: Date.now() } : m.data }));
          return;
        case "joined": {
          setYou(m.you);
          setRoom(m.room);
          setChannels(m.channels);
          setStats(m.stats);
          setItems(m.items);
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
          const g = new Game(w.map, m.room.kind, n, m.you, m.me, s, m.stats, m.items);
          g.onToast = toast;
          g.onXp = (_, exp, level) => setYou((y) => y && { ...y, exp, level });
          g.onItems = setItems;
          g.onProg = () => setYou({ ...g.you });
          g.onPlace = (place) => {
            if (place === "board") {
              setJournalTab("board");
              setPopups((s) => [...s.filter((x) => x === "settings" || x === "map"), "journal"]);
              n.send({ t: "quest", op: "board" });
              return;
            }
            // 시설 창은 하나만 (인벤토리 · 창고와도 겹치지 않게)
            setPopups((s) => [...s.filter((x) => x === "settings" || x === "map"), place]);
            const op = FETCH[place];
            if (op) n.send({ t: "econ", op });
          };
          g.onTalk = (id) => {
            setNpc(id);
            setPopups((s) => [...s.filter((x) => x === "settings" || x === "map"), "dialogue"]);
          };
          try {
            await g.start(host.current, m.ents, m.fx, m.drops);
          } catch {
            setMsg(t("noWebgl"));
            setPhase("closed");
            return;
          }
          if (!alive) return g.destroy();
          game.current = g;
          g.setNpcMarks(marks.current);
          n.send({ t: "quest", op: "board" });
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
  }, [dev, toast]);

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
    if (game.current) game.current.inputBlocked = popups.some((p) => BLOCKING.includes(p));
  }, [popups]);

  // 창고는 광장에서만 (§15-3) — 광장을 떠나면 닫음
  useEffect(() => {
    if (room.kind !== "plaza") setPopups((s) => s.filter((p) => p !== "storage"));
  }, [room.kind]);

  // Esc: 가장 위 팝업부터 닫고, 없으면 설정 열기 (§5 · §24). M: 전체 지도 · V: 인벤토리 · B: 창고(광장만)
  const toggle = useCallback((p: Popup) => setPopups((s) => {
    if (s.includes(p)) return s.filter((x) => x !== p);
    const bag = (x: Popup) => x === "inventory" || x === "storage"; // 인벤토리 · 창고는 하나만 (창고 창에 인벤토리가 들어 있음)
    return [...s.filter((x) => !(bag(p) && bag(x))), p];
  }), []);
  useEffect(() => {
    if (phase !== "play") return;
    const down = (e: KeyboardEvent) => {
      if (capturing || (e.target as HTMLElement)?.closest?.("input, textarea")) return;
      if (e.code === "Escape") {
        e.preventDefault();
        setPopups((s) => (s.length ? s.slice(0, -1) : ["settings"]));
      } else if (popups.includes("settings")) return;
      else if (e.code === settings.keys.map) toggle("map");
      else if (e.code === settings.keys.inventory) toggle("inventory");
      else if (e.code === settings.keys.skills) toggle("skills");
      else if (e.code === settings.keys.journal) {
        setJournalTab("active");
        toggle("journal");
        if (!popups.includes("journal")) net.current?.send({ t: "quest", op: "board" });
      }
      else if (e.code === settings.keys.storage) {
        if (room.kind === "plaza" || popups.includes("storage")) toggle("storage");
        else toast(t("inv.storageOnly"));
      }
    };
    window.addEventListener("keydown", down);
    return () => window.removeEventListener("keydown", down);
  }, [phase, capturing, settings.keys.map, settings.keys.inventory, settings.keys.storage, settings.keys.skills, settings.keys.journal, popups, toggle, room.kind, toast]);

  const top = popups[popups.length - 1];
  const send = useCallback((m: Parameters<Net["send"]>[0]) => net.current?.send(m), []);

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
            <TopRight
              fps={hud.fps} ping={ping} you={you} onSettings={() => toggle("settings")}
              bell={<Bell notis={notis} send={send} onRead={(id) => setNotis((l) => l.map((x) => (id === "all" || x.id === id ? { ...x, read: true } : x)))} />}
            />
            <div className="mt-2 flex justify-end"><Tracker states={qs} /></div>
          </div>
          <div style={{ zoom: settings.hudScale / 100 }} className="absolute inset-0">
            <CombatHud hud={hud} stats={stats} you={you} settings={settings} items={items} onSelect={(i) => { if (game.current) game.current.sel = i; }} />
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
      {phase === "play" && you && (top === "inventory" || top === "storage") && (
        <div style={{ zoom: settings.uiScale / 100 }} className="absolute inset-0">
          <ItemsWindow mode={top} items={items} you={you} zoom={settings.uiScale / 100} send={(m) => net.current?.send(m)} toast={toast} onClose={() => toggle(top)} />
        </div>
      )}
      {phase === "play" && you && (top === "skills" || top === "job") && (
        <div style={{ zoom: settings.uiScale / 100 }} className="absolute inset-0">
          {top === "skills" ? (
            <SkillWindow you={you} send={(m) => net.current?.send(m)} onClose={() => toggle("skills")} />
          ) : (
            <JobDialog you={you} send={(m) => net.current?.send(m)} onClose={() => toggle("job")} />
          )}
        </div>
      )}
      {phase === "play" && you && top && ["mail", "shop", "market", "forge", "alchemy"].includes(top) && (
        <div style={{ zoom: settings.uiScale / 100 }} className="absolute inset-0">
          {top === "mail" && <MailWindow you={you} data={econ.mail as never} send={send} onClose={() => toggle("mail")} />}
          {top === "shop" && <ShopWindow you={you} data={econ.shop as never} send={send} onClose={() => toggle("shop")} />}
          {top === "market" && <MarketWindow you={you} items={items} data={econ.market as never} send={send} onClose={() => toggle("market")} />}
          {top === "forge" && <ForgeWindow you={you} items={items} last={econ.enhanced} send={send} onClose={() => toggle("forge")} />}
          {top === "alchemy" && <AlchemyWindow items={items} last={econ.recombined} send={send} onClose={() => toggle("alchemy")} />}
        </div>
      )}
      {phase === "play" && you && top === "dialogue" && (
        <div style={{ zoom: settings.uiScale / 100 }} className="absolute inset-0">
          <Dialogue
            npc={npc}
            states={qs}
            onClose={() => toggle("dialogue")}
            onPlace={(place) => { setPopups((s) => s.filter((x) => x !== "dialogue")); game.current?.onPlace(place); }}
          />
        </div>
      )}
      {phase === "play" && you && top === "journal" && (
        <div style={{ zoom: settings.uiScale / 100 }} className="absolute inset-0">
          <Journal tab={journalTab} states={qs} board={board} items={items} you={you} send={send} onClose={() => toggle("journal")} />
        </div>
      )}
      {phase === "play" && toasts.length > 0 && <div style={{ zoom: settings.uiScale / 100 }}><Toasts list={toasts} /></div>}
      {phase === "play" && qpop && Date.now() - qpop.at < 4500 && <QuestPop pop={qpop} />}
      {notice && Date.now() - notice.at < 6500 && (
        <div key={notice.at} className="rpg-notice pointer-events-none absolute left-1/2 top-16 -translate-x-1/2 whitespace-nowrap text-[13px]">{notice.text}</div>
      )}
      {phase === "play" && top === "settings" && (
        <SettingsModal s={settings} onChange={setSettings} onClose={() => toggle("settings")} onCapture={setCapturing} />
      )}
    </div>
  );
}
