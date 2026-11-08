"use client";

import { useEffect, useState } from "react";
import { ENCH_POWER, ENCH_SLOTS, ENHANCE, ENHANCE_MAX, MARKET, disassembleRuc, enchantCost, enhanceCost, repairCost, type Price, type ShopSlot, BREW } from "../shared/data/economy";
import { ENCHANTS, ITEMS, RARITIES, RARITY, type Ench, type Item, type ItemPos, type Rarity, type StoredItem } from "../shared/data/items";
import type { C2S, You } from "../shared/protocol";
import { ItemImg, nameColor } from "./Inventory";
import { t, type StrKey } from "./i18n";

/**
 * 경제 창 (P5): 우편함 · 일반 상점 · 유저 상점 · 대장간(강화 · 마법부여 · 수리) · 연금술 작업대(재조합).
 * 조작은 서버로 보내고(요청 id 를 붙여 두 번 눌러도 한 번만), 서버가 돌려준 목록만 그립니다.
 */

export type EconData = { mail?: MailView[]; shop?: ShopView; market?: MarketView; enhanced?: { result: string; at: number }; recombined?: { tpl: string; rarity: Rarity; at: number } };
type MailView = { id: number; sender: string; subject: string; body: string; ruc: number; reason: string; expires: number; items: StoredItem[] };
type ShopView = { cycle: number; ends: number; slots: (ShopSlot & { left: number })[] };
type Listing = { id: number; seller: string; mine: boolean; item: StoredItem; prices: Price[]; expires: number };
type MarketView = { list: Listing[]; mine: Listing[] };
type Send = (m: C2S) => void;

const rid = () => crypto.randomUUID();
const pos = (i: Item): ItemPos => [i.loc, i.slot];
const won = (n: number) => n.toLocaleString("ko-KR");

/** 남은 기간: N일 N시간 / N시간 N분 / N분 (마크 우편함과 같은 꼴) */
function remain(ms: number) {
  const m = Math.max(0, Math.floor(ms / 60_000));
  const d = Math.floor(m / 1440);
  const h = Math.floor((m % 1440) / 60);
  return d ? t("ec.days", { d, h }) : h ? t("ec.hours", { h, m: m % 60 }) : t("ec.minutes", { m });
}

const enchText = (e: Ench) => `${ENCHANTS[e.k]?.name ?? e.k}${e.el ? `(${e.el})` : ""} +${e.v < 1 ? `${Math.round(e.v * 1000) / 10}%` : e.v}`;

/** 아이템 한 칸 + 이름 (희귀도 색 · 강화 · +10 이름) */
function ItemCell({ it, onClick, on, small }: { it: StoredItem; onClick?: () => void; on?: boolean; small?: boolean }) {
  const tp = ITEMS[it.tpl];
  return (
    <button type="button" className="flex items-center gap-1.5 rounded px-1 py-0.5 text-left hover:bg-[#e8d3a9]" style={{ outline: on ? "2px solid #3b6fd6" : undefined }} onClick={onClick} disabled={!onClick}>
      <span className="rpg-islot !h-[36px] !w-[36px] shrink-0" style={{ boxShadow: `inset 0 0 0 2px ${RARITY[it.rarity].color}` }}>
        <ItemImg it={it as Item} />
      </span>
      {!small && (
        <span className="min-w-0">
          <b className="block truncate" style={{ color: nameColor(it.rarity) }}>{it.name ?? tp?.name}{it.enh && !it.name ? ` +${it.enh}` : ""}</b>
          <span className="block truncate text-[10px] text-[#8c6642]">
            {RARITY[it.rarity].name}{[...(it.opt ?? []), ...(it.ench ?? [])].map((e) => ` · ${enchText(e)}`).join("")}
          </span>
        </span>
      )}
    </button>
  );
}

