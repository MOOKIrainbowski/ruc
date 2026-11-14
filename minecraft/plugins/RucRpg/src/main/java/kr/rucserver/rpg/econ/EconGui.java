package kr.rucserver.rpg.econ;

import com.google.gson.JsonObject;
import kr.rucserver.core.service.EconomyService;
import kr.rucserver.rpg.RucRpg;
import kr.rucserver.rpg.character.PlayerUnit;
import kr.rucserver.rpg.item.ItemService;
import kr.rucserver.rpg.ui.Gui;
import net.kyori.adventure.text.Component;
import net.kyori.adventure.text.format.NamedTextColor;
import net.kyori.adventure.text.format.TextColor;
import net.kyori.adventure.text.format.TextDecoration;
import org.bukkit.Bukkit;
import org.bukkit.Material;
import org.bukkit.Particle;
import org.bukkit.Sound;
import org.bukkit.entity.Player;
import org.bukkit.event.EventHandler;
import org.bukkit.event.Listener;
import org.bukkit.event.inventory.InventoryCloseEvent;
import org.bukkit.inventory.Inventory;
import org.bukkit.inventory.InventoryHolder;
import org.bukkit.inventory.ItemStack;

import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * 경제 창 (웹: 대장간 볼트 · 일반 상점 천막 · 창고). 아래 인벤토리에서 아이템을 눌러 고르고, 위 버튼으로 실행.
 * 유저 상점 = RucCore 유저 상점, 우편 = RucCore 우편함 (기존 구현 유지).
 */
public final class EconGui implements Listener {

    private final RucRpg plugin;
    private final Economy eco;
    private final ItemService items;

    /** 대장간 창 상태 (사람마다) */
    private static final class Smith {
        String tab = "enhance";
        int slot = -1, stoneSlot = -1;
        String uid, stoneTpl;
        boolean blessed, protect;
        int over = 0;
        final int[] picks = {-1, -1, -1};
    }

    private final Map<UUID, Smith> smith = new HashMap<>();

    public EconGui(RucRpg plugin, Economy eco, ItemService items) {
        this.plugin = plugin;
        this.eco = eco;
        this.items = items;
    }

    private static Component t(String s, TextColor c) { return Component.text(s, c).decoration(TextDecoration.ITALIC, false); }

    private String gold(long v) { return EconomyService.format(v) + " " + eco.symbol(); }

    // ── 대장간 (강화 · 마법부여 · 수리 · 분해 · 재조합) ──────────────────

    public void smith(Player p) { openSmith(p, smith.computeIfAbsent(p.getUniqueId(), k -> new Smith())); }

    private void openSmith(Player p, Smith s) {
        Gui g = new Gui(6, Component.text("대장간 — 아래 인벤토리에서 아이템을 고르세요", NamedTextColor.DARK_GRAY));
        for (int i = 0; i < 54; i++) g.set(i, Gui.filler(), null);
        String[][] tabs = {{"enhance", "강화"}, {"enchant", "마법부여"}, {"repair", "수리"}, {"disassemble", "분해"}, {"recombine", "재조합"}};
        for (int i = 0; i < tabs.length; i++) {
            String id = tabs[i][0];
            g.set(i * 2, Gui.button(tabs[i][1], s.tab.equals(id), List.of()), (pl, c) -> { s.tab = id; s.slot = -1; s.stoneSlot = -1; s.picks[0] = s.picks[1] = s.picks[2] = -1; openSmith(pl, s); });
        }
        g.set(49, Gui.icon(Material.GOLD_NUGGET, null, t("보유 " + gold(eco.gold().balance(p.getUniqueId())), TextColor.color(0xF2C94C)), List.of()), null);
        switch (s.tab) {
            case "enhance" -> enhanceTab(p, g, s);
            case "enchant" -> enchantTab(p, g, s);
            case "repair" -> repairTab(p, g, s);
            case "disassemble" -> disassembleTab(p, g, s);
            default -> recombineTab(p, g, s);
        }
        g.open(p);
    }

    private ItemService.Inst picked(Player p, Smith s) {
        if (s.slot < 0) return null;
        ItemService.Inst i = items.read(p.getInventory().getItem(s.slot));
        return i != null && (s.uid == null || s.uid.equals(i.uid())) ? i : null;
    }

    private void target(Player p, Gui g, Smith s, int at) {
        ItemService.Inst i = picked(p, s);
        if (i == null) g.set(at, Gui.icon(Material.LIGHT_GRAY_STAINED_GLASS_PANE, "ui/blank", t("아이템을 고르세요", NamedTextColor.GRAY), List.of(Gui.gray("아래 인벤토리에서 누르세요"))), null);
        else g.set(at, p.getInventory().getItem(s.slot).clone(), null);
    }

