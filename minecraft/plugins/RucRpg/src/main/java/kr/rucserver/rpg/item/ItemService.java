package kr.rucserver.rpg.item;

import com.google.common.collect.ImmutableMultimap;
import com.google.gson.Gson;
import com.google.gson.JsonArray;
import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import kr.rucserver.rpg.RucRpg;
import kr.rucserver.rpg.engine.Formulas;
import kr.rucserver.rpg.ui.Gui;
import net.kyori.adventure.text.Component;
import net.kyori.adventure.text.format.NamedTextColor;
import net.kyori.adventure.text.format.TextColor;
import net.kyori.adventure.text.format.TextDecoration;
import org.bukkit.Color;
import org.bukkit.Material;
import org.bukkit.NamespacedKey;
import org.bukkit.Registry;
import org.bukkit.inventory.ItemFlag;
import org.bukkit.inventory.ItemStack;
import org.bukkit.inventory.meta.ArmorMeta;
import org.bukkit.inventory.meta.ItemMeta;
import org.bukkit.inventory.meta.LeatherArmorMeta;
import org.bukkit.inventory.meta.trim.ArmorTrim;
import org.bukkit.inventory.meta.trim.TrimMaterial;
import org.bukkit.inventory.meta.trim.TrimPattern;
import org.bukkit.persistence.PersistentDataContainer;
import org.bukkit.persistence.PersistentDataType;

import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import java.util.function.DoubleSupplier;

/**
 * RPG 아이템 (§14 · 웹 shared/data/items.ts). 마크 아이템(ItemStack) 하나 = RPG 인스턴스 하나 —
 * PDC 에 uid · 템플릿 · 희귀도 · 강화 · 특수효과 · 내구도 · 강화옵션 · 마법부여 · +10 이름을 넣고, 이름 · 로어 · 모양은 늘 템플릿에서 다시 그림.
 *
 * 모양 (사용자 결정): 검 · 도끼 · 투구 · 흉갑 · 바지 · 신발 = **바닐라 모양**(레벨 단계 → 재료, 가죽은 RPG 색으로 염색, 높은 단계는 장식 색).
 * 그 밖(단검 · 지팡이 · 활 · 완드 · 장갑 · 망토 · 장신구 · 포션 · 음식 · 재료 · 스킬북) = RPG 아이콘(item_model). 부가석 = 바닐라 마법부여 책.
 * 바닐라 공격력 · 방어력 속성은 지움 (피해는 전부 RPG 공식) · 바닐라 내구도 없음(부서지지 않음) — RPG 내구도는 PDC.
 */
public class ItemService {

    public record Inst(String uid, String tpl, String rarity, int enh, JsonArray sp, int dur, int durMax, JsonArray opt, JsonArray ench, String name) {}

    private final RucRpg plugin;
    private final JsonObject items, rarity, sets, specials, enchants;
    private final List<String> rarities = new ArrayList<>();
    private final NamespacedKey kUid, kTpl, kRar, kEnh, kSp, kDur, kDurMax, kOpt, kEnch, kName;
    private DoubleSupplier rng = Math::random;
    private static final Gson GSON = new Gson();

    /** 테스트용 (플러그인 없이) */
    protected ItemService() {
        plugin = null; items = rarity = sets = specials = enchants = null;
        kUid = kTpl = kRar = kEnh = kSp = kDur = kDurMax = kOpt = kEnch = kName = null;
    }

    public ItemService(RucRpg plugin) {
        this.plugin = plugin;
        JsonObject f = plugin.data().file("items");
        items = f.getAsJsonObject("ITEMS");
        rarity = f.getAsJsonObject("RARITY");
        sets = f.getAsJsonObject("SETS");
        specials = f.getAsJsonObject("SPECIALS");
        enchants = f.has("ENCHANTS") ? f.getAsJsonObject("ENCHANTS") : new JsonObject();
        for (JsonElement e : f.getAsJsonArray("RARITIES")) rarities.add(e.getAsString());
        kUid = key("uid"); kTpl = key("tpl"); kRar = key("rarity"); kEnh = key("enh"); kSp = key("sp");
        kDur = key("dur"); kDurMax = key("dur_max"); kOpt = key("opt"); kEnch = key("ench"); kName = key("name");
    }

    private NamespacedKey key(String k) { return new NamespacedKey(plugin, "item_" + k); }

