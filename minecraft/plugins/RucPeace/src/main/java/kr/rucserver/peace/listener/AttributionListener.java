package kr.rucserver.peace.listener;

import kr.rucserver.peace.RucPeace;
import org.bukkit.Material;
import org.bukkit.entity.EnderCrystal;
import org.bukkit.entity.Entity;
import org.bukkit.entity.minecart.ExplosiveMinecart;
import org.bukkit.entity.Player;
import org.bukkit.event.EventHandler;
import org.bukkit.event.EventPriority;
import org.bukkit.event.Listener;
import org.bukkit.event.block.Action;
import org.bukkit.event.block.BlockPlaceEvent;
import io.papermc.paper.event.entity.EntityKnockbackEvent;
import org.bukkit.event.entity.EntityPlaceEvent;
import org.bukkit.event.player.PlayerFishEvent;
import org.bukkit.event.player.PlayerInteractEvent;

/**
 * 장부를 채우는 곳 (§2.5).
 *
 * 여기서 무엇 하나를 놓치면 그 경로로 사람이 죽습니다. 그래서 "무엇을 적는가"
 * 가 아니라 <b>어떤 경로로 남을 죽일 수 있는가</b>에서 출발해 거꾸로 만들었습니다.
 *
 * <table>
 *   <tr><th>죽이는 방법</th><th>여기서 적는 것</th></tr>
 *   <tr><td>엔드 크리스탈 폭발</td><td>설치자 (엔티티 PDC)</td></tr>
 *   <tr><td>TNT 마인카트</td><td>설치자 (엔티티 PDC)</td></tr>
 *   <tr><td>베드 · 리스폰 앵커 폭발</td><td>터뜨린 사람 + 위치</td></tr>
 *   <tr><td>낚싯대로 끌어 낙하·용암</td><td>끈 사람</td></tr>
 *   <tr><td>몸으로 밀어 낙하·용암</td><td>민 사람 (충돌 거리 내)</td></tr>
 *   <tr><td>폭발 넉백으로 밀기</td><td>ProtectionListener 가 막는 순간 기록</td></tr>
 * </table>
 */
public class AttributionListener implements Listener {

    private final RucPeace plugin;

    public AttributionListener(RucPeace plugin) {
        this.plugin = plugin;
    }

    /**
     * 엔드 크리스탈·TNT 마인카트 설치.
     *
     * 바닐라는 설치자를 남기지 않습니다. 터진 뒤에는 알 방법이 없으므로 지금
     * 붙여야 합니다. PDC 는 월드 저장에 함께 들어가므로, 미리 깔아 두고 며칠 뒤에
     * 터뜨리는 경로까지 막힙니다.
     */
    @EventHandler(priority = EventPriority.MONITOR, ignoreCancelled = true)
    public void onEntityPlace(EntityPlaceEvent event) {
        Player player = event.getPlayer();
        if (player == null) return;
        if (!plugin.isPeaceWorld(player.getWorld())) return;

        Entity placed = event.getEntity();
        if (placed instanceof EnderCrystal || placed instanceof ExplosiveMinecart) {
            plugin.getAttribution().stampPlacer(placed, player);
        }
    }

    /**
     * 엔드 크리스탈은 블록처럼 놓이기도 합니다.
     *
     * {@code EntityPlaceEvent} 로만 잡으면 놓치는 경로가 있어 양쪽을 봅니다.
     * 이미 표식이 있으면 덮어써도 결과가 같으므로 중복은 문제되지 않습니다.
     */
    @EventHandler(priority = EventPriority.MONITOR, ignoreCancelled = true)
    public void onBlockPlace(BlockPlaceEvent event) {
        if (!plugin.isPeaceWorld(event.getPlayer().getWorld())) return;
        if (event.getBlockPlaced().getType() != Material.END_CRYSTAL) return;

        // 방금 생성된 크리스탈 엔티티를 찾아 표식을 붙입니다.
        var center = event.getBlockPlaced().getLocation().add(0.5, 0.5, 0.5);
        for (Entity nearby : center.getWorld().getNearbyEntities(center, 1.5, 2.0, 1.5)) {
            if (nearby instanceof EnderCrystal) {
                plugin.getAttribution().stampPlacer(nearby, event.getPlayer());
            }
        }
    }

