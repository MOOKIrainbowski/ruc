package kr.rucserver.rpg.engine;

import java.util.LinkedHashMap;
import java.util.Map;

/**
 * 스탯 묶음 (웹 RPG Stats · FullStats). 키 이름은 TS 와 같음(hp · atk · pdef · crit · elDef …) — data/*.json 과 golden 이 그대로 맞물리게.
 * 기본 스탯 16 + 보조 스탯 18 + 속성 방어 12.
 */
public final class Stats {

    public final Map<String, Double> v = new LinkedHashMap<>();
    public final Map<String, Double> elDef = new LinkedHashMap<>();

    public double get(String k) {
        Double d = v.get(k);
        if (d == null) throw new IllegalArgumentException("스탯 없음: " + k);
        return d;
    }

    public void set(String k, double x) { v.put(k, x); }

    public double elDef(String el) { return el == null ? 0 : elDef.getOrDefault(el, 0.0); }

    public Stats copy() {
        Stats s = new Stats();
        s.v.putAll(v);
        s.elDef.putAll(elDef);
        return s;
    }
}
