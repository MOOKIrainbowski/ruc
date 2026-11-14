package kr.rucserver.rpg.item;

import org.bukkit.inventory.ItemStack;

/**
 * RPG 아이템 (M4). 지금은 스킬 엔진이 부르는 두 가지만 — RPG 무기 템플릿이 생기면 여기서 템플릿의 basic · 무기 여부를 돌려줌.
 */
public class ItemService {
    /** 이 아이템의 평타 스킬 id (RPG 무기가 아니면 null → 바닐라 재료로 판단) */
    public String basicOf(ItemStack it) { return null; }
    /** RPG 무기인가 */
    public boolean isWeapon(ItemStack it) { return false; }
}
