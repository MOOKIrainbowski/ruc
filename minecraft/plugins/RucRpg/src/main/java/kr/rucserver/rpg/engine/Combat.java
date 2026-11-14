package kr.rucserver.rpg.engine;

import com.google.gson.JsonArray;
import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import kr.rucserver.rpg.Data;

import java.util.ArrayList;
import java.util.List;
import java.util.Set;
import java.util.concurrent.ThreadLocalRandom;
import java.util.function.DoubleSupplier;

/**
 * 상태효과 엔진(§11-3) · 피해 적용(§13-1) · 회복 · 원소 반응(§12-3) · 직업 패시브(§9-3).
 * 웹 RPG RUC_RPG/server/src/combat.ts 를 줄 단위로 옮김 — 규칙을 바꾸려면 웹 쪽과 같이.
 * 시간은 World.now()(ms) — 테스트가 시간을 직접 넘길 수 있게.
 */
public final class Combat {

    public static final int H_CRIT = 1, H_DOT = 2, H_HEAL = 3, H_IMMUNE = 4, H_MISS = 5, H_RESIST = 6, H_COUNTER = 7;

    /** 효과 걸기 요청 (TS FxSpec). dot = 걸 때 피해 대비 비율(스킬) 또는 틱당 양 */
    public record FxSpec(String id, double ms, Double v, Double dot, Double chance) {
        public static FxSpec of(String id, double ms) { return new FxSpec(id, ms, null, null, null); }
        public static FxSpec of(String id, double ms, double v) { return new FxSpec(id, ms, v, null, null); }

        public static FxSpec of(JsonObject o) {
            return new FxSpec(o.get("id").getAsString(), o.get("ms").getAsDouble(), d(o, "v"), d(o, "dot"), d(o, "chance"));
        }

        static Double d(JsonObject o, String k) { return o.has(k) && !o.get(k).isJsonNull() ? o.get(k).getAsDouble() : null; }
    }

    /** 타격 한 번 (TS HitSpec) */
    public static final class HitSpec {
        public double base, atkRatio, apRatio, gradeMul = 1, power, threat = 1, crit, execute, mul = 1, reach;
        public String cat = "physical", el;
        public int skillLv = 1;
        public boolean skill, melee, proc, basic, ranged;
        public List<FxSpec> fx = List.of();

        public Formulas.Hit hit(double extraPower) {
            return new Formulas.Hit(base, atkRatio, apRatio, cat, el, gradeMul, skillLv, skill, melee, power + extraPower);
        }
    }

    private static final Set<String> MENTAL = Set.of("charm", "confuse", "fear", "sleep");

    private final Formulas f;
    private final EffectDefs defs;
    private final JsonObject proc;
    private final JsonArray reactions;
    /** hardCC 체감 배율 (stats COMBAT.drSteps: 1 → 0.5 → 0.25 → 면역) */
    private final double[] drSteps;
    private DoubleSupplier rng = () -> ThreadLocalRandom.current().nextDouble();

    public Combat(Data d, Formulas f, EffectDefs defs) {
        this.f = f;
        this.defs = defs;
        JsonObject el = d.file("elements");
        proc = el.getAsJsonObject("ELEMENT_PROC");
        reactions = el.getAsJsonArray("REACTIONS");
        JsonArray a = d.file("stats").getAsJsonObject("COMBAT").getAsJsonArray("drSteps");
        drSteps = new double[a.size()];
        for (int i = 0; i < drSteps.length; i++) drSteps[i] = a.get(i).getAsDouble();
    }

    /** 테스트용 난수 교체 */
    public void setRandom(DoubleSupplier r) { rng = r; }
    public double rand() { return rng.getAsDouble(); }
    public EffectDefs defs() { return defs; }
    public Formulas formulas() { return f; }

    public void recalc(Unit u) { u.recalc(f, defs); }

    // ── 효과 ────────────────────────────────────────────────────────

