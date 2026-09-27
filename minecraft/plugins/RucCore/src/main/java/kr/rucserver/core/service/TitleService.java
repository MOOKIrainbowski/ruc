package kr.rucserver.core.service;

import kr.rucserver.core.RucCore;
import kr.rucserver.core.model.RucPlayer;
import kr.rucserver.core.storage.TitleRepository;
import net.kyori.adventure.text.Component;
import net.kyori.adventure.text.format.NamedTextColor;
import net.kyori.adventure.text.format.TextColor;
import net.kyori.adventure.text.minimessage.MiniMessage;
import org.bukkit.Bukkit;
import org.bukkit.configuration.ConfigurationSection;
import org.bukkit.entity.Player;
import org.bukkit.scheduler.BukkitTask;

import java.sql.SQLException;
import java.util.ArrayList;
import java.util.Collection;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.logging.Level;

/**
 * 칭호 (Phase 6).
 *
 * <h2>출처는 디스코드입니다</h2>
 * 요구사항은 "디스코드 서버에서 가진 <b>최상위 역할</b>을 마크 닉네임 앞에
 * 표시" 입니다. 그래서 칭호 목록의 주인은 디스코드이고, 마크는 그것을 받아
 * 보여 주는 쪽입니다. 받는 통로는 {@code /rucverify} 와 같은 RCON 입니다 —
 * 봇은 Node 라서 H2 를 직접 읽지 못하고, 운영에서 MySQL 로 바꿔도 이 경로는
 * 그대로 동작합니다.
 *
 * <h2>역할 → 칭호 판정을 어디서 하는가</h2>
 * <b>여기서 합니다.</b> 봇은 그 사람이 가진 역할 ID 를 그대로 넘기고, 어떤
 * 역할이 어떤 칭호이고 무엇이 더 높은지는 이 서버의 설정이 정합니다. 판정을
 * 봇에 두면 우선순위가 두 군데(봇의 매핑 + 서버의 표시)에 적히고, 한쪽만
 * 고쳐졌을 때 "디스코드에서는 관리자인데 게임에서는 일반" 이 됩니다.
 *
 * <h2>캐시</h2>
 * 채팅 한 줄마다 DB 를 보면 안 됩니다. 접속 시 한 번 읽어 캐시하고, 다른
 * 서버에서 일어난 변경은 주기 갱신으로 따라잡습니다 (길드와 같은 방식 §6.7).
 * 봇의 RCON 은 한 서버(보통 home)로만 들어오므로 이 갱신이 없으면 나머지 세
 * 서버는 칭호가 바뀐 것을 영원히 모릅니다.
 */
public class TitleService {

    private static final MiniMessage MINI = MiniMessage.miniMessage();

    private final RucCore plugin;
    private final TitleRepository repository;

    /** 설정에 정의된 칭호. key → 정의. 우선순위 내림차순으로 정렬해 둡니다. */
    private final Map<String, Definition> definitions = new LinkedHashMap<>();

    /** 디스코드 역할 ID → 칭호 key. 한 역할이 여러 칭호를 줄 수는 없습니다. */
    private final Map<String, String> byRole = new java.util.HashMap<>();

    /** 접속 중인 사람의 표시 칭호. 값이 null 인 키는 "칭호 없음" 입니다. */
    private final Map<UUID, String> displayed = new ConcurrentHashMap<>();

    private BukkitTask refreshTask;

    public TitleService(RucCore plugin, TitleRepository repository) {
        this.plugin = plugin;
        this.repository = repository;
        loadDefinitions();
    }

    // ── 설정 ───────────────────────────────────────────────────────────

