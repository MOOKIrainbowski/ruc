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
    private kr.rucserver.rpg.world.RpgWorld world;
    private kr.rucserver.rpg.world.Projectiles projectiles;
    private kr.rucserver.rpg.mob.MobRuntime mobs;
    private Hud hud;
    private kr.rucserver.rpg.item.ItemService items;
    private kr.rucserver.rpg.skill.SkillDefs skillDefs;
    private kr.rucserver.rpg.skill.Progression progression;
    private kr.rucserver.rpg.skill.SkillEngine skills;

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
            world = new kr.rucserver.rpg.world.RpgWorld(this);
            projectiles = new kr.rucserver.rpg.world.Projectiles(this, world, combat);
            mobs = new kr.rucserver.rpg.mob.MobRuntime(this, world, combat, new kr.rucserver.rpg.mob.MobDefs(data, formulas), projectiles);
            world.onDamaged = (s, t, a, th, h) -> mobs.damaged(s, t, a, th);
            items = new kr.rucserver.rpg.item.ItemService();
            skillDefs = new kr.rucserver.rpg.skill.SkillDefs(data, formulas);
            progression = new kr.rucserver.rpg.skill.Progression(data, skillDefs);
            skills = new kr.rucserver.rpg.skill.SkillEngine(this, world, combat, skillDefs, progression, projectiles);
            progression.notify = (u, id, lv, kind) -> {
                String name = skillDefs.get(id).get("name").getAsString();
                String msg = switch (kind) { case "learn" -> "새 스킬: " + name + " (Lv." + lv + ")"; case "grade" -> name + " 등급이 올랐습니다"; default -> name + " Lv." + lv; };
                hud.toast(u.player, msg);
                u.player.sendMessage(Component.text("[스킬] ", NamedTextColor.AQUA).append(Component.text(msg, NamedTextColor.WHITE)));
            };
            world.onKilled = (u, by) -> {
                if (u instanceof kr.rucserver.rpg.mob.MobUnit m) mobs.killed(m, by);
                else if (u instanceof kr.rucserver.rpg.character.PlayerUnit pu) runtime.killed(pu, by);
            };
            hud = new Hud();
            runtime.hud(hud);
        } catch (Exception e) {
            getLogger().log(Level.SEVERE, "RPG 를 켜지 못했습니다", e);
            getServer().getPluginManager().disablePlugin(this);
            return;
        }
        ElementPicker picker = new ElementPicker(this);
        chars.onNew(picker::open);
        chars.onLoaded(p -> {
            runtime.attach(p, chars.get(p));
            progression.sync(runtime.unit(p));   // 견습 스킬 · 레벨 따라 자동 습득
        });
        getServer().getPluginManager().registerEvents(chars, this);
        getServer().getPluginManager().registerEvents(runtime, this);
        getServer().getPluginManager().registerEvents(picker, this);
        getServer().getPluginManager().registerEvents(mobs, this);
        getServer().getPluginManager().registerEvents(skills, this);
        // /reload 등으로 이미 접속한 사람이 있으면 다시 붙임
        for (Player p : Bukkit.getOnlinePlayers()) chars.onJoin(new org.bukkit.event.player.PlayerJoinEvent(p, (net.kyori.adventure.text.Component) null));
        getLogger().info("러크 RPG 켜짐 — 아이템 " + data.count("items.ITEMS") + " · 스킬 " + data.count("skills.SKILLS")
                + " · 몹 " + data.count("mobs.MOBS"));
    }

    @Override
    public void onDisable() {
        if (mobs != null) mobs.despawnAll();
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
            if (args.length >= 2 && args[0].equalsIgnoreCase("spawn") && sender instanceof Player p) {
                int lv = args.length >= 3 ? Integer.parseInt(args[2]) : 1;
                String grade = args.length >= 4 ? args[3] : "normal";
                int n = args.length >= 5 ? Integer.parseInt(args[4]) : 1;
                int ok = 0;
                for (int i = 0; i < n; i++) if (mobs.spawnAt(p, args[1], lv, grade) != null) ok++;
                sender.sendMessage(Component.text(args[1] + " Lv." + lv + " " + grade + " × " + ok, ok > 0 ? NamedTextColor.GREEN : NamedTextColor.RED));
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
    public kr.rucserver.rpg.world.RpgWorld world() { return world; }
    public kr.rucserver.rpg.world.Projectiles projectiles() { return projectiles; }
    public kr.rucserver.rpg.mob.MobRuntime mobs() { return mobs; }
    public Hud hud() { return hud; }
    public kr.rucserver.rpg.item.ItemService items() { return items; }
    public kr.rucserver.rpg.skill.SkillEngine skills() { return skills; }
    public kr.rucserver.rpg.skill.Progression progression() { return progression; }

    /** 몹 처치 뒤 (드롭 · 퀘스트 · 파티 분배가 M4 · M6 · M7 에서 여기에 붙음) */
    public void mobKilled(kr.rucserver.rpg.mob.MobUnit m, kr.rucserver.rpg.character.PlayerUnit by) {}
}
