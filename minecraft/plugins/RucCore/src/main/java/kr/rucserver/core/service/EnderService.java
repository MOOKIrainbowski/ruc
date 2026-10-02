package kr.rucserver.core.service;

import kr.rucserver.core.RucCore;
import kr.rucserver.core.model.RucPlayer;
import kr.rucserver.core.storage.EnderRepository;
import net.kyori.adventure.text.Component;
import org.bukkit.Bukkit;
import org.bukkit.Material;
import org.bukkit.NamespacedKey;
import org.bukkit.Sound;
import org.bukkit.block.Block;
import org.bukkit.entity.Player;
import org.bukkit.event.EventHandler;
import org.bukkit.event.EventPriority;
import org.bukkit.event.Listener;
import org.bukkit.event.block.Action;
import org.bukkit.event.inventory.InventoryClickEvent;
import org.bukkit.event.inventory.InventoryCloseEvent;
import org.bukkit.event.inventory.InventoryDragEvent;
import org.bukkit.event.player.PlayerInteractEvent;
import org.bukkit.event.player.PlayerQuitEvent;
import org.bukkit.inventory.EquipmentSlot;
import org.bukkit.inventory.Inventory;
import org.bukkit.inventory.InventoryHolder;
import org.bukkit.inventory.ItemStack;
import org.bukkit.inventory.meta.ItemMeta;
import org.bukkit.persistence.PersistentDataType;
import org.bukkit.util.io.BukkitObjectInputStream;
import org.bukkit.util.io.BukkitObjectOutputStream;
import org.jetbrains.annotations.NotNull;

import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.util.ArrayList;
import java.util.Base64;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import java.util.logging.Level;

/**
 * 엔더상자 확장 (2026-10-02 소유자 결정, 같은 날 개정).
 *
 * <h2>화면</h2>
 * Shift+F 메뉴의 [엔더상자] 또는 엔더상자를 웅크리고 우클릭하면 <b>내 엔더상자 목록</b>이
 * 열립니다. 가진 개수만큼 엔더상자가 놓여 있고, 하나를 누르면 그 상자(27칸)가 열립니다.
 * 1번은 바닐라 엔더상자 그대로이고, 2번부터가 확장입니다. 바닐라 쪽은 손대지 않으므로
 * 바닐라 엔더상자에 복사 · 유실 경로가 새로 생기지 않습니다.
 *
 * <h2>얻는 법</h2>
 * 몇 개를 가졌는가는 {@code ruc_entitlement} 원장의 {@code ender_pages} 합입니다.
 * <ul>
 *   <li>디스코드 {@code /충전} — 바로 늘어남 ({@code purchase})</li>
 *   <li>{@code /엔더확장 구매} — 레벨 · Ruc 를 내고 <b>확장권</b>을 우편으로 받습니다.
 *       확장권을 들고 우클릭하면 늘어납니다 ({@code voucher})</li>
 * </ul>
 * 합쳐서 {@code ender.max-pages} 까지입니다.
 *
 * <h2>확장권의 두 가지 장치</h2>
 * <ol>
 *   <li><b>한 번만 쓰입니다.</b> 아이템에는 {@code ruc_ender_voucher} 의 id 만 있고, 사용은
 *       조건부 UPDATE 가 한 번만 통과시킵니다. 아이템을 복사해도 두 번째는 실패합니다.</li>
 *   <li><b>가격 단계는 "그 사람이 지금까지 산 확장권 수"</b> 입니다. 가진 페이지 수로
 *       정하면, 1단계 가격으로 계속 사서 남에게 넘기는 것만으로 단계를 건너뜁니다.</li>
 * </ol>
 *
 * <h2>상자 내용의 복사를 막는 세 가지</h2>
 * <ol>
 *   <li>저장은 상자가 <b>닫힐 때 한 곳에서만</b> 합니다.</li>
 *   <li>접속 중에는 <b>메모리 사본이 기준</b>입니다. 닫고 바로 다시 열 때 DB 를 다시 읽으면
 *       저장이 아직 안 끝난 옛 내용이 나와 복사가 됩니다.</li>
 *   <li>DB 작업은 <b>단일 스레드 큐</b>입니다. 나갔다 바로 들어와도 저장이 읽기보다 먼저입니다.</li>
 * </ol>
 * 확장 상자의 내용은 <b>서버마다 따로</b>입니다 (EnderRepository 참고).
 */