function Window({ title, onClose, children, wide }: { title: string; onClose: () => void; children: React.ReactNode; wide?: boolean }) {
  return (
    <div className="rpg-modal-bg">
      <div className={`rpg-panel relative ${wide ? "w-[760px]" : "w-[600px]"} max-w-[96vw] p-4 text-[12px]`}>
        <button className="rpg-x" onClick={onClose} aria-label={t("hud.close")}>✕</button>
        <h2 className="mb-2 text-base font-bold">{title}</h2>
        {children}
      </div>
    </div>
  );
}

const Ruc = ({ you }: { you: You }) => <span className="rounded bg-[#3a2a1e] px-2 py-0.5 text-[11px] text-[#F2C94C]">{won(you.ruc)} RUC</span>;

// ── 우편함 (§15-5) ───────────────────────────────────────────────

export function MailWindow({ you, data, send, onClose }: { you: You; data?: MailView[]; send: Send; onClose: () => void }) {
  return (
    <Window title={t("ec.mail")} onClose={onClose}>
      <div className="mb-2 flex items-center justify-between">
        <span className="text-[#8c6642]">{t("ec.mailLead")}</span>
        <Ruc you={you} />
      </div>
      <div className="max-h-[52vh] space-y-1.5 overflow-y-auto pr-1">
        {!data && <p>…</p>}
        {data?.length === 0 && <p className="py-6 text-center text-[#8c6642]">{t("ec.mailEmpty")}</p>}
        {data?.map((m) => (
          <div key={m.id} className="flex items-center gap-2 rounded bg-[#e8d3a9] px-2 py-1.5">
            <div className="min-w-0 flex-1">
              <b>{m.subject}</b>
              <div className="text-[10px] text-[#8c6642]">
                {t("ec.sender", { s: m.sender })} · {t(`ec.reason.${m.reason}` as StrKey)} · {t("ec.remain", { r: remain(m.expires - Date.now()) })}
              </div>
              {m.body && <p className="text-[11px]">{m.body}</p>}
              <div className="mt-0.5 flex flex-wrap items-center gap-1">
                {m.ruc > 0 && <span className="font-bold text-[#b88a1a]">{won(m.ruc)} RUC</span>}
                {m.items.map((i) => <ItemCell key={i.id} it={i} small />)}
              </div>
            </div>
            <button className="rpg-btn !px-3 !py-1" onClick={() => send({ t: "econ", op: "claim", id: m.id })}>{t("ec.claim")}</button>
          </div>
        ))}
      </div>
      <div className="mt-3 flex justify-end">
        <button className="rpg-btn" disabled={!data?.length} onClick={() => send({ t: "econ", op: "claimAll" })}>{t("ec.claimAll")}</button>
      </div>
    </Window>
  );
}

// ── 일반 상점 (§17-2) ────────────────────────────────────────────

export function ShopWindow({ you, data, send, onClose }: { you: You; data?: ShopView; send: Send; onClose: () => void }) {
  const [, tick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => tick((x) => x + 1), 1000);
    return () => clearInterval(id);
  }, []);
  return (
    <Window title={t("ec.shop")} onClose={onClose} wide>
      <div className="mb-2 flex items-center justify-between">
        <span className="text-[#8c6642]">{data && t("ec.shopRefresh", { r: remain(data.ends - Date.now()) })} · {t("ec.shopLead")}</span>
        <Ruc you={you} />
      </div>
      <div className="grid grid-cols-4 gap-2">
        {data?.slots.map((s, i) => (
          <div key={i} className="rounded bg-[#e8d3a9] p-2" style={{ opacity: s.left ? 1 : 0.5 }}>
            <ItemCell it={{ id: String(i), tpl: s.tpl, loc: "inventory", slot: 0, qty: 1, rarity: s.rarity, enh: 0, sp: [], dur: 0, durMax: 0 }} />
            <p className="mt-1 text-[10px] text-[#8c6642]">{ITEMS[s.tpl].desc}</p>
            <div className="mt-1 flex items-center justify-between">
              <b className="text-[#b88a1a]">{won(s.price)} RUC</b>
              <span className="text-[10px]">{t("ec.left", { n: s.left })}</span>
            </div>
            <button className="rpg-btn mt-1 w-full !py-0.5" disabled={!s.left || you.ruc < s.price} onClick={() => send({ t: "econ", op: "buy", cycle: data.cycle, id: i, n: 1, rid: rid() })}>
              {t("ec.buy")}
            </button>
          </div>
        ))}
      </div>
    </Window>
  );
}

