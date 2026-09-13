package kr.rucserver.core.service;

import com.google.common.io.ByteArrayDataInput;
import com.google.common.io.ByteArrayDataOutput;
import com.google.common.io.ByteStreams;
import kr.rucserver.core.RucCore;
import org.bukkit.Bukkit;
import org.bukkit.entity.Player;
import org.bukkit.plugin.messaging.PluginMessageListener;
import org.bukkit.scheduler.BukkitTask;
import org.jetbrains.annotations.NotNull;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

/**
 * 프록시(Velocity)와의 통신.
 *
 * Velocity 는 BungeeCord 플러그인 채널을 호환 지원하므로, 서버 이동과 인원 조회를
 * 이 채널 하나로 처리합니다 (velocity.toml 의 bungee-plugin-message-channel = true).
 *
 * 주의: 플러그인 메시지는 <b>플레이어의 연결을 타고</b> 나갑니다. 접속자가 한 명도
 * 없으면 보낼 방법이 없으므로, 인원 조회 주기 작업은 접속자가 있을 때만 돕니다.
 */
public class NetworkService implements PluginMessageListener {

    private static final String CHANNEL = "BungeeCord";

    private final RucCore plugin;

    /** 서버별 접속 인원. 프록시가 응답하기 전에는 비어 있습니다. */
    private final Map<String, Integer> counts = new ConcurrentHashMap<>();

    private final List<String> servers;
    private final String currentServer;
    private BukkitTask pollTask;

    public NetworkService(RucCore plugin) {
        this.plugin = plugin;
        this.currentServer = plugin.getConfig().getString("server-id", "home");

        List<String> configured = plugin.getConfig().getStringList("network.servers");
        this.servers = configured.isEmpty() ? List.of("home", "raid", "war", "peace") : configured;
    }

    public void start() {
        Bukkit.getMessenger().registerOutgoingPluginChannel(plugin, CHANNEL);
        Bukkit.getMessenger().registerIncomingPluginChannel(plugin, CHANNEL, this);

        long interval = plugin.getConfig().getLong("network.count-refresh-ticks", 200);
        pollTask = Bukkit.getScheduler().runTaskTimer(plugin, this::requestCounts, 100L, interval);
    }

    public void stop() {
        if (pollTask != null) pollTask.cancel();
        Bukkit.getMessenger().unregisterOutgoingPluginChannel(plugin, CHANNEL);
        Bukkit.getMessenger().unregisterIncomingPluginChannel(plugin, CHANNEL, this);
    }

    public List<String> getServers() {
        return servers;
    }

    public String getCurrentServer() {
        return currentServer;
    }

    /** 서버별 인원. 아직 응답을 못 받았으면 null. */
    public Integer playerCount(String server) {
        return counts.get(server);
    }

    // ── 서버 이동 ──────────────────────────────────────────────────────

    /**
     * 프록시에 이 플레이어를 다른 서버로 옮겨 달라고 요청합니다.
     *
     * 성공/실패를 여기서 알 수는 없습니다. 프록시가 대상 서버에 붙이지 못하면
     * 플레이어는 그대로 남고 프록시가 자체 메시지를 띄웁니다.
     */
    public void connect(Player player, String server) {
        if (server.equals(currentServer)) return;

        ByteArrayDataOutput out = ByteStreams.newDataOutput();
        out.writeUTF("Connect");
        out.writeUTF(server);
        player.sendPluginMessage(plugin, CHANNEL, out.toByteArray());
    }

    // ── 인원 조회 ──────────────────────────────────────────────────────

    private void requestCounts() {
        Player carrier = Bukkit.getOnlinePlayers().stream().findFirst().orElse(null);
        if (carrier == null) return;      // 메시지를 실어 보낼 연결이 없습니다

        for (String server : servers) {
            ByteArrayDataOutput out = ByteStreams.newDataOutput();
            out.writeUTF("PlayerCount");
            out.writeUTF(server);
            carrier.sendPluginMessage(plugin, CHANNEL, out.toByteArray());
        }
    }

    @Override
    public void onPluginMessageReceived(@NotNull String channel, @NotNull Player player,
                                        byte @NotNull [] message) {
        if (!channel.equals(CHANNEL)) return;

        ByteArrayDataInput in = ByteStreams.newDataInput(message);
        String subChannel = in.readUTF();
        if (!subChannel.equals("PlayerCount")) return;

        String server = in.readUTF();
        int count = in.readInt();
        counts.put(server, count);
    }

    /** 메뉴 표시용 — 서버 순서를 유지한 사본. */
    public Map<String, Integer> snapshot() {
        Map<String, Integer> out = new LinkedHashMap<>();
        for (String server : servers) out.put(server, counts.get(server));
        return out;
    }
}
