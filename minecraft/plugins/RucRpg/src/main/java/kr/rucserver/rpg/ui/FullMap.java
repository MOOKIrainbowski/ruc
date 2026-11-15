package kr.rucserver.rpg.ui;

import kr.rucserver.rpg.RucRpg;
import net.kyori.adventure.text.Component;
import net.kyori.adventure.text.format.NamedTextColor;
import net.kyori.adventure.text.format.TextDecoration;
import org.bukkit.Bukkit;
import org.bukkit.Material;
import org.bukkit.NamespacedKey;
import org.bukkit.World;
import org.bukkit.entity.Player;
import org.bukkit.event.EventHandler;
import org.bukkit.event.Listener;
import org.bukkit.event.player.PlayerChangedWorldEvent;
import org.bukkit.event.player.PlayerDropItemEvent;
import org.bukkit.inventory.ItemStack;
import org.bukkit.inventory.meta.MapMeta;
import org.bukkit.map.MapCanvas;
import org.bukkit.map.MapCursor;
import org.bukkit.map.MapCursorCollection;
import org.bukkit.map.MapRenderer;
import org.bukkit.map.MapView;
import org.bukkit.persistence.PersistentDataType;

import javax.imageio.ImageIO;
import java.awt.Image;
import java.awt.image.BufferedImage;
import java.util.HashMap;
import java.util.Map;
import java.util.Set;

/**
 * 전체 지도 (웹 M 키 · M9). 마크 타협: 창 대신 **바닐라 지도 아이템**을 왼손에 — 리소스팩 · 셰이더 없이도 보임.
 * 그림 = Codex 미니맵 생성기의 맵 PNG(1 타일 = 1 px, 패딩 32) 를 128×128 에 맞춰 늘림. 표식: 나(흰 화살표) · 파티원(초록) · 다른 사람(파랑).
 * /지도 = 왼손에 넣기 · 다시 = 빼기. 월드를 옮기면 그 맵 그림으로 바뀜.
 */
public final class FullMap implements Listener {

    private final RucRpg plugin;
    private final NamespacedKey tag;
    private final Map<String, MapView> views = new HashMap<>();

    public FullMap(RucRpg plugin) {
        this.plugin = plugin;
        this.tag = new NamespacedKey(plugin, "fullmap");
    }

    private static String kindOf(RucRpg plugin, World w) {
        if (w.getName().startsWith("rpg_dg_")) return "dungeon";
        return plugin.worlds().kindOf(w);
    }

    private MapView view(String kind, World w) {
        return views.computeIfAbsent(kind, k -> {
            BufferedImage src;
            try (var in = plugin.getClass().getClassLoader().getResourceAsStream("minimap/map_" + k + ".png")) {
                src = in == null ? null : ImageIO.read(in);
            } catch (Exception e) { src = null; }
            MapView v = Bukkit.createMap(w);
            v.getRenderers().forEach(v::removeRenderer);
            v.setTrackingPosition(false);
            v.setUnlimitedTracking(false);
            v.addRenderer(new Renderer(src));
            return v;
        });
    }

    /** 한 맵 그림 + 사람마다 표식 */
    private final class Renderer extends MapRenderer {
        private final BufferedImage img;
        private final int pad = 32, ww, wh, off0x, off0y;
        private final double scale;
        /** 그림은 사람(접속)마다 한 번 — Player 객체가 바뀌면(다시 접속) 다시 그림 */
        private final Set<Player> drawn = java.util.Collections.newSetFromMap(new java.util.WeakHashMap<>());

        Renderer(BufferedImage src) {
            super(true);
            if (src == null) { img = null; ww = wh = 128; scale = 1; off0x = off0y = 0; return; }
            ww = src.getWidth() - pad * 2;
            wh = src.getHeight() - pad * 2;
            scale = Math.min(128.0 / ww, 128.0 / wh);
            int sw = (int) Math.round(ww * scale), sh = (int) Math.round(wh * scale);
            off0x = (128 - sw) / 2;
            off0y = (128 - sh) / 2;
            BufferedImage crop = new BufferedImage(ww, wh, BufferedImage.TYPE_INT_RGB);
            for (int y = 0; y < wh; y++) for (int x = 0; x < ww; x++) crop.setRGB(x, y, src.getRGB(x + pad, y + pad) | 0xFF000000);   // 셰이더용 알파(1/255) 무시
            BufferedImage out = new BufferedImage(128, 128, BufferedImage.TYPE_INT_RGB);
            var g = out.createGraphics();
            g.setColor(new java.awt.Color(0x2A, 0x1E, 0x14));
            g.fillRect(0, 0, 128, 128);
            g.drawImage(crop.getScaledInstance(sw, sh, Image.SCALE_FAST), off0x, off0y, null);
            g.dispose();
            img = out;
        }

