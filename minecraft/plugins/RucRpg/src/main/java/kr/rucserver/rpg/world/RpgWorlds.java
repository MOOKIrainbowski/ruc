package kr.rucserver.rpg.world;

import kr.rucserver.rpg.RucRpg;
import kr.rucserver.rpg.mob.MobUnit;
import net.kyori.adventure.text.Component;
import net.kyori.adventure.text.format.NamedTextColor;
import net.kyori.adventure.text.format.TextColor;
import net.kyori.adventure.title.Title;
import org.bukkit.Bukkit;
import org.bukkit.Difficulty;
import org.bukkit.GameRule;
import org.bukkit.Location;
import org.bukkit.Particle;
import org.bukkit.Sound;
import org.bukkit.World;
import org.bukkit.WorldCreator;
import org.bukkit.entity.Player;
import org.bukkit.event.EventHandler;
import org.bukkit.event.EventPriority;
import org.bukkit.event.Listener;
import org.bukkit.event.player.PlayerJoinEvent;
import org.bukkit.event.player.PlayerRespawnEvent;

import java.time.Duration;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * RPG 맵마다 마크 월드 하나 (rpg_plaza · rpg_field · rpg_highland · rpg_arena · rpg_dungeon). 빈 월드 + MapBuilder.
 * 켤 때마다 맵 JSON 에서 몹 구역 · 포털 · NPC 자리 · 시작 위치를 다시 읽음 (블록은 /rpgadmin build 때만).
 * 광장(plaza) = 안전지대 (웹과 같음: 스태미나 소모 없음 · 공격/스킬 불가).
 */
public final class RpgWorlds implements Listener {

    public static final List<String> KINDS = List.of("plaza", "field", "highland", "arena", "dungeon");
    public static final Map<String, String> NAMES = Map.of("plaza", "햇살광장 솔라스", "field", "햇살 초원", "highland", "황혼 고원", "arena", "결투장", "dungeon", "고목의 유적");

    public record Portal(String world, double x0, double z0, double x1, double z1, String target, double ax, double ay) {}

    private final RucRpg plugin;
    private final Map<String, RpgMap> maps = new HashMap<>();
    private final Map<String, World> worlds = new HashMap<>();
    private final List<Portal> portals = new ArrayList<>();
    private final Map<UUID, Long> portalCd = new HashMap<>();
    /** NPC 자리 (맵 kind → 목록) — NpcRuntime 이 씀 */
    public final Map<String, List<RpgMap.Obj>> npcs = new HashMap<>();

    public RpgWorlds(RucRpg plugin) {
        this.plugin = plugin;
        for (String k : KINDS) {
            try {
                RpgMap m = new RpgMap(k, plugin.getClass().getClassLoader());
                maps.put(k, m);
                World w = new WorldCreator("rpg_" + k).generator(new VoidGen()).generateStructures(false).createWorld();
                rules(w);
                worlds.put(k, w);
                register(k, m, w);
            } catch (Exception e) {
                plugin.getLogger().warning("맵 " + k + " 을 열지 못함: " + e.getMessage());
            }
        }
        Bukkit.getScheduler().runTaskTimer(plugin, this::portalTick, 10L, 5L);
    }

    private static void rules(World w) {
        w.setDifficulty(Difficulty.NORMAL);
        w.setGameRule(GameRule.DO_MOB_SPAWNING, false);
        w.setGameRule(GameRule.DO_WEATHER_CYCLE, false);
        w.setGameRule(GameRule.DO_FIRE_TICK, false);
        w.setGameRule(GameRule.MOB_GRIEFING, false);
        w.setGameRule(GameRule.KEEP_INVENTORY, true);
        w.setGameRule(GameRule.NATURAL_REGENERATION, false);
        w.setGameRule(GameRule.ANNOUNCE_ADVANCEMENTS, false);
        w.setGameRule(GameRule.DO_TRADER_SPAWNING, false);
        w.setGameRule(GameRule.DO_PATROL_SPAWNING, false);
        w.setGameRule(GameRule.SPAWN_RADIUS, 0);
        w.setStorm(false);
        w.setClearWeatherDuration(Integer.MAX_VALUE);
    }

    public World world(String kind) { return worlds.get(kind); }
    public RpgMap map(String kind) { return maps.get(kind); }

    public String kindOf(World w) {
        for (var e : worlds.entrySet()) if (e.getValue().equals(w)) return e.getKey();
        return null;
    }

    public boolean isPlaza(Location l) { return l.getWorld() != null && l.getWorld().equals(worlds.get("plaza")); }

