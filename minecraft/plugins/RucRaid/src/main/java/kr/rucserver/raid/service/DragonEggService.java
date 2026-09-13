package kr.rucserver.raid.service;

import kr.rucserver.raid.RucRaid;
import kr.rucserver.raid.storage.RaidRepository;
import org.bukkit.Bukkit;
import org.bukkit.Location;
import org.bukkit.Material;
import org.bukkit.NamespacedKey;
import org.bukkit.Particle;
import org.bukkit.Sound;
import org.bukkit.World;
import org.bukkit.attribute.Attribute;
import org.bukkit.attribute.AttributeInstance;
import org.bukkit.attribute.AttributeModifier;
import org.bukkit.entity.Player;
import org.bukkit.inventory.ItemStack;
import org.bukkit.potion.PotionEffect;
import org.bukkit.potion.PotionEffectType;
import org.bukkit.scheduler.BukkitTask;

import java.sql.SQLException;
import java.util.HashMap;
import java.util.Map;
import java.util.UUID;
import java.util.logging.Level;

/**
 * 드래곤 알 (D3).
 *
 * 네트워크 전역에 레이드 1개 + 평화 1개, 총 2개만 존재합니다. 여기서는 레이드
 * 쪽 1개를 다룹니다.
 *
 * 설계 의도는 "강력하되 숨길 수 없게"입니다. 버프만 빨아먹고 잠수하면 콘텐츠가
 * 죽으므로, 이득에는 반드시 <b>추적당하는 대가</b>가 붙습니다.
 *
 * <table>
 *   <tr><td>최대 체력</td><td>+4 (하트 2칸)</td></tr>
 *   <tr><td>성급함</td><td>I</td></tr>
 *   <tr><td>Ruc 획득량</td><td>+15%</td></tr>
 *   <tr><td>자체 XP 획득량</td><td>+10%</td></tr>
 *   <tr><td>비전투 재생</td><td>전투 해제 10초 후 재생 I</td></tr>
 * </table>
 *
 * 대가: 30초마다 발광 노출, 하루 1회 전 서버 공지, 컨테이너 보관 불가,
 * 사망 시 무조건 드랍.
 */
public class DragonEggService {

    /** 최대 체력 보정을 나중에 정확히 되돌리기 위한 고정 키. */
    private final NamespacedKey healthKey;

    private final RucRaid plugin;
    private final RaidRepository repository;
    private final String serverId;

    private final boolean enabled;
    private final double bonusHealth;
    private final double rucMultiplier;
    private final double xpMultiplier;
    private final int glowIntervalTicks;
    private final int regenAfterCombatSeconds;

    /** 알을 들고 있는 사람이 마지막으로 전투에서 벗어난 시각. */
    private final Map<UUID, Long> peaceSince = new HashMap<>();

    /** 현재 알을 소지한 사람. 공지와 /알 명령이 봅니다. */
    private volatile UUID holder;

    private BukkitTask buffTask;
    private BukkitTask glowTask;
    private BukkitTask announceTask;

    public DragonEggService(RucRaid plugin, RaidRepository repository, String serverId) {
        this.plugin = plugin;
        this.repository = repository;
        this.serverId = serverId;
        this.healthKey = new NamespacedKey(plugin, "dragon_egg_health");

        this.enabled = plugin.getConfig().getBoolean("dragon-egg.enabled", true);
        this.bonusHealth = plugin.getConfig().getDouble("dragon-egg.bonus-health", 4.0);
        this.rucMultiplier = 1.0 + plugin.getConfig().getDouble("dragon-egg.ruc-bonus-percent", 15) / 100.0;
        this.xpMultiplier = 1.0 + plugin.getConfig().getDouble("dragon-egg.xp-bonus-percent", 10) / 100.0;
        this.glowIntervalTicks = plugin.getConfig().getInt("dragon-egg.glow-interval-seconds", 30) * 20;
        this.regenAfterCombatSeconds = plugin.getConfig().getInt("dragon-egg.regen-after-combat-seconds", 10);
    }

    public boolean isEnabled() {
        return enabled;
    }

    public UUID getHolder() {
        return holder;
    }

    // ── 수명 주기 ──────────────────────────────────────────────────────

