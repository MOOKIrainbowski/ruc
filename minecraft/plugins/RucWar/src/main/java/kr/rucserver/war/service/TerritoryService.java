package kr.rucserver.war.service;

import kr.rucserver.core.model.Guild;
import kr.rucserver.core.model.GuildRank;
import kr.rucserver.war.RucWar;
import kr.rucserver.war.storage.WarRepository;
import org.bukkit.Bukkit;
import org.bukkit.Chunk;
import org.bukkit.Location;
import org.bukkit.Material;
import org.bukkit.Sound;
import org.bukkit.World;
import org.bukkit.block.Block;
import org.bukkit.entity.Player;
import org.bukkit.inventory.ItemStack;

import java.sql.SQLException;
import java.util.ArrayList;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.logging.Level;

/**
 * 영토와 코어 (§2.6).
 *
 * <h2>규칙 요약</h2>
 * <ul>
 *   <li>코어는 <b>미리 지정된 거점</b>에만, <b>전쟁 시간대에만</b>, <b>길드장·부길드장만</b>
 *       설치할 수 있습니다.</li>
 *   <li>설치한 코어가 시간대 종료까지 살아남으면 주변 청크가 그 길드의 영토로
 *       확정됩니다.</li>
 *   <li>평시에는 영토 안에서 소속원만 건축·채집할 수 있고, 코어는 부술 수 없습니다.</li>
 *   <li>전쟁 시간대에는 보호가 풀립니다 — 그래야 탈취가 성립합니다.</li>
 * </ul>
 *
 * <h2>영토를 계산으로 구하는 이유</h2>
 * 청크 클레임을 DB 에 따로 쌓지 않고 "코어 중심 반경 R 청크" 로 계산합니다.
 * 저장해 두면 설정에서 반경을 바꿨을 때 옛 클레임이 그대로 남아 어긋나고,
 * 그 불일치는 조용합니다. 거점이 한 자릿수라 계산 비용은 없습니다.
 */
public class TerritoryService {

    private final RucWar plugin;
    private final WarRepository repository;

    /** 설정에 적힌 코어 거점. 서버 수명 동안 바뀌지 않습니다. */
    private final List<CoreSite> sites = new ArrayList<>();

    /** 거점 이름 → 설치된 코어. 메인 스레드에서만 건드립니다. */
    private final Map<String, WarRepository.CoreRow> cores = new ConcurrentHashMap<>();

    private final int claimChunkRadius;
    private final int siteRadius;
    private final double neutralRadius;
    private final String neutralWorld;

    public TerritoryService(RucWar plugin, WarRepository repository) {
        this.plugin = plugin;
        this.repository = repository;

        this.claimChunkRadius = plugin.getConfig().getInt("territory.claim-chunk-radius", 8);
        this.siteRadius = plugin.getConfig().getInt("territory.site-radius", 6);
        this.neutralRadius = plugin.getConfig().getDouble("territory.neutral-radius", 100);
        this.neutralWorld = plugin.getConfig().getString("territory.neutral-world", "world");

        loadSites();
    }

    private void loadSites() {
        var section = plugin.getConfig().getMapList("core-sites");
        for (Map<?, ?> raw : section) {
            Object name = raw.get("name");
            Object x = raw.get("x");
            Object z = raw.get("z");
            if (name == null || x == null || z == null) {
                plugin.getLogger().warning("core-sites 항목에 name/x/z 가 없습니다 — 건너뜁니다.");
                continue;
            }
            String world = raw.get("world") == null ? "world" : String.valueOf(raw.get("world"));
            sites.add(new CoreSite(String.valueOf(name), world,
                    ((Number) x).intValue(), ((Number) z).intValue()));
        }

        if (sites.isEmpty()) {
            plugin.getLogger().warning(
                    "코어 거점이 설정되어 있지 않습니다 (core-sites). 코어를 설치할 수 없습니다.");
        } else {
            plugin.getLogger().info("코어 거점 " + sites.size() + "곳: " + siteNames());
        }
    }

    /** 코어 거점. y 는 설치 시 지표면으로 스냅합니다. */
    public record CoreSite(String name, String world, int x, int z) {}

    // ── 수명 주기 ──────────────────────────────────────────────────────

