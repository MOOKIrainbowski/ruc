package kr.rucserver.core.service;

import kr.rucserver.core.RucCore;
import kr.rucserver.core.model.Guild;
import kr.rucserver.core.model.GuildMember;
import kr.rucserver.core.model.GuildRank;
import kr.rucserver.core.model.RucPlayer;
import kr.rucserver.core.storage.GuildRepository;
import org.bukkit.Bukkit;
import org.bukkit.entity.Player;
import org.bukkit.scheduler.BukkitTask;

import java.sql.SQLException;
import java.time.DayOfWeek;
import java.time.ZoneId;
import java.time.ZonedDateTime;
import java.time.temporal.ChronoUnit;
import java.time.temporal.TemporalAdjusters;
import java.util.ArrayList;
import java.util.Collections;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.UUID;
import java.util.function.Consumer;
import java.util.logging.Level;
import java.util.regex.Pattern;

/**
 * 길드 · 국가 (§3.5, §2.6). 네트워크 전역이므로 Core가 소유합니다.
 *
 * <h2>캐시 전략</h2>
 * 원본은 DB이고, 4개 서버가 각자 <b>읽기 전용 스냅샷</b>을 들고 있습니다. 스코어보드가
 * 매 초 조회하기 때문에 조회 경로에는 DB가 있어서는 안 되고, 반대로 다른 서버에서
 * 일어난 변경(가입·탈퇴)도 보여야 합니다. 그래서:
 *
 * <ul>
 *   <li>조회는 전부 메모리 스냅샷에서. 메인 스레드에서 안전합니다.</li>
 *   <li>변경은 DB에 먼저 쓰고, 성공하면 스냅샷을 새로 만듭니다.</li>
 *   <li>다른 서버가 일으킨 변경은 주기 갱신(refresh-seconds)으로 따라잡습니다.</li>
 * </ul>
 *
 * 스냅샷은 통째로 교체합니다. 제자리에서 수정하면 스코어보드가 읽는 중에 바뀌어
 * 동시성 문제가 생깁니다.
 */
public class GuildService {

    /** 길드 이름·태그에 허용하는 문자. 색코드(&amp;)와 공백을 원천적으로 막습니다. */
    private static final Pattern ALLOWED = Pattern.compile("^[0-9A-Za-z가-힣]+$");

    private final RucCore plugin;
    private final MessageService messages;
    private final GuildRepository repository;

    /** 읽기 전용 스냅샷. 교체만 하고 안을 고치지 않습니다. */
    private volatile Map<Integer, Guild> guilds = Map.of();
    private volatile Map<UUID, Integer> membership = Map.of();

    private BukkitTask refreshTask;

    public GuildService(RucCore plugin, MessageService messages, GuildRepository repository) {
        this.plugin = plugin;
        this.messages = messages;
        this.repository = repository;
    }

    // ── 수명 주기 ──────────────────────────────────────────────────────

    public void start() {
        refreshAsync(null);

        long seconds = plugin.getConfig().getLong("guild.refresh-seconds", 15);
        refreshTask = Bukkit.getScheduler().runTaskTimerAsynchronously(plugin, () -> {
            reload();
            try {
                repository.purgeExpiredInvites();
            } catch (SQLException e) {
                plugin.getLogger().log(Level.WARNING, "만료된 길드 초대장 정리 실패", e);
            }
        }, seconds * 20L, seconds * 20L);
    }

    public void stop() {
        if (refreshTask != null) refreshTask.cancel();
    }

    /** 캐시를 다시 읽습니다. 비동기 스레드에서 호출하세요. */
    private void reload() {
        try {
            Map<Integer, Guild> loaded = repository.loadAll();

            Map<UUID, Integer> index = new HashMap<>();
            for (Guild guild : loaded.values()) {
                for (GuildMember member : guild.members()) {
                    index.put(member.getUuid(), guild.getId());
                }
            }

            this.guilds = Collections.unmodifiableMap(loaded);
            this.membership = Collections.unmodifiableMap(index);
        } catch (SQLException e) {
            plugin.getLogger().log(Level.SEVERE, "길드 캐시 갱신 실패", e);
        }
    }

    /** 비동기로 갱신하고, 끝나면 메인 스레드에서 {@code after} 를 실행합니다. */
    private void refreshAsync(Runnable after) {
        if (!plugin.isEnabled()) return;
        Bukkit.getScheduler().runTaskAsynchronously(plugin, () -> {
            reload();
            if (after != null) runSync(after);
        });
    }

    private void runSync(Runnable task) {
        if (!plugin.isEnabled()) return;
        Bukkit.getScheduler().runTask(plugin, task);
    }

    private void runAsync(Runnable task) {
        if (!plugin.isEnabled()) return;
        Bukkit.getScheduler().runTaskAsynchronously(plugin, task);
    }

    // ── 조회 ──────────────────────────────────────────────────────────

    /** 이 플레이어의 길드. 무소속이면 null. */
    public Guild of(UUID uuid) {
        Integer id = membership.get(uuid);
        return id == null ? null : guilds.get(id);
    }

    public Guild of(Player player) {
        return of(player.getUniqueId());
    }

