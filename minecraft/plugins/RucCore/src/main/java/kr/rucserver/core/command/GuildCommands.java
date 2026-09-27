package kr.rucserver.core.command;

import kr.rucserver.core.RucCore;
import kr.rucserver.core.model.Guild;
import kr.rucserver.core.model.GuildMember;
import kr.rucserver.core.model.GuildRank;
import kr.rucserver.core.service.EconomyService;
import kr.rucserver.core.service.GuildService;
import kr.rucserver.core.service.MessageService;
import org.bukkit.Bukkit;
import org.bukkit.command.Command;
import org.bukkit.command.CommandExecutor;
import org.bukkit.command.CommandSender;
import org.bukkit.command.TabCompleter;
import org.bukkit.entity.Player;
import org.jetbrains.annotations.NotNull;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.Locale;
import java.util.Map;

/**
 * /길드 (§3.5).
 *
 * 하위 명령이 많아 한 클래스에 모았습니다. 한국어와 영어 토큰을 모두 받는데,
 * 기본 언어가 한국어(§6.3)이지만 명령을 영어로 외운 사람도 그대로 쓰게 하려는 것입니다.
 */
public class GuildCommands implements CommandExecutor, TabCompleter {

    /** 하위 명령 별칭 → 표준 이름. */
    private static final Map<String, String> ALIASES = Map.ofEntries(
            Map.entry("창설", "create"), Map.entry("생성", "create"), Map.entry("create", "create"),
            Map.entry("해산", "disband"), Map.entry("disband", "disband"),
            Map.entry("초대", "invite"), Map.entry("invite", "invite"),
            Map.entry("수락", "accept"), Map.entry("가입", "accept"), Map.entry("accept", "accept"),
            Map.entry("탈퇴", "leave"), Map.entry("leave", "leave"),
            Map.entry("추방", "kick"), Map.entry("kick", "kick"),
            Map.entry("임명", "promote"), Map.entry("승진", "promote"),
            Map.entry("promote", "promote"),
            Map.entry("강등", "demote"), Map.entry("demote", "demote"),
            Map.entry("위임", "transfer"), Map.entry("transfer", "transfer"),
            Map.entry("금고", "bank"), Map.entry("bank", "bank"),
            Map.entry("정보", "info"), Map.entry("info", "info"),
            Map.entry("목록", "list"), Map.entry("list", "list"),
            Map.entry("랭킹", "top"), Map.entry("순위", "top"), Map.entry("top", "top"),
            Map.entry("초대목록", "invites"), Map.entry("invites", "invites"),
            Map.entry("도움말", "help"), Map.entry("help", "help"));

    private final RucCore plugin;
    private final MessageService messages;

    public GuildCommands(RucCore plugin, MessageService messages) {
        this.plugin = plugin;
        this.messages = messages;
    }

    public void register() {
        var command = plugin.getCommand("guild");
        if (command == null) {
            plugin.getLogger().warning("plugin.yml에 'guild' 명령어가 없습니다.");
            return;
        }
        command.setExecutor(this);
        command.setTabCompleter(this);
    }