    public void start() {
        Bukkit.getScheduler().runTaskAsynchronously(plugin, () -> {
            List<WarRepository.CoreRow> loaded;
            try {
                loaded = repository.loadCores();
            } catch (SQLException e) {
                plugin.getLogger().log(Level.SEVERE, "코어 목록을 읽지 못했습니다.", e);
                return;
            }
            Bukkit.getScheduler().runTask(plugin, () -> {
                for (WarRepository.CoreRow row : loaded) cores.put(row.site(), row);
                plugin.getLogger().info("설치된 코어 " + cores.size() + "개 로드");
                buildPedestals();
            });
        });
    }

    // ── 거점 ──────────────────────────────────────────────────────────

    public List<CoreSite> sites() {
        return Collections.unmodifiableList(sites);
    }

    public String siteNames() {
        List<String> names = new ArrayList<>();
        for (CoreSite site : sites) names.add(site.name());
        return String.join(", ", names);
    }

    public CoreSite siteByName(String name) {
        for (CoreSite site : sites) {
            if (site.name().equalsIgnoreCase(name)) return site;
        }
        return null;
    }

    /** 이 위치가 어느 거점 위인지. 아니면 null. */
    public CoreSite siteAt(Location location) {
        if (location.getWorld() == null) return null;
        String world = location.getWorld().getName();

        for (CoreSite site : sites) {
            if (!site.world().equals(world)) continue;
            double dx = location.getBlockX() - site.x();
            double dz = location.getBlockZ() - site.z();
            // 원형으로 봅니다. 사각형이면 모서리에서 "거점인데 안 된다" 가 생깁니다.
            if (dx * dx + dz * dz <= (double) siteRadius * siteRadius) return site;
        }
        return null;
    }

    /**
     * 거점에 흑요석 대좌를 세웁니다.
     *
     * 청크를 비동기로 불러온 뒤 메인 스레드에서 블록을 놓습니다. forceload 로
     * 붙잡아 두는 방법은 256청크 제한에서 조용히 실패하는 함정이 있어 쓰지 않습니다.
     */
    public void buildPedestals() {
        if (!plugin.getConfig().getBoolean("territory.build-pedestals", true)) return;

        for (CoreSite site : sites) {
            World world = Bukkit.getWorld(site.world());
            if (world == null) {
                plugin.getLogger().warning("거점 '" + site.name() + "' 의 월드 '"
                        + site.world() + "' 가 없습니다.");
                continue;
            }
            world.getChunkAtAsyncUrgently(site.x() >> 4, site.z() >> 4)
                    .thenAccept(chunk -> Bukkit.getScheduler().runTask(plugin,
                            () -> buildPedestal(world, site)));
        }
    }

    private void buildPedestal(World world, CoreSite site) {
        int surfaceY = world.getHighestBlockYAt(site.x(), site.z());
        Block center = world.getBlockAt(site.x(), surfaceY, site.z());

        // 이미 세워져 있으면 다시 만들지 않습니다. 재시작마다 덮어쓰면 전쟁으로
        // 부서진 흔적까지 되돌려 버립니다.
        if (center.getType() == Material.OBSIDIAN
                || center.getType() == Material.BEACON) {
            return;
        }

        // 3×3 흑요석 바닥 + 네 귀퉁이에 울음 흑요석 기둥. 멀리서 눈에 띄고,
        // 코어를 놓을 자리가 한가운데임이 분명해 보이게 합니다.
        for (int dx = -1; dx <= 1; dx++) {
            for (int dz = -1; dz <= 1; dz++) {
                world.getBlockAt(site.x() + dx, surfaceY - 1, site.z() + dz)
                        .setType(Material.OBSIDIAN, false);
                // 대좌 위는 비워 둡니다. 코어를 놓을 자리입니다.
                Block above = world.getBlockAt(site.x() + dx, surfaceY, site.z() + dz);
                if (above.getType() != Material.AIR) above.setType(Material.AIR, false);
            }
        }
        for (int[] corner : new int[][] {{-2, -2}, {-2, 2}, {2, -2}, {2, 2}}) {
            for (int dy = 0; dy < 3; dy++) {
                world.getBlockAt(site.x() + corner[0], surfaceY + dy, site.z() + corner[1])
                        .setType(dy == 2 ? Material.SEA_LANTERN : Material.CRYING_OBSIDIAN, false);
            }
        }
        plugin.getLogger().info("거점 대좌 건설: " + site.name()
                + " (" + site.x() + ", " + surfaceY + ", " + site.z() + ")");
    }

    // ── 코어 설치 ──────────────────────────────────────────────────────

