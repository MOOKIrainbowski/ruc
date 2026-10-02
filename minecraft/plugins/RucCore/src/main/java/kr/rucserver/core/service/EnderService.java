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
 * 엔더상자 확장 (2026-10-02 소유자 결정).
 *
 * <h2>무엇을 하는가</h2>
 * 엔더상자를 <b>웅크리고 우클릭</b>하면 확장 페이지가 열립니다. 그냥 우클릭은 바닐라
 * 엔더상자 그대로입니다. 바닐라 쪽(0페이지)은 손대지 않으므로, 바닐라 엔더상자에서
 * 아이템이 복사되거나 사라질 경로가 새로 생기지 않습니다.
 *
 * 휴대용 명령({@code /ec})은 만들지 않았습니다. 블록 앞에서만 열리는 것이 약탈
 * 서버에서 "전투 중 보관" 이점을 줄이는 장치입니다 (설계 §7.1).
 *
 * <h2>얻는 법 — 유료와 무과금</h2>
 * 몇 페이지를 가졌는가는 {@code ruc_entitlement} 원장의 {@code ender_pages} 합입니다.
 * 디스코드 {@code /충전} 으로 사면 {@code purchase}, {@code /엔더확장} 으로 레벨 · Ruc 를
 * 내고 열면 {@code unlock} 행이 쌓입니다. 둘을 합쳐 {@code ender.max-pages} 까지입니다.
 *
 * <h2>복사를 막는 세 가지</h2>
 * <ol>
 *   <li><b>저장은 닫힐 때 한 곳에서만.</b> 페이지를 넘길 때도 새 창을 열면 옛 창의
 *       닫힘 이벤트가 먼저 오고, 거기서 저장합니다.</li>
 *   <li><b>접속 중에는 메모리 사본이 기준.</b> 닫고 바로 다시 열면 DB 저장이 아직 안
 *       끝났을 수 있습니다. DB 를 다시 읽으면 옛 내용이 나와 복사가 됩니다.</li>
 *   <li><b>DB 작업은 단일 스레드 큐.</b> 나갔다 바로 들어와도 저장이 읽기보다 먼저 끝납니다.
 *       Bukkit 비동기 작업은 동시에 돌 수 있어서 이 순서를 보장하지 못합니다.</li>
 * </ol>
 */
public class EnderService implements Listener {

    /** 한 페이지 = 바닐라 엔더상자와 같은 27칸. 아래 한 줄은 넘기기 버튼입니다. */
    private static final int CONTENT = 27;
    private static final int SIZE = 36;
    private static final int SLOT_PREV = 27;
    private static final int SLOT_INFO = 31;
    private static final int SLOT_NEXT = 35;

    private final RucCore plugin;
    private final MessageService messages;
    private final EnderRepository repository;
    private final NamespacedKey navKey;

    /** DB 작업 순서를 지키는 큐 (위 3번). */
    private final ExecutorService io = Executors.newSingleThreadExecutor(r -> {
        Thread t = new Thread(r, "RucCore-Ender");
        t.setDaemon(true);
        return t;
    });

    /** 접속 중인 사람의 불러온 페이지 (메인 스레드 전용). */
    private final Map<UUID, Map<Integer, ItemStack[]>> cache = new HashMap<>();

    /** 불러오는 중 · 구매 처리 중 — 연타로 두 번 처리되지 않게. */
    private final Set<UUID> busy = new HashSet<>();

    public EnderService(RucCore plugin, MessageService messages, EnderRepository repository) {
        this.plugin = plugin;
        this.messages = messages;
        this.repository = repository;
        this.navKey = new NamespacedKey(plugin, "ender_nav");
    }

    public boolean enabled() {
        return plugin.getConfig().getBoolean("ender.enabled", true);
    }

    public int maxPages() {
        return Math.max(0, plugin.getConfig().getInt("ender.max-pages", 3));
    }

    private String serverId() {
        return plugin.getConfig().getString("server-id", "unknown");
    }

    private String lang(Player p) {
        return plugin.getPlayerData().languageOf(p);
    }

    // ── 열기 ──────────────────────────────────────────────────────────

