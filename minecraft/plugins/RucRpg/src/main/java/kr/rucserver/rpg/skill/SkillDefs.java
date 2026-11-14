package kr.rucserver.rpg.skill;

import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import kr.rucserver.rpg.Data;
import kr.rucserver.rpg.engine.Formulas;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;

/** 스킬 정의 (web shared/data/skills.ts SKILLS) + skillNums · canLearn · autoLearn (shared/progress.ts) */
public final class SkillDefs {

    /** 등급 · 레벨을 반영한 수치 (progress.ts skillNums) */
    public record Nums(double power, double gradeMul, int lv, double fx, double range, double radius,
                       double stamina, double mana, double energy, double cooldownMs) {}

    private final JsonObject skills, grades, apprentice;
    private final double cdrCap;

    public SkillDefs(Data d, Formulas f) {
        skills = d.file("skills").getAsJsonObject("SKILLS");
        apprentice = d.file("skills").getAsJsonObject("APPRENTICE_SLOTS");
        grades = d.file("progress").getAsJsonObject("GRADE");
        cdrCap = f.cap("cdr");
    }

    public JsonObject get(String id) { return id == null ? null : skills.getAsJsonObject(id); }
    public Iterable<String> ids() { return skills.keySet(); }
    public JsonObject apprenticeSlots() { return apprentice; }

    public static String str(JsonObject o, String k) { return o.has(k) && !o.get(k).isJsonNull() ? o.get(k).getAsString() : null; }
    public static double num(JsonObject o, String k, double d) { return o.has(k) && !o.get(k).isJsonNull() ? o.get(k).getAsDouble() : d; }
    public static boolean has(JsonObject o, String k) { return o.has(k) && !o.get(k).isJsonNull(); }
    public static boolean bool(JsonObject o, String k) { return o.has(k) && o.get(k).getAsBoolean(); }

    public Nums nums(JsonObject sk, String grade, int lv, double cdr) {
        JsonObject g = grades.getAsJsonObject(grade == null ? "low" : grade);
        double gp = g.get("power").getAsDouble(), gc = g.get("cost").getAsDouble();
        JsonObject cost = sk.getAsJsonObject("cost");
        return new Nums(gp * (1 + 0.04 * (lv - 1)), gp, lv, g.get("fx").getAsDouble(),
                sk.get("range").getAsDouble() * g.get("range").getAsDouble(),
                num(sk, "radius", 0) * g.get("range").getAsDouble(),
                num(cost, "stamina", 0), costOf(num(cost, "mana", 0), gc), costOf(num(cost, "energy", 0), gc),
                sk.get("cooldownMs").getAsDouble() * (1 - 0.03 * Math.floor(lv / 5.0)) * (1 - Math.min(cdr, cdrCap)));
    }

    private static double costOf(double v, double mul) { return v != 0 ? Formulas.jsRound(v * mul) : 0; }

    private static boolean jobHas(JsonObject sk, String id) {
        if (id == null) return false;
        for (JsonElement e : sk.getAsJsonArray("job")) if (e.getAsString().equals(id)) return true;
        return false;
    }

    public static boolean canLearn(JsonObject sk, String line, String job) {
        return !bool(sk, "hidden") && !"A".equals(sk.get("slot").getAsString())
                && (jobHas(sk, "all") || jobHas(sk, line) || jobHas(sk, job));
    }

    public static boolean forJob(JsonObject sk, String job) { return jobHas(sk, job); }

    /** 레벨 · 전직 상태로 자동 습득할 스킬 id (아직 안 배운 것) */
    public List<String> autoLearn(String line, String job, int level, java.util.Set<String> known) {
        List<String> out = new ArrayList<>();
        for (Map.Entry<String, JsonElement> e : skills.entrySet()) {
            JsonObject sk = e.getValue().getAsJsonObject();
            if (!sk.has("learnLv") || sk.get("learnLv").getAsInt() > level || bool(sk, "hidden") || "A".equals(sk.get("slot").getAsString())) continue;
            if (known.contains(e.getKey())) continue;
            if (jobHas(sk, "all") || jobHas(sk, line) || jobHas(sk, job)) out.add(e.getKey());
        }
        return out;
    }
}
