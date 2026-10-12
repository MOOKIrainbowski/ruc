package kr.rucserver.core.service;

import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import kr.rucserver.core.RucCore;
import net.kyori.adventure.text.Component;
import net.kyori.adventure.text.event.ClickEvent;
import net.kyori.adventure.text.event.HoverEvent;
import org.bukkit.Bukkit;
import org.bukkit.entity.Player;
import org.bukkit.event.EventHandler;
import org.bukkit.event.Listener;
import org.bukkit.event.player.PlayerJoinEvent;
import org.bukkit.event.player.PlayerQuitEvent;
import org.bukkit.scheduler.BukkitTask;

import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import java.net.URI;
import java.net.URLEncoder;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Statement;
import java.time.Duration;
import java.util.HexFormat;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.logging.Level;

/**
 * 이용약관 동의 (2026-10-13).
 *
 * <ol>
 *   <li>아직 동의하지 않은 플레이어가 들어오면 채팅에 웹 링크를 보냅니다.
 *       링크에는 UUID · 닉네임 · 발급 시각과 그 서명(HMAC, {@code terms.secret})이 붙습니다 —
 *       남의 UUID 로 동의할 수 없게 하는 장치입니다 (web/lib/terms.ts 가 같은 키로 확인).</li>
 *   <li>플레이어는 웹에서 디스코드로 로그인하고 동의합니다. 웹은 그 기록을 디스코드 채널에 남깁니다.</li>
 *   <li>여기서 {@code terms.poll-seconds} 마다 웹 API({@code /api/terms/agreements})를 읽어
 *       {@code ruc_terms_agreement} 에 적습니다. 웹은 집 PC 의 게임 DB 에 닿지 않으므로 게임이 가져옵니다.</li>
 * </ol>
 *
 * 동의하지 않아도 플레이는 막지 않습니다 — 접속할 때마다 다시 안내만 합니다.
 * 4개 서버가 각자 읽어도 같은 줄을 덮어쓸 뿐이라 괜찮습니다.
 */
public class TermsService implements Listener {

    private final RucCore plugin;
    private final MessageService messages;
    // HTTP/1.1 고정 — 기본(HTTP/2)은 http:// 에서 h2c 업그레이드를 시도해 Node 서버가 끊습니다 (로컬 시험에서 확인)
    private final HttpClient http = HttpClient.newBuilder().version(HttpClient.Version.HTTP_1_1)
            .connectTimeout(Duration.ofSeconds(5)).build();
    /** 동의 확인된 접속자. 접속할 때 DB 에서 채웁니다. */
    private final Set<UUID> agreed = ConcurrentHashMap.newKeySet();
    private BukkitTask poller;
    /** 같은 오류를 30초마다 찍지 않도록 — 바뀔 때만 (null = 정상) */
    private volatile String lastError;

    public TermsService(RucCore plugin, MessageService messages) {
        this.plugin = plugin;
        this.messages = messages;
    }

    public boolean isEnabled() {
        return plugin.getConfig().getBoolean("terms.enabled", false) && !secret().isEmpty();
    }

    private String secret() {
        return plugin.getConfig().getString("terms.secret", "").trim();
    }

    private String baseUrl() {
        return plugin.getConfig().getString("terms.url", "https://ruc-server.vercel.app").replaceAll("/+$", "");
    }

    public void createSchema() throws SQLException {
        try (Connection c = plugin.getDatabase().getConnection(); Statement st = c.createStatement()) {
            st.executeUpdate("""
                    CREATE TABLE IF NOT EXISTS ruc_terms_agreement (
                        uuid        VARCHAR(36) NOT NULL PRIMARY KEY,
                        name        VARCHAR(16) NOT NULL,
                        discord_id  VARCHAR(32) NOT NULL,
                        version     VARCHAR(64) NOT NULL,
                        agreed_at   BIGINT      NOT NULL,
                        message_id  VARCHAR(24) NOT NULL
                    )
                    """);
        }
    }

    public void start() {
        if (!isEnabled()) {
            plugin.getLogger().info("이용약관 동의 꺼짐 (terms.enabled · terms.secret)");
            return;
        }
        long ticks = Math.max(10, plugin.getConfig().getLong("terms.poll-seconds", 30)) * 20;
        poller = Bukkit.getScheduler().runTaskTimerAsynchronously(plugin, this::poll, 100, ticks);
        plugin.getLogger().info("이용약관 동의 켜짐 — " + baseUrl());
    }

    public void stop() {
        if (poller != null) poller.cancel();
    }

    // ── 접속 안내 ──────────────────────────────────────────────────────

    @EventHandler
    public void onJoin(PlayerJoinEvent event) {
        if (!isEnabled()) return;
        Player player = event.getPlayer();
        UUID id = player.getUniqueId();
        Bukkit.getScheduler().runTaskAsynchronously(plugin, () -> {
            boolean done = hasAgreed(id);
            if (done) {
                agreed.add(id);
                return;
            }
            long delay = Math.max(1, plugin.getConfig().getLong("terms.prompt-delay-seconds", 3)) * 20;
            Bukkit.getScheduler().runTaskLater(plugin, () -> prompt(player), delay);
        });
    }

