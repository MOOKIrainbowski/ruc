"use client";

import { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
import { CHAR_H, CHAR_W } from "../shared/constants";
import {
  ENCHANTS, EQUIP_NAME, EQUIP_SLOTS, ITEMS, LOCS, POTION_CD_MS, RARITIES, RARITY, SETS, SPECIALS, bookGrade, gearOf, lookOf, pctSpecial, pctText, stackable, working,
  type EquipSlot, type Item, type ItemPos, type Loc,
} from "../shared/data/items";
import { SKILLS } from "../shared/data/skills";
import { GRADE } from "../shared/progress";
import type { C2S, You } from "../shared/protocol";
import { characterSheet, outfitOf } from "./art/character";
import { iconUrl } from "./art/icons";
import { itemIcon } from "./art/items";
import { refundOf } from "./Economy";
import { t, type StrKey } from "./i18n";

/**
 * 인벤토리(V) · 창고(B) · 핫바 (§15). 조작은 서버로 보내고 서버가 돌려준 목록(inv)만 그립니다 — 화면이 서버와 어긋날 일이 없게.
 * 드래그 = 옮기기 · 나누기 없는 이동/맞바꿈, Shift+클릭 = 빠른 이동, 우클릭 = 메뉴 (§15-4).
 */

const pos = (i: Item): ItemPos => [i.loc, i.slot];
const PCT = new Set(["crit", "critDmg", "lifesteal", "spellVamp", "cdr", "tenacity"]);
const fmtStat = (k: string, v: number) => (PCT.has(k) ? `${Math.round(v * 1000) / 10}%` : `${Math.round(v * 10) / 10}`);
/** 양피지 위에서 읽히는 이름 색 */
export const nameColor = (r: Item["rarity"]) => (r === "common" ? "#3a2a1e" : r === "poor" ? "#6f6f6f" : RARITY[r].color);

/** 템플릿 스탯 × 희귀도 · 강화 (성능이 꺼졌으면 0) */
function statsOf(it: Item): Record<string, number> {
  const mul = RARITY[it.rarity].stat * (1 + 0.06 * it.enh) * (working(it) ? 1 : 0);
  return Object.fromEntries(Object.entries(ITEMS[it.tpl].stats ?? {}).map(([k, v]) => [k, v * mul]));
}

export function ItemImg({ it, dim }: { it: Item; dim?: boolean }) {
  const broken = !working(it);
  return (
    <>
      <img src={iconUrl(itemIcon(it.tpl, it.rarity))} alt={ITEMS[it.tpl]?.name} draggable={false} className="rpg-pixel absolute left-0 top-0 h-8 w-8" style={{ opacity: dim ? 0.35 : 1, filter: broken ? "grayscale(1)" : undefined }} />
      {it.qty > 1 && <span className="rpg-num bottom-0 right-0.5">{it.qty}</span>}
      {it.durMax > 0 && it.dur < it.durMax && (
        <div className="absolute bottom-0 left-0.5 right-0.5 h-[3px] bg-[#1b1420]">
          <div className="h-full" style={{ width: `${(it.dur / it.durMax) * 100}%`, background: it.dur / it.durMax > 0.3 ? "#4CC764" : "#E5484D" }} />
        </div>
      )}
    </>
  );
}

/** 툴팁 (§15-1 · §14-6): 이름 · 종류 · 착용 레벨 · 스탯(장착 중인 것과 비교) · 특수효과 · 세트 · 내구도 · 플레이버 */
function Tip({ it, items, level, x, y, zoom }: { it: Item; items: Item[]; level: number; x: number; y: number; zoom: number }) {
  const tp = ITEMS[it.tpl];
  const eqName: EquipSlot | undefined = tp.slot === "ring" ? "ring1" : tp.slot;
  const cur = eqName && it.loc !== "equipped" ? items.find((i) => i.loc === "equipped" && (EQUIP_SLOTS[i.slot] === eqName || (tp.slot === "ring" && EQUIP_SLOTS[i.slot] === "ring2"))) : undefined;
  const mine = statsOf(it);
  const theirs = cur ? statsOf(cur) : null;
  const keys = [...new Set([...Object.keys(mine), ...Object.keys(theirs ?? {})])];
  const setN = tp.set ? gearOf(items).sets.get(tp.set) ?? 0 : 0;
  const vw = innerWidth / zoom;
  const vh = innerHeight / zoom;
  const px = x / zoom;
  const py = y / zoom;
  const style = {
    left: px < vw / 2 ? px + 14 : undefined, right: px >= vw / 2 ? vw - px + 14 : undefined,
    top: py < vh / 2 ? py + 14 : undefined, bottom: py >= vh / 2 ? vh - py + 14 : undefined,
  };
  return (
    <div className="rpg-panel pointer-events-none fixed z-50 w-[236px] px-2.5 py-2 text-[11px] leading-[1.55]" style={style}>
      <b className={it.rarity === "legendary" ? "rpg-legend" : ""} style={{ color: it.rarity === "legendary" ? undefined : nameColor(it.rarity) }}>
        {it.name ?? `${tp.name}${it.enh ? ` +${it.enh}` : ""}`}
      </b>
      <div className="text-[#8c6642]">
        {RARITY[it.rarity].name} {t(`inv.kind.${tp.kind}` as StrKey)}{eqName ? ` · ${EQUIP_NAME[eqName]}` : ""}
      </div>
      {tp.slot && <div style={{ color: level < tp.lv ? "#E5484D" : undefined }}>{t("inv.level", { lv: tp.lv })}</div>}
      {keys.length > 0 && (
        <ul className="mt-1">
          {keys.map((k) => {
            const d = (mine[k] ?? 0) - (theirs?.[k] ?? 0);
            return (
              <li key={k}>
                {t(`stat.${k}` as StrKey)} +{fmtStat(k, mine[k] ?? 0)}
                {theirs && Math.abs(d) > 1e-9 && <span style={{ color: d > 0 ? "#2f8a45" : "#E5484D" }}> ({d > 0 ? "+" : "−"}{fmtStat(k, Math.abs(d))})</span>}
              </li>
            );
          })}
        </ul>
      )}
      {cur && <div className="text-[10px] text-[#8c6642]">{t("inv.compare", { name: ITEMS[cur.tpl].name })}</div>}
      {[...(it.opt ?? []).map((e) => [t("ec.tab.enhance"), e] as const), ...(it.ench ?? []).map((e) => [t("ec.tab.enchant"), e] as const)].map(([label, e], k) => (
        <div key={`e${k}`} className="text-[#9B5DE5]">◆ {label}: {ENCHANTS[e.k]?.name}{e.el ? ` (${e.el})` : ""} +{pctText("{v}", e.v, e.v < 1)}{e.v < 1 ? "%" : ""}</div>
      ))}
      {it.sp.map((s) => (
        <div key={s.id} className="mt-0.5 text-[#3b6fd6]">✦ {SPECIALS[s.id]?.name}: {pctText(SPECIALS[s.id]?.desc ?? "", s.v, pctSpecial(s.id))}</div>
      ))}
      {tp.heal && (
        <div className="mt-1">
          {(["hp", "mp", "en"] as const).filter((k) => tp.heal![k]).map((k) => <div key={k}>{t(`inv.heal.${k}`, { v: tp.heal![k]! })}</div>)}
          <div className="text-[#8c6642]">{t("inv.potion")}</div>
        </div>
      )}
      {tp.skill && (
        <div className="mt-1 text-[#3b6fd6]">
          {SKILLS[tp.skill].name} · {GRADE[bookGrade(it.rarity)].name}
          <p className="text-[#3a2a1e]">{SKILLS[tp.skill].desc}</p>
        </div>
      )}
      {tp.set && (
        <div className="mt-1">
          <b className="text-[#2f8a45]">{t("inv.set", { name: SETS[tp.set].name, n: setN })}</b>
          {SETS[tp.set].tiers.map((tier) => (
            <div key={tier.n} style={{ color: setN >= tier.n ? "#2f8a45" : "#9e917c" }}>({tier.n}) {tier.desc}</div>
          ))}
        </div>
      )}
      {it.durMax > 0 && (
        <div className="mt-1" style={{ color: it.dur ? undefined : "#E5484D" }}>
          {t("inv.dur", { d: it.dur, m: it.durMax })}
          {!it.dur && <div>{t("inv.broken")}</div>}
        </div>
      )}
      <p className="mt-1 italic text-[#8c6642]">{tp.desc}</p>
    </div>
  );
}

type Ctx = {
  items: Item[];
  drag: Item | null;
  down: (e: React.MouseEvent, it: Item | undefined) => void;
  up: (p: ItemPos) => void;
  hover: (p: ItemPos | null) => void;
  menu: (e: React.MouseEvent, it: Item) => void;
};
const C = createContext<Ctx | null>(null);

function Slot({ p, label }: { p: ItemPos; label?: string }) {
  const c = useContext(C)!;
  const it = c.items.find((i) => i.loc === p[0] && i.slot === p[1]);
  return (
    <div
      className="rpg-islot"
      style={it ? { boxShadow: `inset 0 0 0 2px ${RARITY[it.rarity].color}` } : undefined}
      onMouseDown={(e) => c.down(e, it)}
      onMouseUp={() => c.up(p)}
      onMouseEnter={() => c.hover(p)}
      onMouseLeave={() => c.hover(null)}
      onContextMenu={(e) => { e.preventDefault(); if (it) c.menu(e, it); }}
    >
      {it ? <ItemImg it={it} dim={c.drag === it} /> : label && <span className="rpg-islot-label">{label}</span>}
    </div>
  );
}

const Grid = ({ loc, cols }: { loc: Loc; cols: number }) => (
  <div className="grid gap-1" style={{ gridTemplateColumns: `repeat(${cols}, 36px)` }}>
    {Array.from({ length: LOCS[loc] }, (_, i) => <Slot key={i} p={[loc, i]} />)}
  </div>
);
const Eq = ({ s }: { s: EquipSlot }) => <Slot p={["equipped", EQUIP_SLOTS.indexOf(s)]} label={EQUIP_NAME[s]} />;

/** 캐릭터 미리보기 (8방향 돌려 보기) */
function Preview({ you, items }: { you: You; items: Item[] }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [dir, setDir] = useState(0);
  const look = lookOf(items).join();
  const sheet = useMemo(() => characterSheet(you.appearance, outfitOf(look ? look.split(",") : [])), [you.appearance, look]);
  useEffect(() => {
    const ctx = ref.current?.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, CHAR_W, CHAR_H);
    ctx.drawImage(sheet, 0, dir * CHAR_H, CHAR_W, CHAR_H, 0, 0, CHAR_W, CHAR_H);
  }, [sheet, dir]);
  return (
    <div className="flex w-[104px] flex-col items-center justify-center gap-1 rounded bg-[#e8d3a9]">
      <canvas ref={ref} width={CHAR_W} height={CHAR_H} className="rpg-pixel h-[160px] w-[128px]" />
      <button className="rpg-btn !px-1.5 !py-0.5 !text-[10px]" onClick={() => setDir((dir + 1) % 8)}>↻ {t("inv.rotate")}</button>
    </div>
  );
}

