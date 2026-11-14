package kr.rucserver.rpg.ui;

import com.google.gson.JsonObject;
import kr.rucserver.rpg.RucRpg;
import kr.rucserver.rpg.character.PlayerUnit;
import kr.rucserver.rpg.item.EquipStore;
import kr.rucserver.rpg.item.ItemService;
import net.kyori.adventure.text.Component;
import net.kyori.adventure.text.format.NamedTextColor;
import org.bukkit.Bukkit;
import org.bukkit.Material;
import org.bukkit.entity.Player;
import org.bukkit.inventory.ItemStack;

import java.util.List;
import java.util.Map;

/**
 * 장비창 (웹 V 창의 장비 칸): 마크에 칸이 없는 장갑 · 망토 · 반지 · 목걸이 · 귀걸이 · 시계 · 인형 · 코스튬 · 헤어.
 * 아래 인벤토리에서 장비를 누르면 맞는 칸에 입음(있던 것은 그 자리로), 위 칸을 누르면 벗음.
 * 투구 · 흉갑 · 바지 · 신발은 바닐라 방어구 칸, 무기는 손에 든 것 (사용자 결정: 기존 방어구 · 검 그대로).
 */
public final class EquipMenu {

    private static final int[] POS = {10, 11, 12, 13, 14, 15, 16, 19, 20, 21, 22};
    private static final String[] NAMES = {"장갑", "망토", "반지", "반지", "목걸이", "귀걸이", "시계", "인형", "코스튬 상의", "코스튬 하의", "헤어"};

    private final RucRpg plugin;

    public EquipMenu(RucRpg plugin) { this.plugin = plugin; }

    public void open(Player p) {
        PlayerUnit u = plugin.runtime().unit(p);
        if (u == null) return;
        EquipStore st = plugin.itemRuntime().equip();
        Map<String, ItemStack> eq = st.of(p.getUniqueId());
        Gui g = new Gui(4, Component.text("장비 — 아래 인벤토리에서 장비를 누르세요", NamedTextColor.DARK_GRAY));
        g.onBack = () -> plugin.menus().main(p);
        for (int i = 0; i < 36; i++) g.set(i, Gui.filler(), null);
        for (int i = 0; i < EquipStore.SLOTS.length; i++) {
            String slot = EquipStore.SLOTS[i];
            ItemStack cur = eq.get(slot);
            if (cur != null) g.set(POS[i], cur.clone(), (pl, t) -> unequip(pl, slot));
            else g.set(POS[i], Gui.icon(Material.LIGHT_GRAY_STAINED_GLASS_PANE, "ui/blank", Component.text(NAMES[i] + " — 비어 있음", NamedTextColor.GRAY), List.of()), null);
        }
        g.set(31, Gui.button("스탯 보기", false, List.of(Gui.gray("장비를 반영한 지금 스탯"))), (pl, t) -> plugin.menus().stats(pl));
        g.onBottom = this::equip;
        g.open(p);
    }

    private void equip(Player p, int invSlot, ItemStack it) {
        ItemService.Inst i = plugin.items().read(it);
        if (i == null) return;
        JsonObject t = plugin.items().tpl(i.tpl());
        String slot = t.has("slot") ? t.get("slot").getAsString() : null;
        if (slot == null) return;
        PlayerUnit u = plugin.runtime().unit(p);
        if (t.get("lv").getAsInt() > u.ch.level) { p.sendMessage(Component.text("Lv" + t.get("lv").getAsInt() + " 부터 장착할 수 있습니다", NamedTextColor.RED)); return; }
        EquipStore st = plugin.itemRuntime().equip();
        Map<String, ItemStack> eq = st.of(p.getUniqueId());
        if (slot.equals("ring")) slot = eq.containsKey("ring1") && !eq.containsKey("ring2") ? "ring2" : "ring1";
        if (!java.util.Arrays.asList(EquipStore.SLOTS).contains(slot)) {
            p.sendMessage(Component.text("이 장비는 바닐라 칸(방어구 칸 · 손)에 입습니다", NamedTextColor.GRAY));
            return;
        }
        ItemStack old = eq.get(slot);
        p.getInventory().setItem(invSlot, old);   // 맞바꿈 (없으면 빈 칸)
        st.set(p.getUniqueId(), slot, it);
        persist(p, slot);
        plugin.itemRuntime().refresh(p);
        open(p);
    }

    private void unequip(Player p, String slot) {
        EquipStore st = plugin.itemRuntime().equip();
        ItemStack cur = st.of(p.getUniqueId()).get(slot);
        if (cur == null) return;
        if (p.getInventory().firstEmpty() < 0) { p.sendMessage(Component.text("인벤토리에 빈 칸이 없습니다", NamedTextColor.RED)); return; }
        st.set(p.getUniqueId(), slot, null);
        p.getInventory().addItem(cur);
        persist(p, slot);
        plugin.itemRuntime().refresh(p);
        open(p);
    }

    private void persist(Player p, String slot) {
        plugin.itemRuntime().equip().saveQueued(p.getUniqueId(), slot, plugin.getLogger());
    }
}
