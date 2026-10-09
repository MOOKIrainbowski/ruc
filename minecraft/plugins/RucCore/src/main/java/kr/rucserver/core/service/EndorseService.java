package kr.rucserver.core.service;

import kr.rucserver.core.RucCore;
import kr.rucserver.core.model.RucPlayer;
import kr.rucserver.core.service.ScoreboardService.ReputationTier;
import kr.rucserver.core.storage.EndorseRepository;
import org.bukkit.Bukkit;
import org.bukkit.Sound;
import org.bukkit.entity.Player;
import org.bukkit.event.EventHandler;
import org.bukkit.event.Listener;
import org.bukkit.event.player.PlayerQuitEvent;
import org.bukkit.scheduler.BukkitTask;

import java.sql.SQLException;
import java.time.DayOfWeek;
import java.time.LocalDate;
import java.time.ZoneId;
import java.time.temporal.TemporalAdjusters;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.logging.Level;

/**
 * 주간 추천 {@code /추천 <닉네임>} — 평판을 올리는 길 (D4 방법 2, docs/08 D).
 *
 * <ul>
 *   <li>상대가 <b>지금 같은 서버</b>에 있고, 이번 접속에서 같이 {@code endorse.minutes-together} 분 이상 있었어야 합니다
 *       (모르는 사람 품앗이 차단). 둘 중 하나가 나가면 함께한 시간은 처음부터.</li>
 *   <li>한 주(월요일 0시, 한국 시간)에 한 표 · 같은 사람에게는 4주에 한 번.</li>
 *   <li>점수는 추천한 사람의 평판으로: 초록 12 · 노랑 8 · 빨강 4 · 보라 이하는 추천 불가.</li>
 *   <li>4주 안에 서로 추천하면(A↔B) 이번 추천은 절반, 먼저 받은 쪽도 받은 점수의 절반을 돌려놓습니다.</li>
 * </ul>
 */
public class EndorseService implements Listener {

    private static final ZoneId KST = ZoneId.of("Asia/Seoul");
    private static final long FOUR_WEEKS = 28L * 24 * 60 * 60 * 1000;

    private final RucCore plugin;
    private final MessageService messages;
    private final EndorseRepository repository;

    /** "작은UUID|큰UUID" → 이 서버에서 함께 있은 분 (메인 스레드). */
    private final Map<String, Integer> together = new HashMap<>();
    private final Set<UUID> busy = new HashSet<>();
    private BukkitTask task;

    public EndorseService(RucCore plugin, MessageService messages, EndorseRepository repository) {
        this.plugin = plugin;
        this.messages = messages;
        this.repository = repository;
    }

    public void start() {
        task = Bukkit.getScheduler().runTaskTimer(plugin, this::countMinute, 20L * 60, 20L * 60);
        var cmd = plugin.getCommand("endorse");
        if (cmd != null) cmd.setExecutor((sender, command, label, args) -> {
            if (!(sender instanceof Player player)) {
                sender.sendMessage("게임 안에서만 쓸 수 있습니다.");
                return true;
            }
            if (args.length != 1) say(player, "endorse.usage");
            else endorse(player, args[0]);
            return true;
        });
    }

    public void stop() {
        if (task != null) task.cancel();
    }

    private static String key(UUID a, UUID b) {
        return a.compareTo(b) < 0 ? a + "|" + b : b + "|" + a;
    }

    /** ponytail: 접속자 쌍마다 1분에 한 번 — n² 이라 수백 명이 되면 무거워짐. 그때는 같은 청크 · 거리 기준으로 좁힐 것. */
    private void countMinute() {
        List<Player> online = new ArrayList<>(Bukkit.getOnlinePlayers());
        for (int i = 0; i < online.size(); i++) {
            for (int j = i + 1; j < online.size(); j++) {
                together.merge(key(online.get(i).getUniqueId(), online.get(j).getUniqueId()), 1, Integer::sum);
            }
        }
    }

    @EventHandler
    public void onQuit(PlayerQuitEvent event) {
        String id = event.getPlayer().getUniqueId().toString();
        together.keySet().removeIf(k -> k.contains(id));
        busy.remove(event.getPlayer().getUniqueId());
    }

    private int points(ReputationTier tier) {
        return switch (tier) {
            case GREEN -> plugin.getConfig().getInt("endorse.points.green", 12);
            case YELLOW -> plugin.getConfig().getInt("endorse.points.yellow", 8);
            case RED -> plugin.getConfig().getInt("endorse.points.red", 4);
            default -> 0;
        };
    }