    public JsonObject tpl(String id) { return id == null || items == null ? null : items.getAsJsonObject(id); }
    public Iterable<String> templateIds() { return items.keySet(); }
    public List<String> rarities() { return rarities; }
    public JsonObject rarityDef(String r) { return rarity.getAsJsonObject(r); }

    private static String str(JsonObject o, String k) { return o != null && o.has(k) && !o.get(k).isJsonNull() ? o.get(k).getAsString() : null; }

    /** 장비 = 장착 칸이 있는 것 (웹 isGear) */
    public static boolean isGear(JsonObject t) { return t != null && t.has("slot"); }

    /** 한 칸에 여러 개 (웹 stackable): 포션 · 재료 · 책 · 음식. 장비는 1개짜리 고유 인스턴스 */
    public static boolean stackable(JsonObject t) {
        String k = str(t, "kind");
        return "potion".equals(k) || "material".equals(k) || "book".equals(k) || ("consumable".equals(k) && t.has("use") && t.getAsJsonObject("use").has("food"));
    }

    // ── 읽기 ────────────────────────────────────────────────────────

    public Inst read(ItemStack it) {
        if (it == null || it.getType().isAir() || !it.hasItemMeta()) return null;
        PersistentDataContainer d = it.getItemMeta().getPersistentDataContainer();
        String tpl = d.get(kTpl, PersistentDataType.STRING);
        if (tpl == null || tpl(tpl) == null) return null;
        return new Inst(d.get(kUid, PersistentDataType.STRING), tpl, d.getOrDefault(kRar, PersistentDataType.STRING, "common"),
                d.getOrDefault(kEnh, PersistentDataType.INTEGER, 0), arr(d.get(kSp, PersistentDataType.STRING)),
                d.getOrDefault(kDur, PersistentDataType.INTEGER, 0), d.getOrDefault(kDurMax, PersistentDataType.INTEGER, 0),
                arr(d.get(kOpt, PersistentDataType.STRING)), arr(d.get(kEnch, PersistentDataType.STRING)), d.get(kName, PersistentDataType.STRING));
    }

    private static JsonArray arr(String s) { return s == null ? new JsonArray() : JsonParser.parseString(s).getAsJsonArray(); }

    /** 내구도가 남았나 (웹 working) — 0 이면 스탯 · 평타 없음 */
    public static boolean working(Inst i) { return i.durMax() == 0 || i.dur() > 0; }

    @Override public String toString() { return "ItemService"; }

    /** 평타 스킬 (웹 basicOf): RPG 무기면 템플릿 basic, 내구도 0 이면 맨손 */
    public String basicOf(ItemStack it) {
        Inst i = read(it);
        if (i == null) return null;
        JsonObject t = tpl(i.tpl());
        if (!"weapon".equals(str(t, "kind"))) return null;
        return working(i) && t.has("basic") ? t.get("basic").getAsString() : "punch";
    }

    public boolean isWeapon(ItemStack it) {
        Inst i = read(it);
        return i != null && "weapon".equals(str(tpl(i.tpl()), "kind"));
    }

    // ── 만들기 ──────────────────────────────────────────────────────

    /** 새 아이템 (드롭 · 상점 · GM 지급). 장비면 uid · 특수효과 · 내구도를 굴림 */
    public ItemStack create(String tplId, String rar, int qty) {
        JsonObject t = tpl(tplId);
        if (t == null) throw new IllegalArgumentException("없는 아이템: " + tplId);
        String r = t.has("rarity") ? t.get("rarity").getAsString() : (rar == null ? "common" : rar);
        boolean gear = isGear(t);
        String kind = str(t, "kind");
        int base = "weapon".equals(kind) ? 100 : "armor".equals(kind) ? 120 : 0;   // 웹 durMaxOf
        int durMax = (int) Formulas.jsRound(base * rarity.getAsJsonObject(r).get("dur").getAsDouble());
        Inst i = new Inst(gear ? UUID.randomUUID().toString() : null, tplId, r, 0, gear ? rollSpecials(t, r) : new JsonArray(),
                durMax, durMax, new JsonArray(), new JsonArray(), null);
        ItemStack it = new ItemStack(baseMaterial(t), stackable(t) ? Math.max(1, Math.min(qty, 64)) : 1);
        write(it, i);
        return it;
    }

