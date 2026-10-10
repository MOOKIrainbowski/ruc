package kr.rucserver.war.service;

import kr.rucserver.core.model.Guild;
import kr.rucserver.war.RucWar;
import kr.rucserver.war.storage.WarRepository;
import org.bukkit.Bukkit;
import org.bukkit.Location;
import org.bukkit.Particle;
import org.bukkit.Sound;
import org.bukkit.World;
import org.bukkit.entity.Player;
import org.bukkit.potion.PotionEffect;
import org.bukkit.potion.PotionEffectType;
import org.bukkit.scheduler.BukkitTask;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * 2초마다 도는 영토 감시 (2026-10-10).
 *
 * <ul>
 *   <li><b>빛 기둥</b> — 러크 코어는 신호기처럼 하늘로 빛을 쏩니다 (평시 · 전시 모두). 숨겨 박아도 멀리서 보입니다.</li>
 *   <li><b>침입자</b> — 평시에 남의 영토에 들어간 사람은 발광하고, 그 국가 접속자에게 거리 · 방향이 액션바로 갑니다.
 *       처음 들어온 순간에는 채팅 경보도 (사람마다 1분에 한 번).</li>
 *   <li><b>홈 어드밴티지</b> — 자기 영토 안의 국민은 성급함 I (채집 속도).</li>
 * </ul>
 * 네더 · 엔드는 영토가 없어서 여기서 할 일도 없습니다.
 */
public class TerritoryWatchService {

    private static final String[] COMPASS = {"북", "북동", "동", "남동", "남", "남서", "서", "북서"};
    private static final String[] ARROWS = {"↑", "↗", "→", "↘", "↓", "↙", "←", "↖"};

    private final RucWar plugin;
    private final Map<UUID, Long> lastAlarm = new HashMap<>();
    private BukkitTask task;

    public TerritoryWatchService(RucWar plugin) {
        this.plugin = plugin;
    }

    public void start() {
        task = Bukkit.getScheduler().runTaskTimer(plugin, this::tick, 40L, 40L);
    }

    public void stop() {
        if (task != null) task.cancel();
    }

    private void tick() {
        drawBeams();
        boolean war = plugin.getSchedule().isOpen();

        // 영토 주인 id → 그 안의 침입자
        Map<Integer, List<Player>> intruders = new HashMap<>();
        for (Player player : Bukkit.getOnlinePlayers()) {
            if (player.getWorld().getEnvironment() != World.Environment.NORMAL) continue;
            Integer owner = plugin.getTerritory().ownerOf(player.getLocation());
            if (owner == null) continue;
            Guild guild = plugin.core().getGuilds().of(player);

            if (guild != null && guild.getId() == owner) {
                player.addPotionEffect(new PotionEffect(PotionEffectType.HASTE, 60, 0, true, false, true));
                continue;
            }
            if (war || player.hasPermission("rucwar.bypass.territory")) continue;

            player.addPotionEffect(new PotionEffect(PotionEffectType.GLOWING, 60, 0, true, false, false));
            intruders.computeIfAbsent(owner, k -> new ArrayList<>()).add(player);
            alarmOnce(player, owner);
        }
        if (intruders.isEmpty()) return;

        for (Player member : Bukkit.getOnlinePlayers()) {
            Guild guild = plugin.core().getGuilds().of(member);
            if (guild == null) continue;
            List<Player> list = intruders.get(guild.getId());
            if (list == null) continue;

            Player nearest = null;
            double best = Double.MAX_VALUE;
            for (Player intruder : list) {
                if (!intruder.getWorld().equals(member.getWorld())) continue;
                double d = intruder.getLocation().distanceSquared(member.getLocation());
                if (d < best) { best = d; nearest = intruder; }
            }
            if (nearest == null) continue;
            plugin.msg().sendActionBar(member, "war.intruder-bar",
                    "count", String.valueOf(list.size()), "player", nearest.getName(),
                    "distance", String.valueOf((int) Math.sqrt(best)),
                    "direction", direction(member.getLocation(), nearest.getLocation()));
        }
    }

    /** 처음 들어온 순간 — 침입자 본인과 주인 국가 전원에게 한 번. */
    private void alarmOnce(Player intruder, int owner) {
        long now = System.currentTimeMillis();
        Long last = lastAlarm.get(intruder.getUniqueId());
        lastAlarm.put(intruder.getUniqueId(), now);
        if (last != null && now - last < 60_000) return;

        Guild ownerGuild = plugin.core().getGuilds().byId(owner);
        plugin.msg().send(intruder, "war.intruder-self", "guild", ownerGuild == null ? "?" : ownerGuild.getName());
        for (Player member : Bukkit.getOnlinePlayers()) {
            Guild guild = plugin.core().getGuilds().of(member);
            if (guild == null || guild.getId() != owner) continue;
            plugin.msg().send(member, "war.intruder-alarm", "player", intruder.getName());
            member.playSound(member.getLocation(), Sound.BLOCK_NOTE_BLOCK_BELL, 1f, 0.5f);
        }
    }

    /** "123m 북동 ↗" — 나침반 방위 + 내가 보는 방향 기준 화살표. 마인크래프트 북쪽 = -Z. */
    static String direction(Location from, Location to) {
        double bearing = Math.toDegrees(Math.atan2(to.getX() - from.getX(), -(to.getZ() - from.getZ())));
        bearing = (bearing + 360) % 360;
        double facing = (from.getYaw() + 180 + 360) % 360;   // yaw 0 = 남쪽
        int compass = (int) Math.round(bearing / 45) % 8;
        int arrow = (int) Math.round(((bearing - facing + 360) % 360) / 45) % 8;
        return COMPASS[compass] + " " + ARROWS[arrow];
    }

    private void drawBeams() {
        int height = plugin.getConfig().getInt("core.beam-height", 96);
        for (WarRepository.CoreRow row : plugin.getTerritory().coreMap().values()) {
            World world = Bukkit.getWorld(row.world());
            if (world == null) continue;   // 청크가 안 불려 있어도 입자는 보냅니다 — 멀리서 보여야 하니까
            for (int dy = TerritoryService.SIZE; dy <= height; dy += 2) {   // 몸체(5칸) 위부터
                // force = 먼 거리(최대 512블록)에서도 보이게
                world.spawnParticle(Particle.END_ROD, row.x() + 0.5, row.y() + dy, row.z() + 0.5,
                        1, 0.05, 0.4, 0.05, 0, null, true);
            }
        }
    }

    public void forget(UUID uuid) {
        lastAlarm.remove(uuid);
    }
}
