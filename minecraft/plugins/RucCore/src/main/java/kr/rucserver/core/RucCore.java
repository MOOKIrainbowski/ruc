package kr.rucserver.core;

import kr.rucserver.core.command.CoreCommands;
import kr.rucserver.core.command.GuildAdminCommands;
import kr.rucserver.core.command.EnderCommands;
import kr.rucserver.core.command.GuildCommands;
import kr.rucserver.core.command.PaymentCommands;
import kr.rucserver.core.command.ShopCommands;
import kr.rucserver.core.command.ReportCommands;
import kr.rucserver.core.command.SanctionCommands;
import kr.rucserver.core.command.TitleCommands;
import kr.rucserver.core.listener.ChatListener;
import kr.rucserver.core.listener.MenuListener;
import kr.rucserver.core.listener.PlayerListener;
import kr.rucserver.core.listener.VerificationListener;
import kr.rucserver.core.menu.MenuService;
import kr.rucserver.core.service.BonusRegistry;
import kr.rucserver.core.service.DiscordRelayService;
import kr.rucserver.core.service.NetworkService;
import kr.rucserver.core.service.EconomyService;
import kr.rucserver.core.service.GuildService;
import kr.rucserver.core.service.MailboxService;
import kr.rucserver.core.service.MessageService;
import kr.rucserver.core.service.EnderService;
import kr.rucserver.core.service.PaymentService;
import kr.rucserver.core.service.PlayerDataService;
import kr.rucserver.core.service.ReportService;
import kr.rucserver.core.service.SanctionService;
import kr.rucserver.core.service.ScoreboardService;
import kr.rucserver.core.service.ShopService;
import kr.rucserver.core.service.TitleService;
import kr.rucserver.core.service.TpaService;
import kr.rucserver.core.service.VerificationService;
import kr.rucserver.core.service.XpService;
import kr.rucserver.core.storage.Database;
import kr.rucserver.core.storage.GuildRepository;
import kr.rucserver.core.storage.HomeRepository;
import kr.rucserver.core.storage.MailboxRepository;
import kr.rucserver.core.storage.EnderRepository;
import kr.rucserver.core.storage.PaymentRepository;
import kr.rucserver.core.storage.PlayerRepository;
import kr.rucserver.core.storage.ReportRepository;
import kr.rucserver.core.storage.SanctionRepository;
import kr.rucserver.core.storage.ShopRepository;
import kr.rucserver.core.storage.TitleRepository;
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
    private GuildService guilds;
    private HomeRepository homes;
    private MailboxService mailbox;
    private TitleService titles;
    private DiscordRelayService relay;
    private ReportService reports;
    private SanctionService sanctions;
    private PaymentService payments;
    private EnderService ender;
    private ShopService shop;
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

        // 길드는 네트워크 전역(§3.5)이라 Core가 소유합니다. 스키마 생성이 실패하면
        // 국가전 서버의 입장 판정까지 무너지므로 기동을 멈춥니다.
        GuildRepository guildRepository = new GuildRepository(database);
        try {
            guildRepository.createSchema();
        } catch (SQLException e) {
            getLogger().log(Level.SEVERE, "길드 테이블 생성에 실패했습니다. 플러그인을 비활성화합니다.", e);
            getServer().getPluginManager().disablePlugin(this);
            return;
        }
        guilds = new GuildService(this, messages, guildRepository);

        // ruc_home 은 약탈·평화 두 서버가 같이 씁니다(§3.3). 테이블 주인을
        // 한쪽 모듈에 두면 컬럼을 고칠 때 어느 쪽인지 알 수 없게 됩니다.
        homes = new HomeRepository(database);
        try {
            homes.createSchema();
        } catch (SQLException e) {
            getLogger().log(Level.SEVERE, "홈 테이블 생성에 실패했습니다. 플러그인을 비활성화합니다.", e);
            getServer().getPluginManager().disablePlugin(this);
            return;
        }

        // 우편함은 네트워크 전역입니다(Phase 5.5). 홈에서 받은 보상을 약탈에서
        // 꺼내야 하고, 유저 상점(Phase 10)의 구매품은 접속 위치와 무관하게
        // 도착해야 합니다. 여기가 실패하면 보상 지급 경로가 통째로 사라지므로
        // 길드·홈과 같은 기준으로 기동을 멈춥니다.
        MailboxRepository mailRepository = new MailboxRepository(database);
        try {
            mailRepository.createSchema();
        } catch (SQLException e) {
            getLogger().log(Level.SEVERE, "우편 테이블 생성에 실패했습니다. 플러그인을 비활성화합니다.", e);
            getServer().getPluginManager().disablePlugin(this);
            return;
        }
        mailbox = new MailboxService(this, messages, mailRepository);

        // 칭호도 네트워크 전역입니다(Phase 6). 디스코드 역할이 출처라
        // 서버마다 다른 칭호가 나오면 안 됩니다. 봇의 RCON 은 한 서버로만
        // 들어오고, 나머지 서버는 주기 갱신으로 따라잡습니다.
        TitleRepository titleRepository = new TitleRepository(database);
        try {
            titleRepository.createSchema();
        } catch (SQLException e) {
            getLogger().log(Level.SEVERE, "칭호 테이블 생성에 실패했습니다. 플러그인을 비활성화합니다.", e);
            getServer().getPluginManager().disablePlugin(this);
            return;
        }
        titles = new TitleService(this, titleRepository);

        // 디스코드 중계 (Phase 6-3). 웹훅 URL 이 곧 채널이라 서버별 채널
        // 매핑은 각 서버 config.yml 의 webhook-url 하나로 끝납니다.
        relay = new DiscordRelayService(this);

        // 신고 (Phase 6-5). 평판 하락의 입력이라 기록이 없으면 안 됩니다.
        ReportRepository reportRepository = new ReportRepository(database);
        try {
            reportRepository.createSchema();
        } catch (SQLException e) {
            getLogger().log(Level.SEVERE, "신고 테이블 생성에 실패했습니다. 플러그인을 비활성화합니다.", e);
            getServer().getPluginManager().disablePlugin(this);
            return;
        }
        reports = new ReportService(this, reportRepository);

        // 제재 (Phase 6-7). 이 테이블이 곧 네트워크 밴입니다 — 프록시가 로그인 때
        // 봅니다. 없으면 제재가 기록되지 않으므로 기동을 멈춥니다.
        SanctionRepository sanctionRepository = new SanctionRepository(database);
        try {
            sanctionRepository.createSchema();
        } catch (SQLException e) {
            getLogger().log(Level.SEVERE, "제재 테이블 생성에 실패했습니다. 플러그인을 비활성화합니다.", e);
            getServer().getPluginManager().disablePlugin(this);
            return;
        }
        sanctions = new SanctionService(this, sanctionRepository);

        // 현금 충전 (docs/payment-design.md). 돈 기록이라 테이블이 없으면 기동을 멈춥니다 —
        // 봇이 주문을 못 만드는 것보다, 입금을 받고도 기록을 못 남기는 쪽이 훨씬 나쁩니다.
        PaymentRepository paymentRepository = new PaymentRepository(database);
        try {
            paymentRepository.createSchema();
        } catch (SQLException e) {
            getLogger().log(Level.SEVERE, "충전 테이블 생성에 실패했습니다. 플러그인을 비활성화합니다.", e);
            getServer().getPluginManager().disablePlugin(this);
            return;
        }
        payments = new PaymentService(this, paymentRepository);

        // 엔더상자 확장 (2026-10-02). 페이지 수는 위 충전 원장을 봅니다.
        EnderRepository enderRepository = new EnderRepository(database);
        try {
            enderRepository.createSchema();
        } catch (SQLException e) {
            getLogger().log(Level.SEVERE, "엔더 확장 테이블 생성에 실패했습니다. 플러그인을 비활성화합니다.", e);
            getServer().getPluginManager().disablePlugin(this);
            return;
        }
        ender = new EnderService(this, messages, enderRepository);

        // 유저 상점 (Phase 10). 매물 · 대금 기록이라 테이블이 없으면 기동을 멈춥니다.
        ShopRepository shopRepository = new ShopRepository(database);
        try {
            shopRepository.createSchema();
        } catch (SQLException e) {
            getLogger().log(Level.SEVERE, "상점 테이블 생성에 실패했습니다. 플러그인을 비활성화합니다.", e);
            getServer().getPluginManager().disablePlugin(this);
            return;
        }
        shop = new ShopService(this, messages, shopRepository);

        // 프록시 통신과 메뉴는 4개 서버 공통이라 Core가 소유합니다.
        network = new NetworkService(this);
        network.start();
        menus = new MenuService(this, messages);

        getServer().getPluginManager().registerEvents(new PlayerListener(this), this);
        getServer().getPluginManager().registerEvents(new MenuListener(this), this);
        getServer().getPluginManager().registerEvents(new VerificationListener(this), this);
        getServer().getPluginManager().registerEvents(new ChatListener(this), this);
        new CoreCommands(this, messages).register();
        new GuildCommands(this, messages).register();
        new GuildAdminCommands(this).register();
        new TitleCommands(this, messages).register();
        new ReportCommands(this, messages).register();
        new SanctionCommands(this).register();
        new PaymentCommands(this, messages).register();
        new EnderCommands(this).register();
        new ShopCommands(this).register();
        getServer().getPluginManager().registerEvents(ender, this);

        applyGlobalRules();
        scoreboards.start();
        verification.startPolling();
        guilds.start();
        mailbox.start();
        titles.start();
        relay.start();
        payments.start();
        shop.start();

        // 리로드로 켜진 경우 이미 접속해 있는 사람들 처리
        for (Player player : getServer().getOnlinePlayers()) {
            playerData.loadAsync(player, () -> {
                if (!player.isOnline()) return;
                scoreboards.attach(player);
                guilds.onJoin(player);
                mailbox.notifyUnclaimed(player);
                titles.loadAsync(player);
            });
        }

        getLogger().info("RucCore 활성화 완료 (server-id: "
                + getConfig().getString("server-id", "unknown") + ")");
    }

    @Override
    public void onDisable() {
        if (scoreboards != null) scoreboards.stop();
        if (verification != null) verification.stop();
        if (guilds != null) guilds.stop();
        if (mailbox != null) mailbox.stop();
        if (titles != null) titles.stop();
        if (relay != null) relay.stop();
        if (payments != null) payments.stop();
        // DB 를 닫기 전에 — 열린 확장 페이지와 저장 큐를 끝까지 씁니다.
        if (ender != null) ender.stop();
        if (shop != null) shop.stop();
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
    public GuildService getGuilds() { return guilds; }
    public HomeRepository getHomeRepository() { return homes; }
    public MailboxService getMailbox() { return mailbox; }
    public TitleService getTitles() { return titles; }
    public DiscordRelayService getRelay() { return relay; }
    public ReportService getReports() { return reports; }
    public SanctionService getSanctions() { return sanctions; }
    public PaymentService getPayments() { return payments; }
    public EnderService getEnder() { return ender; }
    public ShopService getShop() { return shop; }
    public BonusRegistry getBonuses() { return bonuses; }
    public XpService getXp() { return xp; }
    public ScoreboardService getScoreboards() { return scoreboards; }
    public TpaService getTpa() { return tpa; }
    public VerificationService getVerification() { return verification; }
    public NetworkService getNetwork() { return network; }
    public MenuService getMenus() { return menus; }
}
