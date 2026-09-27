package kr.rucserver.peace.service;

import kr.rucserver.peace.RucPeace;
import org.bukkit.Bukkit;
import org.bukkit.entity.Player;
import org.bukkit.event.entity.EntityDamageEvent;

import java.util.EnumSet;
import java.util.Set;
import java.util.UUID;

/**
 * 평화 서버의 살해 차단 판정 (§2.5).
 *
 * <h2>규칙은 "죽이지 못한다" 입니다</h2>
 * 명세는 플레이어가 다른 플레이어를 <b>죽일 수 없다</b>고 합니다. 모든 피해를
 * 막으라는 것이 아닙니다. 이 구분이 설계의 중심입니다:
 *
 * <ul>
 *   <li><b>직접 피해</b>(때리기·화살·물약)는 그냥 막습니다. 평화 서버에서 서로
 *       때리는 것 자체가 의미 없고, 넉백까지 함께 사라져 "밀어서 떨어뜨리기"의
 *       가장 쉬운 경로가 닫힙니다.</li>
 *   <li><b>환경 피해</b>(낙하·용암·폭발)는 사람이 원인일 때 <b>치명타만</b>
 *       막습니다. 밀려서 하트 두 개를 잃는 것까지 막으면 세계가 가짜가 되고,
 *       실수로 남을 스치기만 해도 서버가 그 사람을 가해자로 취급합니다.</li>
 * </ul>
 *
 * 막힌 치명타는 전부 기록합니다 — 막았다는 것은 <b>누군가 죽이려 했다</b>는
 * 뜻이고, 그것이 §2.5 가 말하는 "테러·그리핑" 의 증거입니다.
 */
public class GuardService {

    /**
     * 사람이 유도할 수 있는 환경 피해.
     *
     * 이 목록에 없는 원인(굶주림·독·시듦 등)은 남이 만들 수 없으므로 보지 않습니다.
     * 넓게 잡으면 자연사까지 사람 탓이 되어 판정이 무의미해집니다.
     */
    private static final Set<EntityDamageEvent.DamageCause> PUSHABLE = EnumSet.of(
            EntityDamageEvent.DamageCause.FALL,
            EntityDamageEvent.DamageCause.LAVA,
            EntityDamageEvent.DamageCause.FIRE,
            EntityDamageEvent.DamageCause.FIRE_TICK,
            EntityDamageEvent.DamageCause.DROWNING,
            EntityDamageEvent.DamageCause.VOID,
            EntityDamageEvent.DamageCause.SUFFOCATION,
            EntityDamageEvent.DamageCause.CONTACT,
            EntityDamageEvent.DamageCause.HOT_FLOOR,
            EntityDamageEvent.DamageCause.FLY_INTO_WALL,
            EntityDamageEvent.DamageCause.CRAMMING,
            EntityDamageEvent.DamageCause.FREEZE);

    /** 폭발 — 가해자가 엔티티일 수도(크리스탈·TNT) 블록일 수도(베드·앵커) 있습니다. */
    private static final Set<EntityDamageEvent.DamageCause> EXPLOSIVE = EnumSet.of(
            EntityDamageEvent.DamageCause.ENTITY_EXPLOSION,
            EntityDamageEvent.DamageCause.BLOCK_EXPLOSION);

    private final RucPeace plugin;
    private final AttributionService attribution;

    public GuardService(RucPeace plugin, AttributionService attribution) {
        this.plugin = plugin;
        this.attribution = attribution;
    }

    /** 판정 결과. */
    public record Verdict(boolean block, UUID actor, String kind) {
        static final Verdict ALLOW = new Verdict(false, null, null);

        static Verdict block(UUID actor, String kind) {
            return new Verdict(true, actor, kind);
        }
    }

