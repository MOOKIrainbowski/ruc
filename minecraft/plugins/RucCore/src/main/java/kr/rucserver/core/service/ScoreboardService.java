package kr.rucserver.core.service;

import kr.rucserver.core.RucCore;
import kr.rucserver.core.model.Guild;
import kr.rucserver.core.model.RucPlayer;
import net.kyori.adventure.text.Component;
import org.bukkit.Bukkit;
import org.bukkit.entity.Player;
import org.bukkit.scheduler.BukkitTask;
import org.bukkit.scoreboard.Criteria;
import org.bukkit.scoreboard.DisplaySlot;
import org.bukkit.scoreboard.Objective;
import org.bukkit.scoreboard.Scoreboard;
import org.bukkit.scoreboard.Team;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;

/**
 * 우측 사이드바 스코어보드 (§3.6).
 *
 * 구성:
 *   1줄 다음 레벨까지의 진행바
 *   2줄 K / D / A
 *   3줄 핑 (등급 표기)
 *   4줄 현재 접속자 / 정원
 *   5줄~ Ruc 잔고, 평판, 서버 (D9)
 *
 * §2.2에 따라 좌표는 어디에도 표시하지 않습니다.
 *
 * 구현 메모: 매 초 스코어보드를 새로 만들면 화면이 깜빡입니다. 그래서 팀의
 * prefix만 갈아끼우는 방식을 씁니다. 각 줄의 "엔트리"는 고정된 색코드 문자열이고,
 * 실제 보이는 내용은 그 팀의 prefix입니다.
 */
public class ScoreboardService {

    /** 각 줄의 고유 엔트리로 쓸 색코드. 화면에는 보이지 않습니다. */
    private static final String[] ENTRY_KEYS = {
            "§0", "§1", "§2", "§3", "§4", "§5", "§6", "§7", "§8", "§9",
            "§a", "§b", "§c", "§d", "§e", "§f"
    };

    /** 구분선 자리표시. 가운데 정렬 때 사이드바 폭에 맞춰 늘립니다. */
    private static final String DIVIDER = "&8&m";

    private final RucCore plugin;
    private final MessageService messages;
    private final XpService xp;
    private BukkitTask task;
    private BukkitTask rucTask;

    /**
     * RUC 잔고 캐시. RUC 는 접속 캐시가 아니라 DB 원장에 있어서(PaymentService.RUC) 매 초 읽을 수
     * 없습니다 — 15초마다 비동기로 다시 읽습니다. 디스코드에서 산 RUC 는 최대 15초 늦게 보입니다.
     */
    private final Map<UUID, Long> ruc = new ConcurrentHashMap<>();

    public ScoreboardService(RucCore plugin, MessageService messages, XpService xp) {
        this.plugin = plugin;
        this.messages = messages;
        this.xp = xp;
    }

    public void start() {
        if (!plugin.getConfig().getBoolean("scoreboard.enabled", true)) return;

        rucTask = Bukkit.getScheduler().runTaskTimerAsynchronously(plugin, () -> {
            for (Player player : Bukkit.getOnlinePlayers()) refreshRuc(player.getUniqueId());
            ruc.keySet().removeIf(uuid -> Bukkit.getPlayer(uuid) == null);
        }, 40L, 20L * 15);

        long interval = plugin.getConfig().getLong("scoreboard.update-interval", 20);
        task = Bukkit.getScheduler().runTaskTimer(plugin, () -> {
            for (Player player : Bukkit.getOnlinePlayers()) {
                try {
                    update(player);
                } catch (Exception e) {
                    // 한 명의 스코어보드 오류가 전체 루프를 멈추면 안 됩니다.
                    plugin.getLogger().warning("스코어보드 갱신 실패 (" + player.getName() + "): " + e.getMessage());
                }
            }
        }, 20L, interval);
    }

    /** 블로킹 — 비동기에서 부르세요. */
    public void refreshRuc(UUID uuid) {
        try {
            ruc.put(uuid, plugin.getPayments().rucBalance(uuid));
        } catch (Exception e) {
            plugin.getLogger().warning("RUC 잔고 조회 실패: " + e.getMessage());
        }
    }

    public void stop() {
        if (rucTask != null) {
            rucTask.cancel();
            rucTask = null;
        }
        if (task != null) {
            task.cancel();
            task = null;
        }
    }