public class EnderService implements Listener {

    private static final int SIZE = 27;
    /** 목록 화면에서 엔더상자를 놓는 칸 (가운데 줄, 최대 7개까지 좌우 대칭). */
    private static final int[][] LAYOUT = {
            {13},
            {12, 14},
            {11, 13, 15},
            {10, 12, 14, 16},
            {9, 11, 13, 15, 17},
            {10, 11, 12, 14, 15, 16},
            {10, 11, 12, 13, 14, 15, 16},
    };
    private static final int SLOT_MORE = 22;

    private final RucCore plugin;
    private final MessageService messages;
    private final EnderRepository repository;
    private final NamespacedKey voucherKey;

    private final ExecutorService io = Executors.newSingleThreadExecutor(r -> {
        Thread t = new Thread(r, "RucCore-Ender");
        t.setDaemon(true);
        return t;
    });

    /** 접속 중인 사람의 불러온 확장 상자 (메인 스레드 전용). 키 = 상자 번호(1부터). */
    private final Map<UUID, Map<Integer, ItemStack[]>> cache = new HashMap<>();

    /** 처리 중 — 연타로 두 번 처리되지 않게. */
    private final Set<UUID> busy = new HashSet<>();

    public EnderService(RucCore plugin, MessageService messages, EnderRepository repository) {
        this.plugin = plugin;
        this.messages = messages;
        this.repository = repository;
        this.voucherKey = new NamespacedKey(plugin, "ender_voucher");
    }

    // 대체값을 직접 넘기지 않습니다. getInt(path, def) 는 jar 기본값을 보지 않아서, ender 섹션이
    // 없는 배포본 config.yml 에서 jar 의 값 대신 코드의 대체값이 나옵니다 (MessageService 와 같은 함정).
    public boolean enabled() {
        return plugin.getConfig().getBoolean("ender.enabled");
    }

    /** 확장 개수 상한 (바닐라 1개 제외). 기본 6 → 엔더상자 최대 7개. */
    public int maxPages() {
        return Math.max(0, Math.min(6, plugin.getConfig().getInt("ender.max-pages")));
    }

    private String serverId() {
        return plugin.getConfig().getString("server-id", "unknown");
    }

    private String lang(Player p) {
        return plugin.getPlayerData().languageOf(p);
    }

    private void error(Player player) {
        if (player.isOnline()) player.sendMessage(messages.prefixed(lang(player), "ender.error"));
    }

    // ── 목록 화면 ─────────────────────────────────────────────────────

    /** 웅크리고 엔더상자 우클릭 → 목록 화면. */
    @EventHandler(priority = EventPriority.HIGH, ignoreCancelled = true)
    public void onInteract(PlayerInteractEvent event) {
        if (event.getHand() != EquipmentSlot.HAND) return;
        Player player = event.getPlayer();

        // 확장권 사용 (공중 · 블록 우클릭 모두)
        if ((event.getAction() == Action.RIGHT_CLICK_AIR || event.getAction() == Action.RIGHT_CLICK_BLOCK)
                && voucherId(event.getItem()) > 0) {
            event.setCancelled(true);
            redeem(player, voucherId(event.getItem()));
            return;
        }

        if (event.getAction() != Action.RIGHT_CLICK_BLOCK) return;
        Block block = event.getClickedBlock();
        if (block == null || block.getType() != Material.ENDER_CHEST) return;
        if (!player.isSneaking() || !enabled()) return;
        // 웅크린 채 엔더상자에 블록을 붙이는 동작은 막힙니다 — 목록을 여는 손짓과 겹칩니다.
        event.setCancelled(true);
        openSelector(player);
    }

