package kr.rucserver.rpg;

import kr.rucserver.core.RucCore;
import kr.rucserver.rpg.character.CharService;
import kr.rucserver.rpg.character.CharStore;
import kr.rucserver.rpg.character.ElementPicker;
import kr.rucserver.rpg.character.PlayerRuntime;
import kr.rucserver.rpg.engine.Formulas;
import kr.rucserver.rpg.hud.Hud;
import org.bukkit.Bukkit;
import org.bukkit.entity.Player;
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
    private Formulas formulas;
    private PlayerRuntime runtime;
    private SafeZones safeZones;
    private kr.rucserver.rpg.engine.EffectDefs effects;
    private kr.rucserver.rpg.engine.Combat combat;

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
            formulas = new Formulas(data);
            safeZones = new SafeZones(getConfig().getMapList("safe-zones"));
            effects = new kr.rucserver.rpg.engine.EffectDefs(data);
            if (!effects.hasModsData()) getLogger().warning("effects.json 에 mods 가 없음 — 스탯 버프/디버프가 효과 없음 (export-mc.ts 갱신 필요)");
            combat = new kr.rucserver.rpg.engine.Combat(data, formulas, effects);
            runtime = new PlayerRuntime(this, formulas, effects);
            runtime.hud(new Hud());
        } catch (Exception e) {
            getLogger().log(Level.SEVERE, "RPG 를 켜지 못했습니다", e);
            getServer().getPluginManager().disablePlugin(this);
            return;
        }
        ElementPicker picker = new ElementPicker(this);
        chars.onNew(picker::open);
        chars.onLoaded(p -> runtime.attach(p, chars.get(p)));
        getServer().getPluginManager().registerEvents(chars, this);
        getServer().getPluginManager().registerEvents(runtime, this);
        getServer().getPluginManager().registerEvents(picker, this);
        // /reload 등으로 이미 접속한 사람이 있으면 다시 붙임
        for (Player p : Bukkit.getOnlinePlayers()) chars.onJoin(new org.bukkit.event.player.PlayerJoinEvent(p, (net.kyori.adventure.text.Component) null));
        getLogger().info("러크 RPG 켜짐 — 아이템 " + data.count("items.ITEMS") + " · 스킬 " + data.count("skills.SKILLS")
                + " · 몹 " + data.count("mobs.MOBS"));
    }

    @Override
    public void onDisable() {
        if (runtime != null) runtime.writeBackAll();
        if (chars != null) chars.saveAllNow();
    }

    @Override
    public boolean onCommand(CommandSender sender, Command command, String label, String[] args) {
        if (command.getName().equals("rpgadmin")) {
            if (args.length >= 3 && (args[0].equalsIgnoreCase("exp") || args[0].equalsIgnoreCase("level"))) {
                Player t = Bukkit.getPlayerExact(args[1]);
                if (t == null || runtime.unit(t) == null) { sender.sendMessage(Component.text("접속 중인 RPG 캐릭터가 아닙니다: " + args[1], NamedTextColor.RED)); return true; }
                long n;
                try { n = Long.parseLong(args[2]); } catch (NumberFormatException ex) { return false; }
                if (args[0].equalsIgnoreCase("exp")) runtime.gainExp(t, n); else runtime.setLevel(t, (int) n);
                sender.sendMessage(Component.text(t.getName() + " → Lv." + chars.get(t).level + " (" + chars.get(t).exp + " exp)", NamedTextColor.GREEN));
                return true;
            }
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
    public Formulas formulas() { return formulas; }
    public PlayerRuntime runtime() { return runtime; }
    public SafeZones safeZones() { return safeZones; }
    public kr.rucserver.rpg.engine.Combat combat() { return combat; }
}
