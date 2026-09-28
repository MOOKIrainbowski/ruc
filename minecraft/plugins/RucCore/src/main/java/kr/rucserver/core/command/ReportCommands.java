package kr.rucserver.core.command;

import kr.rucserver.core.RucCore;
import kr.rucserver.core.service.MessageService;
import kr.rucserver.core.service.ReportService;
import kr.rucserver.core.storage.ReportRepository;
import org.bukkit.Bukkit;
import org.bukkit.command.Command;
import org.bukkit.command.CommandExecutor;
import org.bukkit.command.CommandSender;
import org.bukkit.command.TabCompleter;
import org.bukkit.entity.Player;
import org.jetbrains.annotations.NotNull;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.Locale;

/**
 * 신고 명령 (Phase 6-5, §3.8).
 *
 * <ul>
 *   <li>{@code /신고 <닉네임> <사유...>} — 누구나</li>
 *   <li>{@code /신고처리 <번호> <확정|기각>} — 스태프. <b>여기서만</b> 평판이 내려갑니다</li>
 *   <li>{@code /신고목록} — 스태프</li>
 * </ul>
 */
public class ReportCommands implements CommandExecutor, TabCompleter {

    private final RucCore plugin;
    private final MessageService messages;

    public ReportCommands(RucCore plugin, MessageService messages) {
        this.plugin = plugin;
        this.messages = messages;
    }

    public void register() {
        for (String name : List.of("report", "reporthandle", "reportlist")) {
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
            case "reporthandle" -> {
                return handleJudge(sender, args);
            }
            case "reportlist" -> {
                return handleList(sender);
            }
            default -> {
                if (!(sender instanceof Player player)) {
                    sender.sendMessage("이 명령어는 게임 안에서만 사용할 수 있습니다.");
                    return true;
                }
                return handleSubmit(player, args);
            }
        }
    }

    // ── /신고 ─────────────────────────────────────────────────────────

    private boolean handleSubmit(Player player, String[] args) {
        String lang = plugin.getPlayerData().languageOf(player);

        if (args.length < 2) {
            player.sendMessage(messages.prefixed(lang, "report.usage"));
            return true;
        }

        String target = args[0];
        String reason = String.join(" ", Arrays.copyOfRange(args, 1, args.length));

        plugin.getReports().submit(player, target, reason, result -> {
            switch (result.kind()) {
                case OK -> player.sendMessage(messages.prefixed(lang, "report.submitted",
                        "id", result.detail(), "player", target));
                case SELF -> player.sendMessage(messages.prefixed(lang, "report.self"));
                case REASON_TOO_SHORT -> player.sendMessage(
                        messages.prefixed(lang, "report.reason-too-short"));
                case COOLDOWN -> player.sendMessage(messages.prefixed(lang, "report.cooldown",
                        "seconds", result.detail()));
                case TARGET_NOT_FOUND -> player.sendMessage(
                        messages.prefixed(lang, "general.player-not-found", "player", target));
                case DISABLED -> player.sendMessage(messages.prefixed(lang, "report.disabled"));
                default -> player.sendMessage(messages.prefixed(lang, "report.error"));
            }
        });
        return true;
    }

    // ── /신고처리 ─────────────────────────────────────────────────────

    private boolean handleJudge(CommandSender sender, String[] args) {
        if (!sender.hasPermission("ruccore.admin")) {
            sender.sendMessage(messages.prefixed(langOf(sender), "general.no-permission"));
            return true;
        }
        if (args.length < 2) {
            sender.sendMessage(messages.prefixed(langOf(sender), "report.handle-usage"));
            return true;
        }

        long id;
        try {
            id = Long.parseLong(args[0].replace("#", ""));
        } catch (NumberFormatException e) {
            sender.sendMessage(messages.prefixed(langOf(sender), "admin.not-a-number",
                    "value", args[0]));
            return true;
        }

        String verdict = args[1];
        boolean confirm;
        if (verdict.equalsIgnoreCase("확정") || verdict.equalsIgnoreCase("confirm")) {
            confirm = true;
        } else if (verdict.equalsIgnoreCase("기각") || verdict.equalsIgnoreCase("reject")) {
            confirm = false;
        } else {
            sender.sendMessage(messages.prefixed(langOf(sender), "report.handle-usage"));
            return true;
        }

        String lang = langOf(sender);
        plugin.getReports().handle(sender, id, confirm, result -> {
            switch (result.kind()) {
                case CONFIRMED -> sender.sendMessage(messages.prefixed(lang,
                        "report.confirmed", "id", String.valueOf(id),
                        "player", result.detail()));
                case REJECTED -> sender.sendMessage(messages.prefixed(lang,
                        "report.rejected", "id", String.valueOf(id),
                        "player", result.detail()));
                case NOT_FOUND -> sender.sendMessage(messages.prefixed(lang,
                        "report.not-found", "id", String.valueOf(id)));
                case ALREADY_HANDLED -> sender.sendMessage(messages.prefixed(lang,
                        "report.already-handled", "id", String.valueOf(id)));
                default -> sender.sendMessage(messages.prefixed(lang, "report.error"));
            }
        });
        return true;
    }

    // ── /신고목록 ─────────────────────────────────────────────────────

    private boolean handleList(CommandSender sender) {
        if (!sender.hasPermission("ruccore.admin")) {
            sender.sendMessage(messages.prefixed(langOf(sender), "general.no-permission"));
            return true;
        }

        String lang = langOf(sender);
        plugin.getReports().pending(20, list -> {
            if (list.isEmpty()) {
                sender.sendMessage(messages.prefixed(lang, "report.list-empty"));
                return;
            }
            sender.sendMessage(messages.get(lang, "report.list-header",
                    "count", String.valueOf(list.size())));

            for (ReportRepository.Report report : list) {
                // 사유가 길면 한 줄이 화면을 덮습니다. 목록에서는 줄이고,
                // 자세한 것은 디스코드 신고 채널에 그대로 있습니다.
                String reason = report.reason();
                if (reason.length() > 40) reason = reason.substring(0, 40) + "…";

                sender.sendMessage(messages.get(lang, "report.list-entry",
                        "id", String.valueOf(report.id()),
                        "reporter", report.reporterName(),
                        "target", report.targetName(),
                        "server", report.serverId(),
                        "reason", reason));
            }
        });
        return true;
    }

    private String langOf(CommandSender sender) {
        if (sender instanceof Player player) return plugin.getPlayerData().languageOf(player);
        return plugin.getConfig().getString("language.default", "ko");
    }

    // ── 탭 완성 ───────────────────────────────────────────────────────

    @Override
    public List<String> onTabComplete(@NotNull CommandSender sender, @NotNull Command command,
                                      @NotNull String alias, @NotNull String[] args) {
        if (command.getName().equalsIgnoreCase("report") && args.length == 1) {
            List<String> names = new ArrayList<>();
            for (Player p : Bukkit.getOnlinePlayers()) {
                if (!p.equals(sender)) names.add(p.getName());
            }
            return filter(names, args[0]);
        }
        if (command.getName().equalsIgnoreCase("reporthandle") && args.length == 2) {
            return filter(List.of("확정", "기각"), args[1]);
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
