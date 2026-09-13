package kr.rucserver.raid.listener;

import kr.rucserver.raid.RucRaid;
import org.bukkit.entity.AreaEffectCloud;
import org.bukkit.entity.Entity;
import org.bukkit.entity.LivingEntity;
import org.bukkit.entity.Player;
import org.bukkit.entity.Projectile;
import org.bukkit.entity.Tameable;
import org.bukkit.entity.TNTPrimed;
import org.bukkit.event.EventHandler;
import org.bukkit.event.EventPriority;
import org.bukkit.event.Listener;
import org.bukkit.event.entity.EntityDamageByEntityEvent;
import org.bukkit.event.entity.EntityDamageEvent;
import org.bukkit.event.entity.PotionSplashEvent;
import org.bukkit.projectiles.ProjectileSource;

/**
 * 전투 태그를 붙이는 지점.
 *
 * 직접 타격만 보면 원거리 딜러와 폭발 딜러가 태그를 피해갑니다. 그래서
 * 화살·물약·TNT·길들인 동물까지 <b>최초 가해자</b>를 역추적해 태그합니다.
 * (평화 서버 §2.5의 간접 살해 차단도 같은 역추적을 쓰므로, 이 로직은 나중에
 * 공용으로 올릴 수 있게 한 곳에 모아 두었습니다.)
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
     * 피해를 준 엔티티의 최초 가해 플레이어를 찾습니다.
     *
     * 화살 → 쏜 사람, 물약 → 던진 사람, TNT → 점화한 사람,
     * 길들인 늑대 → 주인. 체인이 한 단계 더 깊을 수 있어 재귀합니다
     * (예: 플레이어가 점화한 TNT가 띄운 화살).
     */
    public static Player rootPlayer(Entity damager) {
        return rootPlayer(damager, 0);
    }

    private static Player rootPlayer(Entity damager, int depth) {
        if (damager == null || depth > 4) return null;

        if (damager instanceof Player player) return player;

        if (damager instanceof Projectile projectile) {
            ProjectileSource shooter = projectile.getShooter();
            if (shooter instanceof Entity entity) return rootPlayer(entity, depth + 1);
            return null;
        }

        if (damager instanceof TNTPrimed tnt) {
            return rootPlayer(tnt.getSource(), depth + 1);
        }

        if (damager instanceof AreaEffectCloud cloud) {
            ProjectileSource source = cloud.getSource();
            if (source instanceof Entity entity) return rootPlayer(entity, depth + 1);
            return null;
        }

        if (damager instanceof Tameable tameable && tameable.getOwner() instanceof Player owner) {
            return owner;
        }

        return null;
    }
}