    public GuildRank rankOf(UUID uuid) {
        Guild guild = of(uuid);
        return guild == null ? null : guild.rankOf(uuid);
    }

    public Guild byId(int id) {
        return guilds.get(id);
    }

    public Guild byName(String name) {
        String key = name.toLowerCase(Locale.ROOT);
        for (Guild guild : guilds.values()) {
            if (guild.getName().toLowerCase(Locale.ROOT).equals(key)
                    || guild.getTag().toLowerCase(Locale.ROOT).equals(key)) {
                return guild;
            }
        }
        return null;
    }

    /**
     * §2.6 — 국가전 서버 입장 자격. 국가로 인정된 길드의 소속원만 true.
     *
     * 프록시(RucGate)는 이 판정을 DB에서 직접 하므로, 여기와 규칙이 어긋나지
     * 않도록 양쪽 모두 "소속 길드의 nation 플래그" 하나만 봅니다.
     */
    public boolean isInNation(UUID uuid) {
        Guild guild = of(uuid);
        return guild != null && guild.isNation();
    }

    /** 시즌 점수 내림차순. 랭킹 표시용. */
    public List<Guild> ranking() {
        List<Guild> list = new ArrayList<>(guilds.values());
        list.sort((a, b) -> {
            int byPoints = Long.compare(b.getPoints(), a.getPoints());
            if (byPoints != 0) return byPoints;
            // 점수가 같으면 먼저 만든 길드가 위로. 목록 순서가 매번 흔들리지 않게 합니다.
            return Long.compare(a.getCreatedAt(), b.getCreatedAt());
        });
        return list;
    }

    public int count() {
        return guilds.size();
    }

    public int nationThreshold() {
        return plugin.getConfig().getInt("guild.nation-threshold", 10);
    }

    public int maxMembers() {
        return plugin.getConfig().getInt("guild.max-members", 30);
    }

    public int minLevel() {
        return plugin.getConfig().getInt("guild.create.min-level", 10);
    }

    public long createCost() {
        return plugin.getConfig().getLong("guild.create.cost", 100000);
    }

    // ── 창설 · 해산 ────────────────────────────────────────────────────

    /**
     * 길드 창설 (§3.5 — 최소 레벨 + Ruc 비용).
     *
     * 돈은 먼저 빼고 DB에 씁니다. 반대 순서로 하면 DB에 길드가 생긴 뒤
     * 차감이 실패하는 경우가 생기고, 그쪽이 훨씬 고치기 어렵습니다.
     * 쓰기가 실패하면 되돌려 줍니다.
     */
    public void create(Player player, String name, String tag, Consumer<Result> callback) {
        UUID uuid = player.getUniqueId();

        if (of(uuid) != null) { callback.accept(Result.ALREADY_IN_GUILD); return; }
        if (!isValidName(name)) { callback.accept(Result.NAME_INVALID); return; }
        if (!isValidTag(tag)) { callback.accept(Result.TAG_INVALID); return; }
        if (byName(name) != null) { callback.accept(Result.NAME_TAKEN); return; }
        if (byName(tag) != null) { callback.accept(Result.TAG_TAKEN); return; }

        RucPlayer data = plugin.getPlayerData().get(uuid);
        if (data == null) { callback.accept(Result.ERROR); return; }
        if (data.getLevel() < minLevel()) { callback.accept(Result.LEVEL_TOO_LOW); return; }

        long cost = createCost();
        if (!plugin.getEconomy().withdraw(uuid, cost)) {
            callback.accept(Result.NOT_ENOUGH_RUC);
            return;
        }

        String playerName = player.getName();
        runAsync(() -> {
            try {
                int id = repository.insert(name, tag, uuid, System.currentTimeMillis());
                repository.addMember(id, uuid, playerName, GuildRank.MASTER,
                        System.currentTimeMillis());
                // 창설자 한 명으로 국가가 되는 설정(임계치 1)도 반영되도록 여기서 판정합니다.
                applyNationFlag(id, 1);
                plugin.getRelay().relayChronicle("🏰 길드 **[" + tag + "] " + name + "** 창설 — 길드장 **" + playerName + "**");
                refreshAsync(() -> callback.accept(Result.OK));
            } catch (SQLException e) {
                plugin.getLogger().log(Level.WARNING, "길드 창설 실패: " + name, e);
                runSync(() -> {
                    plugin.getEconomy().deposit(uuid, cost);
                    // UNIQUE 위반이면 같은 이름을 누가 먼저 만든 것입니다.
                    callback.accept(isDuplicate(e) ? Result.NAME_TAKEN : Result.ERROR);
                });
            }
        });
    }