    @Override
    public boolean onCommand(@NotNull CommandSender sender, @NotNull Command command,
                             @NotNull String label, @NotNull String[] args) {
        if (!(sender instanceof Player player)) {
            sender.sendMessage("이 명령어는 게임 안에서만 사용할 수 있습니다.");
            return true;
        }

        GuildService guilds = plugin.getGuilds();
        String lang = plugin.getPlayerData().languageOf(player);

        if (args.length == 0) {
            // 소속이 있으면 내 길드 정보, 없으면 도움말이 자연스럽습니다.
            if (guilds.of(player) == null) sendHelp(player, lang);
            else sendInfo(player, lang, guilds.of(player));
            return true;
        }

        String sub = ALIASES.get(args[0].toLowerCase(Locale.ROOT));
        if (sub == null) { sendHelp(player, lang); return true; }

        switch (sub) {
            case "create" -> {
                if (args.length < 3) {
                    send(player, lang, "guild.usage.create",
                            "level", String.valueOf(guilds.minLevel()),
                            "cost", EconomyService.format(guilds.createCost()),
                            "symbol", plugin.getEconomy().symbol());
                    return true;
                }
                guilds.create(player, args[1], args[2], result -> {
                    if (result != GuildService.Result.OK) {
                        sendResult(player, lang, result);
                        return;
                    }
                    send(player, lang, "guild.created", "guild", args[1], "tag", args[2]);
                    Guild created = guilds.of(player);
                    if (created != null && !created.isNation()) {
                        send(player, lang, "guild.nation-hint",
                                "count", String.valueOf(guilds.nationThreshold() - created.size()),
                                "threshold", String.valueOf(guilds.nationThreshold()));
                    }
                });
            }

            case "disband" -> {
                // 오타 한 번으로 길드가 사라지지 않게 이름을 다시 입력받습니다.
                Guild guild = guilds.of(player);
                if (guild == null) {
                    sendResult(player, lang, GuildService.Result.NOT_IN_GUILD);
                    return true;
                }
                if (args.length < 2 || !args[1].equals(guild.getName())) {
                    send(player, lang, "guild.disband-confirm", "guild", guild.getName());
                    return true;
                }
                guilds.disband(player, result -> {
                    if (result != GuildService.Result.OK) sendResult(player, lang, result);
                    else send(player, lang, "guild.disbanded", "guild", guild.getName());
                });
            }

            case "invite" -> {
                if (args.length < 2) { send(player, lang, "guild.usage.invite"); return true; }
                guilds.invite(player, args[1], result -> {
                    if (result != GuildService.Result.OK) sendResult(player, lang, result);
                    else send(player, lang, "guild.invite-sent", "player", args[1]);
                });
            }

            case "accept" -> {
                if (args.length < 2) { send(player, lang, "guild.usage.accept"); return true; }
                guilds.accept(player, args[1], result -> {
                    if (result != GuildService.Result.OK) sendResult(player, lang, result);
                    else send(player, lang, "guild.joined", "guild", args[1]);
                });
            }

            case "leave" -> guilds.leave(player, result -> {
                if (result != GuildService.Result.OK) sendResult(player, lang, result);
                else send(player, lang, "guild.left");
            });

            case "kick" -> {
                if (args.length < 2) { send(player, lang, "guild.usage.kick"); return true; }
                guilds.kick(player, args[1], result -> {
                    if (result != GuildService.Result.OK) sendResult(player, lang, result);
                    else send(player, lang, "guild.kick-done", "player", args[1]);
                });
            }

            case "promote", "demote" -> {
                if (args.length < 2) {
                    send(player, lang, "guild.usage." + sub);
                    return true;
                }
                GuildRank rank = sub.equals("promote") ? GuildRank.VICE : GuildRank.MEMBER;
                guilds.setRank(player, args[1], rank, result -> {
                    if (result != GuildService.Result.OK) sendResult(player, lang, result);
                    else send(player, lang, "guild.rank-set", "player", args[1],
                            "rank", messages.raw(lang, rank.key()));
                });
            }

            case "transfer" -> {
                if (args.length < 2) { send(player, lang, "guild.usage.transfer"); return true; }
                guilds.transferMaster(player, args[1], result -> {
                    if (result != GuildService.Result.OK) sendResult(player, lang, result);
                    else send(player, lang, "guild.transfer-done", "player", args[1]);
                });
            }

            case "bank" -> handleBank(player, lang, args);

            case "info" -> {
                Guild guild = args.length >= 2 ? guilds.byName(args[1]) : guilds.of(player);
                if (guild == null) {
                    sendResult(player, lang, args.length >= 2
                            ? GuildService.Result.NO_SUCH_GUILD : GuildService.Result.NOT_IN_GUILD);
                    return true;
                }
                sendInfo(player, lang, guild);
            }

            case "list", "top" -> sendRanking(player, lang);

            case "invites" -> guilds.pendingInvites(player, invites -> {
                if (invites.isEmpty()) { send(player, lang, "guild.no-invites"); return; }
                player.sendMessage(messages.get(lang, "guild.invites-header"));
                for (GuildService.PendingInvite invite : invites) {
                    long minutes = Math.max(0,
                            (invite.expiresAt() - System.currentTimeMillis()) / 60000);
                    player.sendMessage(messages.get(lang, "guild.invites-row",
                            "guild", invite.guildName(),
                            "player", invite.inviter(),
                            "minutes", String.valueOf(minutes)));
                }
            });

            default -> sendHelp(player, lang);
        }
        return true;
    }