    /** 내 엔더상자 목록. Shift+F 메뉴의 [엔더상자] 도 여기로 옵니다. */
    public void openSelector(Player player) {
        if (plugin.getGuide() != null) plugin.getGuide().trigger(player, "ender");
        if (!enabled()) {
            player.sendMessage(messages.prefixed(lang(player), "ender.disabled"));
            return;
        }
        UUID uuid = player.getUniqueId();
        if (!busy.add(uuid)) return;
        io.execute(() -> {
            int owned;
            try {
                owned = Math.min(maxPages(), plugin.getPayments().total(uuid, PaymentService.ENDER_PAGES));
            } catch (Exception e) {
                plugin.getLogger().log(Level.SEVERE, "[엔더] 개수 조회 실패: " + player.getName(), e);
                Bukkit.getScheduler().runTask(plugin, () -> { busy.remove(uuid); error(player); });
                return;
            }
            Bukkit.getScheduler().runTask(plugin, () -> {
                busy.remove(uuid);
                if (player.isOnline()) player.openInventory(buildSelector(player, owned));
            });
        });
    }

    private Inventory buildSelector(Player player, int owned) {
        String lang = lang(player);
        int total = 1 + owned;
        SelectorHolder holder = new SelectorHolder(owned);
        Inventory inv = Bukkit.createInventory(holder, SIZE,
                messages.get(lang, "ender.selector-title", "count", String.valueOf(total)));
        holder.inventory = inv;

        ItemStack pane = icon(Material.BLACK_STAINED_GLASS_PANE, Component.text(" "), List.of());
        for (int i = 0; i < SIZE; i++) inv.setItem(i, pane);

        int[] slots = LAYOUT[Math.min(total, LAYOUT.length) - 1];
        for (int i = 0; i < total && i < slots.length; i++) {
            holder.slots.put(slots[i], i);
            inv.setItem(slots[i], icon(Material.ENDER_CHEST,
                    messages.get(lang, i == 0 ? "ender.chest-vanilla" : "ender.chest-name",
                            "n", String.valueOf(i + 1)),
                    List.of(messages.get(lang, "ender.chest-lore"))));
        }
        if (owned < maxPages()) {
            inv.setItem(SLOT_MORE, icon(Material.EXPERIENCE_BOTTLE, messages.get(lang, "ender.more-name"),
                    List.of(messages.get(lang, "ender.more-lore",
                            "owned", String.valueOf(total), "max", String.valueOf(1 + maxPages())))));
        }
        return inv;
    }

    private static ItemStack icon(Material material, Component name, List<Component> lore) {
        ItemStack item = new ItemStack(material);
        ItemMeta meta = item.getItemMeta();
        meta.displayName(name);
        if (!lore.isEmpty()) meta.lore(lore);
        item.setItemMeta(meta);
        return item;
    }

    // ── 상자 열기 ─────────────────────────────────────────────────────

    /** {@code n == 0} 은 바닐라 엔더상자, 1 부터 확장 상자. */
    public void openChest(Player player, int n, int owned) {
        if (n == 0) {
            player.openInventory(player.getEnderChest());
            return;
        }
        if (n > owned) return;
        UUID uuid = player.getUniqueId();
        Map<Integer, ItemStack[]> pages = cache.computeIfAbsent(uuid, k -> new HashMap<>());
        if (pages.containsKey(n)) {
            player.openInventory(buildChest(player, n, pages.get(n)));
            return;
        }
        if (!busy.add(uuid)) return;
        String server = serverId();
        io.execute(() -> {
            String raw;
            try {
                raw = repository.load(uuid, server, n);
            } catch (Exception e) {
                plugin.getLogger().log(Level.SEVERE, "[엔더] 불러오기 실패: " + player.getName(), e);
                Bukkit.getScheduler().runTask(plugin, () -> { busy.remove(uuid); error(player); });
                return;
            }
            Bukkit.getScheduler().runTask(plugin, () -> {
                busy.remove(uuid);
                if (!player.isOnline()) return;
                Map<Integer, ItemStack[]> now = cache.computeIfAbsent(uuid, k -> new HashMap<>());
                // 불러오는 사이에 메모리 사본이 생겼으면 그쪽이 최신입니다.
                if (!now.containsKey(n)) {
                    try {
                        now.put(n, raw == null ? new ItemStack[SIZE] : deserialize(raw));
                    } catch (Exception e) {
                        plugin.getLogger().log(Level.SEVERE, "[엔더] 역직렬화 실패: " + player.getName()
                                + " " + n + "번 — 열지 않습니다 (덮어쓰기 방지)", e);
                        error(player);
                        return;
                    }
                }
                player.openInventory(buildChest(player, n, now.get(n)));
            });
        });
    }