    /** 해산. 길드장만. 금고에 남은 Ruc는 길드장에게 돌려줍니다. */
    public void disband(Player player, Consumer<Result> callback) {
        Guild guild = of(player);
        if (guild == null) { callback.accept(Result.NOT_IN_GUILD); return; }
        if (guild.rankOf(player.getUniqueId()) != GuildRank.MASTER) {
            callback.accept(Result.NO_PERMISSION);
            return;
        }

        int id = guild.getId();
        long refund = guild.getBank();
        UUID uuid = player.getUniqueId();
        List<UUID> others = new ArrayList<>();
        for (GuildMember member : guild.members()) {
            if (!member.getUuid().equals(uuid)) others.add(member.getUuid());
        }
        String name = guild.getName();

        runAsync(() -> {
            try {
                repository.delete(id);
                refreshAsync(() -> {
                    if (refund > 0) plugin.getEconomy().deposit(uuid, refund);
                    // 같은 서버에 있는 길드원에게는 바로 알려 줍니다. 다른 서버 사람은
                    // 캐시가 갱신되면서 길드가 사라진 것을 보게 됩니다.
                    for (UUID other : others) {
                        Player online = Bukkit.getPlayer(other);
                        if (online != null) {
                            online.sendMessage(messages.prefixed(
                                    plugin.getPlayerData().languageOf(online),
                                    "guild.disbanded-notice", "guild", name));
                        }
                    }
                    callback.accept(Result.OK);
                });
            } catch (SQLException e) {
                plugin.getLogger().log(Level.WARNING, "길드 해산 실패: " + name, e);
                runSync(() -> callback.accept(Result.ERROR));
            }
        });
    }

    // ── 초대 · 가입 · 탈퇴 ────────────────────────────────────────────

    /** 초대. 부길드장 이상. 초대장은 DB에 두므로 다른 서버에서도 받을 수 있습니다. */
    public void invite(Player actor, String targetName, Consumer<Result> callback) {
        Guild guild = of(actor);
        if (guild == null) { callback.accept(Result.NOT_IN_GUILD); return; }

        GuildRank rank = guild.rankOf(actor.getUniqueId());
        if (rank == null || !rank.atLeast(GuildRank.VICE)) {
            callback.accept(Result.NO_PERMISSION);
            return;
        }
        if (guild.size() >= maxMembers()) { callback.accept(Result.GUILD_FULL); return; }

        Player target = Bukkit.getPlayerExact(targetName);
        if (target == null) { callback.accept(Result.TARGET_OFFLINE); return; }
        if (target.equals(actor)) { callback.accept(Result.CANNOT_TARGET_SELF); return; }
        if (of(target) != null) { callback.accept(Result.TARGET_ALREADY_IN_GUILD); return; }

        long ttl = plugin.getConfig().getLong("guild.invite-expire-seconds", 300);
        int id = guild.getId();
        UUID targetUuid = target.getUniqueId();
        String guildName = guild.getName();
        String actorName = actor.getName();

        runAsync(() -> {
            try {
                repository.putInvite(targetUuid, id, actorName,
                        System.currentTimeMillis() + ttl * 1000L);
                runSync(() -> {
                    Player online = Bukkit.getPlayer(targetUuid);
                    if (online != null) {
                        String lang = plugin.getPlayerData().languageOf(online);
                        online.sendMessage(messages.prefixed(lang, "guild.invited",
                                "guild", guildName, "player", actorName));
                        online.sendMessage(messages.get(lang, "guild.invited-how",
                                "guild", guildName));
                    }
                    callback.accept(Result.OK);
                });
            } catch (SQLException e) {
                plugin.getLogger().log(Level.WARNING, "길드 초대 실패", e);
                runSync(() -> callback.accept(Result.ERROR));
            }
        });
    }

    /**
     * 초대 수락.
     *
     * 초대장 존재 확인을 DB에서 하는 이유: 초대한 사람이 다른 서버에 있을 수 있고,
     * 그 서버의 캐시에만 있는 정보로는 판정할 수 없습니다.
     */
    public void accept(Player player, String guildName, Consumer<Result> callback) {
        UUID uuid = player.getUniqueId();
        if (of(uuid) != null) { callback.accept(Result.ALREADY_IN_GUILD); return; }

        Guild target = byName(guildName);
        if (target == null) { callback.accept(Result.NO_SUCH_GUILD); return; }
        if (target.size() >= maxMembers()) { callback.accept(Result.GUILD_FULL); return; }

        int id = target.getId();
        String playerName = player.getName();

        runAsync(() -> {
            try {
                boolean invited = repository.findInvites(uuid).stream()
                        .anyMatch(invite -> invite.guildId() == id);
                if (!invited) { runSync(() -> callback.accept(Result.NO_INVITE)); return; }

                repository.addMember(id, uuid, playerName, GuildRank.MEMBER,
                        System.currentTimeMillis());
                // 다른 길드 초대장까지 정리합니다. 남겨두면 "이미 소속" 인 상태로
                // 계속 수락을 시도하게 되어 혼란스럽습니다.
                repository.deleteInvites(uuid);

                Guild fresh = repository.loadAll().get(id);
                int size = fresh == null ? 1 : fresh.size();
                boolean promoted = applyNationFlag(id, size);

                refreshAsync(() -> {
                    callback.accept(Result.OK);
                    Guild joined = byId(id);
                    if (joined != null) {
                        announce(joined, "guild.member-joined", uuid,
                                "player", playerName, "guild", joined.getName());
                        if (promoted) announceNation(joined);
                    }
                });
            } catch (SQLException e) {
                plugin.getLogger().log(Level.WARNING, "길드 가입 실패: " + playerName, e);
                runSync(() -> callback.accept(isDuplicate(e)
                        ? Result.ALREADY_IN_GUILD : Result.ERROR));
            }
        });
    }

