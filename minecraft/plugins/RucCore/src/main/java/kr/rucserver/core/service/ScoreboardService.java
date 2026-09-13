package kr.rucserver.core.service;

import kr.rucserver.core.RucCore;
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

    private final RucCore plugin;
    private final MessageService messages;
    private final XpService xp;
    private BukkitTask task;

    public ScoreboardService(RucCore plugin, MessageService messages, XpService xp) {
        this.plugin = plugin;
        this.messages = messages;
        this.xp = xp;
    }

    public void start() {
        if (!plugin.getConfig().getBoolean("scoreboard.enabled", true)) return;

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

    public void stop() {
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

        player.setScoreboard(board);
        update(player);
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

        List<String> lines = buildLines(player, data);

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

        lines.add("&8&m                    ");

        // 5줄 — Ruc 잔고
        lines.add(messages.raw(lang, "scoreboard.balance")
                .replace("%amount%", EconomyService.format(data.getRuc()))
                .replace("%symbol%", plugin.getEconomy().symbol()));

        // 6줄 — 평판
        ReputationTier tier = ReputationTier.of(data.getReputation());
        lines.add(messages.raw(lang, "scoreboard.reputation")
                .replace("%color%", tier.color())
                .replace("%tier%", messages.raw(lang, "reputation." + tier.key())));

        // 7줄 — 현재 서버
        lines.add(messages.raw(lang, "scoreboard.server")
                .replace("%server%", plugin.getConfig()
                        .getString("server-display-name", "홈")));

        return lines;
    }

    /**
     * 10칸짜리 진행바.
     *
     * 반올림을 쓰면 95%에서 이미 10칸이 다 차서, 레벨업이 안 되는 것처럼 보입니다.
     * 내림을 써야 "막대가 꽉 참 = 레벨업 직전"이 실제와 맞습니다.
     */
    private String progressBar(double progress) {
        int filled = (int) Math.floor(progress * 10);
        if (filled > 10) filled = 10;
        if (filled < 0) filled = 0;

        StringBuilder sb = new StringBuilder();
        for (int i = 0; i < 10; i++) {
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
        public String color() { return color; }

        public static ReputationTier of(int score) {
            for (ReputationTier tier : values()) {
                if (score >= tier.minScore) return tier;
            }
            return DARK;
        }
    }
}
