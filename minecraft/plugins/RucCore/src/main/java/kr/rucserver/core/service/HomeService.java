package kr.rucserver.core.service;

import kr.rucserver.core.storage.HomeRepository;
import org.bukkit.Bukkit;
import org.bukkit.Location;
import org.bukkit.Particle;
import org.bukkit.Sound;
import org.bukkit.World;
import org.bukkit.entity.Player;
import org.bukkit.plugin.Plugin;
import org.bukkit.scheduler.BukkitTask;

import java.sql.SQLException;
import java.util.HashMap;
import java.util.Map;
import java.util.UUID;
import java.util.logging.Level;

/**
 * {@code /sethome} · {@code /home} · {@code /spawn} (§3.3).
 *
 * <h2>왜 Core 에 있는가</h2>
 * 약탈(§2.4)과 평화(§2.5) 두 서버가 같은 명령을 제공합니다. 그런데 텔레포트는
 * <b>안전 장치</b>입니다 — 시전 시간, 이동 시 취소, 쿨타임. 이 세 가지가 서버마다
 * 따로 적혀 있으면 한쪽만 고쳐지고, 그 한쪽이 전투 중 탈출 버튼이 됩니다.
 *
 * <h2>서버마다 다른 것은 {@link Host} 로 받습니다</h2>
 * 약탈은 전투 태그 중 텔레포트를 막고, 평화는 막을 것이 없습니다. 스폰 좌표와
 * 홈을 지정할 수 있는 월드도 서버마다 다릅니다. 그 셋만 밖에서 주면 나머지
 * 로직은 공용입니다.
 *
 * 문구는 양쪽이 같은 키({@code home.*}, {@code spawn.*}, {@code teleport.*})를
 * 쓰되 파일은 각자의 것을 봅니다 — 그래서 문구 전달도 Host 를 거칩니다.
 */
public class HomeService {

    private static final String DEFAULT_HOME = "default";

    /** 서버마다 달라지는 부분. 각 모듈이 구현합니다. */
    public interface Host {
        Plugin plugin();

        /** 접두사 붙은 안내. */
        void send(Player player, String key, String... placeholders);

        /** 액션바 안내. 카운트다운에 씁니다. */
        void sendActionBar(Player player, String key, String... placeholders);

        /**
         * 지금 텔레포트를 막아야 하는지. 막는다면 이유를 <b>직접 알리고</b> true.
         *
         * 약탈 서버의 전투 태그가 여기로 들어옵니다. 평화 서버는 늘 false 입니다.
         */
        boolean teleportBlocked(Player player);

        /** 이 월드에서 홈을 지정할 수 있는지. */
        boolean isHomeWorld(World world);

        /** {@code /spawn} 목적지. */
        Location spawn();

        /** 시전 시간을 건너뛰는 권한 노드. */
        String bypassWarmupPermission();

        /** 쿨타임을 무시하는 권한 노드. */
        String bypassCooldownPermission();
    }

    private record Warmup(BukkitTask task, Location origin) {}

    private final HomeRepository repository;
    private final String serverId;
    private final Host host;

    private final Map<UUID, Warmup> warmups = new HashMap<>();
    private final Map<UUID, Long> cooldowns = new HashMap<>();

    public HomeService(HomeRepository repository, String serverId, Host host) {
        this.repository = repository;
        this.serverId = serverId;
        this.host = host;
    }

    private Plugin plugin() {
        return host.plugin();
    }

    // ── /sethome ───────────────────────────────────────────────────────

    public void setHome(Player player) {
        if (host.teleportBlocked(player)) return;

        if (!host.isHomeWorld(player.getWorld())) {
            host.send(player, "home.wrong-world");
            return;
        }

        Location loc = player.getLocation().clone();
        Bukkit.getScheduler().runTaskAsynchronously(plugin(), () -> {
            try {
                repository.save(player.getUniqueId(), serverId, DEFAULT_HOME, loc);
            } catch (SQLException e) {
                plugin().getLogger().log(Level.SEVERE, "홈 저장 실패: " + player.getName(), e);
                Bukkit.getScheduler().runTask(plugin(),
                        () -> host.send(player, "home.set-failed"));
                return;
            }
            Bukkit.getScheduler().runTask(plugin(), () -> {
                if (!player.isOnline()) return;
                host.send(player, "home.set",
                        "x", String.valueOf(loc.getBlockX()),
                        "y", String.valueOf(loc.getBlockY()),
                        "z", String.valueOf(loc.getBlockZ()));
                player.playSound(player.getLocation(),
                        Sound.BLOCK_ENCHANTMENT_TABLE_USE, 0.8f, 1.4f);
            });
        });
    }

