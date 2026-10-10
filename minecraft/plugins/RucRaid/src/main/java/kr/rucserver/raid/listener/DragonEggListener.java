package kr.rucserver.raid.listener;

import kr.rucserver.raid.RucRaid;
import org.bukkit.entity.EnderDragon;
import org.bukkit.entity.Item;
import org.bukkit.entity.ItemFrame;
import org.bukkit.entity.Player;
import org.bukkit.event.block.BlockPlaceEvent;
import org.bukkit.event.entity.EntityDeathEvent;
import org.bukkit.event.entity.EntityRemoveEvent;
import org.bukkit.event.entity.ItemSpawnEvent;
import org.bukkit.event.inventory.InventoryPickupItemEvent;
import org.bukkit.event.player.PlayerInteractEntityEvent;
import org.bukkit.event.EventHandler;
import org.bukkit.event.EventPriority;
import org.bukkit.event.Listener;
import org.bukkit.event.entity.EntityPickupItemEvent;
import org.bukkit.event.entity.PlayerDeathEvent;
import org.bukkit.event.inventory.ClickType;
import org.bukkit.event.inventory.InventoryClickEvent;
import org.bukkit.event.inventory.InventoryDragEvent;
import org.bukkit.event.inventory.InventoryMoveItemEvent;
import org.bukkit.event.inventory.InventoryType;
import org.bukkit.event.player.PlayerDropItemEvent;
import org.bukkit.inventory.Inventory;
import org.bukkit.inventory.ItemStack;

/**
 * 드래곤 알의 대가 (D3) 중 "보관 불가"와 "사망 시 드랍"을 강제합니다.
 *
 * 보관을 막는 이유: 알이 상자에 들어가는 순간 아무도 그것을 추적할 수 없고,
 * 소지자 노출·공지 같은 대가가 전부 무력해집니다. 알은 반드시 <b>누군가의
 * 인벤토리 안이나 땅 위에</b> 있어야 합니다.
 */
public class DragonEggListener implements Listener {

    private final RucRaid plugin;

    public DragonEggListener(RucRaid plugin) {
        this.plugin = plugin;
    }

    private boolean isEgg(ItemStack item) {
        return plugin.getEggs().isBuffEgg(item);
    }

    // ── 획득 · 분실 (2026-10-10 — 드래곤 처치 알만) ─────────────────────

    @EventHandler
    public void onDragonDeath(EntityDeathEvent event) {
        if (event.getEntity() instanceof EnderDragon dragon) plugin.getEggs().onDragonKilled(dragon.getWorld());
    }

    /** 땅에 떨어진 버프 알은 타지도, 사라지지도, 몹이 줍지도 않습니다. 남는 분실 경로는 공허뿐. */
    @EventHandler(ignoreCancelled = true)
    public void onItemSpawn(ItemSpawnEvent event) {
        if (!isEgg(event.getEntity().getItemStack())) return;
        Item item = event.getEntity();
        item.setInvulnerable(true);
        item.setUnlimitedLifetime(true);
        item.setCanMobPickup(false);
        item.setGlowing(true);
    }

    @EventHandler
    public void onItemRemoved(EntityRemoveEvent event) {
        if (!(event.getEntity() instanceof Item item) || !isEgg(item.getItemStack())) return;
        switch (event.getCause()) {
            case DEATH, DESPAWN, OUT_OF_WORLD, DISCARD, EXPLODE -> plugin.getEggs().markLost();
            default -> { }   // 줍기 · 청크 언로드 · 플러그인 정리는 분실이 아닙니다
        }
    }

    /** 블록으로 놓으면 태그가 사라집니다 (= 버프 알이 평범한 알이 됨). */
    @EventHandler(ignoreCancelled = true)
    public void onPlace(BlockPlaceEvent event) {
        if (!isEgg(event.getItemInHand())) return;
        event.setCancelled(true);
        plugin.msg().send(event.getPlayer(), "egg.no-storage");
    }

    /** 호퍼가 바닥의 알을 빨아들이는 경로 · 액자 */
    @EventHandler(ignoreCancelled = true)
    public void onHopperPickup(InventoryPickupItemEvent event) {
        if (isEgg(event.getItem().getItemStack())) event.setCancelled(true);
    }

    @EventHandler(ignoreCancelled = true)
    public void onFrame(PlayerInteractEntityEvent event) {
        if (!(event.getRightClicked() instanceof ItemFrame)) return;
        if (!isEgg(event.getPlayer().getInventory().getItem(event.getHand()))) return;
        event.setCancelled(true);
        plugin.msg().send(event.getPlayer(), "egg.no-storage");
    }

