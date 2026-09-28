package kr.rucserver.core.service;

import io.papermc.paper.advancement.AdvancementDisplay;
import kr.rucserver.core.RucCore;
import net.kyori.adventure.text.Component;
import net.kyori.adventure.text.serializer.plain.PlainTextComponentSerializer;
import net.kyori.adventure.translation.GlobalTranslator;
import org.bukkit.advancement.Advancement;
import org.bukkit.Bukkit;
import org.bukkit.entity.Player;
import org.bukkit.scheduler.BukkitTask;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.util.Locale;
import java.util.UUID;
import java.util.concurrent.ArrayBlockingQueue;
import java.util.concurrent.atomic.AtomicLong;
import java.util.logging.Level;

/**
 * 인게임 → 디스코드 중계 (Phase 6-3, §4.1).
 *
 * <h2>왜 봇이 아니라 플러그인이 직접 보내는가</h2>
 * 요구사항은 "발언을 <b>웹훅</b>으로 렌더링해서 플레이어 본인이 말한 것처럼
 * 보이게" 입니다. 웹훅은 그냥 HTTP POST 라서 봇을 거칠 이유가 없습니다.
 * 봇을 거치면 이런 대가를 치릅니다:
 *
 * <ul>
 *   <li>봇이 인게임 발언을 알 방법이 없습니다. RCON 은 봇 → 서버 한 방향이고,
 *       반대 방향은 로그 파일을 따라 읽어 <b>파싱</b>해야 합니다. 그런데 채팅
 *       줄에는 이미 칭호가 붙어 있어서 어디까지가 칭호이고 어디부터가 닉네임인지
 *       모호합니다.</li>
 *   <li>봇이 꺼져 있으면 중계가 멈춥니다.</li>
 * </ul>
 *
 * 플러그인이 직접 보내면 UUID·닉네임·칭호·본문을 <b>정확한 값으로</b> 들고
 * 있는 자리에서 그대로 보냅니다. 파싱이 없습니다.
 *
 * 반대 방향(디스코드 → 인게임)은 봇이 맡습니다 — 그쪽은 봇만이 디스코드
 * 메시지를 볼 수 있으므로 RCON({@code /rucrelay})으로 들어옵니다.
 *
 * <h2>서버별 채널</h2>
 * 웹훅 URL 이 채널을 가리킵니다. 그래서 서버별 채널 매핑은 각 서버의
 * {@code config.yml} 에 자기 웹훅 URL 을 두는 것으로 끝납니다 — 중앙에
 * 매핑 표를 둘 필요가 없습니다.
 *
 * <h2>보내는 속도</h2>
 * 디스코드 웹훅은 초당 몇 건으로 제한됩니다. 채팅이 몰릴 때 그대로 쏘면 429 를
 * 받고, 그 상태로 계속 쏘면 더 오래 막힙니다. 그래서 큐에 넣고 일정 간격으로
 * 하나씩 보냅니다. 큐가 넘치면 <b>버리고 센 뒤 로그에 남깁니다</b> — 채팅
 * 중계가 밀렸다고 서버가 느려지는 것이 훨씬 나쁩니다.
 */
public class DiscordRelayService {

    private static final PlainTextComponentSerializer PLAIN =
            PlainTextComponentSerializer.plainText();

    /** 디스코드 웹훅 username 상한. */
    private static final int NAME_LIMIT = 80;

    /** 디스코드 메시지 본문 상한. */
    private static final int CONTENT_LIMIT = 1900;

    private final RucCore plugin;
    private final HttpClient http;

    private final ArrayBlockingQueue<Payload> queue;
    private final AtomicLong dropped = new AtomicLong();

    private BukkitTask drainTask;

    /** 429 를 받았을 때 이 시각까지 쉬었다 보냅니다. */
    private volatile long pausedUntil;

    public DiscordRelayService(RucCore plugin) {
        this.plugin = plugin;
        this.queue = new ArrayBlockingQueue<>(
                Math.max(20, plugin.getConfig().getInt("relay.queue-max", 200)));
        this.http = HttpClient.newBuilder()
                .connectTimeout(Duration.ofSeconds(5))
                .followRedirects(HttpClient.Redirect.NORMAL)
                .build();
    }

    // ── 수명 ───────────────────────────────────────────────────────────

    public boolean isEnabled() {
        return plugin.getConfig().getBoolean("relay.enabled", false)
                && !webhook().isEmpty();
    }