    public void start() {
        if (!enabled) {
            plugin.getLogger().info("드래곤 알 비활성화 (config)");
            return;
        }

        // Core의 보상 배수에 등록해 둡니다. Core는 지급 직전에 이 값을 곱합니다.
        plugin.core().getBonuses().registerRuc(
                uuid -> uuid.equals(holder) ? rucMultiplier : 1.0);
        plugin.core().getBonuses().registerXp(
                uuid -> uuid.equals(holder) ? xpMultiplier : 1.0);

        buffTask = Bukkit.getScheduler().runTaskTimer(plugin, this::applyBuffs, 40L, 20L);
        glowTask = Bukkit.getScheduler().runTaskTimer(plugin, this::exposeHolder,
                glowIntervalTicks, glowIntervalTicks);

        long announceMinutes = plugin.getConfig().getLong("dragon-egg.announce-interval-minutes", 1440);
        announceTask = Bukkit.getScheduler().runTaskTimer(plugin, this::announceHolder,
                announceMinutes * 60L * 20L, announceMinutes * 60L * 20L);

        placeIfMissing();
    }

    public void stop() {
        if (buffTask != null) buffTask.cancel();
        if (glowTask != null) glowTask.cancel();
        if (announceTask != null) announceTask.cancel();

        // 서버가 내려갈 때 보정을 남기면, 알 없이도 체력이 늘어난 채로 남습니다.
        for (Player player : Bukkit.getOnlinePlayers()) removeHealthBonus(player);
    }

    // ── 배치 ───────────────────────────────────────────────────────────

    /**
     * 알을 아직 한 번도 놓지 않았다면 제단 위치에 놓습니다.
     *
     * "지금 월드에 알이 있는가"로 판정하면 안 됩니다 — 누군가 주워서 인벤토리에
     * 넣은 상태도 그렇게 보이기 때문에, 그때마다 새 알이 생겨 개수 제한이
     * 무너집니다. 그래서 DB에 배치 여부 플래그를 하나 둡니다.
     */
    private void placeIfMissing() {
        Bukkit.getScheduler().runTaskAsynchronously(plugin, () -> {
            String placed;
            try {
                placed = repository.getState(serverId, "dragon_egg_placed");
            } catch (SQLException e) {
                plugin.getLogger().log(Level.SEVERE, "드래곤 알 상태 조회 실패", e);
                return;
            }
            if ("true".equals(placed)) return;

            Bukkit.getScheduler().runTask(plugin, () -> {
                Location altar = altarLocation();
                if (altar == null) {
                    plugin.getLogger().warning("드래곤 알 제단 월드를 찾지 못했습니다. 배치를 건너뜁니다.");
                    return;
                }
                if (plugin.getConfig().getBoolean("dragon-egg.altar.build", true)) {
                    buildAltar(altar);
                }
                altar.getBlock().setType(Material.DRAGON_EGG);
                plugin.getLogger().info("드래곤 알 배치: " + altar.getWorld().getName()
                        + " " + altar.getBlockX() + " " + altar.getBlockY() + " " + altar.getBlockZ());

                Bukkit.getScheduler().runTaskAsynchronously(plugin, () -> {
                    try {
                        repository.setState(serverId, "dragon_egg_placed", "true");
                    } catch (SQLException e) {
                        plugin.getLogger().log(Level.SEVERE, "드래곤 알 상태 저장 실패", e);
                    }
                });
            });
        });
    }

    /**
     * 제단 좌표.
     *
     * y 를 -1 로 두면 지표면에 맞춥니다. 고정값을 그대로 쓰면 그 높이가 허공일 때
     * <b>알이 떨어집니다</b> — 드래곤 알은 모래처럼 중력을 받는 블록이라,
     * 제단이 아니라 엉뚱한 땅바닥에 박힙니다.
     */
    private Location altarLocation() {
        String worldName = plugin.getConfig().getString("dragon-egg.altar.world", "world");
        World world = Bukkit.getWorld(worldName);
        if (world == null) return null;

        int x = plugin.getConfig().getInt("dragon-egg.altar.x", 0);
        int z = plugin.getConfig().getInt("dragon-egg.altar.z", 0);
        int y = plugin.getConfig().getInt("dragon-egg.altar.y", -1);

        if (y < 0) {
            // getHighestBlockYAt 은 최상단 고체 블록의 Y 입니다. 그 위가 알 자리.
            y = world.getHighestBlockYAt(x, z) + 1;
        }
        return new Location(world, x, y, z);
    }