    private void pickGear(Player pl, Smith s, int invSlot) {
        ItemService.Inst i = items.read(pl.getInventory().getItem(invSlot));
        if (i == null || !ItemService.isGear(items.tpl(i.tpl()))) { pl.sendMessage(Component.text("장비를 골라 주세요", NamedTextColor.RED)); return; }
        s.slot = invSlot;
        s.uid = i.uid();
        openSmith(pl, s);
    }

    private void enhanceTab(Player p, Gui g, Smith s) {
        target(p, g, s, 22);
        g.onBottom = (pl, slot, it) -> pickGear(pl, s, slot);
        ItemService.Inst i = picked(p, s);
        g.set(38, Gui.button("축복 강화석 " + (s.blessed ? "사용" : "안 씀"), s.blessed, List.of(Gui.gray("성공률 +10%p (가진 수: " + eco.count(p, "blessed_stone") + ")"))), (pl, c) -> { s.blessed = !s.blessed; openSmith(pl, s); });
        g.set(42, Gui.button("보호 주문서 " + (s.protect ? "사용" : "안 씀"), s.protect, List.of(Gui.gray("파괴 → 실패(유지) (가진 수: " + eco.count(p, "protect_scroll") + ")"))), (pl, c) -> { s.protect = !s.protect; openSmith(pl, s); });
        if (i == null) return;
        if (i.enh() >= eco.enhanceMax()) { g.set(40, Gui.button("이미 +10 입니다", false, List.of()), null); return; }
        JsonObject st = eco.enhanceStep(i.enh());
        double ok = Math.min(1, st.get("ok").getAsDouble() + (s.blessed ? 0.1 : 0)), boom = st.get("boom").getAsDouble();
        List<Component> lore = new ArrayList<>();
        lore.add(Gui.line("+" + i.enh() + " → +" + (i.enh() + 1), NamedTextColor.YELLOW));
        lore.add(Gui.line("성공 " + Math.round(ok * 100) + "%  ·  파괴 " + (s.protect ? 0 : Math.round(boom * 100)) + "%  ·  실패(유지) " + Math.max(0, Math.round((1 - ok - (s.protect ? 0 : boom)) * 100)) + "%", NamedTextColor.WHITE));
        lore.add(Gui.gray("비용 " + gold(eco.enhanceCost(i)) + " + 강화석 " + st.get("stones").getAsInt() + "개 (가진 수: " + eco.count(p, "enhance_stone") + ")"));
        lore.add(Gui.gray("성공하면 20% 확률로 강화 옵션 (최대 3)"));
        g.set(40, Gui.button("강화하기", true, lore), (pl, c) -> {
            String r = eco.enhance(pl, s.slot, s.uid, s.blessed, s.protect);
            if (r.startsWith("!")) { pl.sendMessage(Component.text(r.substring(1), NamedTextColor.RED)); openSmith(pl, s); return; }
            switch (r) {
                case "ok" -> { plugin.quests().quest(pl, "enhance", null); pl.playSound(pl.getLocation(), Sound.BLOCK_ANVIL_USE, 1f, 1.4f); pl.getWorld().spawnParticle(Particle.TOTEM_OF_UNDYING, pl.getLocation().add(0, 1, 0), 30, 0.4, 0.6, 0.4, 0.2); pl.sendMessage(Component.text("강화 성공!", NamedTextColor.GREEN)); announce(pl, s); }
                case "boom" -> { pl.playSound(pl.getLocation(), Sound.ENTITY_GENERIC_EXPLODE, 0.8f, 1f); pl.sendMessage(Component.text("강화 실패 — 장비가 파괴되었습니다...", NamedTextColor.DARK_RED)); s.slot = -1; }
                default -> { pl.playSound(pl.getLocation(), Sound.BLOCK_ANVIL_LAND, 0.6f, 0.8f); pl.sendMessage(Component.text("강화 실패 (등급은 그대로)", NamedTextColor.GRAY)); }
            }
            plugin.itemRuntime().refresh(pl);
            openSmith(pl, s);
        });
    }

    /** +10 서버 공지 (웹 broadcast) */
    private void announce(Player p, Smith s) {
        ItemService.Inst i = picked(p, s);
        if (i == null || i.enh() < eco.enhanceMax()) return;
        Bukkit.broadcast(Component.text("[대장간] ", TextColor.color(0xF2C94C)).append(Component.text(p.getName() + " 님이 ", NamedTextColor.WHITE))
                .append(p.getInventory().getItem(s.slot).getItemMeta().displayName()).append(Component.text(" 을(를) 완성했습니다!", NamedTextColor.WHITE)));
    }

