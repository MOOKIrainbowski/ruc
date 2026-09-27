package kr.rucserver.peace.service;

import kr.rucserver.core.util.DamageOrigin;
import kr.rucserver.peace.RucPeace;
import org.bukkit.Location;
import org.bukkit.NamespacedKey;
import org.bukkit.entity.Entity;
import org.bukkit.entity.Player;

import java.util.Iterator;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.CopyOnWriteArrayList;

/**
 * "이 죽음의 원인이 사람인가" 를 판정할 재료를 모아 둡니다 (§2.5).
 *
 * <h2>왜 장부가 필요한가</h2>
 * 바닐라는 피해의 출처를 일부만 알려 줍니다. 화살은 쏜 사람을 들고 있지만,
 * 다음 세 가지는 <b>아무 흔적도 남지 않습니다</b>:
 *
 * <ul>
 *   <li><b>엔드 크리스탈 · TNT 마인카트</b> — 누가 놓았는지 기록되지 않습니다.
 *       터진 뒤에는 알 방법이 없으므로 <b>놓는 순간</b> 엔티티에 표식을 붙입니다.</li>
 *   <li><b>베드 · 리스폰 앵커 폭발</b> — 폭발 주체가 엔티티가 아니라 블록이라
 *       가해자가 없습니다. 터뜨린 사람과 위치를 따로 적어 둡니다.</li>
 *   <li><b>낙하 · 용암 유도</b> — 피해 원인이 {@code FALL}/{@code LAVA} 라서
 *       가해자가 사라집니다. 밀친 사람을 짧게 기억합니다.</li>
 * </ul>
 *
 * <h2>왜 시간 제한이 있는가</h2>
 * 기억을 영구히 남기면 "10분 전에 나를 밀친 사람이 있다" 는 이유로 한참 뒤의
 * 사고사까지 사람 탓이 됩니다. 그러면 평화 서버에서 아무도 자연사하지 못합니다.
 * 창(window)을 짧게 두어 <b>인과가 그럴듯한 범위</b>만 봅니다.
 */
public class AttributionService {

    /** 밀침·폭발 기록 한 건. */
    private record Mark(UUID actor, long at) {}

    /** 블록 폭발 기록. 가해 엔티티가 없어 위치로 맞춰야 합니다. */
    private record Blast(String world, double x, double y, double z, UUID actor, long at) {}

    /** 엔티티에 설치자를 적어 두는 PDC 키. 월드 저장에 함께 남습니다. */
    private final NamespacedKey placerKey;

    private final RucPeace plugin;

    /** 피해자 → 마지막으로 밀친 사람. */
    private final Map<UUID, Mark> pushes = new ConcurrentHashMap<>();

    /** 최근 블록 폭발(베드·앵커). 위치로 맞추므로 목록입니다. */
    private final List<Blast> blasts = new CopyOnWriteArrayList<>();

    public AttributionService(RucPeace plugin) {
        this.plugin = plugin;
        this.placerKey = new NamespacedKey(plugin, "peace_placer");
    }

    public NamespacedKey placerKey() {
        return placerKey;
    }

    private long windowMillis() {
        return plugin.getConfig().getLong("attribution.window-seconds", 10) * 1000L;
    }

    // ── 설치자 표식 ────────────────────────────────────────────────────

    /** 엔드 크리스탈·TNT 마인카트를 놓는 순간 설치자를 적어 둡니다. */
    public void stampPlacer(Entity entity, Player placer) {
        DamageOrigin.stampPlacer(entity, placerKey, placer.getUniqueId());
    }

    // ── 밀침 ──────────────────────────────────────────────────────────

    /**
     * {@code actor} 가 {@code victim} 을 밀었습니다.
     *
     * 낚싯대 끌기, 공격 넉백, 폭발 넉백이 모두 여기로 들어옵니다. 밀친 뒤
     * 창 안에 낙하·용암으로 죽으면 그 죽음의 원인으로 봅니다.
     */
    public void recordPush(UUID victim, UUID actor) {
        if (victim.equals(actor)) return;
        pushes.put(victim, new Mark(actor, System.currentTimeMillis()));
    }

    /** 창 안에 이 사람을 밀친 사람. 없으면 null. */
    public UUID recentPusher(UUID victim) {
        Mark mark = pushes.get(victim);
        if (mark == null) return null;
        if (System.currentTimeMillis() - mark.at() > windowMillis()) {
            pushes.remove(victim, mark);
            return null;
        }
        return mark.actor();
    }

    // ── 블록 폭발 (베드 · 리스폰 앵커) ────────────────────────────────

    /** 베드·앵커를 터뜨린 사람과 위치를 적어 둡니다. */
    public void recordBlast(Location location, UUID actor) {
        if (location.getWorld() == null) return;
        blasts.add(new Blast(location.getWorld().getName(),
                location.getX(), location.getY(), location.getZ(),
                actor, System.currentTimeMillis()));
    }

    /**
     * 이 위치의 블록 폭발을 일으킨 사람. 없으면 null.
     *
     * 반경으로 맞춥니다 — 폭발 지점과 피해자의 위치가 정확히 같을 수 없습니다.
     */
    public UUID recentBlaster(Location at) {
        if (at.getWorld() == null) return null;

        long now = System.currentTimeMillis();
        long window = windowMillis();
        double radius = plugin.getConfig().getDouble("attribution.blast-radius", 12);
        double radiusSquared = radius * radius;

        UUID found = null;
        long newest = Long.MIN_VALUE;

        for (Iterator<Blast> it = blasts.iterator(); it.hasNext(); ) {
            Blast blast = it.next();
            if (now - blast.at() > window) continue;          // 정리는 아래 purge 가 합니다
            if (!blast.world().equals(at.getWorld().getName())) continue;

            double dx = blast.x() - at.getX();
            double dy = blast.y() - at.getY();
            double dz = blast.z() - at.getZ();
            if (dx * dx + dy * dy + dz * dz > radiusSquared) continue;

            // 여러 건이 겹치면 가장 최근 것이 원인일 가능성이 높습니다.
            if (blast.at() > newest) {
                newest = blast.at();
                found = blast.actor();
            }
        }
        return found;
    }

    // ── 통합 판정 ──────────────────────────────────────────────────────

    /**
     * 이 엔티티가 준 피해의 가해자. 설치자 표식까지 봅니다.
     *
     * 순서가 중요합니다 — TNT 마인카트를 남이 점화했다면 점화한 쪽이 가해자이고,
     * 아무도 점화하지 않았다면 놓아 둔 쪽이 가해자입니다.
     */
    public UUID actorOf(Entity damager) {
        return DamageOrigin.rootUuid(damager, placerKey);
    }

    // ── 정리 ──────────────────────────────────────────────────────────

    /**
     * 창을 넘긴 기록을 버립니다. 주기 작업에서 부릅니다.
     *
     * 하지 않으면 접속했다 떠난 사람의 기록이 계속 쌓입니다 — 오래 돌아가는
     * 서버에서 조용히 새는 메모리가 됩니다.
     */
    public void purge() {
        long now = System.currentTimeMillis();
        long window = windowMillis();

        pushes.entrySet().removeIf(entry -> now - entry.getValue().at() > window);
        blasts.removeIf(blast -> now - blast.at() > window);
    }

    /** 퇴장 시 정리. */
    public void forget(UUID uuid) {
        pushes.remove(uuid);
    }
}
