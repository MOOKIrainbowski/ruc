package kr.rucserver.rpg.world;

import com.google.gson.JsonObject;
import kr.rucserver.rpg.RucRpg;
import net.kyori.adventure.text.Component;
import net.kyori.adventure.text.format.NamedTextColor;
import org.bukkit.Location;
import org.bukkit.Material;
import org.bukkit.Particle;
import org.bukkit.Sound;
import org.bukkit.World;
import org.bukkit.block.Block;
import org.bukkit.entity.Player;
import org.bukkit.event.EventHandler;
import org.bukkit.event.Listener;
import org.bukkit.event.block.Action;
import org.bukkit.event.player.PlayerInteractEvent;
import org.bukkit.inventory.EquipmentSlot;
import org.bukkit.inventory.ItemStack;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Random;
import java.util.UUID;

/**
 * 채집 (웹 room.ts gather · P13 D94): 필드 · 고원 몹 구역마다 3곳. 우클릭으로 캐면 재료 1개, respawnMs 뒤 다시 생김.
 * 자리는 (맵, 구역 번호)로 시드한 난수라 켤 때마다 같은 곳 — 서버가 꺼질 때 비어 있던 블록도 켤 때 다시 놓으면 됨.
 * 마크 표시: 약초 = 반딧불이 덤불(맵 장식에 없는 풀 — 장식 고사리와 헷갈리지 않게) · 푸른 약초 = 파란 난초 · 광석 = 철광석 블록 (빈 자리 = 공기), 캘 수 있으면 반짝이 입자.
 */
public final class Gathering implements Listener {

    private static final Map<String, Material> LOOK = Map.of("herb", Material.FIREFLY_BUSH, "blue_herb", Material.BLUE_ORCHID, "ore", Material.IRON_ORE);

    private static final class Node {
        final String kind; final Block block; long readyAt;
        Node(String kind, Block block) { this.kind = kind; this.block = block; }
    }

    private final RucRpg plugin;
    private final JsonObject defs;
    private final Map<Block, Node> nodes = new HashMap<>();
    private final Map<UUID, Long> cd = new HashMap<>();

    public Gathering(RucRpg plugin) {
        this.plugin = plugin;
        this.defs = plugin.data().file("items").getAsJsonObject("GATHER");
        plugin.getServer().getScheduler().runTaskTimer(plugin, this::tick, 40L, 20L);
    }

    /** 맵을 지은 뒤 · 켤 때 (지어진 맵만) */
    public void place(String kind) {
        if (!kind.equals("field") && !kind.equals("highland")) return;
        RpgMap m = plugin.worlds().map(kind);
        World w = plugin.worlds().world(kind);
        if (m == null || w == null || !plugin.worlds().built(kind)) return;
        nodes.values().removeIf(n -> n.block.getWorld().equals(w));
        double total = 0;
        for (String k : defs.keySet()) total += defs.getAsJsonObject(k).get("w").getAsDouble();
        for (RpgMap.Obj o : m.objects) {
            if (!o.type().equals("spawn_zone")) continue;
            Random rnd = new Random(kind.hashCode() * 31L + o.id());
            double r = Math.min(o.w(), o.h()) / 2 * 1.3;
            for (int i = 0; i < 3; i++) {
                double x = rnd.nextDouble() * total;
                String pick = "herb";
                for (String k : defs.keySet()) { x -= defs.getAsJsonObject(k).get("w").getAsDouble(); if (x < 0) { pick = k; break; } }
                for (int t = 0; t < 12; t++) {
                    double a = rnd.nextDouble() * Math.PI * 2, d = Math.sqrt(rnd.nextDouble()) * r;
                    double px = o.cx() + Math.cos(a) * d, py = o.cy() + Math.sin(a) * d;
                    int tx = (int) Math.floor(px / 16), ty = (int) Math.floor(py / 16);
                    if (tx < 0 || ty < 0 || tx >= m.w || ty >= m.h || m.collision[ty * m.w + tx] != 0 || m.water[ty * m.w + tx] != 0) continue;
                    Location l = plugin.worlds().at(kind, px, py);
                    if (l == null) continue;
                    Block b = l.getBlock();
                    if (!b.getType().isAir() && !LOOK.containsValue(b.getType()) && !b.isPassable()) continue;
                    if (b.getRelative(0, -1, 0).isPassable()) continue;
                    Node n = new Node(pick, b);
                    b.setType(LOOK.get(pick), false);
                    nodes.put(b, n);
                    break;
                }
            }
        }
        plugin.getLogger().info("채집 지점 " + kind + ": " + nodes.values().stream().filter(n -> n.block.getWorld().equals(w)).count());
    }

    @EventHandler
    public void onUse(PlayerInteractEvent e) {
        if (e.getHand() != EquipmentSlot.HAND || e.getAction() != Action.RIGHT_CLICK_BLOCK || e.getClickedBlock() == null) return;
        Node n = nodes.get(e.getClickedBlock());
        if (n == null) return;
        e.setCancelled(true);
        Player p = e.getPlayer();
        if (plugin.runtime().unit(p) == null || plugin.runtime().unit(p).dead) return;
        long now = System.currentTimeMillis();
        if (now < n.readyAt) { p.sendActionBar(Component.text("이미 누가 캐 갔어요 — 잠시 뒤에 다시 생깁니다", NamedTextColor.GRAY)); return; }
        if (now < cd.getOrDefault(p.getUniqueId(), 0L)) return;
        cd.put(p.getUniqueId(), now + 600);
        JsonObject g = defs.getAsJsonObject(n.kind);
        String item = g.get("item").getAsString();
        ItemStack got = plugin.items().create(item, "common", 1);
        if (!p.getInventory().addItem(got).isEmpty()) { p.sendActionBar(Component.text("가방이 가득 찼습니다", NamedTextColor.RED)); return; }
        n.readyAt = now + g.get("respawnMs").getAsLong();
        n.block.setType(Material.AIR, false);
        p.playSound(n.block.getLocation(), n.kind.equals("ore") ? Sound.BLOCK_STONE_BREAK : Sound.BLOCK_GRASS_BREAK, 0.8f, 1.1f);
        p.sendActionBar(Component.text("+ " + plugin.items().tpl(item).get("name").getAsString(), NamedTextColor.GREEN));
        plugin.quests().quest(p, "collect", item);
    }

    private void tick() {
        long now = System.currentTimeMillis();
        List<Node> ready = new ArrayList<>();
        for (Node n : nodes.values()) {
            if (n.readyAt != 0 && now >= n.readyAt) { n.readyAt = 0; n.block.setType(LOOK.get(n.kind), false); }
            if (n.readyAt == 0) ready.add(n);
        }
        for (Node n : ready) if (n.block.getChunk().isLoaded() && Math.random() < 0.35)
            n.block.getWorld().spawnParticle(Particle.HAPPY_VILLAGER, n.block.getLocation().add(0.5, 0.6, 0.5), 2, 0.25, 0.2, 0.25, 0);
    }
}
