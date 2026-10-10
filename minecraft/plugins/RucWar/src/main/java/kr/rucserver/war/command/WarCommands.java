package kr.rucserver.war.command;

import kr.rucserver.core.model.Guild;
import kr.rucserver.core.service.EconomyService;
import kr.rucserver.war.RucWar;
import kr.rucserver.war.storage.WarRepository;
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
 * 국가전 서버 명령 (§3.3).
 *
 * <ul>
 *   <li>{@code /국가창고} — 길드 공용 창고</li>
 *   <li>{@code /tp [코어명]} — 자기 국가의 코어로 이동</li>
 *   <li>{@code /전쟁} — 시간대·영토·거점 현황</li>
 *   <li>{@code /인장구매} — 국가 인장 (길드장, 금고에서 차감)</li>
 * </ul>
 */
public class WarCommands implements CommandExecutor, TabCompleter {

    private final RucWar plugin;

    public WarCommands(RucWar plugin) {
        this.plugin = plugin;
    }

    public void register() {
        for (String name : List.of("nationstorage", "coretp", "warstatus", "buyseal")) {
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

        // /전쟁 은 콘솔에서도 현황 확인용으로 쓸 수 있게 해 둡니다.
        if (command.getName().equalsIgnoreCase("warstatus")) {
            if (args.length > 0 && sender.hasPermission("rucwar.admin") && staff(sender, args)) return true;
            sendStatus(sender);
            return true;
        }

        if (!(sender instanceof Player player)) {
            sender.sendMessage("이 명령어는 게임 안에서만 사용할 수 있습니다.");
            return true;
        }

        switch (command.getName().toLowerCase(Locale.ROOT)) {
            case "nationstorage" -> plugin.getStorage().openFor(player);

            case "coretp" -> handleCoreTp(player, args);

            case "buyseal" -> plugin.getSeals().buy(player);

            default -> {
                return false;
            }
        }
        return true;
    }

    /**
     * {@code /tp [코어명]}.
     *
     * 이 명령은 바닐라 {@code /tp} 를 가립니다. 요구사항(§3.3)이 {@code /tp [코어명]}
     * 이라 그 이름을 그대로 쓰되, 거점 이름이 아니고 좌표·닉네임처럼 보이는
     * 인수가 오면 <b>바닐라 쪽으로 넘겨 줍니다</b>. 그러지 않으면 스태프가
     * 국가전 서버에서 텔레포트 명령을 아예 쓸 수 없게 됩니다.
     */
    private void handleCoreTp(Player player, String[] args) {
        if (args.length == 0) {
            // 인수가 없으면 자기 코어로. 코어가 여러 개면 목록을 보여 줍니다.
            Guild guild = plugin.core().getGuilds().of(player);
            List<String> owned = guild == null
                    ? List.of() : plugin.getTerritory().siteNamesOf(guild.getId());

            if (owned.size() > 1) {
                plugin.msg().send(player, "war.warp-pick",
                        "sites", String.join(", ", owned));
                return;
            }
            plugin.getWarps().warp(player, null);
            return;
        }

        String requested = args[0];
        Guild guild = plugin.core().getGuilds().of(player);
        boolean isOwnSite = guild != null
                && plugin.getTerritory().siteNamesOf(guild.getId()).stream()
                        .anyMatch(site -> site.equalsIgnoreCase(requested));

        if (isOwnSite) {
            plugin.getWarps().warp(player, requested);
            return;
        }

        // 거점 이름이 아닙니다. 바닐라 텔레포트 권한이 있으면 그쪽으로 넘깁니다.
        if (player.hasPermission("minecraft.command.teleport")) {
            player.performCommand("minecraft:tp " + String.join(" ", args));
            return;
        }

        List<String> owned = guild == null
                ? List.of() : plugin.getTerritory().siteNamesOf(guild.getId());
        if (owned.isEmpty()) {
            plugin.msg().send(player, "war.warp-no-core");
        } else {
            plugin.msg().send(player, "war.warp-not-yours",
                    "sites", String.join(", ", owned));
        }
    }

    /** 스태프 점검용: /전쟁 강화석 [수] · /전쟁 보급 */
    private boolean staff(CommandSender sender, String[] args) {
        switch (args[0]) {
            case "강화석", "stone" -> {
                if (!(sender instanceof Player player)) return false;
                int amount = args.length > 1 ? Integer.parseInt(args[1]) : 16;
                player.getInventory().addItem(plugin.getUpgrades().createStone(amount));
                return true;
            }
            case "보급", "supply" -> {
                plugin.getSupply().dropAll();
                return true;
            }
            default -> {
                return false;
            }
        }
    }

    // ── /전쟁 ─────────────────────────────────────────────────────────

    private void sendStatus(CommandSender sender) {
        var schedule = plugin.getSchedule();

        plugin.msg().sendPlain(sender, "war.status-header");
        plugin.msg().sendPlain(sender, "war.status-schedule",
                "schedule", schedule.describe());

        if (schedule.isOpen()) {
            plugin.msg().sendPlain(sender, "war.status-now-open",
                    "minutes", String.valueOf(schedule.minutesUntilClose()));
        } else {
            long minutes = schedule.minutesUntilOpen();
            plugin.msg().sendPlain(sender, "war.status-now-closed",
                    "minutes", minutes < 0 ? "?" : String.valueOf(minutes));
        }

        // 거점 현황
        plugin.msg().sendPlain(sender, "war.status-sites-header");
        Map<String, WarRepository.CoreRow> cores = plugin.getTerritory().coreMap();

        if (plugin.getTerritory().isFreePlacement()) {
            // 자유 설치 — 남의 코어 좌표는 알려 주지 않습니다 (빛 기둥으로 찾아야 함). 스태프는 다 봅니다.
            Guild mine = sender instanceof Player p ? plugin.core().getGuilds().of(p) : null;
            for (WarRepository.CoreRow row : cores.values()) {
                Guild owner = plugin.core().getGuilds().byId(row.guildId());
                boolean visible = !(sender instanceof Player) || sender.hasPermission("rucwar.admin")
                        || (mine != null && mine.getId() == row.guildId());
                plugin.msg().sendPlain(sender, row.confirmed() ? "war.status-site-held" : "war.status-site-contested",
                        "site", row.site(), "guild", owner == null ? "?" : owner.getName(),
                        "x", visible ? String.valueOf(row.x()) : "?", "z", visible ? String.valueOf(row.z()) : "?");
            }
        }
        for (var site : plugin.getTerritory().isFreePlacement() ? java.util.List.<kr.rucserver.war.service.TerritoryService.CoreSite>of() : plugin.getTerritory().sites()) {
            WarRepository.CoreRow row = cores.get(site.name());
            if (row == null) {
                plugin.msg().sendPlain(sender, "war.status-site-free",
                        "site", site.name(),
                        "x", String.valueOf(site.x()), "z", String.valueOf(site.z()));
                continue;
            }
            Guild owner = plugin.core().getGuilds().byId(row.guildId());
            plugin.msg().sendPlain(sender, row.confirmed()
                            ? "war.status-site-held" : "war.status-site-contested",
                    "site", site.name(),
                    "guild", owner == null ? "?" : owner.getName(),
                    "x", String.valueOf(site.x()), "z", String.valueOf(site.z()));
        }

        // 내 소속 정보
        if (sender instanceof Player player) {
            Guild guild = plugin.core().getGuilds().of(player);
            if (guild == null) {
                plugin.msg().sendPlain(sender, "war.status-no-guild");
            } else {
                plugin.msg().sendPlain(sender, "war.status-mine",
                        "guild", guild.getName(),
                        "cores", String.valueOf(plugin.getTerritory().countCores(guild.getId())),
                        "max", String.valueOf(plugin.getConfig()
                                .getInt("territory.max-cores-per-guild", 2)),
                        "bank", EconomyService.format(guild.getBank()),
                        "symbol", plugin.core().getEconomy().symbol());

                String here = plugin.getTerritory().ownerNameAt(player.getLocation());
                plugin.msg().sendPlain(sender, "war.status-here",
                        "owner", here == null
                                ? plugin.msg().raw(sender, "war.status-here-wild") : here);
            }
        }
    }

    // ── 탭 완성 ────────────────────────────────────────────────────────

    @Override
    public List<String> onTabComplete(@NotNull CommandSender sender, @NotNull Command command,
                                      @NotNull String label, @NotNull String[] args) {
        if (!command.getName().equalsIgnoreCase("coretp")) return Collections.emptyList();
        if (!(sender instanceof Player player) || args.length != 1) {
            return Collections.emptyList();
        }

        Guild guild = plugin.core().getGuilds().of(player);
        List<String> options = new ArrayList<>(guild == null
                ? List.of() : plugin.getTerritory().siteNamesOf(guild.getId()));

        // 바닐라 /tp 로 넘어가는 경우도 있으므로 접속자 이름도 함께 제안합니다.
        if (player.hasPermission("minecraft.command.teleport")) {
            for (Player online : Bukkit.getOnlinePlayers()) options.add(online.getName());
        }

        String prefix = args[0].toLowerCase(Locale.ROOT);
        List<String> result = new ArrayList<>();
        for (String option : options) {
            if (option.toLowerCase(Locale.ROOT).startsWith(prefix)) result.add(option);
        }
        return result;
    }
}
