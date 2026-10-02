package kr.rucserver.core.menu;

import org.bukkit.inventory.Inventory;
import org.bukkit.inventory.InventoryHolder;
import org.jetbrains.annotations.NotNull;

import java.util.HashMap;
import java.util.Map;

/**
 * 메뉴 인벤토리임을 표시하는 홀더.
 *
 * 제목 문자열을 비교해서 "우리 메뉴인지" 판단하면 안 됩니다. 제목은 번역되고,
 * 색코드가 붙고, 플레이어 언어에 따라 달라지기 때문에 조금만 바뀌어도 클릭
 * 차단이 통째로 풀립니다. 홀더 타입으로 보면 그런 일이 없습니다.
 *
 * <h2>목록 화면의 상태도 여기에 둡니다</h2>
 * 우편함(Phase 5.5)처럼 여러 장으로 나뉘는 화면은 "지금 몇 장째인지" 와
 * "이 칸이 어떤 행인지" 를 알아야 합니다. 그것을 서비스 쪽 Map&lt;UUID, ...&gt;
 * 에 들고 있으면, 창을 두 개 열거나 퇴장하면서 남는 유령 상태를 따로 치워야
 * 합니다. 창이 닫히면 같이 사라지는 곳 = 홀더가 제자리입니다.
 */
public class MenuHolder implements InventoryHolder {

    public enum Type {
        MAIN,
        SERVERS,
        HELP,
        MAILBOX,
        /** 유저 상점 (Phase 10) — 전체 매물 · 내 판매 목록 · 구매 확인창 */
        SHOP,
        SHOP_MINE,
        SHOP_CONFIRM,
        /** 가이드 (Phase 11) */
        GUIDE
    }

    private final Type type;
    private Inventory inventory;

    /** 목록 화면에서 0부터 시작하는 현재 장. */
    private int page;

    /** 목록 화면에서 칸 번호 → 그 칸이 가리키는 행의 id (우편 id 등). */
    private final Map<Integer, Long> slotIds = new HashMap<>();

    public MenuHolder(Type type) {
        this.type = type;
    }

    public Type getType() {
        return type;
    }

    public void setInventory(Inventory inventory) {
        this.inventory = inventory;
    }

    public int getPage() {
        return page;
    }

    public void setPage(int page) {
        this.page = page;
    }

    public void mapSlot(int slot, long id) {
        slotIds.put(slot, id);
    }

    /** 그 칸이 가리키는 id. 없으면 -1. */
    public long idAt(int slot) {
        Long id = slotIds.get(slot);
        return id == null ? -1 : id;
    }

    /** 이 장에 올라와 있는 id 전부. '모두 받기' 가 씁니다. */
    public java.util.Collection<Long> ids() {
        return slotIds.values();
    }

    @Override
    public @NotNull Inventory getInventory() {
        return inventory;
    }
}