    /**
     * 제단 구조물.
     *
     * 알이 그냥 풀밭에 놓여 있으면 랜드마크로 읽히지 않고, 밑을 파면 굴러떨어집니다.
     * 흑요석 받침 위에 올려 두면 시각적으로도 목표물이 되고 밑을 파기도 어렵습니다.
     * (완전히 막지는 않습니다 — 알을 옮기는 것 자체가 콘텐츠입니다.)
     */
    private void buildAltar(Location egg) {
        World world = egg.getWorld();
        int cx = egg.getBlockX(), cy = egg.getBlockY(), cz = egg.getBlockZ();

        // 받침 3x3, 두 단
        for (int dx = -2; dx <= 2; dx++) {
            for (int dz = -2; dz <= 2; dz++) {
                boolean outer = Math.abs(dx) == 2 || Math.abs(dz) == 2;
                world.getBlockAt(cx + dx, cy - 2, cz + dz).setType(
                        outer ? Material.POLISHED_BLACKSTONE_BRICKS : Material.OBSIDIAN);
                if (!outer) {
                    world.getBlockAt(cx + dx, cy - 1, cz + dz).setType(Material.OBSIDIAN);
                }
                // 지면이 비어 있으면 받침이 공중에 뜹니다. 땅에 닿을 때까지 메웁니다.
                // 8칸 정도로 끊으면 경사지나 절벽에서 제단이 공중에 뜬 채 남습니다.
                for (int y = cy - 3; y > cy - 40 && y > world.getMinHeight(); y--) {
                    if (!world.getBlockAt(cx + dx, y, cz + dz).getType().isAir()) break;
                    world.getBlockAt(cx + dx, y, cz + dz).setType(Material.POLISHED_BLACKSTONE);
                }
            }
        }

        // 알 자리 위쪽은 비워 둡니다 (지형이 덮고 있으면 보이지 않습니다)
        for (int y = cy; y < cy + 4; y++) {
            world.getBlockAt(cx, y, cz).setType(Material.AIR);
        }

        // 네 모서리 기둥 + 조명
        for (int[] o : new int[][]{{2, 2}, {2, -2}, {-2, 2}, {-2, -2}}) {
            for (int y = cy - 1; y <= cy + 1; y++) {
                world.getBlockAt(cx + o[0], y, cz + o[1]).setType(Material.POLISHED_BLACKSTONE_BRICKS);
            }
            world.getBlockAt(cx + o[0], cy + 2, cz + o[1]).setType(Material.SEA_LANTERN);
        }
    }

    /** (스태프) 알을 제단에 다시 놓습니다. 분실 복구용. */
    public boolean respawnAtAltar() {
        Location altar = altarLocation();
        if (altar == null) return false;
        if (plugin.getConfig().getBoolean("dragon-egg.altar.build", true)) {
            buildAltar(altar);
        }
        altar.getBlock().setType(Material.DRAGON_EGG);
        Bukkit.broadcast(plugin.msg().broadcast("egg.returned"));
        return true;
    }

    // ── 버프 ───────────────────────────────────────────────────────────

    private void applyBuffs() {
        UUID found = null;

        for (Player player : Bukkit.getOnlinePlayers()) {
            if (!holdsEgg(player)) {
                removeHealthBonus(player);
                peaceSince.remove(player.getUniqueId());
                continue;
            }

            found = player.getUniqueId();
            addHealthBonus(player);

            // 지속시간을 주기(1초)보다 넉넉히 잡아야 깜빡이지 않습니다.
            player.addPotionEffect(new PotionEffect(
                    PotionEffectType.HASTE, 60, 0, true, false, true));

            applyPeaceRegen(player);
        }

        // 소지자가 오프라인이면 holder 를 지웁니다. 남겨두면 그 사람이 다른
        // 서버에서 배수를 계속 받습니다 (Ruc는 네트워크 공용 지갑입니다).
        holder = found;
    }

