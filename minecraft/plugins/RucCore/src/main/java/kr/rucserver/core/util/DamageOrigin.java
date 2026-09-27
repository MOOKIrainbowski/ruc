package kr.rucserver.core.util;

import org.bukkit.entity.AreaEffectCloud;
import org.bukkit.entity.Entity;
import org.bukkit.entity.Player;
import org.bukkit.entity.Projectile;
import org.bukkit.entity.Tameable;
import org.bukkit.entity.TNTPrimed;
import org.bukkit.projectiles.ProjectileSource;
import org.bukkit.NamespacedKey;
import org.bukkit.persistence.PersistentDataType;

import java.util.UUID;

/**
 * 피해의 <b>최초 가해 플레이어</b>를 역추적합니다.
 *
 * 두 서버가 같은 판정을 서로 다른 목적으로 씁니다:
 * <ul>
 *   <li>약탈 서버(§2.4) — 전투 태그를 <b>붙이려고</b>. 직접 타격만 보면 원거리·폭발
 *       딜러가 태그를 피해 갑니다.</li>
 *   <li>평화 서버(§2.5) — 살해를 <b>막으려고</b>. 직접 타격만 막으면 크리스탈과
 *       TNT 마인카트로 죽이는 길이 그대로 열립니다.</li>
 * </ul>
 *
 * 같은 규칙이 두 군데에 따로 적히면 반드시 한쪽만 고쳐집니다. 그래서 Core 로
 * 올려 두었습니다.
 *
 * <h2>바닐라가 알려 주는 것과 알려 주지 않는 것</h2>
 * 화살·물약·길들인 동물은 엔티티가 출처를 들고 있어 그대로 따라갈 수 있습니다.
 * 반면 <b>엔드 크리스탈과 TNT 마인카트는 설치자를 기록하지 않습니다.</b> 그것은
 * 설치 시점에 우리가 직접 붙여 둬야 하고({@link #stampPlacer}), 여기서는 그
 * 표식을 읽습니다({@link #stampedPlacer}).
 */
public final class DamageOrigin {

    /** 체인을 따라갈 최대 깊이. 순환·악의적 중첩에서 무한 재귀를 막습니다. */
    private static final int MAX_DEPTH = 4;

    private DamageOrigin() {
    }

    /**
     * 이 엔티티가 준 피해의 최초 가해 플레이어. 사람이 원인이 아니면 null.
     *
     * 화살 → 쏜 사람, 물약 → 던진 사람, TNT → 점화한 사람, 길들인 늑대 → 주인.
     * 체인이 한 단계 더 깊을 수 있어 재귀합니다 (플레이어가 점화한 TNT 가 띄운 화살 등).
     */
    public static Player rootPlayer(Entity damager) {
        return rootPlayer(damager, 0);
    }

    private static Player rootPlayer(Entity damager, int depth) {
        if (damager == null || depth > MAX_DEPTH) return null;

        if (damager instanceof Player player) return player;

        if (damager instanceof Projectile projectile) {
            ProjectileSource shooter = projectile.getShooter();
            if (shooter instanceof Entity entity) return rootPlayer(entity, depth + 1);
            return null;
        }

        if (damager instanceof TNTPrimed tnt) {
            return rootPlayer(tnt.getSource(), depth + 1);
        }

        if (damager instanceof AreaEffectCloud cloud) {
            ProjectileSource source = cloud.getSource();
            if (source instanceof Entity entity) return rootPlayer(entity, depth + 1);
            return null;
        }

        if (damager instanceof Tameable tameable && tameable.getOwner() instanceof Player owner) {
            return owner;
        }

        return null;
    }

    // ── 설치자 표식 ────────────────────────────────────────────────────

    /**
     * 이 엔티티의 설치·소환자를 기록합니다.
     *
     * 엔드 크리스탈과 TNT 마인카트가 대상입니다. 바닐라는 누가 놓았는지 남기지
     * 않으므로, 폭발한 뒤에는 되돌릴 방법이 없습니다. 놓는 순간에 붙여야 합니다.
     *
     * 엔티티의 PDC 는 월드 저장에 함께 들어가므로 서버를 재시작해도 남습니다 —
     * 크리스탈을 미리 깔아 두고 며칠 뒤에 터뜨리는 경로까지 막힙니다.
     */
    public static void stampPlacer(Entity entity, NamespacedKey key, UUID placer) {
        entity.getPersistentDataContainer()
                .set(key, PersistentDataType.STRING, placer.toString());
    }

    /** {@link #stampPlacer} 로 기록된 설치자 UUID. 없으면 null. */
    public static UUID stampedPlacer(Entity entity, NamespacedKey key) {
        String raw = entity.getPersistentDataContainer()
                .get(key, PersistentDataType.STRING);
        if (raw == null) return null;
        try {
            return UUID.fromString(raw);
        } catch (IllegalArgumentException e) {
            // 손상된 값 하나가 판정을 예외로 끊지 않게 합니다.
            return null;
        }
    }

    /**
     * 표식까지 포함한 역추적.
     *
     * 먼저 바닐라 체인을 보고, 거기서 사람이 나오지 않으면 설치자 표식을 봅니다.
     * 순서가 중요합니다 — TNT 마인카트를 남이 점화했다면 점화한 쪽이 가해자이고,
     * 아무도 점화하지 않았다면 놓아 둔 쪽이 가해자입니다.
     *
     * @return 최초 가해자의 UUID. 사람이 원인이 아니면 null
     */
    public static UUID rootUuid(Entity damager, NamespacedKey placerKey) {
        Player direct = rootPlayer(damager);
        if (direct != null) return direct.getUniqueId();
        if (damager == null || placerKey == null) return null;
        return stampedPlacer(damager, placerKey);
    }
}
