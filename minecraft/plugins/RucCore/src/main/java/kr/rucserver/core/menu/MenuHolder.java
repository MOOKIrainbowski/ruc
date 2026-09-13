package kr.rucserver.core.menu;

import org.bukkit.inventory.Inventory;
import org.bukkit.inventory.InventoryHolder;
import org.jetbrains.annotations.NotNull;

/**
 * 메뉴 인벤토리임을 표시하는 홀더.
 *
 * 제목 문자열을 비교해서 "우리 메뉴인지" 판단하면 안 됩니다. 제목은 번역되고,
 * 색코드가 붙고, 플레이어 언어에 따라 달라지기 때문에 조금만 바뀌어도 클릭
 * 차단이 통째로 풀립니다. 홀더 타입으로 보면 그런 일이 없습니다.
 */
public class MenuHolder implements InventoryHolder {

    public enum Type {
        MAIN,
        SERVERS,
        HELP
    }

    private final Type type;
    private Inventory inventory;

    public MenuHolder(Type type) {
        this.type = type;
    }

    public Type getType() {
        return type;
    }

    public void setInventory(Inventory inventory) {
        this.inventory = inventory;
    }

    @Override
    public @NotNull Inventory getInventory() {
        return inventory;
    }
}
