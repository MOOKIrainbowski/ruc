package kr.rucserver.core.service;

import kr.rucserver.core.RucCore;
import kr.rucserver.core.model.RucPlayer;

import java.util.UUID;

/**
 * Ruc 화폐 (§3.1).
 *
 * 잔고는 ruc_player 테이블 하나에만 있고 4개 서버가 같은 DB를 보므로,
 * 어느 서버에서 벌어도 같은 지갑입니다.
 *
 * 주의: 접속 중이 아닌 플레이어의 잔고를 바꾸려면 Repository를 직접 써야 합니다.
 * 여기 메서드들은 캐시에 있는(= 접속 중인) 플레이어만 다룹니다.
 */
public class EconomyService {

    private final RucCore plugin;

    public EconomyService(RucCore plugin) {
        this.plugin = plugin;
    }

    public String symbol() {
        return plugin.getConfig().getString("economy.symbol", "Ruc");
    }

    public long balance(UUID uuid) {
        RucPlayer data = plugin.getPlayerData().get(uuid);
        return data == null ? 0 : data.getRuc();
    }

    public boolean has(UUID uuid, long amount) {
        return balance(uuid) >= amount;
    }

    /** 지급. 음수는 무시합니다. */
    public boolean deposit(UUID uuid, long amount) {
        if (amount <= 0) return false;
        RucPlayer data = plugin.getPlayerData().get(uuid);
        if (data == null) return false;

        data.setRuc(data.getRuc() + amount);
        plugin.getPlayerData().saveAsync(data);
        return true;
    }

    /** 차감. 잔고가 부족하면 아무것도 하지 않고 false. */
    public boolean withdraw(UUID uuid, long amount) {
        if (amount <= 0) return false;
        RucPlayer data = plugin.getPlayerData().get(uuid);
        if (data == null) return false;
        if (data.getRuc() < amount) return false;

        data.setRuc(data.getRuc() - amount);
        plugin.getPlayerData().saveAsync(data);
        return true;
    }

    /**
     * 벌어들인 보상 지급. 드래곤 알 같은 획득량 배수(D3)가 여기에만 적용됩니다.
     *
     * deposit()이 아니라 별도 메서드로 둔 이유: transfer()가 deposit()을 쓰기 때문에
     * deposit에 배수를 넣으면 알 소지자에게 송금했다 돌려받는 것만으로 화폐가
     * 늘어납니다. "번 돈"과 "받은 돈"을 분리해야 합니다.
     */
    public boolean reward(UUID uuid, long amount) {
        return deposit(uuid, plugin.getBonuses().applyRuc(uuid, amount));
    }

    /**
     * 송금. 둘 다 접속 중이어야 합니다.
     * 차감이 성공한 뒤에만 지급하므로 중간에 실패해도 화폐가 복사되지 않습니다.
     */
    public boolean transfer(UUID from, UUID to, long amount) {
        if (amount <= 0 || from.equals(to)) return false;
        if (!withdraw(from, amount)) return false;

        if (!deposit(to, amount)) {
            // 지급 실패 시 되돌립니다 (받는 쪽이 접속을 끊은 경우 등)
            deposit(from, amount);
            return false;
        }
        return true;
    }

    /** 1,234,567 형태로 포맷. */
    public static String format(long amount) {
        return String.format("%,d", amount);
    }
}