    /** 탈퇴. 길드장은 먼저 위임하거나 해산해야 합니다. */
    public void leave(Player player, Consumer<Result> callback) {
        Guild guild = of(player);
        if (guild == null) { callback.accept(Result.NOT_IN_GUILD); return; }
        if (guild.rankOf(player.getUniqueId()) == GuildRank.MASTER) {
            callback.accept(Result.IS_MASTER);
            return;
        }

        UUID uuid = player.getUniqueId();
        int id = guild.getId();
        String playerName = player.getName();
        int sizeAfter = guild.size() - 1;

        runAsync(() -> {
            try {
                repository.removeMember(uuid);
                applyNationFlag(id, sizeAfter);
                refreshAsync(() -> {
                    callback.accept(Result.OK);
                    Guild left = byId(id);
                    if (left != null) announce(left, "guild.member-left", null,
                            "player", playerName, "guild", left.getName());
                });
            } catch (SQLException e) {
                plugin.getLogger().log(Level.WARNING, "길드 탈퇴 실패: " + playerName, e);
                runSync(() -> callback.accept(Result.ERROR));
            }
        });
    }

    /** 추방. 부길드장 이상이고, 자기보다 낮은 직위만. */
    public void kick(Player actor, String targetName, Consumer<Result> callback) {
        Guild guild = of(actor);
        if (guild == null) { callback.accept(Result.NOT_IN_GUILD); return; }

        GuildRank actorRank = guild.rankOf(actor.getUniqueId());
        if (actorRank == null || !actorRank.atLeast(GuildRank.VICE)) {
            callback.accept(Result.NO_PERMISSION);
            return;
        }

        GuildMember target = findMember(guild, targetName);
        if (target == null) { callback.accept(Result.TARGET_NOT_MEMBER); return; }
        if (target.getUuid().equals(actor.getUniqueId())) {
            callback.accept(Result.CANNOT_TARGET_SELF);
            return;
        }
        // 같은 직위끼리 서로 추방할 수 있으면 부길드장 둘이 싸우다 길드가 비워집니다.
        if (target.getRank().weight() >= actorRank.weight()) {
            callback.accept(Result.RANK_TOO_HIGH);
            return;
        }

        UUID targetUuid = target.getUuid();
        String resolvedName = target.getName();
        int id = guild.getId();
        int sizeAfter = guild.size() - 1;

        runAsync(() -> {
            try {
                repository.removeMember(targetUuid);
                applyNationFlag(id, sizeAfter);
                refreshAsync(() -> {
                    callback.accept(Result.OK);
                    Player online = Bukkit.getPlayer(targetUuid);
                    if (online != null) {
                        online.sendMessage(messages.prefixed(
                                plugin.getPlayerData().languageOf(online),
                                "guild.kicked-notice", "guild", guild.getName()));
                    }
                    Guild after = byId(id);
                    if (after != null) announce(after, "guild.member-kicked", null,
                            "player", resolvedName, "guild", after.getName());
                });
            } catch (SQLException e) {
                plugin.getLogger().log(Level.WARNING, "길드 추방 실패: " + resolvedName, e);
                runSync(() -> callback.accept(Result.ERROR));
            }
        });
    }

    // ── 직위 ──────────────────────────────────────────────────────────

    /** 승진/강등. 길드장만. 길드장 직위 자체는 위임(transfer)으로만 바뀝니다. */
    public void setRank(Player actor, String targetName, GuildRank rank,
                        Consumer<Result> callback) {
        Guild guild = of(actor);
        if (guild == null) { callback.accept(Result.NOT_IN_GUILD); return; }
        if (guild.rankOf(actor.getUniqueId()) != GuildRank.MASTER) {
            callback.accept(Result.NO_PERMISSION);
            return;
        }
        if (rank == GuildRank.MASTER) { callback.accept(Result.USE_TRANSFER); return; }

        GuildMember target = findMember(guild, targetName);
        if (target == null) { callback.accept(Result.TARGET_NOT_MEMBER); return; }
        if (target.getUuid().equals(actor.getUniqueId())) {
            callback.accept(Result.CANNOT_TARGET_SELF);
            return;
        }
        if (target.getRank() == rank) { callback.accept(Result.NO_CHANGE); return; }

        UUID targetUuid = target.getUuid();
        String resolvedName = target.getName();
        int id = guild.getId();

        runAsync(() -> {
            try {
                repository.setRank(targetUuid, rank);
                refreshAsync(() -> {
                    callback.accept(Result.OK);
                    Guild after = byId(id);
                    if (after != null) {
                        announce(after, "guild.rank-changed", null,
                                "player", resolvedName,
                                "rank", messages.raw(
                                        plugin.getConfig().getString("language.default", "ko"),
                                        rank.key()));
                    }
                });
            } catch (SQLException e) {
                plugin.getLogger().log(Level.WARNING, "길드 직위 변경 실패", e);
                runSync(() -> callback.accept(Result.ERROR));
            }
        });
    }