    private void loadDefinitions() {
        definitions.clear();
        byRole.clear();

        ConfigurationSection section =
                plugin.getConfig().getConfigurationSection("titles.definitions");
        if (section == null) {
            plugin.getLogger().warning("titles.definitions 가 설정에 없습니다. 칭호가 비활성화됩니다.");
            return;
        }

        List<Definition> loaded = new ArrayList<>();
        for (String key : section.getKeys(false)) {
            ConfigurationSection one = section.getConfigurationSection(key);
            if (one == null) continue;

            String display = one.getString("display", "");
            if (display.isEmpty()) {
                plugin.getLogger().warning("칭호 '" + key + "' 에 display 가 없습니다. 건너뜁니다.");
                continue;
            }
            int priority = one.getInt("priority", 0);
            String role = one.getString("discord-role", "");

            loaded.add(new Definition(key, display, priority, role));
        }

        // 우선순위 내림차순. 표시 칭호를 고를 때 앞에서부터 보면 됩니다.
        loaded.sort((a, b) -> Integer.compare(b.priority(), a.priority()));
        for (Definition definition : loaded) {
            definitions.put(definition.key(), definition);
            if (!definition.discordRole().isEmpty()) {
                String previous = byRole.put(definition.discordRole(), definition.key());
                if (previous != null) {
                    // 같은 역할에 두 칭호를 걸면 어느 쪽이 나올지 설정 순서에
                    // 따라 달라집니다. 조용히 지나가면 원인을 찾기 어렵습니다.
                    plugin.getLogger().warning("디스코드 역할 " + definition.discordRole()
                            + " 이 칭호 '" + previous + "' 와 '" + definition.key()
                            + "' 양쪽에 걸려 있습니다. 뒤쪽이 적용됩니다.");
                }
            }
        }

        plugin.getLogger().info("칭호 정의 " + definitions.size() + "개 로드 (역할 연결 "
                + byRole.size() + "개)");
    }

    public boolean isEnabled() {
        return plugin.getConfig().getBoolean("titles.enabled", true)
                && !definitions.isEmpty();
    }

    public Definition definition(String key) {
        return definitions.get(key);
    }

    public Collection<Definition> definitions() {
        return definitions.values();
    }

    // ── 수명 ───────────────────────────────────────────────────────────

    public void start() {
        if (!isEnabled()) return;

        long seconds = plugin.getConfig().getLong("titles.refresh-seconds", 30);
        long ticks = Math.max(5, seconds) * 20L;
        refreshTask = Bukkit.getScheduler().runTaskTimerAsynchronously(plugin,
                this::refreshOnline, ticks, ticks);
    }

    public void stop() {
        if (refreshTask != null) refreshTask.cancel();
        displayed.clear();
    }

    /**
     * 접속 중인 사람의 칭호를 DB 에서 다시 읽습니다.
     *
     * 봇의 RCON 은 한 서버로만 들어오므로, 나머지 서버는 이 갱신으로만 변경을
     * 알게 됩니다. 접속자 수만큼 조회가 나가지만 30초에 한 번이고 인덱스가
     * 걸린 단건 조회라 부담이 되지 않습니다.
     */
    private void refreshOnline() {
        for (Player player : Bukkit.getOnlinePlayers()) {
            UUID uuid = player.getUniqueId();
            String before = displayed.get(uuid);
            String after = resolveBlocking(uuid);

            if (java.util.Objects.equals(before, after)) continue;

            displayed.put(uuid, after == null ? "" : after);
            Bukkit.getScheduler().runTask(plugin, () -> {
                if (player.isOnline()) applyTabList(player);
            });
        }
    }

    // ── 조회 ───────────────────────────────────────────────────────────

    /** 접속 시 호출. 비동기로 읽어 캐시에 넣습니다. */
    public void loadAsync(Player player) {
        if (!isEnabled()) return;

        UUID uuid = player.getUniqueId();
        Bukkit.getScheduler().runTaskAsynchronously(plugin, () -> {
            String key = resolveBlocking(uuid);
            displayed.put(uuid, key == null ? "" : key);
            Bukkit.getScheduler().runTask(plugin, () -> {
                if (player.isOnline()) applyTabList(player);
            });
        });
    }

    public void unload(UUID uuid) {
        displayed.remove(uuid);
    }

    /**
     * 표시할 칭호 key. 없으면 null.
     *
     * <b>블로킹입니다.</b> 비동기에서만 부르세요.
     */
    private String resolveBlocking(UUID uuid) {
        List<TitleRepository.Row> rows;
        try {
            rows = repository.list(uuid);
        } catch (SQLException e) {
            plugin.getLogger().log(Level.WARNING, "칭호 조회 실패: " + uuid, e);
            return null;
        }
        return resolve(rows);
    }

