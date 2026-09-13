package kr.rucserver.core;

import kr.rucserver.core.command.CoreCommands;
import kr.rucserver.core.listener.MenuListener;
import kr.rucserver.core.listener.PlayerListener;
import kr.rucserver.core.listener.VerificationListener;
import kr.rucserver.core.menu.MenuService;
import kr.rucserver.core.service.BonusRegistry;
import kr.rucserver.core.service.NetworkService;
import kr.rucserver.core.service.EconomyService;
import kr.rucserver.core.service.MessageService;
import kr.rucserver.core.service.PlayerDataService;
import kr.rucserver.core.service.ScoreboardService;
import kr.rucserver.core.service.TpaService;
import kr.rucserver.core.service.VerificationService;
import kr.rucserver.core.service.XpService;
import kr.rucserver.core.storage.Database;
import kr.rucserver.core.storage.PlayerRepository;
import kr.rucserver.core.storage.VerificationRepository;
import org.bukkit.GameRule;
import org.bukkit.World;
import org.bukkit.entity.Player;
import org.bukkit.plugin.java.JavaPlugin;

import java.sql.SQLException;
import java.util.logging.Level;

/**
 * 러크 서버 네트워크 공용 플러그인.
 *
 * 4개 서버(홈/약탈/국가전/평화)가 모두 이 플러그인을 올리고, 같은 DB를 봅니다.
 * 화폐·경험치·평판·길드처럼 서버를 넘나드는 것은 전부 여기가 소유하고,
 * 서버별 규칙은 각 모듈(RucHome, RucRaid, ...)이 이 위에 얹습니다.
 */
public class RucCore extends JavaPlugin {

    private Database database;
    private PlayerDataService playerData;
    private MessageService messages;
    private EconomyService economy;
    private BonusRegistry bonuses;
    private XpService xp;
    private ScoreboardService scoreboards;
    private TpaService tpa;
    private VerificationService verification;
    private NetworkService network;
    private MenuService menus;

    @Override
    public void onEnable() {
        saveDefaultConfig();

        messages = new MessageService(this, getConfig().getString("language.default", "ko"));

        database = new Database(getLogger());
        try {
            database.connect(getConfig().getConfigurationSection("database"), getDataFolder());
        } catch (SQLException e) {
            getLogger().log(Level.SEVERE, "DB 연결에 실패했습니다. 플러그인을 비활성화합니다.", e);
            getServer().getPluginManager().disablePlugin(this);
            return;
        }

        playerData = new PlayerDataService(this, new PlayerRepository(database));
        bonuses = new BonusRegistry();
        economy = new EconomyService(this);
        xp = new XpService(this, messages);
        scoreboards = new ScoreboardService(this, messages, xp);
        tpa = new TpaService(this, messages);
        verification = new VerificationService(this, messages,
                new VerificationRepository(database));

        // 프록시 통신과 메뉴는 4개 서버 공통이라 Core가 소유합니다.
        network = new NetworkService(this);
        network.start();
        menus = new MenuService(this, messages);

        getServer().getPluginManager().registerEvents(new PlayerListener(this), this);
        getServer().getPluginManager().registerEvents(new MenuListener(this), this);
        getServer().getPluginManager().registerEvents(new VerificationListener(this), this);
        new CoreCommands(this, messages).register();

        applyGlobalRules();
        scoreboards.start();
        verification.startPolling();

        // 리로드로 켜진 경우 이미 접속해 있는 사람들 처리
        for (Player player : getServer().getOnlinePlayers()) {
            playerData.loadAsync(player, () -> {
                if (player.isOnline()) scoreboards.attach(player);
            });
        }

        getLogger().info("RucCore 활성화 완료 (server-id: "
                + getConfig().getString("server-id", "unknown") + ")");
    }

    @Override
    public void onDisable() {
        if (scoreboards != null) scoreboards.stop();
        if (verification != null) verification.stop();
        if (network != null) network.stop();

        // 종료 시에는 비동기로 넘기면 스케줄러가 이미 멈춰서 저장이 유실됩니다.
        // 여기서만 동기로 저장합니다.
        if (playerData != null) playerData.saveAllBlocking();

        if (database != null) database.close();
        getLogger().info("RucCore 비활성화");
    }

    /**
     * §2.2 — 플레이어 위치가 경험치바 근처에 표시되지 않게 합니다.
     *
     * 바닐라에서 좌표가 노출되는 경로는 F3 디버그 화면이고, 이를 막는 수단이
     * reducedDebugInfo 게임룰입니다. 여기에 더해 RucCore는 액션바(경험치바 바로 위)에
     * 좌표를 절대 출력하지 않고, 스코어보드에도 좌표 줄을 두지 않습니다.
     */
    // REDUCED_DEBUG_INFO는 Paper에서 deprecated + 제거 예정으로 표시되어 있습니다.
    // 1.21.11에서는 정상 동작하며 대체 API가 아직 안정화되지 않아 그대로 씁니다.
    // Paper가 실제로 제거하면 여기만 고치면 됩니다 (경고를 놓치지 않으려고 명시적으로 억제).
    @SuppressWarnings("removal")
    private void applyGlobalRules() {
        if (!getConfig().getBoolean("hide-coordinates", true)) return;

        for (World world : getServer().getWorlds()) {
            world.setGameRule(GameRule.REDUCED_DEBUG_INFO, true);
        }
        getLogger().info("좌표 표시 억제 적용 (§2.2)");
    }

    public Database getDatabase() { return database; }
    public PlayerDataService getPlayerData() { return playerData; }
    public MessageService getMessages() { return messages; }
    public EconomyService getEconomy() { return economy; }
    public BonusRegistry getBonuses() { return bonuses; }
    public XpService getXp() { return xp; }
    public ScoreboardService getScoreboards() { return scoreboards; }
    public TpaService getTpa() { return tpa; }
    public VerificationService getVerification() { return verification; }
    public NetworkService getNetwork() { return network; }
    public MenuService getMenus() { return menus; }
}
