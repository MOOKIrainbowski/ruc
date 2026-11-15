package kr.rucserver.rpg.item;

import com.google.gson.JsonObject;
import kr.rucserver.rpg.RucRpg;
import kr.rucserver.rpg.character.PlayerUnit;
import kr.rucserver.rpg.ui.Gui;
import net.kyori.adventure.text.Component;
import net.kyori.adventure.text.format.NamedTextColor;
import org.bukkit.Bukkit;
import org.bukkit.Material;
import org.bukkit.NamespacedKey;
import org.bukkit.entity.Player;
import org.bukkit.event.EventHandler;
import org.bukkit.event.EventPriority;
import org.bukkit.event.Listener;
import org.bukkit.event.entity.PlayerDeathEvent;
import org.bukkit.event.inventory.ClickType;
import org.bukkit.event.inventory.InventoryClickEvent;
import org.bukkit.event.inventory.InventoryCloseEvent;
import org.bukkit.event.inventory.InventoryDragEvent;
import org.bukkit.event.inventory.InventoryType;
import org.bukkit.event.inventory.PrepareItemCraftEvent;
import org.bukkit.event.player.PlayerJoinEvent;
import org.bukkit.event.player.PlayerQuitEvent;
import org.bukkit.event.player.PlayerRespawnEvent;
import org.bukkit.inventory.CraftingInventory;
import org.bukkit.inventory.InventoryView;
import org.bukkit.inventory.ItemStack;
import org.bukkit.persistence.PersistentDataType;

import java.util.List;
import java.util.Map;

/**
 * 장신구 칸 (사용자 지시 2026-11-15: "E 인벤토리의 방패 칸 쪽에 반지 · 인형 등 장착 칸, 종류마다 하나") — 결정 R11.
 * 바닐라 화면에 새 칸을 만들 수 없어, 그 자리의 빈 칸 = **제작 2×2 네 칸 + 왼손(방패) 칸** = 5칸을 장신구 칸으로 씀.
 *   제작 칸 1 목걸이 · 2 귀걸이 · 3 반지 · 4 장갑 · 왼손 = 망토   (웹 EQUIP_SLOTS 중 아이템이 있는 다섯 종류, 반지는 하나)
 * 원본 = EquipStore(DB). 칸에 보이는 것은 그 사본(또는 빈 칸 안내 아이콘). 클릭은 전부 직접 처리(바닐라 이동 취소):
 *   커서에 장신구를 들고 칸 클릭 = 장착(있던 것과 맞바꿈) · 빈 손으로 클릭 = 벗기(커서로, Shift = 인벤토리로).
 * 닫기 · 죽음 · 나가기 전에 칸을 비워 바닐라가 "제작 칸 아이템 돌려주기"로 복사본을 만들지 않게 하고, 다음 틱에 다시 그림.
 */
public final class AccessorySlots implements Listener {

    /** 원시 칸 번호(플레이어 인벤토리 화면) → 장비 칸 */
    private static final Map<Integer, String> RAW = Map.of(1, "necklace", 2, "earring", 3, "ring1", 4, "gloves", 45, "cape");
    private static final Map<String, String> NAME = Map.of("necklace", "목걸이", "earring", "귀걸이", "ring1", "반지", "gloves", "장갑", "cape", "망토");

    private final RucRpg plugin;
    private final NamespacedKey ghost;

    public AccessorySlots(RucRpg plugin) {
        this.plugin = plugin;
        this.ghost = new NamespacedKey(plugin, "acc_ghost");
    }

    private EquipStore store() { return plugin.itemRuntime().equip(); }

    /** 빈 칸 안내 아이콘 (클릭해도 안 집힘) */
    private ItemStack placeholder(String slot) {
        ItemStack it = Gui.icon(Material.LIGHT_GRAY_STAINED_GLASS_PANE, "ui/slot_" + slot, Component.text(NAME.get(slot) + " 칸", NamedTextColor.GRAY),
                List.of(Gui.gray(NAME.get(slot) + " 을(를) 들고 여기를 누르면 장착")));
        var m = it.getItemMeta();
        m.getPersistentDataContainer().set(ghost, PersistentDataType.BYTE, (byte) 1);
        it.setItemMeta(m);
        return it;
    }

