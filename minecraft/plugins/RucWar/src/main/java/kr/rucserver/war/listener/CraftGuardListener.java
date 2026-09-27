package kr.rucserver.war.listener;

import kr.rucserver.war.RucWar;
import org.bukkit.event.EventHandler;
import org.bukkit.event.Listener;
import org.bukkit.event.inventory.PrepareAnvilEvent;
import org.bukkit.event.inventory.PrepareItemCraftEvent;
import org.bukkit.event.inventory.PrepareSmithingEvent;
import org.bukkit.inventory.ItemStack;

/**
 * 코어 부품이 <b>바닐라 용도로</b> 소모되는 것을 막습니다.
 *
 * <h2>왜 필요한가</h2>
 * 부품의 겉모습은 바닐라 아이템입니다 — 강화 장갑판은 네더라이트 주괴, 국가
 * 인장은 바다의 심장, 코어는 신호기입니다. 이름과 설명만 바꾼 것이므로,
 * 막지 않으면 이런 일이 실제로 일어납니다:
 *
 * <ul>
 *   <li>강화 장갑판으로 네더라이트 검을 만든다</li>
 *   <li>국가 인장으로 conduit 를 만든다</li>
 *   <li>모루로 코어의 이름을 바꿔 위조를 시도한다</li>
 * </ul>
 *
 * 코어 하나는 길드가 일주일을 모아야 하는 물건입니다(D2). 실수로 검이 되어
 * 사라지는 경로를 열어 둘 수는 없습니다.
 *
 * <h2>판정 방식</h2>
 * "태그 붙은 재료가 들어갔는데 결과물이 우리 것이 아니면 막는다" 입니다.
 * 허용 목록을 따로 관리하지 않아서, 나중에 부품이나 레시피가 늘어도 이 클래스는
 * 고치지 않아도 됩니다.
 */
public class CraftGuardListener implements Listener {

    private final RucWar plugin;

    public CraftGuardListener(RucWar plugin) {
        this.plugin = plugin;
    }

    @EventHandler
    public void onPrepareCraft(PrepareItemCraftEvent event) {
        boolean usesOurPart = false;
        for (ItemStack ingredient : event.getInventory().getMatrix()) {
            if (plugin.getItems().isPart(ingredient)) { usesOurPart = true; break; }
        }
        if (!usesOurPart) return;

        ItemStack result = event.getInventory().getResult();
        // 결과가 우리 부품(장갑판·렌즈·코어)이면 의도한 조합입니다.
        if (result != null && plugin.getItems().isOurResult(result)) return;

        // 그 외에는 이 재료로 만들 수 있는 것이 없는 것으로 둡니다.
        event.getInventory().setResult(null);
    }

    /**
     * 대장장이 테이블 — 네더라이트 업그레이드가 장갑판을 먹는 경로입니다.
     * 겉모습이 네더라이트 주괴라서 바닐라 레시피에 그대로 맞습니다.
     */
    @EventHandler
    public void onPrepareSmithing(PrepareSmithingEvent event) {
        var inventory = event.getInventory();
        if (plugin.getItems().isPart(inventory.getInputEquipment())
                || plugin.getItems().isPart(inventory.getInputMineral())
                || plugin.getItems().isPart(inventory.getInputTemplate())) {
            event.setResult(null);
        }
    }

    /**
     * 모루 — 이름 변경으로 위조하거나, 부품을 장비 수리에 써 버리는 것을 막습니다.
     *
     * 판별 자체는 PDC 로 하므로 이름을 바꿔도 위조는 성립하지 않습니다. 다만
     * 이름이 바뀌면 플레이어가 무엇인지 알 수 없게 되고, 반대로 평범한 아이템을
     * "국가 인장" 이라고 이름 붙여 남을 속이는 사기가 가능해집니다.
     */
    @EventHandler
    public void onPrepareAnvil(PrepareAnvilEvent event) {
        var inventory = event.getInventory();
        if (plugin.getItems().isPart(inventory.getFirstItem())
                || plugin.getItems().isPart(inventory.getSecondItem())) {
            event.setResult(null);
        }
    }
}
