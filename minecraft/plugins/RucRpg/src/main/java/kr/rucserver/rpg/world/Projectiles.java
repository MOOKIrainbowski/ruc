package kr.rucserver.rpg.world;

import kr.rucserver.rpg.RucRpg;
import kr.rucserver.rpg.engine.Combat;
import kr.rucserver.rpg.engine.Unit;
import org.bukkit.Bukkit;
import org.bukkit.Color;
import org.bukkit.Location;
import org.bukkit.Particle;
import org.bukkit.Sound;
import org.bukkit.Material;
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
        /** 그림 (FxSprites — 팩에 있을 때만) */
        public org.bukkit.entity.ItemDisplay sprite;

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

    /** 성역의 방패 · 대지 성벽 (웹 room.ts wall): 몹 투사체만 막는 선분, 5초 */
    private record Wall(World world, double x1, double y1, double x2, double y2, long until, java.util.List<org.bukkit.entity.BlockDisplay> look) {}
    private final java.util.List<Wall> walls = new java.util.ArrayList<>();

    /** 시전자가 바라보는 쪽 28px 앞에 길이 56px (ux, uy = 바라보는 단위 벡터) */
    public void wall(Unit p, World world, double yBlock, double ux, double uy, Material look) {
        double cx = p.x + ux * 28, cy = p.y + uy * 28;
        double x1 = cx - uy * 28, y1 = cy + ux * 28, x2 = cx + uy * 28, y2 = cy - ux * 28;
        java.util.List<org.bukkit.entity.BlockDisplay> parts = new java.util.ArrayList<>();
        for (int i = 0; i <= 6; i++) {   // 보이는 벽: 얇은 유리 판 7장 (블록을 실제로 놓지 않음 — 플레이어 · 몹 길은 안 막음)
            double t = i / 6.0;
            Location l = new Location(world, (x1 + (x2 - x1) * t) / RpgWorld.PX - 0.25, yBlock, (y1 + (y2 - y1) * t) / RpgWorld.PX - 0.25);
            parts.add(world.spawn(l, org.bukkit.entity.BlockDisplay.class, d -> {
                d.setBlock(look.createBlockData());
                d.setPersistent(false);
                d.setTransformation(new org.bukkit.util.Transformation(new org.joml.Vector3f(), new org.joml.Quaternionf(), new org.joml.Vector3f(0.5f, 2.2f, 0.5f), new org.joml.Quaternionf()));
                d.setBrightness(new org.bukkit.entity.Display.Brightness(15, 15));
            }));
        }
        world.playSound(new Location(world, cx / RpgWorld.PX, yBlock, cy / RpgWorld.PX), Sound.BLOCK_AMETHYST_BLOCK_PLACE, 1f, 0.8f);
        walls.add(new Wall(world, x1, y1, x2, y2, System.currentTimeMillis() + 5000, parts));
    }

    private static double segDist(Wall w, double x, double y) {
        double dx = w.x2() - w.x1(), dy = w.y2() - w.y1(), len2 = dx * dx + dy * dy;
        double t = len2 == 0 ? 0 : Math.max(0, Math.min(1, ((x - w.x1()) * dx + (y - w.y1()) * dy) / len2));
        return Math.hypot(x - (w.x1() + dx * t), y - (w.y1() + dy * t));
    }

    /** 스킬 시험(SkillTest)용: 마지막으로 끝난 투사체가 왜 끝났나 */
    public static volatile String lastEnd = "";

    public Shot fire(Shot s) {
        Location at = new Location(s.world, s.x / RpgWorld.PX, s.yBlock, s.y / RpgWorld.PX);
        boolean arrow = s.spec != null && "physical".equals(s.spec.cat);
        float yaw = (float) Math.toDegrees(Math.atan2(-s.ux, s.uy));
        s.sprite = plugin.skills() == null ? null : plugin.skills().vfx().sprites().projectile(at, arrow ? "arrow" : "orb",
                org.bukkit.Color.fromRGB(s.color.asRGB()), s.big ? 1.4f : arrow ? 0.9f : 0.7f, yaw);
        shots.add(s);
        return s;
    }

    private void tick() {
        long now = System.currentTimeMillis();
        walls.removeIf(wl -> { if (now < wl.until()) return false; wl.look().forEach(org.bukkit.entity.Entity::remove); return true; });
        Iterator<Shot> it = shots.iterator();
        while (it.hasNext()) {
            Shot s = it.next();
            boolean alive = step(s);
            if (s.sprite != null) {
                if (alive && s.sprite.isValid()) s.sprite.teleport(new Location(s.world, s.x / RpgWorld.PX, s.yBlock, s.y / RpgWorld.PX));
                else s.sprite.remove();
            }
            if (!alive) it.remove();
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
            if (l.getBlock().getType().isSolid()) { s.world.spawnParticle(Particle.SMOKE, l, 4, 0.05, 0.05, 0.05, 0.01); lastEnd = "블록 " + l.getBlock().getType() + " @" + l.getBlockX() + "," + l.getBlockY() + "," + l.getBlockZ() + " (" + Math.round(s.traveled) + "px)"; return false; }
            s.world.spawnParticle(Particle.DUST, l, s.big ? 3 : 1, 0.02, 0.02, 0.02, 0, dust);
            if (s.owner.dead) return false;
            if (!s.owner.isPlayer()) for (Wall wl : walls)
                if (wl.world().equals(s.world) && segDist(wl, s.x, s.y) <= s.width / 2 + 3) { s.world.spawnParticle(Particle.END_ROD, l, 6, 0.1, 0.1, 0.1, 0.02); return false; }
            String foeKind = s.owner.isPlayer() ? "m" : "p";
            for (Unit u : w.around(s.x, s.y, s.width / 2, foeKind)) {
                if (!w.hostile(s.owner, u) || s.hit.contains(u.id)) continue;
                s.hit.add(u.id);
                lastEnd = "명중 " + u.name + "#" + u.id;
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
            if (s.traveled >= s.range) { lastEnd = "사거리 끝 " + Math.round(s.traveled) + "px"; return false; }
        }
        return true;
    }
}
