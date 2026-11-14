package kr.rucserver.rpg.engine;

import kr.rucserver.rpg.Data;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.util.ArrayList;
import java.util.List;

import static org.junit.jupiter.api.Assertions.*;

/** 상태효과 엔진 · 피해 적용 규칙 (웹 combat.ts 와 같은 동작) — 가짜 월드로 */
class CombatTest {

    static final class U extends Unit { U(String k) { super(k); } }

    final class W implements World {
        long now = 0;
        final List<Unit> units = new ArrayList<>();
        final List<String> log = new ArrayList<>();
        public long now() { return now; }
        public Unit unit(int id) { return units.stream().filter(u -> u.id == id).findFirst().orElse(null); }
        public List<Unit> around(double x, double y, double r, String kind) {
            return units.stream().filter(u -> !u.dead && u.kind.equals(kind) && Math.hypot(u.x - x, u.y - y) <= r + u.r).toList();
        }
        public boolean hostile(Unit a, Unit b) { return !a.kind.equals(b.kind); }
        public void damaged(Unit s, Unit t, double a, double th, Combat.HitSpec h) {}
        public void killed(Unit u, Unit by) { log.add("killed " + u.id); }
        public void push(Unit u, double dx, double dy) { u.x += dx; u.y += dy; }
        public void show(Unit s, Unit t, double a, int flag, String el) { log.add("show " + flag + " " + a); }
        public void revived(Unit u) { log.add("revived"); }
    }

    Formulas f;
    Combat c;
    W w;

    @BeforeEach
    void setup() throws Exception {
        Data d = Data.load(getClass().getClassLoader());
        f = new Formulas(d);
        c = new Combat(d, f, new EffectDefs(d));
        c.setRandom(() -> 0.99);   // 치명타 · 저항 · 확률 효과 안 터지게
        w = new W();
    }

    U unit(String kind, double x) {
        U u = new U(kind);
        u.base = f.jobStats(10, null, 10, 10, null, false);
        u.el = "none";
        u.recalc(f, c.defs());
        u.hp = u.st.get("hp");
        u.x = x;
        w.units.add(u);
        return u;
    }

    @Test
    void hardCcDiminishingReturns() {
        U p = unit("p", 0), m = unit("m", 10);
        assertTrue(c.addEffect(w, p, Combat.FxSpec.of("stun", 1000), m));
        assertEquals(1000, p.find("stun").dur);
        w.now = 1000; c.tickEffects(w, p);   // 끝 → 0.5초 면역
        assertFalse(p.has("stun"));
        assertFalse(c.addEffect(w, p, Combat.FxSpec.of("stun", 1000), m), "끝난 뒤 0.5초 면역");
        w.now = 1600;
        assertTrue(c.addEffect(w, p, Combat.FxSpec.of("stun", 1000), m));
        assertEquals(500, p.find("stun").dur, "10초 안 두 번째 = 50%");
        // 몹은 체감 없음
        assertTrue(c.addEffect(w, m, Combat.FxSpec.of("stun", 1000), p));
        w.now = 2600; c.tickEffects(w, m);
        assertTrue(c.addEffect(w, m, Combat.FxSpec.of("stun", 1000), p));
        assertEquals(1000, m.find("stun").dur);
    }

    @Test
    void chillStacksToFreeze() {
        U p = unit("p", 0), m = unit("m", 10);
        for (int i = 0; i < 3; i++) c.addEffect(w, m, Combat.FxSpec.of("chill", 2000, 0.15), p);
        assertFalse(m.has("chill"));
        assertTrue(m.has("freeze"));
        assertTrue(m.blockMove, "빙결 = 이동 불가");
    }

    @Test
    void shieldAbsorbsFirstThenFeatherRevives() {
        U p = unit("p", 0), m = unit("m", 10);
        c.addEffect(w, p, Combat.FxSpec.of("shield", 5000, 50), p);
        double hp0 = p.hp;
        c.dotDamage(w, m, p, 30);
        assertEquals(hp0, p.hp, 1e-9);
        assertEquals(20, p.shield(), 1e-9);
        c.addEffect(w, p, Combat.FxSpec.of("feather", 1e9), p);
        c.dotDamage(w, m, p, 1e6);
        assertFalse(p.dead);
        assertEquals(Formulas.jsRound(p.st.get("hp") * 0.3), p.hp, 1e-9);
        assertTrue(p.has("invuln"));
        assertTrue(w.log.contains("revived"));
    }

    @Test
    void killAndKeepElixir() {
        U p = unit("p", 0), m = unit("m", 10);
        c.addEffect(w, m, Combat.FxSpec.of("slow", 3000, 0.3), p);
        Combat.HitSpec h = new Combat.HitSpec();
        h.base = 1e7;
        c.hit(w, p, m, h);
        assertTrue(m.dead);
        assertTrue(m.fx.isEmpty());
        assertTrue(w.log.contains("killed " + m.id));
    }

    @Test
    void wetElectricChains() {
        U p = unit("p", 0), m1 = unit("m", 20), m2 = unit("m", 40);
        c.addEffect(w, m1, Combat.FxSpec.of("wet", 5000), p);
        Combat.HitSpec h = new Combat.HitSpec();
        h.base = 50; h.el = "electric"; h.cat = "magical";
        double m2hp = m2.hp;
        c.hit(w, p, m1, h);
        assertFalse(m1.has("wet"));
        assertTrue(m1.has("shock"));
        assertTrue(m2.hp < m2hp, "과전류가 옆 적에게 번짐");
    }

    @Test
    void statModsApplyWhenExported() {
        U p = unit("p", 0);
        if (!c.defs().hasModsData()) return;   // export 갱신 전엔 건너뜀 (RucRpg 가 켤 때 경고)
        double ms = p.st.get("moveSpeed");
        c.addEffect(w, p, Combat.FxSpec.of("haste", 3000, 0.2), p);
        assertEquals(ms * 1.2, p.st.get("moveSpeed"), 1e-9);
    }
}