    public boolean addEffect(World w, Unit tgt, FxSpec spec, Unit src) {
        EffectDefs.Def def = defs.get(spec.id());
        if (def == null || tgt.dead) return false;
        double ms = spec.ms();
        double v = spec.v() == null ? 0 : spec.v();
        String id = spec.id();
        if (!def.buff()) {
            if (tgt.has("immune") || tgt.has("invuln") || tgt.evade) return false;
            boolean cc = "hardCC".equals(def.cat()) || "softCC".equals(def.cat());
            if (cc && tgt.has("unstoppable")) return false;
            if (def.mental() && rand() < Formulas.mentalResist(tgt.st.get("spirit"))) {
                w.show(src, tgt, 0, H_RESIST, null);
                return false;
            }
            if (src != null && "illusionist".equals(src.job) && MENTAL.contains(id)) ms *= 1.2;   // 환술사 「몽환」
            if (cc && !id.equals("airborne")) ms *= 1 - tgt.st.get("tenacity");
            if ("hardCC".equals(def.cat()) && tgt.isPlayer()) {
                if (w.now() < tgt.ccImmune) return false;
                Unit.Dr d = tgt.dr.get(id);
                int n = d != null && w.now() < d.until() ? d.n() + 1 : 0;
                double mul = drSteps[Math.min(n, drSteps.length - 1)];
                if (mul == 0) return false;
                tgt.dr.put(id, new Unit.Dr(n, w.now() + (long) f.combat("drWindowMs")));
                ms *= mul;
            }
            if (tgt.has("wet")) {   // 젖음: 얼음 둔화 2배 · 화상 지속 −50%
                if (id.equals("chill")) v *= 2;
                if (id.equals("burn")) ms *= 0.5;
            }
        }
        if (id.equals("immune")) tgt.fx.removeIf(e -> { EffectDefs.Def dd = defs.get(e.id); return dd == null || !dd.buff(); });
        if (id.equals("shield") && tgt.has("curse")) v *= 0.5;

        Unit.Effect cur = id.equals("shield") ? null : tgt.find(id);
        long now = w.now();
        if (cur != null) {
            cur.until = now + (long) ms;
            cur.dur = (long) ms;
            cur.v = v;
            if (spec.dot() != null) cur.dot = spec.dot();
            if (def.max() > 0) cur.stacks = Math.min(def.max(), cur.stacks + 1);
        } else {
            tgt.fx.add(new Unit.Effect(id, src == null ? 0 : src.id, v, now + (long) ms, (long) ms, now + def.tick(), spec.dot() == null ? 0 : spec.dot()));
        }
        w.fxChanged(tgt);
        if (id.equals("chill") && tgt.find("chill").stacks >= 3) {   // 얼음 둔화 3중첩 → 빙결
            removeEffect(w, tgt, "chill");
            addEffect(w, tgt, FxSpec.of("freeze", 1500), src);
        }
        recalc(tgt);
        // 성기사 「신성한 방벽」: 보호막을 받으면 보호막량 10% 만큼 주변(96px) 아군 회복
        if (id.equals("shield") && "paladin".equals(tgt.job) && v > 0)
            for (Unit a : w.around(tgt.x, tgt.y, 96, "p")) if (!w.hostile(tgt, a)) applyHeal(w, tgt, a, v * 0.1, true);
        return true;
    }

    public void removeEffect(World w, Unit u, String id) {
        Unit.Effect e = u.find(id);
        if (e == null) return;
        EffectDefs.Def d = defs.get(id);
        if (d != null && "hardCC".equals(d.cat()) && u.isPlayer()) u.ccImmune = w.now() + (long) f.combat("ccImmuneMs");
        u.fx.remove(e);
        w.fxChanged(u);
        recalc(u);
    }

    /** 효과 시간 경과: 도트 · 지속 회복 틱, 만료 */
    public void tickEffects(World w, Unit u) {
        for (int i = u.fx.size() - 1; i >= 0; i--) {
            if (i >= u.fx.size()) continue;
            Unit.Effect e = u.fx.get(i);
            EffectDefs.Def def = defs.get(e.id);
            if (def == null) continue;
            if (def.tick() > 0 && w.now() >= e.next && e.next <= e.until) {
                e.next += def.tick();
                if ("dot".equals(def.cat())) {
                    dotDamage(w, w.unit(e.src), u, e.dot * e.stacks * (e.id.equals("bleed") && u.moving ? 2 : 1));
                } else if ("hot".equals(def.cat())) {
                    if (e.id.equals("regen_hp")) { Unit s = w.unit(e.src); applyHeal(w, s != null ? s : u, u, e.dot, true); }
                    else { u.mp = Math.min(u.st.get("mana"), u.mp + e.dot); u.en = Math.min(u.st.get("energy"), u.en + e.dot); }
                }
                if (u.dead) return;
            }
            if (w.now() >= e.until && u.fx.contains(e)) {
                if ("hardCC".equals(def.cat()) && u.isPlayer()) u.ccImmune = w.now() + (long) f.combat("ccImmuneMs");
                u.fx.remove(e);
                w.fxChanged(u);
                recalc(u);
            }
        }
    }

