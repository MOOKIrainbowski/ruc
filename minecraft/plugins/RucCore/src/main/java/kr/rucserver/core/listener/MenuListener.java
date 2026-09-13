package kr.rucserver.core.listener;

import kr.rucserver.core.RucCore;
import kr.rucserver.core.menu.MenuHolder;
import kr.rucserver.core.menu.MenuService;
import kr.rucserver.core.model.RucPlayer;
import org.bukkit.Sound;
import org.bukkit.entity.Player;
import org.bukkit.event.EventHandler;
import org.bukkit.event.EventPriority;
import org.bukkit.event.Listener;
import org.bukkit.event.inventory.InventoryClickEvent;
import org.bukkit.event.inventory.InventoryDragEvent;
import org.bukkit.event.player.PlayerSwapHandItemsEvent;
import org.bukkit.inventory.Inventory;

/**
 * Shift + F 키 감지와 메뉴 클릭 처리 (Phase 3.5).
 *
 * 서버는 클라이언트의 임의 키를 볼 수 없습니다. 바닐라에서 F 는 "손에 든 아이템
 * 교체"라 패킷이 오고, 그게 PlayerSwapHandItemsEvent 입니다. 웅크림 상태는 서버가
 * 이미 알고 있으니 둘을 합치면 Shift + F 가 됩니다.
 */
public class MenuListener implements Listener {

    private final RucCore plugin;

    public MenuListener(RucCore plugin) {
        this.plugin = plugin;
    }

    // ── Shift + F ─────────────────────────────────────────────────────

    @EventHandler(priority = EventPriority.HIGH, ignoreCancelled = true)
    public void onSwapHands(PlayerSwapHandItemsEvent event) {
        if (!plugin.getConfig().getBoolean("menu.shift-f-enabled", true)) return;

        Player player = event.getPlayer();
        if (!player.isSneaking()) return;      // 웅크리지 않은 F 는 원래 기능 그대로

        // 취소하지 않으면 메뉴가 열리면서 손의 아이템도 바뀝니다.
        event.setCancelled(true);
        plugin.getMenus().openMain(player);
    }

    // ── 메뉴 클릭 ─────────────────────────────────────────────────────

    @EventHandler(priority = EventPriority.HIGH)
    public void onClick(InventoryClickEvent event) {
        Inventory top = event.getView().getTopInventory();
        if (!(top.getHolder() instanceof MenuHolder holder)) return;

        // 메뉴는 전부 장식용입니다. 아래쪽 자기 인벤토리를 클릭한 경우까지
        // 포함해 모두 막아야 쉬프트 클릭으로 아이템을 밀어 넣지 못합니다.
        event.setCancelled(true);

        if (!(event.getWhoClicked() instanceof Player player)) return;
        if (event.getClickedInventory() != top) return;

        switch (holder.getType()) {
            case MAIN -> handleMain(player, event.getRawSlot());
            case HELP -> {
                if (event.getRawSlot() == 22) plugin.getMenus().openMain(player);
            }
            default -> { }
        }
    }

    /** 드래그로도 아이템이 들어가지 못하게 합니다. */
    @EventHandler(priority = EventPriority.HIGH)
    public void onDrag(InventoryDragEvent event) {
        if (event.getView().getTopInventory().getHolder() instanceof MenuHolder) {
            event.setCancelled(true);
        }
    }

    private void handleMain(Player player, int slot) {
        String lang = plugin.getPlayerData().languageOf(player);

        // 서버 이동 칸
        String server = plugin.getMenus().serverAtSlot(slot);
        if (server != null) {
            if (server.equals(plugin.getNetwork().getCurrentServer())) {
                plugin.getMenus().click(player, "menu.server.already-here");
                return;
            }
            player.closeInventory();
            player.sendMessage(plugin.getMessages().prefixed(lang, "menu.server.connecting",
                    "server", plugin.getMessages().raw(lang, "menu.server." + server + "-name")));
            player.playSound(player.getLocation(), Sound.ENTITY_ENDERMAN_TELEPORT, 0.7f, 1.2f);
            plugin.getNetwork().connect(player, server);
            return;
        }

        switch (slot) {
            case MenuService.SLOT_CLOSE -> player.closeInventory();

            case MenuService.SLOT_LANGUAGE -> {
                RucPlayer data = plugin.getPlayerData().get(player);
                if (data == null) return;
                String next = "ko".equals(data.getLanguage()) ? "en" : "ko";
                data.setLanguage(next);
                plugin.getPlayerData().saveAsync(data);
                plugin.getScoreboards().attach(player);      // 스코어보드도 즉시 번역
                plugin.getMenus().openMain(player);          // 메뉴를 새 언어로 다시 그립니다
                player.sendMessage(plugin.getMessages().prefixed(next, "language.changed",
                        "language", next));
            }

            case MenuService.SLOT_SPAWN -> {
                player.closeInventory();
                // 서버마다 스폰의 의미가 달라서 명령으로 넘깁니다. 각 서버 모듈이
                // 전투 태그·시전 시간 같은 자기 규칙을 그대로 적용하게 됩니다.
                if (!player.performCommand("spawn")) {
                    player.teleport(player.getWorld().getSpawnLocation());
                }
            }

            case MenuService.SLOT_HELP -> plugin.getMenus().openHelp(player);

            case MenuService.SLOT_VERIFY -> {
                player.closeInventory();
                player.performCommand("verify");
            }

            case MenuService.SLOT_PROFILE -> {
                player.closeInventory();
                player.performCommand("level");
                player.performCommand("ruc");
            }

            default -> { }
        }
    }
}