    /** 특수효과 롤 (웹 rollSpecials) */
    private JsonArray rollSpecials(JsonObject t, String r) {
        JsonArray out = new JsonArray();
        JsonObject tierT = plugin.data().get("items.SPECIAL_TIER") != null ? plugin.data().get("items.SPECIAL_TIER").getAsJsonObject() : null;
        double tier = tierT != null && tierT.has(r) ? tierT.get(r).getAsDouble() : 0;
        int n = rarity.getAsJsonObject(r).get("specials").getAsInt();
        if (tier <= 0 || n <= 0) return out;
        List<String> pool = new ArrayList<>();
        for (String id : specials.keySet())
            for (JsonElement on : specials.getAsJsonObject(id).getAsJsonArray("on")) if (on.getAsString().equals(str(t, "kind"))) pool.add(id);
        while (out.size() < n && !pool.isEmpty()) {
            String id = pool.remove((int) Math.floor(rng.getAsDouble() * pool.size()));
            JsonArray range = specials.getAsJsonObject(id).getAsJsonArray("range");
            double lo = range.get(0).getAsDouble(), hi = range.get(1).getAsDouble();
            double v = (lo + rng.getAsDouble() * (hi - lo)) * tier;
            JsonObject s = new JsonObject();
            s.addProperty("id", id);
            s.addProperty("v", v < 2 ? Math.round(v * 1000) / 1000.0 : Math.round(v));
            out.add(s);
        }
        return out;
    }

    /** 장비 레벨 → 바닐라 재료 단계 (가죽 · 사슬 · 철 · 다이아 · 금 · 네더라이트) */
    private static int tierOf(int lv) {
        if (lv < 15) return 0;
        if (lv < 35) return 1;
        if (lv < 55) return 2;
        if (lv < 75) return 3;
        if (lv < 95) return 4;
        return 5;
    }

    private static final String[] ARMOR_MAT = {"LEATHER", "CHAINMAIL", "IRON", "DIAMOND", "GOLDEN", "NETHERITE"};
    private static final String[] TOOL_MAT = {"WOODEN", "STONE", "IRON", "DIAMOND", "GOLDEN", "NETHERITE"};

    public Material baseMaterial(JsonObject t) {
        String icon = str(t, "icon"), kind = str(t, "kind");
        int tier = tierOf(t.has("lv") ? t.get("lv").getAsInt() : 1);
        if (str(t, "enchant") != null) return Material.ENCHANTED_BOOK;   // 부가석 = 바닐라 마법부여 책 (사용자 지정)
        if ("weapon".equals(kind) && "sword".equals(icon)) return Material.valueOf(TOOL_MAT[tier] + "_SWORD");
        if ("weapon".equals(kind) && "axe".equals(icon)) return Material.valueOf(TOOL_MAT[tier] + "_AXE");
        if ("armor".equals(kind)) {
            String part = switch (icon == null ? "" : icon) { case "helmet" -> "_HELMET"; case "chest" -> "_CHESTPLATE"; case "legs" -> "_LEGGINGS"; case "boots" -> "_BOOTS"; default -> null; };
            if (part != null) return Material.valueOf(ARMOR_MAT[tier] + part);
        }
        return Material.PAPER;   // RPG 아이콘 (item_model) — 바닐라 우클릭 동작이 없는 바탕
    }

    /** 바닐라 모양이 아닌 것의 아이콘 모델 경로 */
    private String modelOf(JsonObject t, String tplId, String r) {
        Material m = baseMaterial(t);
        if (m != Material.PAPER) return null;
        return isGear(t) ? "item/" + str(t, "icon") + "_" + r : "item/" + tplId;
    }

