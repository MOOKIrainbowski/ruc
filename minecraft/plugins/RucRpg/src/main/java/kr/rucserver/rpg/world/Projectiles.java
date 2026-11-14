package kr.rucserver.rpg.world;

import kr.rucserver.rpg.RucRpg;
import kr.rucserver.rpg.engine.Combat;
import kr.rucserver.rpg.engine.Unit;
import org.bukkit.Bukkit;
import org.bukkit.Color;
import org.bukkit.Location;
import org.bukkit.Particle;
import org.bukkit.World;

import java.util.ArrayList;
import java.util.HashSet;
import java.util.Iterator;
import java.util.List;
import java.util.Set;
import java.util.function.BiConsumer;

/**
 * 투사체 (웹 room.shoot): px 단위로 직선 이동, 폭 안의 적에게 맞으면 피해. 관통(pierce) · 튕김(bounce) · 사거리.
 * 블록에 막히면 사라짐. 모양 = 속성 색 가루 꼬리 (궁극기 투사체는 굵게 · M3 에서 스킬별 이펙트).
 */
public final class Projectiles {

    public static final class Shot {
        public final Unit owner;
        public final World world;
        public double x, y, ux, uy;
        public final double yBlock, speed, range, width;
        public final Combat.HitSpec spec;
        public int pierce, bounce;
        public double traveled;
        public final Color color;
        public final boolean big;
        public final Set<Integer> hit = new HashSet<>();
        /** 맞힌 뒤 (숙련도 · 스킬 부가 처리) */
        public BiConsumer<Shot, Unit> onHit = (s, u) -> {};

        public Shot(Unit owner, World world, double x, double y, double yBlock, double dx, double dy, double speed, double range, double width,
                    Combat.HitSpec spec, int pierce, int bounce, Color color, boolean big) {
            this.owner = owner; this.world = world; this.x = x; this.y = y; this.yBlock = yBlock;
            double len = Math.hypot(dx, dy);
            if (len == 0) len = 1;
            this.ux = dx / len; this.uy = dy / len;
            this.speed = speed; this.range = range; this.width = width; this.spec = spec;
            this.pierce = pierce; this.bounce = bounce; this.color = color; this.big = big;
        }
    }

    private final RucRpg plugin;
    private final RpgWorld w;
    private final Combat combat;
    private final List<Shot> shots = new ArrayList<>();

    public Projectiles(RucRpg plugin, RpgWorld w, Combat combat) {
        this.plugin = plugin;
        this.w = w;
        this.combat = combat;
        Bukkit.getScheduler().runTaskTimer(plugin, this::tick, 1L, 1L);
    }

    public Shot fire(Shot s) {
        shots.add(s);
        return s;
    }

    private void tick() {
        Iterator<Shot> it = shots.iterator();
        while (it.hasNext()) {
            Shot s = it.next();
            if (!step(s)) it.remove();
        }
    }

    /** 한 틱(50ms) 이동 — 4조각으로 나눠 판정 (빠른 화살이 몹을 건너뛰지 않게) */
    private boolean step(Shot s) {
        double total = s.speed * 0.05;
        Particle.DustOptions dust = new Particle.DustOptions(s.color, s.big ? 1.8f : 1.0f);
        for (int k = 0; k < 4; k++) {
            double d = total / 4;
            s.x += s.ux * d;
            s.y += s.uy * d;
            s.traveled += d;
            Location l = new Location(s.world, s.x / RpgWorld.PX, s.yBlock, s.y / RpgWorld.PX);
            if (l.getBlock().getType().isSolid()) { s.world.spawnParticle(Particle.SMOKE, l, 4, 0.05, 0.05, 0.05, 0.01); return false; }
            s.world.spawnParticle(Particle.DUST, l, s.big ? 3 : 1, 0.02, 0.02, 0.02, 0, dust);
            if (s.owner.dead) return false;
            String foeKind = s.owner.isPlayer() ? "m" : "p";
            for (Unit u : w.around(s.x, s.y, s.width / 2, foeKind)) {
                if (!w.hostile(s.owner, u) || s.hit.contains(u.id)) continue;
                s.hit.add(u.id);
                combat.hit(w, s.owner, u, s.spec);
                s.onHit.accept(s, u);
                if (s.bounce > 0) {   // 튕김: 다음 가까운 적에게
                    Unit next = null;
                    double bd = 120;
                    for (Unit o : w.around(u.x, u.y, 120, foeKind))
                        if (!s.hit.contains(o.id) && Math.hypot(o.x - u.x, o.y - u.y) < bd) { bd = Math.hypot(o.x - u.x, o.y - u.y); next = o; }
                    if (next != null) {
                        s.bounce--;
                        double dx = next.x - u.x, dy = next.y - u.y, len = Math.max(1, Math.hypot(dx, dy));
                        s.ux = dx / len; s.uy = dy / len; s.x = u.x; s.y = u.y; s.traveled = Math.max(0, s.range - 140);
                        continue;
                    }
                }
                if (s.pierce-- <= 0) return false;
            }
            if (s.traveled >= s.range) return false;
        }
        return true;
    }
}
