package kr.rucserver.rpg.hud;

import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import kr.rucserver.rpg.RucRpg;
import net.kyori.adventure.bossbar.BossBar;
import net.kyori.adventure.key.Key;
import net.kyori.adventure.text.Component;
import net.kyori.adventure.text.TextComponent;
import net.kyori.adventure.text.format.TextColor;
import org.bukkit.Bukkit;
import org.bukkit.entity.Player;
import org.bukkit.event.EventHandler;
import org.bukkit.event.EventPriority;
import org.bukkit.event.Listener;
import org.bukkit.event.player.PlayerJoinEvent;
import org.bukkit.event.player.PlayerQuitEvent;

import javax.imageio.ImageIO;
import java.awt.image.BufferedImage;
import java.io.InputStreamReader;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.Map;
import java.util.Objects;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;

/**
 * 미니맵 (사용자 결정 Q2 · 계약 = hud-glyphs.json minimap · Codex 작업 7 셰이더).
 * 보스바 제목 하나에: 지도 글리프(글자 색 R/G = 128 + 스크롤 타일) → 머리 픽셀 64개 × 사람 수 + 내 방향 삼각형(전부 앞으로/뒤로 0 이 되게).
 * 셰이더가 지도를 오른쪽 위 64×64 로 옮기고 자름. 셰이더가 없으면 글리프 알파 1/255 라 안 보이고, 보스바 막대는 분홍(리소스팩에서 투명)으로.
 * 이 보스바는 접속 때 **가장 먼저** 띄우고 다시는 숨기지 않음 — 셰이더가 첫 보스바 자리(y 12)를 기준으로 옮기기 때문.
 */
public final class MinimapHud implements Listener {