    /** 길드장 위임. 넘긴 사람은 부길드장이 됩니다. */
    public void transferMaster(Player actor, String targetName, Consumer<Result> callback) {
        Guild guild = of(actor);
        if (guild == null) { callback.accept(Result.NOT_IN_GUILD); return; }
        if (guild.rankOf(actor.getUniqueId()) != GuildRank.MASTER) {
            callback.accept(Result.NO_PERMISSION);
            return;
        }

        GuildMember target = findMember(guild, targetName);
        if (target == null) { callback.accept(Result.TARGET_NOT_MEMBER); return; }
        if (target.getUuid().equals(actor.getUniqueId())) {
            callback.accept(Result.CANNOT_TARGET_SELF);
            return;
        }

        UUID actorUuid = actor.getUniqueId();
        UUID targetUuid = target.getUuid();
        String resolvedName = target.getName();
        int id = guild.getId();

        runAsync(() -> {
            try {
                repository.setRank(targetUuid, GuildRank.MASTER);
                repository.setRank(actorUuid, GuildRank.VICE);

                // ruc_guild.master 도 같이 옮깁니다. 이 컬럼이 어긋나면 길드장이
                // 둘로 보이거나 아무도 해산할 수 없게 됩니다.
                Guild stored = repository.loadAll().get(id);
                if (stored != null) {
                    stored.setMaster(targetUuid);
                    repository.updateGuild(stored);
                }

                refreshAsync(() -> {
                    callback.accept(Result.OK);
                    Guild after = byId(id);
                    if (after != null) announce(after, "guild.master-transferred", null,
                            "player", resolvedName, "guild", after.getName());
                });
            } catch (SQLException e) {
                plugin.getLogger().log(Level.WARNING, "길드장 위임 실패", e);
                runSync(() -> callback.accept(Result.ERROR));
            }
        });
    }

    // ── 금고 ──────────────────────────────────────────────────────────

    /**
     * 금고 입금. 누구나 가능하고 기여도로 쌓입니다.
     *
     * 증감을 DB에서 계산하므로(addBank), 두 서버에서 동시에 입금해도 한쪽이
     * 사라지지 않습니다. 캐시 값으로 덮어쓰면 그 순간 화폐가 소멸합니다.
     */
    public void depositBank(Player player, long amount, Consumer<Result> callback) {
        Guild guild = of(player);
        if (guild == null) { callback.accept(Result.NOT_IN_GUILD); return; }
        if (amount <= 0) { callback.accept(Result.INVALID_AMOUNT); return; }

        UUID uuid = player.getUniqueId();
        if (!plugin.getEconomy().withdraw(uuid, amount)) {
            callback.accept(Result.NOT_ENOUGH_RUC);
            return;
        }

        int id = guild.getId();
        runAsync(() -> {
            try {
                repository.addBank(id, amount);
                repository.addContribution(uuid, amount);
                refreshAsync(() -> callback.accept(Result.OK));
            } catch (SQLException e) {
                plugin.getLogger().log(Level.WARNING, "길드 금고 입금 실패", e);
                runSync(() -> {
                    plugin.getEconomy().deposit(uuid, amount);
                    callback.accept(Result.ERROR);
                });
            }
        });
    }

    /** 금고 출금. 부길드장 이상만. */
    public void withdrawBank(Player player, long amount, Consumer<Result> callback) {
        Guild guild = of(player);
        if (guild == null) { callback.accept(Result.NOT_IN_GUILD); return; }
        if (amount <= 0) { callback.accept(Result.INVALID_AMOUNT); return; }

        GuildRank rank = guild.rankOf(player.getUniqueId());
        if (rank == null || !rank.atLeast(GuildRank.VICE)) {
            callback.accept(Result.NO_PERMISSION);
            return;
        }

        UUID uuid = player.getUniqueId();
        int id = guild.getId();

        runAsync(() -> {
            try {
                // 잔고 검사를 DB의 WHERE 에 맡깁니다. 캐시로 검사하면 다른 서버의
                // 출금과 겹칠 때 금고가 음수가 됩니다.
                boolean taken = repository.addBank(id, -amount);
                refreshAsync(() -> {
                    if (!taken) { callback.accept(Result.NOT_ENOUGH_BANK); return; }
                    plugin.getEconomy().deposit(uuid, amount);
                    callback.accept(Result.OK);
                });
            } catch (SQLException e) {
                plugin.getLogger().log(Level.WARNING, "길드 금고 출금 실패", e);
                runSync(() -> callback.accept(Result.ERROR));
            }
        });
    }

    /**
     * 금고에 직접 넣습니다. 플레이어를 거치지 않는 환불·보상에 씁니다.
     *
     * {@link #depositBank} 와 달리 개인 지갑에서 빼지 않고 기여도도 올리지
     * 않습니다 — 되돌리는 것이므로 기여로 잡으면 환불을 반복해 기여도를
     * 올릴 수 있습니다.
     */
    public void depositBankDirect(int guildId, long amount) {
        if (amount <= 0) return;
        runAsync(() -> {
            try {
                repository.addBank(guildId, amount);
            } catch (SQLException e) {
                plugin.getLogger().log(Level.SEVERE,
                        "길드 금고 환불 실패 (길드 " + guildId + ", " + amount + ")", e);
            }
        });
    }

