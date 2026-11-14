package kr.rucserver.rpg.character;

import kr.rucserver.rpg.engine.Formulas;
import kr.rucserver.rpg.engine.Unit;
import org.bukkit.entity.Player;

/**
 * 접속 중인 플레이어의 전투 상태. 저장되는 값은 RpgChar, 매 틱 바뀌는 값(스태미나 · 탈진 · 전투 시각)은 여기.
 * 스태미나 규칙은 웹 movement.ts step 과 같음 (달리기 소모 · 1.5초 쉬면 회복 · 0 이면 탈진 · 20% 차면 해제).
 */
public final class PlayerUnit extends Unit {

    public final Player player;
    public final RpgChar ch;
    public double stamina;
    public boolean exhausted;
    public double restMs;
    /** 스킬 쿨 (스킬 id → 다시 쓸 수 있는 시각 ms) · 경직 · 돌진 · 구르기 */
    public final java.util.Map<String, Long> cd = new java.util.HashMap<>();
    public long lockUntil, dashUntil, rollReady;
    /** 장비 발동 효과 (특수효과 · 세트): id → 수치 */
    public final java.util.Map<String, Double> procs = new java.util.HashMap<>();
    /** HUD 스탯 표 보이기 (설정) */
    public boolean showStats = true;
    /** GM: 자원 무소모 */
    public boolean gmNoCost;

    PlayerUnit(Player player, RpgChar ch) {
        super("p");
        this.player = player;
        this.name = player == null ? "?" : player.getName();
        this.ch = ch;
        this.el = ch.element;
        this.lv = ch.level;
    }

    /** 스태미나 최대치가 줄면 깎음 */
    @Override
    protected void onRecalc() {
        stamina = Math.min(stamina, st.get("stamina"));
    }

    /** 스태미나 소모 (movement.ts spend): 기본 × 100 / (100 + 지구력) */
    public void spend(double base) {
        if (base <= 0) return;
        stamina = Math.max(0, stamina - base * 100 / (100 + st.get("endurance")));
        restMs = 0;
        if (stamina == 0) exhausted = true;
    }

    /** 이동 한 틱 (movement.ts step 의 스태미나 부분) */
    public void staminaTick(Formulas f, boolean running, boolean safe, double dtMs, double regenMul) {
        double max = st.get("stamina");
        if (running && !safe && !exhausted) {
            stamina = Math.max(0, stamina - f.stamina("runPerSec") * (dtMs / 1000) * 100 / (100 + st.get("endurance")));
            restMs = 0;
            if (stamina == 0) exhausted = true;
        } else {
            restMs = Math.min(restMs + dtMs, 60_000);
            if (restMs >= f.stamina("regenDelayMs"))
                stamina = Math.min(max, stamina + max * f.stamina("regenPctPerSec") * regenMul * (dtMs / 1000));
            if (exhausted && stamina >= max * f.stamina("recoverPct")) exhausted = false;
        }
    }

    /** 탈진 중 HP 감소 (combat.ts regen 마지막 줄) — HP 1 아래로는 안 내려감 */
    public void exhaustDrain(Formulas f, double dt) {
        if (exhausted && !dead) hp = Math.max(Math.min(hp, 1), hp - st.get("hp") * f.combat("exhaustDrain") * dt);
    }
}
