package kr.rucserver.raid.service;

import kr.rucserver.core.model.RucPlayer;
import kr.rucserver.core.service.EconomyService;
import kr.rucserver.core.service.ScoreboardService.ReputationTier;
import kr.rucserver.core.storage.BountyRepository;
import kr.rucserver.raid.RucRaid;
import org.bukkit.Bukkit;
import org.bukkit.Location;
import org.bukkit.Sound;
import org.bukkit.entity.Player;
import org.bukkit.event.EventHandler;
import org.bukkit.event.EventPriority;
import org.bukkit.event.Listener;
import org.bukkit.event.entity.PlayerDeathEvent;
import org.bukkit.event.player.PlayerQuitEvent;
import org.bukkit.scheduler.BukkitTask;

import java.sql.SQLException;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import java.util.UUID;
import java.util.logging.Level;

/**
 * 평판 현상금 (2026-10-09, docs/08-UNIQUE-FEATURES.md A).
 *
 * <ul>
 *   <li>평판 <b>보라 이하</b>(보라 · 파랑 · 남색 · 검정)는 약탈 서버에 있는 동안 <b>수배자</b>입니다.</li>
 *   <li>현상금 풀 = 제재로 몰수된 Gold (Core SanctionService 가 적립). 수배자를 처치하면 풀의
 *       {@code bounty.share-percent}% (최소 {@code bounty.min-payout}, 풀이 그보다 적으면 풀 전부)를 받습니다.</li>
 *   <li>처치당한 수배자는 {@code bounty.immunity-hours} 시간 동안 수배 면제 — 계속 사냥당하지 않게, 그리고 짜고 죽여 주며
 *       풀을 빼먹지 못하게.</li>
 *   <li>받는 조건: 디스코드 인증 · 레벨 {@code bounty.min-level} 이상 (갓 만든 부계정 차단 — 나머지는 규칙 0.9 · 0.12).</li>
 *   <li>수배자 위치는 {@code bounty.reveal-minutes} 분마다 대략(50칸 단위)만 공지합니다.</li>
 * </ul>
 * 이름표 · 탭 목록은 칭호(TitleService)가 쓰므로 건드리지 않습니다 — 공지 · 액션바 · {@code /현상금} 으로 알립니다.
 */
public class BountyService implements Listener {

    private static final long HOUR = 3_600_000L;

    private final RucRaid plugin;
    private final BountyRepository repository;

    /** 지금 수배 중 (메인 스레드) */
    private final Set<UUID> wanted = new HashSet<>();
    /** 면제 중 — 20초마다 DB 에서 다시 읽음 */
    private volatile Set<UUID> immune = Set.of();
    private volatile long poolCache;
    private BukkitTask refreshTask, revealTask;

    public BountyService(RucRaid plugin, BountyRepository repository) {
        this.plugin = plugin;
        this.repository = repository;
    }

    public void start() {
        refreshTask = Bukkit.getScheduler().runTaskTimer(plugin, this::refresh, 40L, 20L * 20);
        long reveal = Math.max(1, plugin.getConfig().getLong("bounty.reveal-minutes", 2)) * 60L * 20L;
        revealTask = Bukkit.getScheduler().runTaskTimer(plugin, this::reveal, reveal, reveal);
    }

    public void stop() {
        if (refreshTask != null) refreshTask.cancel();
        if (revealTask != null) revealTask.cancel();
    }

    private static boolean badTier(RucPlayer data) {
        ReputationTier t = ReputationTier.of(data.getReputation());
        return t == ReputationTier.PURPLE || t == ReputationTier.BLUE
                || t == ReputationTier.INDIGO || t == ReputationTier.DARK;
    }

    public boolean isWanted(UUID uuid) { return wanted.contains(uuid); }

    /** 마지막으로 읽은 풀 (웹 피드용) */
    public long pool() { return poolCache; }

    public int wantedCount() { return wanted.size(); }

    /** 20초마다 — 수배 목록을 맞추고, 면제 · 풀은 비동기로 다시 읽습니다. */
    private void refresh() {
        List<UUID> candidates = new ArrayList<>();
        for (Player p : Bukkit.getOnlinePlayers()) {
            if (!plugin.isRaidWorld(p.getWorld())) continue;
            RucPlayer data = plugin.core().getPlayerData().get(p);
            if (data != null && badTier(data)) candidates.add(p.getUniqueId());
        }
        Set<UUID> now = new HashSet<>(candidates);
        now.removeAll(immune);
        for (UUID uuid : now) {
            Player p = Bukkit.getPlayer(uuid);
            if (p == null) continue;
            if (wanted.add(uuid)) plugin.msg().send(p, "bounty.you-are-wanted");
            plugin.msg().sendActionBar(p, "bounty.actionbar");
        }
        for (UUID uuid : new ArrayList<>(wanted)) {
            if (now.contains(uuid)) continue;
            wanted.remove(uuid);
            Player p = Bukkit.getPlayer(uuid);
            if (p != null) plugin.msg().send(p, "bounty.cleared");
        }

        long since = System.currentTimeMillis() - immunityMs();
        Bukkit.getScheduler().runTaskAsynchronously(plugin, () -> {
            try {
                Set<UUID> imm = new HashSet<>();
                for (UUID c : candidates) if (repository.claimedSince(c, since)) imm.add(c);
                immune = imm;
                poolCache = repository.pool();
            } catch (SQLException e) {
                plugin.getLogger().log(Level.WARNING, "[현상금] 갱신 실패", e);
            }
        });
    }