// ── 유저 상점 (§17-3) ────────────────────────────────────────────

const priceText = (p: Price) =>
  [p.ruc ? `${won(p.ruc)} RUC` : "", ...(p.items ?? []).map((x) => `${ITEMS[x.tpl]?.name} ×${x.qty}${x.minRarity && x.minRarity !== "poor" ? `(${RARITY[x.minRarity].name}↑)` : ""}`)]
    .filter(Boolean).join(" + ");

export function MarketWindow({ you, items, data, send, onClose }: { you: You; items: Item[]; data?: MarketView; send: Send; onClose: () => void }) {
  const [tab, setTab] = useState<"browse" | "sell" | "mine">("browse");
  const [kind, setKind] = useState("");
  const [rar, setRar] = useState("");
  const [sort, setSort] = useState<"new" | "low" | "high">("new");
  const [pick, setPick] = useState<Item | null>(null);
  const [opts, setOpts] = useState<{ ruc: string; tpl: string; qty: string; min: string }[]>([{ ruc: "", tpl: "", qty: "1", min: "" }]);
  const firstRuc = (l: Listing) => l.prices.find((p) => p.ruc)?.ruc ?? Infinity;
  const list = (data?.list ?? [])
    .filter((l) => (!kind || ITEMS[l.item.tpl].kind === kind) && (!rar || l.item.rarity === rar))
    .sort((a, b) => (sort === "new" ? b.id - a.id : sort === "low" ? firstRuc(a) - firstRuc(b) : firstRuc(b) - firstRuc(a)));
  const prices: Price[] = opts.map((o) => ({
    ...(Number(o.ruc) > 0 ? { ruc: Math.floor(Number(o.ruc)) } : {}),
    ...(o.tpl ? { items: [{ tpl: o.tpl, qty: Math.max(1, Math.floor(Number(o.qty) || 1)), ...(o.min ? { minRarity: o.min as Rarity } : {}) }] } : {}),
  }));
  const sellable = items.filter((i) => i.loc === "inventory" || i.loc === "hotbar");
  const setOpt = (i: number, k: keyof (typeof opts)[number], v: string) => setOpts(opts.map((o, j) => (j === i ? { ...o, [k]: v } : o)));
  return (
    <Window title={t("ec.market")} onClose={onClose} wide>
      <div className="mb-2 flex items-center justify-between">
        <div className="flex gap-1">
          {(["browse", "sell", "mine"] as const).map((x) => <button key={x} className="rpg-btn !px-2 !py-0.5 !text-[11px]" data-on={tab === x} onClick={() => setTab(x)}>{t(`ec.tab.${x}` as StrKey)}</button>)}
        </div>
        <Ruc you={you} />
      </div>
      {tab === "browse" && (
        <>
          <div className="mb-1.5 flex gap-1 text-[11px]">
            <select className="rpg-input !py-0.5" value={kind} onChange={(e) => setKind(e.target.value)}>
              <option value="">{t("ec.allKinds")}</option>
              {["weapon", "armor", "accessory", "potion", "material", "book"].map((k) => <option key={k} value={k}>{t(`inv.kind.${k}` as StrKey)}</option>)}
            </select>
            <select className="rpg-input !py-0.5" value={rar} onChange={(e) => setRar(e.target.value)}>
              <option value="">{t("ec.allRarity")}</option>
              {RARITIES.map((r) => <option key={r} value={r}>{RARITY[r].name}</option>)}
            </select>
            <select className="rpg-input !py-0.5" value={sort} onChange={(e) => setSort(e.target.value as typeof sort)}>
              <option value="new">{t("ec.sortNew")}</option>
              <option value="low">{t("ec.sortLow")}</option>
              <option value="high">{t("ec.sortHigh")}</option>
            </select>
          </div>
          <div className="max-h-[48vh] space-y-1 overflow-y-auto pr-1">
            {!list.length && <p className="py-6 text-center text-[#8c6642]">{t("ec.marketEmpty")}</p>}
            {list.map((l) => (
              <div key={l.id} className="flex items-center gap-2 rounded bg-[#e8d3a9] px-2 py-1">
                <div className="w-[230px] shrink-0"><ItemCell it={l.item} /></div>
                <div className="min-w-0 flex-1 text-[10px] text-[#8c6642]">{t("ec.seller", { s: l.seller })} · {t("ec.remain", { r: remain(l.expires - Date.now()) })}</div>
                <div className="flex flex-col items-end gap-0.5">
                  {l.prices.map((p, i) => (
                    <button key={i} className="rpg-btn !px-2 !py-0.5 !text-[10px]" disabled={l.mine} onClick={() => send({ t: "econ", op: "mbuy", id: l.id, opt: i, rid: rid() })}>
                      {priceText(p)} {t("ec.buy")}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </>
      )}
      {tab === "sell" && (
        <div className="flex gap-3">
          <div className="max-h-[50vh] w-[260px] overflow-y-auto">
            {sellable.map((i) => <ItemCell key={i.id} it={i} on={pick?.id === i.id} onClick={() => setPick(i)} />)}
          </div>
          <div className="flex-1">
            <p className="text-[#8c6642]">{t("ec.sellLead", { d: MARKET.days, n: MARKET.max })}</p>
            {opts.map((o, i) => (
              <div key={i} className="mt-1.5 rounded bg-[#e8d3a9] p-1.5">
                <b className="text-[11px]">{t("ec.option", { n: i + 1 })}</b>
                <div className="mt-0.5 flex flex-wrap items-center gap-1">
                  <input className="rpg-input w-[90px] !py-0.5" inputMode="numeric" placeholder="RUC" value={o.ruc} onChange={(e) => setOpt(i, "ruc", e.target.value.replace(/\D/g, ""))} />
                  <span>+</span>
                  <select className="rpg-input w-[140px] !py-0.5" value={o.tpl} onChange={(e) => setOpt(i, "tpl", e.target.value)}>
                    <option value="">{t("ec.noItem")}</option>
                    {Object.entries(ITEMS).filter(([, x]) => x.kind !== "book").map(([id, x]) => <option key={id} value={id}>{x.name}</option>)}
                  </select>
                  {o.tpl && (
                    <>
                      <input className="rpg-input w-[48px] !py-0.5" inputMode="numeric" value={o.qty} onChange={(e) => setOpt(i, "qty", e.target.value.replace(/\D/g, ""))} />
                      <select className="rpg-input !py-0.5" value={o.min} onChange={(e) => setOpt(i, "min", e.target.value)}>
                        <option value="">{t("ec.anyRarity")}</option>
                        {RARITIES.map((r) => <option key={r} value={r}>{RARITY[r].name}↑</option>)}
                      </select>
                    </>
                  )}
                  {opts.length > 1 && <button className="text-[#a8323a]" onClick={() => setOpts(opts.filter((_, j) => j !== i))}>✕</button>}
                </div>
              </div>
            ))}
            <div className="mt-2 flex items-center justify-between">
              <button className="rpg-btn !px-2 !py-0.5 !text-[11px]" disabled={opts.length >= MARKET.options} onClick={() => setOpts([...opts, { ruc: "", tpl: "", qty: "1", min: "" }])}>{t("ec.addOption")}</button>
              <span className="text-[10px] text-[#8c6642]">{t("ec.fee")}</span>
            </div>
            <button className="rpg-btn mt-2 w-full" disabled={!pick || prices.some((p) => !p.ruc && !p.items)} onClick={() => { send({ t: "econ", op: "sell", a: pos(pick!), prices, rid: rid() }); setPick(null); setTab("mine"); }}>
              {t("ec.list")}
            </button>
          </div>
        </div>
      )}
      {tab === "mine" && (
        <div className="max-h-[50vh] space-y-1 overflow-y-auto pr-1">
          {!data?.mine.length && <p className="py-6 text-center text-[#8c6642]">{t("ec.mineEmpty")}</p>}
          {data?.mine.map((l) => (
            <div key={l.id} className="flex items-center gap-2 rounded bg-[#e8d3a9] px-2 py-1">
              <div className="w-[230px] shrink-0"><ItemCell it={l.item} /></div>
              <div className="min-w-0 flex-1 text-[10px]">{l.prices.map(priceText).join(" / ")}<br /><span className="text-[#8c6642]">{t("ec.remain", { r: remain(l.expires - Date.now()) })}</span></div>
              <button className="rpg-btn !px-2 !py-0.5 !text-[11px]" onClick={() => send({ t: "econ", op: "cancel", id: l.id })}>{t("ec.cancelListing")}</button>
            </div>
          ))}
        </div>
      )}
    </Window>
  );
}

// ── 대장간: 강화 · 마법부여 · 수리 (§16 · §14-4) ─────────────────────

const count = (items: Item[], tpl: string) => items.filter((i) => (i.loc === "inventory" || i.loc === "hotbar") && i.tpl === tpl).reduce((a, i) => a + i.qty, 0);

export function ForgeWindow({ you, items, last, send, onClose }: { you: You; items: Item[]; last?: { result: string; at: number }; send: Send; onClose: () => void }) {
  const [tab, setTab] = useState<"enhance" | "enchant" | "repair">("enhance");
  const [pickId, setPickId] = useState<string | null>(null);
  const [stoneId, setStoneId] = useState<string | null>(null);
  const [over, setOver] = useState(0);
  const [blessed, setBlessed] = useState(false);
  const [protect, setProtect] = useState(false);
  const gear = items.filter((i) => ITEMS[i.tpl]?.slot && i.loc !== "storage");
  const it = gear.find((i) => i.id === pickId) ?? null;
  const stones = items.filter((i) => ITEMS[i.tpl]?.enchant && (i.loc === "inventory" || i.loc === "hotbar"));
  const stone = stones.find((i) => i.id === stoneId) ?? null;
  const flash = last && Date.now() - last.at < 1500 ? last.result : "";
  const step = it && it.enh < ENHANCE_MAX ? ENHANCE[it.enh] : null;
  const broken = items.filter((i) => i.loc === "equipped" && i.dur < i.durMax);
  return (
    <Window title={t("ec.forge")} onClose={onClose} wide>
      <div className="mb-2 flex items-center justify-between">
        <div className="flex gap-1">
          {(["enhance", "enchant", "repair"] as const).map((x) => <button key={x} className="rpg-btn !px-2 !py-0.5 !text-[11px]" data-on={tab === x} onClick={() => setTab(x)}>{t(`ec.tab.${x}` as StrKey)}</button>)}
        </div>
        <Ruc you={you} />
      </div>
      {tab === "repair" ? (
        <div>
          {!broken.length && <p className="py-6 text-center text-[#8c6642]">{t("ec.repairNone")}</p>}
          {broken.map((i) => (
            <div key={i.id} className="flex items-center justify-between rounded bg-[#e8d3a9] px-2 py-1">
              <ItemCell it={i} />
              <span>{t("inv.dur", { d: i.dur, m: i.durMax })}</span>
              <button className="rpg-btn !px-2 !py-0.5 !text-[11px]" onClick={() => send({ t: "econ", op: "repair", a: pos(i), rid: rid() })}>{t("ec.repair")} {won(repairCost(i))} RUC</button>
            </div>
          ))}
          {broken.length > 1 && (
            <button className="rpg-btn mt-2 w-full" onClick={() => send({ t: "econ", op: "repair", a: "all", rid: rid() })}>
              {t("ec.repairAll")} {won(broken.reduce((a, i) => a + repairCost(i), 0))} RUC
            </button>
          )}
        </div>
      ) : (
        <div className="flex gap-3">
          <div className="max-h-[52vh] w-[250px] overflow-y-auto">
            {gear.map((i) => <ItemCell key={i.id} it={i} on={pickId === i.id} onClick={() => setPickId(i.id)} />)}
          </div>
          <div className="flex-1">
            <div className={`rounded p-3 text-center ${flash === "ok" ? "rpg-forge-ok" : flash === "fail" ? "rpg-forge-fail" : flash === "boom" ? "rpg-forge-boom" : "bg-[#e8d3a9]"}`}>
              {it ? <ItemCell it={it} /> : <p className="text-[#8c6642]">{t("ec.pickGear")}</p>}
              {flash && <p className="mt-1 text-base font-bold">{t(`ec.result.${flash}` as StrKey)}</p>}
            </div>
            {tab === "enhance" && it && (
              step ? (
                <div className="mt-2 space-y-1">
                  <p>{t("ec.enhRates", { ok: Math.round(Math.min(1, step.ok + (blessed ? 0.1 : 0)) * 100), boom: protect ? 0 : Math.round(step.boom * 100), to: it.enh + 1 })}</p>
                  <p>{t("ec.enhNeed", { s: step.stones, have: count(items, "enhance_stone"), r: won(enhanceCost(it)) })}</p>
                  <label className="flex items-center gap-1"><input type="checkbox" checked={blessed} disabled={!count(items, "blessed_stone")} onChange={(e) => setBlessed(e.target.checked)} />{t("ec.blessed", { n: count(items, "blessed_stone") })}</label>
                  <label className="flex items-center gap-1"><input type="checkbox" checked={protect} disabled={!count(items, "protect_scroll")} onChange={(e) => setProtect(e.target.checked)} />{t("ec.protect", { n: count(items, "protect_scroll") })}</label>
                  <button className="rpg-btn w-full" disabled={count(items, "enhance_stone") < step.stones || you.ruc < enhanceCost(it)}
                    onClick={() => send({ t: "econ", op: "enhance", a: pos(it), blessed: blessed && count(items, "blessed_stone") > 0, protect: protect && count(items, "protect_scroll") > 0, rid: rid() })}>
                    {t("ec.enhance")}
                  </button>
                </div>
              ) : <p className="mt-2">{t("ec.maxed")}</p>
            )}
            {tab === "enchant" && it && (
              <div className="mt-2 space-y-1">
                <p>{t("ec.enchSlots", { n: it.ench?.length ?? 0, m: ENCH_SLOTS[it.rarity] })}</p>
                {(it.ench ?? []).map((e, k) => (
                  <label key={k} className="flex items-center gap-1">
                    <input type="radio" name="over" checked={over === k} onChange={() => setOver(k)} disabled={(it.ench?.length ?? 0) < ENCH_SLOTS[it.rarity]} /> {enchText(e)}
                  </label>
                ))}
                <div className="flex max-h-[18vh] flex-wrap gap-1 overflow-y-auto">
                  {stones.map((i) => <ItemCell key={i.id} it={i} on={stoneId === i.id} onClick={() => setStoneId(i.id)} />)}
                  {!stones.length && <p className="text-[#8c6642]">{t("ec.noStone")}</p>}
                </div>
                {stone && <p>{t("ec.enchPreview", { k: ENCHANTS[ITEMS[stone.tpl].enchant!].name, p: ENCH_POWER[stone.rarity], r: won(enchantCost(it.rarity, stone.rarity)) })}</p>}
                <button className="rpg-btn w-full" disabled={!stone || !ENCH_SLOTS[it.rarity] || you.ruc < enchantCost(it.rarity, stone.rarity)}
                  onClick={() => send({ t: "econ", op: "enchant", a: pos(it), b: pos(stone!), slot: over, rid: rid() })}>
                  {t("ec.enchant")}
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </Window>
  );
}

// ── 연금술 작업대: 재조합 (§16-4) ─────────────────────────────────

export function AlchemyWindow({ items, last, send, onClose }: { items: Item[]; last?: { tpl: string; rarity: Rarity; at: number }; send: Send; onClose: () => void }) {
  const [picks, setPicks] = useState<string[]>([]);
  const bag = items.filter((i) => i.loc === "inventory" || i.loc === "hotbar");
  const chosen = picks.map((id) => bag.find((i) => i.id === id)).filter(Boolean) as Item[];
  const kind = chosen[0] && ITEMS[chosen[0].tpl].kind;
  const add = (i: Item) => {
    const used = picks.filter((x) => x === i.id).length;
    if (picks.length < 3 && used < i.qty && (!kind || ITEMS[i.tpl].kind === kind)) setPicks([...picks, i.id]);
  };
  return (
    <Window title={t("ec.alchemy")} onClose={onClose}>
      <p className="text-[#8c6642]">{t("ec.alchemyLead")}</p>
      <div className="my-2 flex items-center gap-2">
        {[0, 1, 2].map((k) => (
          <button key={k} className="rpg-islot" onClick={() => setPicks(picks.filter((_, j) => j !== k))}>{chosen[k] && <ItemImg it={{ ...chosen[k], qty: 1 }} />}</button>
        ))}
        <span>→</span>
        <span className="rpg-islot">{last && Date.now() - last.at < 4000 && <ItemImg it={{ id: "r", tpl: last.tpl, loc: "inventory", slot: 0, qty: 1, rarity: last.rarity, enh: 0, sp: [], dur: 0, durMax: 0 }} />}</span>
        <button className="rpg-btn ml-auto" disabled={chosen.length !== 3} onClick={() => { send({ t: "econ", op: "recombine", list: chosen.map(pos), rid: rid() }); setPicks([]); }}>{t("ec.recombine")}</button>
      </div>
      <div className="flex max-h-[30vh] flex-wrap gap-1 overflow-y-auto">
        {bag.map((i) => <ItemCell key={i.id} it={i} small onClick={() => add(i)} />)}
      </div>
      {/* 제조 (P13): 채집물 → 포션 · 강화석 */}
      <h3 className="mt-3 font-bold">{t("ec.brew")}</h3>
      <p className="text-[11px] text-[#8c6642]">{t("ec.brewLead")}</p>
      <div className="mt-1 space-y-1">
        {BREW.map((r, i) => {
          const have = (tpl: string) => bag.filter((x) => x.tpl === tpl).reduce((a, x) => a + x.qty, 0);
          const ok = r.need.every((n) => have(n.tpl) >= n.qty);
          return (
            <div key={i} className="flex items-center gap-2 rounded border border-[#c9a97a] bg-[#f6e9c8] px-2 py-1">
              <span className="flex-1">{r.need.map((n) => `${ITEMS[n.tpl].name} ${have(n.tpl)}/${n.qty}`).join(" + ")} → <b>{ITEMS[r.out].name} ×{r.qty}</b></span>
              <button className="rpg-btn !px-2 !py-0.5 !text-[11px]" disabled={!ok} onClick={() => send({ t: "econ", op: "brew", id: i, rid: rid() })}>{t("ec.brewBtn")}</button>
            </div>
          );
        })}
      </div>
    </Window>
  );
}

/** 분해 환불 (인벤토리 메뉴에서 씀) */
export const refundOf = (i: Item) => disassembleRuc(i) * i.qty;
