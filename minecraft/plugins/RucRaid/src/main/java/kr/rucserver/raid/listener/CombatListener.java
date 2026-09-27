package kr.rucserver.raid.listener;

import kr.rucserver.core.util.DamageOrigin;
import kr.rucserver.raid.RucRaid;
import org.bukkit.entity.Entity;
import org.bukkit.entity.LivingEntity;
import org.bukkit.entity.Player;
import org.bukkit.event.EventHandler;
import org.bukkit.event.EventPriority;
import org.bukkit.event.Listener;
import org.bukkit.event.entity.EntityDamageByEntityEvent;
import org.bukkit.event.entity.EntityDamageEvent;
import org.bukkit.event.entity.PotionSplashEvent;

/**
 * 전투 태그를 붙이는 지점.
 *
 * 직접 타격만 보면 원거리 딜러와 폭발 딜러가 태그를 피해갑니다. 그래서
 * 화살·물약·TNT·길들인 동물까지 <b>최초 가해자</b>를 역추적해 태그합니다.
 *
 * 역추적 자체는 {@link DamageOrigin}(RucCore) 으로 옮겼습니다. 평화 서버(§2.5)가
 * 같은 판정을 "막기" 위해 쓰기 때문입니다.
 */
public class CombatListener implements Listener {

    private final RucRaid plugin;

    public CombatListener(RucRaid plugin) {
        this.plugin = plugin;
    }

    @EventHandler(priority = EventPriority.MONITOR, ignoreCancelled = true)
    public void onDamage(EntityDamageByEntityEvent event) {
        if (!(event.getEntity() instanceof Player victim)) return;
        if (!plugin.isRaidWorld(victim.getWorld())) return;

        Player attacker = rootPlayer(event.getDamager());
        if (attacker == null || attacker.equals(victim)) return;

        plugin.getCombatTags().tag(attacker, victim);
    }

    /** 스플래시 물약은 damage 이벤트 전에 여기로 들어옵니다. */
    @EventHandler(priority = EventPriority.MONITOR, ignoreCancelled = true)
    public void onSplash(PotionSplashEvent event) {
        Player thrower = rootPlayer(event.getPotion());
        if (thrower == null) return;
        if (!plugin.isRaidWorld(thrower.getWorld())) return;

        for (LivingEntity affected : event.getAffectedEntities()) {
            if (affected instanceof Player victim && !victim.equals(thrower)) {
                plugin.getCombatTags().tag(thrower, victim);
            }
        }
    }

    /** 시전 중 피해를 입으면 텔레포트가 취소됩니다. */
    @EventHandler(priority = EventPriority.MONITOR, ignoreCancelled = true)
    public void onAnyDamage(EntityDamageEvent event) {
        if (!(event.getEntity() instanceof Player player)) return;
        if (event.getFinalDamage() <= 0) return;
        plugin.getHomes().cancelWarmup(player.getUniqueId(), true);
    }

    /**
     * 피해를 준 엔티티의 최초 가해 플레이어.
     *
     * 실제 판정은 {@link DamageOrigin} 에 있습니다. 평화 서버(§2.5)가 같은
     * 역추적을 "막기" 위해 쓰므로 규칙을 한 곳에 두었습니다 — 두 군데에 적히면
     * 반드시 한쪽만 고쳐집니다.
     */
    public static Player rootPlayer(Entity damager) {
        return DamageOrigin.rootPlayer(damager);
    }
}