    private Inventory buildChest(Player player, int n, ItemStack[] items) {
        ChestHolder holder = new ChestHolder(player.getUniqueId(), n);
        Inventory inv = Bukkit.createInventory(holder, SIZE,
                messages.get(lang(player), "ender.chest-title", "n", String.valueOf(n + 1)));
        holder.inventory = inv;
        for (int i = 0; i < SIZE && i < items.length; i++) inv.setItem(i, items[i]);
        player.playSound(player.getLocation(), Sound.BLOCK_ENDER_CHEST_OPEN, 0.5f, 1.0f);
        return inv;
    }

    // ── 클릭 · 닫기 ────────────────────────────────────────────────────

    @EventHandler(priority = EventPriority.HIGH)
    public void onClick(InventoryClickEvent event) {
        if (!(event.getView().getTopInventory().getHolder() instanceof SelectorHolder holder)) return;
        // 목록 화면은 전부 장식입니다. 아래 인벤토리 쉬프트 클릭까지 막습니다.
        event.setCancelled(true);
        if (!(event.getWhoClicked() instanceof Player player)) return;
        if (event.getClickedInventory() != event.getView().getTopInventory()) return;

        Integer n = holder.slots.get(event.getRawSlot());
        if (n != null) {
            // 클릭 이벤트 안에서 창을 바꾸면 안 됩니다. 다음 틱에.
            Bukkit.getScheduler().runTask(plugin, () -> {
                if (player.isOnline()) openChest(player, n, holder.owned);
            });
        } else if (event.getRawSlot() == SLOT_MORE) {
            player.closeInventory();
            unlock(player, false);
        }
    }

    @EventHandler(priority = EventPriority.HIGH)
    public void onDrag(InventoryDragEvent event) {
        if (event.getView().getTopInventory().getHolder() instanceof SelectorHolder) {
            event.setCancelled(true);
        }
    }

    @EventHandler(priority = EventPriority.MONITOR)
    public void onClose(InventoryCloseEvent event) {
        if (event.getInventory().getHolder() instanceof ChestHolder holder) save(holder, false);
    }

    /** 나갈 때: 닫힘 이벤트가 먼저 와서 저장은 끝났습니다. 메모리 사본만 치웁니다. */
    @EventHandler(priority = EventPriority.MONITOR)
    public void onQuit(PlayerQuitEvent event) {
        cache.remove(event.getPlayer().getUniqueId());
        busy.remove(event.getPlayer().getUniqueId());
    }

    private void save(ChestHolder holder, boolean blocking) {
        ItemStack[] items = new ItemStack[SIZE];
        for (int i = 0; i < SIZE; i++) {
            ItemStack it = holder.inventory.getItem(i);
            items[i] = it == null ? null : it.clone();
        }
        cache.computeIfAbsent(holder.owner, k -> new HashMap<>()).put(holder.n, items);

        String encoded;
        try {
            encoded = serialize(items);
        } catch (Exception e) {
            plugin.getLogger().log(Level.SEVERE, "[엔더] 직렬화 실패 " + holder.owner + " " + holder.n, e);
            return;
        }
        String server = serverId();
        Runnable write = () -> {
            try {
                repository.save(holder.owner, server, holder.n, encoded);
            } catch (Exception e) {
                plugin.getLogger().log(Level.SEVERE, "[엔더] 저장 실패 " + holder.owner + " " + holder.n, e);
            }
        };
        if (blocking) write.run(); else io.execute(write);
    }

