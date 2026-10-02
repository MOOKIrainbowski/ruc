package kr.rucserver.core.service;

import kr.rucserver.core.RucCore;
import kr.rucserver.core.menu.MenuHolder;
import kr.rucserver.core.menu.Pages;
import kr.rucserver.core.model.RucPlayer;
import kr.rucserver.core.service.ScoreboardService.ReputationTier;
import kr.rucserver.core.storage.ShopRepository;
import kr.rucserver.core.storage.ShopRepository.Listing;
import net.kyori.adventure.text.Component;
import net.kyori.adventure.text.format.TextDecoration;
import org.bukkit.Bukkit;
import org.bukkit.Material;
import org.bukkit.Sound;
import org.bukkit.entity.Player;
import org.bukkit.event.inventory.ClickType;
import org.bukkit.inventory.Inventory;
import org.bukkit.inventory.ItemStack;
import org.bukkit.inventory.meta.ItemMeta;
import org.bukkit.scheduler.BukkitTask;

import java.util.ArrayList;
import java.util.Base64;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import java.util.logging.Level;

/**
 * 유저 상점 (Phase 10, docs/00-PLAN.md).
 *
 * <h2>흐름</h2>
 * <ul>
 *   <li>{@code /판매등록 <가격>} — 손에 든 아이템을 <b>먼저 손에서 빼고</b> 매물로 올립니다.
 *       올리기가 실패하면 되돌려 줍니다. 반대 순서면 올라간 뒤에도 손에 남아 복사가 됩니다.</li>
 *   <li>상점 화면에서 <b>더블클릭</b> → (설정에 따라 확인창) → 구매</li>
 *   <li>구매: 잔고 차감(메인 스레드 · 캐시) → {@code markSold} 조건부 UPDATE → 이겼으면
 *       구매자에게 물건 우편, 판매자에게 <b>수수료를 뺀</b> 대금 우편. 졌으면 돈을 돌려줍니다.</li>
 * </ul>
 *
 * <h2>왜 대금도 우편인가</h2>
 * 판매자는 대개 접속해 있지 않습니다. 미접속자의 잔고를 DB 에 직접 쓰면, 그 사람이 다른
 * 서버에 있을 때 그쪽 캐시가 덮어씁니다 (§7.4). 우편은 그 경쟁에 끼지 않습니다.
 *
 * <h2>수수료</h2>
 * 화폐 회수 장치입니다. 없으면 상점이 인플레이션 펌프가 됩니다 ({@code shop.fee-percent}).
 *
 * <h2>네트워크 공용</h2>
 * 매물 · 구매 모두 서버를 가리지 않습니다. 물건은 우편으로 가므로 어느 서버에서나 받습니다.
 * 청소(만료 되돌림 · 빠진 우편 채우기)는 {@code shop.sweep-server} 한 곳에서만 돕니다 —
 * 여러 서버가 같은 빈틈을 동시에 채우면 우편이 두 번 갈 수 있습니다.
 */
public class ShopService {

    private static final int[] CONTENT = Pages.content(4);
    private static final int SLOT_MINE = 47;
    private static final int SLOT_CONFIRM = 11;
    private static final int SLOT_PREVIEW = 13;
    private static final int SLOT_DENY = 15;

    private final RucCore plugin;
    private final MessageService messages;
    private final ShopRepository repository;
    private final Set<UUID> busy = new HashSet<>();
    private final ExecutorService io = Executors.newSingleThreadExecutor(r -> {
        Thread t = new Thread(r, "RucCore-Shop");
        t.setDaemon(true);
        return t;
    });
    private BukkitTask sweepTask;

    public ShopService(RucCore plugin, MessageService messages, ShopRepository repository) {
        this.plugin = plugin;
        this.messages = messages;
        this.repository = repository;
    }

    // 설정은 대체값 없이 읽습니다 — 배포본 config.yml 에 shop 섹션이 없어도 jar 기본값이 적용되게.
    private boolean enabled() { return plugin.getConfig().getBoolean("shop.enabled"); }
    private int feePercent() { return Math.max(0, Math.min(50, plugin.getConfig().getInt("shop.fee-percent"))); }
    private long minPrice() { return Math.max(1, plugin.getConfig().getLong("shop.min-price")); }
    private long maxPrice() { return plugin.getConfig().getLong("shop.max-price"); }
    private int maxListings() { return plugin.getConfig().getInt("shop.max-listings"); }
    private long listingMillis() { return plugin.getConfig().getLong("shop.listing-hours") * 3600_000L; }
    private boolean confirm() { return plugin.getConfig().getBoolean("shop.confirm-purchase"); }

