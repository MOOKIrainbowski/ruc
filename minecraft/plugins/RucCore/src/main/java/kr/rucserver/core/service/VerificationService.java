package kr.rucserver.core.service;

import kr.rucserver.core.RucCore;
import kr.rucserver.core.model.RucPlayer;
import kr.rucserver.core.storage.VerificationRepository;
import net.kyori.adventure.bossbar.BossBar;
import net.kyori.adventure.title.Title;
import org.bukkit.Bukkit;
import org.bukkit.Location;
import org.bukkit.Sound;
import org.bukkit.World;
import org.bukkit.entity.Player;
import org.bukkit.scheduler.BukkitTask;

import java.security.SecureRandom;
import java.sql.SQLException;
import java.time.Duration;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.logging.Level;

/**
 * 디스코드 인증 (D10).
 *
 * 미인증 플레이어는 접속은 되지만 인증 구역에 격리되어 아무 행동도 할 수 없습니다.
 * 실제 그리핑 차단력은 코드 자체가 아니라 "디스코드 1 : 마크 1" 제약에서 나옵니다 —
 * 부계정을 만들려면 전화번호 인증된 새 디스코드 계정이 필요해집니다.
 * 이 1:1 제약은 ruc_player.discord_id 의 UNIQUE 인덱스가 DB 차원에서 강제합니다.
 */
public class VerificationService {

    /** 인증 시도 결과. MOOKI가 이 이름을 그대로 받아 사용자에게 보여줍니다. */
    public enum Result {
        SUCCESS,
        INVALID_CODE,
        EXPIRED,
        DISCORD_ALREADY_LINKED,
        MC_ALREADY_LINKED,
        ERROR
    }

    private static final SecureRandom RANDOM = new SecureRandom();

    private final RucCore plugin;
    private final MessageService messages;
    private final VerificationRepository repository;

    private final Map<UUID, BossBar> bossBars = new ConcurrentHashMap<>();
    private final Map<UUID, Long> lastIssued = new ConcurrentHashMap<>();

    private BukkitTask pollTask;

    public VerificationService(RucCore plugin, MessageService messages,
                               VerificationRepository repository) {
        this.plugin = plugin;
        this.messages = messages;
        this.repository = repository;
    }

    public boolean isEnabled() {
        return plugin.getConfig().getBoolean("verification.enabled", true);
    }

    /** 인증이 필요한 상태인가. 데이터 로딩 중이면 안전하게 true로 봅니다. */
    public boolean requiresVerification(Player player) {
        if (!isEnabled()) return false;
        if (player.hasPermission("ruccore.admin")) return false;

        RucPlayer data = plugin.getPlayerData().get(player);
        if (data == null) return true;   // 로딩 중에는 막아둡니다
        return !data.isVerified();
    }

    public Location getVerificationArea() {
        String worldName = plugin.getConfig().getString("verification.area.world", "world");
        World world = Bukkit.getWorld(worldName);
        if (world == null) world = Bukkit.getWorlds().get(0);

        return new Location(world,
                plugin.getConfig().getDouble("verification.area.x", 0.5),
                plugin.getConfig().getDouble("verification.area.y", 100.0),
                plugin.getConfig().getDouble("verification.area.z", 0.5),
                (float) plugin.getConfig().getDouble("verification.area.yaw", 0.0),
                (float) plugin.getConfig().getDouble("verification.area.pitch", 0.0));
    }

    public double getAreaRadius() {
        return plugin.getConfig().getDouble("verification.area.radius", 15.0);
    }

    /** 접속 직후 호출 — 격리하고 코드를 발급합니다. */
    public void beginVerification(Player player) {
        player.teleport(getVerificationArea());
        issueCode(player, false);
    }

    /**
     * 코드를 발급하고 화면에 표시합니다.
     *
     * @param manual /인증 명령으로 직접 요청한 경우 true (쿨타임 적용)
     */
    public void issueCode(Player player, boolean manual) {
        String lang = plugin.getPlayerData().languageOf(player);
        UUID uuid = player.getUniqueId();

        if (manual) {
            Long last = lastIssued.get(uuid);
            int cooldown = plugin.getConfig().getInt("verification.code.resend-cooldown-seconds", 60);
            if (last != null && System.currentTimeMillis() - last < cooldown * 1000L) {
                long remain = (cooldown * 1000L - (System.currentTimeMillis() - last) + 999) / 1000;
                player.sendMessage(messages.prefixed(lang, "verify.code-cooldown",
                        "seconds", String.valueOf(remain)));
                return;
            }
        }

        int expireSeconds = plugin.getConfig().getInt("verification.code.expire-seconds", 600);

        plugin.getServer().getScheduler().runTaskAsynchronously(plugin, () -> {
            String code;
            try {
                // 충돌이 나면 다시 뽑습니다. 6자리라 실질적으로 거의 안 부딪힙니다.
                int attempts = 0;
                do {
                    code = generateCode();
                    attempts++;
                } while (repository.exists(code) && attempts < 10);

                long now = System.currentTimeMillis();
                repository.issue(new VerificationRepository.Code(
                        code, uuid, player.getName(), now, now + expireSeconds * 1000L));
            } catch (SQLException e) {
                plugin.getLogger().log(Level.SEVERE, "인증 코드 발급 실패: " + player.getName(), e);
                plugin.getServer().getScheduler().runTask(plugin, () ->
                        player.sendMessage(messages.prefixed(lang, "verify.system-down")));
                return;
            }

            final String issued = code;
            lastIssued.put(uuid, System.currentTimeMillis());

            plugin.getServer().getScheduler().runTask(plugin, () -> {
                if (!player.isOnline()) return;
                showCode(player, issued, expireSeconds);
            });
        });
    }

