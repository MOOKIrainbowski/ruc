package kr.rucserver.war.listener;

import kr.rucserver.war.RucWar;
import kr.rucserver.core.model.Guild;
import org.bukkit.entity.Player;
import org.bukkit.event.EventHandler;
import org.bukkit.event.entity.PlayerDeathEvent;
import org.bukkit.event.Listener;
import org.bukkit.event.inventory.InventoryCloseEvent;
import org.bukkit.event.player.PlayerJoinEvent;
import org.bukkit.event.player.PlayerQuitEvent;

/**
 * 국가전 서버 일반 — 접속 안내, 창고 저장, 퇴장 정리.
 */
public class WarListener implements Listener {

    private final RucWar plugin;
    private final TerritoryListener territoryListener;

    public WarListener(RucWar plugin, TerritoryListener territoryListener) {
        this.plugin = plugin;
        this.territoryListener = territoryListener;
    }

    /**
     * 접속 안내.
     *
     * 프록시(RucGate)가 이미 국가 소속만 들여보내므로 자격 검사는 하지 않습니다.
     * 여기서 또 검사하면 두 곳의 규칙이 어긋날 때 "프록시는 통과, 서버는 킥" 이
     * 되어 원인을 찾기 어려워집니다.
     */
    @EventHandler
    public void onJoin(PlayerJoinEvent event) {
        var player = event.getPlayer();

        // 접속 직후에는 길드 캐시가 아직 안 채워졌을 수 있어 한 틱 뒤에 봅니다.
        plugin.getServer().getScheduler().runTaskLater(plugin, () -> {
            if (!player.isOnline()) return;

            if (plugin.getSchedule().isOpen()) {
                plugin.msg().send(player, "war.status-open",
                        "minutes", String.valueOf(plugin.getSchedule().minutesUntilClose()));
            } else {
                plugin.msg().send(player, "war.status-closed",
                        "schedule", plugin.getSchedule().describe(),
                        "minutes", String.valueOf(plugin.getSchedule().minutesUntilOpen()));
            }
        }, 20L);
    }

    @EventHandler
    public void onQuit(PlayerQuitEvent event) {
        territoryListener.forget(event.getPlayer().getUniqueId());
        plugin.getTerritory().cleanup(event.getPlayer().getUniqueId());
        plugin.getWatch().forget(event.getPlayer().getUniqueId());
    }

    /** 전쟁 중 다른 국가 사람을 처치하면 시즌 점수 (§3.5 랭킹의 재료). */
    @EventHandler
    public void onKill(PlayerDeathEvent event) {
        Player killer = event.getEntity().getKiller();
        if (killer == null || !plugin.getSchedule().isOpen()) return;
        Guild mine = plugin.core().getGuilds().of(killer);
        Guild theirs = plugin.core().getGuilds().of(event.getEntity());
        if (mine == null || (theirs != null && theirs.getId() == mine.getId())) return;
        plugin.core().getGuilds().addPoints(mine.getId(), plugin.getConfig().getLong("territory.points.kill", 10));
    }

    /** 국가창고를 닫으면 저장합니다. 마지막 사람일 때만 메모리에서 비웁니다. */
    @EventHandler
    public void onInventoryClose(InventoryCloseEvent event) {
        plugin.getStorage().onClose(event.getInventory(), event.getPlayer());
    }
}