    private String lang(Player p) { return plugin.getPlayerData().languageOf(p); }

    private void say(Player p, String key, String... ph) {
        if (p.isOnline()) p.sendMessage(messages.prefixed(lang(p), key, ph));
    }

    public long fee(long price) { return price * feePercent() / 100; }

    public void start() {
        String sweeper = plugin.getConfig().getString("shop.sweep-server", "home");
        if (!sweeper.equals(plugin.getConfig().getString("server-id", "unknown"))) return;
        sweepTask = Bukkit.getScheduler().runTaskTimer(plugin, () -> io.execute(this::sweep),
                20L * 30, 20L * 60 * 5);
    }

    public void stop() {
        if (sweepTask != null) sweepTask.cancel();
        io.shutdown();
        try {
            io.awaitTermination(15, TimeUnit.SECONDS);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
        }
    }

    /** 거래 제한(검정 평판) · 미인증은 사고팔 수 없습니다. */
    private boolean allowed(Player player) {
        RucPlayer data = plugin.getPlayerData().get(player);
        if (data == null || !data.isVerified()) {
            say(player, "shop.not-verified");
            return false;
        }
        if (ReputationTier.of(data.getReputation()) == ReputationTier.DARK) {
            say(player, "shop.reputation-blocked");
            return false;
        }
        return true;
    }

    // ── 등록 ───────────────────────────────────────────────────────────

    public void register(Player player, long price) {
        if (!enabled()) { say(player, "shop.disabled"); return; }
        if (!allowed(player)) return;
        if (price < minPrice() || price > maxPrice()) {
            say(player, "shop.price-range", "min", EconomyService.format(minPrice()),
                    "max", EconomyService.format(maxPrice()), "symbol", plugin.getEconomy().symbol());
            return;
        }
        ItemStack hand = player.getInventory().getItemInMainHand();
        if (hand.getType().isAir()) { say(player, "shop.empty-hand"); return; }
        UUID uuid = player.getUniqueId();
        if (!busy.add(uuid)) return;

        // 손에서 먼저 뺍니다 (위 설명). 아래에서 실패하면 되돌립니다.
        ItemStack item = hand.clone();
        player.getInventory().setItemInMainHand(null);
        String encoded;
        try {
            encoded = Base64.getEncoder().encodeToString(item.serializeAsBytes());
        } catch (Exception e) {
            plugin.getLogger().log(Level.SEVERE, "[상점] 아이템 직렬화 실패", e);
            giveBack(player, item);
            busy.remove(uuid);
            say(player, "shop.error");
            return;
        }
        String name = player.getName();
        long now = System.currentTimeMillis();
        io.execute(() -> {
            long id;
            String fail = null;
            try {
                if (repository.countActive(uuid, now) >= maxListings()) {
                    id = -1;
                    fail = "shop.too-many";
                } else {
                    id = repository.insert(uuid, name, encoded, price, now, now + listingMillis());
                }
            } catch (Exception e) {
                plugin.getLogger().log(Level.SEVERE, "[상점] 등록 실패", e);
                id = -1;
            }
            long listing = id;
            String reason = fail;
            Bukkit.getScheduler().runTask(plugin, () -> {
                busy.remove(uuid);
                if (listing <= 0) {
                    giveBack(player, item);
                    if (reason != null) say(player, reason, "max", String.valueOf(maxListings()));
                    else say(player, "shop.error");
                    return;
                }
                plugin.getLogger().info("[상점] #" + listing + " 등록 — " + name + " " + item.getType()
                        + " x" + item.getAmount() + " " + price + " Ruc");
                say(player, "shop.registered", "price", EconomyService.format(price),
                        "symbol", plugin.getEconomy().symbol(), "fee", String.valueOf(feePercent()));
            });
        });
    }

    /** 되돌리기. 손이 비어 있으면 손으로, 아니면 인벤토리, 그것도 차면 우편으로. */
    private void giveBack(Player player, ItemStack item) {
        if (player.isOnline()) {
            if (player.getInventory().getItemInMainHand().getType().isAir()) {
                player.getInventory().setItemInMainHand(item);
                return;
            }
            if (player.getInventory().addItem(item).isEmpty()) return;
        }
        UUID uuid = player.getUniqueId();
        io.execute(() -> plugin.getMailbox().sendItemOnce(uuid, item, "러크 상점",
                "상점 반환 " + System.currentTimeMillis()));
    }

    // ── 화면 ───────────────────────────────────────────────────────────