    // ── 컨테이너 보관 차단 ──────────────────────────────────────────────

    @EventHandler(priority = EventPriority.HIGH, ignoreCancelled = true)
    public void onClick(InventoryClickEvent event) {
        if (!plugin.getEggs().isEnabled()) return;
        if (!(event.getWhoClicked() instanceof Player player)) return;

        Inventory top = event.getView().getTopInventory();
        InventoryType topType = top.getType();

        // 자기 인벤토리만 열려 있으면 컨테이너가 아닙니다.
        if (topType == InventoryType.CRAFTING || topType == InventoryType.PLAYER) return;

        boolean clickedTop = event.getRawSlot() < top.getSize();
        boolean blocked = false;

        if (clickedTop && isEgg(event.getCursor())) {
            // 커서에 든 알을 컨테이너 칸에 내려놓기
            blocked = true;
        } else if (!clickedTop && event.isShiftClick() && isEgg(event.getCurrentItem())) {
            // 쉬프트 클릭은 곧장 컨테이너로 넘어갑니다
            blocked = true;
        } else if (clickedTop && event.getClick() == ClickType.NUMBER_KEY) {
            int button = event.getHotbarButton();
            if (button >= 0 && isEgg(player.getInventory().getItem(button))) blocked = true;
        } else if (clickedTop && event.getClick() == ClickType.SWAP_OFFHAND
                && isEgg(player.getInventory().getItemInOffHand())) {
            blocked = true;
        }

        if (!blocked) return;
        event.setCancelled(true);
        plugin.msg().send(player, "egg.no-storage");
    }

    @EventHandler(priority = EventPriority.HIGH, ignoreCancelled = true)
    public void onDrag(InventoryDragEvent event) {
        if (!plugin.getEggs().isEnabled()) return;
        if (!isEgg(event.getOldCursor())) return;
        if (!(event.getWhoClicked() instanceof Player player)) return;

        Inventory top = event.getView().getTopInventory();
        if (top.getType() == InventoryType.CRAFTING || top.getType() == InventoryType.PLAYER) return;

        boolean intoContainer = event.getRawSlots().stream().anyMatch(slot -> slot < top.getSize());
        if (!intoContainer) return;

        event.setCancelled(true);
        plugin.msg().send(player, "egg.no-storage");
    }

    /** 호퍼·드로퍼로 밀어 넣는 우회 경로. */
    @EventHandler(priority = EventPriority.HIGH, ignoreCancelled = true)
    public void onMoveItem(InventoryMoveItemEvent event) {
        if (!plugin.getEggs().isEnabled()) return;
        if (isEgg(event.getItem())) event.setCancelled(true);
    }

    // ── 사망 시 무조건 드랍 ────────────────────────────────────────────

    /**
     * 약탈 서버는 keepInventory 가 꺼져 있지만, 설정 실수나 다른 플러그인이
     * 켜는 경우가 있습니다. 알만큼은 반드시 떨어지게 여기서 한 번 더 강제합니다.
     */
    @EventHandler(priority = EventPriority.HIGHEST)
    public void onDeath(PlayerDeathEvent event) {
        if (!plugin.getEggs().isEnabled()) return;

        Player player = event.getEntity();

        // 전투로그 처형은 알을 그 자리에 떨군 뒤 인벤토리를 비웁니다 (ExecutionService).
        if (plugin.getExecutions().isExecuting(player.getUniqueId())) return;

        if (!event.getKeepInventory()) return;

        int count = 0;
        ItemStack[] contents = player.getInventory().getContents();
        for (int i = 0; i < contents.length; i++) {
            if (!isEgg(contents[i])) continue;
            event.getDrops().add(contents[i].clone());
            player.getInventory().setItem(i, null);
            count++;
        }
        if (count > 0) plugin.msg().send(player, "egg.dropped-on-death");
    }

    // ── 소지자 변경 즉시 반영 ──────────────────────────────────────────

    @EventHandler(priority = EventPriority.MONITOR, ignoreCancelled = true)
    public void onPickup(EntityPickupItemEvent event) {
        if (!plugin.getEggs().isEnabled()) return;
        if (!(event.getEntity() instanceof Player)) return;
        if (!isEgg(event.getItem().getItemStack())) return;
        plugin.getEggs().refreshSoon();
    }

    @EventHandler(priority = EventPriority.MONITOR, ignoreCancelled = true)
    public void onDrop(PlayerDropItemEvent event) {
        if (!plugin.getEggs().isEnabled()) return;
        if (!isEgg(event.getItemDrop().getItemStack())) return;
        plugin.getEggs().refreshSoon();
    }
}