    /** 웅크리고 엔더상자 우클릭 → 확장 1페이지. */
    @EventHandler(priority = EventPriority.HIGH, ignoreCancelled = true)
    public void onInteract(PlayerInteractEvent event) {
        if (event.getAction() != Action.RIGHT_CLICK_BLOCK || event.getHand() != EquipmentSlot.HAND) return;
        Block block = event.getClickedBlock();
        if (block == null || block.getType() != Material.ENDER_CHEST) return;
        Player player = event.getPlayer();
        if (!player.isSneaking() || !enabled()) return;

        // 웅크린 채 엔더상자에 블록을 붙여 놓는 동작은 막힙니다. 확장 페이지를 여는
        // 손짓과 겹쳐서, 둘 중 하나를 골라야 했습니다.
        event.setCancelled(true);
        open(player, 1);
    }

    /**
     * 확장 페이지를 엽니다. {@code page < 1} 이면 바닐라 엔더상자.
     * 가진 페이지 수는 원장에서 읽으므로 비동기로 확인한 뒤 엽니다.
     */
    public void open(Player player, int page) {
        if (page < 1) {
            player.openInventory(player.getEnderChest());
            return;
        }
        UUID uuid = player.getUniqueId();
        if (!busy.add(uuid)) return;

        Map<Integer, ItemStack[]> loaded = cache.get(uuid);
        boolean needLoad = loaded == null || !loaded.containsKey(page);
        String server = serverId();

        io.execute(() -> {
            int owned;
            String raw = null;
            try {
                owned = Math.min(maxPages(), plugin.getPayments().total(uuid, PaymentService.ENDER_PAGES));
                if (needLoad && page <= owned) raw = repository.load(uuid, server, page);
            } catch (Exception e) {
                plugin.getLogger().log(Level.SEVERE, "[엔더] 불러오기 실패: " + player.getName(), e);
                Bukkit.getScheduler().runTask(plugin, () -> {
                    busy.remove(uuid);
                    if (player.isOnline()) player.sendMessage(messages.prefixed(lang(player), "ender.error"));
                });
                return;
            }
            String contents = raw;
            Bukkit.getScheduler().runTask(plugin, () -> {
                busy.remove(uuid);
                if (!player.isOnline()) return;
                if (owned <= 0) {
                    player.sendMessage(messages.prefixed(lang(player), "ender.none"));
                    player.openInventory(player.getEnderChest());
                    return;
                }
                if (page > owned) return;

                Map<Integer, ItemStack[]> pages = cache.computeIfAbsent(uuid, k -> new HashMap<>());
                // 불러오는 사이에 메모리 사본이 생겼으면 그쪽이 최신입니다.
                if (!pages.containsKey(page)) {
                    try {
                        pages.put(page, contents == null ? new ItemStack[CONTENT] : deserialize(contents));
                    } catch (Exception e) {
                        plugin.getLogger().log(Level.SEVERE, "[엔더] 역직렬화 실패: " + player.getName()
                                + " " + page + "페이지 — 열지 않습니다 (덮어쓰기 방지)", e);
                        player.sendMessage(messages.prefixed(lang(player), "ender.error"));
                        return;
                    }
                }
                player.openInventory(build(player, page, owned, pages.get(page)));
            });
        });
    }

    private Inventory build(Player player, int page, int owned, ItemStack[] items) {
        String lang = lang(player);
        EnderHolder holder = new EnderHolder(player.getUniqueId(), page, owned);
        Inventory inv = Bukkit.createInventory(holder, SIZE,
                messages.get(lang, "ender.title", "page", String.valueOf(page), "pages", String.valueOf(owned)));
        holder.inventory = inv;
        for (int i = 0; i < CONTENT && i < items.length; i++) inv.setItem(i, items[i]);

        ItemStack filler = nav(Material.GRAY_STAINED_GLASS_PANE, Component.text(" "));
        for (int i = CONTENT; i < SIZE; i++) inv.setItem(i, filler);
        inv.setItem(SLOT_PREV, nav(Material.ARROW, messages.get(lang,
                page == 1 ? "ender.to-vanilla" : "ender.prev")));
        inv.setItem(SLOT_INFO, nav(Material.ENDER_EYE, messages.get(lang, "ender.page-info",
                "page", String.valueOf(page), "pages", String.valueOf(owned))));
        if (page < owned) inv.setItem(SLOT_NEXT, nav(Material.ARROW, messages.get(lang, "ender.next")));
        return inv;
    }