    /** @param mine true 면 내 판매 목록 (더블클릭 = 취소) */
    public void open(Player player, int page, boolean mine) {
        if (!enabled()) { say(player, "shop.disabled"); return; }
        if (plugin.getGuide() != null) plugin.getGuide().trigger(player, "shop");
        UUID uuid = player.getUniqueId();
        long now = System.currentTimeMillis();
        io.execute(() -> {
            int total;
            List<Listing> rows;
            int pages;
            int current;
            try {
                total = repository.countActive(mine ? uuid : null, now);
                pages = Pages.pageCount(total, CONTENT.length);
                current = Math.max(0, Math.min(page, pages - 1));
                rows = repository.active(mine ? uuid : null, now, current * CONTENT.length, CONTENT.length);
            } catch (Exception e) {
                plugin.getLogger().log(Level.SEVERE, "[상점] 목록 조회 실패", e);
                Bukkit.getScheduler().runTask(plugin, () -> say(player, "shop.error"));
                return;
            }
            Bukkit.getScheduler().runTask(plugin, () -> {
                if (player.isOnline()) render(player, rows, current, pages, mine);
            });
        });
    }

    private void render(Player player, List<Listing> rows, int page, int pages, boolean mine) {
        String lang = lang(player);
        MenuHolder holder = new MenuHolder(mine ? MenuHolder.Type.SHOP_MINE : MenuHolder.Type.SHOP);
        holder.setPage(page);
        Inventory inv = Bukkit.createInventory(holder, Pages.SIZE, messages.get(lang,
                mine ? "shop.mine-title" : "shop.title",
                "page", String.valueOf(page + 1), "pages", String.valueOf(pages)));
        holder.setInventory(inv);

        ItemStack pane = icon(Material.GRAY_STAINED_GLASS_PANE, " ", List.of());
        for (int i = 0; i < Pages.SIZE; i++) inv.setItem(i, pane);
        for (int slot : CONTENT) inv.setItem(slot, null);

        for (int i = 0; i < rows.size() && i < CONTENT.length; i++) {
            Listing l = rows.get(i);
            inv.setItem(CONTENT[i], display(l, lang, player.getUniqueId(), mine));
            holder.mapSlot(CONTENT[i], l.id());
        }
        if (rows.isEmpty()) {
            inv.setItem(CONTENT[CONTENT.length / 2 - 4], icon(Material.LIGHT_GRAY_DYE,
                    messages.raw(lang, mine ? "shop.mine-empty" : "shop.empty"), List.of()));
        }
        if (page > 0) inv.setItem(Pages.SLOT_PREV, icon(Material.ARROW, messages.raw(lang, "shop.prev"), List.of()));
        if (page < pages - 1) inv.setItem(Pages.SLOT_NEXT, icon(Material.ARROW, messages.raw(lang, "shop.next"), List.of()));
        inv.setItem(SLOT_MINE, icon(mine ? Material.EMERALD : Material.CHEST,
                messages.raw(lang, mine ? "shop.to-all" : "shop.to-mine"), List.of()));
        inv.setItem(Pages.SLOT_ACTION, icon(Material.BOOK, messages.raw(lang, "shop.info-name"),
                lines(messages.raw(lang, "shop.info-lore").replace("%fee%", String.valueOf(feePercent())))));

        player.openInventory(inv);
        player.playSound(player.getLocation(), Sound.BLOCK_BARREL_OPEN, 0.6f, 1.2f);
    }

    /** 목록에 보이는 사본. 실제로 주는 물건은 구매 때 DB 에서 다시 읽습니다. */
    private ItemStack display(Listing l, String lang, UUID viewer, boolean mine) {
        ItemStack stack;
        try {
            stack = ItemStack.deserializeBytes(Base64.getDecoder().decode(l.item()));
        } catch (Exception e) {
            stack = new ItemStack(Material.BARRIER);
        }
        ItemMeta meta = stack.getItemMeta();
        List<Component> lore = meta.hasLore() && meta.lore() != null ? new ArrayList<>(meta.lore()) : new ArrayList<>();
        lore.add(Component.empty());
        String symbol = plugin.getEconomy().symbol();
        for (String line : messages.raw(lang, "shop.entry").split("\\|")) {
            lore.add(line(line.replace("%seller%", l.sellerName())
                    .replace("%price%", EconomyService.format(l.price()))
                    .replace("%symbol%", symbol)
                    .replace("%remain%", remaining(l.expiresAt() - System.currentTimeMillis()))));
        }
        String action = mine ? "shop.entry-cancel"
                : l.seller().equals(viewer) ? "shop.entry-own" : "shop.entry-buy";
        lore.add(line(messages.raw(lang, action)));
        meta.lore(lore);
        stack.setItemMeta(meta);
        return stack;
    }