    public void stop() {
        // 종료 시: 열린 상자를 동기로 저장하고, 큐에 남은 저장을 끝까지 기다립니다.
        for (Player player : Bukkit.getOnlinePlayers()) {
            if (player.getOpenInventory().getTopInventory().getHolder() instanceof ChestHolder holder) {
                save(holder, true);
            }
        }
        io.shutdown();
        try {
            if (!io.awaitTermination(15, TimeUnit.SECONDS)) {
                plugin.getLogger().severe("[엔더] 저장 큐가 15초 안에 끝나지 않았습니다");
            }
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
        }
        cache.clear();
    }

    // ── /엔더확장 — 확장권 사기 ───────────────────────────────────────

    /** n 번째 확장권의 조건. 설정 {@code ender.unlock} 의 n 번째. */
    public record Requirement(int level, long cost) { }

    public List<Requirement> requirements() {
        List<Requirement> out = new ArrayList<>();
        for (Map<?, ?> row : plugin.getConfig().getMapList("ender.unlock")) {
            if (row.get("level") instanceof Number l && row.get("cost") instanceof Number c) {
                out.add(new Requirement(l.intValue(), c.longValue()));
            }
        }
        return out;
    }

    /** 상태를 보여 주거나({@code buy=false}), 확장권을 사서 우편으로 보냅니다. */
    public void unlock(Player player, boolean buy) {
        UUID uuid = player.getUniqueId();
        String lang = lang(player);
        if (!enabled()) {
            player.sendMessage(messages.prefixed(lang, "ender.disabled"));
            return;
        }
        if (!busy.add(uuid)) return;

        io.execute(() -> {
            int owned;
            int bought;
            int outstanding;
            try {
                owned = plugin.getPayments().total(uuid, PaymentService.ENDER_PAGES);
                bought = repository.countBought(uuid);
                outstanding = repository.countOutstanding(uuid);
            } catch (Exception e) {
                plugin.getLogger().log(Level.SEVERE, "[엔더] 상태 조회 실패", e);
                Bukkit.getScheduler().runTask(plugin, () -> { busy.remove(uuid); error(player); });
                return;
            }
            Bukkit.getScheduler().runTask(plugin, () -> {
                if (!player.isOnline()) { busy.remove(uuid); return; }
                List<Requirement> reqs = requirements();
                String symbol = plugin.getEconomy().symbol();
                player.sendMessage(messages.prefixed(lang, "ender.status",
                        "owned", String.valueOf(1 + Math.min(owned, maxPages())),
                        "max", String.valueOf(1 + maxPages())));
                if (outstanding > 0) {
                    player.sendMessage(messages.get(lang, "ender.outstanding", "count", String.valueOf(outstanding)));
                }

                // 이미 가진 것 + 아직 안 쓴 내 확장권이 상한에 닿으면 더 살 이유가 없습니다.
                if (owned + outstanding >= maxPages()) {
                    busy.remove(uuid);
                    player.sendMessage(messages.get(lang, "ender.max"));
                    return;
                }
                if (bought >= reqs.size()) {
                    busy.remove(uuid);
                    player.sendMessage(messages.get(lang, "ender.no-free"));
                    return;
                }
                Requirement next = reqs.get(bought);
                if (!buy) {
                    busy.remove(uuid);
                    player.sendMessage(messages.get(lang, "ender.next-cost",
                            "level", String.valueOf(next.level()),
                            "cost", EconomyService.format(next.cost()), "symbol", symbol));
                    return;
                }
                RucPlayer data = plugin.getPlayerData().get(player);
                if (data == null || data.getLevel() < next.level()) {
                    busy.remove(uuid);
                    player.sendMessage(messages.prefixed(lang, "ender.need-level",
                            "level", String.valueOf(next.level())));
                    return;
                }
                // 돈을 먼저 받고(메인 스레드 · 캐시), 발급 · 우편이 실패하면 돌려줍니다.
                if (!plugin.getEconomy().withdraw(uuid, next.cost())) {
                    busy.remove(uuid);
                    player.sendMessage(messages.prefixed(lang, "ender.need-ruc",
                            "cost", EconomyService.format(next.cost()), "symbol", symbol));
                    return;
                }
                issue(player, next.cost());
            });
        });
    }