    private String generateCode() {
        int length = plugin.getConfig().getInt("verification.code.length", 6);
        StringBuilder sb = new StringBuilder(length);
        for (int i = 0; i < length; i++) {
            sb.append(RANDOM.nextInt(10));
        }
        return sb.toString();
    }

    /** 코드를 타이틀·채팅·보스바로 보여줍니다. */
    private void showCode(Player player, String code, int expireSeconds) {
        String lang = plugin.getPlayerData().languageOf(player);
        String invite = "discord.gg/sTVAJ38ea";
        int minutes = Math.max(1, expireSeconds / 60);

        player.showTitle(Title.title(
                messages.get(lang, "verify.title"),
                messages.get(lang, "verify.subtitle", "code", code),
                Title.Times.times(Duration.ofMillis(300), Duration.ofSeconds(5), Duration.ofMillis(500))));

        player.sendMessage(messages.get(lang, "verify.chat-header"));
        player.sendMessage(messages.get(lang, "verify.chat-1"));
        player.sendMessage(messages.get(lang, "verify.chat-2", "invite", invite));
        player.sendMessage(messages.get(lang, "verify.chat-3", "code", code));
        player.sendMessage(messages.get(lang, "verify.chat-4", "minutes", String.valueOf(minutes)));
        player.sendMessage(messages.get(lang, "verify.chat-header"));

        player.playSound(player.getLocation(), Sound.BLOCK_NOTE_BLOCK_BELL, 1.0f, 1.0f);

        attachBossBar(player, code, expireSeconds);
    }

    private void attachBossBar(Player player, String code, int expireSeconds) {
        removeBossBar(player);

        String lang = plugin.getPlayerData().languageOf(player);
        BossBar bar = BossBar.bossBar(
                messages.get(lang, "verify.bossbar",
                        "code", code, "seconds", String.valueOf(expireSeconds)),
                1.0f, BossBar.Color.RED, BossBar.Overlay.PROGRESS);

        player.showBossBar(bar);
        bossBars.put(player.getUniqueId(), bar);

        long deadline = System.currentTimeMillis() + expireSeconds * 1000L;

        Bukkit.getScheduler().runTaskTimer(plugin, task -> {
            if (!player.isOnline() || !bossBars.containsKey(player.getUniqueId())) {
                task.cancel();
                return;
            }
            long remain = deadline - System.currentTimeMillis();
            if (remain <= 0) {
                removeBossBar(player);
                player.sendMessage(messages.prefixed(lang, "verify.code-expired"));
                task.cancel();
                return;
            }
            float progress = Math.max(0f, Math.min(1f, (float) remain / (expireSeconds * 1000f)));
            bar.progress(progress);
            bar.name(messages.get(lang, "verify.bossbar",
                    "code", code, "seconds", String.valueOf(remain / 1000)));
        }, 20L, 20L);
    }

    private void removeBossBar(Player player) {
        BossBar bar = bossBars.remove(player.getUniqueId());
        if (bar != null) player.hideBossBar(bar);
    }

    /**
     * 코드 검증 + 연동. MOOKI가 RCON으로 호출합니다.
     * 블로킹 I/O이므로 비동기 스레드에서 부르세요.
     */
    public Result verify(String code, String discordId, String discordName) {
        try {
            VerificationRepository.Code entry = repository.findByCode(code);
            if (entry == null) return Result.INVALID_CODE;

            if (entry.isExpired()) {
                repository.delete(code);
                return Result.EXPIRED;
            }

            // 이 디스코드 계정이 이미 다른 마크 계정에 묶여 있는가 (D10 1:1)
            RucPlayer existing = plugin.getPlayerData().getRepository().findByDiscordId(discordId);
            if (existing != null && !existing.getUuid().equals(entry.uuid())) {
                return Result.DISCORD_ALREADY_LINKED;
            }

            RucPlayer target = plugin.getPlayerData().getRepository().find(entry.uuid());
            if (target == null) return Result.ERROR;
            if (target.isVerified()) {
                repository.delete(code);
                return Result.MC_ALREADY_LINKED;
            }

            target.setDiscordId(discordId);
            target.setVerifiedAt(System.currentTimeMillis());
            plugin.getPlayerData().getRepository().save(target);
            repository.delete(code);

            // 캐시에도 반영 — 접속 중이면 폴링이 바로 잡아냅니다.
            RucPlayer cached = plugin.getPlayerData().get(entry.uuid());
            if (cached != null) {
                cached.setDiscordId(discordId);
                cached.setVerifiedAt(target.getVerifiedAt());
            }

            plugin.getLogger().info("인증 완료: " + entry.name()
                    + " ↔ 디스코드 " + discordName + " (" + discordId + ")");
            return Result.SUCCESS;

        } catch (SQLException e) {
            plugin.getLogger().log(Level.SEVERE, "인증 처리 실패 (code=" + code + ")", e);
            return Result.ERROR;
        }
    }

