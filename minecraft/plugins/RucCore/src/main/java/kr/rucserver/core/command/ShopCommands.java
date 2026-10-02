package kr.rucserver.core.command;

import kr.rucserver.core.RucCore;
import org.bukkit.command.Command;
import org.bukkit.command.CommandSender;
import org.bukkit.entity.Player;

/**
 * 유저 상점 명령 (Phase 10).
 * <pre>
 * /유저상점                    상점 열기 (Shift+F 메뉴에도 있습니다)
 * /판매등록 &lt;가격&gt;            손에 든 아이템을 그 가격에 올리기
 * /판매등록 취소               내 판매 목록 (더블클릭 = 등록 취소, 물건은 우편으로 돌아옴)
 * </pre>
 * 가격은 {@code 1,000} · {@code 1000} 둘 다 받습니다.
 */
public class ShopCommands {

    private final RucCore plugin;

    public ShopCommands(RucCore plugin) {
        this.plugin = plugin;
    }

    public void register() {
        var open = plugin.getCommand("usershop");
        var sell = plugin.getCommand("shopsell");
        if (open == null || sell == null) {
            plugin.getLogger().warning("plugin.yml에 'usershop' 또는 'shopsell' 명령어가 없습니다.");
            return;
        }
        open.setExecutor(this::onOpen);
        sell.setExecutor(this::onSell);
    }

    private boolean onOpen(CommandSender sender, Command command, String label, String[] args) {
        if (!(sender instanceof Player player)) {
            sender.sendMessage("게임 안에서만 쓸 수 있습니다.");
            return true;
        }
        plugin.getShop().open(player, 0, false);
        return true;
    }

    private boolean onSell(CommandSender sender, Command command, String label, String[] args) {
        if (!(sender instanceof Player player)) {
            sender.sendMessage("게임 안에서만 쓸 수 있습니다.");
            return true;
        }
        String lang = plugin.getPlayerData().languageOf(player);
        if (args.length == 0) {
            player.sendMessage(plugin.getMessages().prefixed(lang, "shop.usage"));
            return true;
        }
        if (args[0].equals("취소") || args[0].equalsIgnoreCase("cancel")) {
            plugin.getShop().open(player, 0, true);
            return true;
        }
        long price;
        try {
            price = Long.parseLong(args[0].replace(",", ""));
        } catch (NumberFormatException e) {
            player.sendMessage(plugin.getMessages().prefixed(lang, "shop.usage"));
            return true;
        }
        plugin.getShop().register(player, price);
        return true;
    }
}
