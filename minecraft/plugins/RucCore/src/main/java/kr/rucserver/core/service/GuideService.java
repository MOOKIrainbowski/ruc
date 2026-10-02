package kr.rucserver.core.service;

import kr.rucserver.core.RucCore;
import kr.rucserver.core.menu.MenuHolder;
import kr.rucserver.core.menu.Pages;
import kr.rucserver.core.model.RucPlayer;
import kr.rucserver.core.storage.GuideRepository;
import net.kyori.adventure.text.Component;
import net.kyori.adventure.text.format.TextDecoration;
import org.bukkit.Bukkit;
import org.bukkit.Material;
import org.bukkit.Sound;
import org.bukkit.entity.Player;
import org.bukkit.event.EventHandler;
import org.bukkit.event.EventPriority;
import org.bukkit.event.Listener;
import org.bukkit.event.player.PlayerCommandPreprocessEvent;
import org.bukkit.event.player.PlayerQuitEvent;
import org.bukkit.inventory.Inventory;
import org.bukkit.inventory.ItemStack;
import org.bukkit.inventory.meta.ItemMeta;
import org.bukkit.scheduler.BukkitTask;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import java.util.logging.Level;

/**
 * 가이드 (Phase 11, docs/00-PLAN.md).
 *
 * <h2>단계는 설정 목록입니다</h2>
 * {@code guide.steps} 의 순서대로 진행합니다. 단계 수가 곧 "바닐라와 다른 기능" 의 수라서,
 * 기능이 늘거나 국가전 · 평화가 다시 열리면 <b>줄만 추가</b>하면 됩니다. 단계 종류:
 * <ul>
 *   <li>{@code check}   — 상태를 봅니다 (지금은 {@code verify}: 디스코드 인증). 10초마다 확인</li>
 *   <li>{@code trigger} — 코드가 알려 줍니다 ({@code menu} · {@code move} · {@code mailbox} ·
 *       {@code ender} · {@code shop})</li>
 *   <li>{@code command} — 그 명령을 쳤을 때 ({@code commands} 목록, 별칭 포함)</li>
 *   <li>{@code read}    — 가이드 화면에서 그 단계를 눌렀을 때 (읽기만 하면 되는 것 — 신고 방법)</li>
 * </ul>
 * 지금 단계가 아닌 행동은 세지 않습니다. 순서대로 하나씩 겪게 하는 것이 목적입니다.
 *
 * <h2>보상</h2>
 * 단계마다 Ruc 를 <b>우편</b>으로, 다 끝내면 큰 Ruc + {@code guide} 칭호. 우편은 사유
 * ({@code 가이드 <단계키>})로 한 번만 가고, 단계 넘기기는 조건부 UPDATE 라 두 번 넘어가지 않습니다.
 * 신규만이 아니라 <b>기존 유저 전원</b>이 처음 접속할 때 0단계로 시작합니다 (계획서).
 */
public class GuideService implements Listener {

    private static final int[] CONTENT = Pages.content(4);

    public record Step(String key, String type, List<String> commands, long reward) { }

    private final RucCore plugin;
    private final MessageService messages;
    private final GuideRepository repository;
    private final Map<UUID, Integer> progress = new HashMap<>();
    private final Set<UUID> busy = new HashSet<>();
    private final ExecutorService io = Executors.newSingleThreadExecutor(r -> {
        Thread t = new Thread(r, "RucCore-Guide");
        t.setDaemon(true);
        return t;
    });
    private BukkitTask checkTask;
    private List<Step> steps = List.of();

    public GuideService(RucCore plugin, MessageService messages, GuideRepository repository) {
        this.plugin = plugin;
        this.messages = messages;
        this.repository = repository;
    }

    // 대체값 없이 읽습니다 — guide 섹션이 없는 배포본 config.yml 에서도 jar 기본값이 적용되게.
    private boolean enabled() { return plugin.getConfig().getBoolean("guide.enabled"); }

