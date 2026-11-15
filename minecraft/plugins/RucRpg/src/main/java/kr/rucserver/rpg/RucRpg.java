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
    private kr.rucserver.rpg.model.ModelEngine models;
    private kr.rucserver.rpg.ui.RpgMenus menus;
    private kr.rucserver.rpg.world.RpgWorlds worlds;
    private kr.rucserver.rpg.world.NpcRuntime npcs;
    private kr.rucserver.rpg.item.ItemService items;
    private kr.rucserver.rpg.item.ItemRuntime itemRuntime;
    private kr.rucserver.rpg.ui.EquipMenu equipMenu;
    private kr.rucserver.rpg.econ.Economy economy;
    private kr.rucserver.rpg.econ.EconGui econGui;
    private kr.rucserver.rpg.quest.QuestEngine quests;
    private kr.rucserver.rpg.econ.RewardOutbox outbox;
    private kr.rucserver.rpg.world.Gathering gathering;
    private kr.rucserver.rpg.pet.PetRuntime pets;
    private kr.rucserver.rpg.quest.UserQuests uquests;
    private kr.rucserver.rpg.realm.Realm realm;
    private kr.rucserver.rpg.hud.MinimapHud minimap;
    private kr.rucserver.rpg.ui.Windows windows;
    private kr.rucserver.rpg.client.ClientBridge bridge;
    public kr.rucserver.rpg.client.ClientBridge bridge() { return bridge; }
    private kr.rucserver.rpg.ui.FullMap fullMap;
    public kr.rucserver.rpg.ui.FullMap fullMap() { return fullMap; }
    public kr.rucserver.rpg.ui.Windows windows() { return windows; }
    public kr.rucserver.rpg.realm.Realm realm() { return realm; }
    public kr.rucserver.rpg.quest.UserQuests uquests() { return uquests; }
    public kr.rucserver.rpg.pet.PetRuntime pets() { return pets; }
    private kr.rucserver.rpg.item.ItemGuard itemGuard;
    private kr.rucserver.rpg.party.PartyService parties;
    private kr.rucserver.rpg.party.DuelService duels;
    private kr.rucserver.rpg.party.DungeonService dungeons;
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
            kr.rucserver.rpg.ui.Gui.loadModels(getClassLoader());
            models = new kr.rucserver.rpg.model.ModelEngine(this);
            mobs = new kr.rucserver.rpg.mob.MobRuntime(this, world, combat, new kr.rucserver.rpg.mob.MobDefs(data, formulas), projectiles);
            world.onDamaged = (s, t, a, th, h) -> mobs.damaged(s, t, a, th, h);
            items = new kr.rucserver.rpg.item.ItemService(this);
            kr.rucserver.rpg.item.EquipStore equipStore = new kr.rucserver.rpg.item.EquipStore(core.getDatabase());
            equipStore.createSchema();
            itemRuntime = new kr.rucserver.rpg.item.ItemRuntime(this, items, equipStore);
            world.onStruck = (src, tgt, a, h) -> {
                if (src instanceof kr.rucserver.rpg.character.PlayerUnit ps) itemRuntime.onDealt(ps, tgt, a, h);
                if (tgt instanceof kr.rucserver.rpg.character.PlayerUnit pt) itemRuntime.onTaken(pt, src, a, h);
            };
            skillDefs = new kr.rucserver.rpg.skill.SkillDefs(data, formulas);
            progression = new kr.rucserver.rpg.skill.Progression(data, skillDefs);
            skills = new kr.rucserver.rpg.skill.SkillEngine(this, world, combat, skillDefs, progression, projectiles);
            pets = new kr.rucserver.rpg.pet.PetRuntime(this);
            progression.notify = (u, id, lv, kind) -> {
                String name = skillDefs.get(id).get("name").getAsString();
                String msg = switch (kind) { case "learn" -> "새 스킬: " + name + " (Lv." + lv + ")"; case "grade" -> name + " 등급이 올랐습니다"; default -> name + " Lv." + lv; };
                hud.toast(u.player, msg);
                u.player.sendMessage(Component.text("[스킬] ", NamedTextColor.AQUA).append(Component.text(msg, NamedTextColor.WHITE)));
            };
            world.onKilled = (u, by) -> {
                if (u instanceof kr.rucserver.rpg.mob.MobUnit m) mobs.killed(m, by);
                else if (u instanceof kr.rucserver.rpg.pet.PetRuntime.PetUnit q) pets.unsummon(q);
                else if (u instanceof kr.rucserver.rpg.character.PlayerUnit pu) runtime.killed(pu, by);
            };
            minimap = kr.rucserver.rpg.hud.MinimapHud.load(this);
            if (minimap != null) getServer().getPluginManager().registerEvents(minimap, this);
            Hud glyph = kr.rucserver.rpg.hud.GlyphHud.load(this);
            hud = glyph != null ? glyph : new Hud();
            getLogger().info(glyph != null ? "HUD: 리소스팩 글리프" : "HUD: 글자판 (hud-glyphs.json v2 없음)");
            runtime.hud(hud);
            bridge = new kr.rucserver.rpg.client.ClientBridge(this);
            hud.bridge = bridge;
            getServer().getPluginManager().registerEvents(bridge, this);
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
            if (quests != null) quests.load(p);
            java.util.UUID id = p.getUniqueId();
            getServer().getScheduler().runTaskAsynchronously(this, () -> {
                try { itemRuntime.equip().load(id); } catch (Exception e) { getLogger().warning("장비 불러오기 실패: " + e.getMessage()); }
                getServer().getScheduler().runTask(this, () -> { if (p.isOnline()) { itemRuntime.refresh(p); if (itemGuard != null) itemGuard.scan(p); } });
            });
        });
        getServer().getPluginManager().registerEvents(chars, this);
        getServer().getPluginManager().registerEvents(runtime, this);
        getServer().getPluginManager().registerEvents(picker, this);
        getServer().getPluginManager().registerEvents(mobs, this);
        getServer().getPluginManager().registerEvents(skills, this);
        kr.rucserver.rpg.ui.Gui.loadModels(getClassLoader());
        menus = new kr.rucserver.rpg.ui.RpgMenus(this);
        worlds = new kr.rucserver.rpg.world.RpgWorlds(this);
        safeZones.plaza = worlds::isPlaza;
        npcs = new kr.rucserver.rpg.world.NpcRuntime(this);
        getServer().getPluginManager().registerEvents(worlds, this);
        getServer().getPluginManager().registerEvents(npcs, this);
        gathering = new kr.rucserver.rpg.world.Gathering(this);
        getServer().getPluginManager().registerEvents(gathering, this);
        // 처음 켤 때 안 지은 맵은 알아서 지음 (운영 서버에서 명령을 칠 필요 없게)
        getServer().getScheduler().runTaskLater(this, () -> {
            for (String k : kr.rucserver.rpg.world.RpgWorlds.KINDS)
                if (!worlds.built(k) || worlds.stale(k)) {
                    getLogger().info("맵 " + k + (worlds.built(k) ? " 이 예전 판이라 다시 짓습니다…" : " 이 없어 짓습니다…"));
                    worlds.build(k, () -> { mobs.refill("rpg_" + k); npcs.spawnAll(); gathering.place(k); getLogger().info("맵 " + k + " 완성"); });
                }
            npcs.spawnAll();
            for (String k : kr.rucserver.rpg.world.RpgWorlds.KINDS) gathering.place(k);
        }, 40L);
        getServer().getPluginManager().registerEvents(new kr.rucserver.rpg.ui.Gui.Events(this), this);
        getServer().getPluginManager().registerEvents(itemRuntime, this);
        equipMenu = new kr.rucserver.rpg.ui.EquipMenu(this);
        try {
            economy = new kr.rucserver.rpg.econ.Economy(this, items, core.getDatabase());
            economy.createSchema();
        } catch (Exception e) { getLogger().log(Level.SEVERE, "경제 테이블 만들기 실패", e); }
        econGui = new kr.rucserver.rpg.econ.EconGui(this, economy, items);
        itemGuard = new kr.rucserver.rpg.item.ItemGuard(this, items, itemRuntime.equip(), core.getDatabase());
        try { itemGuard.createSchema(); } catch (Exception e) { getLogger().log(Level.SEVERE, "UID 원장 만들기 실패", e); }
        getServer().getPluginManager().registerEvents(itemGuard, this);
        parties = new kr.rucserver.rpg.party.PartyService(this);
        duels = new kr.rucserver.rpg.party.DuelService(this);
        dungeons = new kr.rucserver.rpg.party.DungeonService(this);
        outbox = new kr.rucserver.rpg.econ.RewardOutbox(this, core.getDatabase());
        try { outbox.createSchema(); } catch (Exception e) { getLogger().log(Level.SEVERE, "보상 outbox 만들기 실패", e); }
        if (economy != null) getServer().getScheduler().runTaskAsynchronously(this, economy::reportPending);
        quests = new kr.rucserver.rpg.quest.QuestEngine(this, core.getDatabase());
        try { quests.createSchema(); } catch (Exception e) { getLogger().log(Level.SEVERE, "퀘스트 테이블 만들기 실패", e); }
        try { windows = new kr.rucserver.rpg.ui.Windows(this, core.getDatabase()); getServer().getPluginManager().registerEvents(windows, this); }
        catch (Exception e) { getLogger().log(Level.SEVERE, "설정 테이블 만들기 실패", e); }
        fullMap = new kr.rucserver.rpg.ui.FullMap(this);
        getServer().getPluginManager().registerEvents(fullMap, this);
        realm = new kr.rucserver.rpg.realm.Realm(this, core.getDatabase());
        try { realm.start(); } catch (Exception e) { getLogger().log(Level.SEVERE, "영지 테이블 만들기 실패", e); }
        uquests = new kr.rucserver.rpg.quest.UserQuests(this, core.getDatabase());
        try { uquests.createSchema(); } catch (Exception e) { getLogger().log(Level.SEVERE, "유저 퀘스트 테이블 만들기 실패", e); }
        getServer().getPluginManager().registerEvents(uquests, this);
        npcs.talked = (p, id) -> quests.quest(p, "talk", id);
        getServer().getPluginManager().registerEvents(new org.bukkit.event.Listener() {
            @org.bukkit.event.EventHandler
            public void onQuit(org.bukkit.event.player.PlayerQuitEvent e) { quests.forget(e.getPlayer()); dungeons.quit(e.getPlayer().getUniqueId()); }

            @org.bukkit.event.EventHandler
            public void onJoinOutbox(org.bukkit.event.player.PlayerJoinEvent e) {
                java.util.UUID id = e.getPlayer().getUniqueId();
                getServer().getScheduler().runTaskLaterAsynchronously(RucRpg.this, () -> outbox.flush(id), 100L);
            }
        }, this);
        getServer().getPluginManager().registerEvents(econGui, this);
        getServer().getPluginManager().registerEvents(new org.bukkit.event.Listener() {
            /** 광장 시설: 강화대 → 대장간 · 상점 천막 → 일반 상점 · 시장 천막 → 유저 상점(RucCore) · 창고 · 우편함(RucCore) */
            @org.bukkit.event.EventHandler(priority = org.bukkit.event.EventPriority.HIGH)
            public void onUse(org.bukkit.event.player.PlayerInteractEvent e) {
                if (e.getHand() != org.bukkit.inventory.EquipmentSlot.HAND || e.getClickedBlock() == null || e.getAction() != org.bukkit.event.block.Action.RIGHT_CLICK_BLOCK) return;
                String kind = worlds.spotAt(e.getClickedBlock());
                if (kind == null || runtime.unit(e.getPlayer()) == null) return;
                e.setCancelled(true);
                Player p = e.getPlayer();
                switch (kind) {
                    case "anvil" -> econGui.smith(p);
                    case "tent_shop" -> econGui.shop(p);
                    case "tent_market" -> core.getShop().open(p, 0, false);
                    case "storage" -> econGui.storage(p);
                    case "mailbox" -> { core.getMailbox().open(p, 0); quests.quest(p, "claim", null); }
                    case "workbench" -> econGui.brew(p);
                    default -> {}
                }
            }
        }, this);
        // /reload 등으로 이미 접속한 사람이 있으면 다시 붙임
        for (Player p : Bukkit.getOnlinePlayers()) chars.onJoin(new org.bukkit.event.player.PlayerJoinEvent(p, (net.kyori.adventure.text.Component) null));
        getLogger().info("러크 RPG 켜짐 — 아이템 " + data.count("items.ITEMS") + " · 스킬 " + data.count("skills.SKILLS")
                + " · 몹 " + data.count("mobs.MOBS"));
    }

    @Override
    public void onDisable() {
        if (mobs != null) mobs.despawnAll();
        if (pets != null) pets.removeAll();
        if (runtime != null) runtime.writeBackAll();
        if (chars != null) chars.saveAllNow();
        if (realm != null) WRITER.execute(realm::flush);   // 30초 버퍼에 남은 영향력 · 길드 경험치 (Codex 리뷰 6)
        WRITER.shutdown();   // 줄 선 저장(퀘스트 · 장비 · 창고 · 캐릭터)을 다 쓰고 끔 — 비동기 작업은 끌 때 버려지므로
        try { if (!WRITER.awaitTermination(15, java.util.concurrent.TimeUnit.SECONDS)) getLogger().severe("저장 줄이 15초 안에 안 끝남 — 일부 저장이 빠졌을 수 있음"); } catch (InterruptedException ignored) { Thread.currentThread().interrupt(); }
    }

    /** RPG DB 쓰기는 모두 이 한 줄 스레드로 (순서 보장 · 끌 때 비우기). 읽기는 아무 스레드나 */
    public static final java.util.concurrent.ExecutorService WRITER = java.util.concurrent.Executors.newSingleThreadExecutor(r -> { Thread t = new Thread(r, "RucRpg-writer"); t.setDaemon(true); return t; });

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
            if (args.length >= 3 && args[0].equalsIgnoreCase("give")) {
                Player t = Bukkit.getPlayerExact(args[1]);
                if (t == null || items.tpl(args[2]) == null) { sender.sendMessage(Component.text("사람 또는 아이템이 없습니다", NamedTextColor.RED)); return true; }
                int qty = args.length >= 4 ? Integer.parseInt(args[3]) : 1;
                String rar = args.length >= 5 ? args[4] : "common";
                if (kr.rucserver.rpg.item.ItemService.stackable(items.tpl(args[2]))) itemRuntime.give(t, items.create(args[2], rar, qty));
                else for (int i = 0; i < Math.min(qty, 36); i++) itemRuntime.give(t, items.create(args[2], rar, 1));
                sender.sendMessage(Component.text(t.getName() + " ← " + args[2] + " ×" + qty + " " + rar, NamedTextColor.GREEN));
                return true;
            }
            if (args.length >= 2 && args[0].equalsIgnoreCase("pet") && sender instanceof Player p && runtime.unit(p) != null) {   // 소환수 시험 · GM
                com.google.gson.JsonObject s = new com.google.gson.JsonObject();
                s.addProperty("pet", args[1]); s.addProperty("ms", 30000); s.addProperty("max", 3);
                pets.summon(runtime.unit(p), s);
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
            if (args.length >= 2 && args[0].equalsIgnoreCase("build")) {
                String k = args[1];
                long t0 = System.currentTimeMillis();
                boolean ok = worlds.build(k, () -> {
                    mobs.refill("rpg_" + k);
                    npcs.spawnAll();
                    gathering.place(k);
                    sender.sendMessage(Component.text("맵 " + k + " 완성 (" + (System.currentTimeMillis() - t0) / 1000.0 + "초)", NamedTextColor.GREEN));
                });
                sender.sendMessage(Component.text(ok ? "맵 " + k + " 짓는 중…" : "없는 맵: " + k, ok ? NamedTextColor.YELLOW : NamedTextColor.RED));
                return true;
            }
            if (args.length >= 2 && args[0].equalsIgnoreCase("goto") && sender instanceof Player p) {
                worlds.go(p, args[1], 0, 0);
                return true;
            }
            if (args.length > 0 && args[0].equalsIgnoreCase("info")) {
                sender.sendMessage(Component.text("러크 RPG " + getPluginMeta().getVersion() + " — 아이템 " + data.count("items.ITEMS")
                        + " · 스킬 " + data.count("skills.SKILLS") + " · 몹 " + data.count("mobs.MOBS") + " · 지금 몹 " + mobs.count()
                        + " · 맵 " + String.join(",", kr.rucserver.rpg.world.RpgWorlds.KINDS.stream().filter(worlds::built).toList()), NamedTextColor.GOLD));
                return true;
            }
            return false;
        }
        if (sender instanceof Player p && runtime.unit(p) != null) {
            switch (command.getName()) {
                case "rpgmenu" -> menus.main(p);
                case "rpgskill" -> menus.skills(p);
                case "rpgstats" -> menus.stats(p);
                case "rpgjob" -> menus.job(p);
                case "rpgrealm" -> realm.open(p);
                case "rpgsettings" -> windows.settings(p);
                case "rpgmap" -> fullMap.toggle(p);
                case "rpggm" -> windows.gm(p);
                case "rpgnation" -> { String err = realm.command(p, args); if (err != null) p.sendMessage(Component.text(err, NamedTextColor.RED)); }
                case "rpgnc" -> { String err = args.length == 0 ? "/ㄴ <말>" : realm.chat(p, String.join(" ", args)); if (err != null) p.sendMessage(Component.text(err, NamedTextColor.RED)); }
                case "rpgquest" -> { if (args.length > 0 && args[0].equals("게시판")) uquests.board(p); else quests.journal(p); }
                case "rpgparty" -> partyCmd(p, args);
                case "rpgpc" -> parties.chat(p, String.join(" ", args));
                case "rpgping" -> parties.ping(p, args.length > 0 ? args[0] : "gather");
                case "rpgduel" -> { if (args.length > 0 && args[0].equals("수락")) duels.accept(p); else if (args.length > 0) duels.ask(p, Bukkit.getPlayerExact(args[0])); else return false; }
                case "rpgdungeon" -> { if (args.length > 0 && args[0].equals("나가기")) dungeons.left(p); else if (args.length > 0 && args[0].equals("skip") && p.hasPermission("rucrpg.admin")) dungeons.skip(p); else dungeons.enter(p); }
                default -> { return false; }
            }
            return true;
        }
        if (sender instanceof Player) { sender.sendMessage(Component.text("캐릭터를 불러오는 중입니다.", NamedTextColor.GRAY)); return true; }
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
    public kr.rucserver.rpg.model.ModelEngine models() { return models; }
    public kr.rucserver.rpg.item.ItemService items() { return items; }
    public kr.rucserver.rpg.item.ItemRuntime itemRuntime() { return itemRuntime; }
    public kr.rucserver.rpg.ui.RpgMenus menus() { return menus; }
    public kr.rucserver.rpg.world.RpgWorlds worlds() { return worlds; }
    public kr.rucserver.rpg.world.NpcRuntime npcs() { return npcs; }
    public kr.rucserver.rpg.ui.EquipMenu equipMenu() { return equipMenu; }
    public kr.rucserver.rpg.econ.Economy economy() { return economy; }
    public kr.rucserver.rpg.econ.EconGui econGui() { return econGui; }
    public kr.rucserver.rpg.quest.QuestEngine quests() { return quests; }
    public kr.rucserver.rpg.econ.RewardOutbox outbox() { return outbox; }

    private void partyCmd(Player p, String[] a) {
        String sub = a.length > 0 ? a[0] : "";
        String arg = a.length > 1 ? a[1] : null;
        switch (sub) {
            case "초대", "invite" -> parties.invite(p, arg == null ? null : Bukkit.getPlayerExact(arg));
            case "수락", "accept" -> parties.accept(p);
            case "거절", "decline" -> parties.decline(p);
            case "나가기", "leave" -> parties.leave(p);
            case "추방", "kick" -> { if (arg != null) parties.kick(p, arg); }
            case "위임", "promote" -> { if (arg != null) parties.promote(p, arg); }
            case "해산", "disband" -> parties.disband(p);
            case "" -> windows.party(p);
            default -> {
                p.sendMessage(Component.text("/파티 초대·수락·거절·나가기·추방·위임·해산 · /ㅍ <말> 파티 채팅 · /핑 [attack|omw|help|gather|back|enemy|danger] · /결투 <이름> · /던전 입장·나가기", NamedTextColor.GRAY));
            }
        }
    }

    public boolean inParty(Player p) { return parties != null && parties.of(p) != null; }
    public kr.rucserver.rpg.party.PartyService parties() { return parties; }
    public kr.rucserver.rpg.party.DuelService duels() { return duels; }
    public kr.rucserver.rpg.party.DungeonService dungeons() { return dungeons; }
    public kr.rucserver.rpg.skill.SkillEngine skills() { return skills; }
    public kr.rucserver.rpg.skill.Progression progression() { return progression; }

    /** 몹 처치 뒤: 드롭 · 처치 발동 효과 (퀘스트 · 파티 분배는 M6 · M7 에서 여기에) */
    public void mobKilled(kr.rucserver.rpg.mob.MobUnit m, kr.rucserver.rpg.character.PlayerUnit by) {
        itemRuntime.mobDrops(m, by);
        quests.quest(by.player, "kill", m.key);
        itemRuntime.onKill(by);
        realm.kill(m, by);
    }

    /** 광장 부활 · 귀환 위치 (M6 에서 광장을 지으면 config plaza.*) */
    public org.bukkit.Location plazaSpawn(org.bukkit.World w) {
        String world = getConfig().getString("plaza.world", null);
        org.bukkit.World pw = world == null ? null : getServer().getWorld(world);
        if (pw != null) return new org.bukkit.Location(pw, getConfig().getDouble("plaza.x"), getConfig().getDouble("plaza.y"), getConfig().getDouble("plaza.z"));
        org.bukkit.Location s = worlds == null ? null : worlds.spawn("plaza");
        return s != null ? s : w.getSpawnLocation();
    }

    /** 첫 캐릭터: 기본 장비 · 포션 · 음식 */
    public void starterKit(Player p) {
        for (String[] k : new String[][]{{"wood_sword", "1"}, {"apprentice_staff", "1"}, {"leather_vest", "1"}, {"hp_potion_s", "5"}, {"mp_potion_s", "3"}, {"meadow_bread", "3"}})
            if (items.tpl(k[0]) != null) itemRuntime.give(p, items.create(k[0], "common", Integer.parseInt(k[1])));
    }
}