    /**
     * 넘기기 줄의 아이템. 표식(PDC)을 붙여 두면 평범한 유리판과 "같은 아이템" 이 아니게
     * 되어, 쉬프트 클릭이 이 칸에 겹쳐 쌓이지 않습니다.
     */
    private ItemStack nav(Material material, Component name) {
        ItemStack item = new ItemStack(material);
        ItemMeta meta = item.getItemMeta();
        meta.displayName(name);
        meta.getPersistentDataContainer().set(navKey, PersistentDataType.BYTE, (byte) 1);
        item.setItemMeta(meta);
        return item;
    }

    // ── 클릭 · 닫기 ────────────────────────────────────────────────────

    @EventHandler(priority = EventPriority.HIGH)
    public void onClick(InventoryClickEvent event) {
        if (!(event.getView().getTopInventory().getHolder() instanceof EnderHolder holder)) return;
        int raw = event.getRawSlot();
        if (raw < CONTENT || raw >= SIZE) {
            // 내용 칸 · 아래 자기 인벤토리는 평범한 상자처럼 둡니다.
            // 단, 숫자키로 넘기기 줄과 바꾸는 경로는 위에서 raw 로 이미 걸러집니다.
            return;
        }
        event.setCancelled(true);
        if (!(event.getWhoClicked() instanceof Player player)) return;

        int target = raw == SLOT_PREV ? holder.page - 1
                : raw == SLOT_NEXT && holder.page < holder.owned ? holder.page + 1
                : -1;
        if (target < 0) return;
        player.playSound(player.getLocation(), Sound.UI_BUTTON_CLICK, 0.5f, 1.2f);
        // 클릭 이벤트 안에서 창을 바꾸면 안 됩니다. 다음 틱에 — 옛 창의 닫힘(저장)이 먼저 옵니다.
        Bukkit.getScheduler().runTask(plugin, () -> {
            if (player.isOnline()) open(player, target);
        });
    }

    @EventHandler(priority = EventPriority.HIGH)
    public void onDrag(InventoryDragEvent event) {
        if (!(event.getView().getTopInventory().getHolder() instanceof EnderHolder)) return;
        for (int raw : event.getRawSlots()) {
            if (raw >= CONTENT && raw < SIZE) {
                event.setCancelled(true);
                return;
            }
        }
    }

    @EventHandler(priority = EventPriority.MONITOR)
    public void onClose(InventoryCloseEvent event) {
        if (!(event.getInventory().getHolder() instanceof EnderHolder holder)) return;
        save(holder, false);
    }

    /** 나갈 때: 닫힘 이벤트가 먼저 와서 저장은 끝났습니다. 메모리 사본만 치웁니다. */
    @EventHandler(priority = EventPriority.MONITOR)
    public void onQuit(PlayerQuitEvent event) {
        cache.remove(event.getPlayer().getUniqueId());
        busy.remove(event.getPlayer().getUniqueId());
    }

    /** 닫힌(또는 종료 중인) 페이지를 메모리 · DB 에 씁니다. */
    private void save(EnderHolder holder, boolean blocking) {
        ItemStack[] items = new ItemStack[CONTENT];
        for (int i = 0; i < CONTENT; i++) {
            ItemStack it = holder.inventory.getItem(i);
            items[i] = it == null ? null : it.clone();
        }
        cache.computeIfAbsent(holder.owner, k -> new HashMap<>()).put(holder.page, items);

        String encoded;
        try {
            encoded = serialize(items);
        } catch (Exception e) {
            plugin.getLogger().log(Level.SEVERE, "[엔더] 직렬화 실패 " + holder.owner + " " + holder.page, e);
            return;
        }
        String server = serverId();
        Runnable write = () -> {
            try {
                repository.save(holder.owner, server, holder.page, encoded);
            } catch (Exception e) {
                plugin.getLogger().log(Level.SEVERE, "[엔더] 저장 실패 " + holder.owner + " " + holder.page, e);
            }
        };
        if (blocking) write.run(); else io.execute(write);
    }

