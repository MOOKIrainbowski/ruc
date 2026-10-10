package kr.rucserver.war;

import kr.rucserver.core.RucCore;
import kr.rucserver.war.command.WarCommands;
import kr.rucserver.war.listener.CoreListener;
import kr.rucserver.war.listener.CraftGuardListener;
import kr.rucserver.war.listener.TerritoryListener;
import kr.rucserver.war.listener.WarListener;
import kr.rucserver.war.listener.WarpListener;
import kr.rucserver.war.service.CoreItems;
import kr.rucserver.war.service.CoreWarpService;
import kr.rucserver.war.service.SealMerchantService;
import kr.rucserver.war.service.StorageService;
import kr.rucserver.war.service.TerritoryService;
import kr.rucserver.war.service.WarMessages;
import kr.rucserver.war.service.WarScheduleService;
import kr.rucserver.war.service.RichOrePopulator;
import kr.rucserver.war.service.SupplyCrateService;
import kr.rucserver.war.service.TerritoryWatchService;
import kr.rucserver.war.service.UpgradeService;
import kr.rucserver.war.storage.WarRepository;
import org.bukkit.Difficulty;
import org.bukkit.GameRule;
import org.bukkit.World;
import org.bukkit.plugin.java.JavaPlugin;

import java.sql.SQLException;
import java.util.List;
import java.util.logging.Level;

/**
 * 국가전 서버 모듈 (§2.6).
 *
 * 이 서버의 정체성은 <b>영토</b>입니다. 길드가 국가가 되고, 국가가 코어를 세워
 * 땅을 갖고, 정해진 시간에만 그 땅을 빼앗을 수 있습니다.
 *
 * <h2>시간이 규칙의 중심입니다</h2>
 * 코어 설치, 코어 파괴, 영토 보호 해제가 모두 전쟁 시간대에 묶여 있습니다.
 * 이 중 하나라도 시간대를 무시하면 나머지가 의미를 잃습니다 — 예를 들어 평시에
 * 코어를 부술 수 있으면 아무도 전쟁 시간에 싸우지 않고 새벽에 몰래 부숩니다.
 *
 * <h2>입장 자격은 여기서 보지 않습니다</h2>
 * "국가 소속만 입장" 은 프록시의 RucGate 가 판정합니다. 여기서 또 검사하면
 * 두 곳의 규칙이 어긋날 때 "프록시 통과 후 서버가 킥" 이 되어 원인을 찾기
 * 어려워집니다.
 */
public class RucWar extends JavaPlugin {

    private RucCore core;
    private WarMessages messages;
    private WarRepository repository;

    private CoreItems items;
    private WarScheduleService schedule;
    private TerritoryService territory;
    private StorageService storage;
    private CoreWarpService warps;
    private SealMerchantService seals;
    private UpgradeService upgrades;
    private SupplyCrateService supply;
    private TerritoryWatchService watch;

    private List<String> warWorlds;

