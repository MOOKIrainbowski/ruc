package kr.rucserver.peace.listener;

import kr.rucserver.peace.RucPeace;
import kr.rucserver.peace.service.GuardService;
import org.bukkit.entity.Player;
import org.bukkit.event.EventHandler;
import org.bukkit.event.EventPriority;
import org.bukkit.event.Listener;
import org.bukkit.event.entity.EntityDamageEvent;

/**
 * 살해 차단의 실행 지점 (§2.5).
 *
 * <h2>우선순위를 HIGHEST 로 두는 이유</h2>
 * 판정에 {@code getFinalDamage()} 를 씁니다. 다른 플러그인이 피해량을 보정할 수
 * 있으므로 그 보정이 끝난 뒤에 봐야 "이 피해로 죽는가" 가 맞습니다. 그렇다고
 * MONITOR 로 미루면 그때는 취소해도 늦습니다 — MONITOR 는 결과를 보는 자리이고
 * 여기서 이벤트를 바꾸면 다른 플러그인이 잘못된 상태를 보게 됩니다.
 */
public class ProtectionListener implements Listener {

    private final RucPeace plugin;

    public ProtectionListener(RucPeace plugin) {
        this.plugin = plugin;
    }

    @EventHandler(priority = EventPriority.HIGHEST, ignoreCancelled = true)
    public void onDamage(EntityDamageEvent event) {
        if (!(event.getEntity() instanceof Player victim)) return;
        if (!plugin.isPeaceWorld(victim.getWorld())) return;

        GuardService.Verdict verdict = plugin.getGuard().judge(victim, event);
        if (!verdict.block()) return;

        event.setCancelled(true);
        plugin.getGuard().notify(victim, verdict);

        // 폭발은 피해를 막아도 넉백이 따로 적용됩니다. 크리스탈을 피해가 아니라
        // "밀어서 떨어뜨리는 도구" 로만 쓰는 경로가 남으므로, 막는 이 순간에
        // 가해자를 장부에 적어 둡니다 — 이어지는 낙하 치명타까지 그 사람 몫입니다.
        if ("explosion".equals(verdict.kind()) && verdict.actor() != null) {
            plugin.getAttribution().recordPush(victim.getUniqueId(), verdict.actor());
        }

        // 직접 피해(서로 때리기)는 흔하고 대개 장난이라 기록하지 않습니다.
        // 폭발과 유도된 치명타만 남깁니다 — 그건 죽이려 한 것입니다.
        if (!"direct".equals(verdict.kind())) {
            plugin.getIncidents().record(victim, verdict);
        }
    }
}