export function ItemsWindow({ mode, items, you, zoom, send, toast, onClose }: {
  mode: "inventory" | "storage"; items: Item[]; you: You; zoom: number; send: (m: C2S) => void; toast: (msg: string) => void; onClose: () => void;
}) {
  const [drag, setDrag] = useState<Item | null>(null);
  const [mouse, setMouse] = useState({ x: 0, y: 0 });
  /** 마우스가 올라간 칸 — 서버가 목록을 바꿔도 그 칸의 지금 아이템을 보여 줌 */
  const [hover, setHover] = useState<ItemPos | null>(null);
  const hovered = hover && items.find((i) => i.loc === hover[0] && i.slot === hover[1]);
  const [menu, setMenu] = useState<{ it: Item; x: number; y: number } | null>(null);
  /** 확인 창: 버리기 · 분해 (강화된 고급 이상은 두 번 묻기, §16-3) */
  const [confirm, setConfirm] = useState<{ it: Item; kind: "drop" | "dis" | "dis2" } | null>(null);
  useEffect(() => {
    const mv = (e: MouseEvent) => setMouse({ x: e.clientX, y: e.clientY });
    const up = () => setDrag(null); // 슬롯 위가 아니면 취소 (React 핸들러가 먼저 돎)
    addEventListener("mousemove", mv);
    addEventListener("mouseup", up);
    return () => { removeEventListener("mousemove", mv); removeEventListener("mouseup", up); };
  }, []);

  const move = (a: ItemPos, b: ItemPos, n?: number) => send({ t: "item", op: "move", a, b, n });
  const use = (it: Item) => send({ t: "item", op: "use", a: pos(it) });
  /** Shift+클릭: 창고 ↔ 인벤토리, 장비 ↔ 장착, 인벤토리 ↔ 핫바 */
  const quick = (it: Item) => {
    if (mode === "storage") return it.loc === "storage" ? move(pos(it), ["inventory", -1]) : it.loc !== "equipped" && move(pos(it), ["storage", -1]);
    if (it.loc === "equipped" || ITEMS[it.tpl].slot) return use(it);
    move(pos(it), [it.loc === "hotbar" ? "inventory" : "hotbar", -1]);
  };
  const split = (it: Item) => {
    const loc: Loc = it.loc === "equipped" ? "inventory" : it.loc;
    for (let s = 0; s < LOCS[loc]; s++) if (!items.some((i) => i.loc === loc && i.slot === s)) return move(pos(it), [loc, s], Math.floor(it.qty / 2));
    toast(t("inv.noRoom"));
  };
  const ctx: Ctx = {
    items, drag,
    down: (e, it) => {
      setMenu(null);
      if (e.button !== 0 || !it) return;
      if (e.shiftKey) quick(it);
      else setDrag(it);
    },
    up: (p) => { if (drag && (drag.loc !== p[0] || drag.slot !== p[1])) move(pos(drag), p); },
    hover: setHover,
    menu: (e, it) => setMenu({ it, x: e.clientX, y: e.clientY }),
  };
  const level = you.level;
  const sortBtn = (loc: "inventory" | "storage") => (
    <button className="rpg-btn !px-2 !py-0.5 !text-[10px]" onClick={() => send({ t: "item", op: "sort", loc })}>{t("inv.sort")}</button>
  );

  return (
    <C.Provider value={ctx}>
      <div className="rpg-modal-bg" onMouseDown={() => setMenu(null)}>
        <div className="rpg-panel relative p-4 text-[12px]" onMouseDown={(e) => e.stopPropagation()}>
          <button className="rpg-x" onClick={onClose} aria-label={t("hud.close")}>✕</button>
          {mode === "inventory" ? (
            <div className="flex gap-4">
              <div>
                <h2 className="mb-2 text-base font-bold">{t("inv.title")}</h2>
                <div className="flex gap-2">
                  <div className="flex flex-col gap-1">{(["helmet", "chest", "legs", "boots", "gloves", "cape"] as const).map((s) => <Eq key={s} s={s} />)}</div>
                  <Preview you={you} items={items} />
                  <div className="flex flex-col gap-1">{(["weapon", "offhand", "ring1", "ring2", "necklace", "earring"] as const).map((s) => <Eq key={s} s={s} />)}</div>
                </div>
                <div className="mt-1 flex gap-1">{(["watch", "doll", "costumeTop", "costumeBottom", "hair"] as const).map((s) => <Eq key={s} s={s} />)}</div>
              </div>
              <div className="pt-8">
                <div className="mb-1 flex justify-end">{sortBtn("inventory")}</div>
                <Grid loc="inventory" cols={9} />
                <div className="mb-1 mt-3 font-bold">{t("inv.hotbar")}</div>
                <Grid loc="hotbar" cols={5} />
              </div>
            </div>
          ) : (
            <div>
              <div className="mb-1 flex items-center justify-between pr-8"><h2 className="text-base font-bold">{t("inv.storage")}</h2>{sortBtn("storage")}</div>
              <Grid loc="storage" cols={9} />
              <div className="mb-1 mt-3 flex items-center justify-between"><b>{t("inv.title")}</b>{sortBtn("inventory")}</div>
              <Grid loc="inventory" cols={9} />
              <div className="mt-2"><Grid loc="hotbar" cols={5} /></div>
            </div>
          )}
          <p className="mt-2 text-[10px] text-[#8c6642]">{t("inv.help")}</p>

          {confirm && (
            <div className="absolute inset-0 flex items-center justify-center bg-[rgba(243,228,195,0.85)]">
              <div className="rpg-panel max-w-[360px] p-4 text-center">
                {(() => {
                  const name = `「${ITEMS[confirm.it.tpl].name}」${confirm.it.qty > 1 ? ` ×${confirm.it.qty}` : ""}`;
                  return confirm.kind === "drop" ? t("inv.dropConfirm", { name }) : confirm.kind === "dis" ? t("ec.disConfirm", { name, r: refundOf(confirm.it) }) : t("ec.disConfirm2");
                })()}
                <div className="mt-3 flex justify-center gap-2">
                  <button className="rpg-btn" onClick={() => {
                    const { it, kind } = confirm;
                    if (kind === "drop") send({ t: "item", op: "drop", a: pos(it) });
                    // 강화된 고급 이상 장비는 한 번 더 묻기
                    else if (kind === "dis" && it.enh > 0 && RARITIES.indexOf(it.rarity) >= RARITIES.indexOf("advanced")) return setConfirm({ it, kind: "dis2" });
                    else send({ t: "econ", op: "disassemble", a: pos(it), rid: crypto.randomUUID() });
                    setConfirm(null);
                  }}>{confirm.kind === "drop" ? t("inv.drop") : t("ec.disassemble")}</button>
                  <button className="rpg-btn" onClick={() => setConfirm(null)}>{t("inv.cancel")}</button>
                </div>
              </div>
            </div>
          )}
        </div>

        {menu && (
          <div className="rpg-panel fixed z-50 flex flex-col p-1 text-[12px]" style={{ left: menu.x / zoom, top: menu.y / zoom }} onMouseDown={(e) => e.stopPropagation()}>
            {(() => {
              const tp = ITEMS[menu.it.tpl];
              const rows: [string, () => void][] = [];
              if (tp.heal || tp.skill) rows.push([t("inv.use"), () => use(menu.it)]);
              if (tp.slot) rows.push([menu.it.loc === "equipped" ? t("inv.unequip") : t("inv.equip"), () => use(menu.it)]);
              if (stackable(tp) && menu.it.qty > 1) rows.push([t("inv.split"), () => split(menu.it)]);
              if (menu.it.loc !== "equipped") rows.push([t("ec.disassemble"), () => setConfirm({ it: menu.it, kind: "dis" })]);
              rows.push([t("inv.drop"), () => setConfirm({ it: menu.it, kind: "drop" })]);
              return rows.map(([label, f]) => (
                <button key={label} className="rounded px-3 py-1 text-left hover:bg-[#e8d3a9]" onClick={() => { f(); setMenu(null); }}>{label}</button>
              ));
            })()}
          </div>
        )}
        {hovered && !drag && !menu && <Tip it={hovered} items={items} level={level} x={mouse.x} y={mouse.y} zoom={zoom} />}
        {drag && (
          <div className="pointer-events-none fixed z-50 h-8 w-8" style={{ left: mouse.x / zoom - 16, top: mouse.y / zoom - 16 }}>
            <ItemImg it={drag} />
          </div>
        )}
      </div>
    </C.Provider>
  );
}

/** 핫바 (§15-2): 마크 핫바처럼 회색 베벨 + 고른 칸 굵은 흰 테두리. 포션은 공유 쿨 스윕 */
export function Hotbar({ items, sel, potion, onSelect }: { items: Item[]; sel: number; potion: number; onSelect: (i: number) => void }) {
  return (
    <div className="pointer-events-auto flex gap-1">
      {Array.from({ length: LOCS.hotbar }, (_, i) => {
        const it = items.find((x) => x.loc === "hotbar" && x.slot === i);
        const cd = !!it && !!ITEMS[it.tpl]?.heal && potion > 0;
        return (
          <div key={i} className="rpg-hot" data-on={sel === i} onMouseDown={() => onSelect(i)} title={it ? ITEMS[it.tpl].name : ""}>
            {it && <ItemImg it={it} />}
            {cd && <div className="absolute inset-0" style={{ background: `conic-gradient(transparent ${(1 - potion / POTION_CD_MS) * 360}deg, rgba(10,6,16,0.65) 0)` }} />}
            <span className="rpg-num left-0.5 top-0 text-[9px]">{i + 1}</span>
          </div>
        );
      })}
    </div>
  );
}
