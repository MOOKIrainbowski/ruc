package kr.rucserver.rpg.engine;

import com.google.gson.JsonArray;
import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import kr.rucserver.rpg.Data;

import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * 웹 RPG 공식(shared/character.ts · combat.ts · progress.ts · data/jobs.ts)을 Java 로 옮긴 것.
 * 같은 입력 → 같은 결과를 golden.json 으로 확인(GoldenTest). 공식을 고치면 웹 쪽을 먼저 고치고 export 를 다시 돌릴 것.
 */
public final class Formulas {

    /** 스탯 보정 (TS Mod): 최종 = (기본 + Σadd) × (1 + Σmul). k = "elDef" 면 el 속성 방어 */
    public record Mod(String k, double add, double mul, String el) {
        public static Mod add(String k, double a) { return new Mod(k, a, 0, null); }
        public static Mod mul(String k, double m) { return new Mod(k, 0, m, null); }
        public static Mod elDef(String el, double a) { return new Mod("elDef", a, 0, el); }

        public static Mod of(JsonObject o) {
            return new Mod(o.get("k").getAsString(), num(o, "add"), num(o, "mul"), o.has("el") ? o.get("el").getAsString() : null);
        }
    }

    /** 피해 한 번의 내용 (TS Hit) */
    public record Hit(double base, double atkRatio, double apRatio, String cat, String el,
                      double gradeMul, int skillLv, boolean skill, boolean melee, double power) {}

    private final JsonObject baseStats, growth, secondary, caps, combat, staminaT, elements, lines, jobs, statGrade, awaken;

    public Formulas(Data d) {
        JsonObject st = d.file("stats");
        baseStats = st.getAsJsonObject("BASE_STATS");
        growth = st.getAsJsonObject("LEVEL_GROWTH");
        secondary = st.getAsJsonObject("SECONDARY");
        caps = st.getAsJsonObject("CAPS");
        combat = st.getAsJsonObject("COMBAT");
        staminaT = st.getAsJsonObject("STAMINA");
        elements = d.file("elements").getAsJsonObject("ELEMENTS");
        JsonObject j = d.file("jobs");
        lines = j.getAsJsonObject("LINES");
        jobs = j.getAsJsonObject("JOBS");
        statGrade = j.getAsJsonObject("STAT_GRADE");
        awaken = j.getAsJsonObject("AWAKEN");
    }

    static double num(JsonObject o, String k) {
        JsonElement e = o.get(k);
        return e == null || e.isJsonNull() ? 0 : e.getAsDouble();
    }

    public double cap(String k) { return caps.get(k).getAsDouble(); }
    public double combat(String k) { return combat.get(k).getAsDouble(); }
    public double stamina(String k) { return staminaT.get(k).getAsDouble(); }
    public int maxLevel() { return (int) combat("maxLevel"); }

    // ── 레벨 · 기본 스탯 ──────────────────────────────────────────────

    /** §7 필요 경험치 */
    public static long expToNext(int level) { return (long) Math.floor(100 * Math.pow(level, 1.6)); }

    /** 견습 기본값 + 레벨 성장 (character.ts baseStats) — 16개 기본 스탯만 */
    public Stats baseStats(int level) {
        Stats s = new Stats();
        for (Map.Entry<String, JsonElement> e : baseStats.entrySet()) s.set(e.getKey(), e.getValue().getAsDouble());
        for (Map.Entry<String, JsonElement> e : growth.entrySet())
            s.set(e.getKey(), s.get(e.getKey()) + e.getValue().getAsDouble() * (level - 1));
        return s;
    }

    /** 레벨 · 계열 · 잠재력 · 직업 종류(마법형 · 혼합형) · 각성을 반영한 기본 스탯 (jobs.ts jobStats) */
    public Stats jobStats(int level, String line, int potPhys, int potMag, String job, boolean awake) {
        Stats s = baseStats(level);
        if (line != null) {
            String kind = job != null && jobs.has(job) && jobs.getAsJsonObject(job).has("kind") ? jobs.getAsJsonObject(job).get("kind").getAsString() : null;
            JsonObject g0 = lines.getAsJsonObject(line).getAsJsonObject("g");
            Map<String, String> g = new HashMap<>();
            for (Map.Entry<String, JsonElement> e : g0.entrySet()) g.put(e.getKey(), e.getValue().getAsString());
            if ("magic".equals(kind)) { String a = g.get("atk"); g.put("atk", g.get("ap")); g.put("ap", a); }
            else if ("hybrid".equals(kind)) g.put("ap", g.get("atk"));
            for (String[] p : new String[][]{{"hp", "hp"}, {"stamina", "stamina"}, {"pdef", "def"}, {"mdef", "def"}, {"atk", "atk"},
                    {"ap", "ap"}, {"atkSpeed", "atkSpeed"}, {"moveSpeed", "moveSpeed"}, {"spirit", "spirit"}})
                s.set(p[0], s.get(p[0]) * statGrade.get(g.get(p[1])).getAsDouble());
            if (awake) for (String k : List.of("hp", "atk", "ap", "pdef", "mdef")) s.set(k, s.get(k) * (1 + awaken.get("stat").getAsDouble()));
        }
        s.set("potentialPhys", potPhys);
        s.set("potentialMag", potMag);
        return s;
    }

