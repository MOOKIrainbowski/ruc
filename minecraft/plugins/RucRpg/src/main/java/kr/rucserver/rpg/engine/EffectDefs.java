package kr.rucserver.rpg.engine;

import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import kr.rucserver.rpg.Data;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * 상태효과 정의 (web shared/data/effects.ts EFFECTS). mods 는 TS 에서 함수라 export 가
 * { k, op: add|mul, c, v: bool, s: bool, el? } (값 = c × v? × stacks?) 로 풀어 줌 (docs/12 export 추가 요청).
 */
public final class EffectDefs {

    public record ModSpec(String k, boolean mul, double c, boolean byV, boolean byStacks, String el) {}

    public record Def(String id, String name, boolean buff, String cat, boolean mental, int max, int tick, boolean keep,
                      boolean blockMove, boolean blockAtk, boolean blockSkill, List<ModSpec> mods, String icon, String color, String desc) {}

    private final Map<String, Def> defs = new HashMap<>();
    public final long foreverMs;

    public EffectDefs(Data d) {
        JsonObject f = d.file("effects");
        foreverMs = f.get("FOREVER_MS").getAsLong();
        for (Map.Entry<String, JsonElement> e : f.getAsJsonObject("EFFECTS").entrySet()) {
            JsonObject o = e.getValue().getAsJsonObject();
            JsonObject b = o.has("block") ? o.getAsJsonObject("block") : new JsonObject();
            List<ModSpec> mods = new ArrayList<>();
            if (o.has("mods")) for (JsonElement m : o.getAsJsonArray("mods")) {
                JsonObject mo = m.getAsJsonObject();
                mods.add(new ModSpec(mo.get("k").getAsString(), "mul".equals(mo.get("op").getAsString()), mo.get("c").getAsDouble(),
                        bool(mo, "v"), bool(mo, "s"), mo.has("el") ? mo.get("el").getAsString() : null));
            }
            defs.put(e.getKey(), new Def(e.getKey(), str(o, "name"), bool(o, "buff"), str(o, "cat"), bool(o, "mental"),
                    o.has("max") ? o.get("max").getAsInt() : 0, o.has("tick") ? o.get("tick").getAsInt() : 0, bool(o, "keep"),
                    bool(b, "move"), bool(b, "atk"), bool(b, "skill"), mods, str(o, "icon"), str(o, "color"), str(o, "desc")));
        }
    }

    private static boolean bool(JsonObject o, String k) { return o.has(k) && o.get(k).getAsBoolean(); }
    private static String str(JsonObject o, String k) { return o.has(k) ? o.get(k).getAsString() : null; }

    public Def get(String id) { return defs.get(id); }

    public boolean hasModsData() { return defs.values().stream().anyMatch(d -> !d.mods().isEmpty()); }

    /** 효과 하나 → 스탯 보정 (TS def.mods(v, stacks)) */
    public void mods(String id, double v, int stacks, List<Formulas.Mod> out) {
        Def d = defs.get(id);
        if (d == null) return;
        for (ModSpec m : d.mods()) {
            double x = m.c() * (m.byV() ? v : 1) * (m.byStacks() ? stacks : 1);
            out.add(new Formulas.Mod(m.k(), m.mul() ? 0 : x, m.mul() ? x : 0, m.el()));
        }
    }
}