    /** 설치 판정 결과. */
    public enum PlaceResult {
        OK,
        NOT_A_SITE,
        WAR_CLOSED,
        NOT_IN_GUILD,
        NOT_A_NATION,
        NO_PERMISSION,
        WRONG_GUILD,
        SITE_TAKEN,
        ALREADY_HAVE_CORE,
        ERROR
    }

    /**
     * 코어를 설치합니다. 블록이 놓이기 <b>전에</b> 부릅니다.
     *
     * 판정 순서는 "가장 흔한 거절" 부터입니다. 거점이 아닌 곳에 놓으려는 경우가
     * 압도적으로 많고, 그때 DB 를 건드릴 이유가 없습니다.
     */
    public PlaceResult tryPlace(Player player, Block block, ItemStack item) {
        CoreSite site = siteAt(block.getLocation());
        if (site == null) return PlaceResult.NOT_A_SITE;

        if (!plugin.getSchedule().isOpen()) return PlaceResult.WAR_CLOSED;

        Guild guild = plugin.core().getGuilds().of(player);
        if (guild == null) return PlaceResult.NOT_IN_GUILD;
        if (!guild.isNation()) return PlaceResult.NOT_A_NATION;

        GuildRank rank = guild.rankOf(player.getUniqueId());
        if (rank == null || !rank.atLeast(GuildRank.VICE)) return PlaceResult.NO_PERMISSION;

        // D2 — 코어는 길드 귀속입니다. 다른 길드의 코어를 주워 와도 쓸 수 없습니다.
        Integer owner = plugin.getItems().coreOwner(item);
        if (owner != null && owner != guild.getId()) return PlaceResult.WRONG_GUILD;

        if (cores.containsKey(site.name())) return PlaceResult.SITE_TAKEN;

        int limit = plugin.getConfig().getInt("territory.max-cores-per-guild", 2);
        if (countCores(guild.getId()) >= limit) return PlaceResult.ALREADY_HAVE_CORE;

        WarRepository.CoreRow row = new WarRepository.CoreRow(
                site.name(), guild.getId(), block.getWorld().getName(),
                block.getX(), block.getY(), block.getZ(),
                System.currentTimeMillis(), false);

        // 캐시에 먼저 넣어 같은 서버에서 동시에 두 명이 놓는 것을 막고,
        // DB 의 PK 충돌이 다른 서버와의 경쟁까지 막습니다.
        if (cores.putIfAbsent(site.name(), row) != null) return PlaceResult.SITE_TAKEN;

        Bukkit.getScheduler().runTaskAsynchronously(plugin, () -> {
            boolean placed;
            try {
                placed = repository.placeCore(row);
            } catch (SQLException e) {
                plugin.getLogger().log(Level.SEVERE, "코어 설치 기록 실패: " + site.name(), e);
                placed = false;
            }
            if (placed) return;

            // DB 가 거부했으면 캐시와 블록을 되돌리고 코어를 <b>돌려줍니다</b>.
            // 그대로 두면 이 서버만 코어가 있다고 믿는 상태가 되고, 무엇보다
            // 일주일 모은 물건이 경쟁에서 밀렸다는 이유로 사라집니다.
            int guildId = guild.getId();
            String guildName = guild.getName();
            Bukkit.getScheduler().runTask(plugin, () -> {
                cores.remove(site.name(), row);

                World world = Bukkit.getWorld(row.world());
                if (world != null) {
                    Block placedBlock = world.getBlockAt(row.x(), row.y(), row.z());
                    if (placedBlock.getType() == Material.BEACON) {
                        placedBlock.setType(Material.AIR, false);
                    }
                }

                ItemStack refund = plugin.getItems().createCore(guildId, guildName);
                if (player.isOnline() && player.getInventory().firstEmpty() != -1) {
                    player.getInventory().addItem(refund);
                } else {
                    // 인벤토리가 찼거나 접속이 끊겼으면 코어 자리에 떨어뜨립니다.
                    // 조용히 버리는 것보다는 회수 가능한 편이 낫습니다.
                    if (world != null) {
                        world.dropItemNaturally(
                                new Location(world, row.x() + 0.5, row.y() + 1, row.z() + 0.5),
                                refund);
                    }
                }
                plugin.msg().send(player, "war.core-place-taken");
            });
        });

        return PlaceResult.OK;
    }