    /** 고정된 것이 있으면 그것, 없으면 우선순위가 가장 높은 것. */
    private String resolve(List<TitleRepository.Row> rows) {
        String best = null;
        int bestPriority = Integer.MIN_VALUE;

        for (TitleRepository.Row row : rows) {
            Definition definition = definitions.get(row.key());
            // 설정에서 지워진 칭호를 들고 있는 사람이 있을 수 있습니다.
            // 그 행은 표시 대상이 아니지만 지우지도 않습니다 — 설정을 되돌리면
            // 다시 살아나야 합니다.
            if (definition == null) continue;

            if (row.selected()) return row.key();

            if (definition.priority() > bestPriority) {
                bestPriority = definition.priority();
                best = row.key();
            }
        }
        return best;
    }

    /** 캐시된 표시 칭호 key. 없으면 null. */
    public String displayedKey(UUID uuid) {
        String key = displayed.get(uuid);
        return key == null || key.isEmpty() ? null : key;
    }

    public List<TitleRepository.Row> ownedBlocking(UUID uuid) throws SQLException {
        return repository.list(uuid);
    }

    // ── 표시 ───────────────────────────────────────────────────────────

    /**
     * 칭호 부분만 만든 Component. 칭호가 없으면 빈 Component.
     *
     * 설정 문자열은 MiniMessage 로 해석합니다 — 관리자·유료 칭호를
     * {@code <gradient>} 로 꾸미라는 요구사항이 레거시 색코드(&amp;a)로는
     * 불가능합니다.
     */
    public Component titleComponent(UUID uuid) {
        Component title = titleOrNull(uuid);
        return title == null ? Component.empty() : title;
    }

    /**
     * 칭호 Component, 없으면 <b>null</b>.
     *
     * "칭호가 없다" 를 {@code Component.empty()} 로 표현하면 호출부가 그것을
     * 알아보려고 참조 비교를 하게 됩니다. Adventure 가 빈 Component 를 캐시하는
     * 것에 의존하는 코드가 되므로 null 로 구분합니다.
     */
    private Component titleOrNull(UUID uuid) {
        String key = displayedKey(uuid);
        if (key == null) return null;

        Definition definition = definitions.get(key);
        if (definition == null) return null;

        return MINI.deserialize(definition.display());
    }

    /**
     * 채팅 한 줄의 앞부분 — {@code %head% %title% %name%:} 까지.
     *
     * <h2>플레이어가 쓴 내용은 절대 MiniMessage 로 해석하지 않습니다</h2>
     * 여기서 만드는 것은 <b>접두부만</b>이고, 본문은 이벤트가 준 Component 를
     * 그대로 이어 붙입니다. 본문까지 MiniMessage 를 돌리면 누군가
     * {@code <click:run_command:/...>} 를 채팅에 쳐서 다른 사람이 누르게 만들
     * 수 있습니다. 색 태그를 허용하는 것과는 차원이 다른 문제입니다.
     *
     * <h2>%head% 는 지금 비어 있습니다</h2>
     * 스킨 머리를 채팅에 넣으려면 리소스팩 폰트의 글리프가 필요하고, 글리프는
     * 리소스팩 안의 정적 이미지라 접속자마다 다른 스킨을 런타임에 만들 수
     * 없습니다. 리소스팩(9b)이 나오면 {@code chat.head-glyph} 에 그 글자를
     * 넣으면 됩니다. 그때까지 비워 두는 이유는, 글리프가 없는 코드포인트를
     * 내보내면 모든 채팅 줄에 두부 문자(□)가 붙기 때문입니다.
     */
    public Component chatPrefix(Player player) {
        String format = plugin.getConfig().getString("chat.format",
                "%head%%title%<white>%name%</white><dark_gray>:</dark_gray> ");
        String head = plugin.getConfig().getString("chat.head-glyph", "");

        Component title = titleOrNull(player.getUniqueId());
        String titleTag = title == null ? "" : "\u0000TITLE\u0000";

        // 이름은 마크 규칙상 [A-Za-z0-9_] 뿐이라 MiniMessage 태그가 될 수
        // 없습니다. 칭호는 이미 Component 라서 문자열에 못 넣으므로,
        // 자리표시자를 두고 해석 뒤에 끼워 넣습니다.
        String rendered = format
                .replace("%head%", head)
                .replace("%title%", titleTag)
                .replace("%name%", player.getName());

        if (titleTag.isEmpty()) {
            return MINI.deserialize(rendered);
        }

        int split = rendered.indexOf("\u0000TITLE\u0000");
        String before = rendered.substring(0, split);
        String after = rendered.substring(split + "\u0000TITLE\u0000".length());

        return Component.empty()
                .append(MINI.deserialize(before))
                .append(title)
                .append(MINI.deserialize(after));
    }

