package kr.rucserver.core.command;

import kr.rucserver.core.RucCore;
import kr.rucserver.core.model.RucPlayer;
import kr.rucserver.core.service.EconomyService;
import kr.rucserver.core.service.MessageService;
import kr.rucserver.core.service.PaymentService;
import kr.rucserver.core.service.PaymentService.GoldOffer;
import org.bukkit.Bukkit;
import org.bukkit.command.Command;
import org.bukkit.command.CommandExecutor;
import org.bukkit.command.CommandSender;
import org.bukkit.entity.Player;
import org.jetbrains.annotations.NotNull;

import java.util.Locale;
import java.util.UUID;
import java.util.logging.Level;

/**
 * {@code /등급} — 후원 등급 · RUC (2026-10-05).
 * <pre>
 * /등급                          내 등급 · RUC 잔고 · Gold 로 살 수 있는 등급
 * /등급 구매 &lt;vip|svip&gt;          Gold 로 구매 (config rank-shop)
 * /등급 RUC지급 &lt;닉네임&gt; &lt;양&gt;    (스태프) 이벤트 RUC 지급. 음수면 회수
 * </pre>
 * MVP 이상은 현금 또는 RUC 로만 팝니다 — 디스코드 {@code /충전}.
 */
public class RankCommands implements CommandExecutor {

    private final RucCore plugin;
    private final MessageService messages;

    public RankCommands(RucCore plugin, MessageService messages) {
        this.plugin = plugin;
        this.messages = messages;
    }

    public void register() {
        var command = plugin.getCommand("rank");
        if (command == null) {
            plugin.getLogger().warning("plugin.yml에 'rank' 명령어가 없습니다.");
            return;
        }
        command.setExecutor(this);
    }

    @Override
    public boolean onCommand(@NotNull CommandSender sender, @NotNull Command command,
                             @NotNull String label, @NotNull String[] args) {
        String sub = args.length > 0 ? args[0].toLowerCase(Locale.ROOT) : "";
        if (sub.equals("ruc지급") || sub.equals("rucgive")) {
            giveRuc(sender, args);
            return true;
        }
        if (!(sender instanceof Player player)) {
            sender.sendMessage("게임 안에서만 쓸 수 있습니다.");
            return true;
        }
        String lang = plugin.getPlayerData().languageOf(player);
        if (sub.equals("구매") || sub.equals("buy")) {
            GoldOffer offer = args.length > 1 ? plugin.getPayments().goldOffer(args[1].toLowerCase(Locale.ROOT)) : null;
            if (offer == null) {
                player.sendMessage(messages.prefixed(lang, "rank.unknown"));
                return true;
            }
            plugin.getPayments().buyWithGold(player, offer, key -> {
                if (!player.isOnline()) return;
                player.sendMessage(key.equals("ok")
                        ? messages.prefixed(lang, "rank.bought", "name", offer.name(), "period", offer.period())
                        : messages.prefixed(lang, key, "cost", EconomyService.format(offer.gold()),
                        "symbol", plugin.getEconomy().symbol()));
            });
            return true;
        }
        status(player, lang);
        return true;
    }

    private void status(Player player, String lang) {
        UUID uuid = player.getUniqueId();
        Bukkit.getScheduler().runTaskAsynchronously(plugin, () -> {
            int rank;
            long ruc;
            try {
                rank = plugin.getPayments().rankLevel(uuid);
                ruc = plugin.getPayments().rucBalance(uuid);
            } catch (Exception e) {
                plugin.getLogger().log(Level.SEVERE, "[등급] 조회 실패: " + player.getName(), e);
                return;
            }
            Bukkit.getScheduler().runTask(plugin, () -> {
                if (!player.isOnline()) return;
                String name = rank < 0 ? messages.raw(lang, "rank.none")
                        : PaymentService.RANKS.get(rank).toUpperCase(Locale.ROOT);
                player.sendMessage(messages.prefixed(lang, "rank.status", "rank", name,
                        "ruc", EconomyService.format(ruc),
                        "gold", EconomyService.format(plugin.getEconomy().balance(uuid)),
                        "symbol", plugin.getEconomy().symbol()));
                for (String id : plugin.getPayments().goldOfferIds()) {
                    GoldOffer o = plugin.getPayments().goldOffer(id);
                    if (o == null) continue;
                    player.sendMessage(messages.get(lang, "rank.offer", "id", o.id(), "name", o.name(),
                            "cost", EconomyService.format(o.gold()), "symbol", plugin.getEconomy().symbol(),
                            "period", o.period()));
                }
                player.sendMessage(messages.get(lang, "rank.cash-hint"));
            });
        });
    }

    private void giveRuc(CommandSender sender, String[] args) {
        if (!sender.hasPermission("ruccore.admin")) {
            sender.sendMessage("권한이 없습니다.");
            return;
        }
        if (args.length < 3) {
            sender.sendMessage("사용법: /등급 RUC지급 <닉네임> <양> (음수면 회수)");
            return;
        }
        int amount;
        try {
            amount = Integer.parseInt(args[2]);
        } catch (NumberFormatException e) {
            sender.sendMessage("양은 정수여야 합니다.");
            return;
        }
        if (amount == 0 || Math.abs(amount) > 1_000_000) {
            sender.sendMessage("양은 -1,000,000 ~ 1,000,000 (0 제외) 입니다.");
            return;
        }
        String by = sender.getName();
        Bukkit.getScheduler().runTaskAsynchronously(plugin, () -> {
            String reply;
            try {
                RucPlayer target = plugin.getPlayerData().getRepository().findByName(args[1]);
                if (target == null) {
                    reply = "그런 플레이어가 없습니다: " + args[1];
                } else {
                    plugin.getPayments().grantRuc(target.getUuid(), amount, "event");
                    long balance = plugin.getPayments().rucBalance(target.getUuid());
                    plugin.getLogger().info("[등급] " + by + " → " + target.getName() + " RUC " + amount
                            + " (잔고 " + balance + ")");
                    reply = target.getName() + " 에게 RUC " + EconomyService.format(amount)
                            + " — 잔고 " + EconomyService.format(balance);
                }
            } catch (Exception e) {
                plugin.getLogger().log(Level.SEVERE, "[등급] RUC 지급 실패", e);
                reply = "RUC 지급에 실패했습니다. 서버 로그를 보세요.";
            }
            String msg = reply;
            Bukkit.getScheduler().runTask(plugin, () -> sender.sendMessage(msg));
        });
    }
}
