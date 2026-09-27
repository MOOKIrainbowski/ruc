package kr.rucserver.war.listener;

import kr.rucserver.core.model.Guild;
import kr.rucserver.war.RucWar;
import kr.rucserver.war.service.CoreItems;
import kr.rucserver.war.service.TerritoryService;
import kr.rucserver.war.storage.WarRepository;
import org.bukkit.Material;
import org.bukkit.event.EventHandler;
import org.bukkit.event.EventPriority;
import org.bukkit.event.Listener;
import org.bukkit.event.block.BlockBreakEvent;
import org.bukkit.event.block.BlockPlaceEvent;
import org.bukkit.event.inventory.InventoryClickEvent;
import org.bukkit.event.inventory.InventoryType;
import org.bukkit.event.player.PlayerDropItemEvent;
import org.bukkit.inventory.ItemStack;

/**
 * 코어 설치·파괴와 코어 아이템 보관 규칙 (D2, §2.6).
 */
public class CoreListener implements Listener {

    private final RucWar plugin;

    public CoreListener(RucWar plugin) {
        this.plugin = plugin;
    }

    /**
     * 코어 설치.
     *
     * 판정을 통과하지 못하면 블록을 놓지 않고 이유를 알립니다. 놓은 뒤 되돌리면
     * 그 사이 한 틱 동안 신호기가 실제로 존재해서, 다른 이벤트가 그것을 보게 됩니다.
     */
    @EventHandler(priority = EventPriority.HIGH, ignoreCancelled = true)
    public void onPlace(BlockPlaceEvent event) {
        ItemStack item = event.getItemInHand();
        if (!plugin.getItems().is(item, CoreItems.Part.CORE)) return;

        TerritoryService.PlaceResult result =
                plugin.getTerritory().tryPlace(event.getPlayer(), event.getBlock(), item);

        if (result != TerritoryService.PlaceResult.OK) {
            event.setCancelled(true);
            plugin.msg().send(event.getPlayer(), messageKey(result),
                    "sites", plugin.getTerritory().siteNames(),
                    "schedule", plugin.getSchedule().describe(),
                    "minutes", String.valueOf(plugin.getSchedule().minutesUntilOpen()),
                    "max", String.valueOf(
                            plugin.getConfig().getInt("territory.max-cores-per-guild", 2)));
            return;
        }

        var site = plugin.getTerritory().siteAt(event.getBlock().getLocation());
        Guild guild = plugin.core().getGuilds().of(event.getPlayer());
        if (site != null && guild != null) {
            plugin.getTerritory().announcePlaced(event.getPlayer(), site, guild);
        }
    }

    private String messageKey(TerritoryService.PlaceResult result) {
        return switch (result) {
            case NOT_A_SITE -> "war.core-not-a-site";
            case WAR_CLOSED -> "war.core-war-closed";
            case NOT_IN_GUILD -> "war.core-no-guild";
            case NOT_A_NATION -> "war.core-not-nation";
            case NO_PERMISSION -> "war.core-no-permission";
            case WRONG_GUILD -> "war.core-wrong-guild";
            case SITE_TAKEN -> "war.core-site-taken";
            case ALREADY_HAVE_CORE -> "war.core-limit";
            default -> "war.core-error";
        };
    }

    /**
     * 코어 파괴.
     *
     * 평시에는 아무도 부술 수 없습니다. 막지 않으면 새벽에 몰래 부수는 것이
     * 최적해가 되어 "전쟁 시간대" 라는 규칙 자체가 사라집니다.
     *
     * 부서진 코어는 <b>드랍하지 않습니다</b> (D2 — 1회용, 회수 불가).
     */
    @EventHandler(priority = EventPriority.HIGH, ignoreCancelled = true)
    public void onBreak(BlockBreakEvent event) {
        if (event.getBlock().getType() != Material.BEACON) return;

        WarRepository.CoreRow row = plugin.getTerritory().coreAt(event.getBlock());
        if (row == null) return;

        if (!plugin.getTerritory().canBreakCore(event.getPlayer())) {
            event.setCancelled(true);
            plugin.msg().send(event.getPlayer(), "war.core-break-closed",
                    "schedule", plugin.getSchedule().describe());
            return;
        }

        event.setDropItems(false);
        plugin.getTerritory().onCoreBroken(event.getBlock(), event.getPlayer());
    }

    /**
     * 코어는 상자에 넣을 수 없습니다 (D2).
     *
     * 넣을 수 있으면 길드 창고에 박아 두고 아무도 설치하지 않는 상태가 되고,
     * 무엇보다 다른 길드가 상자를 털어 코어를 손에 넣는 경로가 열립니다.
     */
    @EventHandler(ignoreCancelled = true)
    public void onInventoryClick(InventoryClickEvent event) {
        InventoryType type = event.getView().getTopInventory().getType();
        // 플레이어 자기 인벤토리와 조합대는 허용해야 코어를 만들 수 있습니다.
        if (type == InventoryType.PLAYER || type == InventoryType.CRAFTING
                || type == InventoryType.WORKBENCH) {
            return;
        }

        boolean movingCore = plugin.getItems().is(event.getCurrentItem(), CoreItems.Part.CORE)
                || plugin.getItems().is(event.getCursor(), CoreItems.Part.CORE);
        if (!movingCore) return;

        // 클릭 대상이 위쪽(= 보관함)이거나 shift 이동이면 막습니다.
        boolean intoContainer = event.getRawSlot() < event.getView().getTopInventory().getSize()
                || event.isShiftClick();
        if (!intoContainer) return;

        event.setCancelled(true);
        plugin.msg().send(event.getWhoClicked(), "war.core-no-container");
    }

    /** 코어를 버리면 분실 사고가 납니다. 실수를 막습니다. */
    @EventHandler(ignoreCancelled = true)
    public void onDrop(PlayerDropItemEvent event) {
        if (!plugin.getItems().is(event.getItemDrop().getItemStack(), CoreItems.Part.CORE)) return;
        if (!plugin.getConfig().getBoolean("core.prevent-drop", true)) return;

        event.setCancelled(true);
        plugin.msg().send(event.getPlayer(), "war.core-no-drop");
    }
}
