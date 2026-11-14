package kr.rucserver.rpg.skill;

import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import kr.rucserver.rpg.RucRpg;
import kr.rucserver.rpg.character.PlayerUnit;
import kr.rucserver.rpg.world.RpgWorld;
import net.kyori.adventure.text.Component;
import net.kyori.adventure.text.format.TextColor;
import net.kyori.adventure.text.format.TextDecoration;
import net.kyori.adventure.title.Title;
import org.bukkit.Bukkit;
import org.bukkit.Color;
import org.bukkit.Location;
import org.bukkit.Particle;
import org.bukkit.Sound;
import org.bukkit.World;
import org.bukkit.entity.Entity;
import org.bukkit.entity.Player;
import org.bukkit.util.Vector;

import java.time.Duration;

/**
 * 스킬 연출 (웹 fx.ts 의 마크판). 속성 색 가루 + 바닐라 파티클 · 소리.
 * 궁극기(R)는 모든 스킬 중 가장 화려하게 (2026-11-15 웹 베타 피드백과 같은 방향): 바닥 육망성 마법진 · 빛기둥 · 소용돌이 · 충격파 3겹 · 빛살 · 컷인 타이틀.
 */
public final class SkillVfx {

    private final RucRpg plugin;

    public SkillVfx(RucRpg plugin) { this.plugin = plugin; }

    public Color color(String el) {
        if ("heal".equals(el)) return Color.fromRGB(0x7DFF9A);
        JsonElement c = el == null ? null : plugin.data().get("elements.ELEMENTS." + el + ".color");
        return c == null ? Color.fromRGB(0xF2F2F2) : Color.fromRGB(Integer.parseInt(c.getAsString().substring(1), 16));
    }

    private static Particle.DustOptions dust(Color c, float size) { return new Particle.DustOptions(c, size); }

    /** 시전 시작: 시전 시간이 있으면 발밑 마법진, 궁극기면 큰 연출 */
    public void cast(PlayerUnit p, JsonObject sk, long delayMs, double[] aim) {
        Player pl = p.player;
        String el = SkillDefs.bool(sk, "elementInherit") ? p.el : SkillDefs.str(sk, "el");
        Color col = color(el);
        boolean ult = "R".equals(sk.get("slot").getAsString());
        if (ult) { ultCast(pl, sk.get("name").getAsString(), col); return; }
        if (delayMs >= 200) circle(pl.getLocation().add(0, 0.05, 0), 1.1, col, (int) Math.min(40, delayMs / 50));
        pl.getWorld().playSound(pl.getLocation(), delayMs > 0 ? Sound.BLOCK_ENCHANTMENT_TABLE_USE : Sound.ENTITY_PLAYER_ATTACK_SWEEP, 0.5f, 1.4f);
    }

    /** 바닥 마법진 (원 + 별), ticks 동안 */
    private void circle(Location at, double r, Color col, int ticks) {
        World w = at.getWorld();
        for (int t = 0; t < Math.max(1, ticks); t += 2) {
            final int tt = t;
            Bukkit.getScheduler().runTaskLater(plugin, () -> {
                double rot = tt * 0.08;
                for (int i = 0; i < 28; i++) {
                    double a = i * Math.PI * 2 / 28 + rot;
                    w.spawnParticle(Particle.DUST, at.clone().add(Math.cos(a) * r, 0, Math.sin(a) * r), 1, 0, 0, 0, 0, dust(col, 0.8f));
                }
                for (int k = 0; k < 5; k++) {   // 별 (5꼭지)
                    double a1 = k * Math.PI * 4 / 5 + rot, a2 = (k + 1) * Math.PI * 4 / 5 + rot;
                    for (double f = 0; f <= 1; f += 0.2)
                        w.spawnParticle(Particle.DUST, at.clone().add(Math.cos(a1) * r * (1 - f) + Math.cos(a2) * r * f, 0, Math.sin(a1) * r * (1 - f) + Math.sin(a2) * r * f), 1, 0, 0, 0, 0, dust(col, 0.6f));
                }
            }, t);
        }
    }