    private void enchantTab(Player p, Gui g, Smith s) {
        target(p, g, s, 20);
        ItemStack stone = s.stoneSlot >= 0 ? p.getInventory().getItem(s.stoneSlot) : null;
        if (stone == null || items.read(stone) == null) g.set(24, Gui.icon(Material.LIGHT_GRAY_STAINED_GLASS_PANE, "ui/blank", t("부가석(마법부여 책)을 고르세요", NamedTextColor.GRAY), List.of()), null);
        else g.set(24, stone.clone(), null);
        g.onBottom = (pl, slot, it) -> {
            ItemService.Inst i = items.read(it);
            if (i == null) return;
            if (items.tpl(i.tpl()).has("enchant")) { s.stoneSlot = slot; s.stoneTpl = i.tpl(); openSmith(pl, s); }
            else pickGear(pl, s, slot);
        };
        ItemService.Inst i = picked(p, s);
        if (i == null || s.stoneSlot < 0) return;
        int cap = eco.enchSlots(i.rarity());
        if (i.ench().size() >= cap && cap > 0)
            for (int k = 0; k < cap; k++) {
                int kk = k;
                g.set(29 + k, Gui.button((k + 1) + "번 줄 덮어쓰기", s.over == k, List.of()), (pl, c) -> { s.over = kk; openSmith(pl, s); });
            }
        ItemService.Inst st = items.read(stone);
        g.set(40, Gui.button("마법부여", true, List.of(Gui.gray("비용 " + (st == null ? "-" : gold(eco.enchantCost(i.rarity(), st.rarity())))), Gui.gray("슬롯 " + i.ench().size() + " / " + cap))), (pl, c) -> {
            String err = eco.enchant(pl, s.slot, s.uid, s.stoneSlot, s.stoneTpl, s.over);
            if (err != null) pl.sendMessage(Component.text(err, NamedTextColor.RED));
            else { pl.playSound(pl.getLocation(), Sound.BLOCK_ENCHANTMENT_TABLE_USE, 1f, 1.2f); s.stoneSlot = -1; }
            plugin.itemRuntime().refresh(pl);
            openSmith(pl, s);
        });
    }

    private void repairTab(Player p, Gui g, Smith s) {
        target(p, g, s, 22);
        g.onBottom = (pl, slot, it) -> pickGear(pl, s, slot);
        ItemService.Inst i = picked(p, s);
        if (i != null) g.set(39, Gui.button("이것 수리", true, List.of(Gui.gray("비용 " + gold(eco.repairCost(i))))), (pl, c) -> done(pl, s, eco.repair(pl, List.of(s.slot)), Sound.BLOCK_ANVIL_USE));
        List<Integer> all = new ArrayList<>();
        for (int k = 0; k < 41; k++) all.add(k);   // 인벤토리 · 방어구 · 왼손
        long cost = 0;
        for (int k : all) { ItemService.Inst x = items.read(p.getInventory().getItem(k)); if (x != null && x.durMax() > 0) cost += eco.repairCost(x); }
        g.set(41, Gui.button("모두 수리", false, List.of(Gui.gray("비용 " + gold(cost)))), (pl, c) -> done(pl, s, eco.repair(pl, all), Sound.BLOCK_ANVIL_USE));
    }

    private void disassembleTab(Player p, Gui g, Smith s) {
        target(p, g, s, 22);
        g.onBottom = (pl, slot, it) -> {
            ItemService.Inst i = items.read(it);
            if (i == null) return;
            s.slot = slot;
            s.uid = i.uid();
            openSmith(pl, s);
        };
        ItemService.Inst i = picked(p, s);
        if (i == null) return;
        long refund = eco.disassembleGold(i) * p.getInventory().getItem(s.slot).getAmount();
        g.set(40, Gui.button("분해하기 (되돌릴 수 없음)", true, List.of(Gui.gray("받는 돈 " + gold(refund)))), (pl, c) -> { done(pl, s, eco.disassemble(pl, s.slot, s.uid), Sound.BLOCK_GRINDSTONE_USE); s.slot = -1; });
    }