    public void start() {
        if (!isEnabled()) {
            plugin.getLogger().info("디스코드 중계 꺼짐 (relay.enabled 또는 webhook-url 미설정)");
            return;
        }

        long interval = Math.max(5, plugin.getConfig().getLong("relay.min-interval-ticks", 10));
        drainTask = Bukkit.getScheduler().runTaskTimerAsynchronously(plugin, this::drain,
                interval, interval);

        plugin.getLogger().info("디스코드 중계 시작 (" + (interval * 50) + "ms 간격)");
    }

    public void stop() {
        if (drainTask != null) drainTask.cancel();

        long lost = dropped.get();
        if (lost > 0) {
            plugin.getLogger().warning("디스코드 중계에서 버린 메시지 " + lost + "건 "
                    + "(큐가 넘쳤습니다. relay.queue-max 를 늘리거나 "
                    + "relay.min-interval-ticks 를 줄이세요)");
        }
    }

    // ── 설정 ───────────────────────────────────────────────────────────

    private String webhook() {
        return plugin.getConfig().getString("relay.webhook-url", "").trim();
    }

    /**
     * 신고 전용 웹훅.
     *
     * <b>중계 채널과 반드시 분리하세요.</b> 입퇴장과 채팅이 흐르는 채널에
     * 신고가 섞이면 스태프가 놓칩니다. 비어 있으면 신고를 디스코드로 보내지
     * 않고 인게임 알림만 갑니다 — 잘못된 채널로 보내는 것보다 낫습니다.
     */
    private String reportWebhook() {
        return plugin.getConfig().getString("relay.report-webhook-url", "").trim();
    }

    /** 시스템 알림용 웹훅. 비어 있으면 발언과 같은 채널로 갑니다. */
    private String systemWebhook() {
        String url = plugin.getConfig().getString("relay.system-webhook-url", "").trim();
        return url.isEmpty() ? webhook() : url;
    }

    private String serverLabel() {
        return plugin.getConfig().getString("server-display-name",
                plugin.getConfig().getString("server-id", "ruc"));
    }

    // ── 보내기 ─────────────────────────────────────────────────────────

    /**
     * 플레이어 발언. 웹훅의 이름·아바타를 그 사람으로 맞춰 보냅니다.
     *
     * <b>메인 스레드에서 불러도 됩니다</b> — 큐에만 넣고 바로 돌아옵니다.
     */
    public void relayChat(Player player, Component message) {
        if (!isEnabled()) return;
        if (!plugin.getConfig().getBoolean("relay.chat", true)) return;

        String text = PLAIN.serialize(message);
        if (text.isBlank()) return;

        // 칭호를 이름에 붙입니다 — 요구사항의 "[칭호] [닉네임]" 이 디스코드
        // 쪽에서도 성립하게 됩니다. 웹훅 username 은 평문만 되므로 색을 뺍니다.
        String title = PLAIN.serialize(plugin.getTitles().titleComponent(player.getUniqueId()));
        String name = (title.isBlank() ? "" : title.trim() + " ") + player.getName();

        enqueue(new Payload(webhook(),
                body(trim(name, NAME_LIMIT), avatarUrl(player.getUniqueId()),
                        trim(text, CONTENT_LIMIT), null)));
    }

    /**
     * 시스템 알림 — 입퇴장·발전과제·사망.
     *
     * §4.1: "플레이어 간 대화가 아닌 알림은 <b>임베드</b>로, 발언과 구분되게"
     * 입니다. 그래서 같은 채널에 가더라도 모양이 다릅니다.
     */
    public void relaySystem(String kind, String description, int color) {
        if (!isEnabled()) return;
        if (!plugin.getConfig().getBoolean("relay." + kind, true)) return;

        String embed = "{\"title\":" + json(serverLabel())
                + ",\"description\":" + json(description)
                + ",\"color\":" + color + "}";

        enqueue(new Payload(systemWebhook(),
                body(trim(serverLabel() + " 서버", NAME_LIMIT), null, null, embed)));
    }

    public void relayJoin(Player player) {
        relaySystem("join", "**" + player.getName() + "** 님이 접속했습니다.", 0x93e93e);
    }

    public void relayQuit(Player player) {
        relaySystem("quit", "**" + player.getName() + "** 님이 퇴장했습니다.", 0x8a8a8a);
    }