    /**
     * 금고에서 비용을 차감합니다. 국가 인장 구매(D2)처럼 길드 재원으로 사는 것에 씁니다.
     *
     * 성공 여부를 비동기로만 알 수 있으므로, 결과를 받은 뒤에 물건을 주세요.
     */
    public void spendBank(int guildId, long amount, Consumer<Boolean> callback) {
        if (amount <= 0) { callback.accept(false); return; }
        runAsync(() -> {
            boolean ok;
            try {
                ok = repository.addBank(guildId, -amount);
            } catch (SQLException e) {
                plugin.getLogger().log(Level.WARNING, "길드 금고 차감 실패", e);
                ok = false;
            }
            boolean result = ok;
            refreshAsync(() -> callback.accept(result));
        });
    }

    // ── 시즌 점수 ──────────────────────────────────────────────────────

    /** 시즌 점수 가산. 코어 방어 성공·전쟁 킬 등에서 부릅니다 (§3.5 랭킹 보상). */
    public void addPoints(int guildId, long delta) {
        if (delta == 0) return;
        runAsync(() -> {
            try {
                repository.addPoints(guildId, delta);
            } catch (SQLException e) {
                plugin.getLogger().log(Level.WARNING, "길드 점수 가산 실패", e);
            }
        });
    }

    /** 국가 여부를 운영자가 직접 지정합니다. 점검용 — 인원 변동 시 다시 계산됩니다. */
    public void forceNation(int guildId, boolean nation, Consumer<Boolean> callback) {
        runAsync(() -> {
            boolean ok = true;
            try {
                repository.setNation(guildId, nation);
            } catch (SQLException e) {
                plugin.getLogger().log(Level.WARNING, "국가 플래그 변경 실패", e);
                ok = false;
            }
            boolean result = ok;
            refreshAsync(() -> callback.accept(result));
        });
    }

    /** 캐시를 즉시 다시 읽습니다. 다른 서버의 변경을 기다리지 않고 확인할 때. */
    public void forceRefresh(Runnable after) {
        refreshAsync(after);
    }

    /**
     * 시즌 정산 (§3.5 — 랭킹에 따른 차등 보상).
     *
     * 순위별 보상을 길드 <b>금고</b>에 넣습니다. 길드원 개인에게 직접 주지 않는
     * 이유: 시즌 끝에 접속하지 않은 사람의 잔고를 DB 로 직접 써야 하는데, 그건
     * 접속 중 캐시와 충돌합니다. 금고에 넣으면 길드장이 분배할 수 있고, 기여도
     * 기록도 그대로 남습니다.
     *
     * 되돌릴 수 없는 일괄 작업이라 호출부에서 확인을 받도록 되어 있습니다.
     */
    public void settleSeason(Consumer<List<SeasonPayout>> callback) {
        List<Guild> ranked = ranking();
        if (ranked.isEmpty()) { callback.accept(List.of()); return; }

        List<Long> tiers = plugin.getConfig().getLongList("guild.season.rewards");
        long participation = plugin.getConfig().getLong("guild.season.participation", 10000);
        boolean resetPoints = plugin.getConfig().getBoolean("guild.season.reset-points", true);
        long now = System.currentTimeMillis();

        // 순위와 보상액을 먼저 확정합니다. 비동기 안에서 ranking() 을 다시 부르면
        // 그사이 점수가 변해 순위가 흔들릴 수 있습니다.
        List<SeasonPayout> payouts = new ArrayList<>();
        for (int i = 0; i < ranked.size(); i++) {
            Guild guild = ranked.get(i);
            long reward = i < tiers.size() ? tiers.get(i) : participation;
            payouts.add(new SeasonPayout(guild.getId(), guild.getName(), i + 1,
                    guild.getPoints(), reward));
        }

        runAsync(() -> {
            // 되돌릴 수 없고 화폐가 움직이는 작업이라 로그에 남깁니다. RCON 은
            // 비동기 결과를 응답으로 실어 보내지 못하므로, 콘솔에서 실행한
            // 운영자가 무엇이 일어났는지 확인할 수 있는 곳이 로그뿐입니다.
            plugin.getLogger().info("시즌 정산 시작 — 대상 " + payouts.size() + "개 길드"
                    + (resetPoints ? " (점수 초기화)" : " (점수 유지)"));

            for (SeasonPayout payout : payouts) {
                try {
                    repository.settleSeason(payout.guildId(), payout.reward(), resetPoints, now);
                    plugin.getLogger().info(String.format("  %d위 %s (%d점) → 금고 +%d",
                            payout.rank(), payout.guildName(), payout.points(), payout.reward()));
                } catch (SQLException e) {
                    plugin.getLogger().log(Level.WARNING,
                            "시즌 정산 실패: " + payout.guildName(), e);
                }
            }
            plugin.getLogger().info("시즌 정산 완료");
            refreshAsync(() -> callback.accept(payouts));
        });
    }