    private void applyPeaceRegen(Player player) {
        UUID uuid = player.getUniqueId();

        if (plugin.getCombatTags().isTagged(uuid)) {
            peaceSince.remove(uuid);
            return;
        }

        long since = peaceSince.computeIfAbsent(uuid, k -> System.currentTimeMillis());
        if (System.currentTimeMillis() - since < regenAfterCombatSeconds * 1000L) return;

        player.addPotionEffect(new PotionEffect(
                PotionEffectType.REGENERATION, 60, 0, true, false, true));
    }

    public boolean holdsEgg(Player player) {
        for (ItemStack item : player.getInventory().getContents()) {
            if (item != null && item.getType() == Material.DRAGON_EGG) return true;
        }
        return player.getInventory().getItemInOffHand().getType() == Material.DRAGON_EGG;
    }

    private void addHealthBonus(Player player) {
        AttributeInstance attribute = player.getAttribute(Attribute.MAX_HEALTH);
        if (attribute == null) return;
        if (attribute.getModifier(healthKey) != null) return;

        // Transient 로 넣으면 플레이어 데이터에 저장되지 않습니다. 서버가 비정상
        // 종료돼도 보정이 영구히 남지 않아, 알 없이 체력만 늘어난 계정을 막습니다.
        attribute.addTransientModifier(new AttributeModifier(
                healthKey, bonusHealth, AttributeModifier.Operation.ADD_NUMBER));
    }

    private void removeHealthBonus(Player player) {
        AttributeInstance attribute = player.getAttribute(Attribute.MAX_HEALTH);
        if (attribute == null || attribute.getModifier(healthKey) == null) return;

        attribute.removeModifier(healthKey);

        // 보정이 빠지면 최대치가 줄어드는데, 현재 체력이 그보다 크면
        // 클라이언트가 이상한 상태로 남습니다. 잘라 맞춥니다.
        if (player.getHealth() > attribute.getValue()) {
            player.setHealth(attribute.getValue());
        }
    }

    // ── 대가 ───────────────────────────────────────────────────────────

    /** 30초마다 반경 안 전원에게 위치를 드러냅니다. */
    private void exposeHolder() {
        UUID current = holder;
        if (current == null) return;

        Player player = Bukkit.getPlayer(current);
        if (player == null) return;

        int seconds = plugin.getConfig().getInt("dragon-egg.glow-duration-seconds", 6);
        player.addPotionEffect(new PotionEffect(
                PotionEffectType.GLOWING, seconds * 20, 0, true, false, true));

        double radius = plugin.getConfig().getDouble("dragon-egg.reveal-radius", 200);
        for (Player nearby : player.getWorld().getPlayers()) {
            if (nearby.equals(player)) continue;
            if (nearby.getLocation().distanceSquared(player.getLocation()) > radius * radius) continue;
            plugin.msg().sendActionBar(nearby, "egg.nearby", "player", player.getName());
        }

        player.getWorld().spawnParticle(Particle.DRAGON_BREATH,
                player.getLocation().add(0, 1.2, 0), 30, 0.4, 0.6, 0.4, 0.01);
        plugin.msg().sendActionBar(player, "egg.exposed");
    }

    /** 하루 1회 전 서버에 소지자를 알립니다. */
    private void announceHolder() {
        UUID current = holder;
        if (current == null) {
            Bukkit.broadcast(plugin.msg().broadcast("egg.announce-none"));
            return;
        }
        Player player = Bukkit.getPlayer(current);
        if (player == null) return;

        Bukkit.broadcast(plugin.msg().broadcast("egg.announce", "player", player.getName()));
        for (Player online : Bukkit.getOnlinePlayers()) {
            online.playSound(online.getLocation(), Sound.ENTITY_ENDER_DRAGON_GROWL, 0.4f, 1.0f);
        }
    }

    /** 소지자가 바뀌었을 때 즉시 반영. 줍기/버리기 이벤트에서 부릅니다. */
    public void refreshSoon() {
        Bukkit.getScheduler().runTask(plugin, this::applyBuffs);
    }

    public void clear(UUID uuid) {
        peaceSince.remove(uuid);
        if (uuid.equals(holder)) holder = null;
    }
}
