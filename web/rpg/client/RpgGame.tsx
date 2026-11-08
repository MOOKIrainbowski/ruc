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
import { AskPrompt, Banner, DungeonHud, GhostOverlay, PartyFrames, PartyWindow, PingWheel, Scoreboard, type Ask, type Who } from "./Party";
import { ROOM_NAME, type DungeonState } from "../shared/data/dungeons";
import type { PartyAd, PartyVitals, PartyView } from "../shared/data/party";
import { BugWindow, ChatBox, DebugOverlay, GmWindow, captureConsole, logLine, type ChatLine, type GmData } from "./Ops";
import { CHAT } from "../shared/data/chat";
import { bgm, setVolume, sfx, unlock } from "./sound";
import SettingsModal from "./SettingsModal";
import { loadLocal, mergeSettings, saveLocal, type Settings } from "./settings";

type Phase = "loading" | "create" | "play" | "closed";
type Popup = "settings" | "map" | "inventory" | "storage" | "journal" | "dialogue" | "party" | "gm" | "bug" | Place;
/** 열려 있으면 게임 입력을 막는 팝업 */
const BLOCKING: Popup[] = ["settings", "inventory", "storage", "skills", "job", "mail", "shop", "market", "forge", "alchemy", "journal", "dialogue", "party", "gm", "bug"];
/** 창이 열릴 때 서버에서 받아 올 목록 */
const FETCH: Partial<Record<Place, string>> = { mail: "mail", shop: "shop", market: "market" };

