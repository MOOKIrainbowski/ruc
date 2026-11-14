package kr.rucserver.rpg;

import kr.rucserver.core.RucCore;
import kr.rucserver.rpg.character.CharService;
import kr.rucserver.rpg.character.CharStore;
import net.kyori.adventure.text.Component;
import net.kyori.adventure.text.format.NamedTextColor;
import org.bukkit.command.Command;
import org.bukkit.command.CommandSender;
import org.bukkit.plugin.java.JavaPlugin;

import java.util.logging.Level;

/**
 * 러크 RPG 마크 서버 (구 국가전 서버). 계획서 docs/10-MC-RPG-PLAN.md · 결정 R1~.
 *
 * 콘텐츠 숫자는 웹 RPG 가 원본(Data), 공식은 여기서 Java 로 옮기고 golden 테스트로 같은지 확인.
 * 화폐 = RucCore Gold, 길드 · 우편 · 칭호 · 스코어보드 = RucCore 그대로.
 */
public final class RucRpg extends JavaPlugin {

    private RucCore core;
    private Data data;
    private CharService chars;

    @Override
    public void onEnable() {
        saveDefaultConfig();
        core = (RucCore) getServer().getPluginManager().getPlugin("RucCore");
        if (core == null || !core.isEnabled()) {
            getLogger().severe("RucCore 가 없습니다. 플러그인을 끕니다.");
            getServer().getPluginManager().disablePlugin(this);
            return;
        }
        try {
            data = Data.load(getClassLoader());
            CharStore store = new CharStore(core.getDatabase());
            store.createSchema();
            chars = new CharService(this, store);
        } catch (Exception e) {
            getLogger().log(Level.SEVERE, "RPG 를 켜지 못했습니다", e);
            getServer().getPluginManager().disablePlugin(this);
            return;
        }
        getServer().getPluginManager().registerEvents(chars, this);
        getLogger().info("러크 RPG 켜짐 — 아이템 " + data.count("items.ITEMS") + " · 스킬 " + data.count("skills.SKILLS")
                + " · 몹 " + data.count("mobs.MOBS"));
    }

    @Override
    public void onDisable() {
        if (chars != null) chars.saveAllNow();
    }

    @Override
    public boolean onCommand(CommandSender sender, Command command, String label, String[] args) {
        if (command.getName().equals("rpgadmin")) {
            if (args.length > 0 && args[0].equalsIgnoreCase("info")) {
                sender.sendMessage(Component.text("러크 RPG " + getPluginMeta().getVersion() + " — 아이템 " + data.count("items.ITEMS")
                        + " · 스킬 " + data.count("skills.SKILLS") + " · 몹 " + data.count("mobs.MOBS"), NamedTextColor.GOLD));
                return true;
            }
            return false;
        }
        if (command.getName().equals("rpgmenu")) {
            sender.sendMessage(Component.text("RPG 메뉴는 준비 중입니다 (M1).", NamedTextColor.GRAY));
            return true;
        }
        return false;
    }

    public RucCore core() { return core; }
    public Data data() { return data; }
    public CharService chars() { return chars; }
}
