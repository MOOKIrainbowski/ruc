package kr.rucserver.raid.service;

import kr.rucserver.raid.RucRaid;
import kr.rucserver.raid.storage.RaidRepository;
import org.bukkit.Bukkit;
import org.bukkit.Location;
import org.bukkit.Particle;
import org.bukkit.Sound;
import org.bukkit.entity.Player;
import org.bukkit.scheduler.BukkitTask;

import java.sql.SQLException;
import java.util.HashMap;
import java.util.Map;
import java.util.UUID;
import java.util.logging.Level;

/**
 * /spawn · /sethome · /home.
 *
 * 약탈 서버에서 텔레포트는 그 자체가 전투 도구입니다. 그래서 세 가지 장치를
 * 겁니다.
 *  1. 전투 태그 중에는 아예 막습니다 (CombatTagService).
 *  2. 시전 시간을 둡니다. 즉시 이동이면 불리해지는 순간 눌러 빠져나갑니다.
 *  3. 시전 중 이동하거나 맞으면 취소합니다.
 */
public class HomeService {

    private static final String DEFAULT_HOME = "default";

    private record Warmup(BukkitTask task, Location origin, double health) {}

    private final RucRaid plugin;
    private final RaidRepository repository;
    private final String serverId;

    private final Map<UUID, Warmup> warmups = new HashMap<>();
    private final Map<UUID, Long> cooldowns = new HashMap<>();

    public HomeService(RucRaid plugin, RaidRepository repository, String serverId) {
        this.plugin = plugin;
        this.repository = repository;
        this.serverId = serverId;
    }

    // ── /sethome ───────────────────────────────────────────────────────

    public void setHome(Player player) {
        if (plugin.getCombatTags().blockIfTagged(player)) return;

        if (!plugin.isRaidWorld(player.getWorld())) {
            plugin.msg().send(player, "home.wrong-world");
            return;
        }

        Location loc = player.getLocation().clone();
        Bukkit.getScheduler().runTaskAsynchronously(plugin, () -> {
            try {
                repository.saveHome(player.getUniqueId(), serverId, DEFAULT_HOME, loc);
            } catch (SQLException e) {
                plugin.getLogger().log(Level.SEVERE, "홈 저장 실패: " + player.getName(), e);
                Bukkit.getScheduler().runTask(plugin,
                        () -> plugin.msg().send(player, "home.set-failed"));
                return;
            }
            Bukkit.getScheduler().runTask(plugin, () -> {
                if (!player.isOnline()) return;
                plugin.msg().send(player, "home.set",
                        "x", String.valueOf(loc.getBlockX()),
                        "y", String.valueOf(loc.getBlockY()),
                        "z", String.valueOf(loc.getBlockZ()));
                player.playSound(player.getLocation(), Sound.BLOCK_ENCHANTMENT_TABLE_USE, 0.8f, 1.4f);
            });
        });
    }

    public void deleteHome(Player player) {
        Bukkit.getScheduler().runTaskAsynchronously(plugin, () -> {
            try {
                repository.deleteHome(player.getUniqueId(), serverId, DEFAULT_HOME);
            } catch (SQLException e) {
                plugin.getLogger().log(Level.SEVERE, "홈 삭제 실패: " + player.getName(), e);
                return;
            }
            Bukkit.getScheduler().runTask(plugin, () -> plugin.msg().send(player, "home.deleted"));
        });
    }

    // ── /home ──────────────────────────────────────────────────────────

    public void goHome(Player player) {
        if (!canTeleport(player)) return;

        Bukkit.getScheduler().runTaskAsynchronously(plugin, () -> {
            RaidRepository.HomeRow row;
            try {
                row = repository.findHome(player.getUniqueId(), serverId, DEFAULT_HOME);
            } catch (SQLException e) {
                plugin.getLogger().log(Level.SEVERE, "홈 조회 실패: " + player.getName(), e);
                return;
            }

            Bukkit.getScheduler().runTask(plugin, () -> {
                if (!player.isOnline()) return;
                if (row == null) {
                    plugin.msg().send(player, "home.none");
                    return;
                }
                Location target = row.toLocation();
                if (target == null) {
                    plugin.msg().send(player, "home.world-missing", "world", row.world());
                    return;
                }
                beginWarmup(player, target, "home.warmup", "home.arrived");
            });
        });
    }