    // ── 클릭 (MenuListener 가 넘겨 줍니다 — 모든 클릭은 이미 취소된 상태) ──

    public void click(Player player, MenuHolder holder, int slot, ClickType type) {
        boolean mine = holder.getType() == MenuHolder.Type.SHOP_MINE;
        if (holder.getType() == MenuHolder.Type.SHOP_CONFIRM) {
            long id = holder.idAt(SLOT_CONFIRM);
            if (slot == SLOT_CONFIRM) buy(player, id, holder.getPage());
            else if (slot == SLOT_DENY) open(player, holder.getPage(), false);
            return;
        }
        if (slot == Pages.SLOT_PREV) { open(player, holder.getPage() - 1, mine); return; }
        if (slot == Pages.SLOT_NEXT) { open(player, holder.getPage() + 1, mine); return; }
        if (slot == SLOT_MINE) { open(player, 0, !mine); return; }

        long id = holder.idAt(slot);
        if (id < 0) return;
        // 오클릭 방지: 구매 · 취소는 더블클릭만 (계획서 §Phase 10)
        if (type != ClickType.DOUBLE_CLICK) return;
        if (mine) { cancel(player, id, holder.getPage()); return; }
        if (confirm()) openConfirm(player, id, holder.getPage(), holder.getInventory().getItem(slot));
        else buy(player, id, holder.getPage());
    }

    private void openConfirm(Player player, long id, int page, ItemStack preview) {
        String lang = lang(player);
        MenuHolder holder = new MenuHolder(MenuHolder.Type.SHOP_CONFIRM);
        holder.setPage(page);
        holder.mapSlot(SLOT_CONFIRM, id);
        Inventory inv = Bukkit.createInventory(holder, 27, messages.get(lang, "shop.confirm-title"));
        holder.setInventory(inv);
        ItemStack pane = icon(Material.GRAY_STAINED_GLASS_PANE, " ", List.of());
        for (int i = 0; i < 27; i++) inv.setItem(i, pane);
        inv.setItem(SLOT_CONFIRM, icon(Material.LIME_CONCRETE, messages.raw(lang, "shop.confirm-yes"), List.of()));
        if (preview != null) inv.setItem(SLOT_PREVIEW, preview.clone());
        inv.setItem(SLOT_DENY, icon(Material.RED_CONCRETE, messages.raw(lang, "shop.confirm-no"), List.of()));
        player.openInventory(inv);
    }

    // ── 구매 ───────────────────────────────────────────────────────────

    public void buy(Player player, long id, int page) {
        if (!allowed(player)) return;
        UUID uuid = player.getUniqueId();
        if (!busy.add(uuid)) return;
        io.execute(() -> {
            Listing l;
            try {
                l = repository.find(id);
            } catch (Exception e) {
                plugin.getLogger().log(Level.SEVERE, "[상점] 매물 조회 실패 #" + id, e);
                l = null;
            }
            Listing listing = l;
            Bukkit.getScheduler().runTask(plugin, () -> {
                if (listing == null || !listing.status().equals("ACTIVE")
                        || listing.expiresAt() <= System.currentTimeMillis()) {
                    busy.remove(uuid);
                    say(player, "shop.gone");
                    open(player, page, false);
                    return;
                }
                if (listing.seller().equals(uuid)) {
                    busy.remove(uuid);
                    say(player, "shop.own");
                    return;
                }
                // 돈을 먼저 받습니다 (메인 스레드 · 캐시). 판매 확정에서 지면 돌려줍니다.
                if (!plugin.getEconomy().withdraw(uuid, listing.price())) {
                    busy.remove(uuid);
                    say(player, "shop.no-money", "price", EconomyService.format(listing.price()),
                            "symbol", plugin.getEconomy().symbol());
                    return;
                }
                String buyerName = player.getName();
                long fee = fee(listing.price());
                io.execute(() -> {
                    boolean won;
                    try {
                        won = repository.markSold(id, uuid, buyerName, fee, System.currentTimeMillis());
                    } catch (Exception e) {
                        plugin.getLogger().log(Level.SEVERE, "[상점] 판매 확정 실패 #" + id, e);
                        won = false;
                    }
                    if (won) deliver(repository.findQuietly(id));
                    boolean ok = won;
                    Bukkit.getScheduler().runTask(plugin, () -> {
                        busy.remove(uuid);
                        if (!ok) {
                            plugin.getEconomy().deposit(uuid, listing.price());
                            say(player, "shop.gone");
                            open(player, page, false);
                            return;
                        }
                        plugin.getLogger().info("[상점] #" + id + " 판매 — " + listing.sellerName() + " → "
                                + buyerName + " " + listing.price() + " Ruc (수수료 " + fee + ")");
                        say(player, "shop.bought", "price", EconomyService.format(listing.price()),
                                "symbol", plugin.getEconomy().symbol());
                        player.playSound(player.getLocation(), Sound.ENTITY_EXPERIENCE_ORB_PICKUP, 0.7f, 1.2f);
                        Player seller = Bukkit.getPlayer(listing.seller());
                        if (seller != null) say(seller, "shop.sold-notice", "buyer", buyerName,
                                "price", EconomyService.format(listing.price() - fee),
                                "symbol", plugin.getEconomy().symbol());
                        open(player, page, false);
                    });
                });
            });
        });
    }

