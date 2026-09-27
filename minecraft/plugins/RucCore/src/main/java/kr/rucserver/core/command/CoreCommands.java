package kr.rucserver.core.command;

import kr.rucserver.core.RucCore;
import kr.rucserver.core.model.RucPlayer;
import kr.rucserver.core.service.EconomyService;
import kr.rucserver.core.service.MailboxService;
import kr.rucserver.core.service.MessageService;
import kr.rucserver.core.service.VerificationService;
import org.bukkit.Bukkit;
import org.bukkit.command.Command;
import org.bukkit.command.CommandExecutor;
import org.bukkit.command.CommandSender;
import org.bukkit.command.TabCompleter;
import org.bukkit.entity.Player;
import org.bukkit.inventory.ItemStack;
import org.jetbrains.annotations.NotNull;

import java.sql.SQLException;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.Locale;
import java.util.logging.Level;

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
                "verify", "verifyapprove", "rucverify", "rucxp", "menu", "levelup",
                "mailbox", "mailsend")) {
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

        // 스태프 보정 명령도 콘솔·RCON 에서 써야 합니다. 게임에 들어가지 못하는
        // 상태(레벨·잔고가 막혀 있을 때)를 밖에서 풀 수 있어야 하기 때문입니다.
        if (command.getName().equalsIgnoreCase("levelup")) {
            return handleLevelUp(sender, args);
        }
        if (command.getName().equalsIgnoreCase("ruc")
                && args.length >= 1 && args[0].equalsIgnoreCase("give")) {
            return handleRucGive(sender, args);
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

            case "mailbox" -> plugin.getMailbox().open(player, 0);

            case "mailsend" -> handleMailSend(player, args);

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

            case "menu" -> plugin.getMenus().openMain(player);

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
            if (name.equals("levelup")) {
                return filter(onlineNames(sender, false), args[0]);
            }
            if (name.equals("tpa") || name.equals("tpahere") || name.equals("ruc")) {
                List<String> options = new ArrayList<>(onlineNames(sender, false));
                // 잔고 조회 대상에 하위 명령을 함께 제안합니다. 스태프에게만
                // 보이므로 일반 유저의 목록이 지저분해지지 않습니다.
                if (name.equals("ruc") && sender.hasPermission("ruccore.admin")) {
                    options.add("give");
                }
                return filter(options, args[0]);
            }
        }

        if (args.length == 2) {
            if (name.equals("ruc") && args[0].equalsIgnoreCase("give")
                    && sender.hasPermission("ruccore.admin")) {
                return filter(onlineNames(sender, true), args[1]);
            }
            if (name.equals("levelup")) {
                // 흔히 쓰는 값만 제안합니다. 길드 창설 조건이 10 이라 그것을 앞에 둡니다.
                return filter(List.of("10", "1", "20", "50",
                        String.valueOf(plugin.getXp().getMaxLevel())), args[1]);
            }
        }
        return Collections.emptyList();
    }

    // ── 스태프 보정 명령 (OP 전용) ─────────────────────────────────────

    /**
     * {@code /levelup <닉네임> <레벨>} — 레벨을 즉시 지정합니다.
     *
     * 권한을 plugin.yml 에만 맡기지 않고 여기서도 확인합니다. 권한 노드를
     * 누가 다른 플러그인에서 일반 유저에게 부여해도 이 검사는 남습니다.
     * 화폐와 레벨은 이 서버의 모든 게이트(길드 창설, 국가전 입장)를 여는
     * 열쇠라 한 겹으로 막을 것이 아닙니다.
     */
    private boolean handleLevelUp(CommandSender sender, String[] args) {
        if (!sender.hasPermission("ruccore.admin")) {
            sender.sendMessage(messages.prefixed(langOf(sender), "general.no-permission"));
            return true;
        }
        if (args.length < 2) {
            sender.sendMessage(messages.prefixed(langOf(sender), "admin.levelup-usage",
                    "max", String.valueOf(plugin.getXp().getMaxLevel())));
            return true;
        }

        Player target = Bukkit.getPlayerExact(args[0]);
        if (target == null) {
            sender.sendMessage(messages.prefixed(langOf(sender), "general.player-not-found",
                    "player", args[0]));
            return true;
        }

        int level;
        try {
            level = Integer.parseInt(args[1]);
        } catch (NumberFormatException e) {
            sender.sendMessage(messages.prefixed(langOf(sender), "admin.not-a-number",
                    "value", args[1]));
            return true;
        }

        int applied = plugin.getXp().setLevel(target, level);
        if (applied < 0) {
            // 접속 직후라 캐시가 아직 비어 있는 상태입니다. 여기서 DB 를 직접
            // 건드리면 잠시 뒤 로드가 끝나면서 그 값을 덮어씁니다.
            sender.sendMessage(messages.prefixed(langOf(sender), "admin.data-not-loaded",
                    "player", target.getName()));
            return true;
        }

        sender.sendMessage(messages.prefixed(langOf(sender), "admin.levelup-done",
                "player", target.getName(), "level", String.valueOf(applied)));

        if (applied != level) {
            sender.sendMessage(messages.prefixed(langOf(sender), "admin.levelup-clamped",
                    "requested", String.valueOf(level),
                    "max", String.valueOf(plugin.getXp().getMaxLevel())));
        }

        plugin.getLogger().info("[스태프] " + sender.getName() + " → " + target.getName()
                + " 레벨 " + applied + " 로 설정");
        return true;
    }

    /**
     * {@code /ruc give <닉네임> <금액>} — Ruc 를 지급합니다.
     *
     * <h2>접속 중이 아니면 우편으로 갑니다 (Phase 5.5)</h2>
     * 미접속자의 잔고를 DB 로 직접 쓰면, 그 사람이 <b>다른 서버</b>에 접속해
     * 있을 때 그쪽 캐시가 나중에 저장되면서 지급이 조용히 사라집니다
     * (EconomyService 의 주석과 같은 이유). 우편은 다른 테이블이라 그 경쟁에
     * 끼지 않습니다 — 받는 사람이 직접 꺼낼 때 잔고에 더해집니다.
     *
     * {@code Bukkit.getPlayerExact} 는 <b>이 서버</b>의 접속자만 봅니다. 다른
     * 서버에 있는 사람은 여기서 null 이 되어 우편 경로를 타는데, 그게 정확히
     * 우리가 원하는 동작입니다.
     *
     * {@code give} 를 닉네임보다 먼저 보므로, 'give' 라는 이름을 가진 사람의
     * 잔고는 {@code /ruc} 로 조회할 수 없습니다. 그 대가로 하위 명령이
     * 예측 가능하게 동작합니다.
     */
    private boolean handleRucGive(CommandSender sender, String[] args) {
        if (!sender.hasPermission("ruccore.admin")) {
            sender.sendMessage(messages.prefixed(langOf(sender), "general.no-permission"));
            return true;
        }
        if (args.length < 3) {
            sender.sendMessage(messages.prefixed(langOf(sender), "admin.ruc-give-usage"));
            return true;
        }

        long amount;
        try {
            // 1,000,000 처럼 쉼표를 넣어도 받습니다. 큰 금액을 다루는 명령입니다.
            amount = Long.parseLong(args[2].replace(",", ""));
        } catch (NumberFormatException e) {
            sender.sendMessage(messages.prefixed(langOf(sender), "admin.not-a-number",
                    "value", args[2]));
            return true;
        }
        if (amount <= 0) {
            sender.sendMessage(messages.prefixed(langOf(sender), "admin.amount-positive"));
            return true;
        }

        Player target = Bukkit.getPlayerExact(args[1]);
        if (target == null) {
            mailRuc(sender, args[1], amount);
            return true;
        }

        // deposit() 을 쓰는 이유: reward() 는 드래곤 알 배수(D3)를 타므로
        // 운영자가 입력한 금액과 실제 지급액이 달라집니다.
        if (!plugin.getEconomy().deposit(target.getUniqueId(), amount)) {
            sender.sendMessage(messages.prefixed(langOf(sender), "admin.data-not-loaded",
                    "player", target.getName()));
            return true;
        }

        String symbol = plugin.getEconomy().symbol();
        sender.sendMessage(messages.prefixed(langOf(sender), "admin.ruc-give-done",
                "player", target.getName(),
                "amount", EconomyService.format(amount),
                "symbol", symbol,
                "balance", EconomyService.format(
                        plugin.getEconomy().balance(target.getUniqueId()))));

        target.sendMessage(messages.prefixed(plugin.getPlayerData().languageOf(target),
                "economy.received", "amount", EconomyService.format(amount),
                "symbol", symbol));

        plugin.getLogger().info("[스태프] " + sender.getName() + " → " + target.getName()
                + " Ruc +" + amount);
        return true;
    }

    /**
     * 접속 중이 아닌 사람에게 Ruc 를 우편으로 보냅니다.
     *
     * 이름으로 찾으므로 한 번도 접속한 적 없는 사람에게는 보낼 수 없습니다.
     * 오타를 우편함에 쌓아 두는 것보다 "그런 사람은 없다" 고 답하는 쪽이 낫습니다.
     */
    private void mailRuc(CommandSender sender, String name, long amount) {
        String lang = langOf(sender);
        String symbol = plugin.getEconomy().symbol();

        Bukkit.getScheduler().runTaskAsynchronously(plugin, () -> {
            RucPlayer found = lookup(name);
            if (found == null) {
                Bukkit.getScheduler().runTask(plugin, () -> sender.sendMessage(
                        messages.prefixed(lang, "general.player-not-found", "player", name)));
                return;
            }

            String resolved = found.getName();
            plugin.getMailbox().sendRuc(found.getUuid(), amount, sender.getName(), "staff",
                    result -> {
                        if (result == MailboxService.Result.OK) {
                            sender.sendMessage(messages.prefixed(lang, "admin.ruc-give-mailed",
                                    "player", resolved,
                                    "amount", EconomyService.format(amount),
                                    "symbol", symbol));
                            plugin.getLogger().info("[스태프] " + sender.getName() + " -> "
                                    + resolved + " 우편 Ruc +" + amount);
                        } else if (result == MailboxService.Result.FULL) {
                            sender.sendMessage(messages.prefixed(lang, "mailbox.target-full",
                                    "player", resolved));
                        } else {
                            sender.sendMessage(messages.prefixed(lang, "mailbox.error"));
                        }
                    });
        });
    }

    /**
     * {@code /mailsend <닉네임>} — 손에 든 아이템을 그 사람의 우편함으로.
     *
     * 유저 상점(Phase 10)이 열리기 전까지 아이템 우편을 쓰는 유일한 경로이고,
     * 동시에 우편함이 제대로 도는지 확인하는 수단입니다. 이벤트 보상을 손으로
     * 지급할 때도 이것으로 됩니다.
     */
    private void handleMailSend(Player sender, String[] args) {
        String lang = plugin.getPlayerData().languageOf(sender);

        if (!sender.hasPermission("ruccore.admin")) {
            sender.sendMessage(messages.prefixed(lang, "general.no-permission"));
            return;
        }
        if (args.length < 1) {
            sender.sendMessage(messages.prefixed(lang, "mailbox.send-usage"));
            return;
        }

        ItemStack hand = sender.getInventory().getItemInMainHand();
        if (hand.getType().isAir()) {
            sender.sendMessage(messages.prefixed(lang, "mailbox.send-empty-hand"));
            return;
        }

        // 손의 아이템을 먼저 비웁니다. 발송이 비동기라 넣고 나서 지우면 그 사이에
        // 같은 아이템을 또 보낼 수 있고, 그건 복사입니다.
        ItemStack payload = hand.clone();
        sender.getInventory().setItemInMainHand(null);

        String name = args[0];
        Bukkit.getScheduler().runTaskAsynchronously(plugin, () -> {
            RucPlayer found = lookup(name);
            if (found == null) {
                Bukkit.getScheduler().runTask(plugin, () -> {
                    sender.sendMessage(messages.prefixed(lang, "general.player-not-found",
                            "player", name));
                    giveBack(sender, payload);
                });
                return;
            }

            String resolved = found.getName();
            plugin.getMailbox().sendItem(found.getUuid(), payload, sender.getName(), "staff",
                    result -> {
                        if (result == MailboxService.Result.OK) {
                            sender.sendMessage(messages.prefixed(lang, "mailbox.send-done",
                                    "player", resolved));
                            plugin.getLogger().info("[스태프] " + sender.getName() + " -> "
                                    + resolved + " 우편 아이템 " + payload.getType());
                            return;
                        }
                        if (result == MailboxService.Result.FULL) {
                            sender.sendMessage(messages.prefixed(lang, "mailbox.target-full",
                                    "player", resolved));
                        } else {
                            sender.sendMessage(messages.prefixed(lang, "mailbox.error"));
                        }
                        giveBack(sender, payload);
                    });
        });
    }

    /** 닉네임으로 저장된 플레이어를 찾습니다. 비동기에서만 부르세요. */
    private RucPlayer lookup(String name) {
        try {
            return plugin.getPlayerData().getRepository().findByName(name);
        } catch (SQLException e) {
            plugin.getLogger().log(Level.SEVERE, "닉네임 조회 실패: " + name, e);
            return null;
        }
    }

    /** 발송이 실패했을 때 손에서 뺀 아이템을 돌려줍니다. */
    private void giveBack(Player player, ItemStack item) {
        if (!player.isOnline()) {
            // 퇴장했다면 본인 우편함으로 보냅니다. 바닥에 떨어뜨리면 그 자리가
            // 어디였는지 아무도 모릅니다.
            plugin.getMailbox().sendItem(player.getUniqueId(), item, "시스템", "return", null);
            return;
        }
        for (ItemStack leftover : player.getInventory().addItem(item).values()) {
            plugin.getMailbox().sendItem(player.getUniqueId(), leftover,
                    "시스템", "return", null);
        }
    }

    /** 발신자의 표시 언어. 콘솔은 서버 기본값을 씁니다. */
    private String langOf(CommandSender sender) {
        if (sender instanceof Player player) return plugin.getPlayerData().languageOf(player);
        return plugin.getConfig().getString("language.default", "ko");
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

    /** 접속자 이름. {@code includeSelf} 가 false 면 발신자를 제외합니다. */
    private List<String> onlineNames(CommandSender sender, boolean includeSelf) {
        List<String> names = new ArrayList<>();
        for (Player p : Bukkit.getOnlinePlayers()) {
            if (!includeSelf && p.equals(sender)) continue;
            names.add(p.getName());
        }
        return names;
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