    /** 접속 직후 스코어보드를 붙입니다. */
    public void attach(Player player) {
        Scoreboard board = Bukkit.getScoreboardManager().getNewScoreboard();
        String title = plugin.getConfig().getString("scoreboard.title", "&a&lRUC SERVER");

        Objective objective = board.registerNewObjective(
                "ruc", Criteria.DUMMY, MessageService.colorize(title));
        objective.setDisplaySlot(DisplaySlot.SIDEBAR);
        // 오른쪽의 빨간 점수는 줄 순서를 정하는 내부 값일 뿐이라 감춥니다 (1.20.3+).
        objective.numberFormat(io.papermc.paper.scoreboard.numbers.NumberFormat.blank());

        player.setScoreboard(board);
        update(player);
        Bukkit.getScheduler().runTaskAsynchronously(plugin, () -> refreshRuc(player.getUniqueId()));
    }

    private void update(Player player) {
        RucPlayer data = plugin.getPlayerData().get(player);
        if (data == null) return;   // 아직 로드 중

        Scoreboard board = player.getScoreboard();
        Objective objective = board.getObjective("ruc");
        if (objective == null) {
            attach(player);
            return;
        }

        List<String> lines = center(buildLines(player, data),
                plugin.getConfig().getString("scoreboard.title", "&a&lRUC SERVER"));

        // 줄 수가 줄었을 때 이전 줄이 남지 않도록 정리
        for (String entry : board.getEntries()) {
            boolean stillUsed = false;
            for (int i = 0; i < lines.size(); i++) {
                if (ENTRY_KEYS[i].equals(entry)) { stillUsed = true; break; }
            }
            if (!stillUsed) board.resetScores(entry);
        }

        // 위에서부터 보이도록 점수를 내림차순으로 부여
        int score = lines.size();
        for (int i = 0; i < lines.size(); i++) {
            String entry = ENTRY_KEYS[i];
            String teamName = "ruc_" + i;

            Team team = board.getTeam(teamName);
            if (team == null) {
                team = board.registerNewTeam(teamName);
                team.addEntry(entry);
            }
            team.prefix(MessageService.colorize(lines.get(i)));
            objective.getScore(entry).setScore(score--);
        }
    }

    private List<String> buildLines(Player player, RucPlayer data) {
        String lang = plugin.getPlayerData().languageOf(player);
        List<String> lines = new ArrayList<>();

        // 1줄 — 진행바
        int percent = (int) Math.round(xp.progress(data) * 100);
        lines.add(messages.raw(lang, "scoreboard.level")
                .replace("%level%", String.valueOf(data.getLevel()))
                .replace("%bar%", progressBar(xp.progress(data)))
                .replace("%percent%", String.valueOf(percent)));

        // 2줄 — K/D/A
        lines.add(messages.raw(lang, "scoreboard.kda")
                .replace("%kills%", String.valueOf(data.getKills()))
                .replace("%deaths%", String.valueOf(data.getDeaths()))
                .replace("%assists%", String.valueOf(data.getAssists())));

        // 3줄 — 핑 등급
        int ping = player.getPing();
        lines.add(messages.raw(lang, "scoreboard.ping")
                .replace("%dot%", pingColor(ping) + "●")
                .replace("%tier%", messages.raw(lang, pingTierKey(ping))));

        // 4줄 — 접속자 / 정원
        lines.add(messages.raw(lang, "scoreboard.online")
                .replace("%online%", String.valueOf(Bukkit.getOnlinePlayers().size()))
                .replace("%max%", String.valueOf(Bukkit.getMaxPlayers())));

        lines.add(DIVIDER);

        // 5줄 — Ruc 잔고
        lines.add(messages.raw(lang, "scoreboard.balance")
                .replace("%amount%", EconomyService.format(data.getRuc()))
                .replace("%symbol%", plugin.getEconomy().symbol()));

        // 5-2줄 — RUC 잔고 (2026-10-05). 아직 못 읽었으면 줄을 비우지 않고 0 으로.
        lines.add(messages.raw(lang, "scoreboard.ruc")
                .replace("%amount%", EconomyService.format(ruc.getOrDefault(player.getUniqueId(), 0L))));

        // 6줄 — 평판
        ReputationTier tier = ReputationTier.of(data.getReputation());
        lines.add(messages.raw(lang, "scoreboard.reputation")
                .replace("%color%", tier.color())
                .replace("%tier%", messages.raw(lang, "reputation." + tier.key())));

        // 7줄 — 소속 길드 / 국가 (§3.5). 무소속이면 줄 자체를 넣지 않습니다 —
        // "무소속" 을 계속 띄우면 사이드바에서 가장 쓸모없는 줄이 됩니다.
        Guild guild = plugin.getGuilds().of(player);
        if (guild != null) {
            lines.add(messages.raw(lang, "scoreboard.guild")
                    .replace("%dot%", messages.raw(lang, guild.isNation()
                            ? "guild.status.nation" : "guild.status.guild"))
                    .replace("%guild%", guild.getName()));
        }

        // 8줄 — 현재 서버
        lines.add(messages.raw(lang, "scoreboard.server")
                .replace("%server%", plugin.getConfig()
                        .getString("server-display-name", "홈")));

        return lines;
    }

