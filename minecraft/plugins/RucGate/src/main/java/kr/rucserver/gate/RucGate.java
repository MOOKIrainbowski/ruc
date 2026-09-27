package kr.rucserver.gate;

import com.google.inject.Inject;
import com.velocitypowered.api.event.EventTask;
import com.velocitypowered.api.event.Subscribe;
import com.velocitypowered.api.event.player.ServerPreConnectEvent;
import com.velocitypowered.api.event.proxy.ProxyInitializeEvent;
import com.velocitypowered.api.event.proxy.ProxyShutdownEvent;
import com.velocitypowered.api.plugin.Plugin;
import com.velocitypowered.api.plugin.annotation.DataDirectory;
import com.velocitypowered.api.proxy.Player;
import com.velocitypowered.api.proxy.ProxyServer;
import com.velocitypowered.api.proxy.server.RegisteredServer;
import com.velocitypowered.api.scheduler.ScheduledTask;
import net.kyori.adventure.text.Component;
import net.kyori.adventure.text.serializer.legacy.LegacyComponentSerializer;
import org.slf4j.Logger;

import java.nio.file.Path;
import java.sql.SQLException;
import java.util.Locale;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.TimeUnit;

/**
 * 국가전 서버 입장 제한 (§2.6) — 프록시 단에서 판정합니다.
 *
 * <h2>왜 프록시인가</h2>
 * 백엔드에 들여보낸 뒤 킥하면 월드·청크 로딩과 리소스 전송이 이미 끝난 상태라
 * 낭비가 크고, 플레이어에게는 "들어갔다 튕긴" 것으로 보입니다. 프록시에서
 * 거부하면 원래 있던 서버에 그대로 남고 안내만 받습니다.
 *
 * <h2>판정 기준</h2>
 * 백엔드 {@code GuildService.isInNation()} 과 동일하게 <b>소속 길드의 nation
 * 플래그</b> 하나만 봅니다. 규칙이 두 군데에 다르게 적히면 반드시 어긋납니다.
 *
 * <h2>DB 를 못 읽을 때</h2>
 * 막는 쪽(fail-closed)으로 갑니다. 잘못 들여보내면 영토 클레임과 그리핑처럼
 * 남는 피해가 생기고, 잘못 막으면 잠시 못 들어가는 것으로 끝납니다. 비대칭이
 * 분명하므로 안전한 쪽을 고릅니다.
 */
@Plugin(
        id = "rucgate",
        name = "RucGate",
        version = "0.1.0",
        description = "러크 네트워크 — 국가전 서버 입장 제한 (§2.6)",
        authors = {"Ruc Server"}
)
public class RucGate {

    private static final LegacyComponentSerializer LEGACY =
            LegacyComponentSerializer.legacyAmpersand();

    private final ProxyServer proxy;
    private final Logger logger;
    private final Path dataDirectory;

    private GateConfig config;
    private GateDatabase database;
    private ScheduledTask refreshTask;

    /** 국가 소속원 캐시. 통과 판정을 즉시 하기 위한 것입니다. */
    private volatile Set<UUID> nationMembers = Set.of();

    /** 마지막 갱신이 성공했는지. 실패 중이면 안내 문구를 다르게 냅니다. */
    private volatile boolean healthy;

    @Inject
    public RucGate(ProxyServer proxy, Logger logger, @DataDirectory Path dataDirectory) {
        this.proxy = proxy;
        this.logger = logger;
        this.dataDirectory = dataDirectory;
    }

    @Subscribe
    public void onProxyInitialize(ProxyInitializeEvent event) {
        try {
            config = new GateConfig(dataDirectory);
        } catch (Exception e) {
            logger.error("RucGate 설정을 읽지 못했습니다. 입장 제한이 동작하지 않습니다.", e);
            return;
        }

        try {
            database = new GateDatabase(config);
        } catch (SQLException e) {
            // 여기서 멈추지 않습니다. 프록시 자체는 계속 떠 있어야 하고,
            // 게이트는 fail-closed 로 동작하면서 주기 갱신이 복구를 시도합니다.
            logger.error("RucGate DB 연결 실패. 국가전 입장은 당분간 거부됩니다.", e);
        }

        long seconds = config.refreshSeconds();
        refreshTask = proxy.getScheduler().buildTask(this, this::refresh)
                .repeat(seconds, TimeUnit.SECONDS)
                .schedule();

        logger.info("RucGate 활성화 — 제한 서버: {} / 갱신 {}초",
                String.join(", ", config.gatedServers()), seconds);
    }

    @Subscribe
    public void onProxyShutdown(ProxyShutdownEvent event) {
        if (refreshTask != null) refreshTask.cancel();
        if (database != null) database.close();
        logger.info("RucGate 비활성화");
    }

