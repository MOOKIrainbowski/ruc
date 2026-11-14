package kr.rucserver.rpg.mob;

import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import kr.rucserver.rpg.Data;
import kr.rucserver.rpg.engine.Formulas;
import kr.rucserver.rpg.engine.Stats;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;

/** 몹 정의 (web shared/data/mobs.ts MOBS · GRADES) + mobStats · mobExp 이식 */
public final class MobDefs {

    private final JsonObject mobs, grades;
    private final List<String> gradeOrder = new ArrayList<>();
    private final Formulas f;

    public MobDefs(Data d, Formulas f) {
        this.f = f;
        JsonObject m = d.file("mobs");
        mobs = m.getAsJsonObject("MOBS");
        grades = m.getAsJsonObject("GRADES");
        for (Map.Entry<String, JsonElement> e : grades.entrySet()) gradeOrder.add(e.getKey());
    }

    public JsonObject def(String key) { return mobs.getAsJsonObject(key); }
    public boolean has(String key) { return mobs.has(key); }
    public Iterable<String> keys() { return mobs.keySet(); }
    public JsonObject grade(String g) { return grades.getAsJsonObject(g); }
    public boolean hasGrade(String g) { return grades.has(g); }
    /** 등급 순번 (일반 0 · 하급 1 · 중급 2 · 상급 3 · 소재앙 4 …) */
    public int gradeIndex(String g) { return gradeOrder.indexOf(g); }

    /** 레벨 · 등급을 반영한 기본 스탯 (mobs.ts mobStats) */
    public Stats mobStats(JsonObject def, int lv, String grade) {
        JsonObject g = grade(grade);
        Stats s = f.baseStats(1);   // BASE_STATS 그대로
        double atk = def.get("atk").getAsDouble() * (1 + 0.15 * (lv - 1)) * g.get("atk").getAsDouble();
        s.set("hp", Formulas.jsRound(def.get("hp").getAsDouble() * (1 + 0.3 * (lv - 1)) * g.get("hp").getAsDouble()));
        s.set("atk", atk);
        s.set("ap", atk);
        s.set("pdef", def.get("pdef").getAsDouble() + (lv - 1));
        s.set("mdef", def.get("mdef").getAsDouble() + (lv - 1));
        s.set("moveSpeed", def.get("speed").getAsDouble());
        s.set("spirit", 5 + lv);
        s.set("regen", 0);
        return s;
    }

    /** 처치 경험치: 몹이 나보다 10레벨 이상 낮으면 10% (mobs.ts mobExp) */
    public long mobExp(JsonObject def, int lv, String grade, int playerLv) {
        return Formulas.jsRound(def.get("exp").getAsDouble() * (1 + 0.25 * (lv - 1)) * grade(grade).get("exp").getAsDouble() * (playerLv - lv >= 10 ? 0.1 : 1));
    }
}
