package kr.rucserver.peace.listener;

import kr.rucserver.peace.RucPeace;
import org.bukkit.Location;
import org.bukkit.entity.Player;
import org.bukkit.event.EventHandler;
import org.bukkit.event.EventPriority;
import org.bukkit.event.Listener;
import org.bukkit.event.entity.EntityDamageEvent;
import org.bukkit.event.entity.PlayerDeathEvent;
import org.bukkit.event.player.PlayerMoveEvent;
import org.bukkit.event.player.PlayerQuitEvent;

import java.util.UUID;

/**
 * 평화 서버 일반 — 텔레포트 시전 취소, 퇴장 정리.
 */
public class PeaceListener implements Listener {

    private final RucPeace plugin;

    public PeaceListener(RucPeace plugin) {
        this.plugin = plugin;
    }

    /**
     * 시전 중 이동하면 취소합니다.
     *
     * 블록 단위로 벗어났는지만 봅니다. 시선을 돌리거나 제자리에서 미세하게
     * 움직이는 것까지 취소하면 사실상 쓸 수 없는 명령이 됩니다.
     */
    @EventHandler(priority = EventPriority.MONITOR, ignoreCancelled = true)
    public void onMove(PlayerMoveEvent event) {
        UUID uuid = event.getPlayer().getUniqueId();
        if (!plugin.getHomes().isWarmingUp(uuid)) return;

        Location origin = plugin.getHomes().warmupOrigin(uuid);
        if (origin == null) return;

        Location to = event.getTo();
        if (origin.getBlockX() != to.getBlockX()
                || origin.getBlockY() != to.getBlockY()
                || origin.getBlockZ() != to.getBlockZ()) {
            plugin.getHomes().cancelWarmup(uuid, true);
        }
    }

    /**
     * 시전 중 피해를 입으면 취소합니다.
     *
     * 평화 서버에도 몹과 환경 피해는 있습니다. 취소하지 않으면 용암에 빠진 채로
     * 안전한 곳으로 이동하는 것이 최적해가 됩니다.
     */
    @EventHandler(priority = EventPriority.MONITOR, ignoreCancelled = true)
    public void onDamage(EntityDamageEvent event) {
        if (!(event.getEntity() instanceof Player player)) return;
        if (event.getFinalDamage() <= 0) return;
        plugin.getHomes().cancelWarmup(player.getUniqueId(), true);
    }

    @EventHandler(priority = EventPriority.MONITOR)
    public void onDeath(PlayerDeathEvent event) {
        plugin.getHomes().cancelWarmup(event.getEntity().getUniqueId(), false);
    }

    @EventHandler
    public void onQuit(PlayerQuitEvent event) {
        UUID uuid = event.getPlayer().getUniqueId();
        plugin.getHomes().clear(uuid);
        plugin.getAttribution().forget(uuid);
    }
}
