package kr.rucserver.home.service;

import kr.rucserver.home.RucHome;
import kr.rucserver.home.world.PlazaBuilder;
import org.bukkit.Bukkit;
import org.bukkit.Location;
import org.bukkit.Particle;
import org.bukkit.World;
import org.bukkit.entity.Player;
import org.bukkit.scheduler.BukkitTask;

import java.util.concurrent.ThreadLocalRandom;

/**
 * 허브 분위기 연출 — 떨어지는 벚꽃잎과 중앙 포털의 빛.
 *
 * 파티클은 보는 사람에게만 보내면 충분합니다. 월드 전역에 뿌리면
 * 아무도 없는 곳까지 계산하게 되므로, 접속자 주변에만 생성합니다.
 */
public class AmbienceService {

    private final RucHome plugin;
    private BukkitTask task;

    public AmbienceService(RucHome plugin) {
        this.plugin = plugin;
    }

    public void start() {
        task = Bukkit.getScheduler().runTaskTimer(plugin, this::tick, 40L, 4L);
        plugin.getLogger().info("분위기 연출 활성화 (벚꽃잎 · 포털 광채)");
    }

    private void tick() {
        for (Player player : Bukkit.getOnlinePlayers()) {
            if (!plugin.isHubWorld(player.getWorld())) continue;
            cherryFall(player);
            portalGlow(player);
        }
    }

    /** 플레이어 주변 상공에서 꽃잎이 떨어지게 합니다. */
    private void cherryFall(Player player) {
        World world = player.getWorld();
        Location base = player.getLocation();
        ThreadLocalRandom rng = ThreadLocalRandom.current();

        int count = 14;
        for (int i = 0; i < count; i++) {
            double dx = rng.nextDouble(-22, 22);
            double dz = rng.nextDouble(-22, 22);
            double x = base.getX() + dx;
            double z = base.getZ() + dz;

            // 숲 구간에서만 (광장 한가운데에 꽃잎이 쏟아지면 어색합니다)
            double d = Math.hypot(x, z);
            if (d < PlazaBuilder.groveInnerRadius() - 14
                    || d > PlazaBuilder.groveOuterRadius()) continue;

            double y = PlazaBuilder.canopyY() + rng.nextDouble(-3, 7);
            Location at = new Location(world, x, y, z);

            // 떨어지는 꽃잎 — 아주 느린 하강
            world.spawnParticle(Particle.CHERRY_LEAVES, at, 1, 0.4, 0.2, 0.4, 0.0);
        }
    }

    /** 중앙 포털 — 자수정 빛과 소용돌이. */
    private void portalGlow(Player player) {
        World world = player.getWorld();
        Location center = new Location(world, 0.5, PlazaBuilder.groundY() + 14, 0.5);
        if (player.getLocation().distanceSquared(center) > 90 * 90) return;

        ThreadLocalRandom rng = ThreadLocalRandom.current();
        for (int i = 0; i < 6; i++) {
            double a = rng.nextDouble(Math.PI * 2);
            double r = 8.5 + rng.nextDouble(-0.6, 0.6);
            Location at = center.clone().add(Math.cos(a) * r, rng.nextDouble(-8, 2), Math.sin(a) * r);
            world.spawnParticle(Particle.END_ROD, at, 1, 0.05, 0.05, 0.05, 0.0);
        }
        for (int i = 0; i < 3; i++) {
            double a = rng.nextDouble(Math.PI * 2);
            double r = rng.nextDouble(0, 4);
            Location at = center.clone().add(Math.cos(a) * r, rng.nextDouble(-6, 0), Math.sin(a) * r);
            world.spawnParticle(Particle.PORTAL, at, 2, 0.3, 0.6, 0.3, 0.0);
        }
    }

    public void stop() {
        if (task != null) {
            task.cancel();
            task = null;
        }
    }
}
