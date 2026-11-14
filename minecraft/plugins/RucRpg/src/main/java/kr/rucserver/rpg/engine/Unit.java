package kr.rucserver.rpg.engine;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * 전투 단위 (웹 RPG server/combat.ts Unit) — 플레이어 · 몹 · 소환수 공통.
 * 위치 x · y 는 **px**(1블록 = 16px, 계획서 R3) — 마크 쪽 틱이 매번 위치에서 다시 적음. 사거리 · 범위 수치를 웹과 그대로 쓰기 위해.
 */
public abstract class Unit {

    /** 효과 하나 (TS Effect) */
    public static final class Effect {
        public final String id;
        public final int src;
        public int stacks = 1;
        public double v;
        public long until, dur, next;
        public double dot;

        public Effect(String id, int src, double v, long until, long dur, long next, double dot) {
            this.id = id; this.src = src; this.v = v; this.until = until; this.dur = dur; this.next = next; this.dot = dot;
        }
    }

    public record Dr(int n, long until) {}

    private static int nextId = 1;
    public final int id = nextId++;
    /** "p" 플레이어 · "m" 몹 */
    public final String kind;
    public String name = "";
    public String el;
    public int lv = 1;
    public double x, y;
    /** 피격 반지름 px */
    public double r = 8;
    public Stats base;
    public Stats st;
    public double hp, mp, en;
    public long combatAt = Long.MIN_VALUE / 2;
    public boolean dead;
    /** 몹 귀환 중 무적 */
    public boolean evade;
    /** 구르기 무적 · 이동 중 (도트 · 사격 판정) */
    public boolean iframes, moving;
    public boolean blockMove, blockAtk, blockSkill;
    public final List<Effect> fx = new ArrayList<>();
    public final Map<String, Dr> dr = new HashMap<>();
    public long ccImmune;
    /** 속성 패시브(플레이어) · 장비 보정 */
    public final List<Formulas.Mod> innate = new ArrayList<>();
    public final List<Formulas.Mod> gear = new ArrayList<>();
    /** 세부 직업 (패시브 판정) */
    public String job;
    /** 기사도 연속 타격 · 권사 연환 */
    public int chivTgt, chivN;
    public final Map<String, Long> icd = new HashMap<>();
    /** 소환수면 주인 id */
    public int petOf;
    /** GM 무적 */
    public boolean gmInvuln;

    protected Unit(String kind) { this.kind = kind; }

    public boolean isPlayer() { return "p".equals(kind); }

    public boolean inCombat(long now, Formulas f) { return now - combatAt < f.combat("outOfCombatMs"); }

    public boolean has(String id) {
        for (Effect e : fx) if (e.id.equals(id)) return true;
        return false;
    }

    public Effect find(String id) {
        for (Effect e : fx) if (e.id.equals(id)) return e;
        return null;
    }

    /** 기본 스탯 · 속성 패시브 · 장비 · 효과 → 최종 스탯과 행동 제한 (combat.ts recalc). 자원은 새 최대치로 깎음 */
    public void recalc(Formulas f, EffectDefs defs) {
        List<Formulas.Mod> mods = new ArrayList<>(innate);
        mods.addAll(gear);
        boolean bm = false, ba = false, bs = false;
        if (defs != null) for (Effect e : fx) {
            EffectDefs.Def d = defs.get(e.id);
            if (d == null) continue;
            defs.mods(e.id, e.v, e.stacks, mods);
            bm |= d.blockMove();
            ba |= d.blockAtk();
            bs |= d.blockSkill();
        }
        st = f.finalStats(base, mods);
        blockMove = bm || dead;
        blockAtk = ba;
        blockSkill = bs;
        hp = Math.min(hp, st.get("hp"));
        mp = Math.min(mp, st.get("mana"));
        en = Math.min(en, st.get("energy"));
        onRecalc();
    }

    /** 최종 스탯이 바뀐 뒤 (플레이어 = 이동 속도 · 스태미나 최대치 반영) */
    protected void onRecalc() {}

    /** 자연 회복 (combat.ts regen). dt 초 */
    public void regen(Formulas f, long now, double dt) {
        if (dead) return;
        boolean ic = inCombat(now, f);
        hp = Math.min(st.get("hp"), hp + f.hpRegen(st, ic) * dt);
        mp = Math.min(st.get("mana"), mp + f.resRegen(st.get("mana"), ic) * dt);
        en = Math.min(st.get("energy"), en + f.resRegen(st.get("energy"), ic) * dt);
    }

    public double shield() {
        double s = 0;
        for (Effect e : fx) if (e.id.equals("shield")) s += e.v;
        return s;
    }
}