    public void deleteHome(Player player) {
        Bukkit.getScheduler().runTaskAsynchronously(plugin(), () -> {
            try {
                repository.delete(player.getUniqueId(), serverId, DEFAULT_HOME);
            } catch (SQLException e) {
                plugin().getLogger().log(Level.SEVERE, "홈 삭제 실패: " + player.getName(), e);
                return;
            }
            Bukkit.getScheduler().runTask(plugin(), () -> host.send(player, "home.deleted"));
        });
    }

    // ── /home ──────────────────────────────────────────────────────────

    public void goHome(Player player) {
        if (!canTeleport(player)) return;

        Bukkit.getScheduler().runTaskAsynchronously(plugin(), () -> {
            HomeRepository.HomeRow row;
            try {
                row = repository.find(player.getUniqueId(), serverId, DEFAULT_HOME);
            } catch (SQLException e) {
                plugin().getLogger().log(Level.SEVERE, "홈 조회 실패: " + player.getName(), e);
                return;
            }

            Bukkit.getScheduler().runTask(plugin(), () -> {
                if (!player.isOnline()) return;
                if (row == null) {
                    host.send(player, "home.none");
                    return;
                }
                Location target = row.toLocation();
                if (target == null) {
                    host.send(player, "home.world-missing", "world", row.world());
                    return;
                }
                beginWarmup(player, target, "home.warmup", "home.arrived");
            });
        });
    }

    // ── /spawn ─────────────────────────────────────────────────────────

    public void goSpawn(Player player) {
        if (!canTeleport(player)) return;
        beginWarmup(player, host.spawn(), "spawn.warmup", "spawn.arrived");
    }

    // ── 공통 ───────────────────────────────────────────────────────────

    private boolean canTeleport(Player player) {
        if (host.teleportBlocked(player)) return false;

        if (warmups.containsKey(player.getUniqueId())) {
            host.send(player, "teleport.already-warming");
            return false;
        }

        long cooldown = plugin().getConfig().getLong("teleport.cooldown-seconds", 30) * 1000L;
        Long last = cooldowns.get(player.getUniqueId());
        if (last != null && !player.hasPermission(host.bypassCooldownPermission())) {
            long left = last + cooldown - System.currentTimeMillis();
            if (left > 0) {
                host.send(player, "teleport.cooldown",
                        "seconds", String.valueOf((int) Math.ceil(left / 1000.0)));
                return false;
            }
        }
        return true;
    }

    private void beginWarmup(Player player, Location target, String warmupKey, String arrivedKey) {
        int seconds = plugin().getConfig().getInt("teleport.warmup-seconds", 5);
        if (player.hasPermission(host.bypassWarmupPermission())) seconds = 0;

        if (seconds <= 0) {
            finish(player, target, arrivedKey);
            return;
        }

        UUID uuid = player.getUniqueId();
        host.send(player, warmupKey, "seconds", String.valueOf(seconds));

        final int total = seconds;
        final int[] elapsed = {0};

        BukkitTask task = Bukkit.getScheduler().runTaskTimer(plugin(), () -> {
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

            host.sendActionBar(player, "teleport.countdown",
                    "seconds", String.valueOf(total - elapsed[0]));
            player.getWorld().spawnParticle(Particle.PORTAL,
                    player.getLocation().add(0, 1, 0), 20, 0.4, 0.8, 0.4, 0.02);
        }, 20L, 20L);

        warmups.put(uuid, new Warmup(task, player.getLocation().clone()));
    }

    private void finish(Player player, Location target, String arrivedKey) {
        cooldowns.put(player.getUniqueId(), System.currentTimeMillis());
        player.teleport(target);
        host.send(player, arrivedKey);
        player.playSound(target, Sound.ENTITY_ENDERMAN_TELEPORT, 0.7f, 1.0f);
    }

    /**
     * 시전 중 이동·피격 시 호출. 리스너에서 부릅니다.
     *
     * @param notify 취소 사유를 알릴지. 퇴장으로 인한 정리에서는 false
     */
    public void cancelWarmup(UUID uuid, boolean notify) {
        Warmup warmup = warmups.remove(uuid);
        if (warmup == null) return;
        warmup.task().cancel();

        if (!notify) return;
        Player player = Bukkit.getPlayer(uuid);
        if (player != null) {
            host.send(player, "teleport.cancelled");
            host.sendActionBar(player, "teleport.cancelled");
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