    /** PDC + 이름 · 로어 · 모양을 다시 그림 */
    public void write(ItemStack it, Inst i) {
        JsonObject t = tpl(i.tpl());
        ItemMeta m = it.getItemMeta();
        PersistentDataContainer d = m.getPersistentDataContainer();
        if (i.uid() != null) d.set(kUid, PersistentDataType.STRING, i.uid());
        d.set(kTpl, PersistentDataType.STRING, i.tpl());
        d.set(kRar, PersistentDataType.STRING, i.rarity());
        if (isGear(t)) {
            d.set(kEnh, PersistentDataType.INTEGER, i.enh());
            d.set(kSp, PersistentDataType.STRING, i.sp().toString());
            d.set(kDur, PersistentDataType.INTEGER, i.dur());
            d.set(kDurMax, PersistentDataType.INTEGER, i.durMax());
            d.set(kOpt, PersistentDataType.STRING, i.opt().toString());
            d.set(kEnch, PersistentDataType.STRING, i.ench().toString());
            if (i.name() != null) d.set(kName, PersistentDataType.STRING, i.name());
        }
        String model = modelOf(t, i.tpl(), i.rarity());
        if (model != null && Gui.hasModel(model)) m.setItemModel(new NamespacedKey("ruc", model));
        JsonObject rd = rarity.getAsJsonObject(i.rarity());
        TextColor rc = TextColor.fromHexString(rd.get("color").getAsString());
        String title = (i.name() != null ? i.name() : t.get("name").getAsString()) + (i.enh() > 0 && i.name() == null ? " +" + i.enh() : "");
        m.displayName(Component.text(title, rc, TextDecoration.BOLD).decoration(TextDecoration.ITALIC, false));
        m.lore(lore(t, i));
        m.setUnbreakable(true);
        m.setAttributeModifiers(ImmutableMultimap.of());   // 바닐라 공격력 · 방어력 지움
        m.addItemFlags(ItemFlag.HIDE_ATTRIBUTES, ItemFlag.HIDE_UNBREAKABLE, ItemFlag.HIDE_DYE, ItemFlag.HIDE_ARMOR_TRIM, ItemFlag.HIDE_ADDITIONAL_TOOLTIP, ItemFlag.HIDE_ENCHANTS, ItemFlag.HIDE_STORED_ENCHANTS);
        if (m instanceof LeatherArmorMeta lm && t.has("look")) lm.setColor(lookColor(t));
        if (m instanceof ArmorMeta am && !(m instanceof LeatherArmorMeta)) {
            TrimMaterial tm = trimFor(t);
            if (tm != null) am.setTrim(new ArmorTrim(tm, TrimPattern.SENTRY));
        }
        if ("legendary".equals(i.rarity()) || "mythic".equals(i.rarity())) m.setEnchantmentGlintOverride(true);
        it.setItemMeta(m);
    }

    private static Color lookColor(JsonObject t) {
        JsonElement l = t.get("look");
        String hex = l.isJsonArray() ? l.getAsJsonArray().get(1).getAsString() : l.getAsString();
        return Color.fromRGB(Integer.parseInt(hex.substring(1), 16));
    }

    /** 높은 단계 장비의 장식 색 (단계 색과 비슷한 바닐라 장식 재료) */
    private static TrimMaterial trimFor(JsonObject t) {
        int lv = t.has("lv") ? t.get("lv").getAsInt() : 1;
        String key = lv >= 95 ? "gold" : lv >= 75 ? "redstone" : lv >= 55 ? "diamond" : lv >= 35 ? "amethyst" : null;
        return key == null ? null : Registry.TRIM_MATERIAL.get(NamespacedKey.minecraft(key));
    }

    private static Component ln(String s, TextColor c) { return Component.text(s, c).decoration(TextDecoration.ITALIC, false); }

    private static final String[][] STAT_NAMES = {
            {"hp", "체력"}, {"stamina", "스태미나"}, {"mana", "마나"}, {"energy", "기력"}, {"atk", "공격력"}, {"ap", "주문력"},
            {"atkSpeed", "공격 속도"}, {"moveSpeed", "이동 속도"}, {"pdef", "물리 방어"}, {"mdef", "마법 방어"}, {"spirit", "정신력"},
            {"regen", "재생력"}, {"endurance", "지구력"}, {"luck", "운"}, {"crit", "치명타 확률"}, {"critDmg", "치명타 피해"},
            {"penPhys", "물리 관통"}, {"penMag", "마법 관통"}, {"cdr", "쿨타임 감소"}, {"tenacity", "강인함"}, {"lifesteal", "흡혈"}, {"spellVamp", "주문 흡혈"}};

    public static String statName(String k) {
        for (String[] s : STAT_NAMES) if (s[0].equals(k)) return s[1];
        return k;
    }

    public static boolean pctStat(String k) {
        return List.of("crit", "critDmg", "penPhys", "penMag", "cdr", "tenacity", "lifesteal", "spellVamp", "dmgUp", "dmgDown", "skillDmg", "healPower", "elPen").contains(k);
    }