    /** 국가 소속원 목록을 다시 읽습니다. 스케줄러 스레드에서 돕니다. */
    private void refresh() {
        if (database == null) {
            // 기동 시 DB 연결이 실패했으면 여기서 다시 시도합니다.
            try {
                database = new GateDatabase(config);
                logger.info("RucGate DB 연결이 복구되었습니다.");
            } catch (SQLException e) {
                healthy = false;
                return;
            }
        }

        if (!database.schemaReady()) {
            // 백엔드가 아직 한 번도 뜨지 않아 길드 테이블이 없는 상태입니다.
            // "국가가 하나도 없음"과 구분해야 하므로 비정상으로 표시합니다.
            healthy = false;
            return;
        }

        try {
            nationMembers = database.nationMembers();
            healthy = true;
        } catch (SQLException e) {
            healthy = false;
            logger.warn("국가 소속원 목록을 읽지 못했습니다: {}", e.getMessage());
        }
    }

    /**
     * 서버 이동 직전 판정.
     *
     * DB 조회가 필요할 수 있으므로 {@link EventTask#async} 로 넘깁니다. 이벤트
     * 스레드에서 직접 쿼리하면 프록시 전체가 그 시간만큼 멈춥니다.
     */
    @Subscribe
    public EventTask onServerPreConnect(ServerPreConnectEvent event) {
        // 다른 플러그인이 이미 막았으면 건드리지 않습니다.
        if (!event.getResult().isAllowed()) return null;

        Optional<RegisteredServer> target = event.getResult().getServer();
        if (target.isEmpty()) return null;

        String name = target.get().getServerInfo().getName().toLowerCase(Locale.ROOT);
        if (config == null || !config.gatedServers().contains(name)) return null;

        Player player = event.getPlayer();
        if (player.hasPermission(config.bypassPermission())) return null;

        // 캐시에 있으면 그것으로 끝냅니다. 통과는 흔한 경로이므로 쿼리를 아낍니다.
        if (nationMembers.contains(player.getUniqueId())) return null;

        return EventTask.async(() -> {
            // 막기 전에는 DB 를 한 번 더 봅니다. 캐시가 최대 refresh-seconds 만큼
            // 낡을 수 있어서, 방금 국가에 가입한 사람이 그 때문에 거부되면 안 됩니다.
            boolean allowed = false;
            boolean checked = false;

            if (database != null) {
                try {
                    allowed = database.isInNation(player.getUniqueId());
                    checked = true;
                } catch (SQLException e) {
                    logger.warn("국가 소속 확인 실패 ({}): {}", player.getUsername(), e.getMessage());
                }
            }

            if (allowed) return;

            deny(event, player, checked && healthy);
        });
    }

    /**
     * 이동을 거부하고 이유를 알립니다.
     *
     * @param resolved DB 로 실제 확인한 결과인지. false 면 "확인 불가" 안내를 냅니다 —
     *                 자격이 있는데도 막힌 사람에게 "국가에 가입하세요" 라고만
     *                 말하면 무엇이 문제인지 알 방법이 없습니다.
     */
    private void deny(ServerPreConnectEvent event, Player player, boolean resolved) {
        if (resolved) {
            player.sendMessage(message(config.messageDenied()));
            player.sendMessage(message(config.messageDeniedHint()));
        } else {
            player.sendMessage(message(config.messageUnavailable()));
        }

        // 이미 어느 서버에 있으면 그냥 거부해서 그 자리에 남게 합니다.
        if (player.getCurrentServer().isPresent()) {
            event.setResult(ServerPreConnectEvent.ServerResult.denied());
            return;
        }

        // 접속 직후(아직 아무 서버에도 없음)에 국가전으로 곧바로 보내려는
        // 경우입니다. 여기서 그냥 거부하면 연결이 끊어지므로, 홈으로 돌립니다.
        Optional<RegisteredServer> fallback = firstFallback();
        if (fallback.isPresent()) {
            event.setResult(ServerPreConnectEvent.ServerResult.allowed(fallback.get()));
        } else {
            event.setResult(ServerPreConnectEvent.ServerResult.denied());
        }
    }

    /**
     * velocity.toml 의 try 목록 첫 번째 서버(= 홈).
     *
     * 이름을 여기 박아 두지 않는 이유: 프록시 설정에서 로비를 바꿨을 때
     * 이 플러그인만 옛 이름을 가리키고 있으면 조용히 깨집니다.
     */
    private Optional<RegisteredServer> firstFallback() {
        for (String name : proxy.getConfiguration().getAttemptConnectionOrder()) {
            Optional<RegisteredServer> server = proxy.getServer(name);
            if (server.isPresent() && !config.gatedServers()
                    .contains(name.toLowerCase(Locale.ROOT))) {
                return server;
            }
        }
        return Optional.empty();
    }

    private Component message(String raw) {
        return LEGACY.deserialize(raw);
    }
}