    // ── 피해 ────────────────────────────────────────────────────────

    /** 보호막 먼저 (먼저 생긴 것부터) 깎고 남은 피해 */
    private double absorb(World w, Unit u, double dmg) {
        for (Unit.Effect e : u.fx) {
            if (!e.id.equals("shield") || dmg <= 0) continue;
            double a = Math.min(e.v, dmg);
            e.v -= a;
            dmg -= a;
            if (e.v <= 0) e.until = w.now();
        }
        return dmg;
    }

    private void loseHp(World w, Unit src, Unit tgt, double dmg) {
        if (tgt.isPlayer() && tgt.gmInvuln) return;
        if (dmg > 0 && tgt.has("stealth")) removeEffect(w, tgt, "stealth");
        tgt.hp -= absorb(w, tgt, dmg);
        tgt.combatAt = w.now();
        if (src != null) src.combatAt = w.now();
        if (tgt.has("sleep")) removeEffect(w, tgt, "sleep");
        if (tgt.hp <= 0 && !w.spare(src, tgt)) die(w, tgt, src);
    }

    public void die(World w, Unit u, Unit by) {
        if (u.dead) return;
        if (u.isPlayer() && u.has("feather")) {   // 부활 깃털: HP 30% · 1.5초 무적
            removeEffect(w, u, "feather");
            u.hp = Math.max(1, Formulas.jsRound(u.st.get("hp") * 0.3));
            addEffect(w, u, FxSpec.of("invuln", 1500), u);
            w.revived(u);
            return;
        }
        // 흑마법사 「영혼 수확」: 디버프 걸린 적 처치 → HP · 마나 5%
        if (by != null && "warlock".equals(by.job) && by != u && u.fx.stream().anyMatch(e -> { EffectDefs.Def d = defs.get(e.id); return d != null && !d.buff(); })) {
            applyHeal(w, by, by, by.st.get("hp") * 0.05, true);
            by.mp = Math.min(by.st.get("mana"), by.mp + by.st.get("mana") * 0.05);
        }
        u.dead = true;
        u.hp = 0;
        u.fx.removeIf(e -> { EffectDefs.Def d = defs.get(e.id); return d == null || !d.keep(); });   // 영약은 남음
        w.fxChanged(u);
        recalc(u);
        w.killed(u, by);
    }