    public static String fmt(String k, double v) {
        if (pctStat(k)) return (v >= 0 ? "+" : "") + Math.round(v * 1000) / 10.0 + "%";
        return (v >= 0 ? "+" : "") + (Math.abs(v - Math.round(v)) < 0.05 ? String.valueOf(Math.round(v)) : String.valueOf(Math.round(v * 10) / 10.0));
    }

    /** 툴팁 (웹 Inventory 툴팁 순서): 희귀도 · 종류 · 레벨 → 스탯 → 강화옵션 · 마법부여 → 특수효과 → 세트 → 내구도 → 설명 */
    private List<Component> lore(JsonObject t, Inst i) {
        List<Component> out = new ArrayList<>();
        JsonObject rd = rarity.getAsJsonObject(i.rarity());
        TextColor rc = TextColor.fromHexString(rd.get("color").getAsString());
        String kind = switch (str(t, "kind")) {
            case "weapon" -> "무기"; case "armor" -> "방어구"; case "accessory" -> "장신구"; case "potion" -> "포션"; case "material" -> "재료";
            case "book" -> "스킬북"; case "consumable" -> "소모품"; default -> "";
        };
        out.add(ln(rd.get("name").getAsString() + " " + kind + (isGear(t) ? "  ·  착용 Lv." + t.get("lv").getAsInt() : ""), rc));
        if (isGear(t) && t.has("stats")) {
            double mul = rd.get("stat").getAsDouble() * (1 + 0.06 * i.enh());
            for (var e : t.getAsJsonObject("stats").entrySet())
                out.add(ln(statName(e.getKey()) + " " + fmt(e.getKey(), e.getValue().getAsDouble() * mul), NamedTextColor.WHITE));
        }
        for (JsonElement e : i.opt()) out.add(ln("◆ 강화 옵션: " + enchLine(e.getAsJsonObject()), TextColor.color(0xF2C94C)));
        for (JsonElement e : i.ench()) out.add(ln("✦ 마법부여: " + enchLine(e.getAsJsonObject()), TextColor.color(0xB28DFF)));
        for (JsonElement e : i.sp()) {
            JsonObject s = e.getAsJsonObject();
            JsonObject def = specials.getAsJsonObject(s.get("id").getAsString());
            if (def == null) continue;
            double v = s.get("v").getAsDouble();
            String vs = v < 2 ? String.valueOf(Math.round(v * 1000) / 10.0) : String.valueOf(Math.round(v));
            out.add(ln("★ " + def.get("name").getAsString() + " — " + def.get("desc").getAsString().replace("{v}", vs), TextColor.color(0xFF9F1C)));
        }
        if (t.has("set") && sets.has(t.get("set").getAsString())) {
            JsonObject set = sets.getAsJsonObject(t.get("set").getAsString());
            out.add(ln("세트: " + set.get("name").getAsString(), TextColor.color(0x7CFC7C)));
            for (JsonElement tier : set.getAsJsonArray("tiers"))
                out.add(ln("  (" + tier.getAsJsonObject().get("n").getAsInt() + ") " + tier.getAsJsonObject().get("desc").getAsString(), NamedTextColor.DARK_GREEN));
        }
        if (t.has("heal")) {
            JsonObject h = t.getAsJsonObject("heal");
            List<String> parts = new ArrayList<>();
            if (h.has("hp")) parts.add("체력 " + h.get("hp").getAsInt());
            if (h.has("mp")) parts.add("마나 " + h.get("mp").getAsInt());
            if (h.has("en")) parts.add("기력 " + h.get("en").getAsInt());
            out.add(ln("우클릭: " + String.join(" · ", parts) + " 회복 (포션 공유 쿨 8초)", NamedTextColor.GREEN));
        }
        if (t.has("use") && t.getAsJsonObject("use").has("food"))
            out.add(ln("우클릭: 스태미나 " + t.getAsJsonObject("use").get("food").getAsInt() + " 회복", NamedTextColor.GREEN));
        if ("book".equals(str(t, "kind"))) out.add(ln("우클릭: 스킬을 배우거나 등급을 올립니다", NamedTextColor.GREEN));
        if (i.durMax() > 0) out.add(ln("내구도 " + i.dur() + " / " + i.durMax() + (i.dur() == 0 ? "  (수리 필요 — 효과 없음)" : ""), i.dur() == 0 ? NamedTextColor.RED : NamedTextColor.GRAY));
        if (t.has("desc")) out.add(ln(t.get("desc").getAsString(), NamedTextColor.DARK_GRAY).decoration(TextDecoration.ITALIC, true));
        return out;
    }

