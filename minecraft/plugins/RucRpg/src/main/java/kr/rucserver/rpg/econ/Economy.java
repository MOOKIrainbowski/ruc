package kr.rucserver.rpg.econ;

import com.google.gson.JsonArray;
import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import kr.rucserver.core.service.EconomyService;
import kr.rucserver.core.storage.Database;
import kr.rucserver.rpg.RucRpg;
import kr.rucserver.rpg.engine.Formulas;
import kr.rucserver.rpg.item.ItemService;
import org.bukkit.Bukkit;
import org.bukkit.entity.Player;
import org.bukkit.inventory.ItemStack;

import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Statement;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import java.util.function.DoubleSupplier;

/**
 * 경제 (§16 강화 · 마법부여 · 수리 · 분해 · 재조합 · §17 일반 상점) — 웹 shared/data/economy.ts + server/economy.ts 이식.
 * 화폐 = RucCore Gold (EconomyService). 조작 순서: 검증 → Gold 차감(실패면 끝) → 아이템 변경 → 원장 기록(비동기).
 * 아이템 단계에서 예외가 나면 Gold 를 돌려줌. 유저 상점 · 우편은 RucCore 것을 그대로 씀(기존 구현 유지).
 */
public final class Economy {

    public static final class Fail extends RuntimeException { public Fail(String m) { super(m); } }

    private final RucRpg plugin;
    private final ItemService items;
    private final JsonObject econ;
    private final JsonArray enhance;
    private final List<String> rarities;
    private DoubleSupplier rng = () -> java.util.concurrent.ThreadLocalRandom.current().nextDouble();
    private final Database db;

    public Economy(RucRpg plugin, ItemService items, Database db) {
        this.plugin = plugin;
        this.items = items;
        this.db = db;
        econ = plugin.data().file("economy");
        enhance = econ.getAsJsonArray("ENHANCE");
        rarities = items.rarities();
    }

    public void createSchema() throws SQLException {
        try (Connection c = db.getConnection(); Statement s = c.createStatement()) {
            s.execute("CREATE TABLE IF NOT EXISTS rpg_ledger (id BIGINT AUTO_INCREMENT PRIMARY KEY, uuid VARCHAR(36) NOT NULL, op VARCHAR(24) NOT NULL, gold BIGINT NOT NULL, detail VARCHAR(512), at BIGINT NOT NULL)");
            s.execute("CREATE TABLE IF NOT EXISTS rpg_shop (uuid VARCHAR(36) NOT NULL, cycle BIGINT NOT NULL, purchased VARCHAR(512) NOT NULL, PRIMARY KEY (uuid, cycle))");
            s.execute("CREATE TABLE IF NOT EXISTS rpg_storage (uuid VARCHAR(36) NOT NULL, slot INT NOT NULL, item BLOB NOT NULL, PRIMARY KEY (uuid, slot))");
            s.execute("CREATE TABLE IF NOT EXISTS rpg_storage_tabs (uuid VARCHAR(36) PRIMARY KEY, tabs INT NOT NULL)");
        }
    }

    public Database db() { return db; }
    public EconomyService gold() { return plugin.core().getEconomy(); }
    public String symbol() { return gold().symbol(); }

    /** 원장 한 줄 (감사용, 비동기) */
    public void ledger(Player p, String op, long gold, String detail) {
        UUID id = p.getUniqueId();
        long now = System.currentTimeMillis();
        Bukkit.getScheduler().runTaskAsynchronously(plugin, () -> {
            try (Connection c = db.getConnection(); PreparedStatement ps = c.prepareStatement("INSERT INTO rpg_ledger (uuid, op, gold, detail, at) VALUES (?,?,?,?,?)")) {
                ps.setString(1, id.toString()); ps.setString(2, op); ps.setLong(3, gold);
                ps.setString(4, detail == null ? null : detail.length() > 500 ? detail.substring(0, 500) : detail); ps.setLong(5, now);
                ps.executeUpdate();
            } catch (SQLException e) { plugin.getLogger().warning("원장 기록 실패: " + e.getMessage()); }
        });
    }

