package kr.rucserver.core.command;

import kr.rucserver.core.RucCore;
import kr.rucserver.core.service.MessageService;
import kr.rucserver.core.service.TitleService;
import kr.rucserver.core.storage.TitleRepository;
import net.kyori.adventure.text.Component;
import net.kyori.adventure.text.event.ClickEvent;
import org.bukkit.Bukkit;
import org.bukkit.command.Command;
import org.bukkit.command.CommandExecutor;
import org.bukkit.command.CommandSender;
import org.bukkit.command.TabCompleter;
import org.bukkit.entity.Player;
import org.jetbrains.annotations.NotNull;

import java.sql.SQLException;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.Locale;
import java.util.logging.Level;

/**
 * 칭호 명령 (Phase 6).
 *
 * <ul>
 *   <li>{@code /칭호} — 보유 칭호를 보고 표시할 것을 고릅니다.</li>
 *   <li>{@code /ructitle} — <b>RCON 전용.</b> 디스코드 봇이 역할 변경을
 *       알려 줄 때 씁니다. {@code /rucverify} 와 같은 통로입니다.</li>
 *   <li>{@code /titlegrant} — 스태프가 직접 부여합니다 (가이드·후원 수동 처리).</li>
 *   <li>{@code /titlerevoke} — 스태프가 회수합니다. {@code all} 이면 전부.</li>
 * </ul>
 */
public class TitleCommands implements CommandExecutor, TabCompleter {

    private final RucCore plugin;
    private final MessageService messages;

    public TitleCommands(RucCore plugin, MessageService messages) {
        this.plugin = plugin;
        this.messages = messages;
    }

    public void register() {
        for (String name : List.of("title", "ructitle", "titlegrant", "titlerevoke")) {
            var command = plugin.getCommand(name);
            if (command == null) {
                plugin.getLogger().warning("plugin.yml에 '" + name + "' 명령어가 없습니다.");
                continue;
            }
            command.setExecutor(this);
            command.setTabCompleter(this);
        }
    }

    @Override
    public boolean onCommand(@NotNull CommandSender sender, @NotNull Command command,
                             @NotNull String label, @NotNull String[] args) {

        switch (command.getName().toLowerCase(Locale.ROOT)) {
            case "ructitle" -> {
                return handleRconSync(sender, args);
            }
            case "titlegrant" -> {
                return handleGrant(sender, args);
            }
            case "titlerevoke" -> {
                return handleRevoke(sender, args);
            }
            default -> {
                if (!(sender instanceof Player player)) {
                    sender.sendMessage("이 명령어는 게임 안에서만 사용할 수 있습니다.");
                    return true;
                }
                return handleTitle(player, args);
            }
        }
    }

    // ── /칭호 ─────────────────────────────────────────────────────────

    private boolean handleTitle(Player player, String[] args) {
        String lang = plugin.getPlayerData().languageOf(player);

        if (!plugin.getTitles().isEnabled()) {
            player.sendMessage(messages.prefixed(lang, "title.disabled"));
            return true;
        }

        // 인자가 있으면 고정, 없으면 목록.
        String requested = args.length >= 1 ? args[0] : null;

        Bukkit.getScheduler().runTaskAsynchronously(plugin, () -> {
            List<TitleRepository.Row> owned;
            try {
                owned = plugin.getTitles().ownedBlocking(player.getUniqueId());
            } catch (SQLException e) {
                plugin.getLogger().log(Level.WARNING, "칭호 목록 조회 실패", e);
                Bukkit.getScheduler().runTask(plugin, () ->
                        player.sendMessage(messages.prefixed(lang, "title.error")));
                return;
            }

            if (requested != null) {
                applySelection(player, lang, owned, requested);
                return;
            }
            Bukkit.getScheduler().runTask(plugin, () -> showList(player, lang, owned));
        });
        return true;
    }