    private void recombineTab(Player p, Gui g, Smith s) {
        for (int k = 0; k < 3; k++) {
            int at = 20 + k * 2;
            ItemStack it = s.picks[k] >= 0 ? p.getInventory().getItem(s.picks[k]) : null;
            if (it == null || items.read(it) == null) g.set(at, Gui.icon(Material.LIGHT_GRAY_STAINED_GLASS_PANE, "ui/blank", t("재료 " + (k + 1), NamedTextColor.GRAY), List.of()), null);
            else g.set(at, it.clone(), null);
        }
        g.onBottom = (pl, slot, it) -> {
            if (items.read(it) == null) return;
            for (int k = 0; k < 3; k++) if (s.picks[k] < 0) { s.picks[k] = slot; break; }
            openSmith(pl, s);
        };
        g.set(38, Gui.button("비우기", false, List.of()), (pl, c) -> { s.picks[0] = s.picks[1] = s.picks[2] = -1; openSmith(pl, s); });
        if (s.picks[2] < 0) return;
        g.set(40, Gui.button("재조합", true, List.of(Gui.gray("같은 용도 3개 → 같은 용도 무작위 1개"), Gui.gray("희귀도: 평균 70% · 한 단계 아래 25% · 위 5%"))), (pl, c) -> {
            try {
                PlayerUnit u = plugin.runtime().unit(pl);
                ItemStack out = eco.recombine(pl, s.picks.clone(), u == null ? 0 : u.st.get("luck"));
                plugin.itemRuntime().give(pl, out);
                pl.sendMessage(Component.text("재조합 결과: ", NamedTextColor.WHITE).append(out.getItemMeta().displayName()));
                pl.playSound(pl.getLocation(), Sound.BLOCK_SMITHING_TABLE_USE, 1f, 1f);
            } catch (Economy.Fail f) { pl.sendMessage(Component.text(f.getMessage(), NamedTextColor.RED)); }
            s.picks[0] = s.picks[1] = s.picks[2] = -1;
            openSmith(pl, s);
        });
    }

    private void done(Player p, Smith s, String err, Sound ok) {
        if (err != null) p.sendMessage(Component.text(err, NamedTextColor.RED));
        else p.playSound(p.getLocation(), ok, 0.8f, 1.2f);
        plugin.itemRuntime().refresh(p);
        openSmith(p, s);
    }

    // ── 일반 상점 ───────────────────────────────────────────────────

    public void shop(Player p) {
        PlayerUnit u = plugin.runtime().unit(p);
        long now = System.currentTimeMillis(), cycle = Economy.cycle(now);
        List<Economy.Slot> slots = eco.rollShop(p.getUniqueId().toString(), cycle, u == null ? 0 : u.st.get("luck"));
        int[] got = eco.purchased(p.getUniqueId(), cycle, slots.size());
        long left = (Economy.cycleEnd(cycle) - now) / 60000;
        Gui g = new Gui(4, Component.text("일반 상점 — " + left / 60 + "시간 " + left % 60 + "분 뒤 진열이 바뀜", NamedTextColor.DARK_GRAY));
        for (int i = 0; i < 36; i++) g.set(i, Gui.filler(), null);
        for (int i = 0; i < slots.size() && i < 27; i++) {
            Economy.Slot s = slots.get(i);
            ItemStack show = items.create(s.tpl(), s.rarity(), 1);
            var m = show.getItemMeta();
            List<Component> lore = new ArrayList<>(m.lore() == null ? List.of() : m.lore());
            lore.add(Component.empty());
            int remain = s.stock() - got[i];
            lore.add(t("가격 " + gold(s.price()) + "  ·  남은 수량 " + remain, TextColor.color(0xF2C94C)));
            lore.add(Gui.gray(ItemService.stackable(items.tpl(s.tpl())) ? "클릭 1개 · 쉬프트 클릭 10개" : "클릭: 사기"));
            m.lore(lore);
            show.setItemMeta(m);
            int idx = i;
            g.set(i < 8 ? i : i + 1, show, (pl, click) -> buy(pl, cycle, idx, click.isShiftClick() ? 10 : 1));
        }
        g.set(35, Gui.icon(Material.GOLD_NUGGET, null, t("보유 " + gold(eco.gold().balance(p.getUniqueId())), TextColor.color(0xF2C94C)), List.of()), null);
        g.open(p);
    }