    /**
     * 발전 과제 달성.
     *
     * <h2>내부 키가 아니라 이름을 보냅니다</h2>
     * 예전에는 {@code story/mine_diamond} 를 그대로 내보냈습니다. 플레이어에게
     * 그건 아무 의미가 없는 문자열입니다. 게임에 표시되는 이름("Diamonds!")과
     * 설명("다이아몬드를 획득하세요")이 그 자리에 와야 합니다.
     *
     * <h2>등급에 따라 문구와 색이 달라집니다</h2>
     * 바닐라도 그렇게 합니다 — 일반(TASK)/목표(GOAL)/도전(CHALLENGE)은 채팅
     * 문구가 서로 다르고 색도 다릅니다. 그 구분을 그대로 가져옵니다.
     *
     * <h2>조용한 과제는 보내지 않습니다</h2>
     * {@code doesAnnounceToChat()} 이 false 인 것은 레시피 해금이나 숨은
     * 과제입니다. 게임에서도 안 뜨는 것을 디스코드에만 뿌리면 도배가 됩니다.
     */
    public void relayAdvancement(Player player, Advancement advancement) {
        if (!isEnabled()) return;

        AdvancementDisplay display = advancement.getDisplay();
        if (display == null || !display.doesAnnounceToChat()) return;

        String name = translate(display.title());
        // 번역을 못 찾으면 Adventure 가 키를 그대로 돌려줍니다
        // ("advancements.story.mine_diamond.title"). 그건 내부 키를 보내던
        // 예전과 다를 바 없으므로, 그때는 키에서 읽을 만한 이름을 만듭니다.
        if (name.isBlank() || name.startsWith("advancements.")) {
            name = humanize(advancement.getKey().getKey());
        }

        String verb = switch (display.frame()) {
            case CHALLENGE -> "도전 과제를 완료했습니다";
            case GOAL -> "목표를 달성했습니다";
            default -> "발전 과제를 달성했습니다";
        };

        StringBuilder body = new StringBuilder()
                .append("**").append(player.getName()).append("** 님이 ")
                .append(verb).append("\n### ").append(name);

        String detail = translate(display.description());
        if (!detail.isBlank() && !detail.startsWith("advancements.")) {
            body.append("\n").append(detail);
        }

        // 등급 색을 그대로 씁니다 — 게임에서 본 색과 같아야 같은 것으로 읽힙니다.
        relaySystem("advancement", body.toString(), display.frame().color().value());
    }

    /**
     * 번역 가능한 Component 를 평문으로.
     *
     * 서버에 등록된 번역(Paper 는 바닐라 en_us 를 들고 있습니다)으로 먼저
     * 풀고, 없으면 키가 그대로 남습니다. 한국어 이름까지 나오게 하려면
     * ko_kr 번역을 따로 등록해야 합니다 (9b 폴리싱 후보).
     */
    private String translate(Component component) {
        if (component == null) return "";
        return PLAIN.serialize(GlobalTranslator.render(component, Locale.getDefault()));
    }

    /**
     * {@code story/mine_diamond} → {@code Mine Diamond}.
     *
     * 최후의 수단입니다. 번역도 없고 이름도 없을 때, 적어도 사람이 읽을 수
     * 있는 형태로는 내보냅니다.
     */
    private static String humanize(String key) {
        String tail = key.contains("/") ? key.substring(key.lastIndexOf('/') + 1) : key;
        String[] words = tail.split("_");
        StringBuilder sb = new StringBuilder(tail.length());
        for (String word : words) {
            if (word.isEmpty()) continue;
            if (sb.length() > 0) sb.append(' ');
            sb.append(Character.toUpperCase(word.charAt(0))).append(word.substring(1));
        }
        return sb.length() == 0 ? key : sb.toString();
    }

    public void relayDeath(Player player, Component deathMessage) {
        String text = PLAIN.serialize(deathMessage);
        if (text.isBlank()) text = player.getName() + " 님이 사망했습니다.";
        relaySystem("death", text, 0xff4444);
    }

