package kr.rucserver.rpg.character;

import kr.rucserver.rpg.Data;
import kr.rucserver.rpg.engine.Formulas;
import org.junit.jupiter.api.Test;

import java.util.UUID;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

/** 스태미나 · 탈진 규칙 (웹 movement.ts step · combat.ts regen 과 같은 수치) */
class StaminaTest {

    @Test
    void runExhaustRecover() throws Exception {
        Formulas f = new Formulas(Data.load(getClass().getClassLoader()));
        PlayerUnit u = new PlayerUnit(null, new RpgChar(UUID.randomUUID(), "fire"));
        u.base = f.jobStats(1, null, 10, 10, null, false);
        u.innate.addAll(f.elementMods("fire"));
        u.recalc(f, null);
        u.hp = u.st.get("hp");
        u.stamina = u.st.get("stamina");   // 100, 지구력 10 → 초당 12 × 100/110 ≈ 10.9 소모

        for (int i = 0; i < 20; i++) u.staminaTick(f, true, false, 50, 1);   // 1초 달리기
        assertEquals(100 - 12 * 100.0 / 110, u.stamina, 1e-9);

        int ticks = 0;
        while (!u.exhausted && ticks++ < 1000) u.staminaTick(f, true, false, 50, 1);   // 바닥날 때까지
        assertEquals(0, u.stamina, 1e-9);
        assertTrue(u.exhausted);
        // 탈진 중엔 달리기 불가 = 쉬는 것으로 침 (웹 movement.ts: running = … && !exhausted)

        u.staminaTick(f, true, true, 50, 1);   // 안전 구역(광장)은 달려도 소모 없음 → 쉬는 것으로 침
        for (int i = 0; i < 20; i++) u.exhaustDrain(f, 0.05);   // 탈진 1초 = 최대 HP 0.5%
        assertEquals(u.st.get("hp") * (1 - 0.005), u.hp, 1e-9);

        // 1.5초 쉬면 회복 시작, 초당 15% → 20% 넘으면 탈진 해제
        for (int i = 0; i < 30; i++) u.staminaTick(f, false, false, 50, 1);
        assertTrue(u.exhausted);
        for (int i = 0; i < 20 * 2; i++) u.staminaTick(f, false, false, 50, 1);
        assertFalse(u.exhausted);
    }

    @Test
    void exhaustNeverKills() throws Exception {
        Formulas f = new Formulas(Data.load(getClass().getClassLoader()));
        PlayerUnit u = new PlayerUnit(null, new RpgChar(UUID.randomUUID(), "water"));
        u.base = f.jobStats(10, "tank", 30, 10, null, false);
        u.innate.addAll(f.elementMods("water"));
        u.recalc(f, null);
        u.hp = 3;
        u.exhausted = true;
        for (int i = 0; i < 2000; i++) u.exhaustDrain(f, 0.05);
        assertEquals(1, u.hp, 1e-9);
    }
}
