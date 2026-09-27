package kr.rucserver.peace;

import kr.rucserver.core.RucCore;
import kr.rucserver.core.service.HomeService;
import kr.rucserver.peace.command.PeaceCommands;
import kr.rucserver.peace.listener.AttributionListener;
import kr.rucserver.peace.listener.PeaceListener;
import kr.rucserver.peace.listener.ProtectionListener;
import kr.rucserver.peace.service.AttributionService;
import kr.rucserver.peace.service.GuardService;
import kr.rucserver.peace.service.IncidentService;
import kr.rucserver.peace.service.PeaceMessages;
import kr.rucserver.peace.storage.PeaceRepository;
import org.bukkit.Difficulty;
import org.bukkit.GameRule;
import org.bukkit.Location;
import org.bukkit.World;
import org.bukkit.entity.Player;
import org.bukkit.plugin.Plugin;
import org.bukkit.plugin.java.JavaPlugin;
import org.bukkit.scheduler.BukkitTask;

import java.sql.SQLException;
import java.util.List;
import java.util.logging.Level;

/**
 * 반생존 · 평화 서버 모듈 (§2.5).
 *
 * <h2>이 서버의 정체성은 "죽일 수 없다" 입니다</h2>
 * 명세는 직접 살해뿐 아니라 <b>간접 살해 전부</b>를 막으라고 합니다 — 엔드
 * 크리스탈, TNT 마인카트, 베드·앵커 폭발, 낙하 유도, 용암 밀치기. 직접 타격만
 * 막으면 이 경로가 통째로 열려서 "평화 서버" 라는 이름만 남습니다.
 *
 * 그래서 구현이 두 층입니다:
 * <ul>
 *   <li>{@link AttributionService} — 바닐라가 알려 주지 않는 가해자를 <b>기록</b>합니다.
 *       크리스탈·마인카트는 설치자를, 베드·앵커는 터뜨린 사람과 위치를,
 *       넉백·낚싯대는 민 사람을 적어 둡니다.</li>
 *   <li>{@link GuardService} — 그 기록으로 <b>판정</b>합니다. 직접 피해는 그냥
 *       막고, 환경 피해는 사람이 원인일 때 치명타만 막습니다.</li>
 * </ul>
 *
 * 막힌 것은 전부 {@link IncidentService} 가 남깁니다 — 막혔다는 것은 누군가
 * 죽이려 했다는 뜻이고, 그것이 Helper 재량 제재의 근거입니다 (§2.5, §3.2).
 */
public class RucPeace extends JavaPlugin {

    private RucCore core;
    private PeaceMessages messages;
    private PeaceRepository repository;

    private AttributionService attribution;
    private GuardService guard;
    private IncidentService incidents;
    private HomeService homes;

    private List<String> peaceWorlds;
    private BukkitTask purgeTask;

    @Override
    public void onEnable() {
        saveDefaultConfig();

        core = (RucCore) getServer().getPluginManager().getPlugin("RucCore");
        if (core == null || !core.isEnabled()) {
            getLogger().severe("RucCore 가 없습니다. 플러그인을 비활성화합니다.");
            getServer().getPluginManager().disablePlugin(this);
            return;
        }

        messages = new PeaceMessages(this, core,
                core.getConfig().getString("language.default", "ko"));

        String serverId = core.getConfig().getString("server-id", "peace");

        repository = new PeaceRepository(core.getDatabase());
        try {
            repository.createSchema();
        } catch (SQLException e) {
            // 기록을 못 해도 보호 자체는 동작해야 하므로 여기서 멈추지 않습니다.
            // 보호가 서버의 존재 이유이고, 기록은 운영 편의입니다.
            getLogger().log(Level.SEVERE,
                    "평화 서버 기록 테이블 생성 실패. 보호는 동작하지만 기록이 남지 않습니다.", e);
        }

        peaceWorlds = getConfig().getStringList("worlds");
        if (peaceWorlds.isEmpty()) peaceWorlds = List.of("world", "world_nether", "world_the_end");

        attribution = new AttributionService(this);
        guard = new GuardService(this, attribution);
        incidents = new IncidentService(this, repository);
        homes = new HomeService(core.getHomeRepository(), serverId, new PeaceHost());

        getServer().getPluginManager().registerEvents(new ProtectionListener(this), this);
        getServer().getPluginManager().registerEvents(new AttributionListener(this), this);
        getServer().getPluginManager().registerEvents(new PeaceListener(this), this);
        new PeaceCommands(this).register();

        applyWorldRules();

        // 장부와 디바운스 기록을 주기적으로 비웁니다. 안 하면 오래 돌아가는
        // 서버에서 조용히 새는 메모리가 됩니다.
        long seconds = getConfig().getLong("attribution.purge-seconds", 60);
        purgeTask = getServer().getScheduler().runTaskTimer(this, () -> {
            attribution.purge();
            incidents.purge();
        }, seconds * 20L, seconds * 20L);

        getLogger().info("RucPeace 활성화 완료 — 살해 차단 적용 ("
                + String.join(", ", peaceWorlds) + ")");
    }