    /**
     * 사이드바는 왼쪽 정렬뿐이라, 가장 넓은 줄(제목 포함)에 맞춰 앞에 공백을 채워 가운데로 보냅니다.
     * 구분선은 그 폭만큼 늘립니다.
     */
    static List<String> center(List<String> lines, String title) {
        int max = width(title);
        for (String line : lines) if (!DIVIDER.equals(line)) max = Math.max(max, width(line));

        List<String> out = new ArrayList<>(lines.size());
        for (String line : lines) {
            if (DIVIDER.equals(line)) {
                out.add(DIVIDER + " ".repeat(max / 4));
            } else {
                out.add(" ".repeat(Math.round((max - width(line)) / 8f)) + line);   // 공백 = 4px
            }
        }
        return out;
    }

    /**
     * 기본 폰트 기준 화면 폭(px, 글자 사이 1px 포함). & 색코드는 0, 굵게는 글자당 +1.
     * ponytail: 한글·기호는 일괄 9px 로 어림 — 글리프마다 1~2px 어긋날 수 있음. 거슬리면 글자별 표로 바꾸세요.
     */
    static int width(String text) {
        int w = 0;
        boolean bold = false;
        for (int i = 0; i < text.length(); i++) {
            char c = text.charAt(i);
            if ((c == '&' || c == '§') && i + 1 < text.length()) {
                char code = Character.toLowerCase(text.charAt(++i));
                if (code == 'l') bold = true;
                else if ("0123456789abcdefr".indexOf(code) >= 0) bold = false;
                continue;
            }
            w += charWidth(c) + (bold ? 1 : 0);
        }
        return w;
    }

    private static int charWidth(char c) {
        if (c == ' ') return 4;
        if ("!',.:;i|".indexOf(c) >= 0) return 2;
        if ("l`".indexOf(c) >= 0) return 3;
        if ("It[]".indexOf(c) >= 0) return 4;
        if ("\"()*<>fk{}".indexOf(c) >= 0) return 5;
        if ("@~".indexOf(c) >= 0) return 7;
        return c < 128 ? 6 : 9;
    }

    /**
     * 5칸짜리 진행바 (사이드바 폭을 줄이려고 10칸에서 줄임).
     *
     * 반올림을 쓰면 90%에서 이미 5칸이 다 차서, 레벨업이 안 되는 것처럼 보입니다.
     * 내림을 써야 "막대가 꽉 참 = 레벨업 직전"이 실제와 맞습니다.
     */
    private String progressBar(double progress) {
        int filled = (int) Math.floor(progress * 5);
        if (filled > 5) filled = 5;
        if (filled < 0) filled = 0;

        StringBuilder sb = new StringBuilder();
        for (int i = 0; i < 5; i++) {
            sb.append(i < filled ? "&a" : "&8").append("▰");
        }
        return sb.toString();
    }

    /** §3.6 3줄 — 핑을 숫자가 아니라 등급으로 보여줍니다. */
    private String pingTierKey(int ping) {
        if (ping <= 50) return "ping.excellent";
        if (ping <= 100) return "ping.good";
        if (ping <= 180) return "ping.fair";
        if (ping <= 300) return "ping.weak";
        return "ping.poor";
    }

    private String pingColor(int ping) {
        if (ping <= 50) return "&a";
        if (ping <= 100) return "&2";
        if (ping <= 180) return "&e";
        if (ping <= 300) return "&6";
        return "&c";
    }

    /** 평판 7티어 (§3.7 / D4). */
    public enum ReputationTier {
        GREEN("green", "&a", 300),
        YELLOW("yellow", "&e", 150),
        RED("red", "&c", 50),
        PURPLE("purple", "&5", 0),
        BLUE("blue", "&9", -100),
        INDIGO("indigo", "&1", -300),
        DARK("dark", "&8", Integer.MIN_VALUE);

        private final String key;
        private final String color;
        private final int minScore;

        ReputationTier(String key, String color, int minScore) {
            this.key = key;
            this.color = color;
            this.minScore = minScore;
        }

        public String key() { return key; }
        public int minScore() { return minScore; }
        public String color() { return color; }

        public static ReputationTier of(int score) {
            for (ReputationTier tier : values()) {
                if (score >= tier.minScore) return tier;
            }
            return DARK;
        }
    }
}