    /** 채팅 본문에 쓸 기본 색. 설정이 잘못되면 흰색입니다. */
    public TextColor messageColor() {
        String raw = plugin.getConfig().getString("chat.message-color", "white");
        NamedTextColor named = NamedTextColor.NAMES.value(raw.toLowerCase(java.util.Locale.ROOT));
        if (named != null) return named;

        TextColor hex = TextColor.fromCSSHexString(raw);
        return hex != null ? hex : NamedTextColor.WHITE;
    }

    /**
     * 탭 목록에 칭호를 붙입니다.
     *
     * 머리 위 이름표(nametag)는 건드리지 않습니다. 그쪽은 스코어보드 팀의
     * prefix 로만 되는데, {@code ScoreboardService} 가 사람마다 개인 스코어보드를
     * 붙이고 있어서 팀을 얹으면 네 서버 × 개인 보드마다 같은 팀을 만들고
     * 지워야 합니다. 이름표까지 붙이는 것은 9b 폴리싱으로 미룹니다.
     */
    public void applyTabList(Player player) {
        if (!isEnabled()) {
            player.playerListName(null);
            return;
        }
        Component title = titleOrNull(player.getUniqueId());
        if (title == null) {
            player.playerListName(null);       // 바닐라 기본 이름으로 되돌립니다
            return;
        }
        player.playerListName(title
                .append(Component.space())
                .append(Component.text(player.getName())));
    }

    // ── 디스코드 동기화 ────────────────────────────────────────────────

    /**
     * 봇이 넘긴 역할 ID 목록으로 칭호를 맞춥니다. <b>블로킹입니다.</b>
     *
     * 넘어온 역할 중 설정에 걸린 것만 칭호가 되고, 디스코드에서 온 칭호 중
     * 더 이상 해당하지 않는 것은 회수합니다. 유료·가이드 칭호는 건드리지
     * 않습니다 ({@link TitleRepository#revokeDiscordExcept}).
     *
     * @param roleIds 그 사람이 지금 가진 디스코드 역할 ID 전부
     * @return 동기화 결과
     */
    public SyncResult syncFromDiscord(String discordId, Collection<String> roleIds) {
        RucPlayer data;
        try {
            data = plugin.getPlayerData().getRepository().findByDiscordId(discordId);
        } catch (SQLException e) {
            plugin.getLogger().log(Level.SEVERE, "디스코드 ID 조회 실패: " + discordId, e);
            return new SyncResult(Status.ERROR, null, null);
        }
        if (data == null) {
            // 인증하지 않은 사람입니다. 오류가 아니라 정상적인 상태입니다 —
            // 디스코드에만 있고 게임에는 아직 안 들어온 사람이 대부분입니다.
            return new SyncResult(Status.NOT_LINKED, null, null);
        }

        UUID uuid = data.getUuid();
        Set<String> keys = new HashSet<>();
        for (String roleId : roleIds) {
            String key = byRole.get(roleId);
            if (key != null) keys.add(key);
        }

        try {
            for (String key : keys) {
                repository.grant(uuid, key, "discord");
            }
            repository.revokeDiscordExcept(uuid, keys);
        } catch (SQLException e) {
            plugin.getLogger().log(Level.SEVERE, "칭호 동기화 실패: " + data.getName(), e);
            return new SyncResult(Status.ERROR, data.getName(), null);
        }

        // 캐시와 탭 목록을 바로 맞춥니다. 이 서버에 없으면 그쪽 서버의
        // 주기 갱신이 30초 안에 따라잡습니다.
        String resolved = resolveBlocking(uuid);
        displayed.put(uuid, resolved == null ? "" : resolved);

        Bukkit.getScheduler().runTask(plugin, () -> {
            Player online = Bukkit.getPlayer(uuid);
            if (online != null) applyTabList(online);
        });

        return new SyncResult(Status.OK, data.getName(), resolved);
    }

