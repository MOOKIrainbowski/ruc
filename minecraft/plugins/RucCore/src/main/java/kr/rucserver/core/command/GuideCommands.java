package kr.rucserver.core.command;

import kr.rucserver.core.RucCore;
import org.bukkit.command.Command;
import org.bukkit.command.CommandSender;
import org.bukkit.entity.Player;

/** {@code /가이드} — 가이드 진행 화면 (Phase 11). Shift+F 메뉴에도 있습니다. */
public class GuideCommands {

    private final RucCore plugin;

    public GuideCommands(RucCore plugin) {
        this.plugin = plugin;
    }

    public void register() {
        var command = plugin.getCommand("guide");
        if (command == null) {
            plugin.getLogger().warning("plugin.yml에 'guide' 명령어가 없습니다.");
            return;
        }
        command.setExecutor(this::onCommand);
    }

    private boolean onCommand(CommandSender sender, Command command, String label, String[] args) {
        if (!(sender instanceof Player player)) {
            sender.sendMessage("게임 안에서만 쓸 수 있습니다.");
            return true;
        }
        plugin.getGuide().open(player);
        return true;
    }
}