    @Override
    public void onDisable() {
        if (purgeTask != null) purgeTask.cancel();
        if (homes != null) homes.stop();
        getLogger().info("RucPeace 비활성화");
    }

    /**
     * 평화 월드 규칙.
     *
     * {@code setPVP(false)} 로 직접 피해와 <b>그에 딸린 넉백</b>이 함께 사라집니다 —
     * "때려서 벼랑 밖으로 밀기" 의 가장 쉬운 경로가 여기서 닫힙니다. 다만 폭발과
     * 낚싯대·충돌 밀침은 이 설정과 무관하게 통과하므로, 그것들은 리스너가 막습니다.
     * 그래서 설정과 코드 <b>양쪽</b>이 필요합니다.
     *
     * keepInventory 는 켭니다. 죽음이 사람 탓이 아닌 서버에서 짐을 잃게 하면
     * 사고 한 번이 하루를 지웁니다.
     */
    @SuppressWarnings("removal")
    private void applyWorldRules() {
        for (String name : peaceWorlds) {
            World world = getServer().getWorld(name);
            if (world == null) continue;

            world.setPVP(false);
            world.setDifficulty(Difficulty.NORMAL);
            world.setGameRule(GameRule.KEEP_INVENTORY,
                    getConfig().getBoolean("keep-inventory", true));
            world.setGameRule(GameRule.SHOW_DEATH_MESSAGES, true);
            world.setGameRule(GameRule.ANNOUNCE_ADVANCEMENTS, false);

            // 크리퍼·엔더맨이 남의 건축물을 갉아먹는 것을 막습니다. 폭발로 남을
            // 죽이는 것은 리스너가 막지만, 건축 훼손은 그것과 별개입니다.
            world.setGameRule(GameRule.MOB_GRIEFING,
                    getConfig().getBoolean("mob-griefing", false));
        }
        getLogger().info("평화 월드 규칙 적용 (PvP 해제): " + String.join(", ", peaceWorlds));
    }

    public boolean isPeaceWorld(World world) {
        return world != null && peaceWorlds.contains(world.getName());
    }

    /** {@code /spawn} 목적지. 설정에 좌표가 없으면 주 월드의 스폰을 씁니다. */
    public Location peaceSpawn() {
        String worldName = getConfig().getString("spawn.world", peaceWorlds.get(0));
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

    /**
     * Core 의 HomeService 에 평화 서버의 차이만 알려 줍니다.
     *
     * 약탈 서버와 달리 <b>막을 것이 없습니다</b> — 전투 태그가 없는 서버이므로
     * {@code teleportBlocked} 는 늘 false 입니다.
     */
    private final class PeaceHost implements HomeService.Host {
        @Override
        public Plugin plugin() { return RucPeace.this; }

        @Override
        public void send(Player player, String key, String... placeholders) {
            messages.send(player, key, placeholders);
        }

        @Override
        public void sendActionBar(Player player, String key, String... placeholders) {
            messages.sendActionBar(player, key, placeholders);
        }

        @Override
        public boolean teleportBlocked(Player player) { return false; }

        @Override
        public boolean isHomeWorld(World world) { return isPeaceWorld(world); }

        @Override
        public Location spawn() { return peaceSpawn(); }

        @Override
        public String bypassWarmupPermission() { return "rucpeace.bypass.warmup"; }

        @Override
        public String bypassCooldownPermission() { return "rucpeace.bypass.cooldown"; }
    }

    public RucCore core() { return core; }
    public PeaceMessages msg() { return messages; }
    public AttributionService getAttribution() { return attribution; }
    public GuardService getGuard() { return guard; }
    public IncidentService getIncidents() { return incidents; }
    public HomeService getHomes() { return homes; }
}