    /** 피해 한 번. 반환 = 실제로 깎은 양(보호막 포함) */
    public double hit(World w, Unit src, Unit tgt, HitSpec h) {
        if (tgt.dead || src.dead) return 0;
        if (tgt.isPlayer() && tgt.gmInvuln) { w.show(src, tgt, 0, H_IMMUNE, null); return 0; }
        if (tgt.evade || tgt.iframes || tgt.has("invuln")) { w.show(src, tgt, 0, H_IMMUNE, null); return 0; }
        if (h.basic && src.has("blind") && rand() < 0.5) { w.show(src, tgt, 0, H_MISS, null); return 0; }
        boolean ambush = src != tgt && src.has("stealth");
        if (ambush) removeEffect(w, src, "stealth");
        boolean crit = (ambush && "nightwalker".equals(src.job)) || rand() < src.st.get("crit") + h.crit;
        JsonObject pr = h.proc && h.el != null && proc.has(h.el) ? proc.getAsJsonObject(h.el) : null;
        double extra = pr != null && pr.has("power") ? pr.get("power").getAsDouble() : 0;
        double dmg = f.computeDamage(src.st, tgt.st, h.hit(extra), tgt.el, crit);
        if (!"magical".equals(h.cat) && tgt.has("freeze")) {
            dmg = Formulas.jsRound(dmg * 1.3);
            removeEffect(w, tgt, "freeze");
        }
        if ("electric".equals(h.el) && tgt.has("wet")) dmg = Formulas.jsRound(dmg * 1.3);
        dmg = Math.max(1, Formulas.jsRound(dmg * h.mul * passiveMul(w, src, tgt, h)));
        if (h.melee && tgt.has("counter") && src != tgt) {   // 반격 태세
            w.show(src, tgt, 0, H_COUNTER, null);
            w.show(tgt, src, dmg, 0, null);
            w.damaged(tgt, src, dmg, 2, null);
            loseHp(w, tgt, src, dmg);
            addEffect(w, src, FxSpec.of("stun", 1000), tgt);
            return 0;
        }
        if (src.isPlayer() && h.el != null) dmg = react(w, src, tgt, h.el, dmg);
        dmg = guardianShare(w, src, tgt, dmg);
        w.show(src, tgt, dmg, crit ? H_CRIT : 0, h.el);
        w.damaged(src, tgt, dmg, h.threat, h);
        loseHp(w, src, tgt, dmg);
        double vamp = "magical".equals(h.cat) ? src.st.get("spellVamp") : src.st.get("lifesteal");
        if (vamp > 0) applyHeal(w, src, src, dmg * vamp, false);
        w.struck(src, tgt, dmg, h);
        if ("arcanist".equals(src.job) && h.skill) src.mp = Math.min(src.st.get("mana"), src.mp + src.st.get("mana") * 0.02);
        if (tgt.dead) return dmg;
        if (h.basic) {
            if ("spellblade".equals(src.job)) {   // 마검 공명
                HitSpec s = new HitSpec();
                s.apRatio = 0.3; s.cat = "magical"; s.el = src.el;
                hit(w, src, tgt, s);
            }
            if ("monk".equals(src.job) && ++src.chivN >= 4) {   // 연환
                src.chivN = 0;
                addEffect(w, tgt, FxSpec.of("airborne", 400), src);
            }
            if (tgt.dead) return dmg;
        }
        List<FxSpec> all = new ArrayList<>(h.fx);
        if (pr != null && pr.has("fx")) for (JsonElement e : pr.getAsJsonArray("fx")) all.add(FxSpec.of(e.getAsJsonObject()));
        for (FxSpec s : all) {
            if (s.chance() != null && rand() >= s.chance()) continue;
            addEffect(w, tgt, new FxSpec(s.id(), s.ms(), s.v(), s.dot() != null ? Math.max(1, dmg * s.dot()) : null, null), src);
        }
        if (pr != null && pr.has("knock")) {
            double k = pr.get("knock").getAsDouble();
            double dx = tgt.x - src.x, dy = tgt.y - src.y, len = Math.hypot(dx, dy);
            if (len == 0) len = 1;
            w.push(tgt, dx / len * k, dy / len * k);
        }
        if (h.melee && tgt.isPlayer() && "ice".equals(tgt.el)) addEffect(w, src, FxSpec.of("slow", 800, 0.2), tgt);
        return dmg;
    }

    /** 도트 틱 — 방어 무시, 도트 피해 증가만 */
    public void dotDamage(World w, Unit src, Unit tgt, double raw) {
        if (tgt.dead || tgt.evade || tgt.has("invuln")) return;
        double dmg = Math.max(1, Formulas.jsRound(raw * (1 + (src != null ? src.st.get("dotDmg") : 0))));
        w.show(src, tgt, dmg, H_DOT, null);
        if (src != null) w.damaged(src, tgt, dmg, 1, null);
        loseHp(w, src, tgt, dmg);
    }

    /** 치유. computed = 이미 healAmount 를 거친 값 */
    public void applyHeal(World w, Unit src, Unit tgt, double amount, boolean computed) {
        if (tgt.dead || amount <= 0) return;
        double touch = "priest".equals(src.job) && tgt.hp < tgt.st.get("hp") * 0.3 ? 1.3 : 1;   // 치유의 손길
        double v = Formulas.jsRound((computed ? amount : amount * (1 + tgt.st.get("healTaken"))) * touch);
        if (v <= 0) return;
        tgt.hp = Math.min(tgt.st.get("hp"), tgt.hp + v);
        w.show(src, tgt, v, H_HEAL, null);
    }

    public double healPerTick(double base, Unit src, Unit tgt) { return Formulas.healAmount(base, src.st, tgt.st); }

    // ── 직업 패시브 ─────────────────────────────────────────────────