    /** Gold 차감 → 작업 → 실패하면 환불. 실패 사유 문자열 또는 null */
    public String charge(Player p, long cost, String op, String detail, Runnable work) {
        if (cost > 0 && !gold().withdraw(p.getUniqueId(), cost))
            return symbol() + "가 부족합니다 (필요 " + EconomyService.format(cost) + ", 보유 " + EconomyService.format(gold().balance(p.getUniqueId())) + ")";
        try {
            work.run();
        } catch (Fail f) {
            if (cost > 0) gold().deposit(p.getUniqueId(), cost);
            return f.getMessage();
        } catch (RuntimeException e) {
            if (cost > 0) gold().deposit(p.getUniqueId(), cost);
            plugin.getLogger().log(java.util.logging.Level.SEVERE, "경제 처리 실패 (" + op + ")", e);
            return "처리 중 문제가 생겼습니다. 다시 시도해 주세요";
        }
        ledger(p, op, -cost, detail);
        return null;
    }

    // ── 공식 (economy.ts) ───────────────────────────────────────────

    private int ri(String r) { return Math.max(0, rarities.indexOf(r)); }
    private double tbl(String table, String r) { return econ.getAsJsonObject(table).get(r).getAsDouble(); }

    public long baseValue(JsonObject t) {
        if (t.has("value")) return t.get("value").getAsLong();
        return ItemService.isGear(t) ? 15 + 5L * t.get("lv").getAsInt() : 5;
    }

    public long itemValue(String tpl, String rarity, int enh) {
        return Formulas.jsRound(baseValue(items.tpl(tpl)) * tbl("RARITY_VALUE", rarity) * (1 + 0.15 * enh));
    }

    public long disassembleGold(ItemService.Inst i) { return Math.max(1, (long) Math.floor(itemValue(i.tpl(), i.rarity(), i.enh()) / 50.0)); }

    public int enhanceMax() { return enhance.size(); }
    public JsonObject enhanceStep(int enh) { return enhance.get(enh).getAsJsonObject(); }
    public long enhanceCost(ItemService.Inst i) { return Formulas.jsRound(30 * (1 + ri(i.rarity())) * enhanceStep(i.enh()).get("mul").getAsDouble()); }

    /** 성공 · 실패(유지) · 파괴. 축복 = 성공 +10%p, 보호 = 파괴 → 실패 */
    public String rollEnhance(double r, int step, boolean blessed, boolean protect) {
        JsonObject e = enhanceStep(step);
        double ok = Math.min(1, e.get("ok").getAsDouble() + (blessed ? 0.1 : 0));
        if (r < ok) return "ok";
        if (r < ok + e.get("boom").getAsDouble()) return protect ? "fail" : "boom";
        return "fail";
    }

    public int enchSlots(String rarity) { return (int) tbl("ENCH_SLOTS", rarity); }
    public long enchantCost(String item, String stone) { return Formulas.jsRound(100 * tbl("ENCH_COST_MUL", item) * tbl("ENCH_COST_MUL", stone)); }

    public long repairCost(ItemService.Inst i) { return (long) Math.ceil(Math.max(0, i.durMax() - i.dur()) * 0.5 * (1 + ri(i.rarity()) * 0.5)); }

    /** 부가석 하나로 굴린 마법부여 한 줄 (scale 0.5 = 강화 옵션) */
    public JsonObject rollEnch(String kind, double power, double scale) {
        JsonArray range = econ.getAsJsonObject("ENCHANTS").getAsJsonObject(kind).getAsJsonArray("range");
        double lo = range.get(0).getAsDouble(), hi = range.get(1).getAsDouble();
        double v = (lo + rng.getAsDouble() * (hi - lo)) * power * scale;
        JsonObject e = new JsonObject();
        e.addProperty("k", kind);
        e.addProperty("v", v < 1 ? Math.round(v * 1000) / 1000.0 : Math.round(v));
        if (kind.equals("eldef")) {
            List<String> els = new ArrayList<>(plugin.data().file("elements").getAsJsonObject("ELEMENTS").keySet());
            els.remove("none");
            e.addProperty("el", els.get((int) Math.floor(rng.getAsDouble() * els.size())));
        }
        return e;
    }