/** 맵은 들어갈 때 불러옴 (§29 초기 로딩) */
const MAP_JSON: Record<RoomKind, () => Promise<{ default: unknown }>> = {
  plaza: () => import("../shared/data/maps/plaza.json"),
  field: () => import("../shared/data/maps/field.json"),
  arena: () => import("../shared/data/maps/arena.json"),
  dungeon: () => import("../shared/data/maps/dungeon.json"),
};
const MAP_NAME = ROOM_NAME;
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
  // 레벨업 연출 (메이플풍): 레벨이 오르면 2.6초 동안 금빛 광선 + "LEVEL UP!"
  const lastLv = useRef(0);
  const [levelUp, setLevelUp] = useState(0);
  const [popups, setPopups] = useState<Popup[]>([]);
  // 파티 · 던전 · 결투 (P7)
  const [party, setParty] = useState<PartyView | null>(null);
  const [pv, setPv] = useState<PartyVitals[]>([]);
  const [ads, setAds] = useState<PartyAd[]>([]);
  const [who, setWho] = useState<Who>([]);
  const [ask, setAsk] = useState<Ask | null>(null);
  const [titles, setTitles] = useState<{ list: string[]; on: string | null }>({ list: [], on: null });
  const [dg, setDg] = useState<{ s: DungeonState; at: number } | null>(null);
  const [banner, setBanner] = useState<{ text: string; at: number; ms: number } | null>(null);
  const [boardOpen, setBoardOpen] = useState(false);
  const deadAt = useRef(0);
  // 채팅 · GM 창 · F3 (P8)
  const [chat, setChat] = useState<ChatLine[]>([]);
  const [chatOpen, setChatOpen] = useState(false);
  const [chatParty, setChatParty] = useState(false);
  const [gm, setGm] = useState<GmData>({});
  const [debug, setDebug] = useState(false);
  const chatKey = useRef(0);
  const addChat = useCallback((l: Omit<ChatLine, "key" | "at"> & { at?: number }) => setChat((c) => [...c, { at: Date.now(), ...l, key: ++chatKey.current }].slice(-CHAT.keep)), []);
  /** 파티원 엔티티 id · 파티 여부 — 맵을 옮겨 새로 만든 Game 에도 바로 넣음 */
  const social = useRef<{ ids: number[]; inParty: boolean }>({ ids: [], inParty: false });
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
        case "error": toast(m.msg); logLine(`[안내] ${m.msg}`); return;
        case "chat": addChat({ ch: m.ch, from: m.from, text: m.text, at: m.at }); return;
        case "gm": setGm((g) => ({ ...g, ...m })); return;
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
        case "qpop": setQpop({ kind: m.kind, title: m.title, text: m.text, at: Date.now() }); if (m.kind === "done") sfx("quest"); return;
        case "quest": setBoard(m.data); return;
        case "uqp": setBoard((b) => b && { ...b, taken: b.taken.map((r) => (r.id === m.id ? { ...r, prog: m.prog } : r)) }); return;
        case "notis": setNotis(m.list.filter((x) => NOTI_KINDS.includes(x.kind))); return;
        case "noti": {
          setNotis((l) => [m.n, ...l].slice(0, 50));
          if (m.toast) {
            const key = m.n.id;
            setToasts((l) => [...l, { key, text: m.n.text }].slice(-4));
            sfx("ui");
            setTimeout(() => setToasts((l) => l.filter((x) => x.key !== key)), 4000);
          }
          return;
        }
        case "notify": if (m.n) toast(t("ec.mailWaiting", { n: m.n })); return;
        case "party": setParty(m.party); return;
        case "pv": setPv(m.v); return;
        case "ads": setAds(m.list); return;
        case "who": setWho(m.list); return;
        case "ask": setAsk(m); return;
        case "kda": setYou((y) => y && { ...y, kda: m.kda }); if (game.current) game.current.you.kda = m.kda; return;
        case "titles": setTitles({ list: m.list, on: m.on }); return;
        case "dg": setDg(m.s ? { s: m.s, at: Date.now() } : null); if (game.current) game.current.bossId = m.s?.boss?.id ?? 0; return;
        case "mark": game.current?.addPing(m.k, m.x, m.y, m.from); return;
        case "econ":
          if (m.view === "enhanced") { const r = (m.data as { result: string }).result; sfx(r === "ok" ? "ok" : r === "boom" ? "boom" : "fail"); }
          setEcon((e) => ({ ...e, [m.view]: m.view === "enhanced" || m.view === "recombined" ? { ...(m.data as object), at: Date.now() } : m.data }));
          return;
        case "joined": {
          setAsk(null); // 방을 옮기면 지난 확인 창(입장 · 결투)은 의미가 없음
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
            sfx("portal");
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
          g.onChat = (ch, text) => addChat({ ch, from: "", text });
          g.debug = debugRef.current;
          g.onBanner = (text, ms) => setBanner({ text, at: Date.now(), ms });
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
          g.setParty(social.current.ids, social.current.inParty);
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

  useEffect(() => {
    if (!you) return;
    if (lastLv.current && you.level > lastLv.current) {
      setLevelUp(Date.now());
      const id = setTimeout(() => setLevelUp(0), 2600);
      lastLv.current = you.level;
      return () => clearTimeout(id);
    }
    lastLv.current = you.level;
  }, [you?.level]); // eslint-disable-line react-hooks/exhaustive-deps

  // HUD 갱신 (10Hz — FPS · 미니맵 · 나침반)
  useEffect(() => {
    if (phase !== "play") return;
    const id = setInterval(() => {
      if (game.current) setHud(game.current.hud());
      setPing(net.current?.rtt ?? 0);
    }, 100);
    return () => clearInterval(id);
  }, [phase]);

  // 소리 (P8): 볼륨 · 첫 입력 때 켜기 · 맵(보스)별 배경음 · 콘솔 오류를 버그 제보 로그로
  useEffect(() => setVolume(settings.volMaster, settings.volBgm, settings.volSfx), [settings.volMaster, settings.volBgm, settings.volSfx]);
  useEffect(() => {
    captureConsole();
    const on = () => unlock();
    window.addEventListener("pointerdown", on);
    window.addEventListener("keydown", on);
    return () => { window.removeEventListener("pointerdown", on); window.removeEventListener("keydown", on); bgm(null); };
  }, []);
  useEffect(() => { bgm(phase === "play" ? (dg?.s.boss ? "boss" : room.kind) : null); }, [phase, room.kind, dg?.s.boss]);
  const debugRef = useRef(false);
  useEffect(() => { debugRef.current = debug; if (game.current) game.current.debug = debug; }, [debug]);

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

  // 파티원 엔티티 (이름표 초록 · 미니맵 · 결투장 적 판정)
  useEffect(() => {
    social.current = { ids: party ? party.members.filter((m) => m.eid && m.eid !== you?.id).map((m) => m.eid) : [], inParty: !!party };
    game.current?.setParty(social.current.ids, social.current.inParty);
  }, [party, you?.id, phase, room]);
  useEffect(() => {
    if (hud?.ghost && !deadAt.current) deadAt.current = Date.now();
    if (!hud?.ghost) deadAt.current = 0;
  }, [hud?.ghost]);

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
      if (e.code === settings.keys.debug) { e.preventDefault(); setDebug((d) => !d); return; }
      if (e.code === settings.keys.chat && !popups.some((p) => BLOCKING.includes(p))) { e.preventDefault(); setChatOpen(true); return; }
      if (e.code === settings.keys.gm && you?.gm) { e.preventDefault(); toggle("gm"); net.current?.send({ t: "gm" }); return; }
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
      else if (e.code === settings.keys.party) {
        toggle("party");
        if (!popups.includes("party")) net.current?.send({ t: "who" });
      }
      else if (e.code === settings.keys.board && !e.repeat) {
        setBoardOpen(true);
        net.current?.send({ t: "who" });
      }
      else if (e.code === settings.keys.storage) {
        if (room.kind === "plaza" || popups.includes("storage")) toggle("storage");
        else toast(t("inv.storageOnly"));
      }
    };
    const up = (e: KeyboardEvent) => { if (e.code === settings.keys.board) setBoardOpen(false); };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => { window.removeEventListener("keydown", down); window.removeEventListener("keyup", up); };
  }, [phase, capturing, settings.keys, popups, toggle, room.kind, toast, you?.gm]);

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
          <div className="absolute left-3 top-3">
            <div className="pointer-events-auto">
              <Minimap map={world.map} overview={world.overview} hud={hud} size={settings.minimapSize} wide={you.prog.job === "scout"} onOpenFull={() => toggle("map")} />
            </div>
            <div style={{ zoom: settings.hudScale / 100 }}>
              <Compass dir={hud.dir} />
              <br />
              {room.kind !== "dungeon" && <ChannelPicker room={room} channels={channels} onPick={(ch) => net.current?.send({ t: "channel", ch })} />}
              <PartyFrames party={party} pv={pv} you={you} here={room} />
            </div>
          </div>
          {dg && room.kind === "dungeon" && <DungeonHud dg={dg.s} hud={hud} at={dg.at} send={send} />}
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
          <ChatBox lines={chat} open={chatOpen} party={chatParty} onSend={(text) => send({ t: "chat", text })} onClose={() => setChatOpen(false)} onToggleParty={() => setChatParty((v) => !v)} />
          {hud.dbg && <DebugOverlay d={hud.dbg} fps={hud.fps} />}
          {hud.dead > 0 && !hud.ghost && <DeathOverlay ms={hud.dead} arena={hud.deadKind === "arena"} />}
          {hud.ghost && <GhostOverlay dg={dg?.s ?? null} since={deadAt.current || Date.now()} send={send} />}
          {ask?.kind === "duel" && <AskPrompt ask={ask} send={send} onClose={() => setAsk(null)} />}
          {boardOpen && <Scoreboard list={who} room={room.kind === "dungeon" ? MAP_NAME.dungeon : t("hud.channel", { room: MAP_NAME[room.kind as RoomKind], ch: room.ch })} />}
        </div>
      )}
      {phase === "play" && hud?.wheel && <PingWheel wheel={hud.wheel} />}
      {phase === "play" && banner && Date.now() - banner.at < banner.ms && <Banner key={banner.at} text={banner.text} />}
      {phase === "play" && ask?.kind === "dungeon" && (
        <div style={{ zoom: settings.uiScale / 100 }} className="absolute inset-0">
          <AskPrompt ask={ask} send={send} onClose={() => setAsk(null)} />
        </div>
      )}
      {phase === "play" && top === "gm" && (
        <div style={{ zoom: settings.uiScale / 100 }} className="absolute inset-0">
          <GmWindow data={gm} send={send} onClose={() => toggle("gm")} />
        </div>
      )}
      {phase === "play" && top === "bug" && (
        <div style={{ zoom: settings.uiScale / 100 }} className="absolute inset-0">
          <BugWindow shot={() => game.current?.screenshot() ?? Promise.resolve(null)} send={send} onClose={() => toggle("bug")} />
        </div>
      )}
      {phase === "play" && you && top === "party" && (
        <div style={{ zoom: settings.uiScale / 100 }} className="absolute inset-0">
          <PartyWindow you={you} party={party} ads={ads} who={who} titles={titles} send={send} onClose={() => toggle("party")} />
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
      {phase === "play" && levelUp > 0 && (
        <div key={levelUp} className="rpg-levelup pointer-events-none absolute left-1/2 top-[34%] -translate-x-1/2 -translate-y-1/2">
          <div className="rpg-levelup-rays" />
          <div className="rpg-levelup-text">LEVEL UP!</div>
          <div className="rpg-levelup-sub">Lv.{you?.level}</div>
        </div>
      )}
      {notice && Date.now() - notice.at < 6500 && (
        <div key={notice.at} className="rpg-notice pointer-events-none absolute left-1/2 top-16 -translate-x-1/2 whitespace-nowrap text-[13px]">{notice.text}</div>
      )}
      {phase === "play" && top === "settings" && (
        <SettingsModal s={settings} onChange={setSettings} onClose={() => toggle("settings")} onCapture={setCapturing} onBug={() => setPopups((s) => [...s.filter((x) => x !== "settings"), "bug"])} />
      )}
    </div>
  );
}