    private double passiveMul(World w, Unit src, Unit tgt, HitSpec h) {
        double m = h.execute > 0 && tgt.hp <= tgt.st.get("hp") * h.execute ? 2 : 1;
        if (h.ranged && src.moving && !"archer".equals(src.job)) m *= 0.8;
        if (src.job == null) return m;
        switch (src.job) {
            case "battle_knight" -> {   // 기사도
                if (src.chivTgt == tgt.id) {
                    if (src.chivN >= 3) { m *= 1.3; src.chivN = 0; } else src.chivN++;
                } else { src.chivTgt = tgt.id; src.chivN = 1; }
            }
            case "gladiator" -> {   // 투기장의 함성
                int n = 0;
                for (Unit u : w.around(src.x, src.y, 160, "m")) if (w.hostile(src, u)) n++;
                for (Unit u : w.around(src.x, src.y, 160, "p")) if (w.hostile(src, u)) n++;
                if (n <= 1) m *= 1.15;
            }
            case "lancer" -> { if (h.reach > 0 && Math.hypot(tgt.x - src.x, tgt.y - src.y) - tgt.r >= h.reach * 0.7) m *= 1.2; }
            case "cleric" -> { if ("dark".equals(tgt.el)) m *= 1.25; }
            case "hunter" -> { if (tgt.has("mark")) m *= 1.1; }
            case "sniper" -> {
                Unit.Effect e = src.find("aim_focus");
                if (e != null) { m *= 1 + 0.1 * e.stacks; removeEffect(w, src, "aim_focus"); }
            }
            default -> {}
        }
        return m;
    }

    /** 수호의 맹세 */
    private double guardianShare(World w, Unit src, Unit tgt, double dmg) {
        if (!tgt.isPlayer() || tgt.petOf != 0 || dmg < 2) return dmg;
        Unit g = null;
        for (Unit u : w.around(tgt.x, tgt.y, 96, "p"))
            if (u != tgt && "guardian".equals(u.job) && !w.hostile(u, tgt) && u != src) { g = u; break; }
        if (g == null) return dmg;
        double part = Formulas.jsRound(dmg * 0.15);
        double taken = Math.max(1, Formulas.jsRound(part * 0.8));
        w.show(src, g, taken, H_DOT, null);
        loseHp(w, src, g, taken);
        return dmg - part;
    }

    /** 원소 반응 */
    private double react(World w, Unit src, Unit tgt, String el, double dmg) {
        JsonObject r = null;
        for (JsonElement e : reactions) {
            JsonObject o = e.getAsJsonObject();
            if (o.get("b").getAsString().equals(el) && tgt.has(o.get("a").getAsString())) { r = o; break; }
        }
        if (r == null) return dmg;
        double rm = "elementalist".equals(src.job) ? 1.25 : 1;
        String key = r.get("a").getAsString() + "+" + r.get("b").getAsString();
        List<Unit> others = new ArrayList<>();
        for (Unit u : w.around(tgt.x, tgt.y, 48, tgt.kind)) if (u != tgt && w.hostile(src, u)) others.add(u);
        switch (key) {
            case "wet+electric" -> {
                removeEffect(w, tgt, "wet");
                addEffect(w, tgt, FxSpec.of("shock", 300), src);
                for (Unit u : others) {
                    double d = Math.max(1, Formulas.jsRound(dmg * 0.5 * rm));
                    w.show(src, u, d, 0, "electric");
                    w.damaged(src, u, d, 1, null);
                    loseHp(w, src, u, d);
                    addEffect(w, u, FxSpec.of("shock", 300), src);
                }
            }
            case "wet+ice" -> {
                removeEffect(w, tgt, "wet");
                addEffect(w, tgt, FxSpec.of("freeze", 1500), src);
            }
            case "burn+wind" -> {
                Unit.Effect b = tgt.find("burn");
                double dot = (b != null ? b.dot : dmg * 0.15) * rm;
                for (Unit u : others) addEffect(w, u, new FxSpec("burn", 3000, null, dot, null), src);
            }
            case "burn+ice" -> {
                removeEffect(w, tgt, "burn");
                dmg = Formulas.jsRound(dmg * (1 + 0.5 * rm));
            }
            case "root+fire" -> {
                List<Unit> all = new ArrayList<>(others);
                all.add(0, tgt);
                for (Unit u : all) addEffect(w, u, new FxSpec("burn", 3000, null, Math.max(1, dmg * 0.15 * rm), null), src);
            }
            case "poison+fire" -> {
                Unit.Effect p = tgt.find("poison");
                dmg += Formulas.jsRound(p.stacks * 0.2 * dmg * rm);
                removeEffect(w, tgt, "poison");
            }
            case "curse+light" -> {
                if (w.now() < tgt.icd.getOrDefault("eclipse", 0L)) return dmg;
                tgt.icd.put("eclipse", w.now() + 5000);
                addEffect(w, tgt, FxSpec.of("stun", 500), src);
            }
            default -> {}
        }
        w.reaction(tgt, r.get("name").getAsString());
        return dmg;
    }
}
