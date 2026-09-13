package kr.rucserver.raid.listener;

import kr.rucserver.raid.RucRaid;
import org.bukkit.Location;
import org.bukkit.entity.Player;
import org.bukkit.event.EventHandler;
import org.bukkit.event.EventPriority;
import org.bukkit.event.Listener;
import org.bukkit.event.player.PlayerCommandPreprocessEvent;
import org.bukkit.event.player.PlayerJoinEvent;
import org.bukkit.event.player.PlayerMoveEvent;
import org.bukkit.event.player.PlayerQuitEvent;
import org.bukkit.event.entity.PlayerDeathEvent;

import java.util.Locale;

/**
 * 접속·퇴장·사망, 그리고 전투 중 도주 경로 차단.
 */
public class RaidListener implements Listener {

    private final RucRaid plugin;

    public RaidListener(RucRaid plugin) {
        this.plugin = plugin;
    }

    @EventHandler
    public void onJoin(PlayerJoinEvent event) {
        plugin.getExecutions().checkOnJoin(event.getPlayer());
    }

    /**
     * §2.4 — 전투 태그 상태로 나가면 재접속 시 처형됩니다.
     *
     * 킥이든 크래시든 회선 끊김이든 구분하지 않습니다. 구분하려 들면
     * "랙이었다"는 주장을 매번 판정해야 하고, 실제로 툴로 연결을 끊는 방식과
     * 구분할 방법이 없습니다.
     */
    @EventHandler(priority = EventPriority.MONITOR)
    public void onQuit(PlayerQuitEvent event) {
        Player player = event.getPlayer();
        var uuid = player.getUniqueId();

        if (plugin.getCombatTags().isTagged(uuid)) {
            plugin.getExecutions().recordCombatLog(
                    player, plugin.getCombatTags().opponentName(uuid));
        }

        plugin.getCombatTags().clear(uuid);
        plugin.getHomes().clear(uuid);
        plugin.getEggs().clear(uuid);
    }

    /** 정상적으로 죽었다면 전투는 끝난 것입니다. */
    @EventHandler(priority = EventPriority.MONITOR)
    public void onDeath(PlayerDeathEvent event) {
        plugin.getCombatTags().clear(event.getEntity().getUniqueId());
        plugin.getHomes().cancelWarmup(event.getEntity().getUniqueId(), false);
    }

    /** 시전 중 한 블록이라도 벗어나면 취소합니다. */
    @EventHandler(priority = EventPriority.MONITOR, ignoreCancelled = true)
    public void onMove(PlayerMoveEvent event) {
        var uuid = event.getPlayer().getUniqueId();
        if (!plugin.getHomes().isWarmingUp(uuid)) return;

        Location origin = plugin.getHomes().warmupOrigin(uuid);
        Location to = event.getTo();
        if (origin == null || to == null) return;

        // 제자리 시점 회전은 이동이 아닙니다. 블록 좌표가 바뀔 때만 취소합니다.
        if (origin.getBlockX() == to.getBlockX()
                && origin.getBlockY() == to.getBlockY()
                && origin.getBlockZ() == to.getBlockZ()) {
            return;
        }
        plugin.getHomes().cancelWarmup(uuid, true);
    }

    /**
     * 전투 중 텔레포트 계열 명령을 막습니다.
     *
     * /home, /spawn 은 HomeService가 스스로 막지만, Core의 /tpa 계열은 이 서버를
     * 모릅니다. 여기서 한 번에 걸러야 "전투 중 접속 종료를 처벌한다"는 규칙이
     * 우회되지 않습니다.
     */
    @EventHandler(priority = EventPriority.LOWEST, ignoreCancelled = true)
    public void onCommand(PlayerCommandPreprocessEvent event) {
        Player player = event.getPlayer();
        if (!plugin.getCombatTags().isTagged(player)) return;

        String command = event.getMessage().split(" ")[0]
                .substring(1).toLowerCase(Locale.ROOT);
        int colon = command.indexOf(':');          // /plugin:command 우회 차단
        if (colon >= 0) command = command.substring(colon + 1);

        if (!plugin.getConfig().getStringList("combat.blocked-commands").contains(command)) return;

        event.setCancelled(true);
        plugin.msg().send(player, "combat.blocked",
                "seconds", String.valueOf(
                        plugin.getCombatTags().remainingSeconds(player.getUniqueId())));
    }
}