    @EventHandler
    public void onQuit(PlayerQuitEvent event) {
        agreed.remove(event.getPlayer().getUniqueId());
    }

    private void prompt(Player player) {
        if (!player.isOnline() || agreed.contains(player.getUniqueId())) return;
        String lang = plugin.getPlayerData().languageOf(player);
        String url = link(player.getUniqueId(), player.getName());
        player.sendMessage(Component.empty());
        player.sendMessage(messages.prefixed(lang, "terms.prompt"));
        player.sendMessage(messages.get(lang, "terms.button")
                .clickEvent(ClickEvent.openUrl(url))
                .hoverEvent(HoverEvent.showText(messages.get(lang, "terms.hover"))));
        player.sendMessage(Component.empty());
    }

    /** /terms/agree?u=&n=&t=&s= — 서명 = HMAC-SHA256(secret, "u|n|t") 16진수. */
    String link(UUID uuid, String name) {
        String t = String.valueOf(System.currentTimeMillis() / 1000);
        String u = uuid.toString();
        return baseUrl() + "/terms/agree?u=" + u + "&n=" + URLEncoder.encode(name, StandardCharsets.UTF_8)
                + "&t=" + t + "&s=" + hmac(u + "|" + name + "|" + t);
    }

    String hmac(String text) {
        try {
            Mac mac = Mac.getInstance("HmacSHA256");
            mac.init(new SecretKeySpec(secret().getBytes(StandardCharsets.UTF_8), "HmacSHA256"));
            return HexFormat.of().formatHex(mac.doFinal(text.getBytes(StandardCharsets.UTF_8)));
        } catch (Exception e) {
            throw new IllegalStateException(e);
        }
    }

    // ── 동의 기록 가져오기 ─────────────────────────────────────────────

    private java.io.File cursorFile() {
        return new java.io.File(plugin.getDataFolder(), "terms-cursor.txt");
    }

    private void poll() {
        try {
            String after = cursorFile().exists() ? Files.readString(cursorFile().toPath()).trim() : "0";
            for (int round = 0; round < 10; round++) { // 한 번에 최대 1,000건
                HttpRequest req = HttpRequest.newBuilder(URI.create(baseUrl() + "/api/terms/agreements?after=" + after
                                + "&sig=" + hmac("agreements:" + after)))
                        .timeout(Duration.ofSeconds(10))
                        .header("User-Agent", "RucCore/1.0")
                        .GET().build();
                HttpResponse<String> res = http.send(req, HttpResponse.BodyHandlers.ofString());
                if (res.statusCode() != 200) {
                    fail("HTTP " + res.statusCode());
                    return;
                }
                JsonObject body = JsonParser.parseString(res.body()).getAsJsonObject();
                for (JsonElement el : body.getAsJsonArray("items")) save(el.getAsJsonObject());
                String last = body.get("last").getAsString();
                if (!last.equals(after)) {
                    after = last;
                    Files.writeString(cursorFile().toPath(), after);
                }
                if (lastError != null) plugin.getLogger().info("[약관] 동의 기록 읽기 다시 됨");
                lastError = null;
                if (!body.get("more").getAsBoolean()) return;
            }
        } catch (Exception e) {
            fail(e.getClass().getSimpleName() + ": " + e.getMessage());
        }
    }

    private void fail(String why) {
        if (!why.equals(lastError)) plugin.getLogger().warning("[약관] 동의 기록 읽기 실패 — " + why);
        lastError = why;
    }

    private void save(JsonObject a) throws SQLException {
        UUID uuid = UUID.fromString(a.get("uuid").getAsString());
        try (Connection c = plugin.getDatabase().getConnection();
             PreparedStatement ps = c.prepareStatement("""
                     INSERT INTO ruc_terms_agreement (uuid, name, discord_id, version, agreed_at, message_id)
                     VALUES (?, ?, ?, ?, ?, ?)
                     ON DUPLICATE KEY UPDATE name = VALUES(name)
                     """)) {
            ps.setString(1, uuid.toString());
            ps.setString(2, a.get("name").getAsString());
            ps.setString(3, a.get("discord").getAsString());
            ps.setString(4, a.get("version").getAsString());
            ps.setLong(5, a.get("at").getAsLong());
            ps.setString(6, a.get("id").getAsString());
            ps.executeUpdate();
        }
        if (agreed.add(uuid)) {
            Bukkit.getScheduler().runTask(plugin, () -> {
                Player p = Bukkit.getPlayer(uuid);
                if (p != null) p.sendMessage(messages.prefixed(plugin.getPlayerData().languageOf(p), "terms.thanks"));
            });
        }
    }

    public boolean hasAgreed(UUID uuid) {
        try (Connection c = plugin.getDatabase().getConnection();
             PreparedStatement ps = c.prepareStatement("SELECT 1 FROM ruc_terms_agreement WHERE uuid = ?")) {
            ps.setString(1, uuid.toString());
            try (ResultSet rs = ps.executeQuery()) {
                return rs.next();
            }
        } catch (SQLException e) {
            plugin.getLogger().log(Level.WARNING, "[약관] 동의 조회 실패", e);
            return true; // DB 오류로 매번 안내가 뜨는 것보다 조용한 쪽
        }
    }
}