    public void start() {
        steps = loadSteps();
        if (!enabled()) return;
        checkTask = Bukkit.getScheduler().runTaskTimer(plugin, () -> {
            for (Player p : Bukkit.getOnlinePlayers()) checkAuto(p);
        }, 200L, 200L);
        plugin.getLogger().info("가이드 " + steps.size() + "단계");
    }

    public void stop() {
        if (checkTask != null) checkTask.cancel();
        io.shutdown();
        try {
            io.awaitTermination(10, TimeUnit.SECONDS);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
        }
    }

    private List<Step> loadSteps() {
        List<Step> out = new ArrayList<>();
        for (Map<?, ?> row : plugin.getConfig().getMapList("guide.steps")) {
            Object key = row.get("key");
            Object type = row.get("type");
            if (!(key instanceof String k) || !(type instanceof String t)) continue;
            List<String> cmds = new ArrayList<>();
            if (row.get("commands") instanceof List<?> list) {
                for (Object c : list) cmds.add(String.valueOf(c).toLowerCase(Locale.ROOT));
            }
            long reward = row.get("reward") instanceof Number n ? n.longValue() : 0;
            out.add(new Step(k, t, cmds, reward));
        }
        return out;
    }

    private String lang(Player p) { return plugin.getPlayerData().languageOf(p); }

    private String stepName(String lang, Step s) {
        return messages.raw(lang, "guide.step." + s.key() + ".name");
    }

    // ── 접속 · 진행 상태 ──────────────────────────────────────────────

    /** 접속(서버 이동 포함) 때. 진행을 읽고, 안 끝났으면 지금 할 일을 알려 줍니다. */
    public void onJoin(Player player) {
        if (!enabled() || steps.isEmpty()) return;
        UUID uuid = player.getUniqueId();
        io.execute(() -> {
            int step;
            try {
                step = repository.loadOrCreate(uuid);
            } catch (Exception e) {
                plugin.getLogger().log(Level.WARNING, "[가이드] 진행 조회 실패: " + player.getName(), e);
                return;
            }
            Bukkit.getScheduler().runTask(plugin, () -> {
                if (!player.isOnline()) return;
                progress.put(uuid, step);
                if (step < steps.size()) {
                    tellCurrent(player, step);
                    // 다른 서버에 도착한 것 자체가 "서버 이동" 단계입니다.
                    String hub = plugin.getConfig().getString("guide.hub-server", "home");
                    if (!hub.equals(plugin.getConfig().getString("server-id", "unknown"))) trigger(player, "move");
                    checkAuto(player);
                }
            });
        });
    }

    @EventHandler(priority = EventPriority.MONITOR)
    public void onQuit(PlayerQuitEvent event) {
        progress.remove(event.getPlayer().getUniqueId());
        busy.remove(event.getPlayer().getUniqueId());
    }

    private Step current(Player player) {
        Integer step = progress.get(player.getUniqueId());
        if (step == null || step >= steps.size()) return null;
        return steps.get(step);
    }

    private void tellCurrent(Player player, int step) {
        String lang = lang(player);
        Step s = steps.get(step);
        player.sendMessage(messages.prefixed(lang, "guide.current",
                "n", String.valueOf(step + 1), "total", String.valueOf(steps.size()),
                "name", stepName(lang, s)));
        // 설명은 아이템 설명(|=줄바꿈)과 같이 쓰므로 채팅에서는 한 줄로 잇습니다.
        player.sendMessage(MessageService.colorize("&7  "
                + messages.raw(lang, "guide.step." + s.key() + ".how").replace("|", " ")));
    }

    // ── 단계 완료 신호 ────────────────────────────────────────────────

    /** 코드가 알려 주는 단계 ({@code menu} · {@code move} · {@code mailbox} · {@code ender} · {@code shop}). */
    public void trigger(Player player, String key) {
        Step s = current(player);
        if (s != null && s.type().equals("trigger") && s.key().equals(key)) complete(player, s);
    }