    private void applySelection(Player player, String lang,
                                List<TitleRepository.Row> owned, String requested) {
        // '자동' / 'auto' 는 고정을 푸는 뜻입니다.
        boolean auto = requested.equalsIgnoreCase("auto")
                || requested.equals("자동");

        String key = null;
        if (!auto) {
            // 대소문자를 맞춰 줍니다. DB 의 키가 정확해야 selected 가 붙습니다.
            for (TitleRepository.Row row : owned) {
                if (row.key().equalsIgnoreCase(requested)) {
                    key = row.key();
                    break;
                }
            }
            if (key == null) {
                Bukkit.getScheduler().runTask(plugin, () -> player.sendMessage(
                        messages.prefixed(lang, "title.not-owned", "title", requested)));
                return;
            }
        }

        boolean ok = plugin.getTitles().selectBlocking(player.getUniqueId(), key);
        String finalKey = key;
        Bukkit.getScheduler().runTask(plugin, () -> {
            if (!ok) {
                player.sendMessage(messages.prefixed(lang, "title.error"));
                return;
            }
            if (finalKey == null) {
                player.sendMessage(messages.prefixed(lang, "title.auto-on"));
            } else {
                player.sendMessage(messages.prefixed(lang, "title.selected")
                        .append(Component.space())
                        .append(plugin.getTitles().titleComponent(player.getUniqueId())));
            }
        });
    }

    private void showList(Player player, String lang, List<TitleRepository.Row> owned) {
        player.sendMessage(messages.get(lang, "title.list-header"));

        if (owned.isEmpty()) {
            player.sendMessage(messages.get(lang, "title.list-empty"));
            return;
        }

        String shown = plugin.getTitles().displayedKey(player.getUniqueId());

        for (TitleRepository.Row row : owned) {
            TitleService.Definition definition = plugin.getTitles().definition(row.key());
            // 설정에서 사라진 칭호는 목록에도 내지 않습니다. 고를 수 없는 것을
            // 보여 주면 "왜 안 되냐" 는 문의가 됩니다.
            if (definition == null) continue;

            boolean current = row.key().equals(shown);
            Component line = messages.get(lang,
                            current ? "title.list-current" : "title.list-entry",
                            "key", row.key(),
                            "source", sourceText(lang, row.source()))
                    .replaceText(b -> b.matchLiteral("%title%").replacement(
                            MessageService.mini(definition.display())));

            if (!current) {
                line = line.clickEvent(ClickEvent.runCommand("/칭호 " + row.key()));
            }
            player.sendMessage(line);
        }

        player.sendMessage(messages.get(lang, "title.list-auto")
                .clickEvent(ClickEvent.runCommand("/칭호 자동")));
    }

    private String sourceText(String lang, String source) {
        String key = "title.source." + source;
        String text = messages.raw(lang, key);
        return text.equals(key) ? source : text;
    }

    // ── /ructitle — 디스코드 봇 전용 ──────────────────────────────────

    /**
     * {@code /ructitle <discordId> [역할ID,역할ID,...]}
     *
     * 응답은 {@code RUCTITLE <결과> [칭호]} 한 줄입니다 — 봇이 파싱하기 쉽게.
     * 역할 목록이 비어 있으면 "그 사람은 해당 역할이 하나도 없다" 는 뜻이고,
     * 디스코드에서 온 칭호를 전부 회수합니다. 그래야 역할이 빠진 것이 반영됩니다.
     */
    private boolean handleRconSync(CommandSender sender, String[] args) {
        if (sender instanceof Player) {
            sender.sendMessage("이 명령어는 콘솔에서만 사용할 수 있습니다.");
            return true;
        }
        if (args.length < 1) {
            sender.sendMessage("RUCTITLE ERROR usage: /ructitle <discordId> [roleId,roleId,...]");
            return true;
        }
        if (!plugin.getTitles().isEnabled()) {
            sender.sendMessage("RUCTITLE DISABLED");
            return true;
        }

        // 봇이 "어떤 역할이 칭호와 연결됐는지" 를 먼저 물어봅니다.
        // 매핑이 서버 설정에 있어서, 이게 없으면 봇은 멤버 전원을 밀어야 합니다.
        if (args[0].equalsIgnoreCase("roles")) {
            sender.sendMessage("RUCTITLE ROLES "
                    + String.join(",", plugin.getTitles().mappedRoleIds()));
            return true;
        }

        String discordId = args[0];
        List<String> roles = args.length >= 2 && !args[1].isEmpty() && !args[1].equals("-")
                ? Arrays.stream(args[1].split(",")).map(String::trim)
                        .filter(s -> !s.isEmpty()).toList()
                : List.of();

        // RCON 은 동기 응답을 기대하므로 여기서 바로 처리합니다. 역할 변경은
        // 드물고 조회 두 번 + 쓰기 몇 번이라 짧습니다. 인증(/rucverify)도
        // 같은 판단을 하고 있습니다.
        TitleService.SyncResult result = plugin.getTitles().syncFromDiscord(discordId, roles);

        String suffix = switch (result.status()) {
            case OK -> " " + (result.playerName() == null ? "?" : result.playerName())
                    + " " + (result.titleKey() == null ? "-" : result.titleKey());
            case NOT_LINKED, ERROR -> "";
        };
        sender.sendMessage("RUCTITLE " + result.status().name() + suffix);
        return true;
    }

