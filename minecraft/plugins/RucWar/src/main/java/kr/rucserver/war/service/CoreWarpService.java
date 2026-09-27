package kr.rucserver.war.service;

import kr.rucserver.core.model.Guild;
import kr.rucserver.war.RucWar;
import org.bukkit.Bukkit;
import org.bukkit.Location;
import org.bukkit.Particle;
import org.bukkit.Sound;
import org.bukkit.entity.Player;
import org.bukkit.scheduler.BukkitTask;

import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * {@code /tp [코어명]} — 자기 국가의 코어로 이동합니다 (§3.3).
 *
 * 국가전 서버에서 즉시 이동은 그 자체로 전투 도구입니다. 불리해지면 눌러
 * 빠져나가거나, 반대로 순간적으로 병력을 집결시킬 수 있습니다. 그래서 약탈
 * 서버의 {@code /home} 과 같은 세 가지 장치를 겁니다 — 시전 시간, 이동 시 취소,
 * 쿨타임. 전쟁 시간대에는 시전 시간을 더 길게 둘 수 있습니다.
 */
public class CoreWarpService {

    private record Warmup(BukkitTask task, Location origin) {}

    private final RucWar plugin;
    private final Map<UUID, Warmup> warmups = new HashMap<>();
    private final Map<UUID, Long> cooldowns = new HashMap<>();

    public CoreWarpService(RucWar plugin) {
        this.plugin = plugin;
    }

    /**
     * 코어로 이동을 시작합니다.
     *
     * @param siteName 거점 이름. null 이면 그 길드의 첫 코어
     * @return 이동을 시작했으면 true. 실패 사유는 이미 안내되었습니다
     */
    public boolean warp(Player player, String siteName) {
        Guild guild = plugin.core().getGuilds().of(player);
        if (guild == null) {
            plugin.msg().send(player, "war.warp-no-guild");
            return false;
        }

        List<String> owned = plugin.getTerritory().siteNamesOf(guild.getId());
        if (owned.isEmpty()) {
            plugin.msg().send(player, "war.warp-no-core");
            return false;
        }

        if (siteName != null && owned.stream().noneMatch(s -> s.equalsIgnoreCase(siteName))) {
            plugin.msg().send(player, "war.warp-not-yours",
                    "sites", String.join(", ", owned));
            return false;
        }

        Location target = plugin.getTerritory().coreLocationOf(guild.getId(), siteName);
        if (target == null) {
            plugin.msg().send(player, "war.warp-no-core");
            return false;
        }

        if (!canTeleport(player)) return false;
        beginWarmup(player, target, siteName == null ? owned.get(0) : siteName);
        return true;
    }

    private boolean canTeleport(Player player) {
        if (warmups.containsKey(player.getUniqueId())) {
            plugin.msg().send(player, "war.warp-already");
            return false;
        }

        long cooldown = plugin.getConfig().getLong("warp.cooldown-seconds", 60) * 1000L;
        Long last = cooldowns.get(player.getUniqueId());
        if (last != null && !player.hasPermission("rucwar.bypass.cooldown")) {
            long left = last + cooldown - System.currentTimeMillis();
            if (left > 0) {
                plugin.msg().send(player, "war.warp-cooldown",
                        "seconds", String.valueOf((int) Math.ceil(left / 1000.0)));
                return false;
            }
        }
        return true;
    }

    private void beginWarmup(Player player, Location target, String siteName) {
        // 전쟁 중에는 더 길게 둡니다. 개전 중 즉시 집결은 수비 쪽이 대응할
        // 시간을 아예 없애 버립니다.
        int seconds = plugin.getSchedule().isOpen()
                ? plugin.getConfig().getInt("warp.warmup-seconds-war", 10)
                : plugin.getConfig().getInt("warp.warmup-seconds", 5);
        if (player.hasPermission("rucwar.bypass.warmup")) seconds = 0;

        if (seconds <= 0) {
            finish(player, target, siteName);
            return;
        }

        UUID uuid = player.getUniqueId();
        plugin.msg().send(player, "war.warp-warmup",
                "site", siteName, "seconds", String.valueOf(seconds));

        final int total = seconds;
        final int[] elapsed = {0};

        BukkitTask task = Bukkit.getScheduler().runTaskTimer(plugin, () -> {
            if (!player.isOnline()) {
                cancel(uuid, false);
                return;
            }
            elapsed[0]++;

            if (elapsed[0] >= total) {
                Warmup done = warmups.remove(uuid);
                if (done != null) done.task().cancel();
                finish(player, target, siteName);
                return;
            }

            plugin.msg().sendActionBar(player, "war.warp-countdown",
                    "seconds", String.valueOf(total - elapsed[0]));
            player.getWorld().spawnParticle(Particle.PORTAL,
                    player.getLocation().add(0, 1, 0), 20, 0.4, 0.8, 0.4, 0.02);
        }, 20L, 20L);

        warmups.put(uuid, new Warmup(task, player.getLocation().clone()));
    }

    private void finish(Player player, Location target, String siteName) {
        cooldowns.put(player.getUniqueId(), System.currentTimeMillis());

        // 코어가 그사이 부서졌을 수 있습니다. 시전 5~10초는 전쟁 중에 충분히
        // 긴 시간입니다. 사라진 좌표로 보내면 허공에 떨어집니다.
        Guild guild = plugin.core().getGuilds().of(player);
        if (guild == null
                || plugin.getTerritory().coreLocationOf(guild.getId(), siteName) == null) {
            plugin.msg().send(player, "war.warp-core-gone");
            return;
        }

        player.teleport(target);
        plugin.msg().send(player, "war.warp-arrived", "site", siteName);
        player.playSound(target, Sound.ENTITY_ENDERMAN_TELEPORT, 0.7f, 1.0f);
    }

    /** 시전 중 이동·피격 시. 리스너에서 부릅니다. */
    public void cancel(UUID uuid, boolean notify) {
        Warmup warmup = warmups.remove(uuid);
        if (warmup == null) return;
        warmup.task().cancel();

        if (!notify) return;
        Player player = Bukkit.getPlayer(uuid);
        if (player != null) {
            plugin.msg().send(player, "war.warp-cancelled");
            plugin.msg().sendActionBar(player, "war.warp-cancelled");
        }
    }

    public boolean isWarmingUp(UUID uuid) {
        return warmups.containsKey(uuid);
    }

    public Location warmupOrigin(UUID uuid) {
        Warmup warmup = warmups.get(uuid);
        return warmup == null ? null : warmup.origin();
    }

    public void clear(UUID uuid) {
        cancel(uuid, false);
        cooldowns.remove(uuid);
    }

    public void stop() {
        for (Warmup warmup : warmups.values()) warmup.task().cancel();
        warmups.clear();
    }
}