    /**
     * 칭호에 연결된 디스코드 역할 ID 전부.
     *
     * 봇이 이것을 먼저 물어봅니다. 매핑이 서버 설정에 있으니 봇은 어떤 역할이
     * 의미 있는지 모르는데, 그러면 서버 멤버 전원을 RCON 으로 밀어야 합니다.
     * 이 목록이 있으면 관련 역할을 가진 사람만 골라 보낼 수 있습니다.
     */
    public Collection<String> mappedRoleIds() {
        return java.util.List.copyOf(byRole.keySet());
    }

    /** 칭호를 고정합니다. <b>블로킹입니다.</b> */
    public boolean selectBlocking(UUID uuid, String key) {
        try {
            if (key != null) {
                boolean owned = false;
                for (TitleRepository.Row row : repository.list(uuid)) {
                    if (row.key().equals(key)) { owned = true; break; }
                }
                if (!owned) return false;
            }
            repository.select(uuid, key);
        } catch (SQLException e) {
            plugin.getLogger().log(Level.SEVERE, "칭호 고정 실패: " + uuid, e);
            return false;
        }

        String resolved = resolveBlocking(uuid);
        displayed.put(uuid, resolved == null ? "" : resolved);
        Bukkit.getScheduler().runTask(plugin, () -> {
            Player online = Bukkit.getPlayer(uuid);
            if (online != null) applyTabList(online);
        });
        return true;
    }

    /**
     * 칭호를 회수합니다. <b>블로킹입니다.</b>
     *
     * {@code key} 가 null 이면 <b>전부</b> 회수합니다.
     *
     * 부여와 달리 설정에 정의된 키인지 확인하지 않습니다. 설정에서 칭호를
     * 지운 뒤에도 DB 에는 행이 남아 있고(§표시에서만 걸러집니다), 그 행을
     * 치울 수단이 있어야 합니다.
     *
     * @return 회수한 칭호 수. -1 은 실패.
     */
    public int revokeBlocking(UUID uuid, String key) {
        int removed;
        try {
            if (key == null) {
                removed = repository.revokeAll(uuid);
            } else {
                // 있었는지 알아야 "없는 칭호를 뗐다" 는 거짓 보고를 피할 수 있습니다.
                boolean owned = false;
                for (TitleRepository.Row row : repository.list(uuid)) {
                    if (row.key().equals(key)) { owned = true; break; }
                }
                if (!owned) return 0;
                repository.revoke(uuid, key);
                removed = 1;
            }
        } catch (SQLException e) {
            plugin.getLogger().log(Level.SEVERE, "칭호 회수 실패: " + uuid, e);
            return -1;
        }

        String resolved = resolveBlocking(uuid);
        displayed.put(uuid, resolved == null ? "" : resolved);
        Bukkit.getScheduler().runTask(plugin, () -> {
            Player online = Bukkit.getPlayer(uuid);
            if (online != null) applyTabList(online);
        });
        return removed;
    }

    /** 칭호를 직접 부여합니다 (가이드 완주 · 후원). <b>블로킹입니다.</b> */
    public boolean grantBlocking(UUID uuid, String key, String source) {
        if (!definitions.containsKey(key)) return false;
        try {
            repository.grant(uuid, key, source);
        } catch (SQLException e) {
            plugin.getLogger().log(Level.SEVERE, "칭호 부여 실패: " + uuid + " / " + key, e);
            return false;
        }
        String resolved = resolveBlocking(uuid);
        displayed.put(uuid, resolved == null ? "" : resolved);
        Bukkit.getScheduler().runTask(plugin, () -> {
            Player online = Bukkit.getPlayer(uuid);
            if (online != null) applyTabList(online);
        });
        return true;
    }

    // ── 값 ─────────────────────────────────────────────────────────────

    /** 칭호 하나의 정의. */
    public record Definition(String key, String display, int priority, String discordRole) { }

    public enum Status {
        OK,
        /** 그 디스코드 계정에 연동된 마크 계정이 없습니다 (미인증). */
        NOT_LINKED,
        ERROR
    }

    /** @param titleKey 동기화 후 표시될 칭호. 없으면 null. */
    public record SyncResult(Status status, String playerName, String titleKey) { }
}