    // ── /spawn ─────────────────────────────────────────────────────────

    public void goSpawn(Player player) {
        if (!canTeleport(player)) return;
        beginWarmup(player, plugin.raidSpawn(), "spawn.warmup", "spawn.arrived");
    }

    // ── 공통 ───────────────────────────────────────────────────────────

    private boolean canTeleport(Player player) {
        if (plugin.getCombatTags().blockIfTagged(player)) return false;

        if (warmups.containsKey(player.getUniqueId())) {
            plugin.msg().send(player, "teleport.already-warming");
            return false;
        }

        long cooldown = plugin.getConfig().getLong("teleport.cooldown-seconds", 30) * 1000L;
        Long last = cooldowns.get(player.getUniqueId());
        if (last != null && !player.hasPermission("rucraid.bypass.cooldown")) {
            long left = last + cooldown - System.currentTimeMillis();
            if (left > 0) {
                plugin.msg().send(player, "teleport.cooldown",
                        "seconds", String.valueOf((int) Math.ceil(left / 1000.0)));
                return false;
            }
        }
        return true;
    }

    private void beginWarmup(Player player, Location target, String warmupKey, String arrivedKey) {
        int seconds = plugin.getConfig().getInt("teleport.warmup-seconds", 5);
        if (player.hasPermission("rucraid.bypass.warmup")) seconds = 0;

        if (seconds <= 0) {
            finish(player, target, arrivedKey);
            return;
        }

        UUID uuid = player.getUniqueId();
        plugin.msg().send(player, warmupKey, "seconds", String.valueOf(seconds));

        final int total = seconds;
        final int[] elapsed = {0};

        BukkitTask task = Bukkit.getScheduler().runTaskTimer(plugin, () -> {
            if (!player.isOnline()) {
                cancelWarmup(uuid, false);
                return;
            }
            elapsed[0]++;

            if (elapsed[0] >= total) {
                Warmup done = warmups.remove(uuid);
                if (done != null) done.task().cancel();
                finish(player, target, arrivedKey);
                return;
            }

            int left = total - elapsed[0];
            plugin.msg().sendActionBar(player, "teleport.countdown",
                    "seconds", String.valueOf(left));
            player.getWorld().spawnParticle(Particle.PORTAL,
                    player.getLocation().add(0, 1, 0), 20, 0.4, 0.8, 0.4, 0.02);
        }, 20L, 20L);

        warmups.put(uuid, new Warmup(task, player.getLocation().clone(), player.getHealth()));
    }

    private void finish(Player player, Location target, String arrivedKey) {
        cooldowns.put(player.getUniqueId(), System.currentTimeMillis());
        player.teleport(target);
        plugin.msg().send(player, arrivedKey);
        player.playSound(target, Sound.ENTITY_ENDERMAN_TELEPORT, 0.7f, 1.0f);
    }

    /**
     * 시전 중 이동/피격 시 호출. 리스너에서 부릅니다.
     *
     * @param notify 취소 사유를 알릴지. 퇴장으로 인한 정리에서는 false.
     */
    public void cancelWarmup(UUID uuid, boolean notify) {
        Warmup warmup = warmups.remove(uuid);
        if (warmup == null) return;
        warmup.task().cancel();

        if (!notify) return;
        Player player = Bukkit.getPlayer(uuid);
        if (player != null) {
            plugin.msg().send(player, "teleport.cancelled");
            plugin.msg().sendActionBar(player, "teleport.cancelled");
        }
    }

    public boolean isWarmingUp(UUID uuid) {
        return warmups.containsKey(uuid);
    }

    /** 시전을 시작한 지점. 블록 단위로 벗어났는지 판정할 때 씁니다. */
    public Location warmupOrigin(UUID uuid) {
        Warmup warmup = warmups.get(uuid);
        return warmup == null ? null : warmup.origin();
    }

    public void clear(UUID uuid) {
        cancelWarmup(uuid, false);
        cooldowns.remove(uuid);
    }

    public void stop() {
        for (Warmup warmup : warmups.values()) warmup.task().cancel();
        warmups.clear();
    }
}
