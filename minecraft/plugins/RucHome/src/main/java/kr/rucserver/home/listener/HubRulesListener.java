package kr.rucserver.home.listener;

import kr.rucserver.home.RucHome;
import org.bukkit.entity.Player;
import org.bukkit.event.EventHandler;
import org.bukkit.event.EventPriority;
import org.bukkit.event.Listener;
import org.bukkit.event.block.BlockBreakEvent;
import org.bukkit.event.block.BlockPlaceEvent;
import org.bukkit.event.entity.EntityDamageByEntityEvent;
import org.bukkit.event.entity.EntityDamageEvent;
import org.bukkit.event.entity.EntityPickupItemEvent;
import org.bukkit.event.entity.EntitySpawnEvent;
import org.bukkit.event.entity.FoodLevelChangeEvent;
import org.bukkit.event.player.PlayerDropItemEvent;
import org.bukkit.event.weather.WeatherChangeEvent;
import org.bukkit.entity.Monster;

/**
 * 홈 서버 규칙 (§2.3).
 *
 * PvP 불가, 블록 파괴/설치 불가. 여기는 싸우는 곳이 아니라 어디로 갈지
 * 고르는 곳입니다.
 */
public class HubRulesListener implements Listener {

    private final RucHome plugin;

    public HubRulesListener(RucHome plugin) {
        this.plugin = plugin;
    }

    private boolean exempt(Player player) {
        return player.hasPermission("ruchome.admin");
    }

    // ── 블록 파괴/설치 차단 (§2.3) ─────────────────────────────────────

    @EventHandler(ignoreCancelled = true)
    public void onBreak(BlockBreakEvent event) {
        if (exempt(event.getPlayer())) return;
        event.setCancelled(true);
    }

    @EventHandler(ignoreCancelled = true)
    public void onPlace(BlockPlaceEvent event) {
        if (exempt(event.getPlayer())) return;
        event.setCancelled(true);
    }

    // ── PvP 및 모든 데미지 차단 (§2.3) ─────────────────────────────────

    @EventHandler(priority = EventPriority.HIGH, ignoreCancelled = true)
    public void onDamage(EntityDamageEvent event) {
        if (event.getEntity() instanceof Player) {
            event.setCancelled(true);
        }
    }

    @EventHandler(priority = EventPriority.HIGH, ignoreCancelled = true)
    public void onDamageByEntity(EntityDamageByEntityEvent event) {
        if (event.getEntity() instanceof Player || event.getDamager() instanceof Player) {
            event.setCancelled(true);
        }
    }

    // ── 배고픔 고정 ────────────────────────────────────────────────────

    @EventHandler(ignoreCancelled = true)
    public void onHunger(FoodLevelChangeEvent event) {
        if (!(event.getEntity() instanceof Player player)) return;
        event.setCancelled(true);
        player.setFoodLevel(20);
        player.setSaturation(20f);
    }

    // ── 아이템 드랍/획득 차단 ──────────────────────────────────────────

    @EventHandler(ignoreCancelled = true)
    public void onDrop(PlayerDropItemEvent event) {
        if (exempt(event.getPlayer())) return;
        event.setCancelled(true);
    }

    @EventHandler(ignoreCancelled = true)
    public void onPickup(EntityPickupItemEvent event) {
        if (!(event.getEntity() instanceof Player player)) return;
        if (exempt(player)) return;
        event.setCancelled(true);
    }

    // ── 몬스터 스폰 차단 ───────────────────────────────────────────────

    @EventHandler(ignoreCancelled = true)
    public void onSpawn(EntitySpawnEvent event) {
        if (!plugin.isHubWorld(event.getLocation().getWorld())) return;
        if (event.getEntity() instanceof Monster) {
            event.setCancelled(true);
        }
    }

    // ── 날씨 고정 (항상 맑음) ──────────────────────────────────────────

    @EventHandler(ignoreCancelled = true)
    public void onWeather(WeatherChangeEvent event) {
        if (!plugin.isHubWorld(event.getWorld())) return;
        if (event.toWeatherState()) event.setCancelled(true);   // 비로 바뀌는 것만 취소
    }
}