    private final RucRpg plugin;
    private final JsonObject glyphs, mm, spacing;
    private final Map<UUID, BossBar> bars = new ConcurrentHashMap<>();
    private final Map<UUID, Integer> lastHash = new ConcurrentHashMap<>();
    /** 스킨 얼굴 8×8 RGB (모자 겹침 포함) — 못 받으면 기본 색 */
    private final Map<UUID, int[]> faces = new ConcurrentHashMap<>();
    private final HttpClient http = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(5)).build();

    private MinimapHud(RucRpg plugin, JsonObject root) {
        this.plugin = plugin;
        this.glyphs = root.getAsJsonObject("glyphs");
        this.mm = root.getAsJsonObject("minimap");
        this.spacing = root.getAsJsonObject("spacing");
    }

    /** 계약(hud-glyphs.json 의 minimap)이 있으면 켬 */
    public static MinimapHud load(RucRpg plugin) {
        try (var in = plugin.getClass().getClassLoader().getResourceAsStream("hud-glyphs.json")) {
            if (in == null) return null;
            JsonObject root = JsonParser.parseReader(new InputStreamReader(in, StandardCharsets.UTF_8)).getAsJsonObject();
            if (!root.has("minimap") || !root.getAsJsonObject("minimap").has("maps")) return null;
            MinimapHud h = new MinimapHud(plugin, root);
            Bukkit.getScheduler().runTaskTimer(plugin, h::tick, 20L, 4L);
            return h;
        } catch (Exception e) {
            plugin.getLogger().warning("미니맵 계약을 읽지 못함 — 미니맵 끔: " + e.getMessage());
            return null;
        }
    }

    @EventHandler(priority = EventPriority.LOWEST)
    public void onJoin(PlayerJoinEvent e) {
        Player p = e.getPlayer();
        BossBar b = BossBar.bossBar(Component.empty(), 0f, BossBar.Color.PINK, BossBar.Overlay.PROGRESS);
        bars.put(p.getUniqueId(), b);
        p.showBossBar(b);
        fetchFace(p);
    }

    @EventHandler
    public void onQuit(PlayerQuitEvent e) {
        bars.remove(e.getPlayer().getUniqueId());
        lastHash.remove(e.getPlayer().getUniqueId());
    }

    // ── 스킨 얼굴 ───────────────────────────────────────────────────

    private void fetchFace(Player p) {
        UUID id = p.getUniqueId();
        var tex = p.getPlayerProfile().getTextures();
        if (tex.getSkin() == null) return;
        String url = tex.getSkin().toString();
        Bukkit.getScheduler().runTaskAsynchronously(plugin, () -> {
            try {
                HttpResponse<byte[]> r = http.send(HttpRequest.newBuilder(URI.create(url)).timeout(Duration.ofSeconds(8)).build(), HttpResponse.BodyHandlers.ofByteArray());
                BufferedImage img = ImageIO.read(new java.io.ByteArrayInputStream(r.body()));
                if (img == null) return;
                int[] px = new int[64];
                for (int y = 0; y < 8; y++) for (int x = 0; x < 8; x++) {
                    int base = img.getRGB(8 + x, 8 + y), hat = img.getRGB(40 + x, 8 + y);
                    px[y * 8 + x] = ((hat >>> 24) > 127 ? hat : base) & 0xFFFFFF;
                }
                faces.put(id, px);
                lastHash.remove(id);
            } catch (Exception ignored) {}   // 못 받으면 기본 얼굴
        });
    }

    private static final int[] DEFAULT_FACE = new int[64];
    static {   // 스킨을 못 받을 때: 갈색 머리 · 살색 얼굴 · 눈
        for (int i = 0; i < 64; i++) {
            int y = i / 8, x = i % 8;
            DEFAULT_FACE[i] = y < 2 ? 0x3B2A1E : (y == 4 && (x == 1 || x == 2 || x == 5 || x == 6)) ? (x == 1 || x == 6 ? 0xFFFFFF : 0x3A4F9A) : 0xC8956C;
        }
    }

    // ── 조립 ────────────────────────────────────────────────────────

    private final class Line {
        final TextComponent.Builder b = Component.text();
        int x;

        void moveTo(int target) { space(target - x); }

        void space(int d) {
            if (d == 0) return;
            StringBuilder sb = new StringBuilder();
            int left = d;
            for (int p = 1024; p >= 1; p >>= 1)
                while (Math.abs(left) >= p) { sb.append(spacing.getAsJsonObject((left > 0 ? "+" : "-") + p).get("char").getAsString()); left -= left > 0 ? p : -p; }
            b.append(Component.text(sb.toString()).font(Key.key("ruc", "space")));
            x += d;
        }

        void glyph(String name, String fontOverride, TextColor color) {
            JsonObject g = glyphs.getAsJsonObject(name);
            String f = fontOverride != null ? fontOverride : g.get("font").getAsString();
            String[] k = f.split(":");
            b.append(Component.text(g.get("char").getAsString()).font(Key.key(k[0], k[1])).color(color));
            x += g.get("advance").getAsInt();
        }
    }

    private String mapKey(org.bukkit.World w) {
        String n = w.getName();
        if (n.startsWith("rpg_dg_")) return "dungeon";
        String k = plugin.worlds().kindOf(w);
        return k != null && mm.getAsJsonObject("maps").has(k) ? k : null;
    }

    private String yFont(int dy) {
        JsonObject y = mm.getAsJsonObject("skinPixels").getAsJsonObject("yFonts");
        return y.has(String.valueOf(dy)) ? y.get(String.valueOf(dy)).getAsString() : null;
    }

    /** 머리 하나: 지도 가운데 기준 (dx, dy) 타일에 8×8 */
    private void head(Line l, int center, int dx, int dy, int[] face) {
        for (int row = 0; row < 8; row++) {
            String f = yFont(dy + row - 4);
            if (f == null) return;   // 창 밖 (y 폰트 범위 밖)
            l.moveTo(center + dx - 4);
            String[] k = f.split(":");
            StringBuilder run = new StringBuilder();
            for (int col = 0; col < 8; col++) {   // 같은 색이 이어지면 한 조각으로 (보스바 패킷 크기 — 머리 하나 64조각 → 보통 20~30)
                run.append(glyphs.getAsJsonObject(String.format("minimap.head.pixel.%02d", row * 8 + col)).get("char").getAsString());
                if (col == 7 || face[row * 8 + col + 1] != face[row * 8 + col]) {
                    l.b.append(Component.text(run.toString()).font(Key.key(k[0], k[1])).color(TextColor.color(face[row * 8 + col])));
                    l.x += run.length();   // 픽셀 글리프 advance = 1
                    run.setLength(0);
                }
            }
        }
    }

    private void tick() {
        double radius = mm.getAsJsonObject("mapPixels").get("viewRadiusTiles").getAsDouble();
        for (Player p : Bukkit.getOnlinePlayers()) {
            BossBar bar = bars.get(p.getUniqueId());
            if (bar == null) continue;
            boolean on = plugin.windows() == null || plugin.windows().prefs(p.getUniqueId()).minimap();
            String key = !on || plugin.runtime().unit(p) == null ? null : mapKey(p.getWorld());
            if (key == null) {
                if (!Objects.equals(lastHash.put(p.getUniqueId(), 0), 0)) bar.name(Component.empty());
                continue;
            }
            JsonObject m = mm.getAsJsonObject("maps").getAsJsonObject(key);
            int w = m.get("width").getAsInt(), h = m.get("height").getAsInt(), pad = m.get("padding").getAsInt();
            int tx = Math.floorDiv(p.getLocation().getBlockX(), 2) + pad, ty = Math.floorDiv(p.getLocation().getBlockZ(), 2) + pad;
            int sx = Math.max(-64, Math.min(63, tx - w / 2)), sy = Math.max(-64, Math.min(63, ty - h / 2));
            int dir = Math.floorMod(Math.round(-p.getLocation().getYaw() / 45f), 8);
            StringBuilder sig = new StringBuilder().append(key).append(sx).append(',').append(sy).append(',').append(dir);
            Line l = new Line();
            l.glyph(m.get("glyph").getAsString(), null, TextColor.color(128 + sx, 128 + sy, 0));
            int end = l.x, center = end / 2;
            // 다른 사람 (같은 월드 · 보이는 반경)
            var near = new java.util.ArrayList<>(p.getWorld().getPlayers());
            near.sort(java.util.Comparator.comparingDouble(o -> o.getLocation().distanceSquared(p.getLocation())));
            int shown = 0;
            for (Player o : near) {   // 가까운 8명까지 (패킷 크기)
                if (o == p || plugin.runtime().unit(o) == null || o.getGameMode() == org.bukkit.GameMode.SPECTATOR) continue;
                if (shown >= 8) break;
                int ox = Math.floorDiv(o.getLocation().getBlockX(), 2) + pad - tx, oy = Math.floorDiv(o.getLocation().getBlockZ(), 2) + pad - ty;
                if (Math.abs(ox) > radius || Math.abs(oy) > radius) continue;
                head(l, center, ox, oy, faces.getOrDefault(o.getUniqueId(), DEFAULT_FACE));
                shown++;
                sig.append('|').append(ox).append(',').append(oy).append(faces.containsKey(o.getUniqueId()) ? 'f' : 'd');
            }
            head(l, center, 0, 0, faces.getOrDefault(p.getUniqueId(), DEFAULT_FACE));
            sig.append(faces.containsKey(p.getUniqueId()) ? 'F' : 'D');
            JsonObject arrow = glyphs.getAsJsonObject("minimap.direction." + dir);
            if (arrow != null) {
                l.moveTo(center - arrow.get("advance").getAsInt() / 2);
                l.glyph("minimap.direction." + dir, null, TextColor.color(0xFFFFFF));
            }
            l.moveTo(end);   // 표식은 앞뒤 합 0
            int hash = sig.toString().hashCode();
            if (Objects.equals(lastHash.put(p.getUniqueId(), hash), hash)) continue;   // 바뀐 것이 없으면 안 보냄
            bar.name(l.b.build());
        }
    }
}
