package kr.rucserver.rpg.ui;

import net.kyori.adventure.text.Component;
import net.kyori.adventure.text.format.NamedTextColor;
import net.kyori.adventure.text.format.TextColor;
import net.kyori.adventure.text.format.TextDecoration;
import org.bukkit.Bukkit;
import org.bukkit.Material;
import org.bukkit.NamespacedKey;
import org.bukkit.Sound;
import org.bukkit.entity.Player;
import org.bukkit.event.EventHandler;
import org.bukkit.event.Listener;
import org.bukkit.event.inventory.ClickType;
import org.bukkit.event.inventory.InventoryClickEvent;
import org.bukkit.event.inventory.InventoryCloseEvent;
import org.bukkit.event.inventory.InventoryDragEvent;
import org.bukkit.inventory.Inventory;
import org.bukkit.inventory.InventoryHolder;
import org.bukkit.inventory.ItemFlag;
import org.bukkit.inventory.ItemStack;
import org.bukkit.inventory.meta.ItemMeta;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.function.BiConsumer;

/**
 * RPG 창(팝업) — 상자 GUI 위에 칸마다 버튼. 웹 RPG 창처럼 탭 · 버튼 · 툴팁(로어). 아이템을 꺼낼 수 없음.
 * 아이콘 = 리소스팩 item_model (pack-models.json 에 있는 것만 — 없으면 바닐라 재료 그대로, 보라 검정 방지).
 * Esc 로 닫으면 부모 창으로 돌아감 (웹: Esc = 가장 위 팝업부터 닫기).
 */
public final class Gui implements InventoryHolder {

    public interface Click { void on(Player p, ClickType t); }

    private final Inventory inv;
    private final Map<Integer, Click> clicks = new HashMap<>();
    /** 아래(플레이어 인벤토리) 칸을 눌렀을 때 — 장비창에서 입을 장비 고르기 등. 칸 번호 = 플레이어 인벤토리 번호 */
    public BottomClick onBottom;

    public interface BottomClick { void on(Player p, int invSlot, ItemStack it); }

    /** 닫으면 열 창 (null = 그냥 닫힘) */
    public Runnable onBack;
    boolean switching;

    public Gui(int rows, Component title) {
        inv = Bukkit.createInventory(this, rows * 9, title);
    }

    @Override public Inventory getInventory() { return inv; }

    public Gui set(int slot, ItemStack it, Click c) {
        inv.setItem(slot, it);
        if (c != null) clicks.put(slot, c); else clicks.remove(slot);
        return this;
    }

    public void open(Player p) {
        if (p.getOpenInventory().getTopInventory().getHolder() instanceof Gui g) g.switching = true;
        p.openInventory(inv);
    }

    // ── 아이콘 만들기 ────────────────────────────────────────────────

    private static final Set<String> MODELS = new HashSet<>();

    /** pack-models.json (Codex 작업 4) 을 읽어 둠 */
    public static void loadModels(ClassLoader cl) {
        try (var in = cl.getResourceAsStream("pack-models.json")) {
            if (in == null) return;
            var arr = com.google.gson.JsonParser.parseReader(new java.io.InputStreamReader(in, java.nio.charset.StandardCharsets.UTF_8)).getAsJsonArray();
            for (var e : arr) MODELS.add(e.getAsString());
        } catch (Exception ignored) {}
    }

    public static boolean hasModel(String path) { return MODELS.contains(path); }

    public static ItemStack icon(Material fallback, String model, Component name, List<Component> lore) {
        ItemStack it = new ItemStack(fallback);
        ItemMeta m = it.getItemMeta();
        if (model != null && MODELS.contains(model)) m.setItemModel(new NamespacedKey("ruc", model));
        m.displayName(name.decoration(TextDecoration.ITALIC, false));
        List<Component> l = new ArrayList<>();
        for (Component c : lore) l.add(c.decoration(TextDecoration.ITALIC, false));
        m.lore(l);
        m.addItemFlags(ItemFlag.values());
        m.setHideTooltip(false);
        it.setItemMeta(m);
        return it;
    }

    public static Component line(String s, TextColor c) { return Component.text(s, c).decoration(TextDecoration.ITALIC, false); }
    public static Component gray(String s) { return line(s, NamedTextColor.GRAY); }

    /** 버튼 (사용자 지정 디자인: 갈색 나무 입체 · 선택 = 초록) */
    public static ItemStack button(String name, boolean selected, List<Component> lore) {
        return icon(selected ? Material.LIME_STAINED_GLASS_PANE : Material.BROWN_STAINED_GLASS_PANE, selected ? "ui/button_green" : "ui/button_wood",
                Component.text(name, selected ? TextColor.color(0x7CFC7C) : TextColor.color(0xF3D9A4), TextDecoration.BOLD), lore);
    }

    public static ItemStack filler() {
        return icon(Material.BLACK_STAINED_GLASS_PANE, "ui/blank", Component.text(" "), List.of());
    }

    // ── 이벤트 ──────────────────────────────────────────────────────

    public static final class Events implements Listener {
        private final org.bukkit.plugin.Plugin plugin;
        public Events(org.bukkit.plugin.Plugin plugin) { this.plugin = plugin; }

        @EventHandler
        public void onClick(InventoryClickEvent e) {
            if (!(e.getInventory().getHolder() instanceof Gui g)) return;
            e.setCancelled(true);
            if (!(e.getWhoClicked() instanceof Player p)) return;
            if (e.getClickedInventory() != e.getInventory()) {
                if (g.onBottom != null && e.getClickedInventory() == p.getInventory()) g.onBottom.on(p, e.getSlot(), e.getCurrentItem());
                return;
            }
            Click c = g.clicks.get(e.getRawSlot());
            if (c == null) return;
            p.playSound(p.getLocation(), Sound.UI_BUTTON_CLICK, 0.4f, 1.2f);
            c.on(p, e.getClick());
        }

        @EventHandler
        public void onDrag(InventoryDragEvent e) {
            if (e.getInventory().getHolder() instanceof Gui) e.setCancelled(true);
        }

        @EventHandler
        public void onClose(InventoryCloseEvent e) {
            if (!(e.getInventory().getHolder() instanceof Gui g)) return;
            if (g.switching) { g.switching = false; return; }
            if (g.onBack != null && e.getReason() == InventoryCloseEvent.Reason.PLAYER)
                Bukkit.getScheduler().runTask(plugin, g.onBack);
        }
    }

    public static BiConsumer<Player, String> NOOP = (p, s) -> {};
}
