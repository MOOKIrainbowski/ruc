package kr.rucserver.core.command;

import kr.rucserver.core.RucCore;
import org.bukkit.command.Command;
import org.bukkit.command.CommandExecutor;
import org.bukkit.command.CommandSender;
import org.bukkit.entity.Player;
import org.jetbrains.annotations.NotNull;

/**
 * {@code /엔더확장} — 엔더상자 확장권을 무과금으로 삽니다.
 * <pre>
 * /엔더확장        지금 몇 개인지 · 다음 확장권 조건
 * /엔더확장 구매   조건(레벨 · Ruc)을 채웠으면 확장권을 우편으로 받기
 * </pre>
 * 확장권을 들고 우클릭해야 엔더상자가 늘어납니다. 엔더상자는 Shift+F 메뉴에서 엽니다.
 */
public class EnderCommands implements CommandExecutor {

    private final RucCore plugin;

    public EnderCommands(RucCore plugin) {
        this.plugin = plugin;
    }

    public void register() {
        var command = plugin.getCommand("enderexpand");
        if (command == null) {
            plugin.getLogger().warning("plugin.yml에 'enderexpand' 명령어가 없습니다.");
            return;
        }
        command.setExecutor(this);
    }

    @Override
    public boolean onCommand(@NotNull CommandSender sender, @NotNull Command command,
                             @NotNull String label, @NotNull String[] args) {
        if (!(sender instanceof Player player)) {
            sender.sendMessage("게임 안에서만 쓸 수 있습니다.");
            return true;
        }
        boolean buy = args.length > 0 && (args[0].equals("구매") || args[0].equalsIgnoreCase("buy"));
        plugin.getEnder().unlock(player, buy);
        return true;
    }
}
