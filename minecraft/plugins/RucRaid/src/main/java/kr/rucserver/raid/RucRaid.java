package kr.rucserver.raid;

import kr.rucserver.core.RucCore;
import kr.rucserver.raid.command.RaidCommands;
import kr.rucserver.raid.listener.CombatListener;
import kr.rucserver.raid.listener.DragonEggListener;
import kr.rucserver.raid.listener.RaidListener;
import kr.rucserver.raid.service.CombatTagService;
import kr.rucserver.raid.service.DragonEggService;
import kr.rucserver.raid.service.ExecutionService;
import kr.rucserver.raid.service.HomeService;
import kr.rucserver.raid.service.RaidMessages;
import kr.rucserver.raid.storage.RaidRepository;
import org.bukkit.Difficulty;
import org.bukkit.GameRule;
import org.bukkit.Location;
import org.bukkit.World;
import org.bukkit.plugin.java.JavaPlugin;

import java.sql.SQLException;
import java.util.List;
import java.util.logging.Level;

/**
 * 약탈 서버 모듈 (§2.4).
 *
 * 이 서버의 정체성은 <b>전투 로그 처형</b> 하나입니다. 불리하면 끊는 것이
 * 최적해가 되는 순간 PvP 서버는 성립하지 않습니다. 나머지 기능(/home, 드래곤 알)은
 * 그 규칙이 실제로 작동하도록 주변을 막아 주는 장치입니다.
 */
public class RucRaid extends JavaPlugin {

    private RucCore core;
    private RaidMessages messages;
    private RaidRepository repository;

    private CombatTagService combatTags;
    private ExecutionService executions;
    private HomeService homes;
    private DragonEggService eggs;

    private List<String> raidWorlds;

    @Override
    public void onEnable() {
        saveDefaultConfig();

        core = (RucCore) getServer().getPluginManager().getPlugin("RucCore");
        if (core == null || !core.isEnabled()) {
            getLogger().severe("RucCore 가 없습니다. 플러그인을 비활성화합니다.");
            getServer().getPluginManager().disablePlugin(this);
            return;
        }

        messages = new RaidMessages(this, core,
                core.getConfig().getString("language.default", "ko"));

        String serverId = core.getConfig().getString("server-id", "raid");
        repository = new RaidRepository(core.getDatabase());
        try {
            repository.createSchema();
        } catch (SQLException e) {
            getLogger().log(Level.SEVERE, "약탈 서버 테이블 생성 실패. 비활성화합니다.", e);
            getServer().getPluginManager().disablePlugin(this);
            return;
        }

        raidWorlds = getConfig().getStringList("worlds");
        if (raidWorlds.isEmpty()) raidWorlds = List.of("world", "world_nether", "world_the_end");

        combatTags = new CombatTagService(this);
        executions = new ExecutionService(this, repository, serverId);
        homes = new HomeService(this, repository, serverId);
        eggs = new DragonEggService(this, repository, serverId);

        getServer().getPluginManager().registerEvents(new CombatListener(this), this);
        getServer().getPluginManager().registerEvents(new RaidListener(this), this);
        getServer().getPluginManager().registerEvents(new DragonEggListener(this), this);
        new RaidCommands(this).register();

        applyWorldRules();
        combatTags.start();
        eggs.start();

        // 리로드로 켜진 경우, 이미 접속해 있는 사람의 처형 기록도 확인합니다.
        for (var player : getServer().getOnlinePlayers()) {
            executions.checkOnJoin(player);
        }

        getLogger().info("RucRaid 활성화 완료 (전투 태그 "
                + getConfig().getInt("combat.tag-seconds", 15) + "초)");
    }

    @Override
    public void onDisable() {
        if (combatTags != null) combatTags.stop();
        if (homes != null) homes.stop();
        if (eggs != null) eggs.stop();
        getLogger().info("RucRaid 비활성화");
    }

    /**
     * 약탈 서버 규칙.
     *
     * keepInventory 는 반드시 꺼져 있어야 합니다 — 약탈 서버에서 죽어도 짐을
     * 지킨다면 §2.4 의 처벌도, 약탈이라는 콘텐츠 자체도 의미가 없습니다.
     */
    @SuppressWarnings("removal")
    private void applyWorldRules() {
        for (String name : raidWorlds) {
            World world = getServer().getWorld(name);
            if (world == null) continue;

            world.setPVP(true);
            world.setDifficulty(Difficulty.HARD);
            world.setGameRule(GameRule.KEEP_INVENTORY, false);
            world.setGameRule(GameRule.NATURAL_REGENERATION,
                    getConfig().getBoolean("natural-regeneration", false));
            world.setGameRule(GameRule.SHOW_DEATH_MESSAGES, true);
            world.setGameRule(GameRule.ANNOUNCE_ADVANCEMENTS, false);
        }
        getLogger().info("약탈 월드 규칙 적용: " + String.join(", ", raidWorlds));
    }

    public boolean isRaidWorld(World world) {
        return world != null && raidWorlds.contains(world.getName());
    }

    /** /spawn 목적지. 설정에 좌표가 없으면 주 월드의 스폰을 씁니다. */
    public Location raidSpawn() {
        String worldName = getConfig().getString("spawn.world", raidWorlds.get(0));
        World world = getServer().getWorld(worldName);
        if (world == null) world = getServer().getWorlds().get(0);

        if (!getConfig().getBoolean("spawn.use-custom", false)) {
            return world.getSpawnLocation();
        }
        return new Location(world,
                getConfig().getDouble("spawn.x", 0.5),
                getConfig().getDouble("spawn.y", 80),
                getConfig().getDouble("spawn.z", 0.5),
                (float) getConfig().getDouble("spawn.yaw", 0),
                (float) getConfig().getDouble("spawn.pitch", 0));
    }

    public RucCore core() { return core; }
    public RaidMessages msg() { return messages; }
    public CombatTagService getCombatTags() { return combatTags; }
    public ExecutionService getExecutions() { return executions; }
    public HomeService getHomes() { return homes; }
    public DragonEggService getEggs() { return eggs; }
}