    private boolean isGhost(ItemStack it) { return it != null && it.hasItemMeta() && it.getItemMeta().getPersistentDataContainer().has(ghost); }

    private static String slotOf(JsonObject t) {
        String s = t.has("slot") ? t.get("slot").getAsString() : null;
        return "ring".equals(s) ? "ring1" : s;
    }

    /** 칸 다섯 개를 원본대로 다시 그림 */
    public void draw(Player p) {
        if (plugin.runtime().unit(p) == null) return;
        Map<String, ItemStack> eq = store().of(p.getUniqueId());
        if (p.getOpenInventory().getTopInventory() instanceof CraftingInventory c && c.getType() == InventoryType.CRAFTING) {
            for (int raw = 1; raw <= 4; raw++) { String s = RAW.get(raw); ItemStack cur = eq.get(s); c.setItem(raw, cur != null ? cur.clone() : placeholder(s)); }
        }
        ItemStack cape = eq.get("cape");
        p.getInventory().setItemInOffHand(cape != null ? cape.clone() : placeholder("cape"));
    }

    private void clear(Player p) {
        if (p.getOpenInventory().getTopInventory() instanceof CraftingInventory c && c.getType() == InventoryType.CRAFTING)
            for (int raw = 1; raw <= 4; raw++) c.setItem(raw, null);
    }

    private boolean playerView(InventoryView v) { return v.getTopInventory().getType() == InventoryType.CRAFTING; }

    @EventHandler(priority = EventPriority.HIGHEST)
    public void onClick(InventoryClickEvent e) {
        if (!(e.getWhoClicked() instanceof Player p) || plugin.runtime().unit(p) == null) return;
        boolean own = playerView(e.getView());
        String slot = own ? RAW.get(e.getRawSlot()) : null;
        if (slot == null && e.getClick() == ClickType.SWAP_OFFHAND) { e.setCancelled(true); return; }   // F 로 왼손(망토 칸)에 넣기 막기
        if (slot == null) {
            if (isGhost(e.getCurrentItem())) e.setCancelled(true);
            return;
        }
        e.setCancelled(true);
        ItemStack cursor = p.getItemOnCursor();
        Map<String, ItemStack> eq = store().of(p.getUniqueId());
        ItemStack cur = eq.get(slot);
        if (cursor != null && !cursor.getType().isAir()) {   // 장착
            ItemService.Inst i = plugin.items().read(cursor);
            JsonObject t = i == null ? null : plugin.items().tpl(i.tpl());
            if (t == null || !slot.equals(slotOf(t))) { p.sendActionBar(Component.text("이 칸에는 " + NAME.get(slot) + "만 낄 수 있습니다", NamedTextColor.RED)); return; }
            PlayerUnit u = plugin.runtime().unit(p);
            if (t.has("lv") && t.get("lv").getAsInt() > u.ch.level) { p.sendActionBar(Component.text("Lv" + t.get("lv").getAsInt() + " 부터 장착할 수 있습니다", NamedTextColor.RED)); return; }
            store().set(p.getUniqueId(), slot, cursor.clone());
            p.setItemOnCursor(cur);   // 끼고 있던 것은 커서로(맞바꿈)
        } else if (cur != null) {   // 벗기
            if (e.isShiftClick()) {
                if (p.getInventory().firstEmpty() < 0) { p.sendActionBar(Component.text("인벤토리에 빈 칸이 없습니다", NamedTextColor.RED)); return; }
                store().set(p.getUniqueId(), slot, null);
                p.getInventory().addItem(cur);
            } else {
                store().set(p.getUniqueId(), slot, null);
                p.setItemOnCursor(cur);
            }
        } else return;
        store().saveQueued(p.getUniqueId(), slot, plugin.getLogger());
        plugin.itemRuntime().refresh(p);
        Bukkit.getScheduler().runTask(plugin, () -> { draw(p); p.updateInventory(); });
    }