    // ── 조작 (손에 있는 ItemStack 을 그 자리에서 바꿈) ─────────────────

    /** 인벤토리에서 이 템플릿 n 개를 빼냄 (모자라면 Fail) */
    public void takeTpl(Player p, String tpl, int n) {
        int have = 0;
        for (ItemStack it : p.getInventory().getStorageContents()) {
            ItemService.Inst i = items.read(it);
            if (i != null && i.tpl().equals(tpl)) have += it.getAmount();
        }
        if (have < n) throw new Fail(items.tpl(tpl).get("name").getAsString() + " 이(가) " + (n - have) + "개 모자랍니다");
        int left = n;
        ItemStack[] inv = p.getInventory().getStorageContents();
        for (int s = 0; s < inv.length && left > 0; s++) {
            ItemService.Inst i = items.read(inv[s]);
            if (i == null || !i.tpl().equals(tpl)) continue;
            int k = Math.min(left, inv[s].getAmount());
            inv[s].setAmount(inv[s].getAmount() - k);
            left -= k;
            p.getInventory().setItem(s, inv[s].getAmount() <= 0 ? null : inv[s]);
        }
    }

    public int count(Player p, String tpl) {
        int have = 0;
        for (ItemStack it : p.getInventory().getStorageContents()) {
            ItemService.Inst i = items.read(it);
            if (i != null && i.tpl().equals(tpl)) have += it.getAmount();
        }
        return have;
    }

    /** 칸의 아이템이 아직 그 아이템인가 (창을 연 사이 바꿔치기 방지) */
    public ItemStack same(Player p, int slot, String uid) {
        ItemStack it = p.getInventory().getItem(slot);
        ItemService.Inst i = items.read(it);
        if (i == null || uid == null || !uid.equals(i.uid())) throw new Fail("아이템이 바뀌었습니다. 다시 골라 주세요");
        return it;
    }

    private static ItemService.Inst with(ItemService.Inst i, int enh, int dur, int durMax, JsonArray opt, JsonArray ench, String name) {
        return new ItemService.Inst(i.uid(), i.tpl(), i.rarity(), enh, i.sp(), dur, durMax, opt, ench, name);
    }

    /** 강화 (§16-1). 반환 = "ok" · "fail" · "boom" 또는 실패 사유(앞에 '!') */
    public String enhance(Player p, int slot, String uid, boolean blessed, boolean protect) {
        final String[] result = {null};
        ItemService.Inst pre = items.read(p.getInventory().getItem(slot));
        if (pre == null || !ItemService.isGear(items.tpl(pre.tpl()))) return "!장비만 강화할 수 있습니다";
        if (pre.enh() >= enhanceMax()) return "!이미 +10 입니다";
        String err = charge(p, enhanceCost(pre), "enhance", pre.tpl() + " +" + pre.enh(), () -> {
            ItemStack it = same(p, slot, uid);
            ItemService.Inst i = items.read(it);
            JsonObject step = enhanceStep(i.enh());
            JsonObject t = items.tpl(i.tpl());
            if (count(p, "enhance_stone") < step.get("stones").getAsInt()) throw new Fail("강화석이 " + step.get("stones").getAsInt() + "개 필요합니다");
            if (blessed && count(p, "blessed_stone") < 1) throw new Fail("축복 강화석이 없습니다");
            if (protect && count(p, "protect_scroll") < 1) throw new Fail("강화 보호 주문서가 없습니다");
            takeTpl(p, "enhance_stone", step.get("stones").getAsInt());
            if (blessed) takeTpl(p, "blessed_stone", 1);
            if (protect) takeTpl(p, "protect_scroll", 1);
            String r = rollEnhance(rng.getAsDouble(), i.enh(), blessed, protect);
            result[0] = r;
            if (r.equals("boom")) { p.getInventory().setItem(slot, null); return; }
            if (!r.equals("ok")) return;
            double ratio = i.durMax() > 0 ? (double) i.dur() / i.durMax() : 1;
            int enh = i.enh() + 1;
            String kind = t.get("kind").getAsString();
            int base = "weapon".equals(kind) ? 100 : "armor".equals(kind) ? 120 : 0;
            int durMax = (int) Formulas.jsRound(base * items.rarityDef(i.rarity()).get("dur").getAsDouble() * (1 + 0.1 * enh));
            JsonArray opt = i.opt().deepCopy();
            JsonObject eo = econ.getAsJsonObject("ENHANCE_OPT");
            if (opt.size() < eo.get("max").getAsInt() && rng.getAsDouble() < eo.get("chance").getAsDouble()) {
                List<String> kinds = new ArrayList<>(econ.getAsJsonObject("ENCHANTS").keySet());
                opt.add(rollEnch(kinds.get((int) Math.floor(rng.getAsDouble() * kinds.size())), 1, eo.get("scale").getAsDouble()));
            }
            String name = i.name();
            if (enh == enhanceMax()) {
                JsonArray pool = econ.getAsJsonObject("PREFIXES").has(kind) ? econ.getAsJsonObject("PREFIXES").getAsJsonArray(kind) : econ.getAsJsonObject("PREFIXES").getAsJsonArray("weapon");
                name = "「" + pool.get((int) Math.floor(rng.getAsDouble() * pool.size())).getAsString() + "」 " + t.get("name").getAsString() + " +10";
            }
            items.write(it, with(i, enh, (int) Math.round(durMax * ratio), durMax, opt, i.ench(), name));
        });
        return err != null ? "!" + err : result[0];
    }