    /** 확장권 발급 → 우편. 실패하면 발급을 지우고 돈을 돌려줍니다. */
    private void issue(Player player, long cost) {
        UUID uuid = player.getUniqueId();
        String lang = lang(player);
        io.execute(() -> {
            long id;
            try {
                id = repository.issueVoucher(uuid, cost);
            } catch (Exception e) {
                plugin.getLogger().log(Level.SEVERE, "[엔더] 확장권 발급 실패", e);
                id = -1;
            }
            long voucher = id;
            Bukkit.getScheduler().runTask(plugin, () -> {
                if (voucher <= 0) {
                    busy.remove(uuid);
                    plugin.getEconomy().deposit(uuid, cost);
                    error(player);
                    return;
                }
                ItemStack item = voucherItem(lang, voucher);
                // sendItemOnce 는 블로킹이라 큐에서 돌립니다. 사유에 id 를 넣어 두 번 가지 않게.
                io.execute(() -> {
                    MailboxService.Result r = plugin.getMailbox().sendItemOnce(uuid, item,
                            "러크", "엔더 확장권 #" + voucher);
                    if (r != MailboxService.Result.OK) {
                        try { repository.voidVoucher(voucher); } catch (Exception ignored) { }
                    }
                    Bukkit.getScheduler().runTask(plugin, () -> {
                        busy.remove(uuid);
                        if (r != MailboxService.Result.OK) {
                            plugin.getEconomy().deposit(uuid, cost);
                            error(player);
                            return;
                        }
                        plugin.getLogger().info("[엔더] " + player.getName() + " 확장권 #" + voucher
                                + " 구매 (" + cost + " Ruc) → 우편");
                        if (player.isOnline()) {
                            player.sendMessage(messages.prefixed(lang, "ender.voucher-sent"));
                        }
                    });
                });
            });
        });
    }

    private ItemStack voucherItem(String lang, long id) {
        ItemStack item = new ItemStack(Material.PAPER);
        ItemMeta meta = item.getItemMeta();
        meta.displayName(messages.get(lang, "ender.voucher-name"));
        meta.lore(List.of(
                messages.get(lang, "ender.voucher-lore"),
                Component.text("#" + id, net.kyori.adventure.text.format.NamedTextColor.DARK_GRAY)));
        meta.setEnchantmentGlintOverride(true);
        meta.getPersistentDataContainer().set(voucherKey, PersistentDataType.LONG, id);
        item.setItemMeta(meta);
        return item;
    }

    private long voucherId(ItemStack item) {
        if (item == null || item.getType() != Material.PAPER || !item.hasItemMeta()) return -1;
        Long id = item.getItemMeta().getPersistentDataContainer().get(voucherKey, PersistentDataType.LONG);
        return id == null ? -1 : id;
    }

    // ── 확장권 쓰기 ───────────────────────────────────────────────────