    @EventHandler(priority = EventPriority.HIGHEST)
    public void onDrag(InventoryDragEvent e) {
        if (!playerView(e.getView())) return;
        for (int raw : e.getRawSlots()) if (RAW.containsKey(raw)) { e.setCancelled(true); return; }
    }

    /** 제작 칸에 장신구가 있으니 바닐라 제작 결과는 언제나 없음 */
    @EventHandler
    public void onCraft(PrepareItemCraftEvent e) {
        if (e.getInventory().getType() == InventoryType.CRAFTING && e.getView().getPlayer() instanceof Player p && plugin.runtime().unit(p) != null) e.getInventory().setResult(null);
    }

    @EventHandler(priority = EventPriority.LOWEST)
    public void onClose(InventoryCloseEvent e) {
        if (!(e.getPlayer() instanceof Player p) || !playerView(e.getView())) return;
        clear(p);   // 바닐라가 돌려줄 것이 없게
        Bukkit.getScheduler().runTask(plugin, () -> draw(p));
    }

    @EventHandler(priority = EventPriority.LOWEST)
    public void onDeath(PlayerDeathEvent e) {
        clear(e.getPlayer());
        e.getDrops().removeIf(this::isGhost);
        e.getPlayer().getInventory().setItemInOffHand(null);   // 망토 사본이 떨어지지 않게 (원본은 DB)
        e.getDrops().removeIf(it -> { ItemService.Inst i = plugin.items().read(it); return i != null && store().of(e.getPlayer().getUniqueId()).values().stream().anyMatch(x -> { ItemService.Inst j = plugin.items().read(x); return j != null && i.uid() != null && i.uid().equals(j.uid()); }); });
    }

    @EventHandler(priority = EventPriority.LOWEST)
    public void onQuit(PlayerQuitEvent e) {
        clear(e.getPlayer());
        e.getPlayer().getInventory().setItemInOffHand(null);   // 저장되는 플레이어 데이터에 사본을 남기지 않음
    }

    @EventHandler
    public void onRespawn(PlayerRespawnEvent e) { Bukkit.getScheduler().runTaskLater(plugin, () -> draw(e.getPlayer()), 2L); }

    /**
     * 접속: 장비를 불러온 뒤 그림. 예전 데이터 정리 — 반지 2번째 칸(이제 하나만)은 인벤토리로, 왼손에 있던 진짜 아이템(사본 · 안내가 아닌)도 인벤토리로.
     */
    @EventHandler
    public void onJoin(PlayerJoinEvent e) {
        Player p = e.getPlayer();
        Bukkit.getScheduler().runTaskLater(plugin, () -> {
            if (!p.isOnline() || plugin.runtime().unit(p) == null) return;
            ItemStack off = p.getInventory().getItemInOffHand();
            if (!off.getType().isAir() && !isGhost(off)) {
                ItemService.Inst oi = plugin.items().read(off);
                ItemStack cape = store().of(p.getUniqueId()).get("cape");
                ItemService.Inst ci = plugin.items().read(cape);
                boolean copy = oi != null && ci != null && oi.uid() != null && oi.uid().equals(ci.uid());
                if (!copy) { p.getInventory().setItemInOffHand(null); p.getInventory().addItem(off).values().forEach(x -> p.getWorld().dropItem(p.getLocation(), x)); }
            }
            ItemStack ring2 = store().of(p.getUniqueId()).get("ring2");
            if (ring2 != null) {
                store().set(p.getUniqueId(), "ring2", null);
                store().saveQueued(p.getUniqueId(), "ring2", plugin.getLogger());
                p.getInventory().addItem(ring2).values().forEach(x -> p.getWorld().dropItem(p.getLocation(), x));
                p.sendMessage(Component.text("반지는 이제 하나만 낄 수 있어 두 번째 반지를 인벤토리로 옮겼습니다", NamedTextColor.YELLOW));
                plugin.itemRuntime().refresh(p);
            }
            draw(p);
        }, 60L);
    }
}