    /** 마법부여 (§16-2): 부가석(바닐라 마법부여 책 모양) 하나 → 마법부여 한 줄 (슬롯이 차면 over 칸을 덮어씀) */
    public String enchant(Player p, int slot, String uid, int stoneSlot, String stoneTpl, int over) {
        ItemService.Inst pre = items.read(p.getInventory().getItem(slot));
        ItemService.Inst st = items.read(p.getInventory().getItem(stoneSlot));
        if (pre == null || !ItemService.isGear(items.tpl(pre.tpl()))) return "장비에만 마법부여할 수 있습니다";
        if (st == null || !st.tpl().equals(stoneTpl) || !items.tpl(stoneTpl).has("enchant")) return "부가석(마법부여 책)이 아닙니다";
        int cap = enchSlots(pre.rarity());
        if (cap == 0) return "하급 장비에는 마법부여할 수 없습니다";
        int pos = pre.ench().size() >= cap ? over : pre.ench().size();
        if (pos < 0 || pos >= cap) return "덮어쓸 칸을 골라 주세요";
        return charge(p, enchantCost(pre.rarity(), st.rarity()), "enchant", pre.tpl() + " ← " + stoneTpl, () -> {
            ItemStack it = same(p, slot, uid);
            ItemService.Inst i = items.read(it);
            ItemStack stone = p.getInventory().getItem(stoneSlot);
            ItemService.Inst s = items.read(stone);
            if (s == null || !s.tpl().equals(stoneTpl)) throw new Fail("부가석이 바뀌었습니다");
            String kind = items.tpl(stoneTpl).get("enchant").getAsString();
            JsonObject line = rollEnch(kind, tbl("ENCH_POWER", s.rarity()), 1);
            stone.setAmount(stone.getAmount() - 1);
            p.getInventory().setItem(stoneSlot, stone.getAmount() <= 0 ? null : stone);
            JsonArray list = i.ench().deepCopy();
            if (pos < list.size()) list.set(pos, line); else list.add(line);
            items.write(it, with(i, i.enh(), i.dur(), i.durMax(), i.opt(), list, i.name()));
        });
    }

    /** 수리: 한 칸 또는 입은 것 전부 (방어구 · 손 · 장신구 칸은 내구도 없음) */
    public String repair(Player p, List<Integer> slots) {
        long cost = 0;
        List<Integer> todo = new ArrayList<>();
        for (int s : slots) {
            ItemService.Inst i = items.read(p.getInventory().getItem(s));
            if (i == null || i.durMax() == 0 || i.dur() >= i.durMax()) continue;
            cost += repairCost(i);
            todo.add(s);
        }
        if (todo.isEmpty()) return "수리할 것이 없습니다";
        return charge(p, cost, "repair", todo.toString(), () -> {
            for (int s : todo) {
                ItemStack it = p.getInventory().getItem(s);
                ItemService.Inst i = items.read(it);
                if (i != null) items.write(it, with(i, i.enh(), i.durMax(), i.durMax(), i.opt(), i.ench(), i.name()));
            }
        });
    }