    /**
     * 이 피해를 막아야 하는지.
     *
     * @param victim 피해자
     * @param event  피해 이벤트. {@code getFinalDamage()} 를 쓰므로 다른 플러그인의
     *               보정이 끝난 뒤(HIGHEST) 에 부르는 것을 전제로 합니다
     */
    public Verdict judge(Player victim, EntityDamageEvent event) {
        if (victim.hasPermission("rucpeace.bypass")) return Verdict.ALLOW;

        EntityDamageEvent.DamageCause cause = event.getCause();

        // ── 1. 폭발: 크리스탈 · TNT · TNT 마인카트 · 베드 · 앵커 ──
        if (EXPLOSIVE.contains(cause)) {
            org.bukkit.entity.Entity damager =
                    event instanceof org.bukkit.event.entity.EntityDamageByEntityEvent byEntity
                            ? byEntity.getDamager() : null;

            /*
             * 사람이 만든 폭발물은 <b>가해자를 몰라도</b> 막습니다.
             *
             * 처음에는 가해자를 찾아낸 경우에만 막게 했는데, 그러면 뚫리는
             * 경로가 남습니다:
             *   - 레드스톤으로 점화한 TNT 는 getSource() 가 비어 있습니다
             *   - 플러그인을 깔기 전에 놓아 둔 크리스탈에는 표식이 없습니다
             *   - 누가 놓았는지 모르게 만드는 방법은 앞으로도 더 나올 것입니다
             *
             * 평화 서버에서 <b>플레이어가 TNT·크리스탈·베드 폭발로 피해를 입어야
             * 할 이유가 없습니다.</b> 그래서 귀속을 보호의 조건으로 쓰지 않고,
             * 기록에 이름을 남기는 데만 씁니다. 크리퍼·가스트처럼 자연히 생기는
             * 폭발은 이 서버의 정당한 위험이라 그대로 둡니다.
             */
            boolean manMade = cause == EntityDamageEvent.DamageCause.BLOCK_EXPLOSION
                    || damager instanceof org.bukkit.entity.TNTPrimed
                    || damager instanceof org.bukkit.entity.EnderCrystal
                    || damager instanceof org.bukkit.entity.minecart.ExplosiveMinecart;

            if (!manMade) return Verdict.ALLOW;

            UUID actor = damager == null ? null : attribution.actorOf(damager);
            if (actor == null) actor = attribution.recentBlaster(victim.getLocation());

            // 자기 TNT 로 자기가 다치는 것까지 막습니다. 채굴 중 실수로 죽는 것을
            // 막아 주는 셈이고, 평화 서버에서 잃을 것이 없습니다.
            if (actor != null && actor.equals(victim.getUniqueId())) {
                return Verdict.block(null, "self-explosion");
            }
            return Verdict.block(actor, "explosion");
        }

        // ── 2. 직접 피해: 때리기 · 화살 · 물약 · 길들인 동물 ──
        if (event instanceof org.bukkit.event.entity.EntityDamageByEntityEvent byEntity) {
            UUID actor = attribution.actorOf(byEntity.getDamager());
            if (actor != null && !actor.equals(victim.getUniqueId())) {
                return Verdict.block(actor, "direct");
            }
            return Verdict.ALLOW;
        }

        // ── 3. 유도된 환경 피해: 치명타만 막습니다 ──
        if (!PUSHABLE.contains(cause)) return Verdict.ALLOW;

        UUID pusher = attribution.recentPusher(victim.getUniqueId());
        if (pusher == null) return Verdict.ALLOW;

        if (!wouldBeFatal(victim, event)) return Verdict.ALLOW;

        return Verdict.block(pusher, "lured-" + cause.name().toLowerCase(java.util.Locale.ROOT));
    }

    /**
     * 이 피해로 죽는지.
     *
     * 흡수(황금 사과)까지 더해 봅니다. 체력만 보면 흡수로 버틸 수 있는 피해를
     * 치명타로 오판해서, 죽지도 않을 상황에 개입하게 됩니다.
     */
    public boolean wouldBeFatal(Player victim, EntityDamageEvent event) {
        double effective = victim.getHealth() + victim.getAbsorptionAmount();
        return effective - event.getFinalDamage() <= 0;
    }

    /**
     * 막았다는 사실을 알립니다.
     *
     * 피해자에게는 알리고, 가해자에게는 <b>막혔다는 것만</b> 알립니다. 가해자에게
     * 상세를 알려 주면 "어떻게 하면 통과하는지" 를 실험하게 됩니다.
     */
    public void notify(Player victim, Verdict verdict) {
        plugin.msg().sendActionBar(victim, "peace.protected");

        Player actor = verdict.actor() == null ? null : Bukkit.getPlayer(verdict.actor());
        if (actor != null && !actor.equals(victim)) {
            plugin.msg().send(actor, "peace.blocked");
        }
    }
}