        private byte cx(double blockX) { return (byte) Math.max(-128, Math.min(127, Math.round((off0x + blockX / 2 * scale) * 2 - 128))); }
        private byte cy(double blockZ) { return (byte) Math.max(-128, Math.min(127, Math.round((off0y + blockZ / 2 * scale) * 2 - 128))); }
        private static byte dir(float yaw) { return (byte) (((int) Math.floor(yaw * 16 / 360 + 0.5)) & 15); }

        @Override
        public void render(MapView map, MapCanvas canvas, Player p) {
            if (img != null && drawn.add(p)) canvas.drawImage(0, 0, img);
            MapCursorCollection cs = new MapCursorCollection();
            var party = plugin.parties().of(p);
            for (Player o : p.getWorld().getPlayers()) {
                if (o == p || plugin.runtime().unit(o) == null || o.getGameMode() == org.bukkit.GameMode.SPECTATOR) continue;
                boolean mate = party != null && party.members.contains(o.getUniqueId());
                cs.addCursor(new MapCursor(cx(o.getLocation().getX()), cy(o.getLocation().getZ()), dir(o.getLocation().getYaw()),
                        mate ? MapCursor.Type.FRAME : MapCursor.Type.BLUE_MARKER, true, mate ? net.kyori.adventure.text.Component.text(o.getName()) : null));
            }
            cs.addCursor(new MapCursor(cx(p.getLocation().getX()), cy(p.getLocation().getZ()), dir(p.getLocation().getYaw()), MapCursor.Type.PLAYER, true));
            canvas.setCursors(cs);
        }
    }

    private boolean isMine(ItemStack it) { return it != null && it.getType() == Material.FILLED_MAP && it.getItemMeta() != null && it.getItemMeta().getPersistentDataContainer().has(tag); }

    private ItemStack item(String kind, World w) {
        ItemStack it = new ItemStack(Material.FILLED_MAP);
        MapMeta m = (MapMeta) it.getItemMeta();
        m.setMapView(view(kind, w));
        m.displayName(Component.text("지도 — " + kr.rucserver.rpg.world.RpgWorlds.NAMES.getOrDefault(kind, kind), NamedTextColor.GOLD, TextDecoration.BOLD).decoration(TextDecoration.ITALIC, false));
        m.getPersistentDataContainer().set(tag, PersistentDataType.BYTE, (byte) 1);
        it.setItemMeta(m);
        return it;
    }

    /** /지도 — 왼손에 넣거나 빼기 */
    public void toggle(Player p) {
        ItemStack off = p.getInventory().getItemInOffHand();
        if (isMine(off)) { p.getInventory().setItemInOffHand(null); return; }
        String kind = kindOf(plugin, p.getWorld());
        if (kind == null) { p.sendMessage(Component.text("이 곳에는 지도가 없어요", NamedTextColor.GRAY)); return; }
        if (!off.getType().isAir()) { p.sendMessage(Component.text("왼손을 비워 주세요", NamedTextColor.RED)); return; }
        p.getInventory().setItemInOffHand(item(kind, p.getWorld()));
        p.sendMessage(Component.text("왼손에 지도를 들었어요 — /지도 로 다시 넣기 · 아래를 보면 크게", NamedTextColor.GRAY));
    }

    @EventHandler
    public void onWorld(PlayerChangedWorldEvent e) {
        Player p = e.getPlayer();
        if (!isMine(p.getInventory().getItemInOffHand())) return;
        String kind = kindOf(plugin, p.getWorld());
        p.getInventory().setItemInOffHand(kind == null ? null : item(kind, p.getWorld()));
    }

    @EventHandler
    public void onDrop(PlayerDropItemEvent e) {
        if (isMine(e.getItemDrop().getItemStack())) e.getItemDrop().remove();   // 버리면 그냥 사라짐 (/지도 로 다시)
    }
}