    /** 궁극기 시전: 육망성 마법진 2겹 · 빛기둥 · 솟는 입자 · 충격파 + 시전자 화면 컷인 */
    private void ultCast(Player pl, String name, Color col) {
        Location at = pl.getLocation().add(0, 0.05, 0);
        World w = at.getWorld();
        for (int t = 0; t < 24; t += 2) {
            final int tt = t;
            Bukkit.getScheduler().runTaskLater(plugin, () -> {
                double rot = tt * 0.12;
                for (double r : new double[]{1.6, 2.4}) {
                    for (int i = 0; i < 40; i++) {
                        double a = i * Math.PI * 2 / 40 + (r > 2 ? -rot : rot);
                        w.spawnParticle(Particle.DUST, at.clone().add(Math.cos(a) * r, 0, Math.sin(a) * r), 1, 0, 0, 0, 0, dust(col, 1.1f));
                    }
                }
                for (int tri = 0; tri < 2; tri++)   // 육망성 = 삼각형 둘이 반대로 돎
                    for (int k = 0; k < 3; k++) {
                        double s = tri == 0 ? rot : -rot + Math.PI / 3;
                        double a1 = s + k * Math.PI * 2 / 3, a2 = s + (k + 1) * Math.PI * 2 / 3;
                        for (double f = 0; f <= 1; f += 0.1)
                            w.spawnParticle(Particle.DUST, at.clone().add(Math.cos(a1) * 1.6 * (1 - f) + Math.cos(a2) * 1.6 * f, 0, Math.sin(a1) * 1.6 * (1 - f) + Math.sin(a2) * 1.6 * f), 1, 0, 0, 0, 0, dust(Color.WHITE, 0.7f));
                    }
                for (double y = 0; y < 6; y += 0.4) w.spawnParticle(Particle.END_ROD, at.clone().add(0, y, 0), 1, 0.15, 0.05, 0.15, 0.01);
                w.spawnParticle(Particle.DUST, at.clone().add(0, 1, 0), 10, 1.2, 1.0, 1.2, 0, dust(col, 1.4f));
            }, t);
        }
        shock(at, col, 3.5, 0);
        shock(at, Color.WHITE, 2.5, 4);
        w.playSound(at, Sound.ENTITY_WITHER_SPAWN, 0.35f, 1.6f);
        w.playSound(at, Sound.BLOCK_BEACON_ACTIVATE, 1f, 1.2f);
        pl.showTitle(Title.title(Component.text("궁 극 기", TextColor.color(col.asRGB()), TextDecoration.BOLD),
                Component.text("— " + name + " —", TextColor.color(0xFFF4B0)),
                Title.Times.times(Duration.ofMillis(80), Duration.ofMillis(900), Duration.ofMillis(300))));
    }

    /** 퍼지는 고리 */
    private void shock(Location at, Color col, double maxR, int delay) {
        World w = at.getWorld();
        for (int t = 0; t < 8; t++) {
            final double r = maxR * (t + 1) / 8;
            Bukkit.getScheduler().runTaskLater(plugin, () -> {
                int n = (int) (r * 18);
                for (int i = 0; i < n; i++) {
                    double a = i * Math.PI * 2 / n;
                    w.spawnParticle(Particle.DUST, at.clone().add(Math.cos(a) * r, 0.1, Math.sin(a) * r), 1, 0, 0.05, 0, 0, dust(col, 1.2f));
                }
            }, delay + t);
        }
    }

    /** 근접 베기: 앞쪽 부채꼴 */
    public void swing(Player pl, double rangePx, double arcDeg, String el, boolean basic) {
        Location eye = pl.getLocation().add(0, 1.1, 0);
        Vector f = eye.getDirection().setY(0).normalize();
        double r = Math.max(1.2, rangePx / RpgWorld.PX), half = Math.toRadians(arcDeg / 2), base = Math.atan2(f.getZ(), f.getX());
        World w = pl.getWorld();
        Color col = color(el);
        for (int i = 0; i <= 8; i++) {
            double a = base - half + 2 * half * i / 8;
            w.spawnParticle(basic ? Particle.CRIT : Particle.DUST, eye.clone().add(Math.cos(a) * r * 0.9, 0, Math.sin(a) * r * 0.9), 1, 0, 0, 0, 0, basic ? null : dust(col, 1.2f));
        }
        w.spawnParticle(Particle.SWEEP_ATTACK, eye.clone().add(f.clone().multiply(r * 0.6)), 1);
    }