    private static long weekStart() {
        return LocalDate.now(KST).with(TemporalAdjusters.previousOrSame(DayOfWeek.MONDAY))
                .atStartOfDay(KST).toInstant().toEpochMilli();
    }

    public void endorse(Player from, String targetName) {
        Player to = Bukkit.getPlayerExact(targetName);
        if (to == null) { say(from, "endorse.not-here", "player", targetName); return; }
        if (to.equals(from)) { say(from, "endorse.self"); return; }
        RucPlayer fromData = plugin.getPlayerData().get(from);
        RucPlayer toData = plugin.getPlayerData().get(to);
        if (fromData == null || toData == null || !fromData.isVerified() || !toData.isVerified()) {
            say(from, "endorse.not-verified");
            return;
        }
        int need = plugin.getConfig().getInt("endorse.minutes-together", 20);
        int have = together.getOrDefault(key(from.getUniqueId(), to.getUniqueId()), 0);
        if (have < need) {
            say(from, "endorse.not-enough-time", "player", to.getName(), "minutes", String.valueOf(need - have));
            return;
        }
        int base = points(ReputationTier.of(fromData.getReputation()));
        if (base <= 0) { say(from, "endorse.low-tier"); return; }
        if (!busy.add(from.getUniqueId())) return;

        UUID a = from.getUniqueId(), b = to.getUniqueId();
        String toName = to.getName();
        Bukkit.getScheduler().runTaskAsynchronously(plugin, () -> {
            String fail = null;
            int gained = 0, refunded = 0;
            try {
                long now = System.currentTimeMillis();
                if (repository.countSince(a, weekStart()) > 0) fail = "endorse.weekly-used";
                else if (repository.pointsSince(a, b, now - FOUR_WEEKS) != null) fail = "endorse.same-recent";
                else {
                    Integer earlier = repository.pointsSince(b, a, now - FOUR_WEEKS);   // B 가 먼저 A 를 추천했나
                    gained = earlier == null ? base : base / 2;
                    refunded = earlier == null ? 0 : earlier / 2;
                    repository.insert(a, b, gained, now);
                }
            } catch (SQLException e) {
                plugin.getLogger().log(Level.SEVERE, "[추천] 처리 실패", e);
                fail = "endorse.error";
            }
            String reason = fail;
            int g = gained, r = refunded;
            Bukkit.getScheduler().runTask(plugin, () -> {
                busy.remove(a);
                if (reason != null) {
                    if (from.isOnline()) say(from, reason);
                    return;
                }
                addReputation(b, g);
                if (r > 0) addReputation(a, -r);
                plugin.getLogger().info("[추천] " + from.getName() + " → " + toName + " +" + g + (r > 0 ? " (상호 — 추천자 -" + r + ")" : ""));
                if (from.isOnline()) say(from, r > 0 ? "endorse.done-mutual" : "endorse.done", "player", toName, "points", String.valueOf(g));
                Player target = Bukkit.getPlayer(b);
                if (target != null) {
                    say(target, "endorse.received", "player", from.getName(), "points", String.valueOf(g));
                    target.playSound(target.getLocation(), Sound.ENTITY_PLAYER_LEVELUP, 0.6f, 1.6f);
                }
            });
        });
    }

    /**
     * 평판 더하기 (메인 스레드). 접속 중이면 캐시를 고쳐 저장, 아니면 DB 를 직접 — ReportService.applyPenalty 와 같은 판단.
     */
    public void addReputation(UUID uuid, int delta) {
        RucPlayer cached = plugin.getPlayerData().get(uuid);
        if (cached != null) {
            cached.setReputation(cached.getReputation() + delta);
            plugin.getPlayerData().saveAsync(cached);
            Player p = Bukkit.getPlayer(uuid);
            if (p != null) plugin.getScoreboards().attach(p);
            return;
        }
        Bukkit.getScheduler().runTaskAsynchronously(plugin, () -> {
            try {
                RucPlayer data = plugin.getPlayerData().getRepository().find(uuid);
                if (data == null) return;
                data.setReputation(data.getReputation() + delta);
                plugin.getPlayerData().getRepository().save(data);
            } catch (SQLException e) {
                plugin.getLogger().log(Level.SEVERE, "[추천] 평판 반영 실패: " + uuid, e);
            }
        });
    }

    private void say(Player p, String key, String... ph) {
        p.sendMessage(messages.prefixed(plugin.getPlayerData().languageOf(p), key, ph));
    }
}