    /** 명령 단계. 실제로 실행된 명령만 셉니다 (취소된 것 제외). */
    @EventHandler(priority = EventPriority.MONITOR, ignoreCancelled = true)
    public void onCommand(PlayerCommandPreprocessEvent event) {
        Step s = current(event.getPlayer());
        if (s == null || !s.type().equals("command")) return;
        String label = event.getMessage().substring(1).split(" ", 2)[0].toLowerCase(Locale.ROOT);
        int colon = label.indexOf(':');
        if (colon >= 0) label = label.substring(colon + 1);   // minecraft:xxx · ruccore:xxx
        if (s.commands().contains(label)) {
            Player player = event.getPlayer();
            // 명령 결과가 먼저 보이고 그다음에 가이드 안내가 오도록 한 틱 뒤에.
            Bukkit.getScheduler().runTask(plugin, () -> {
                if (player.isOnline()) complete(player, s);
            });
        }
    }

    /** 상태 단계. 지금은 디스코드 인증 하나입니다. */
    private void checkAuto(Player player) {
        Step s = current(player);
        if (s == null || !s.type().equals("check")) return;
        if (s.key().equals("verify")) {
            RucPlayer data = plugin.getPlayerData().get(player);
            if (data != null && data.isVerified()) complete(player, s);
        }
    }

    private void complete(Player player, Step s) {
        UUID uuid = player.getUniqueId();
        Integer from = progress.get(uuid);
        if (from == null || from >= steps.size() || steps.get(from) != s) return;
        if (!busy.add(uuid)) return;
        boolean last = from == steps.size() - 1;
        long finalRuc = plugin.getConfig().getLong("guide.final-ruc");
        String finalTitle = plugin.getConfig().getString("guide.final-title", "guide");
        io.execute(() -> {
            boolean won;
            try {
                won = repository.advance(uuid, from, last);
                if (won) {
                    if (s.reward() > 0) {
                        plugin.getMailbox().sendRucOnce(uuid, s.reward(), "러크 가이드", "가이드 " + s.key());
                    }
                    if (last) {
                        if (finalRuc > 0) {
                            plugin.getMailbox().sendRucOnce(uuid, finalRuc, "러크 가이드", "가이드 완주");
                        }
                        plugin.getTitles().grantBlocking(uuid, finalTitle, "guide");
                    }
                }
            } catch (Exception e) {
                plugin.getLogger().log(Level.SEVERE, "[가이드] 진행 기록 실패: " + player.getName(), e);
                won = false;
            }
            boolean ok = won;
            Bukkit.getScheduler().runTask(plugin, () -> {
                busy.remove(uuid);
                if (!ok || !player.isOnline()) return;
                progress.put(uuid, from + 1);
                String lang = lang(player);
                String symbol = plugin.getEconomy().symbol();
                player.sendMessage(messages.prefixed(lang, "guide.done",
                        "name", stepName(lang, s), "reward", EconomyService.format(s.reward()), "symbol", symbol));
                player.playSound(player.getLocation(), Sound.ENTITY_PLAYER_LEVELUP, 0.6f, 1.4f);
                if (last) {
                    player.sendMessage(messages.prefixed(lang, "guide.finished",
                            "reward", EconomyService.format(finalRuc), "symbol", symbol));
                    player.playSound(player.getLocation(), Sound.UI_TOAST_CHALLENGE_COMPLETE, 0.8f, 1.0f);
                    plugin.getLogger().info("[가이드] " + player.getName() + " 완주");
                } else {
                    tellCurrent(player, from + 1);
                    checkAuto(player);
                }
            });
        });
    }

    // ── 화면 ───────────────────────────────────────────────────────────