    /** 분해: 가치/50 Gold 환불 (개당) */
    public String disassemble(Player p, int slot, String uidOrNull) {
        ItemStack it = p.getInventory().getItem(slot);
        ItemService.Inst i = items.read(it);
        if (i == null) return "RPG 아이템이 아닙니다";
        if (uidOrNull != null && !uidOrNull.equals(i.uid())) return "아이템이 바뀌었습니다";
        long refund = disassembleGold(i) * it.getAmount();
        p.getInventory().setItem(slot, null);
        gold().deposit(p.getUniqueId(), refund);
        ledger(p, "disassemble", refund, i.tpl() + " ×" + it.getAmount());
        return null;
    }

    /** 재조합 (§16-4): 같은 용도 3개 → 같은 용도 무작위 1개. 결과 희귀도: 평균 70% · 아래 25% · 위 5%(+운) */
    public ItemStack recombine(Player p, int[] slots, double luck) {
        String kind = null;
        int sum = 0;
        for (int s : slots) {
            ItemService.Inst i = items.read(p.getInventory().getItem(s));
            if (i == null) throw new Fail("재료 3개를 올려 주세요");
            String k = items.tpl(i.tpl()).get("kind").getAsString();
            if (kind != null && !kind.equals(k)) throw new Fail("같은 용도의 아이템 3개여야 합니다");
            kind = k;
            sum += ri(i.rarity());
        }
        if (slots[0] == slots[1] || slots[1] == slots[2] || slots[0] == slots[2]) {
            for (int s : slots) if (p.getInventory().getItem(s).getAmount() < 3) throw new Fail("같은 칸을 고르면 그 칸에 3개가 있어야 합니다");
        }
        List<String> pool = new ArrayList<>();
        for (String id : items.templateIds()) if (kind.equals(items.tpl(id).get("kind").getAsString())) pool.add(id);
        String tpl = pool.get((int) Math.floor(rng.getAsDouble() * pool.size()));
        String rarity;
        JsonObject t = items.tpl(tpl);
        if (t.has("rarity")) rarity = t.get("rarity").getAsString();
        else {
            int avg = Math.round(sum / 3f);
            double r = rng.getAsDouble(), up = 0.05 + luck * 0.0005;
            int idx = r < up ? avg + 1 : r < up + 0.25 ? avg - 1 : avg;
            rarity = rarities.get(Math.max(0, Math.min(rarities.size() - 1, idx)));
        }
        for (int s : slots) {
            ItemStack it = p.getInventory().getItem(s);
            it.setAmount(it.getAmount() - 1);
            p.getInventory().setItem(s, it.getAmount() <= 0 ? null : it);
        }
        ledger(p, "recombine", 0, tpl + " " + rarity);
        return items.create(tpl, rarity, 1);
    }

    // ── 일반 상점 (§17-2): 6시간 회차 · 개인 진열 8칸(시드 고정) + 늘 파는 잡화 ──

    public record Slot(String tpl, String rarity, long price, int stock) {}

    public static long cycle(long now) { return Math.floorDiv(now + 9 * 3600_000L, 6 * 3600_000L); }
    public static long cycleEnd(long cycle) { return (cycle + 1) * 6 * 3600_000L - 9 * 3600_000L; }

    /** 시드 고정 난수 (웹 seeded: FNV + mulberry32) — 같은 (사람, 회차)면 같은 목록 */
    static DoubleSupplier seeded(String seed) {
        final int[] h = {(int) 2166136261L};
        for (int i = 0; i < seed.length(); i++) h[0] = (h[0] ^ seed.charAt(i)) * 16777619;
        return () -> {
            h[0] = h[0] + 0x6d2b79f5;
            int t = (h[0] ^ (h[0] >>> 15)) * (1 | h[0]);
            t = (t + ((t ^ (t >>> 7)) * (61 | t))) ^ t;
            return ((t ^ (t >>> 14)) & 0xffffffffL) / 4294967296.0;
        };
    }

