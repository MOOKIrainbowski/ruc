package kr.rucserver.war.listener;

import kr.rucserver.war.RucWar;
import org.bukkit.Location;
import org.bukkit.entity.Player;
import org.bukkit.event.EventHandler;
import org.bukkit.event.EventPriority;
import org.bukkit.event.Listener;
import org.bukkit.event.entity.EntityDamageEvent;
import org.bukkit.event.player.PlayerInteractEntityEvent;
import org.bukkit.event.player.PlayerMoveEvent;

/**
 * 코어 이동 시전 취소와 인장 상인 상호작용.
 *
 * 시전 중 이동·피격으로 취소되지 않으면 {@code /tp} 가 전투 중 탈출 버튼이 됩니다.
 */
public class WarpListener implements Listener {

    private final RucWar plugin;

    public WarpListener(RucWar plugin) {
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
        Player player = event.getPlayer();
        if (!plugin.getWarps().isWarmingUp(player.getUniqueId())) return;

        Location origin = plugin.getWarps().warmupOrigin(player.getUniqueId());
        Location to = event.getTo();
        if (origin == null) return;

        if (origin.getBlockX() != to.getBlockX()
                || origin.getBlockY() != to.getBlockY()
                || origin.getBlockZ() != to.getBlockZ()) {
            plugin.getWarps().cancel(player.getUniqueId(), true);
        }
    }

    /** 시전 중 피격되면 취소합니다. */
    @EventHandler(priority = EventPriority.MONITOR, ignoreCancelled = true)
    public void onDamage(EntityDamageEvent event) {
        if (!(event.getEntity() instanceof Player player)) return;
        if (!plugin.getWarps().isWarmingUp(player.getUniqueId())) return;
        plugin.getWarps().cancel(player.getUniqueId(), true);
    }

    /** 인장 상인에게 말을 걸면 안내합니다. */
    @EventHandler(ignoreCancelled = true)
    public void onInteractEntity(PlayerInteractEntityEvent event) {
        if (!plugin.getSeals().isMerchant(event.getRightClicked())) return;

        // 바닐라 거래 화면이 열리지 않게 막습니다. AI 를 껐어도 거래는 열립니다.
        event.setCancelled(true);
        plugin.getSeals().greet(event.getPlayer());
    }
}