    private String enchLine(JsonObject e) {
        String k = e.get("k").getAsString();
        double v = e.get("v").getAsDouble();
        JsonObject def = enchants.has(k) ? enchants.getAsJsonObject(k) : null;
        String name = def != null && def.has("name") ? def.get("name").getAsString() : statName(k);
        String el = e.has("el") ? " (" + plugin.data().get("elements.ELEMENTS." + e.get("el").getAsString() + ".name").getAsString() + ")" : "";
        return name + el + " " + fmt(k, v);
    }

    // ── 장비 스탯 ───────────────────────────────────────────────────

    /** 장비 하나의 스탯 보정 (웹 itemMods): 템플릿 스탯 × 희귀도 × (1 + 강화 6%) + 강화옵션 · 마법부여 (+ 특수효과 스탯형은 export 뒤) */
    public List<Formulas.Mod> mods(Inst i) {
        List<Formulas.Mod> out = new ArrayList<>();
        JsonObject t = tpl(i.tpl());
        if (t == null || !t.has("slot") || !working(i)) return out;
        double mul = rarity.getAsJsonObject(i.rarity()).get("stat").getAsDouble() * (1 + 0.06 * i.enh());
        if (t.has("stats")) for (var e : t.getAsJsonObject("stats").entrySet()) out.add(Formulas.Mod.add(e.getKey(), e.getValue().getAsDouble() * mul));
        for (JsonElement e : i.opt()) enchMods(e.getAsJsonObject(), out);
        for (JsonElement e : i.ench()) enchMods(e.getAsJsonObject(), out);
        for (JsonElement e : i.sp()) linearMods(specials.getAsJsonObject(e.getAsJsonObject().get("id").getAsString()), e.getAsJsonObject().get("v").getAsDouble(), null, out);
        return out;
    }

    private void enchMods(JsonObject e, List<Formulas.Mod> out) {
        String k = e.get("k").getAsString();
        double v = e.get("v").getAsDouble();
        String el = e.has("el") ? e.get("el").getAsString() : null;
        JsonObject def = enchants.has(k) ? enchants.getAsJsonObject(k) : null;
        if (def != null && def.has("mods")) linearMods(def, v, el, out);
        else if (el != null) out.add(Formulas.Mod.elDef(el, v));
        else switch (k) {   // export 전 대체 (web ENCHANTS mods 와 같은 뜻)
            case "def" -> { out.add(Formulas.Mod.add("pdef", v)); out.add(Formulas.Mod.add("mdef", v)); }
            case "speed" -> out.add(Formulas.Mod.add("moveSpeed", v));
            case "vamp" -> out.add(Formulas.Mod.add("lifesteal", v));
            default -> out.add(Formulas.Mod.add(k, v));   // atk · ap · hp · crit
        }
    }

    /** export 된 선형 mods 스펙 { k, op, c, v, el? } — 값 = c × (v ? 인자 : 1) */
    private static void linearMods(JsonObject def, double v, String el, List<Formulas.Mod> out) {
        if (def == null || !def.has("mods")) return;
        for (JsonElement m : def.getAsJsonArray("mods")) {
            JsonObject mo = m.getAsJsonObject();
            double x = mo.get("c").getAsDouble() * (mo.has("v") && mo.get("v").getAsBoolean() ? v : 1);
            boolean mul = "mul".equals(str(mo, "op"));
            String k = mo.get("k").getAsString();
            String e = mo.has("el") ? mo.get("el").getAsString() : el;
            out.add(new Formulas.Mod(k, mul ? 0 : x, mul ? x : 0, "elDef".equals(k) ? e : null));
        }
    }