    /** 웹 SHOP_POOL (economy.ts 안의 비공개 표 — 같은 내용) */
    private static final String[] POOL_ENCH = {"ench_atk", "ench_ap", "ench_def", "ench_hp", "ench_speed", "ench_crit", "ench_eldef", "ench_vamp"};
    private static final String[] POOL_GEAR = {"old_dagger", "wood_sword", "apprentice_staff", "hunter_bow", "goblin_axe", "leather_cap", "leather_vest", "leather_pants", "leather_boots", "leather_gloves", "meadow_cape", "copper_ring", "rabbit_charm"};

    public List<Slot> rollShop(String user, long cycle, double luck) {
        DoubleSupplier rand = seeded(user + ":" + cycle);
        List<String[]> pool = new ArrayList<>();   // [item, w, stock]
        for (String s : POOL_ENCH) pool.add(new String[]{s, "2", "2"});
        for (String s : POOL_GEAR) pool.add(new String[]{s, "2", "1"});
        double total = pool.size() * 2.0;
        List<Slot> out = new ArrayList<>();
        int n = econ.getAsJsonObject("SHOP").get("slots").getAsInt();
        for (int i = 0; i < n; i++) {
            double r = rand.getAsDouble() * total;
            String[] pick = pool.get(0);
            for (String[] x : pool) { r -= Double.parseDouble(x[1]); if (r < 0) { pick = x; break; } }
            JsonObject t = items.tpl(pick[0]);
            if (t == null) continue;
            String rarity = t.has("rarity") ? t.get("rarity").getAsString() : shopRarity(rand.getAsDouble(), luck);
            out.add(new Slot(pick[0], rarity, itemValue(pick[0], rarity, 0), Integer.parseInt(pick[2])));
        }
        for (JsonElement g : econ.getAsJsonArray("SHOP_GOODS")) {
            JsonObject o = g.getAsJsonObject();
            JsonObject t = items.tpl(o.get("item").getAsString());
            if (t != null) out.add(new Slot(o.get("item").getAsString(), t.has("rarity") ? t.get("rarity").getAsString() : "common", o.get("price").getAsLong(), 99));
        }
        return out;
    }

    private static String shopRarity(double r, double luck) {
        double shift = Math.min(0.2, luck * 0.0005);
        return r < 0.4 - shift ? "poor" : r < 0.75 - shift ? "common" : "rare";
    }

    public int[] purchased(UUID id, long cycle, int n) {
        int[] out = new int[n];
        try (Connection c = db.getConnection(); PreparedStatement ps = c.prepareStatement("SELECT purchased FROM rpg_shop WHERE uuid = ? AND cycle = ?")) {
            ps.setString(1, id.toString());
            ps.setLong(2, cycle);
            try (ResultSet rs = ps.executeQuery()) {
                if (rs.next()) {
                    String[] parts = rs.getString(1).split(",");
                    for (int i = 0; i < Math.min(n, parts.length); i++) if (!parts[i].isEmpty()) out[i] = Integer.parseInt(parts[i]);
                }
            }
        } catch (SQLException e) { plugin.getLogger().warning("상점 기록 읽기 실패: " + e.getMessage()); }
        return out;
    }

    public void savePurchased(UUID id, long cycle, int[] got) {
        StringBuilder sb = new StringBuilder();
        for (int i = 0; i < got.length; i++) { if (i > 0) sb.append(','); sb.append(got[i]); }
        try (Connection c = db.getConnection()) {
            try (PreparedStatement d = c.prepareStatement("DELETE FROM rpg_shop WHERE uuid = ? AND cycle = ?")) { d.setString(1, id.toString()); d.setLong(2, cycle); d.executeUpdate(); }
            try (PreparedStatement ps = c.prepareStatement("INSERT INTO rpg_shop (uuid, cycle, purchased) VALUES (?,?,?)")) {
                ps.setString(1, id.toString()); ps.setLong(2, cycle); ps.setString(3, sb.toString()); ps.executeUpdate();
            }
        } catch (SQLException e) { plugin.getLogger().warning("상점 기록 저장 실패: " + e.getMessage()); }
    }
}
