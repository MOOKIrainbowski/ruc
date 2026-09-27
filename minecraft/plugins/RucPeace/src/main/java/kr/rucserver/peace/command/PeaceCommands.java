package kr.rucserver.peace.command;

import kr.rucserver.peace.RucPeace;
import kr.rucserver.peace.storage.PeaceRepository;
import org.bukkit.Bukkit;
import org.bukkit.command.Command;
import org.bukkit.command.CommandExecutor;
import org.bukkit.command.CommandSender;
import org.bukkit.command.TabCompleter;
import org.bukkit.entity.Player;
import org.jetbrains.annotations.NotNull;

import java.time.Instant;
import java.time.ZoneId;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.Locale;

/**
 * 평화 서버 명령 (§3.3, §2.5).
 *
 * <ul>
 *   <li>{@code /spawn} {@code /sethome} {@code /home} {@code /delhome} — Core 의
 *       공용 HomeService 를 호출합니다</li>
 *   <li>{@code /평화기록} — (스태프) 막힌 살해 시도 조회. Helper 재량 제재의 근거</li>
 * </ul>
 */
public class PeaceCommands implements CommandExecutor, TabCompleter {

    private final RucPeace plugin;

    public PeaceCommands(RucPeace plugin) {
        this.plugin = plugin;
    }

    public void register() {
        for (String name : List.of("spawn", "sethome", "home", "delhome", "peacelog")) {
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

        // 기록 조회는 콘솔·RCON 에서도 되어야 합니다. 스태프가 게임에 들어오지
        // 않고도 확인하는 것이 대응의 첫 단계입니다.
        if (command.getName().equalsIgnoreCase("peacelog")) {
            return handleLog(sender, args);
        }

        if (!(sender instanceof Player player)) {
            sender.sendMessage("이 명령어는 게임 안에서만 사용할 수 있습니다.");
            return true;
        }

        switch (command.getName().toLowerCase(Locale.ROOT)) {
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

    /** {@code /평화기록 [닉네임]} — 막힌 살해 시도. */
    private boolean handleLog(CommandSender sender, String[] args) {
        if (!sender.hasPermission("rucpeace.staff")) {
            plugin.msg().send(sender, "peace.log-no-permission");
            return true;
        }

        String target = args.length >= 1 ? args[0] : null;
        int limit = plugin.getConfig().getInt("incident.log-limit", 15);

        plugin.getIncidents().recent(target, limit, rows -> {
            if (rows.isEmpty()) {
                plugin.msg().send(sender, target == null
                        ? "peace.log-empty" : "peace.log-empty-player", "player", String.valueOf(target));
                return;
            }

            plugin.msg().sendPlain(sender, "peace.log-header",
                    "count", String.valueOf(rows.size()));

            DateTimeFormatter formatter = DateTimeFormatter.ofPattern("MM-dd HH:mm:ss")
                    .withZone(zone());

            for (PeaceRepository.Incident row : rows) {
                plugin.msg().sendPlain(sender, "peace.log-row",
                        "time", formatter.format(Instant.ofEpochMilli(row.at())),
                        "actor", row.actorName(),
                        "victim", row.victimName(),
                        "kind", row.kind(),
                        "world", row.world(),
                        "x", String.valueOf(row.x()),
                        "y", String.valueOf(row.y()),
                        "z", String.valueOf(row.z()));
            }

            // 누적 건수는 "한 번 실수" 와 "반복" 을 가르는 가장 중요한 숫자입니다.
            if (target != null) {
                plugin.getIncidents().countFor(target, count ->
                        plugin.msg().sendPlain(sender, "peace.log-total",
                                "player", target, "count", String.valueOf(count)));
            }
        });
        return true;
    }

    /** 시각 표기 기준. Core 의 timezone 을 따릅니다 (기본 Asia/Seoul). */
    private ZoneId zone() {
        String id = plugin.core().getConfig().getString("timezone", "Asia/Seoul");
        try {
            return ZoneId.of(id);
        } catch (Exception e) {
            return ZoneId.systemDefault();
        }
    }

    @Override
    public List<String> onTabComplete(@NotNull CommandSender sender, @NotNull Command command,
                                      @NotNull String label, @NotNull String[] args) {
        if (!command.getName().equalsIgnoreCase("peacelog")) return Collections.emptyList();
        if (!sender.hasPermission("rucpeace.staff") || args.length != 1) {
            return Collections.emptyList();
        }

        String prefix = args[0].toLowerCase(Locale.ROOT);
        List<String> names = new ArrayList<>();
        for (Player online : Bukkit.getOnlinePlayers()) {
            if (online.getName().toLowerCase(Locale.ROOT).startsWith(prefix)) {
                names.add(online.getName());
            }
        }
        return names;
    }
}