    public record SeasonPayout(int guildId, String guildName, int rank, long points, long reward) {}

    // ── 주간 보상 (§3.5) ──────────────────────────────────────────────

    /**
     * 이번 주 보상을 아직 받지 않았으면 지급합니다. 접속 시와 주기 점검에서 부릅니다.
     *
     * 지급 자격 판정을 DB 갱신에 맡기는 이유(claimWeekly): 같은 사람이 두 서버를
     * 오갈 때 양쪽에서 동시에 정산 시점에 걸릴 수 있습니다. UPDATE 가 성공한
     * 쪽만 지급하면 중복이 원천적으로 막힙니다.
     */
    public void tickWeekly(Player player) {
        Guild guild = of(player);
        if (guild == null) return;

        GuildMember member = guild.member(player.getUniqueId());
        if (member == null) return;

        long weekStart = weekStartMillis();
        if (member.getLastWeeklyAt() >= weekStart) return;

        long reward = weeklyReward(guild);
        if (reward <= 0) return;

        UUID uuid = player.getUniqueId();
        long now = System.currentTimeMillis();

        runAsync(() -> {
            boolean claimed;
            try {
                claimed = repository.claimWeekly(uuid, weekStart, now);
            } catch (SQLException e) {
                plugin.getLogger().log(Level.WARNING, "길드 주간 보상 지급 실패", e);
                return;
            }
            if (!claimed) return;

            runSync(() -> {
                // 보상은 "번 돈" 이므로 reward() 로 줍니다 — 드래곤 알 배수가 걸립니다.
                //
                // 실패하는 경우가 있습니다: claimWeekly 로 "받았음" 을 찍은 뒤
                // 여기까지 오는 사이에 그 사람이 나가면 캐시가 사라져 reward()
                // 가 false 를 돌려줍니다. 그러면 그 주 보상이 조용히 없어집니다.
                // 그 몫은 우편으로 보냅니다 (Phase 5.5) — 배수는 여기서 직접
                // 곱해서 접속 중에 받은 것과 금액이 같게 맞춥니다.
                if (!plugin.getEconomy().reward(uuid, reward)) {
                    plugin.getMailbox().sendRuc(uuid,
                            plugin.getBonuses().applyRuc(uuid, reward),
                            guild.getName(), "guild", null);
                    return;
                }
                Player online = Bukkit.getPlayer(uuid);
                if (online != null) {
                    online.sendMessage(messages.prefixed(
                            plugin.getPlayerData().languageOf(online), "guild.weekly-paid",
                            "amount", EconomyService.format(reward),
                            "symbol", plugin.getEconomy().symbol(),
                            "guild", guild.getName()));
                }
            });
            // 캐시의 last_weekly_at 을 갱신해 주기 점검이 다시 걸리지 않게 합니다.
            reload();
        });
    }

    /** 주간 보상액. 길드원 수에 비례하되 상한이 있고, 국가는 가산됩니다. */
    public long weeklyReward(Guild guild) {
        long base = plugin.getConfig().getLong("guild.weekly.base", 2000);
        long perMember = plugin.getConfig().getLong("guild.weekly.per-member", 300);
        int countable = Math.min(guild.size(),
                plugin.getConfig().getInt("guild.weekly.count-cap", 20));
        long total = base + perMember * countable;

        if (guild.isNation()) {
            double bonus = plugin.getConfig().getDouble("guild.weekly.nation-multiplier", 1.5);
            total = Math.round(total * bonus);
        }
        long max = plugin.getConfig().getLong("guild.weekly.max", 20000);
        return Math.min(total, max);
    }

    /** 설정한 시간대 기준 이번 주 월요일 00:00. */
    public long weekStartMillis() {
        return ZonedDateTime.now(zone())
                .truncatedTo(ChronoUnit.DAYS)
                // previousOrSame 이라 오늘이 월요일이면 오늘, 아니면 지난 월요일입니다.
                // DayOfWeek 를 그대로 with() 에 넘기면 "같은 주" 해석이 끼어들어
                // 일요일에 결과가 미래로 갈 수 있어 이 형태를 씁니다.
                .with(TemporalAdjusters.previousOrSame(DayOfWeek.MONDAY))
                .toInstant().toEpochMilli();
    }

    public ZoneId zone() {
        String id = plugin.getConfig().getString("timezone", "Asia/Seoul");
        try {
            return ZoneId.of(id);
        } catch (Exception e) {
            plugin.getLogger().warning("알 수 없는 시간대 '" + id + "' — 시스템 기본값을 씁니다.");
            return ZoneId.systemDefault();
        }
    }

    // ── 접속 시 ────────────────────────────────────────────────────────

    /**
     * 접속 처리. 길드원 이름 사본을 갱신하고 주간 보상을 정산합니다.
     * 닉네임이 바뀐 사람이 길드원 목록에서 옛 이름으로 남지 않게 하는 것이 목적입니다.
     */
    public void onJoin(Player player) {
        Guild guild = of(player);
        if (guild == null) return;

        GuildMember member = guild.member(player.getUniqueId());
        if (member != null && !player.getName().equals(member.getName())) {
            UUID uuid = player.getUniqueId();
            String name = player.getName();
            runAsync(() -> {
                try {
                    repository.touchName(uuid, name);
                } catch (SQLException e) {
                    plugin.getLogger().log(Level.WARNING, "길드원 이름 갱신 실패", e);
                }
            });
        }
        tickWeekly(player);
    }