    /** 스태프 수동 승인 (D10 가용성 대비 — 봇이 죽어도 사람을 들여보낼 수 있게). */
    public boolean approveManually(Player target, String staffName) {
        RucPlayer data = plugin.getPlayerData().get(target);
        if (data == null || data.isVerified()) return false;

        // 디스코드 ID 자리에 수동 승인 표시를 남겨 추적 가능하게 합니다.
        data.setDiscordId("manual:" + target.getUniqueId());
        data.setVerifiedAt(System.currentTimeMillis());
        plugin.getPlayerData().saveAsync(data);

        plugin.getLogger().info("수동 인증 승인: " + target.getName() + " (승인자: " + staffName + ")");
        release(target);
        return true;
    }

    /** 인증이 끝난 플레이어를 격리에서 풀어줍니다. */
    public void release(Player player) {
        removeBossBar(player);
        lastIssued.remove(player.getUniqueId());

        String lang = plugin.getPlayerData().languageOf(player);
        player.sendMessage(messages.prefixed(lang, "verify.success"));
        player.playSound(player.getLocation(), Sound.ENTITY_PLAYER_LEVELUP, 1.0f, 1.5f);
        player.showTitle(Title.title(
                messages.get(lang, "verify.success"),
                messages.get(lang, "verify.chat-header"),
                Title.Times.times(Duration.ofMillis(300), Duration.ofSeconds(3), Duration.ofMillis(500))));

        // 스폰으로 이동
        World world = player.getWorld();
        player.teleport(world.getSpawnLocation());
    }

    /**
     * 미인증 접속자를 주기적으로 확인해, 디스코드에서 인증이 끝났으면 풀어줍니다.
     *
     * 폴링을 쓰는 이유: 봇(Node)과 서버(Java)가 다른 프로세스라 즉시 알릴 통로가
     * 없습니다. 대상이 "인증 구역에 갇힌 사람"뿐이라 부하는 무시할 수준입니다.
     */
    public void startPolling() {
        if (!isEnabled()) return;

        long interval = plugin.getConfig().getLong("verification.poll-interval-ticks", 60);

        pollTask = Bukkit.getScheduler().runTaskTimer(plugin, () -> {
            for (Player player : Bukkit.getOnlinePlayers()) {
                RucPlayer cached = plugin.getPlayerData().get(player);
                if (cached == null || cached.isVerified()) continue;

                plugin.getServer().getScheduler().runTaskAsynchronously(plugin, () -> {
                    try {
                        RucPlayer fresh = plugin.getPlayerData().getRepository()
                                .find(player.getUniqueId());
                        if (fresh == null || !fresh.isVerified()) return;

                        plugin.getServer().getScheduler().runTask(plugin, () -> {
                            if (!player.isOnline()) return;
                            RucPlayer live = plugin.getPlayerData().get(player);
                            if (live == null || live.isVerified()) return;

                            live.setDiscordId(fresh.getDiscordId());
                            live.setVerifiedAt(fresh.getVerifiedAt());
                            release(player);
                        });
                    } catch (SQLException e) {
                        plugin.getLogger().log(Level.WARNING, "인증 상태 확인 실패", e);
                    }
                });
            }
        }, interval, interval);

        // 만료 코드 정리 — 5분마다
        Bukkit.getScheduler().runTaskTimerAsynchronously(plugin, () -> {
            try {
                repository.purgeExpired();
            } catch (SQLException e) {
                plugin.getLogger().log(Level.WARNING, "만료 코드 정리 실패", e);
            }
        }, 6000L, 6000L);
    }

    public void stop() {
        if (pollTask != null) {
            pollTask.cancel();
            pollTask = null;
        }
        for (Player player : Bukkit.getOnlinePlayers()) {
            removeBossBar(player);
        }
        bossBars.clear();
    }

    public void cleanup(UUID uuid) {
        BossBar bar = bossBars.remove(uuid);
        Player player = Bukkit.getPlayer(uuid);
        if (bar != null && player != null) player.hideBossBar(bar);
        lastIssued.remove(uuid);
    }

    public VerificationRepository getRepository() {
        return repository;
    }
}