    private long immunityMs() {
        return plugin.getConfig().getLong("bounty.immunity-hours", 24) * HOUR;
    }

    /** 수배자 위치를 대략 공지 (최대 5명). */
    private void reveal() {
        int shown = 0;
        for (UUID uuid : wanted) {
            Player p = Bukkit.getPlayer(uuid);
            if (p == null || shown++ >= 5) continue;
            Location l = p.getLocation();
            Bukkit.broadcast(plugin.msg().broadcast("bounty.reveal",
                    "player", p.getName(),
                    "x", String.valueOf(Math.round(l.getX() / 50) * 50),
                    "z", String.valueOf(Math.round(l.getZ() / 50) * 50),
                    "payout", EconomyService.format(payout(poolCache)),
                    "symbol", plugin.core().getEconomy().symbol()));
        }
    }

    private long payout(long pool) {
        long share = pool * plugin.getConfig().getLong("bounty.share-percent", 10) / 100;
        long min = plugin.getConfig().getLong("bounty.min-payout", 2000);
        return Math.min(pool, Math.max(min, share));
    }

    // ── 처치 ───────────────────────────────────────────────────────────

    @EventHandler(priority = EventPriority.MONITOR)
    public void onDeath(PlayerDeathEvent event) {
        Player victim = event.getPlayer();
        Player killer = victim.getKiller();
        UUID v = victim.getUniqueId();
        if (!wanted.contains(v) || killer == null || killer.equals(victim)) return;
        if (plugin.getExecutions().isExecuting(v)) return;   // 전투로그 처형은 처치가 아님
        wanted.remove(v);   // 같은 틱에 두 번 받지 않게

        RucPlayer killerData = plugin.core().getPlayerData().get(killer);
        int minLevel = plugin.getConfig().getInt("bounty.min-level", 10);
        boolean eligible = killerData != null && killerData.isVerified() && killerData.getLevel() >= minLevel;
        UUID k = killer.getUniqueId();
        String victimName = victim.getName(), killerName = killer.getName();

        Bukkit.getScheduler().runTaskAsynchronously(plugin, () -> {
            long paid = 0;
            try {
                if (repository.claimedSince(v, System.currentTimeMillis() - immunityMs())) return;   // 다른 서버 · 동시 처치
                if (eligible) {
                    long want = payout(repository.pool());
                    if (want > 0 && repository.takeFromPool(want)) paid = want;
                }
                // 받을 자격이 없어도 기록합니다 — 수배자는 어쨌든 면제가 시작됩니다.
                repository.insertClaim(v, victimName, k, killerName, paid, System.currentTimeMillis());
            } catch (SQLException e) {
                plugin.getLogger().log(Level.SEVERE, "[현상금] 처리 실패 " + killerName + " → " + victimName, e);
                return;
            }
            long amount = paid;
            Bukkit.getScheduler().runTask(plugin, () -> {
                String symbol = plugin.core().getEconomy().symbol();
                if (amount > 0) {
                    Player kp = Bukkit.getPlayer(k);
                    if (kp == null || !plugin.core().getEconomy().deposit(k, amount)) {
                        // 그 사이 나갔으면 풀로 되돌립니다.
                        Bukkit.getScheduler().runTaskAsynchronously(plugin, () -> {
                            try { repository.addToPool(amount); } catch (SQLException ignored) { }
                        });
                        return;
                    }
                    kp.playSound(kp.getLocation(), Sound.ENTITY_PLAYER_LEVELUP, 0.8f, 0.8f);
                }
                Bukkit.broadcast(plugin.msg().broadcast(amount > 0 ? "bounty.claimed" : "bounty.claimed-none",
                        "killer", killerName, "player", victimName,
                        "amount", EconomyService.format(amount), "symbol", symbol));
                plugin.core().getRelay().relaySystem("bounty",
                        "🎯 **" + killerName + "** 이(가) 수배자 **" + victimName + "** 을(를) 처치"
                                + (amount > 0 ? " — 현상금 " + EconomyService.format(amount) + " " + symbol : ""),
                        0xE5484D);
                plugin.getLogger().info("[현상금] " + killerName + " → " + victimName + " " + amount);
            });
        });
    }

    @EventHandler
    public void onQuit(PlayerQuitEvent event) {
        wanted.remove(event.getPlayer().getUniqueId());
    }

    /** /현상금 — 풀 · 지금 수배자 */
    public void show(org.bukkit.command.CommandSender to) {
        List<String> names = new ArrayList<>();
        for (UUID uuid : wanted) {
            Player p = Bukkit.getPlayer(uuid);
            if (p != null) names.add(p.getName());
        }
        plugin.msg().send(to, "bounty.info",
                "pool", EconomyService.format(poolCache),
                "payout", EconomyService.format(payout(poolCache)),
                "symbol", plugin.core().getEconomy().symbol(),
                "wanted", names.isEmpty() ? plugin.msg().raw(to, "bounty.none") : String.join(", ", names));
    }
}