    /** 설치가 확정된 뒤의 연출과 공지. */
    public void announcePlaced(Player player, CoreSite site, Guild guild) {
        plugin.msg().broadcastAll("war.core-placed",
                "guild", guild.getName(), "site", site.name());

        for (Player online : Bukkit.getOnlinePlayers()) {
            online.playSound(online.getLocation(), Sound.BLOCK_BEACON_ACTIVATE, 0.8f, 1.0f);
        }
        plugin.msg().send(player, "war.core-placed-self",
                "site", site.name(),
                "minutes", String.valueOf(plugin.getSchedule().minutesUntilClose()));
    }

    /**
     * 코어가 부서졌습니다. 거점이 다시 비고, 그 길드의 영토도 사라집니다.
     *
     * @return 부서진 코어. 그 자리에 코어가 없었으면 null
     */
    public WarRepository.CoreRow onCoreBroken(Block block, Player breaker) {
        WarRepository.CoreRow row = coreAt(block);
        if (row == null) return null;

        cores.remove(row.site());

        Bukkit.getScheduler().runTaskAsynchronously(plugin, () -> {
            try {
                repository.removeCore(row.site());
            } catch (SQLException e) {
                plugin.getLogger().log(Level.SEVERE, "코어 삭제 기록 실패: " + row.site(), e);
            }
        });

        Guild owner = plugin.core().getGuilds().byId(row.guildId());
        String ownerName = owner == null ? "?" : owner.getName();

        Guild attacker = breaker == null ? null : plugin.core().getGuilds().of(breaker);
        plugin.msg().broadcastAll("war.core-destroyed",
                "site", row.site(),
                "guild", ownerName,
                "attacker", attacker == null
                        ? (breaker == null ? "?" : breaker.getName()) : attacker.getName());

        // 파괴에 성공한 길드에 시즌 점수를 줍니다 (§3.5 랭킹 보상의 재료).
        if (attacker != null && attacker.getId() != row.guildId()) {
            long points = plugin.getConfig().getLong("territory.points.core-destroyed", 200);
            plugin.core().getGuilds().addPoints(attacker.getId(), points);
        }
        return row;
    }

    /** 이 블록이 설치된 코어인지. */
    public WarRepository.CoreRow coreAt(Block block) {
        for (WarRepository.CoreRow row : cores.values()) {
            if (row.x() == block.getX() && row.y() == block.getY() && row.z() == block.getZ()
                    && row.world().equals(block.getWorld().getName())) {
                return row;
            }
        }
        return null;
    }

    /** 전쟁 시간대 종료 — 살아남은 코어를 영토로 확정합니다. */
    public void confirmSurvivors() {
        List<WarRepository.CoreRow> pending = new ArrayList<>();
        for (WarRepository.CoreRow row : cores.values()) {
            if (!row.confirmed()) pending.add(row);
        }
        if (pending.isEmpty()) return;

        Bukkit.getScheduler().runTaskAsynchronously(plugin, () -> {
            try {
                repository.confirmAll();
            } catch (SQLException e) {
                plugin.getLogger().log(Level.SEVERE, "코어 확정 실패", e);
                return;
            }
            Bukkit.getScheduler().runTask(plugin, () -> {
                for (WarRepository.CoreRow row : pending) {
                    cores.put(row.site(), new WarRepository.CoreRow(row.site(), row.guildId(),
                            row.world(), row.x(), row.y(), row.z(), row.placedAt(), true));

                    Guild guild = plugin.core().getGuilds().byId(row.guildId());
                    if (guild == null) continue;

                    plugin.msg().broadcastAll("war.territory-confirmed",
                            "guild", guild.getName(), "site", row.site());

                    long points = plugin.getConfig().getLong("territory.points.defended", 500);
                    plugin.core().getGuilds().addPoints(guild.getId(), points);
                }
            });
        });
    }

    public int countCores(int guildId) {
        int count = 0;
        for (WarRepository.CoreRow row : cores.values()) {
            if (row.guildId() == guildId) count++;
        }
        return count;
    }

    /** 거점 이름 → 설치된 코어 (표시용 사본). */
    public Map<String, WarRepository.CoreRow> coreMap() {
        return new LinkedHashMap<>(cores);
    }

    // ── 영토 판정 ──────────────────────────────────────────────────────

    /**
     * 이 청크를 소유한 길드 id. 주인이 없으면 null.
     *
     * 확정되지 않은 코어(설치 당일)는 영토를 주지 않습니다. 설치 즉시 보호가
     * 걸리면 놓자마자 안전해져서 "방어" 라는 규칙이 사라집니다.
     */
    public Integer ownerOf(Chunk chunk) {
        return ownerOf(chunk.getWorld().getName(), chunk.getX(), chunk.getZ());
    }

