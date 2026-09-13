package kr.rucserver.core.command;

import kr.rucserver.core.RucCore;
import kr.rucserver.core.model.RucPlayer;
import kr.rucserver.core.service.EconomyService;
import kr.rucserver.core.service.MessageService;
import kr.rucserver.core.service.VerificationService;
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

/**
 * RucCore가 등록하는 명령어 전부를 한 곳에서 처리합니다.
 * 명령어 수가 적어서 클래스를 쪼개는 것보다 이쪽이 읽기 쉽습니다.
 */
public class CoreCommands implements CommandExecutor, TabCompleter {

    private final RucCore plugin;
    private final MessageService messages;

    public CoreCommands(RucCore plugin, MessageService messages) {
        this.plugin = plugin;
        this.messages = messages;
    }

    /** plugin.yml에 등록된 명령어들을 이 핸들러에 연결합니다. */
    public void register() {
        for (String name : List.of("tpa", "tpahere", "tpaccept", "tpdeny",
                "tpcancel", "ruc", "level", "ruclang",
                "verify", "verifyapprove", "rucverify", "rucxp")) {
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

        // rucverify는 RCON(콘솔)에서 디스코드 봇이 호출하므로
        // 플레이어 전용 검사보다 먼저 처리합니다.
        if (command.getName().equalsIgnoreCase("rucverify")) {
            return handleRconVerify(sender, args);
        }

        if (!(sender instanceof Player player)) {
            sender.sendMessage("이 명령어는 게임 안에서만 사용할 수 있습니다.");
            return true;
        }

        String lang = plugin.getPlayerData().languageOf(player);

        switch (command.getName().toLowerCase(Locale.ROOT)) {
            case "tpa", "tpahere" -> {
                boolean here = command.getName().equalsIgnoreCase("tpahere");
                if (args.length < 1) {
                    player.sendMessage(messages.prefixed(lang, "tpa.usage"));
                    return true;
                }
                Player target = Bukkit.getPlayerExact(args[0]);
                if (target == null) {
                    player.sendMessage(messages.prefixed(lang, "general.player-not-found",
                            "player", args[0]));
                    return true;
                }
                plugin.getTpa().request(player, target, here);
            }

            case "tpaccept" -> plugin.getTpa().accept(player);
            case "tpdeny" -> plugin.getTpa().deny(player);
            case "tpcancel" -> plugin.getTpa().cancel(player);

            case "ruc" -> {
                if (args.length >= 1) {
                    Player target = Bukkit.getPlayerExact(args[0]);
                    if (target == null) {
                        player.sendMessage(messages.prefixed(lang, "general.player-not-found",
                                "player", args[0]));
                        return true;
                    }
                    RucPlayer data = plugin.getPlayerData().get(target);
                    if (data == null) return true;

                    player.sendMessage(messages.prefixed(lang, "economy.balance-other",
                            "player", target.getName(),
                            "amount", EconomyService.format(data.getRuc()),
                            "symbol", plugin.getEconomy().symbol()));
                } else {
                    RucPlayer data = plugin.getPlayerData().get(player);
                    if (data == null) return true;

                    player.sendMessage(messages.prefixed(lang, "economy.balance-self",
                            "amount", EconomyService.format(data.getRuc()),
                            "symbol", plugin.getEconomy().symbol()));
                }
            }

            case "level" -> {
                RucPlayer data = plugin.getPlayerData().get(player);
                if (data == null) return true;
                player.sendMessage(plugin.getXp().statusLine(player, data));
            }

            case "rucxp" -> {
                if (!sender.hasPermission("ruccore.admin")) {
                    player.sendMessage(messages.prefixed(
                            plugin.getPlayerData().languageOf(player), "xp.no-permission"));
                    return true;
                }
                if (args.length < 1) {
                    sender.sendMessage("§c사용법: /rucxp <양> [닉네임]");
                    return true;
                }
                long amount;
                try {
                    amount = Long.parseLong(args[0]);
                } catch (NumberFormatException e) {
                    sender.sendMessage("§c숫자를 입력하세요.");
                    return true;
                }
                Player target = args.length >= 2 ? Bukkit.getPlayerExact(args[1]) : player;
                if (target == null) {
                    sender.sendMessage("§c대상이 접속 중이 아닙니다.");
                    return true;
                }
                plugin.getXp().grant(target, amount);
                RucPlayer td = plugin.getPlayerData().get(target);
                sender.sendMessage("§a" + target.getName() + " → +" + amount + " XP"
                        + (td == null ? "" : " (현재 Lv." + td.getLevel()
                           + " " + td.getXp() + "/" + plugin.getXp().requiredXp(td.getLevel()) + ")"));
            }
            case "ruclang" -> {
                if (args.length < 1) {
                    player.sendMessage(messages.prefixed(lang, "lang.usage"));
                    return true;
                }
                String requested = args[0].toLowerCase(Locale.ROOT);
                if (!messages.isSupported(requested)) {
                    player.sendMessage(messages.prefixed(lang, "lang.unsupported"));
                    return true;
                }
                RucPlayer data = plugin.getPlayerData().get(player);
                if (data == null) return true;

                data.setLanguage(requested);
                plugin.getPlayerData().saveAsync(data);
                // 바뀐 언어로 안내합니다.
                player.sendMessage(messages.prefixed(requested, "lang.changed"));
            }

            case "verify" -> {
                RucPlayer data = plugin.getPlayerData().get(player);
                if (data == null) return true;
                if (data.isVerified()) {
                    player.sendMessage(messages.prefixed(lang, "verify.already-verified"));
                    return true;
                }
                plugin.getVerification().issueCode(player, true);
            }

            case "verifyapprove" -> {
                if (args.length < 1) {
                    player.sendMessage(messages.prefixed(lang, "verify.staff-usage"));
                    return true;
                }
                Player target = Bukkit.getPlayerExact(args[0]);
                if (target == null) {
                    player.sendMessage(messages.prefixed(lang, "general.player-not-found",
                            "player", args[0]));
                    return true;
                }
                if (plugin.getVerification().approveManually(target, player.getName())) {
                    player.sendMessage(messages.prefixed(lang, "verify.staff-approved",
                            "player", target.getName()));
                } else {
                    player.sendMessage(messages.prefixed(lang, "verify.already-verified"));
                }
            }

            default -> {
                return false;
            }
        }
        return true;
    }

    @Override
    public List<String> onTabComplete(@NotNull CommandSender sender, @NotNull Command command,
                                      @NotNull String label, @NotNull String[] args) {

        String name = command.getName().toLowerCase(Locale.ROOT);

        if (args.length == 1) {
            if (name.equals("ruclang")) {
                return filter(List.of("ko", "en"), args[0]);
            }
            if (name.equals("tpa") || name.equals("tpahere") || name.equals("ruc")) {
                List<String> names = new ArrayList<>();
                for (Player p : Bukkit.getOnlinePlayers()) {
                    if (!p.equals(sender)) names.add(p.getName());
                }
                return filter(names, args[0]);
            }
        }
        return Collections.emptyList();
    }

    /**
     * RCON 전용 — 디스코드 봇(MOOKI)이 인증 코드를 검증할 때 호출합니다.
     *
     * MOOKI는 Node.js라 자바 임베디드 DB(H2)를 직접 읽을 수 없습니다. 그래서
     * 이미 .env에 있던 RCON을 연동 통로로 씁니다. 운영에서 MySQL로 바꿔도
     * 이 경로는 그대로 동작합니다.
     *
     * 응답은 "RUCVERIFY <RESULT>" 한 줄로 내보내서 봇이 파싱하기 쉽게 합니다.
     */
    private boolean handleRconVerify(CommandSender sender, String[] args) {
        if (sender instanceof Player) {
            sender.sendMessage("이 명령어는 콘솔에서만 사용할 수 있습니다.");
            return true;
        }
        if (args.length < 2) {
            sender.sendMessage("RUCVERIFY ERROR usage: /rucverify <code> <discordId> [discordName]");
            return true;
        }

        String code = args[0];
        String discordId = args[1];
        String discordName = args.length >= 3 ? args[2] : discordId;

        // RCON 호출은 메인 스레드에서 들어오므로 DB 작업을 여기서 직접 하면
        // 서버가 멈춥니다. 다만 RCON은 응답을 동기로 기대하기 때문에,
        // 짧은 대기로 결과를 받아 돌려줍니다.
        VerificationService.Result result =
                plugin.getVerification().verify(code, discordId, discordName);

        sender.sendMessage("RUCVERIFY " + result.name());
        return true;
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
