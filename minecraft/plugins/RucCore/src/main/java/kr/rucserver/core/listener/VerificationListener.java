package kr.rucserver.core.listener;

import io.papermc.paper.event.player.AsyncChatEvent;
import kr.rucserver.core.RucCore;
import org.bukkit.Location;
import org.bukkit.entity.Player;
import org.bukkit.event.EventHandler;
import org.bukkit.event.EventPriority;
import org.bukkit.event.Listener;
import org.bukkit.event.block.BlockBreakEvent;
import org.bukkit.event.block.BlockPlaceEvent;
import org.bukkit.event.entity.EntityDamageByEntityEvent;
import org.bukkit.event.entity.EntityDamageEvent;
import org.bukkit.event.entity.EntityPickupItemEvent;
import org.bukkit.event.inventory.InventoryClickEvent;
import org.bukkit.event.inventory.InventoryOpenEvent;
import org.bukkit.event.player.PlayerCommandPreprocessEvent;
import org.bukkit.event.player.PlayerDropItemEvent;
import org.bukkit.event.player.PlayerInteractEntityEvent;
import org.bukkit.event.player.PlayerInteractEvent;
import org.bukkit.event.player.PlayerMoveEvent;

import java.util.List;
import java.util.Locale;

/**
 * 미인증 플레이어 격리 (D10).
 *
 * 접속은 허용하되 피해를 줄 수 있는 모든 경로를 막습니다. 화이트리스트
 * 방식으로 접속 자체를 거부하는 것과 차단 효과는 같지만, 서버를 눈으로
 * 보여줄 수 있어 이탈률이 훨씬 낮습니다.
 *
 * 홈뿐 아니라 모든 서버에 적용됩니다 — 어떤 경로로든 미인증 상태로 다른
 * 서버에 도달했을 때를 대비한 이중 방어입니다.
 */
public class VerificationListener implements Listener {

    private final RucCore plugin;

    public VerificationListener(RucCore plugin) {
        this.plugin = plugin;
    }

    private boolean blocked(Player player) {
        return plugin.getVerification().requiresVerification(player);
    }

    private void notify(Player player, String key) {
        String lang = plugin.getPlayerData().languageOf(player);
        player.sendActionBar(plugin.getMessages().get(lang, key));
    }

    /** 인증 구역 밖으로 나가면 되돌립니다. 시점 회전은 허용합니다. */
    @EventHandler(ignoreCancelled = true)
    public void onMove(PlayerMoveEvent event) {
        if (event.getTo() == null) return;

        // 블록 단위로 이동했을 때만 검사 — 매 틱 계산을 피합니다.
        if (event.getFrom().getBlockX() == event.getTo().getBlockX()
                && event.getFrom().getBlockY() == event.getTo().getBlockY()
                && event.getFrom().getBlockZ() == event.getTo().getBlockZ()) {
            return;
        }

        Player player = event.getPlayer();
        if (!blocked(player)) return;

        Location area = plugin.getVerification().getVerificationArea();
        double radius = plugin.getVerification().getAreaRadius();

        // 다른 월드에 있거나 반경을 벗어나면 인증 구역으로 되돌립니다.
        if (event.getTo().getWorld() != area.getWorld()
                || event.getTo().distanceSquared(area) > radius * radius) {
            event.setTo(area);
            notify(player, "verify.blocked-move");
        }
    }

    @EventHandler(priority = EventPriority.LOWEST)
    public void onChat(AsyncChatEvent event) {
        Player player = event.getPlayer();
        if (!blocked(player)) return;

        event.setCancelled(true);
        String lang = plugin.getPlayerData().languageOf(player);
        player.sendMessage(plugin.getMessages().prefixed(lang, "verify.blocked-chat"));
    }

    /** 허용 목록에 없는 명령어를 막습니다. */
    @EventHandler(priority = EventPriority.LOWEST)
    public void onCommand(PlayerCommandPreprocessEvent event) {
        Player player = event.getPlayer();
        if (!blocked(player)) return;

        String raw = event.getMessage().substring(1).split(" ")[0].toLowerCase(Locale.ROOT);

        List<String> allowed = plugin.getConfig()
                .getStringList("verification.allowed-commands");
        for (String entry : allowed) {
            if (raw.equalsIgnoreCase(entry)) return;
        }

        event.setCancelled(true);
        String lang = plugin.getPlayerData().languageOf(player);
        player.sendMessage(plugin.getMessages().prefixed(lang, "verify.blocked-command"));
    }

    @EventHandler(ignoreCancelled = true)
    public void onBreak(BlockBreakEvent event) {
        if (!blocked(event.getPlayer())) return;
        event.setCancelled(true);
        notify(event.getPlayer(), "verify.blocked-generic");
    }

    @EventHandler(ignoreCancelled = true)
    public void onPlace(BlockPlaceEvent event) {
        if (!blocked(event.getPlayer())) return;
        event.setCancelled(true);
        notify(event.getPlayer(), "verify.blocked-generic");
    }

    @EventHandler(ignoreCancelled = true)
    public void onInteract(PlayerInteractEvent event) {
        if (!blocked(event.getPlayer())) return;
        event.setCancelled(true);
    }

    @EventHandler(ignoreCancelled = true)
    public void onInteractEntity(PlayerInteractEntityEvent event) {
        if (!blocked(event.getPlayer())) return;
        event.setCancelled(true);
    }

    @EventHandler(ignoreCancelled = true)
    public void onDrop(PlayerDropItemEvent event) {
        if (!blocked(event.getPlayer())) return;
        event.setCancelled(true);
        notify(event.getPlayer(), "verify.blocked-generic");
    }

    @EventHandler(ignoreCancelled = true)
    public void onPickup(EntityPickupItemEvent event) {
        if (!(event.getEntity() instanceof Player player)) return;
        if (!blocked(player)) return;
        event.setCancelled(true);
    }

    @EventHandler(ignoreCancelled = true)
    public void onInventoryOpen(InventoryOpenEvent event) {
        if (!(event.getPlayer() instanceof Player player)) return;
        if (!blocked(player)) return;
        event.setCancelled(true);
    }

    @EventHandler(ignoreCancelled = true)
    public void onInventoryClick(InventoryClickEvent event) {
        if (!(event.getWhoClicked() instanceof Player player)) return;
        if (!blocked(player)) return;
        event.setCancelled(true);
    }

    /** 미인증자는 때릴 수도, 맞을 수도 없습니다. */
    @EventHandler(ignoreCancelled = true)
    public void onDamage(EntityDamageEvent event) {
        if (!(event.getEntity() instanceof Player player)) return;
        if (!blocked(player)) return;
        event.setCancelled(true);
    }

    @EventHandler(ignoreCancelled = true)
    public void onDamageByEntity(EntityDamageByEntityEvent event) {
        if (event.getDamager() instanceof Player damager && blocked(damager)) {
            event.setCancelled(true);
            notify(damager, "verify.blocked-generic");
        }
    }
}
