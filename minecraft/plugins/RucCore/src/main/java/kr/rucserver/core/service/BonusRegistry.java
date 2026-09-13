package kr.rucserver.core.service;

import java.util.List;
import java.util.UUID;
import java.util.concurrent.CopyOnWriteArrayList;

/**
 * 획득량 배수 훅.
 *
 * 드래곤 알(D3)처럼 "Ruc +15%, XP +10%" 같은 효과는 서버별 모듈이 소유하는데,
 * 정작 지급은 Core의 XpService/EconomyService가 합니다. 모듈이 여기에 배수를
 * 등록해 두면 Core가 지급 직전에 곱합니다.
 *
 * 중요: 배수는 <b>벌어들인</b> 보상에만 적용됩니다. 송금(transfer)에 적용하면
 * 알 소지자를 경유시켜 화폐를 찍어낼 수 있으므로, EconomyService는 deposit이
 * 아니라 reward()에서만 이 배수를 씁니다.
 */
public class BonusRegistry {

    /** 1.0 = 변화 없음. 여러 소스가 등록되면 전부 곱해집니다. */
    public interface Multiplier {
        double of(UUID uuid);
    }

    private final List<Multiplier> xp = new CopyOnWriteArrayList<>();
    private final List<Multiplier> ruc = new CopyOnWriteArrayList<>();

    public void registerXp(Multiplier m) { xp.add(m); }
    public void registerRuc(Multiplier m) { ruc.add(m); }

    public void unregisterXp(Multiplier m) { xp.remove(m); }
    public void unregisterRuc(Multiplier m) { ruc.remove(m); }

    public double xpMultiplier(UUID uuid) { return product(xp, uuid); }
    public double rucMultiplier(UUID uuid) { return product(ruc, uuid); }

    private double product(List<Multiplier> list, UUID uuid) {
        double result = 1.0;
        for (Multiplier m : list) {
            double v = m.of(uuid);
            // 잘못 등록된 소스가 보상을 0이나 음수로 만들지 못하게 막습니다.
            if (v > 0) result *= v;
        }
        return result;
    }

    /** 배수를 적용한 금액. 1 이상 지급되도록 올림합니다. */
    public long applyXp(UUID uuid, long amount) { return scale(amount, xpMultiplier(uuid)); }
    public long applyRuc(UUID uuid, long amount) { return scale(amount, rucMultiplier(uuid)); }

    private long scale(long amount, double multiplier) {
        if (amount <= 0 || multiplier == 1.0) return amount;
        return Math.max(1, Math.round(amount * multiplier));
    }
}
