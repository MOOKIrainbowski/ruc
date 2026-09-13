package kr.rucserver.home.service;

import kr.rucserver.home.RucHome;
import kr.rucserver.home.world.PlazaBuilder;
import net.kyori.adventure.text.Component;
import net.kyori.adventure.text.format.NamedTextColor;
import org.bukkit.Bukkit;
import org.bukkit.Location;
import org.bukkit.Sound;
import org.bukkit.entity.Player;
import org.bukkit.scheduler.BukkitTask;

/**
 * 허브 바깥으로 떨어진 플레이어를 스폰으로 돌려보냅니다.
 *
 * 허브는 빈 월드 위에 떠 있는 섬이라, 가장자리를 넘으면 바닥이 없습니다.
 * 낙하 데미지가 꺼져 있어서 죽지도 않고 계속 떨어지기만 합니다 —
 * 그 상태로는 돌아올 방법이 없어 재접속밖에 답이 없습니다.
 *
 * PlayerMoveEvent 대신 주기 검사를 쓰는 이유: 이동 이벤트는 초당 수십 번
 * 발생하는데, 여기서 필요한 건 "떨어지는 중인가"뿐이라 5틱 간격이면 충분합니다.
 * 임계값을 넉넉히 잡아 정상 플레이 중에는 절대 걸리지 않게 했습니다.
 */
public class VoidGuard {

    private final RucHome plugin;
    private BukkitTask task;

    public VoidGuard(RucHome plugin) {
        this.plugin = plugin;
    }

    public void start() {
        int threshold = PlazaBuilder.voidThreshold();

        task = Bukkit.getScheduler().runTaskTimer(plugin, () -> {
            for (Player player : Bukkit.getOnlinePlayers()) {
                if (!plugin.isHubWorld(player.getWorld())) continue;
                if (player.getLocation().getY() >= threshold) continue;

                rescue(player);
            }
        }, 20L, 5L);

        plugin.getLogger().info("낙하 보호 활성화 (Y < " + threshold + " 이면 스폰으로 귀환)");
    }

    private void rescue(Player player) {
        Location spawn = PlazaBuilder.spawnLocation(player.getWorld());

        // 낙하 속도가 남아 있으면 도착하자마자 다시 떨어지므로 초기화합니다.
        player.setVelocity(player.getVelocity().zero());
        player.setFallDistance(0f);
        player.teleport(spawn);
        player.setVelocity(player.getVelocity().zero());
        player.setFallDistance(0f);

        player.playSound(spawn, Sound.ENTITY_ENDERMAN_TELEPORT, 0.8f, 1.3f);
        player.sendActionBar(Component.text("허브 밖으로 떨어져 스폰으로 돌아왔습니다")
                .color(NamedTextColor.YELLOW));
    }

    public void stop() {
        if (task != null) {
            task.cancel();
            task = null;
        }
    }
}