    /**
     * 신고를 스태프 채널로 (§3.8, Phase 6-5).
     *
     * 발언·시스템 알림과 다른 웹훅을 씁니다. 신고는 흘려보내면 안 되는
     * 종류의 알림이라 채널이 달라야 합니다.
     *
     * 확정 이력이 있으면 같이 적습니다 — "처음인가 반복인가" 가 스태프 판단을
     * 가장 크게 바꾸는 정보입니다.
     */
    public void relayReport(long id, String reporter, String target,
                            String reason, String serverId, int priorConfirmed) {
        String url = reportWebhook();
        if (url.isEmpty()) return;

        StringBuilder desc = new StringBuilder()
                .append("**신고자** ").append(reporter).append("\n")
                .append("**대상** ").append(target);
        if (priorConfirmed > 0) {
            desc.append("  ⚠️ **확정 이력 ").append(priorConfirmed).append("건**");
        }
        desc.append("\n**서버** ").append(serverId)
                .append("\n\n").append(reason)
                .append("\n\n`/신고처리 ").append(id).append(" 확정`  ·  ")
                .append("`/신고처리 ").append(id).append(" 기각`");

        String embed = "{\"title\":" + json("🚨 신고 #" + id)
                + ",\"description\":" + json(desc.toString())
                + ",\"color\":" + (priorConfirmed > 0 ? 0xff4444 : 0xffaa00) + "}";

        enqueue(new Payload(url,
                body(trim(serverLabel() + " 신고", NAME_LIMIT), null, null, embed)));
    }

    /**
     * 디스코드에서 들어온 발언을 인게임에 뿌립니다 ({@code /rucrelay} 가 호출).
     *
     * <h2>여기서 MiniMessage 를 쓰지 않습니다</h2>
     * 디스코드 쪽 사람이 쓴 글입니다. {@code Component.text()} 로만 감싸서
     * 태그가 살아날 여지를 없앱니다 (§6.30 과 같은 판단).
     */
    public void broadcastFromDiscord(String author, String message) {
        String format = plugin.getConfig().getString("relay.in-game-format",
                "&9[디스코드] &f%author%&7: &f");

        Component line = MessageService.colorize(format.replace("%author%", author))
                .append(Component.text(message));

        Bukkit.getScheduler().runTask(plugin, () -> Bukkit.broadcast(line));
    }

    /**
     * 웹훅이 제대로 설정됐는지 확인하는 발송.
     *
     * 이것이 없으면 "URL 을 넣었는데 아무 일도 안 일어난다" 를 진단할 방법이
     * 없습니다. 플레이어가 접속해서 말을 해 봐야 알게 되는데, 그때는 이미
     * 사람들이 보고 있습니다.
     *
     * 발언과 임베드를 <b>둘 다</b> 보냅니다 — §4.1 이 요구하는 "발언은 웹훅,
     * 시스템 알림은 임베드" 두 모양을 한 번에 눈으로 비교할 수 있습니다.
     */
    public void sendTest(String requestedBy) {
        if (!isEnabled()) return;

        enqueue(new Payload(webhook(),
                body(trim(serverLabel() + " 서버 점검", NAME_LIMIT),
                        avatarUrl(UUID.nameUUIDFromBytes("ruc-test".getBytes(
                                java.nio.charset.StandardCharsets.UTF_8))),
                        "채팅 중계 점검 — 이 줄이 발언 모양입니다. (요청: " + requestedBy + ")",
                        null)));

        String embed = "{\"title\":" + json(serverLabel() + " 서버")
                + ",\"description\":" + json("시스템 알림 점검 — 입퇴장·발전과제·사망이 "
                        + "이 모양으로 갑니다.")
                + ",\"color\":" + 0x93e93e + "}";
        enqueue(new Payload(systemWebhook(),
                body(trim(serverLabel() + " 서버", NAME_LIMIT), null, null, embed)));
    }

    /** 대기 중인 건수. 점검 응답에 실어 보냅니다. */
    public int pending() {
        return queue.size();
    }

    // ── 큐 ─────────────────────────────────────────────────────────────

    private void enqueue(Payload payload) {
        if (!queue.offer(payload)) {
            // 오래된 것을 버리고 새 것을 넣습니다. 채팅에서 지금 일어나는 일이
            // 30초 전 일보다 중요합니다.
            queue.poll();
            dropped.incrementAndGet();
            queue.offer(payload);
        }
    }