    /** 기본 + 보조 스탯 + 속성 방어 + 보정 → 최종 (combat.ts finalStats) */
    public Stats finalStats(Stats base, List<Mod> mods) {
        Stats s = base.copy();
        for (Map.Entry<String, JsonElement> e : secondary.entrySet()) s.set(e.getKey(), e.getValue().getAsDouble());
        for (String el : elements.keySet()) s.elDef.put(el, 0.0);
        Map<String, double[]> acc = new java.util.LinkedHashMap<>();   // 키 → [add, mul], 처음 나온 순서대로 (TS Map 과 같은 순서)
        for (Mod m : mods) {
            String key = "elDef".equals(m.k()) ? "el:" + m.el() : m.k();
            double[] a = acc.computeIfAbsent(key, k -> new double[2]);
            a[0] += m.add();
            a[1] += m.mul();
        }
        for (Map.Entry<String, double[]> e : acc.entrySet()) {
            String key = e.getKey();
            double f = 1 + e.getValue()[1];
            if (key.startsWith("el:")) {
                String el = key.substring(3);
                s.elDef.put(el, Math.max(0, (s.elDef.getOrDefault(el, 0.0) + e.getValue()[0]) * f));
            } else s.set(key, Math.max(0, (s.get(key) + e.getValue()[0]) * f));
        }
        for (String k : List.of("atkSpeed", "moveSpeed", "cdr", "tenacity", "luck")) s.set(k, Math.min(s.get(k), cap(k)));
        return s;
    }

    /** 주 속성 패시브 보정 (elements.json ELEMENTS[el].mods) */
    public List<Mod> elementMods(String el) {
        List<Mod> out = new java.util.ArrayList<>();
        JsonObject e = elements.getAsJsonObject(el);
        if (e != null && e.has("mods")) for (JsonElement m : e.getAsJsonArray("mods")) out.add(Mod.of(m.getAsJsonObject()));
        return out;
    }

    // ── 전투 ─────────────────────────────────────────────────────────

    public static double mitigation(double def, double pen) { return 100 / (100 + Math.max(0, def * (1 - pen))); }

    public double elementMul(String atk, String def) {
        if (atk == null || def == null) return 1;
        JsonObject a = elements.getAsJsonObject(atk);
        if (contains(a.getAsJsonArray("strong"), def)) return 1.25;
        if (contains(a.getAsJsonArray("weak"), def)) return 0.8;
        return 1;
    }

    private static boolean contains(JsonArray arr, String s) {
        if (arr == null) return false;
        for (JsonElement e : arr) if (e.getAsString().equals(s)) return true;
        return false;
    }

    public double castMs(double baseMs, double atkSpeed) { return baseMs * 100 / Math.min(Math.max(atkSpeed, 1), cap("atkSpeed")); }

    public static double cooldownMs(double baseMs, Stats s) { return baseMs * (1 - s.get("cdr")); }

    /** §13-1 피해 공식 (combat.ts computeDamage). defEl = 맞는 쪽 속성 */
    public double computeDamage(Stats a, Stats d, Hit h, String defEl, boolean crit) {
        double raw = (h.base() + a.get("atk") * h.atkRatio() + a.get("ap") * h.apRatio())
                * h.gradeMul()
                * (1 + 0.04 * (h.skillLv() - 1))
                * (1 + h.power())
                * elementMul(h.el(), defEl)
                * (crit ? a.get("critDmg") : 1)
                * (1 + a.get("dmgUp") + (h.skill() ? a.get("skillDmg") : 0) + d.get("dmgTakenUp"))
                * (1 - Math.min(cap("dmgDown"), d.get("dmgDown") + (h.melee() ? d.get("meleeDown") : 0)));
        double phys = "physical".equals(h.cat()) ? 1 : "hybrid".equals(h.cat()) ? 0.5 : 0;
        double def = phys * mitigation(d.get("pdef"), a.get("penPhys")) + (1 - phys) * mitigation(d.get("mdef"), a.get("penMag"));
        double elDef = h.el() != null ? 100 / (100 + Math.max(0, d.elDef(h.el()) * (1 - a.get("elPen")))) : 1;
        return Math.max(1, jsRound(raw * def * elDef));
    }

    /** JS Math.round (0.5 는 +∞ 쪽) — Java Math.round 와 음수에서 다름 */
    public static long jsRound(double x) { return (long) Math.floor(x + 0.5); }

    public static double healAmount(double base, Stats giver, Stats taker) {
        return base * (1 + giver.get("spirit") / 200) * (1 + giver.get("healPower")) * (1 + taker.get("spirit") / 200) * (1 + taker.get("healTaken"));
    }

    public static double mentalResist(double spirit) { return spirit / (spirit + 200); }

    public double hpRegen(Stats s, boolean inCombat) {
        return s.get("regen") * combat("regenPerPoint") * (inCombat ? combat("regenInCombatMul") : 1);
    }

    public double resRegen(double max, boolean inCombat) { return max * (inCombat ? combat("resPerSec") : combat("resPerSecIdle")); }

    // ── 숙련도 (progress.ts) ─────────────────────────────────────────

    public static long needMastery(int lv) { return (long) Math.floor(30 * Math.pow(lv, 1.5)); }

    public static int startLevel(int pot, int playerLv) { return Math.max(1, Math.min(playerLv, 1 + pot / 40)); }
}
