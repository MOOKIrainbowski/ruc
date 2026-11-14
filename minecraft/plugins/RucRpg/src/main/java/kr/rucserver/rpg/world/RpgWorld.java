package kr.rucserver.rpg.world;

import kr.rucserver.rpg.RucRpg;
import kr.rucserver.rpg.character.PlayerUnit;
import kr.rucserver.rpg.engine.Combat;
import kr.rucserver.rpg.engine.Unit;
import kr.rucserver.rpg.engine.World;
import kr.rucserver.rpg.mob.MobUnit;
import net.kyori.adventure.text.Component;
import net.kyori.adventure.text.format.NamedTextColor;
import net.kyori.adventure.text.format.TextColor;
import net.kyori.adventure.text.format.TextDecoration;
import org.bukkit.Bukkit;
import org.bukkit.Color;
import org.bukkit.Location;
import org.bukkit.Particle;
import org.bukkit.Sound;
import org.bukkit.entity.Display;
import org.bukkit.entity.Entity;
import org.bukkit.entity.LivingEntity;
import org.bukkit.entity.TextDisplay;
import org.bukkit.util.Transformation;
import org.bukkit.util.Vector;
import org.joml.AxisAngle4f;
import org.joml.Vector3f;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

/**
 * 전투 엔진의 World 를 마크로: 유닛 목록(플레이어 · 몹), 범위 찾기, 넉백, 피해 숫자, 처치 처리.
 * 좌표 변환: px = 블록 × 16 (계획서 R3). 유닛의 y(px) = 마크 Z.
 */
public final class RpgWorld implements World {

    public static final double PX = 16;

    private final RucRpg plugin;
    private final Map<Integer, Unit> units = new ConcurrentHashMap<>();
    /** 처치 · 사망 처리 (MobRuntime · PlayerRuntime 이 채움) */
    public java.util.function.BiConsumer<Unit, Unit> onKilled = (u, by) -> {};
    /** 피해 기록 (몹 위협) */
    public DamagedHook onDamaged = (s, t, a, th, h) -> {};

    public interface DamagedHook { void on(Unit src, Unit tgt, double amount, double threat, Combat.HitSpec h); }
    /** 직접 타격 뒤 (장비 내구도 · 발동 효과) */
    public StruckHook onStruck = (s, t, a, h) -> {};
    public interface StruckHook { void on(Unit src, Unit tgt, double amount, Combat.HitSpec h); }

    @Override
    public void struck(Unit src, Unit tgt, double amount, Combat.HitSpec h) { onStruck.on(src, tgt, amount, h); }

    public RpgWorld(RucRpg plugin) { this.plugin = plugin; }

    public void add(Unit u) { units.put(u.id, u); }
    public void remove(Unit u) { units.remove(u.id); }
    public Iterable<Unit> all() { return units.values(); }

    /** 마크 위치 → 유닛 px */
    public static void place(Unit u, Location l) {
        u.x = l.getX() * PX;
        u.y = l.getZ() * PX;
    }

    public Entity entityOf(Unit u) {
        if (u instanceof PlayerUnit p) return p.player;
        if (u instanceof MobUnit m) return m.body;
        return null;
    }

    private org.bukkit.World worldOf(Unit u) {
        Entity e = entityOf(u);
        return e == null ? null : e.getWorld();
    }

    @Override public long now() { return System.currentTimeMillis(); }
    @Override public Unit unit(int id) { return units.get(id); }

    @Override
    public List<Unit> around(double x, double y, double r, String kind) {
        List<Unit> out = new ArrayList<>();
        for (Unit u : units.values()) if (!u.dead && u.kind.equals(kind) && Math.hypot(u.x - x, u.y - y) <= r + u.r) out.add(u);
        return out;
    }

    /** 몹 ↔ 플레이어는 늘 적, 플레이어끼리는 결투 상대 · 결투장의 다른 파티만 (M7) */
    @Override
    public boolean hostile(Unit a, Unit b) {
        if (!a.kind.equals(b.kind)) return true;
        if (a instanceof PlayerUnit pa && b instanceof PlayerUnit pb && plugin.duels() != null) return plugin.duels().hostile(pa, pb);
        return false;
    }

    @Override
    public boolean spare(Unit src, Unit u) { return plugin.duels() != null && plugin.duels().spare(src, u); }

    @Override
    public void damaged(Unit src, Unit tgt, double amount, double threat, Combat.HitSpec h) { onDamaged.on(src, tgt, amount, threat, h); }

    @Override
    public void killed(Unit u, Unit by) { onKilled.accept(u, by); }