    /** 주기 작업. 비동기 스레드에서만 돕니다. */
    private void drain() {
        if (System.currentTimeMillis() < pausedUntil) return;

        Payload payload = queue.poll();
        if (payload == null) return;

        try {
            HttpRequest request = HttpRequest.newBuilder(URI.create(payload.url()))
                    .timeout(Duration.ofSeconds(8))
                    .header("Content-Type", "application/json")
                    .header("User-Agent", "RucCore/1.0 (+https://rucserver.kr)")
                    .POST(HttpRequest.BodyPublishers.ofString(payload.body(),
                            java.nio.charset.StandardCharsets.UTF_8))
                    .build();

            HttpResponse<String> response =
                    http.send(request, HttpResponse.BodyHandlers.ofString());

            if (response.statusCode() == 429) {
                // 디스코드가 알려 준 대기 시간을 지킵니다. 무시하고 계속 쏘면
                // 더 오래 막힙니다.
                long waitMs = retryAfterMs(response.body());
                pausedUntil = System.currentTimeMillis() + waitMs;
                queue.offer(payload);          // 버리지 않고 다시 시도합니다
                plugin.getLogger().warning("디스코드 중계 속도 제한 — " + waitMs + "ms 대기");
                return;
            }

            if (response.statusCode() >= 400) {
                plugin.getLogger().warning("디스코드 중계 실패 " + response.statusCode()
                        + " — " + trim(response.body(), 200));
            }
        } catch (Exception e) {
            // 네트워크가 끊겨도 서버는 계속 돌아야 합니다. 한 건 버립니다.
            plugin.getLogger().log(Level.FINE, "디스코드 중계 전송 오류", e);
        }
    }

    /** 429 응답에서 대기 시간(ms)을 꺼냅니다. 못 읽으면 2초. */
    private long retryAfterMs(String body) {
        try {
            int at = body.indexOf("\"retry_after\"");
            if (at >= 0) {
                int colon = body.indexOf(':', at);
                int end = colon + 1;
                while (end < body.length()
                        && (Character.isDigit(body.charAt(end)) || body.charAt(end) == '.')) {
                    end++;
                }
                double seconds = Double.parseDouble(body.substring(colon + 1, end).trim());
                return Math.max(1000, (long) (seconds * 1000));
            }
        } catch (Exception ignored) {
            // 형식이 바뀌었어도 기본값으로 버팁니다.
        }
        return 2000;
    }

    // ── JSON ───────────────────────────────────────────────────────────

    /**
     * 웹훅 본문.
     *
     * <h2>{@code allowed_mentions} 가 이 메서드에서 가장 중요합니다</h2>
     * 없으면 인게임에서 {@code @everyone} 이라고 치는 것만으로 디스코드 전체에
     * 알림이 갑니다. 문자열을 걸러내는 방식은 우회가 많습니다 —
     * {@code {"parse": []}} 는 디스코드가 아예 멘션을 해석하지 않게 합니다.
     */
    private String body(String username, String avatar, String content, String embed) {
        StringBuilder sb = new StringBuilder(256);
        sb.append("{\"username\":").append(json(username));
        if (avatar != null && !avatar.isEmpty()) {
            sb.append(",\"avatar_url\":").append(json(avatar));
        }
        if (content != null) {
            sb.append(",\"content\":").append(json(content));
        }
        if (embed != null) {
            sb.append(",\"embeds\":[").append(embed).append(']');
        }
        sb.append(",\"allowed_mentions\":{\"parse\":[]}}");
        return sb.toString();
    }

    /** JSON 문자열 리터럴로. 의존성을 하나 더 들이지 않으려고 직접 씁니다. */
    private static String json(String text) {
        StringBuilder sb = new StringBuilder(text.length() + 16).append('"');
        for (int i = 0; i < text.length(); i++) {
            char c = text.charAt(i);
            switch (c) {
                case '"' -> sb.append("\\\"");
                case '\\' -> sb.append("\\\\");
                case '\n' -> sb.append("\\n");
                case '\r' -> sb.append("\\r");
                case '\t' -> sb.append("\\t");
                case '\b' -> sb.append("\\b");
                case '\f' -> sb.append("\\f");
                default -> {
                    // 제어문자는 \\u 로. 그대로 넣으면 디스코드가 400 을 돌려줍니다.
                    if (c < 0x20) {
                        sb.append(String.format("\\u%04x", (int) c));
                    } else {
                        sb.append(c);
                    }
                }
            }
        }
        return sb.append('"').toString();
    }

    private String avatarUrl(UUID uuid) {
        return plugin.getConfig()
                .getString("relay.avatar-url", "https://mc-heads.net/avatar/%uuid%/64")
                .replace("%uuid%", uuid.toString());
    }

    private static String trim(String text, int max) {
        if (text == null) return "";
        return text.length() <= max ? text : text.substring(0, max);
    }

    /** 보낼 것 하나. url 이 곧 채널입니다. */
    private record Payload(String url, String body) { }
}