    // ── 금고 ──────────────────────────────────────────────────────────

    private void handleBank(Player player, String lang, String[] args) {
        GuildService guilds = plugin.getGuilds();
        Guild guild = guilds.of(player);
        if (guild == null) {
            sendResult(player, lang, GuildService.Result.NOT_IN_GUILD);
            return;
        }

        if (args.length < 2) {
            send(player, lang, "guild.bank-balance",
                    "amount", EconomyService.format(guild.getBank()),
                    "symbol", plugin.getEconomy().symbol());
            send(player, lang, "guild.usage.bank");
            return;
        }

        String action = args[1].toLowerCase(Locale.ROOT);
        boolean deposit = action.equals("입금") || action.equals("deposit");
        boolean withdraw = action.equals("출금") || action.equals("withdraw");
        if (!deposit && !withdraw) { send(player, lang, "guild.usage.bank"); return; }

        if (args.length < 3) { send(player, lang, "guild.usage.bank"); return; }
        long amount;
        try {
            amount = Long.parseLong(args[2].replace(",", ""));
        } catch (NumberFormatException e) {
            sendResult(player, lang, GuildService.Result.INVALID_AMOUNT);
            return;
        }

        if (deposit) {
            guilds.depositBank(player, amount, result -> {
                if (result != GuildService.Result.OK) sendResult(player, lang, result);
                else send(player, lang, "guild.bank-deposited",
                        "amount", EconomyService.format(amount),
                        "symbol", plugin.getEconomy().symbol());
            });
        } else {
            guilds.withdrawBank(player, amount, result -> {
                if (result != GuildService.Result.OK) sendResult(player, lang, result);
                else send(player, lang, "guild.bank-withdrawn",
                        "amount", EconomyService.format(amount),
                        "symbol", plugin.getEconomy().symbol());
            });
        }
    }

    // ── 표시 ──────────────────────────────────────────────────────────

    private void sendInfo(Player player, String lang, Guild guild) {
        GuildService guilds = plugin.getGuilds();

        player.sendMessage(messages.get(lang, "guild.info-header", "guild", guild.getName()));
        player.sendMessage(messages.get(lang, "guild.info-tag", "tag", guild.getTag()));
        player.sendMessage(messages.get(lang, "guild.info-status",
                "status", messages.raw(lang, guild.isNation()
                        ? "guild.status.nation" : "guild.status.guild"),
                "count", String.valueOf(guild.size()),
                "max", String.valueOf(guilds.maxMembers())));

        if (!guild.isNation()) {
            player.sendMessage(messages.get(lang, "guild.info-to-nation",
                    "count", String.valueOf(Math.max(0, guilds.nationThreshold() - guild.size())),
                    "threshold", String.valueOf(guilds.nationThreshold())));
        }

        player.sendMessage(messages.get(lang, "guild.info-bank",
                "amount", EconomyService.format(guild.getBank()),
                "symbol", plugin.getEconomy().symbol()));
        player.sendMessage(messages.get(lang, "guild.info-points",
                "points", EconomyService.format(guild.getPoints())));
        player.sendMessage(messages.get(lang, "guild.info-members-header"));

        for (GuildMember member : guild.membersSorted()) {
            boolean online = Bukkit.getPlayer(member.getUuid()) != null;
            player.sendMessage(messages.get(lang, "guild.info-member-row",
                    "dot", messages.raw(lang, online
                            ? "guild.dot.online" : "guild.dot.offline"),
                    "player", member.getName(),
                    "rank", messages.raw(lang, member.getRank().key()),
                    "contribution", EconomyService.format(member.getContribution())));
        }
    }

