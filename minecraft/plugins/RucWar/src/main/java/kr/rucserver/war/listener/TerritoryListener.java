package kr.rucserver.war.listener;

import kr.rucserver.war.RucWar;
import org.bukkit.GameMode;
import org.bukkit.Location;
import org.bukkit.entity.Player;
import org.bukkit.event.EventHandler;
import org.bukkit.event.EventPriority;
import org.bukkit.event.Listener;
import org.bukkit.event.block.Action;
import org.bukkit.event.block.BlockBreakEvent;
import org.bukkit.event.block.BlockPlaceEvent;
import org.bukkit.event.player.PlayerBucketEmptyEvent;
import org.bukkit.event.player.PlayerInteractEvent;
import org.bukkit.event.player.PlayerMoveEvent;

import java.util.HashMap;
import java.util.Map;
import java.util.UUID;

/**
 * 영토 보호와 영토 진입 안내 (§2.6).
 *
 * 보호가 걸리는 경우는 셋뿐입니다: 스폰 중립 구역, 평시의 남의 영토,
 * 그리고 평시의 코어 블록. 그 외에는 바닐라 그대로 둡니다 — 국가전 서버에서
 * 과보호는 콘텐츠를 죽입니다.
 */
public class TerritoryListener implements Listener {

    private final RucWar plugin;

    /** 마지막으로 안내한 영토. 청크마다 알리면 도배가 됩니다. */
    private final Map<UUID, String> lastTerritory = new HashMap<>();

    public TerritoryListener(RucWar plugin) {
        this.plugin = plugin;
    }

    @EventHandler(priority = EventPriority.HIGH, ignoreCancelled = true)
    public void onBreak(BlockBreakEvent event) {
        // 코어 자체는 CoreListener 가 먼저 판정합니다.
        if (plugin.getTerritory().coreAt(event.getBlock()) != null) return;
        if (guard(event.getPlayer(), event.getBlock().getLocation())) event.setCancelled(true);
    }

    @EventHandler(priority = EventPriority.HIGH, ignoreCancelled = true)
    public void onPlace(BlockPlaceEvent event) {
        if (guard(event.getPlayer(), event.getBlock().getLocation())) event.setCancelled(true);
    }

    @EventHandler(ignoreCancelled = true)
    public void onBucket(PlayerBucketEmptyEvent event) {
        if (guard(event.getPlayer(), event.getBlock().getLocation())) event.setCancelled(true);
    }

    /**
     * 상자·문 같은 상호작용.
     *
     * 블록 파괴만 막고 이건 두면, 평시에 남의 영토에 들어가 상자를 전부 털 수
     * 있어서 보호가 사실상 없는 것과 같습니다.
     */
    @EventHandler(priority = EventPriority.HIGH, ignoreCancelled = true)
    public void onInteract(PlayerInteractEvent event) {
        if (event.getAction() != Action.RIGHT_CLICK_BLOCK) return;
        if (event.getClickedBlock() == null) return;

        // 여닫이 없는 블록에까지 안내를 띄우면 시끄럽습니다. 컨테이너와
        // 상호작용 가능한 블록만 봅니다.
        var type = event.getClickedBlock().getType();
        boolean interactive = event.getClickedBlock().getState() instanceof
                org.bukkit.inventory.InventoryHolder
                || type.name().endsWith("_DOOR") || type.name().endsWith("_TRAPDOOR")
                || type.name().endsWith("_BUTTON") || type == org.bukkit.Material.LEVER
                || type.name().endsWith("_FENCE_GATE");
        if (!interactive) return;

        if (guard(event.getPlayer(), event.getClickedBlock().getLocation())) {
            event.setCancelled(true);
        }
    }

    /**
     * 막아야 하는지 판정하고, 막는다면 이유를 알립니다.
     *
     * @return true 면 이벤트를 취소해야 합니다
     */
    private boolean guard(Player player, Location location) {
        if (player.getGameMode() == GameMode.CREATIVE
                && player.hasPermission("rucwar.bypass.territory")) {
            return false;
        }
        if (plugin.getTerritory().canBuild(player, location)) return false;

        if (plugin.getTerritory().isNeutral(location)) {
            plugin.msg().send(player, "war.neutral-protected");
            return true;
        }
        plugin.msg().send(player, "war.territory-protected",
                "guild", String.valueOf(plugin.getTerritory().ownerNameAt(location)),
                "schedule", plugin.getSchedule().describe());
        return true;
    }

    /**
     * 영토 경계를 넘을 때 알립니다.
     *
     * 청크가 바뀔 때만 확인합니다. 매 이동마다 계산하면 이동이 잦은 서버에서
     * 쓸데없이 비쌉니다.
     */
    @EventHandler(priority = EventPriority.MONITOR, ignoreCancelled = true)
    public void onMove(PlayerMoveEvent event) {
        Location from = event.getFrom();
        Location to = event.getTo();

        // 청크 좌표를 블록 좌표에서 직접 계산합니다. Location.getChunk() 는
        // 청크 객체를 얻으려고 필요하면 로드까지 하는데, 이동 이벤트는 플레이어당
        // 초당 여러 번 들어오므로 그 비용을 매번 치를 이유가 없습니다.
        if ((from.getBlockX() >> 4) == (to.getBlockX() >> 4)
                && (from.getBlockZ() >> 4) == (to.getBlockZ() >> 4)
                && from.getWorld().equals(to.getWorld())) {
            return;
        }

        Player player = event.getPlayer();
        String owner = plugin.getTerritory().ownerNameAt(to);
        String key = owner == null
                ? (plugin.getTerritory().isNeutral(to) ? "\0neutral" : "\0wild")
                : owner;

        String previous = lastTerritory.get(player.getUniqueId());
        if (key.equals(previous)) return;
        lastTerritory.put(player.getUniqueId(), key);

        if (owner != null) {
            plugin.msg().sendActionBar(player, "war.entering-territory", "guild", owner);
        } else if (plugin.getTerritory().isNeutral(to)) {
            plugin.msg().sendActionBar(player, "war.entering-neutral");
        } else {
            plugin.msg().sendActionBar(player, "war.entering-wild");
        }
    }

    public void forget(UUID uuid) {
        lastTerritory.remove(uuid);
    }
}