    /** 범위 터짐 (self · ground · target) — 궁극기면 3겹 충격파 · 빛살 · 번쩍 · 불씨 */
    public void burst(World w, double xPx, double yPx, double baseY, double rPx, String el, boolean ult, PlayerUnit by) {
        Location at = new Location(w, xPx / RpgWorld.PX, baseY + 0.2, yPx / RpgWorld.PX);
        double r = Math.max(0.8, rPx / RpgWorld.PX);
        Color col = color(el);
        if (!ult) {
            shock(at, col, r, 0);
            w.spawnParticle(Particle.DUST, at.clone().add(0, 0.5, 0), (int) (r * 12), r * 0.5, 0.4, r * 0.5, 0, dust(col, 1.3f));
            w.playSound(at, "heal".equals(el) ? Sound.BLOCK_AMETHYST_BLOCK_CHIME : Sound.ENTITY_GENERIC_EXPLODE, 0.4f, 1.6f);
            return;
        }
        shock(at, col, r * 1.2, 0);
        shock(at, Color.WHITE, r, 3);
        shock(at, col, r * 0.7, 6);
        for (int i = 0; i < 12; i++) {   // 빛살
            double a = i * Math.PI / 6;
            for (double d = 0.3; d < r * 1.3; d += 0.3)
                w.spawnParticle(Particle.END_ROD, at.clone().add(Math.cos(a) * d, 0.3 + d * 0.15, Math.sin(a) * d), 1, 0, 0, 0, 0);
        }
        w.spawnParticle(Particle.FLASH, at.clone().add(0, 1, 0), 2, 0, 0, 0, 0, Color.WHITE);
        w.spawnParticle(Particle.EXPLOSION_EMITTER, at, 1);
        w.spawnParticle(Particle.LAVA, at, 16, r * 0.4, 0.2, r * 0.4, 0);
        w.playSound(at, Sound.ENTITY_GENERIC_EXPLODE, 1f, 0.8f);
        w.playSound(at, Sound.ITEM_TRIDENT_THUNDER, 0.6f, 1.2f);
    }

    public void heal(Entity e) {
        if (e == null) return;
        e.getWorld().spawnParticle(Particle.HEART, e.getLocation().add(0, e.getHeight() + 0.3, 0), 4, 0.4, 0.2, 0.4, 0);
        e.getWorld().spawnParticle(Particle.HAPPY_VILLAGER, e.getLocation().add(0, 1, 0), 10, 0.4, 0.6, 0.4, 0);
    }

    public void shield(Entity e) {
        if (e == null) return;
        Location c = e.getLocation().add(0, 1, 0);
        for (int i = 0; i < 24; i++) {
            double a = i * Math.PI / 12;
            e.getWorld().spawnParticle(Particle.DUST, c.clone().add(Math.cos(a) * 0.8, Math.sin(a * 2) * 0.5, Math.sin(a) * 0.8), 1, 0, 0, 0, 0, dust(Color.fromRGB(0xF2F2F2), 1f));
        }
        e.getWorld().playSound(c, Sound.ITEM_ARMOR_EQUIP_NETHERITE, 0.6f, 1.4f);
    }

    public void blink(Location from, Location to) {
        from.getWorld().spawnParticle(Particle.PORTAL, from.clone().add(0, 1, 0), 30, 0.3, 0.6, 0.3, 0.3);
        to.getWorld().spawnParticle(Particle.REVERSE_PORTAL, to.clone().add(0, 1, 0), 30, 0.3, 0.6, 0.3, 0.05);
        to.getWorld().playSound(to, Sound.ENTITY_ENDERMAN_TELEPORT, 0.6f, 1.3f);
    }

    public void trail(Location at) { at.getWorld().spawnParticle(Particle.CLOUD, at.clone().add(0, 0.2, 0), 2, 0.1, 0.05, 0.1, 0.01); }

    public void roll(Player pl) {
        pl.getWorld().spawnParticle(Particle.BLOCK, pl.getLocation(), 12, 0.3, 0.05, 0.3, 0, pl.getLocation().add(0, -0.5, 0).getBlock().getBlockData());
        pl.getWorld().playSound(pl.getLocation(), Sound.ENTITY_BREEZE_JUMP, 0.5f, 1.4f);
    }
}