    /**
     * 확장권 사용. DB 에서 먼저 "사용됨" 을 표시하고, 성공했을 때만 아이템을 지웁니다.
     * 반대 순서면 아이템을 지운 뒤 DB 가 실패했을 때 확장권이 그냥 사라집니다.
     * 이 순서에서 남는 최악은 "이미 사용된 확장권" 종이 한 장입니다.
     */
    private void redeem(Player player, long id) {
        UUID uuid = player.getUniqueId();
        String lang = lang(player);
        if (!busy.add(uuid)) return;
        io.execute(() -> {
            String result;
            try {
                int owned = plugin.getPayments().total(uuid, PaymentService.ENDER_PAGES);
                if (owned >= maxPages()) {
                    result = "ender.max";
                } else {
                    int r = repository.redeem(id, uuid);
                    if (r == 1) {
                        boolean ok = plugin.getPayments().getRepository().addEntitlement(uuid,
                                PaymentService.ENDER_PAGES, 0, 1, null, "voucher", System.currentTimeMillis());
                        if (ok) {
                            result = "ok:" + (owned + 1);
                        } else {
                            repository.unredeem(id);
                            result = "ender.error";
                        }
                    } else {
                        result = r == 0 ? "ender.voucher-used" : "ender.voucher-invalid";
                    }
                }
            } catch (Exception e) {
                plugin.getLogger().log(Level.SEVERE, "[엔더] 확장권 사용 실패 #" + id, e);
                result = "ender.error";
            }
            String outcome = result;
            Bukkit.getScheduler().runTask(plugin, () -> {
                busy.remove(uuid);
                if (!outcome.startsWith("ok:")) {
                    if (player.isOnline()) player.sendMessage(messages.prefixed(lang, outcome));
                    // 이미 쓰인 확장권 종이는 치웁니다 — 남겨 두면 계속 헷갈립니다.
                    if (outcome.equals("ender.voucher-used") || outcome.equals("ender.voucher-invalid")) {
                        removeVoucher(player, id);
                    }
                    return;
                }
                removeVoucher(player, id);
                plugin.getLogger().info("[엔더] " + player.getName() + " 확장권 #" + id + " 사용 → "
                        + outcome.substring(3) + "개");
                if (player.isOnline()) {
                    player.sendMessage(messages.prefixed(lang, "ender.unlocked",
                            "n", String.valueOf(1 + Integer.parseInt(outcome.substring(3)))));
                    player.playSound(player.getLocation(), Sound.BLOCK_ENDER_CHEST_OPEN, 0.8f, 1.2f);
                }
            });
        });
    }

    /** 그 id 의 확장권을 한 장만 지웁니다 (손에서 옮겼어도 인벤토리 어딘가에서). */
    private void removeVoucher(Player player, long id) {
        if (!player.isOnline()) return;
        ItemStack[] contents = player.getInventory().getContents();
        for (int i = 0; i < contents.length; i++) {
            if (voucherId(contents[i]) == id) {
                ItemStack it = contents[i];
                if (it.getAmount() > 1) it.setAmount(it.getAmount() - 1);
                else player.getInventory().setItem(i, null);
                return;
            }
        }
    }

    // ── 직렬화 (국가창고와 같은 방식 — 빈 칸 위치 보존) ──────────────

    private static String serialize(ItemStack[] items) throws Exception {
        ByteArrayOutputStream bytes = new ByteArrayOutputStream();
        try (BukkitObjectOutputStream out = new BukkitObjectOutputStream(bytes)) {
            out.writeInt(items.length);
            for (ItemStack item : items) out.writeObject(item);
        }
        return Base64.getEncoder().encodeToString(bytes.toByteArray());
    }

    private static ItemStack[] deserialize(String encoded) throws Exception {
        try (BukkitObjectInputStream in = new BukkitObjectInputStream(
                new ByteArrayInputStream(Base64.getDecoder().decode(encoded)))) {
            int size = in.readInt();
            ItemStack[] items = new ItemStack[Math.max(size, SIZE)];
            for (int i = 0; i < size; i++) items[i] = (ItemStack) in.readObject();
            return items;
        }
    }

    // ── 홀더 (제목이 아니라 타입으로 판별 — §6.4) ─────────────────────

    public static final class SelectorHolder implements InventoryHolder {
        private final int owned;
        /** 칸 → 상자 번호 (0 = 바닐라) */
        private final Map<Integer, Integer> slots = new HashMap<>();
        private Inventory inventory;

        SelectorHolder(int owned) { this.owned = owned; }

        @Override
        public @NotNull Inventory getInventory() { return inventory; }
    }

    public static final class ChestHolder implements InventoryHolder {
        private final UUID owner;
        private final int n;
        private Inventory inventory;

        ChestHolder(UUID owner, int n) {
            this.owner = owner;
            this.n = n;
        }

        @Override
        public @NotNull Inventory getInventory() { return inventory; }
    }
}