    /** 세트 효과: 같은 세트 n 개 이상 입으면 그 단계 mods */
    public void setMods(List<Inst> worn, List<Formulas.Mod> out) {
        java.util.Map<String, Integer> n = new java.util.HashMap<>();
        for (Inst i : worn) {
            JsonObject t = tpl(i.tpl());
            if (t != null && t.has("set") && working(i)) n.merge(t.get("set").getAsString(), 1, Integer::sum);
        }
        for (var e : n.entrySet()) {
            JsonObject set = sets.getAsJsonObject(e.getKey());
            if (set == null) continue;
            for (JsonElement tier : set.getAsJsonArray("tiers")) {
                JsonObject to = tier.getAsJsonObject();
                if (e.getValue() < to.get("n").getAsInt() || !to.has("mods")) continue;
                for (JsonElement m : to.getAsJsonArray("mods")) out.add(Formulas.Mod.of(m.getAsJsonObject()));
            }
        }
    }

    /** 내구도 깎기 (타격 · 피격). 바뀌면 다시 그림. 0 이 되면 true */
    public boolean wear(ItemStack it, int amount) {
        Inst i = read(it);
        if (i == null || i.durMax() == 0 || i.dur() == 0) return false;
        int d = Math.max(0, i.dur() - amount);
        write(it, new Inst(i.uid(), i.tpl(), i.rarity(), i.enh(), i.sp(), d, i.durMax(), i.opt(), i.ench(), i.name()));
        return d == 0;
    }

    // ── 드롭 (§20-2 · §6-3 운) ──────────────────────────────────────

    public String rollRarity(double bonus) {
        int i = 0;
        while (i < rarities.size() - 1 && rng.getAsDouble() < rarity.getAsJsonObject(rarities.get(i)).get("up").getAsDouble() + bonus) i++;
        return rarities.get(i);
    }

    /** 드롭 테이블 굴리기 (웹 rollDrops) */
    public List<ItemStack> rollDrops(JsonArray table, int gradeIdx, double luck) {
        List<ItemStack> out = new ArrayList<>();
        double extra = luck / 200;
        List<String> books = new ArrayList<>();
        for (String id : items.keySet()) if ("book".equals(str(items.getAsJsonObject(id), "kind"))) books.add(id);
        for (JsonElement de : table) {
            JsonObject d = de.getAsJsonObject();
            if (rng.getAsDouble() >= Math.min(1, d.get("chance").getAsDouble() * (1 + 0.5 * gradeIdx))) continue;
            String id = d.get("item").getAsString();
            if (id.equals("book_random")) id = books.get((int) Math.floor(rng.getAsDouble() * books.size()));
            JsonObject t = tpl(id);
            if (t == null) continue;
            int a = 1, b = 1;
            if (d.has("qty")) { a = d.getAsJsonArray("qty").get(0).getAsInt(); b = d.getAsJsonArray("qty").get(1).getAsInt(); }
            int qty = a + (int) Math.floor(rng.getAsDouble() * (b - a + 1)) + (int) Math.floor(extra) + (rng.getAsDouble() < extra % 1 ? 1 : 0);
            if (stackable(t)) out.add(create(id, null, qty));
            else for (int k = 0; k < qty; k++) out.add(create(id, rollRarity(luck * 0.0005 + gradeIdx * 0.04), 1));
        }
        return out;
    }

    /**
     * 사용자 지시 "상급 이상의 몬스터 처치시 상급 방어구": 상급(등급 순번 3) 이상 몹은 몹 레벨보다 **한 단계 위 재료**의 방어구를
     * (15% × (등급 − 2)) 확률로 하나 더 떨굼. 희귀도도 등급만큼 더 잘 오름.
     */
    public ItemStack bonusArmor(int mobLv, int gradeIdx, double luck) {
        if (gradeIdx < 3 || rng.getAsDouble() >= 0.15 * (gradeIdx - 2)) return null;
        int want = Math.min(5, tierOf(mobLv) + 1);
        List<String> pool = new ArrayList<>();
        for (String id : items.keySet()) {
            JsonObject t = items.getAsJsonObject(id);
            if (!"armor".equals(str(t, "kind")) || baseMaterial(t) == Material.PAPER) continue;
            if (tierOf(t.get("lv").getAsInt()) == want) pool.add(id);
        }
        if (pool.isEmpty()) return null;
        String id = pool.get((int) Math.floor(rng.getAsDouble() * pool.size()));
        return create(id, rollRarity(luck * 0.0005 + gradeIdx * 0.04), 1);
    }

    public static String json(Object o) { return GSON.toJson(o); }
}