    // ── 취소 ───────────────────────────────────────────────────────────

    public void cancel(Player player, long id, int page) {
        UUID uuid = player.getUniqueId();
        if (!busy.add(uuid)) return;
        io.execute(() -> {
            boolean ok;
            try {
                ok = repository.markCancelled(id, uuid, System.currentTimeMillis());
                if (ok) deliver(repository.findQuietly(id));
            } catch (Exception e) {
                plugin.getLogger().log(Level.SEVERE, "[상점] 취소 실패 #" + id, e);
                ok = false;
            }
            boolean done = ok;
            Bukkit.getScheduler().runTask(plugin, () -> {
                busy.remove(uuid);
                say(player, done ? "shop.cancelled" : "shop.gone");
                if (player.isOnline()) open(player, page, true);
            });
        });
    }

    // ── 우편 (멱등) ────────────────────────────────────────────────────

    /**
     * 끝난 매물의 우편을 보냅니다. 사유에 매물 번호가 들어가 있어 몇 번을 불러도 한 번만 갑니다.
     * <b>io 스레드에서만</b> 부릅니다.
     */
    private void deliver(Listing l) {
        if (l == null) return;
        try {
            if (!l.itemDone()) {
                ItemStack item = ItemStack.deserializeBytes(Base64.getDecoder().decode(l.item()));
                boolean sold = l.status().equals("SOLD");
                UUID to = sold ? l.buyer() : l.seller();
                String reason = (sold ? "상점 구매 #" : l.status().equals("EXPIRED") ? "상점 만료 #" : "상점 취소 #") + l.id();
                if (plugin.getMailbox().sendItemOnce(to, item, "러크 상점", reason) == MailboxService.Result.OK) {
                    repository.markItemDone(l.id());
                }
            }
            if (l.status().equals("SOLD") && !l.proceedsDone()) {
                long proceeds = l.price() - l.fee();
                MailboxService.Result r = proceeds <= 0 ? MailboxService.Result.OK
                        : plugin.getMailbox().sendRucOnce(l.seller(), proceeds, "러크 상점", "상점 대금 #" + l.id());
                if (r == MailboxService.Result.OK) repository.markProceedsDone(l.id());
            }
        } catch (Exception e) {
            plugin.getLogger().log(Level.SEVERE, "[상점] 우편 실패 #" + l.id() + " — 청소가 다시 시도합니다", e);
        }
    }

    /** 만료 처리 + 빠진 우편 채우기. sweep-server 한 곳에서만, io 스레드에서. */
    private void sweep() {
        try {
            int expired = repository.expire(System.currentTimeMillis());
            if (expired > 0) plugin.getLogger().info("[상점] 기간 만료 " + expired + "건 → 판매자에게 되돌림");
            for (Listing l : repository.unfinished(50)) deliver(l);
        } catch (Exception e) {
            plugin.getLogger().log(Level.WARNING, "[상점] 청소 실패", e);
        }
    }

    // ── 표시 도구 ─────────────────────────────────────────────────────

    private static Component line(String legacy) {
        return MessageService.colorize(legacy).decoration(TextDecoration.ITALIC, false);
    }

    private static List<Component> lines(String legacy) {
        List<Component> out = new ArrayList<>();
        for (String s : legacy.split("\\|")) out.add(line(s));
        return out;
    }

    private static ItemStack icon(Material material, String name, List<Component> lore) {
        ItemStack item = new ItemStack(material);
        ItemMeta meta = item.getItemMeta();
        meta.displayName(line(name));
        if (!lore.isEmpty()) meta.lore(lore);
        item.setItemMeta(meta);
        return item;
    }

    private static String remaining(long millis) {
        long minutes = Math.max(0, millis / 60_000);
        long days = minutes / 1440;
        long hours = (minutes % 1440) / 60;
        if (days > 0) return days + "d " + hours + "h";
        return hours + "h " + (minutes % 60) + "m";
    }
}
