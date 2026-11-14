package kr.rucserver.rpg.world;

import kr.rucserver.rpg.RucRpg;
import org.bukkit.Bukkit;
import org.bukkit.Color;
import org.bukkit.Location;
import org.bukkit.Particle;
import org.bukkit.World;
import org.bukkit.scheduler.BukkitTask;

/**
 * 바닥 경고 (웹 "w" 이벤트, §10-2 "읽고 피할 수 있는" 선딜): 원 · 직선을 붉은 가루로 windMs 동안 그림.
 * 끝으로 갈수록 안쪽이 차오름 (웹의 차오르는 경고 장판과 같은 뜻). 좌표는 px.
 */
public final class Telegraph {

    private static final Particle.DustOptions EDGE = new Particle.DustOptions(Color.fromRGB(0xFF3B30), 1.1f);
    private static final Particle.DustOptions FILL = new Particle.DustOptions(Color.fromRGB(0xFF8A3D), 0.9f);

    private Telegraph() {}

    public static void circle(RucRpg plugin, World w, double xPx, double yPx, double baseY, double rPx, long ms) {
        double cx = xPx / RpgWorld.PX, cz = yPx / RpgWorld.PX, r = rPx / RpgWorld.PX;
        run(plugin, ms, t -> {
            int n = Math.max(16, (int) (r * 14));
            for (int i = 0; i < n; i++) {
                double a = i * Math.PI * 2 / n;
                w.spawnParticle(Particle.DUST, new Location(w, cx + Math.cos(a) * r, baseY + 0.12, cz + Math.sin(a) * r), 1, 0, 0, 0, 0, EDGE);
            }
            double fr = r * t;   // 차오르는 안쪽 원
            int m = Math.max(8, (int) (fr * 10));
            for (int i = 0; i < m; i++) {
                double a = i * Math.PI * 2 / m;
                w.spawnParticle(Particle.DUST, new Location(w, cx + Math.cos(a) * fr, baseY + 0.1, cz + Math.sin(a) * fr), 1, 0, 0, 0, 0, FILL);
            }
        });
    }

    public static void line(RucRpg plugin, World w, double xPx, double yPx, double baseY, double ang, double lenPx, double widthPx, long ms) {
        double sx = xPx / RpgWorld.PX, sz = yPx / RpgWorld.PX, len = lenPx / RpgWorld.PX, hw = Math.max(0.3, widthPx / RpgWorld.PX / 2);
        double ux = Math.cos(ang), uz = Math.sin(ang);
        run(plugin, ms, t -> {
            for (double d = 0; d <= len; d += 0.35) {
                for (int side = -1; side <= 1; side += 2)
                    w.spawnParticle(Particle.DUST, new Location(w, sx + ux * d - uz * hw * side, baseY + 0.12, sz + uz * d + ux * hw * side), 1, 0, 0, 0, 0, EDGE);
                if (d <= len * t) w.spawnParticle(Particle.DUST, new Location(w, sx + ux * d, baseY + 0.1, sz + uz * d), 1, hw / 3, 0, hw / 3, 0, FILL);
            }
        });
    }

    private interface Frame { void draw(double t); }

    private static void run(RucRpg plugin, long ms, Frame f) {
        long ticks = Math.max(1, ms / 50);
        final BukkitTask[] task = new BukkitTask[1];
        final long[] i = {0};
        task[0] = Bukkit.getScheduler().runTaskTimer(plugin, () -> {
            if (i[0] > ticks) { task[0].cancel(); return; }
            if (i[0] % 3 == 0) f.draw(Math.min(1, (double) i[0] / ticks));
            i[0]++;
        }, 0L, 1L);
    }
}