    /** 대기 중인 초대 목록. 비동기 콜백입니다. */
    public void pendingInvites(Player player, Consumer<List<PendingInvite>> callback) {
        UUID uuid = player.getUniqueId();
        runAsync(() -> {
            List<PendingInvite> out = new ArrayList<>();
            try {
                for (GuildRepository.Invite invite : repository.findInvites(uuid)) {
                    Guild guild = byId(invite.guildId());
                    if (guild == null) continue;
                    out.add(new PendingInvite(guild.getName(), invite.inviter(),
                            invite.expiresAt()));
                }
            } catch (SQLException e) {
                plugin.getLogger().log(Level.WARNING, "길드 초대 조회 실패", e);
            }
            runSync(() -> callback.accept(out));
        });
    }

    public record PendingInvite(String guildName, String inviter, long expiresAt) {}

    // ── 내부 ──────────────────────────────────────────────────────────

    /**
     * §2.6 — 길드원 수로 국가 여부를 판정해 DB에 반영합니다.
     *
     * "지금 접속한 인원"이 아니라 <b>소속 인원</b>으로 봅니다. 접속자 수로 하면
     * 새벽에 국가가 사라져서 영토와 입장 권한이 시간대에 따라 깜빡입니다.
     *
     * @return 이 호출로 국가가 되었으면 true (승격 안내용)
     */
    private boolean applyNationFlag(int guildId, int size) throws SQLException {
        boolean shouldBeNation = size >= nationThreshold();
        Guild cached = guilds.get(guildId);
        boolean was = cached != null && cached.isNation();

        if (shouldBeNation != was) {
            repository.setNation(guildId, shouldBeNation);
        }
        return shouldBeNation && !was;
    }

    private GuildMember findMember(Guild guild, String name) {
        for (GuildMember member : guild.members()) {
            if (member.getName().equalsIgnoreCase(name)) return member;
        }
        return null;
    }

    /** 이 서버에 접속 중인 길드원에게 알립니다. {@code except} 는 건너뜁니다. */
    private void announce(Guild guild, String key, UUID except, String... placeholders) {
        for (GuildMember member : guild.members()) {
            if (except != null && member.getUuid().equals(except)) continue;
            Player online = Bukkit.getPlayer(member.getUuid());
            if (online == null) continue;
            online.sendMessage(messages.prefixed(
                    plugin.getPlayerData().languageOf(online), key, placeholders));
        }
    }

    /** 국가 승격은 네트워크 전체에 알립니다 — 다른 길드에게도 정보이기 때문입니다. */
    private void announceNation(Guild guild) {
        String lang = plugin.getConfig().getString("language.default", "ko");
        Bukkit.broadcast(messages.prefixed(lang, "guild.nation-promoted",
                "guild", guild.getName(), "count", String.valueOf(guild.size())));
    }

    /** UNIQUE / PK 위반인지. H2와 MySQL의 코드가 다릅니다. */
    private boolean isDuplicate(SQLException e) {
        // MySQL 1062, H2 23505 (MySQL 모드에서도 H2 코드가 나옵니다)
        return e.getErrorCode() == 1062 || e.getErrorCode() == 23505
                || (e.getSQLState() != null && e.getSQLState().startsWith("23"));
    }

    public boolean isValidName(String name) {
        if (name == null) return false;
        int len = name.codePointCount(0, name.length());
        return len >= 2 && len <= 12 && ALLOWED.matcher(name).matches();
    }

    public boolean isValidTag(String tag) {
        if (tag == null) return false;
        int len = tag.codePointCount(0, tag.length());
        return len >= 2 && len <= 4 && ALLOWED.matcher(tag).matches();
    }

    /** 표시용 스냅샷 사본. */
    public Map<Integer, Guild> all() {
        return new LinkedHashMap<>(guilds);
    }

    /** 명령 결과. messages 키는 {@code guild.result.<소문자-하이픈>} 입니다. */
    public enum Result {
        OK,
        ALREADY_IN_GUILD,
        NOT_IN_GUILD,
        NO_SUCH_GUILD,
        NO_PERMISSION,
        NAME_TAKEN,
        TAG_TAKEN,
        NAME_INVALID,
        TAG_INVALID,
        LEVEL_TOO_LOW,
        NOT_ENOUGH_RUC,
        NOT_ENOUGH_BANK,
        INVALID_AMOUNT,
        GUILD_FULL,
        TARGET_OFFLINE,
        TARGET_ALREADY_IN_GUILD,
        TARGET_NOT_MEMBER,
        NO_INVITE,
        CANNOT_TARGET_SELF,
        IS_MASTER,
        RANK_TOO_HIGH,
        USE_TRANSFER,
        NO_CHANGE,
        ERROR;

        public String key() {
            return "guild.result." + name().toLowerCase(Locale.ROOT).replace('_', '-');
        }
    }
}