    @Override
    public void onEnable() {
        saveDefaultConfig();

        core = (RucCore) getServer().getPluginManager().getPlugin("RucCore");
        if (core == null || !core.isEnabled()) {
            getLogger().severe("RucCore 가 없습니다. 플러그인을 비활성화합니다.");
            getServer().getPluginManager().disablePlugin(this);
            return;
        }

        messages = new WarMessages(this, core,
                core.getConfig().getString("language.default", "ko"));

        repository = new WarRepository(core.getDatabase());
        try {
            repository.createSchema();
        } catch (SQLException e) {
            getLogger().log(Level.SEVERE, "국가전 서버 테이블 생성 실패. 비활성화합니다.", e);
            getServer().getPluginManager().disablePlugin(this);
            return;
        }

        warWorlds = getConfig().getStringList("worlds");
        if (warWorlds.isEmpty()) warWorlds = List.of("world", "world_nether", "world_the_end");

        items = new CoreItems(this);
        schedule = new WarScheduleService(this);
        territory = new TerritoryService(this, repository);
        storage = new StorageService(this);
        warps = new CoreWarpService(this);
        seals = new SealMerchantService(this);
        upgrades = new UpgradeService(this);
        supply = new SupplyCrateService(this);
        watch = new TerritoryWatchService(this);

        TerritoryListener territoryListener = new TerritoryListener(this);
        getServer().getPluginManager().registerEvents(territoryListener, this);
        getServer().getPluginManager().registerEvents(new CoreListener(this), this);
        getServer().getPluginManager().registerEvents(new CraftGuardListener(this), this);
        getServer().getPluginManager().registerEvents(new WarpListener(this), this);
        getServer().getPluginManager().registerEvents(upgrades, this);
        getServer().getPluginManager().registerEvents(supply, this);
        getServer().getPluginManager().registerEvents(
                new WarListener(this, territoryListener), this);

        new WarCommands(this).register();

        applyWorldRules();
        items.registerRecipes();
        territory.start();
        schedule.start();
        storage.start();
        seals.spawn();
        watch.start();

        // 광물이 풍부한 오버월드 — 새로 생성되는 청크부터
        if (getConfig().getBoolean("rich-ores.enabled", true)) {
            RichOrePopulator ores = new RichOrePopulator(getConfig().getConfigurationSection("rich-ores.ores"), getLogger());
            for (World world : getServer().getWorlds()) {
                if (world.getEnvironment() == World.Environment.NORMAL && isWarWorld(world)) world.getPopulators().add(ores);
            }
        }

        getLogger().info("RucWar 활성화 완료 — 전쟁 시간대 " + schedule.describe()
                + ", 거점 " + territory.sites().size() + "곳");
    }

    @Override
    public void onDisable() {
        if (schedule != null) schedule.stop();
        if (warps != null) warps.stop();
        if (watch != null) watch.stop();

        // 창고 저장은 마지막에, 동기로. 비동기로 넘기면 스케줄러가 이미 멈춰서
        // 길드가 모아 둔 자원이 통째로 유실됩니다.
        if (storage != null) storage.stop();

        getLogger().info("RucWar 비활성화");
    }

    /**
     * 국가전 월드 규칙.
     *
     * PvP 는 당연히 켭니다. keepInventory 는 꺼 둡니다 — 전쟁에서 죽어도 짐을
     * 지키면 코어를 지키러 몸으로 막는 것이 무료가 되어 공방이 성립하지 않습니다.
     */
    @SuppressWarnings("removal")
    private void applyWorldRules() {
        for (String name : warWorlds) {
            World world = getServer().getWorld(name);
            if (world == null) continue;

            world.setPVP(true);
            world.setDifficulty(Difficulty.HARD);
            world.setGameRule(GameRule.KEEP_INVENTORY, false);
            world.setGameRule(GameRule.SHOW_DEATH_MESSAGES, true);
            world.setGameRule(GameRule.ANNOUNCE_ADVANCEMENTS, false);

            // 블록 폭발로 영토가 통째로 갈리는 것은 전쟁의 일부입니다. 다만
            // 평시 보호는 TerritoryListener 가 블록 이벤트에서 막습니다.
            world.setGameRule(GameRule.MOB_GRIEFING,
                    getConfig().getBoolean("mob-griefing", false));
        }
        getLogger().info("국가전 월드 규칙 적용: " + String.join(", ", warWorlds));
    }

    public boolean isWarWorld(World world) {
        return world != null && warWorlds.contains(world.getName());
    }

    public RucCore core() { return core; }
    public WarMessages msg() { return messages; }
    public WarRepository getWarRepository() { return repository; }
    public CoreItems getItems() { return items; }
    public WarScheduleService getSchedule() { return schedule; }
    public TerritoryService getTerritory() { return territory; }
    public StorageService getStorage() { return storage; }
    public CoreWarpService getWarps() { return warps; }
    public SealMerchantService getSeals() { return seals; }
    public UpgradeService getUpgrades() { return upgrades; }
    public SupplyCrateService getSupply() { return supply; }
    public TerritoryWatchService getWatch() { return watch; }
}
