package kr.rucserver.raid.command;

import kr.rucserver.raid.RucRaid;
import org.bukkit.Bukkit;
import org.bukkit.OfflinePlayer;
import org.bukkit.command.Command;
import org.bukkit.command.CommandExecutor;
import org.bukkit.command.CommandSender;
import org.bukkit.entity.Player;
import org.jetbrains.annotations.NotNull;

/**
 * /spawn · /sethome · /home · /delhome, 그리고 스태프용 /raid.
 *
 * 한글 별칭(/스폰 /셋홈 /홈)은 plugin.yml 의 aliases 로 등록됩니다.
 */
public class RaidCommands implements CommandExecutor {

    private final RucRaid plugin;

    public RaidCommands(RucRaid plugin) {
        this.plugin = plugin;
    }

    public void register() {
        for (String name : new String[]{"spawn", "sethome", "home", "delhome", "raid"}) {
            var command = plugin.getCommand(name);
            if (command != null) command.setExecutor(this);
        }
    }

    @Override
    public boolean onCommand(@NotNull CommandSender sender, @NotNull Command command,
                             @NotNull String label, @NotNull String[] args) {

        if (command.getName().equalsIgnoreCase("raid")) {
            return staff(sender, args);
        }

        if (!(sender instanceof Player player)) {
            sender.sendMessage("§c게임 안에서만 사용할 수 있습니다.");
            return true;
        }

        switch (command.getName().toLowerCase()) {
            case "spawn" -> plugin.getHomes().goSpawn(player);
            case "sethome" -> plugin.getHomes().setHome(player);
            case "home" -> plugin.getHomes().goHome(player);
            case "delhome" -> plugin.getHomes().deleteHome(player);
            default -> {
                return false;
            }
        }
        return true;
    }

    // ── /raid <egg|pardon|status> ──────────────────────────────────────

    private boolean staff(CommandSender sender, String[] args) {
        if (!sender.hasPermission("rucraid.admin")) {
            plugin.msg().send(sender, "staff.no-permission");
            return true;
        }
        if (args.length == 0) {
            sender.sendMessage("§c사용법: /raid <egg|pardon|status|tag>");
            return true;
        }

        switch (args[0].toLowerCase()) {
            case "egg" -> {
                if (plugin.getEggs().respawnAtAltar()) {
                    plugin.msg().send(sender, "staff.egg-respawned");
                } else {
                    plugin.msg().send(sender, "staff.egg-failed");
                }
            }
            case "pardon" -> {
                if (args.length < 2) {
                    sender.sendMessage("§c사용법: /raid pardon <닉네임>");
                    return true;
                }
                OfflinePlayer target = Bukkit.getOfflinePlayer(args[1]);
                plugin.getExecutions().pardon(target.getUniqueId(),
                        () -> plugin.msg().send(sender, "staff.pardoned", "player", args[1]));
            }
            case "tag" -> {
                // §2.4 는 2인 교전이 있어야 태그가 붙습니다. 혼자 점검할 때
                // 그 전제를 대신 만들어 주는 명령입니다.
                Player target = args.length >= 2
                        ? Bukkit.getPlayerExact(args[1])
                        : (sender instanceof Player p ? p : null);
                if (target == null) {
                    sender.sendMessage("§c사용법: /raid tag [닉네임] — 대상이 접속 중이어야 합니다.");
                    return true;
                }
                plugin.getCombatTags().tagManually(target, "테스트");
                plugin.msg().send(sender, "staff.tagged", "player", target.getName());
            }
            case "status" -> {
                var holder = plugin.getEggs().getHolder();
                String name = holder == null ? "-" : Bukkit.getOfflinePlayer(holder).getName();
                plugin.msg().send(sender, "staff.status",
                        "holder", name == null ? "-" : name,
                        "tagged", String.valueOf(Bukkit.getOnlinePlayers().stream()
                                .filter(p -> plugin.getCombatTags().isTagged(p)).count()));
            }
            default -> sender.sendMessage("§c알 수 없는 인자입니다.");
        }
        return true;
    }
}