    /**
     * 위치로 영토 주인을 봅니다.
     *
     * {@code location.getChunk()} 를 쓰지 않습니다 — 청크 객체를 얻으려고 필요하면
     * 로드까지 하는데, 이 판정은 블록 이벤트와 이동 이벤트마다 불립니다. 청크
     * 좌표는 블록 좌표를 4비트 내리면 나옵니다.
     */
    public Integer ownerOf(Location location) {
        if (location.getWorld() == null) return null;
        return ownerOf(location.getWorld().getName(),
                location.getBlockX() >> 4, location.getBlockZ() >> 4);
    }

    /** 청크 좌표로 직접 판정합니다. */
    public Integer ownerOf(String world, int chunkX, int chunkZ) {
        for (WarRepository.CoreRow row : cores.values()) {
            if (!row.confirmed()) continue;
            if (!row.world().equals(world)) continue;

            int dx = Math.abs(chunkX - (row.x() >> 4));
            int dz = Math.abs(chunkZ - (row.z() >> 4));
            if (dx <= claimChunkRadius && dz <= claimChunkRadius) return row.guildId();
        }
        return null;
    }

    /** 스폰 주변 중립 구역인지. 여기서는 아무도 건축할 수 없습니다. */
    public boolean isNeutral(Location location) {
        if (location.getWorld() == null) return false;
        if (!location.getWorld().getName().equals(neutralWorld)) return false;

        Location spawn = location.getWorld().getSpawnLocation();
        double dx = location.getX() - spawn.getX();
        double dz = location.getZ() - spawn.getZ();
        return dx * dx + dz * dz <= neutralRadius * neutralRadius;
    }

    /**
     * 이 사람이 여기서 블록을 건드릴 수 있는지 (§2.6).
     *
     * <ul>
     *   <li>중립 구역: 항상 불가</li>
     *   <li>전쟁 시간대: 어디서나 가능 — 그래야 탈취가 성립합니다</li>
     *   <li>평시 영토: 소속원만</li>
     *   <li>평시 무주지: 누구나</li>
     * </ul>
     */
    public boolean canBuild(Player player, Location location) {
        if (player.hasPermission("rucwar.bypass.territory")) return true;
        if (isNeutral(location)) return false;
        if (plugin.getSchedule().isOpen()) return true;

        Integer owner = ownerOf(location);
        if (owner == null) return true;

        Guild guild = plugin.core().getGuilds().of(player);
        return guild != null && guild.getId() == owner;
    }

    /** 코어 블록을 부술 수 있는지. 평시에는 누구도 못 부숩니다. */
    public boolean canBreakCore(Player player) {
        if (player.hasPermission("rucwar.bypass.territory")) return true;
        return plugin.getSchedule().isOpen();
    }

    /** 표시용 — 이 위치의 영토 주인 이름. 무주지면 null. */
    public String ownerNameAt(Location location) {
        Integer owner = ownerOf(location);
        if (owner == null) return null;
        Guild guild = plugin.core().getGuilds().byId(owner);
        return guild == null ? null : guild.getName();
    }

    public int claimChunkRadius() { return claimChunkRadius; }

    /** 영토 중심(코어) 위치. 해당 길드의 확정 코어 중 첫 번째. */
    public Location coreLocationOf(int guildId, String siteName) {
        for (WarRepository.CoreRow row : cores.values()) {
            if (row.guildId() != guildId) continue;
            if (siteName != null && !row.site().equalsIgnoreCase(siteName)) continue;
            World world = Bukkit.getWorld(row.world());
            if (world == null) continue;
            // 코어 블록 위로 올려 보냅니다. 블록 안으로 보내면 질식합니다.
            return new Location(world, row.x() + 0.5, row.y() + 1, row.z() + 0.5);
        }
        return null;
    }

    /** 이 길드가 가진 코어 거점 이름들. */
    public List<String> siteNamesOf(int guildId) {
        List<String> out = new ArrayList<>();
        for (WarRepository.CoreRow row : cores.values()) {
            if (row.guildId() == guildId) out.add(row.site());
        }
        return out;
    }

    /** 사망·이탈 등으로 정리할 것이 생기면 여기에 둡니다. 현재는 없습니다. */
    public void cleanup(UUID uuid) {
        // 영토는 길드 소유라 개인 상태가 없습니다.
    }
}
