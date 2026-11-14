package kr.rucserver.rpg;

import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import kr.rucserver.rpg.engine.Formulas;
import kr.rucserver.rpg.engine.Stats;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;

import java.io.InputStreamReader;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.fail;

/** 웹 RPG(TS) 공식의 기준값(golden.json, export-mc.ts 가 만듦)과 Java 이식이 같은지 */
class GoldenTest {

    static JsonObject golden;
    static Formulas f;

    @BeforeAll
    static void load() throws Exception {
        golden = JsonParser.parseReader(new InputStreamReader(GoldenTest.class.getResourceAsStream("/golden.json"), StandardCharsets.UTF_8)).getAsJsonObject();
        f = new Formulas(Data.load(GoldenTest.class.getClassLoader()));
    }

    static Iterable<JsonObject> cases(String k) {
        List<JsonObject> out = new ArrayList<>();
        for (JsonElement e : golden.getAsJsonArray(k)) out.add(e.getAsJsonObject());
        if (out.isEmpty()) fail("golden 비어 있음: " + k);
        return out;
    }

    static Stats stats(JsonObject o) {
        Stats s = new Stats();
        for (Map.Entry<String, JsonElement> e : o.entrySet()) {
            if (e.getKey().equals("elDef")) for (Map.Entry<String, JsonElement> d : e.getValue().getAsJsonObject().entrySet()) s.elDef.put(d.getKey(), d.getValue().getAsDouble());
            else s.set(e.getKey(), e.getValue().getAsDouble());
        }
        return s;
    }

    static void same(JsonObject want, Stats got, String ctx) {
        for (Map.Entry<String, JsonElement> e : want.entrySet()) {
            if (e.getKey().equals("elDef")) {
                for (Map.Entry<String, JsonElement> d : e.getValue().getAsJsonObject().entrySet())
                    assertEquals(d.getValue().getAsDouble(), got.elDef(d.getKey()), 1e-9, ctx + " elDef." + d.getKey());
            } else assertEquals(e.getValue().getAsDouble(), got.get(e.getKey()), 1e-9, ctx + " " + e.getKey());
        }
        assertEquals(want.has("elDef") ? want.size() - 1 : want.size(), got.v.size(), ctx + " 스탯 개수");
    }

    @Test
    void baseStatsAndExp() {
        for (JsonObject c : cases("baseStats")) same(c.getAsJsonObject("result"), f.baseStats(c.get("lv").getAsInt()), "baseStats lv" + c.get("lv"));
        for (JsonObject c : cases("expToNext")) assertEquals(c.get("result").getAsLong(), Formulas.expToNext(c.get("lv").getAsInt()), "exp " + c.get("lv"));
    }

    @Test
    void finalStats() {
        for (JsonObject c : cases("finalStats")) {
            List<Formulas.Mod> mods = new ArrayList<>();
            for (JsonElement m : c.getAsJsonArray("mods")) mods.add(Formulas.Mod.of(m.getAsJsonObject()));
            same(c.getAsJsonObject("result"), f.finalStats(stats(c.getAsJsonObject("base")), mods), c.get("name").getAsString());
        }
    }

    @Test
    void damage() {
        for (JsonObject c : cases("computeDamage")) {
            JsonObject h = c.getAsJsonObject("hit");
            Formulas.Hit hit = new Formulas.Hit(h.get("base").getAsDouble(), h.get("atkRatio").getAsDouble(), h.get("apRatio").getAsDouble(),
                    h.get("cat").getAsString(), str(h, "el"), opt(h, "gradeMul", 1), (int) opt(h, "skillLv", 1),
                    h.has("skill") && h.get("skill").getAsBoolean(), h.has("melee") && h.get("melee").getAsBoolean(), opt(h, "power", 0));
            double got = f.computeDamage(stats(c.getAsJsonObject("attacker")), stats(c.getAsJsonObject("defender")), hit, str(c, "defElement"), c.get("crit").getAsBoolean());
            assertEquals(c.get("result").getAsDouble(), got, 0, c.get("name").getAsString());
        }
    }

    @Test
    void smallFormulas() {
        for (JsonObject c : cases("mitigation")) assertEquals(c.get("result").getAsDouble(), Formulas.mitigation(c.get("def").getAsDouble(), c.get("pen").getAsDouble()), 1e-12);
        for (JsonObject c : cases("elementMul"))
            for (JsonElement e : c.getAsJsonArray("against")) {
                JsonObject o = e.getAsJsonObject();
                assertEquals(o.get("result").getAsDouble(), f.elementMul(c.get("atk").getAsString(), o.get("def").getAsString()), 0, c.get("atk") + "→" + o.get("def"));
            }
        for (JsonObject c : cases("castMs")) assertEquals(c.get("result").getAsDouble(), f.castMs(c.get("baseMs").getAsDouble(), c.get("atkSpeed").getAsDouble()), 1e-9);
        for (JsonObject c : cases("healAmount"))
            assertEquals(c.get("result").getAsDouble(), Formulas.healAmount(c.get("base").getAsDouble(), stats(c.getAsJsonObject("giver")), stats(c.getAsJsonObject("taker"))), 1e-9);
        for (JsonObject c : cases("mentalResist")) assertEquals(c.get("result").getAsDouble(), Formulas.mentalResist(c.get("spirit").getAsDouble()), 1e-12);
        for (JsonObject c : cases("needMastery")) assertEquals(c.get("result").getAsLong(), Formulas.needMastery(c.get("lv").getAsInt()));
        for (JsonObject c : cases("startLevel")) assertEquals(c.get("result").getAsInt(), Formulas.startLevel(c.get("pot").getAsInt(), c.get("playerLv").getAsInt()));
    }

    static String str(JsonObject o, String k) { return o.has(k) && !o.get(k).isJsonNull() ? o.get(k).getAsString() : null; }
    static double opt(JsonObject o, String k, double d) { return o.has(k) && !o.get(k).isJsonNull() ? o.get(k).getAsDouble() : d; }
}