    private void buy(Player p, long cycle, int idx, int qty) {
        PlayerUnit u = plugin.runtime().unit(p);
        if (Economy.cycle(System.currentTimeMillis()) != cycle) { p.sendMessage(Component.text("진열이 바뀌었습니다. 다시 열어 주세요", NamedTextColor.RED)); shop(p); return; }
        List<Economy.Slot> slots = eco.rollShop(p.getUniqueId().toString(), cycle, u == null ? 0 : u.st.get("luck"));
        int[] got = eco.purchased(p.getUniqueId(), cycle, slots.size());
        Economy.Slot s = slots.get(idx);
        boolean stack = ItemService.stackable(items.tpl(s.tpl()));
        int n = stack ? Math.min(qty, s.stock() - got[idx]) : 1;
        if (n <= 0) { p.sendMessage(Component.text("남은 수량이 없습니다", NamedTextColor.RED)); return; }
        String err = eco.charge(p, s.price() * n, "shop", s.tpl() + " ×" + n, () -> {
            plugin.itemRuntime().give(p, items.create(s.tpl(), s.rarity(), n));
            got[idx] += n;
        });
        if (err != null) p.sendMessage(Component.text(err, NamedTextColor.RED));
        else {
            p.playSound(p.getLocation(), Sound.ENTITY_VILLAGER_YES, 0.7f, 1.2f);
            plugin.quests().quest(p, "buy", s.tpl());
            Bukkit.getScheduler().runTaskAsynchronously(plugin, () -> eco.savePurchased(p.getUniqueId(), cycle, got));
        }
        shop(p);
    }

    // ── 창고 (광장, 54칸 + 확장권) ───────────────────────────────────

    private static final class StorageHolder implements InventoryHolder {
        Inventory inv;
        final UUID owner;
        StorageHolder(UUID owner) { this.owner = owner; }
        @Override public Inventory getInventory() { return inv; }
    }

    /** 한 번 읽은 창고는 메모리가 원본 (DB 는 닫을 때 비동기 저장) — 저장이 끝나기 전에 다시 열어도 옛 내용이 되살아나지 않음 */
    private final Map<UUID, ItemStack[]> storageCache = new HashMap<>();

    public void storage(Player p) {
        if (!plugin.worlds().isPlaza(p.getLocation())) { p.sendMessage(Component.text("창고는 광장에서만 열 수 있습니다", NamedTextColor.RED)); return; }
        UUID id = p.getUniqueId();
        ItemStack[] cached = storageCache.get(id);
        if (cached != null) {
            StorageHolder h = new StorageHolder(id);
            h.inv = Bukkit.createInventory(h, 54, Component.text("창고", NamedTextColor.DARK_GRAY));
            h.inv.setContents(cached);
            p.openInventory(h.inv);
            return;
        }
        Bukkit.getScheduler().runTaskAsynchronously(plugin, () -> {
            Map<Integer, ItemStack> saved = new HashMap<>();
            try (Connection c = eco.db().getConnection(); PreparedStatement ps = c.prepareStatement("SELECT slot, item FROM rpg_storage WHERE uuid = ?")) {
                ps.setString(1, id.toString());
                try (ResultSet rs = ps.executeQuery()) { while (rs.next()) saved.put(rs.getInt(1), ItemStack.deserializeBytes(rs.getBytes(2))); }
            } catch (Exception e) { plugin.getLogger().warning("창고 읽기 실패: " + e.getMessage()); return; }
            Bukkit.getScheduler().runTask(plugin, () -> {
                if (!p.isOnline()) return;
                StorageHolder h = new StorageHolder(id);
                h.inv = Bukkit.createInventory(h, 54, Component.text("창고", NamedTextColor.DARK_GRAY));
                saved.forEach((s, it) -> { if (s < 54) h.inv.setItem(s, it); });
                storageCache.put(id, h.inv.getContents());
                p.openInventory(h.inv);
            });
        });
    }

    @EventHandler
    public void onStorageClose(InventoryCloseEvent e) {
        if (!(e.getInventory().getHolder() instanceof StorageHolder h)) return;
        ItemStack[] snap = new ItemStack[54];
        for (int i = 0; i < 54; i++) { ItemStack it = e.getInventory().getItem(i); snap[i] = it == null ? null : it.clone(); }
        storageCache.put(h.owner, snap.clone());
        Bukkit.getScheduler().runTaskAsynchronously(plugin, () -> {
            try (Connection c = eco.db().getConnection()) {
                c.setAutoCommit(false);
                try (PreparedStatement d = c.prepareStatement("DELETE FROM rpg_storage WHERE uuid = ?")) { d.setString(1, h.owner.toString()); d.executeUpdate(); }
                try (PreparedStatement ins = c.prepareStatement("INSERT INTO rpg_storage (uuid, slot, item) VALUES (?,?,?)")) {
                    for (int i = 0; i < snap.length; i++) {
                        if (snap[i] == null || snap[i].getType().isAir()) continue;
                        ins.setString(1, h.owner.toString()); ins.setInt(2, i); ins.setBytes(3, snap[i].serializeAsBytes()); ins.addBatch();
                    }
                    ins.executeBatch();
                }
                c.commit();
            } catch (Exception ex) { plugin.getLogger().severe("창고 저장 실패 (" + h.owner + "): " + ex.getMessage()); }
        });
    }
}