    public void open(Player player) {
        if (!enabled() || steps.isEmpty()) {
            player.sendMessage(messages.prefixed(lang(player), "guide.disabled"));
            return;
        }
        Integer step = progress.get(player.getUniqueId());
        if (step == null) {
            // 진행을 아직 못 읽었습니다 (막 접속). 읽고 나서 엽니다.
            onJoin(player);
            Bukkit.getScheduler().runTaskLater(plugin, () -> {
                if (player.isOnline() && progress.containsKey(player.getUniqueId())) open(player);
            }, 10L);
            return;
        }
        String lang = lang(player);
        String symbol = plugin.getEconomy().symbol();
        MenuHolder holder = new MenuHolder(MenuHolder.Type.GUIDE);
        Inventory inv = Bukkit.createInventory(holder, Pages.SIZE, messages.get(lang, "guide.title",
                "n", String.valueOf(Math.min(step, steps.size())), "total", String.valueOf(steps.size())));
        holder.setInventory(inv);
        ItemStack pane = icon(Material.GRAY_STAINED_GLASS_PANE, " ", List.of());
        for (int i = 0; i < Pages.SIZE; i++) inv.setItem(i, pane);
        for (int slot : CONTENT) inv.setItem(slot, null);

        for (int i = 0; i < steps.size() && i < CONTENT.length; i++) {
            Step s = steps.get(i);
            String name = stepName(lang, s);
            String reward = messages.raw(lang, "guide.reward")
                    .replace("%reward%", EconomyService.format(s.reward())).replace("%symbol%", symbol);
            ItemStack item;
            if (i < step) {
                item = icon(Material.LIME_DYE, messages.raw(lang, "guide.entry-done")
                        .replace("%n%", String.valueOf(i + 1)).replace("%name%", name), List.of());
            } else if (i == step) {
                List<String> lore = new ArrayList<>(List.of(messages.raw(lang, "guide.step." + s.key() + ".how")
                        .split("\\|")));
                lore.add(reward);
                if (s.type().equals("read")) lore.add(messages.raw(lang, "guide.entry-read"));
                item = icon(Material.WRITABLE_BOOK, messages.raw(lang, "guide.entry-current")
                        .replace("%n%", String.valueOf(i + 1)).replace("%name%", name), lore);
                holder.mapSlot(CONTENT[i], i);
            } else {
                item = icon(Material.GRAY_DYE, messages.raw(lang, "guide.entry-locked")
                        .replace("%n%", String.valueOf(i + 1)).replace("%name%", name), List.of());
            }
            inv.setItem(CONTENT[i], item);
        }
        String finalTitle = plugin.getConfig().getString("guide.final-title", "guide");
        inv.setItem(Pages.SLOT_ACTION, icon(Material.NETHER_STAR, messages.raw(lang, "guide.final-name"),
                List.of(messages.raw(lang, "guide.final-lore")
                        .replace("%reward%", EconomyService.format(plugin.getConfig().getLong("guide.final-ruc")))
                        .replace("%symbol%", symbol)
                        .replace("%title%", finalTitle))));
        player.openInventory(inv);
        player.playSound(player.getLocation(), Sound.ITEM_BOOK_PAGE_TURN, 0.7f, 1.0f);
    }

    /** MenuListener 가 넘겨 줍니다 (이미 취소된 클릭). 읽기 단계만 클릭으로 끝납니다. */
    public void click(Player player, MenuHolder holder, int slot) {
        long index = holder.idAt(slot);
        if (index < 0 || index >= steps.size()) return;
        Step s = steps.get((int) index);
        if (!s.type().equals("read")) return;
        player.closeInventory();
        complete(player, s);
    }

    // ── 표시 도구 ─────────────────────────────────────────────────────

    private static ItemStack icon(Material material, String name, List<String> lore) {
        ItemStack item = new ItemStack(material);
        ItemMeta meta = item.getItemMeta();
        meta.displayName(MessageService.colorize(name).decoration(TextDecoration.ITALIC, false));
        if (!lore.isEmpty()) {
            List<Component> lines = new ArrayList<>();
            for (String l : lore) lines.add(MessageService.colorize(l).decoration(TextDecoration.ITALIC, false));
            meta.lore(lines);
        }
        item.setItemMeta(meta);
        return item;
    }
}