    // ── /titlegrant — 스태프 ─────────────────────────────────────────

    /** {@code /titlegrant <닉네임> <칭호키> [source]} */
    private boolean handleGrant(CommandSender sender, String[] args) {
        if (!sender.hasPermission("ruccore.admin")) {
            sender.sendMessage(messages.prefixed(langOf(sender), "general.no-permission"));
            return true;
        }
        if (args.length < 2) {
            sender.sendMessage(messages.prefixed(langOf(sender), "title.grant-usage"));
            return true;
        }

        String name = args[0];
        String key = args[1];
        // source 를 받는 이유: 후원(purchase)과 가이드(guide)는 디스코드 동기화가
        // 회수하지 못하게 해야 합니다. 기본값을 staff 로 두면 안전한 쪽입니다.
        String source = args.length >= 3 ? args[2] : "staff";

        if (plugin.getTitles().definition(key) == null) {
            sender.sendMessage(messages.prefixed(langOf(sender), "title.unknown-key",
                    "title", key));
            return true;
        }

        Bukkit.getScheduler().runTaskAsynchronously(plugin, () -> {
            var data = lookup(name);
            if (data == null) {
                Bukkit.getScheduler().runTask(plugin, () -> sender.sendMessage(
                        messages.prefixed(langOf(sender), "general.player-not-found",
                                "player", name)));
                return;
            }
            boolean ok = plugin.getTitles().grantBlocking(data.getUuid(), key, source);
            Bukkit.getScheduler().runTask(plugin, () -> sender.sendMessage(
                    messages.prefixed(langOf(sender),
                            ok ? "title.grant-done" : "title.error",
                            "player", data.getName(), "title", key)));
            if (ok) {
                plugin.getLogger().info("[스태프] " + sender.getName() + " -> "
                        + data.getName() + " 칭호 " + key + " (" + source + ")");
            }
        });
        return true;
    }

    /**
     * {@code /titlerevoke <닉네임> <칭호키|all>}
     *
     * {@code /titlegrant} 의 반대입니다. 잘못 준 칭호를 떼거나, 제재로 칭호를
     * 거둘 때 씁니다.
     *
     * <h2>source 를 가리지 않습니다</h2>
     * 디스코드에서 온 칭호도 뗄 수 있지만, <b>다음 동기화에 다시 붙습니다</b> —
     * 출처가 디스코드인 칭호의 진실은 디스코드 역할이기 때문입니다. 영구히
     * 떼려면 디스코드에서 역할을 빼야 합니다. 이 명령으로 떼는 것이 의미 있는
     * 것은 유료(purchase)·가이드(guide)·운영(staff) 칭호입니다.
     *
     * 화폐를 움직이는 명령처럼 로그를 남깁니다. 유료 칭호를 뗐다는 것은
     * 나중에 반드시 문의가 들어오는 종류의 일입니다.
     */
    private boolean handleRevoke(CommandSender sender, String[] args) {
        if (!sender.hasPermission("ruccore.admin")) {
            sender.sendMessage(messages.prefixed(langOf(sender), "general.no-permission"));
            return true;
        }
        if (args.length < 2) {
            sender.sendMessage(messages.prefixed(langOf(sender), "title.revoke-usage"));
            return true;
        }

        String name = args[0];
        boolean all = args[1].equalsIgnoreCase("all") || args[1].equals("전체");
        String key = all ? null : args[1];

        Bukkit.getScheduler().runTaskAsynchronously(plugin, () -> {
            var data = lookup(name);
            if (data == null) {
                Bukkit.getScheduler().runTask(plugin, () -> sender.sendMessage(
                        messages.prefixed(langOf(sender), "general.player-not-found",
                                "player", name)));
                return;
            }

            int removed = plugin.getTitles().revokeBlocking(data.getUuid(), key);

            Bukkit.getScheduler().runTask(plugin, () -> {
                if (removed < 0) {
                    sender.sendMessage(messages.prefixed(langOf(sender), "title.error"));
                    return;
                }
                if (removed == 0) {
                    sender.sendMessage(messages.prefixed(langOf(sender), "title.revoke-none",
                            "player", data.getName(), "title", args[1]));
                    return;
                }
                sender.sendMessage(messages.prefixed(langOf(sender),
                        all ? "title.revoke-all-done" : "title.revoke-done",
                        "player", data.getName(), "title", args[1],
                        "count", String.valueOf(removed)));
            });

            if (removed > 0) {
                plugin.getLogger().info("[스태프] " + sender.getName() + " -> "
                        + data.getName() + " 칭호 회수 "
                        + (all ? "전체 " + removed + "개" : key));
            }
        });
        return true;
    }