    @Override
    public void push(Unit u, double dx, double dy) {
        Entity e = entityOf(u);
        if (e == null || u.has("unstoppable")) return;
        // px → 블록 속도. 0.3초 동안 밀리는 느낌 (웹 넉백 거리와 비슷하게)
        e.setVelocity(e.getVelocity().add(new Vector(dx / PX / 3.2, 0.18, dy / PX / 3.2)));
    }

    // ── 화면 표시 ───────────────────────────────────────────────────

    @Override
    public void show(Unit src, Unit tgt, double amount, int flag, String el) {
        Entity e = entityOf(tgt);
        if (e == null) return;
        Location at = e.getLocation().add((Math.random() - 0.5) * 0.6, e.getHeight() + 0.25, (Math.random() - 0.5) * 0.6);
        String text;
        TextColor color;
        float scale = 1f;
        switch (flag) {
            case Combat.H_CRIT -> { text = (long) amount + "!"; color = TextColor.color(0xFFD23F); scale = 1.6f; }
            case Combat.H_HEAL -> { text = "+" + (long) amount; color = TextColor.color(0x4CC764); }
            case Combat.H_DOT -> { text = String.valueOf((long) amount); color = TextColor.color(0xB28DFF); scale = 0.8f; }
            case Combat.H_IMMUNE -> { text = "면역"; color = NamedTextColor.GRAY; }
            case Combat.H_MISS -> { text = "빗나감"; color = NamedTextColor.GRAY; }
            case Combat.H_RESIST -> { text = "저항"; color = TextColor.color(0xFF7EB6); }
            case Combat.H_COUNTER -> { text = "반격!"; color = TextColor.color(0x9AA3AD); scale = 1.3f; }
            default -> { text = String.valueOf((long) amount); color = tgt.isPlayer() ? TextColor.color(0xFF5A5A) : NamedTextColor.WHITE; }
        }
        if (el != null && flag == 0 && plugin.data().get("elements.ELEMENTS." + el) != null)
            color = TextColor.fromHexString(plugin.data().get("elements.ELEMENTS." + el + ".color").getAsString());
        floatText(at, Component.text(text, color, TextDecoration.BOLD), scale);
        if (amount > 0 && flag != Combat.H_HEAL) hurtFlash(tgt);
        if (flag == Combat.H_CRIT) {
            e.getWorld().spawnParticle(Particle.CRIT, at, 14, 0.3, 0.3, 0.3, 0.2);
            e.getWorld().playSound(at, Sound.ENTITY_PLAYER_ATTACK_CRIT, 0.8f, 1f);
        }
    }

    /** 떠오르며 사라지는 글자 (피해 숫자 · 반응 이름) */
    public void floatText(Location at, Component text, float scale) {
        TextDisplay d = at.getWorld().spawn(at, TextDisplay.class, t -> {
            t.text(text);
            t.setBillboard(Display.Billboard.CENTER);
            t.setShadowed(true);
            t.setBackgroundColor(Color.fromARGB(0, 0, 0, 0));
            t.setSeeThrough(true);
            t.setPersistent(false);
            t.setTransformation(new Transformation(new Vector3f(), new AxisAngle4f(), new Vector3f(scale, scale, scale), new AxisAngle4f()));
            t.setTeleportDuration(14);
        });
        Bukkit.getScheduler().runTaskLater(plugin, () -> { if (d.isValid()) d.teleport(d.getLocation().add(0, 0.9, 0)); }, 1L);
        Bukkit.getScheduler().runTaskLater(plugin, d::remove, 16L);
    }

    @Override
    public void reaction(Unit tgt, String name) {
        Entity e = entityOf(tgt);
        if (e == null) return;
        floatText(e.getLocation().add(0, e.getHeight() + 0.8, 0), Component.text(name, TextColor.color(0xFFE14D), TextDecoration.BOLD), 1.3f);
        e.getWorld().spawnParticle(Particle.FLASH, e.getLocation().add(0, 1, 0), 1, 0, 0, 0, 0, Color.WHITE);
    }

    @Override
    public void revived(Unit u) {
        Entity e = entityOf(u);
        if (e == null) return;
        e.getWorld().spawnParticle(Particle.TOTEM_OF_UNDYING, e.getLocation().add(0, 1, 0), 40, 0.4, 0.8, 0.4, 0.3);
        e.getWorld().playSound(e.getLocation(), Sound.ITEM_TOTEM_USE, 0.7f, 1.3f);
    }

    /** 맞은 쪽 붉은 깜빡임 (바닐라 피격 연출) */
    public void hurtFlash(Unit u) {
        if (entityOf(u) instanceof LivingEntity le) le.playHurtAnimation(0);
    }

    /** 나중에 (room.later) */
    public void later(long ms, Runnable r) { Bukkit.getScheduler().runTaskLater(plugin, r, Math.max(1, ms / 50)); }

    public org.bukkit.World bukkitWorld(Unit u) { return worldOf(u); }
}