    private void sendRanking(Player player, String lang) {
        List<Guild> ranking = plugin.getGuilds().ranking();
        if (ranking.isEmpty()) { send(player, lang, "guild.none-yet"); return; }

        player.sendMessage(messages.get(lang, "guild.top-header"));
        int shown = Math.min(ranking.size(), 10);
        for (int i = 0; i < shown; i++) {
            Guild guild = ranking.get(i);
            player.sendMessage(messages.get(lang, "guild.top-row",
                    "rank", String.valueOf(i + 1),
                    "guild", guild.getName(),
                    "tag", guild.getTag(),
                    "count", String.valueOf(guild.size()),
                    "points", EconomyService.format(guild.getPoints()),
                    "status", messages.raw(lang, guild.isNation()
                            ? "guild.status.nation" : "guild.status.guild")));
        }
    }

    private void sendHelp(Player player, String lang) {
        for (String key : List.of("guild.help.header", "guild.help.create", "guild.help.invite",
                "guild.help.accept", "guild.help.leave", "guild.help.kick", "guild.help.rank",
                "guild.help.bank", "guild.help.info", "guild.help.top", "guild.help.disband")) {
            player.sendMessage(messages.get(lang, key,
                    "level", String.valueOf(plugin.getGuilds().minLevel()),
                    "cost", EconomyService.format(plugin.getGuilds().createCost()),
                    "symbol", plugin.getEconomy().symbol(),
                    "threshold", String.valueOf(plugin.getGuilds().nationThreshold())));
        }
    }

    private void send(Player player, String lang, String key, String... placeholders) {
        player.sendMessage(messages.prefixed(lang, key, placeholders));
    }

    private void sendResult(Player player, String lang, GuildService.Result result) {
        GuildService guilds = plugin.getGuilds();
        player.sendMessage(messages.prefixed(lang, result.key(),
                "level", String.valueOf(guilds.minLevel()),
                "cost", EconomyService.format(guilds.createCost()),
                "symbol", plugin.getEconomy().symbol(),
                "max", String.valueOf(guilds.maxMembers())));
    }

    // ── 탭 완성 ────────────────────────────────────────────────────────

    @Override
    public List<String> onTabComplete(@NotNull CommandSender sender, @NotNull Command command,
                                      @NotNull String label, @NotNull String[] args) {
        if (!(sender instanceof Player player)) return Collections.emptyList();

        if (args.length == 1) {
            // 별칭을 모두 내보내면 목록이 두 배로 길어져 쓰기 어렵습니다.
            // 기본 언어(한국어) 쪽만 제안합니다.
            return filter(List.of("창설", "초대", "수락", "탈퇴", "추방", "임명", "강등",
                    "위임", "금고", "정보", "목록", "랭킹", "초대목록", "해산", "도움말"), args[0]);
        }

        String sub = ALIASES.get(args[0].toLowerCase(Locale.ROOT));
        if (sub == null) return Collections.emptyList();

        Guild guild = plugin.getGuilds().of(player);

        if (args.length == 2) {
            switch (sub) {
                case "invite" -> {
                    List<String> names = new ArrayList<>();
                    for (Player online : Bukkit.getOnlinePlayers()) {
                        if (!online.equals(player) && plugin.getGuilds().of(online) == null) {
                            names.add(online.getName());
                        }
                    }
                    return filter(names, args[1]);
                }
                case "kick", "promote", "demote", "transfer" -> {
                    if (guild == null) return Collections.emptyList();
                    List<String> names = new ArrayList<>();
                    for (GuildMember member : guild.members()) {
                        if (!member.getUuid().equals(player.getUniqueId())) {
                            names.add(member.getName());
                        }
                    }
                    return filter(names, args[1]);
                }
                case "bank" -> {
                    return filter(List.of("입금", "출금"), args[1]);
                }
                case "info" -> {
                    List<String> names = new ArrayList<>();
                    for (Guild g : plugin.getGuilds().all().values()) names.add(g.getName());
                    return filter(names, args[1]);
                }
                case "disband" -> {
                    // 확인 문구로 길드 이름을 요구하므로 그것만 제안합니다.
                    return guild == null ? Collections.emptyList()
                            : filter(List.of(guild.getName()), args[1]);
                }
                case "accept" -> {
                    List<String> names = new ArrayList<>();
                    for (Guild g : plugin.getGuilds().all().values()) names.add(g.getName());
                    return filter(names, args[1]);
                }
                default -> { return Collections.emptyList(); }
            }
        }
        return Collections.emptyList();
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