    /**
     * 베드·리스폰 앵커 터뜨리기.
     *
     * 폭발 주체가 블록이라 피해 이벤트에 가해자가 없습니다. 터뜨린 사람과
     * 위치를 적어 두고, 폭발 피해가 오면 위치로 맞춥니다.
     *
     * 성공 여부를 가리지 않고 적습니다 — 네더에서 침대를 우클릭하면 폭발이고,
     * 폭발하지 않는 경우라면 그 기록은 창이 지나며 그냥 버려집니다.
     */
    @EventHandler(priority = EventPriority.MONITOR, ignoreCancelled = true)
    public void onInteract(PlayerInteractEvent event) {
        if (event.getAction() != Action.RIGHT_CLICK_BLOCK) return;
        if (event.getClickedBlock() == null) return;
        if (!plugin.isPeaceWorld(event.getPlayer().getWorld())) return;

        Material type = event.getClickedBlock().getType();
        boolean explosive = type == Material.RESPAWN_ANCHOR || type.name().endsWith("_BED");
        if (!explosive) return;

        plugin.getAttribution().recordBlast(
                event.getClickedBlock().getLocation(), event.getPlayer().getUniqueId());
    }

    /**
     * 낚싯대로 사람을 끄는 것.
     *
     * 피해가 0 이라 피해 이벤트로는 보이지 않지만, 벼랑 끝에서는 이것만으로
     * 사람이 죽습니다.
     */
    @EventHandler(priority = EventPriority.MONITOR, ignoreCancelled = true)
    public void onFish(PlayerFishEvent event) {
        if (event.getState() != PlayerFishEvent.State.CAUGHT_ENTITY) return;
        if (!(event.getCaught() instanceof Player victim)) return;
        if (!plugin.isPeaceWorld(victim.getWorld())) return;

        plugin.getAttribution().recordPush(
                victim.getUniqueId(), event.getPlayer().getUniqueId());
    }

    /**
     * 몸으로 밀기 (플레이어 충돌).
     *
     * <h2>왜 이 이벤트만 보는가</h2>
     * 처음에는 {@code EntityKnockbackByEntityEvent} 로 가해자를 직접 받으려 했지만
     * 그것은 {@code forRemoval} 로 표시된 deprecated 이벤트이고, Paper 가 등록
     * 자체에 성능 경고를 냅니다. 게다가 이 서버에서는 <b>얻을 것이 거의 없습니다</b> —
     * PvP 가 꺼져 있어 공격 넉백이 아예 발생하지 않기 때문입니다.
     *
     * 실제로 존재하는 밀침 경로는 셋뿐이고, 각자 더 확실한 출처가 있습니다:
     * <ul>
     *   <li>폭발 넉백 → {@code ProtectionListener} 가 폭발을 막는 순간 이미
     *       가해자를 알고 있습니다. 거기서 적습니다.</li>
     *   <li>낚싯대 → {@code PlayerFishEvent} (위)</li>
     *   <li>몸으로 밀기 → 여기</li>
     * </ul>
     *
     * <h2>여기서 근접으로 찾아도 되는 이유</h2>
     * 충돌로 밀려면 <b>실제로 닿아야</b> 합니다. 그래서 "그 순간 닿을 거리에 있던
     * 사람" 은 추측이 아니라 물리적 전제입니다. 사망 시점에 근처에 누가 있었는지로
     * 추정하는 것과는 다릅니다 — 그건 무고한 사람을 가해자로 만듭니다.
     */
    @EventHandler(priority = EventPriority.MONITOR, ignoreCancelled = true)
    public void onPush(EntityKnockbackEvent event) {
        if (event.getCause() != EntityKnockbackEvent.Cause.PUSH) return;
        if (!(event.getEntity() instanceof Player victim)) return;
        if (!plugin.isPeaceWorld(victim.getWorld())) return;

        double reach = plugin.getConfig().getDouble("attribution.contact-reach", 1.6);
        Player pusher = null;
        double nearest = Double.MAX_VALUE;

        for (Entity nearby : victim.getNearbyEntities(reach, reach, reach)) {
            if (!(nearby instanceof Player candidate) || candidate.equals(victim)) continue;
            double distance = candidate.getLocation().distanceSquared(victim.getLocation());
            if (distance < nearest) {
                nearest = distance;
                pusher = candidate;
            }
        }
        if (pusher == null) return;

        plugin.getAttribution().recordPush(victim.getUniqueId(), pusher.getUniqueId());
    }
}