    /** 몹 구역 · 포털 · NPC · 시작 위치 */
    private void register(String kind, RpgMap m, World w) {
        MapBuilder b = new MapBuilder(plugin, m, w);
        for (RpgMap.Obj o : m.objects) {
            switch (o.type()) {
                case "spawn" -> {
                    Location s = b.at(o.cx(), o.cy());
                    w.setSpawnLocation(s);
                }
                case "spawn_zone" -> {
                    String[] lv = o.prop("lv") == null ? new String[]{"1", "1"} : o.prop("lv").split("-");
                    double cxPx = o.cx() * 2, cyPx = o.cy() * 2;   // 맵 px → 전투 px (블록 × 16)
                    MobUnit.Zone z = new MobUnit.Zone(o.prop("mob"), Integer.parseInt(o.prop("count") == null ? "5" : o.prop("count")),
                            Integer.parseInt(lv[0]), Integer.parseInt(lv[lv.length - 1]), o.prop("grade") == null ? "normal" : o.prop("grade"),
                            w.getName(), cxPx, cyPx, Math.min(o.w(), o.h()), b.at(o.cx(), o.cy()).getY());
                    plugin.mobs().addZone(z);
                    for (int i = 0; i < z.count; i++) z.respawn.add(System.currentTimeMillis() + 2000 + i * 300L);   // 켤 때 차례로
                }
                case "portal" -> {
                    String t = o.prop("target");
                    if (t != null) portals.add(new Portal(w.getName(), o.x() / 8 - 1, o.y() / 8 - 1, (o.x() + o.w()) / 8 + 1, (o.y() + o.h()) / 8 + 1, t,
                            Double.parseDouble(o.prop("ax") == null ? "0" : o.prop("ax")), Double.parseDouble(o.prop("ay") == null ? "0" : o.prop("ay"))));
                }
                case "npc" -> npcs.computeIfAbsent(kind, k -> new ArrayList<>()).add(o);
                default -> {}
            }
        }
    }

    /** /rpgadmin build <맵> */
    public boolean build(String kind, Runnable done) {
        RpgMap m = maps.get(kind);
        World w = worlds.get(kind);
        if (m == null || w == null) return false;
        new MapBuilder(plugin, m, w).buildAsync(done);
        return true;
    }

    /** 지어진 맵의 시작 위치 (안 지었으면 null — 빈 월드로 떨어지지 않게) */
    public Location spawn(String kind) {
        World w = worlds.get(kind);
        if (w == null) return null;
        Location s = w.getSpawnLocation().clone().add(0.5, 0, 0.5);
        return s.clone().add(0, -1, 0).getBlock().isPassable() && s.clone().add(0, -2, 0).getBlock().isPassable() ? null : s;
    }

    public boolean built(String kind) { return spawn(kind) != null; }

    /** 맵 px 좌표 → 그 맵의 서 있을 곳 */
    public Location at(String kind, double px, double py) {
        RpgMap m = maps.get(kind);
        World w = worlds.get(kind);
        return m == null || w == null ? null : new MapBuilder(plugin, m, w).at(px, py);
    }

    private void portalTick() {
        long now = System.currentTimeMillis();
        for (Portal p : portals) {
            World w = Bukkit.getWorld(p.world());
            if (w == null) continue;
            double cx = (p.x0() + p.x1()) / 2, cz = (p.z0() + p.z1()) / 2;
            Location c = new Location(w, cx, MapBuilder.BASE_Y + 2, cz);
            w.spawnParticle(Particle.PORTAL, c, 6, 1, 1.2, 0.3, 0.3);
            for (Player pl : w.getPlayers()) {
                Location l = pl.getLocation();
                if (l.getX() < p.x0() || l.getX() > p.x1() || l.getZ() < p.z0() || l.getZ() > p.z1() || l.getY() > MapBuilder.BASE_Y + 12) continue;
                if (now < portalCd.getOrDefault(pl.getUniqueId(), 0L)) continue;
                portalCd.put(pl.getUniqueId(), now + 3000);
                go(pl, p.target(), p.ax(), p.ay());
            }
        }
    }

    /** 다른 맵으로 (던전은 M7 에서 파티 인스턴스로) */
    public void go(Player pl, String kind, double ax, double ay) {
        Location to = ax > 0 || ay > 0 ? at(kind, ax, ay) : spawn(kind);
        if (to == null) { pl.sendMessage(Component.text("아직 지어지지 않은 맵입니다: " + kind, NamedTextColor.RED)); return; }
        to.setYaw(pl.getLocation().getYaw());
        pl.teleport(to);
        pl.playSound(to, Sound.BLOCK_PORTAL_TRAVEL, 0.25f, 1.6f);
        pl.showTitle(Title.title(Component.text(NAMES.getOrDefault(kind, kind), TextColor.color(0xF2C94C)), Component.empty(),
                Title.Times.times(Duration.ofMillis(200), Duration.ofMillis(1500), Duration.ofMillis(400))));
    }

    /** RPG 서버에 오면 광장으로 (처음 · 매번 — 웹 RPG 도 접속하면 광장) */
    @EventHandler(priority = EventPriority.HIGH)
    public void onJoin(PlayerJoinEvent e) {
        Location s = spawn("plaza");
        if (s != null && kindOf(e.getPlayer().getWorld()) == null) e.getPlayer().teleport(s);
    }

    @EventHandler(priority = EventPriority.HIGH)
    public void onRespawn(PlayerRespawnEvent e) {
        Location s = spawn("plaza");
        if (s != null) e.setRespawnLocation(s);
    }
}