    public void stop() {
        // 종료 시: 열린 창을 동기로 저장하고, 큐에 남은 저장을 끝까지 기다립니다.
        for (Player player : Bukkit.getOnlinePlayers()) {
            if (player.getOpenInventory().getTopInventory().getHolder() instanceof EnderHolder holder) {
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

    // ── 무과금 경로: /엔더확장 ─────────────────────────────────────────

    /** 다음 페이지를 무과금으로 열 때의 조건. 설정 {@code ender.unlock} 의 n 번째. */
    public record Requirement(int level, long cost) { }

    public List<Requirement> requirements() {
        List<Requirement> out = new ArrayList<>();
        for (Map<?, ?> row : plugin.getConfig().getMapList("ender.unlock")) {
            Object level = row.get("level");
            Object cost = row.get("cost");
            if (level instanceof Number l && cost instanceof Number c) {
                out.add(new Requirement(l.intValue(), c.longValue()));
            }
        }
        return out;
    }

    /** 현재 상태를 보여 주거나({@code buy=false}), 다음 페이지를 엽니다. */
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
            try {
                owned = plugin.getPayments().total(uuid, PaymentService.ENDER_PAGES);
            } catch (Exception e) {
                plugin.getLogger().log(Level.SEVERE, "[엔더] 페이지 수 조회 실패", e);
                Bukkit.getScheduler().runTask(plugin, () -> {
                    busy.remove(uuid);
                    player.sendMessage(messages.prefixed(lang, "ender.error"));
                });
                return;
            }
            Bukkit.getScheduler().runTask(plugin, () -> {
                if (!player.isOnline()) { busy.remove(uuid); return; }
                List<Requirement> reqs = requirements();
                String symbol = plugin.getEconomy().symbol();
                player.sendMessage(messages.prefixed(lang, "ender.status",
                        "owned", String.valueOf(Math.min(owned, maxPages())), "max", String.valueOf(maxPages())));

                if (owned >= maxPages()) {
                    busy.remove(uuid);
                    player.sendMessage(messages.get(lang, "ender.max"));
                    return;
                }
                // n 번째 페이지의 조건 = 이미 가진 페이지 수(유료 포함)로 정합니다.
                if (owned >= reqs.size()) {
                    busy.remove(uuid);
                    player.sendMessage(messages.get(lang, "ender.no-free"));
                    return;
                }
                Requirement next = reqs.get(owned);
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
                    player.sendMessage(messages.prefixed(lang, "ender.need-level", "level", String.valueOf(next.level())));
                    return;
                }
                // 돈을 먼저 받고(메인 스레드 · 캐시), 원장에 실패하면 돌려줍니다.
                if (!plugin.getEconomy().withdraw(uuid, next.cost())) {
                    busy.remove(uuid);
                    player.sendMessage(messages.prefixed(lang, "ender.need-ruc",
                            "cost", EconomyService.format(next.cost()), "symbol", symbol));
                    return;
                }
                io.execute(() -> {
                    boolean ok;
                    try {
                        ok = plugin.getPayments().getRepository().addEntitlement(uuid, PaymentService.ENDER_PAGES,
                                0, 1, null, "unlock", System.currentTimeMillis());
                    } catch (Exception e) {
                        plugin.getLogger().log(Level.SEVERE, "[엔더] 무과금 확장 기록 실패", e);
                        ok = false;
                    }
                    boolean done = ok;
                    Bukkit.getScheduler().runTask(plugin, () -> {
                        busy.remove(uuid);
                        if (!done) {
                            plugin.getEconomy().deposit(uuid, next.cost());
                            if (player.isOnline()) player.sendMessage(messages.prefixed(lang, "ender.error"));
                            return;
                        }
                        plugin.getLogger().info("[엔더] " + player.getName() + " 무과금 확장 → "
                                + (owned + 1) + "페이지 (" + next.cost() + " Ruc)");
                        if (player.isOnline()) {
                            player.sendMessage(messages.prefixed(lang, "ender.unlocked",
                                    "page", String.valueOf(owned + 1)));
                            player.playSound(player.getLocation(), Sound.BLOCK_ENDER_CHEST_OPEN, 0.8f, 1.2f);
                        }
                    });
                });
            });
        });
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
            ItemStack[] items = new ItemStack[Math.max(size, CONTENT)];
            for (int i = 0; i < size; i++) items[i] = (ItemStack) in.readObject();
            return items;
        }
    }

    /** 우리 확장 페이지임을 타입으로 증명합니다 (제목으로 판별하지 않음 — §6.4). */
    public static final class EnderHolder implements InventoryHolder {
        private final UUID owner;
        private final int page;
        private final int owned;
        private Inventory inventory;

        EnderHolder(UUID owner, int page, int owned) {
            this.owner = owner;
            this.page = page;
            this.owned = owned;
        }

        @Override
        public @NotNull Inventory getInventory() { return inventory; }
    }
}
