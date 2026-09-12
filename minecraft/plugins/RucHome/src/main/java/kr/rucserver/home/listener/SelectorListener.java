package kr.rucserver.home.listener;

import kr.rucserver.home.RucHome;
import kr.rucserver.home.service.ServerSelector;
import org.bukkit.Bukkit;
import org.bukkit.event.EventHandler;
import org.bukkit.event.Listener;
import org.bukkit.event.block.Action;
import org.bukkit.event.inventory.InventoryClickEvent;
import org.bukkit.event.player.PlayerInteractEntityEvent;
import org.bukkit.event.player.PlayerInteractEvent;
import org.bukkit.event.player.PlayerJoinEvent;
import org.bukkit.event.player.PlayerRespawnEvent;
import org.bukkit.entity.Player;
import org.bukkit.inventory.EquipmentSlot;

/**
 * 서버 선택 상호작용 — NPC 클릭, 나침반, 메뉴 (D1).
 */
public class SelectorListener implements Listener {

    private final RucHome plugin;

    public SelectorListener(RucHome plugin) {
        this.plugin = plugin;
    }

    /**
     * 접속 시 허브로 보내고 나침반을 줍니다.
     *
     * 단, RucCore가 미인증자를 인증 구역으로 보내므로 순서가 겹칩니다.
     * RucCore의 텔레포트가 뒤에 오도록 1틱 뒤에 실행하고, 인증 구역에
     * 있는 플레이어는 건드리지 않습니다.
     */
    @EventHandler
    public void onJoin(PlayerJoinEvent event) {
        Player player = event.getPlayer();

        Bukkit.getScheduler().runTaskLater(plugin, () -> {
            if (!player.isOnline()) return;
            if (!plugin.isHubWorld(player.getWorld())) {
                player.teleport(plugin.spawn());
            }
            // 인증 구역에 격리된 상태면 나침반을 주지 않습니다 —
            // 미인증자는 어차피 이동할 수 없습니다.
            if (isInVerificationArea(player)) return;

            plugin.setupPlayer(player);
        }, 20L);
    }

    @EventHandler
    public void onRespawn(PlayerRespawnEvent event) {
        event.setRespawnLocation(plugin.spawn());
    }

    private boolean isInVerificationArea(Player player) {
        double dx = player.getLocation().getX() - kr.rucserver.home.world.PlazaBuilder.VERIFY_X;
        double dz = player.getLocation().getZ() - kr.rucserver.home.world.PlazaBuilder.VERIFY_Z;
        return Math.sqrt(dx * dx + dz * dz) < 64;
    }

    /** NPC 우클릭 → 해당 서버로 이동. */
    @EventHandler
    public void onInteractEntity(PlayerInteractEntityEvent event) {
        if (event.getHand() != EquipmentSlot.HAND) return;

        String target = plugin.getSelector().targetOf(event.getRightClicked());
        if (target == null || target.startsWith("holo_")) return;

        event.setCancelled(true);
        plugin.getSelector().sendToServer(event.getPlayer(), target);
    }

    /** 나침반 우클릭 → 메뉴. */
    @EventHandler
    public void onInteract(PlayerInteractEvent event) {
        if (event.getHand() != EquipmentSlot.HAND) return;
        if (event.getAction() != Action.RIGHT_CLICK_AIR
                && event.getAction() != Action.RIGHT_CLICK_BLOCK) return;
        if (!plugin.getSelector().isCompass(event.getItem())) return;

        event.setCancelled(true);
        plugin.getSelector().openMenu(event.getPlayer());
    }

    /** 메뉴 클릭 → 이동. 아이템을 꺼내갈 수 없게 항상 취소합니다. */
    @EventHandler
    public void onMenuClick(InventoryClickEvent event) {
        if (!(event.getWhoClicked() instanceof Player player)) return;

        // 나침반 자체를 인벤토리에서 옮기지 못하게
        if (plugin.getSelector().isCompass(event.getCurrentItem())
                || plugin.getSelector().isCompass(event.getCursor())) {
            event.setCancelled(true);
        }

        if (!(event.getInventory().getHolder() instanceof ServerSelector.MenuHolder)) return;

        event.setCancelled(true);

        String target = plugin.getSelector().menuSelectionOf(event.getCurrentItem());
        if (target != null) {
            plugin.getSelector().sendToServer(player, target);
        }
    }
}