    private kr.rucserver.core.model.RucPlayer lookup(String name) {
        try {
            return plugin.getPlayerData().getRepository().findByName(name);
        } catch (SQLException e) {
            plugin.getLogger().log(Level.SEVERE, "닉네임 조회 실패: " + name, e);
            return null;
        }
    }

    private String langOf(CommandSender sender) {
        if (sender instanceof Player player) return plugin.getPlayerData().languageOf(player);
        return plugin.getConfig().getString("language.default", "ko");
    }

    // ── 탭 완성 ───────────────────────────────────────────────────────

    @Override
    public List<String> onTabComplete(@NotNull CommandSender sender, @NotNull Command command,
                                      @NotNull String alias, @NotNull String[] args) {
        if (command.getName().equalsIgnoreCase("title") && args.length == 1) {
            List<String> options = new ArrayList<>();
            options.add("자동");
            // 보유 목록은 DB 조회라 탭 완성에서 못 씁니다 (메인 스레드).
            // 정의된 키 전체를 내고, 없는 것은 실행 시점에 걸러집니다.
            for (TitleService.Definition definition : plugin.getTitles().definitions()) {
                options.add(definition.key());
            }
            return filter(options, args[0]);
        }
        if (command.getName().equalsIgnoreCase("titlerevoke")) {
            if (args.length == 1) {
                List<String> names = new ArrayList<>();
                for (Player p : Bukkit.getOnlinePlayers()) names.add(p.getName());
                return filter(names, args[0]);
            }
            if (args.length == 2) {
                // 보유 목록은 DB 조회라 탭 완성에서 못 씁니다 (메인 스레드).
                // 정의된 키 전체 + all 을 냅니다.
                List<String> keys = new ArrayList<>();
                keys.add("all");
                for (TitleService.Definition definition : plugin.getTitles().definitions()) {
                    keys.add(definition.key());
                }
                return filter(keys, args[1]);
            }
            return List.of();
        }
        if (command.getName().equalsIgnoreCase("titlegrant")) {
            if (args.length == 1) {
                List<String> names = new ArrayList<>();
                for (Player p : Bukkit.getOnlinePlayers()) names.add(p.getName());
                return filter(names, args[0]);
            }
            if (args.length == 2) {
                List<String> keys = new ArrayList<>();
                for (TitleService.Definition definition : plugin.getTitles().definitions()) {
                    keys.add(definition.key());
                }
                return filter(keys, args[1]);
            }
            if (args.length == 3) {
                return filter(List.of("staff", "purchase", "guide"), args[2]);
            }
        }
        return List.of();
    }

    private List<String> filter(List<String> options, String prefix) {
        String lower = prefix.toLowerCase(Locale.ROOT);
        List<String> result = new ArrayList<>();
        for (String option : options) {
            if (option.toLowerCase(Locale.ROOT).startsWith(lower)) result.add(option);
        }
        return result;
    }
}
