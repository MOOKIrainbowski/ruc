package kr.rucserver.core.service;

import kr.rucserver.core.RucCore;
import kr.rucserver.core.menu.MenuHolder;
import kr.rucserver.core.menu.Pages;
import kr.rucserver.core.storage.MailboxRepository;
import kr.rucserver.core.storage.MailboxRepository.Mail;
import net.kyori.adventure.text.Component;
import net.kyori.adventure.text.format.TextDecoration;
import org.bukkit.Bukkit;
import org.bukkit.Material;
import org.bukkit.Sound;
import org.bukkit.entity.Player;
import org.bukkit.inventory.Inventory;
import org.bukkit.inventory.ItemStack;
import org.bukkit.inventory.meta.ItemMeta;
import org.bukkit.scheduler.BukkitTask;

import java.sql.SQLException;
import java.util.ArrayList;
import java.util.Base64;
import java.util.List;
import java.util.UUID;
import java.util.logging.Level;

/**
 * 우편함 (Phase 5.5).
 *
 * <h2>왜 이것이 먼저인가</h2>
 * 유저 상점(Phase 10)의 구매품, 가이드(Phase 11)의 단계 보상, 그리고 지금
 * {@code /ruc give} 가 접속 중인 사람에게만 되는 문제가 모두 같은 구멍입니다 —
 * <b>지금 받을 수 없는 것이 도착할 곳이 없습니다.</b> 그것을 만들지 않고 위의
 * 기능들을 얹으면, 인벤토리가 꽉 찬 사람의 보상이 바닥에 떨어져 사라지거나
 * 그냥 소멸합니다.
 *
 * <h2>순서 규칙 — DB 먼저, 아이템 나중</h2>
 * 수령은 <b>DB에 수령 표시 → 인벤토리에 넣기</b> 순서입니다. 반대로 하면 넣은
 * 직후 서버가 죽었을 때 아이템은 나갔는데 우편은 남아 무한 복사가 됩니다.
 * 이 순서에서는 반대 사고(표시는 됐는데 못 넣음)가 생기므로
 * {@link MailboxRepository#unclaim} 으로 되돌립니다. 잃는 쪽보다 되돌리는 쪽이
 * 복구 가능합니다.
 *
 * <h2>빈 칸 한 칸을 요구하는 이유</h2>
 * {@code addItem} 은 넣을 수 있는 만큼만 넣고 나머지를 돌려줍니다. 그 "반쯤 받은"
 * 상태를 우편 한 통 단위로 되돌릴 방법이 없습니다. 그래서 아이템 우편은
 * <b>빈 칸이 하나 있을 때만</b> 수령하게 합니다 — 빈 칸에 들어가는 한 뭉치는
 * 항상 전부 들어갑니다.
 */
public class MailboxService {

    /** 위에서 4줄만 목록에 씁니다. 맨 아랫줄은 이전/모두받기/다음 줄입니다. */
    private static final int CONTENT_ROWS = 4;
    private static final int[] CONTENT = Pages.content(CONTENT_ROWS);

    private final RucCore plugin;
    private final MessageService messages;
    private final MailboxRepository repository;

    private BukkitTask purgeTask;

    public MailboxService(RucCore plugin, MessageService messages,
                          MailboxRepository repository) {
        this.plugin = plugin;
        this.messages = messages;
        this.repository = repository;
    }

    // ── 수명 ───────────────────────────────────────────────────────────

    public void start() {
        long minutes = plugin.getConfig().getLong("mailbox.purge-interval-minutes", 60);
        long ticks = Math.max(1, minutes) * 60L * 20L;

        // 기동 직후 한 번 돌립니다. 서버가 며칠 꺼져 있었다면 그동안 만료된
        // 우편이 목록의 첫 장을 차지하고 있게 됩니다.
        purgeTask = Bukkit.getScheduler().runTaskTimerAsynchronously(plugin, this::purge,
                20L * 10, ticks);
    }

    public void stop() {
        if (purgeTask != null) purgeTask.cancel();
    }

    private void purge() {
        long now = System.currentTimeMillis();
        try {
            int removed = repository.purge(now, now - keepMillis());
            if (removed > 0) {
                plugin.getLogger().info("우편 정리: " + removed + "통 삭제 (만료 · 수령 영수증)");
            }
        } catch (SQLException e) {
            plugin.getLogger().log(Level.WARNING, "우편 정리 실패", e);
        }
    }

    // ── 설정 ───────────────────────────────────────────────────────────

    /** 보관 기간. 기본 720시간(30일) — 요구사항 명시값입니다. */
    public long keepMillis() {
        return plugin.getConfig().getLong("mailbox.keep-hours", 720) * 3600_000L;
    }

    /**
     * 한 사람이 동시에 들고 있을 수 있는 미수령 우편 수.
     *
     * 상한이 없으면 유저 상점이 열린 뒤 누군가의 우편함에 1원짜리 우편 수만 통을
     * 밀어 넣어 목록을 못 쓰게 만들 수 있습니다. 지금 막아 두는 것이 쌉니다.
     */
    public int maxItems() {
        return plugin.getConfig().getInt("mailbox.max-items", 100);
    }

    // ── 발송 ───────────────────────────────────────────────────────────

    /**
     * 아이템 우편. 호출은 어느 스레드에서나 됩니다 (DB 작업은 안에서 비동기).
     *
     * @param item      보낼 아이템. 호출부의 것을 건드리지 않게 사본을 씁니다.
     * @param onResult  결과 콜백. 메인 스레드에서 불립니다. null 이면 생략.
     */
    public void sendItem(UUID recipient, ItemStack item, String sender, String reason,
                         java.util.function.Consumer<Result> onResult) {
        if (item == null || item.getType().isAir()) {
            complete(onResult, Result.EMPTY);
            return;
        }
        ItemStack copy = item.clone();

        String encoded;
        try {
            encoded = encode(copy);
        } catch (Exception e) {
            plugin.getLogger().log(Level.SEVERE, "우편 아이템 직렬화 실패", e);
            complete(onResult, Result.ERROR);
            return;
        }
        insert(recipient, encoded, 0, sender, reason, onResult);
    }

    /**
     * 같은 사유로는 한 번만 보내는 아이템 우편. <b>블로킹입니다</b> — 충전 지급처럼
     * RCON 응답에 결과를 실어야 하는 곳에서 씁니다.
     *
     * 사유에 주문 번호를 넣어 두면, 지급을 다시 시도해도 우편이 두 번 가지 않습니다.
     * 우편함이 가득 차 있어도 보냅니다 — 돈을 내고 산 물건을 "가득 참" 으로 막을 수는
     * 없습니다.
     */
    public Result sendItemOnce(UUID recipient, ItemStack item, String sender, String reason) {
        if (item == null || item.getType().isAir()) return Result.EMPTY;
        String why = truncate(reason, 32);
        try {
            if (repository.existsByReason(recipient, why)) return Result.OK;
            long now = System.currentTimeMillis();
            long id = repository.insert(Mail.outgoing(recipient, encode(item.clone()), 0,
                    truncate(sender, 32), why, now, now + keepMillis()));
            if (id < 0) return Result.ERROR;
        } catch (Exception e) {
            plugin.getLogger().log(Level.SEVERE, "우편 발송 실패 (" + why + ")", e);
            return Result.ERROR;
        }
        Bukkit.getScheduler().runTask(plugin, () -> {
            Player online = Bukkit.getPlayer(recipient);
            if (online == null) return;
            String lang = plugin.getPlayerData().languageOf(online);
            online.sendMessage(messages.prefixed(lang, "mailbox.arrived"));
        });
        return Result.OK;
    }

    /**
     * 같은 사유로는 한 번만 보내는 Ruc 우편. <b>블로킹입니다.</b> 유저 상점의 판매 대금처럼
     * "다시 시도해도 한 번만" 이어야 하는 지급에 씁니다 ({@link #sendItemOnce} 와 같은 장치).
     */
    public Result sendRucOnce(UUID recipient, long amount, String sender, String reason) {
        if (amount <= 0) return Result.EMPTY;
        String why = truncate(reason, 32);
        try {
            if (repository.existsByReason(recipient, why)) return Result.OK;
            long now = System.currentTimeMillis();
            long id = repository.insert(Mail.outgoing(recipient, null, amount,
                    truncate(sender, 32), why, now, now + keepMillis()));
            if (id < 0) return Result.ERROR;
        } catch (Exception e) {
            plugin.getLogger().log(Level.SEVERE, "우편 발송 실패 (" + why + ")", e);
            return Result.ERROR;
        }
        Bukkit.getScheduler().runTask(plugin, () -> {
            Player online = Bukkit.getPlayer(recipient);
            if (online == null) return;
            String lang = plugin.getPlayerData().languageOf(online);
            online.sendMessage(messages.prefixed(lang, "mailbox.arrived"));
        });
        return Result.OK;
    }

    /** Ruc 우편. 미접속자 지급에 씁니다. */
    public void sendRuc(UUID recipient, long amount, String sender, String reason,
                        java.util.function.Consumer<Result> onResult) {
        if (amount <= 0) {
            complete(onResult, Result.EMPTY);
            return;
        }
        insert(recipient, null, amount, sender, reason, onResult);
    }

    private void insert(UUID recipient, String item, long ruc, String sender, String reason,
                        java.util.function.Consumer<Result> onResult) {
        long now = System.currentTimeMillis();
        long expiresAt = now + keepMillis();

        Bukkit.getScheduler().runTaskAsynchronously(plugin, () -> {
            try {
                if (repository.countUnclaimed(recipient, now) >= maxItems()) {
                    complete(onResult, Result.FULL);
                    return;
                }
                long id = repository.insert(Mail.outgoing(recipient, item, ruc,
                        truncate(sender, 32), truncate(reason, 32), now, expiresAt));
                if (id < 0) {
                    complete(onResult, Result.ERROR);
                    return;
                }
            } catch (SQLException e) {
                plugin.getLogger().log(Level.SEVERE, "우편 발송 실패", e);
                complete(onResult, Result.ERROR);
                return;
            }

            // 받는 사람이 이 서버에 있으면 바로 알립니다. 다른 서버에 있으면
            // 다음 접속(서버 이동 포함)에서 알게 됩니다 — 프록시를 넘는 즉시
            // 알림은 Phase 6 의 네트워크 전달 경로가 생긴 뒤에 붙이는 쪽이
            // 맞습니다. 그것만을 위해 별도 통로를 뚫을 값은 아닙니다.
            Bukkit.getScheduler().runTask(plugin, () -> {
                Player online = Bukkit.getPlayer(recipient);
                if (online != null) {
                    String lang = plugin.getPlayerData().languageOf(online);
                    online.sendMessage(messages.prefixed(lang, "mailbox.arrived"));
                    online.playSound(online.getLocation(),
                            Sound.ENTITY_ITEM_PICKUP, 0.7f, 1.4f);
                }
                if (onResult != null) onResult.accept(Result.OK);
            });
        });
    }

    /** 접속 시 안 받은 우편이 있으면 알립니다. */
    public void notifyUnclaimed(Player player) {
        UUID uuid = player.getUniqueId();
        Bukkit.getScheduler().runTaskAsynchronously(plugin, () -> {
            int count;
            try {
                count = repository.countUnclaimed(uuid, System.currentTimeMillis());
            } catch (SQLException e) {
                plugin.getLogger().log(Level.WARNING, "우편 개수 조회 실패", e);
                return;
            }
            if (count <= 0) return;

            Bukkit.getScheduler().runTask(plugin, () -> {
                if (!player.isOnline()) return;
                String lang = plugin.getPlayerData().languageOf(player);
                player.sendMessage(messages.prefixed(lang, "mailbox.join-notice",
                        "count", String.valueOf(count)));
            });
        });
    }

    // ── 화면 ───────────────────────────────────────────────────────────

    public void open(Player player, int page) {
        UUID uuid = player.getUniqueId();
        long now = System.currentTimeMillis();

        Bukkit.getScheduler().runTaskAsynchronously(plugin, () -> {
            List<Mail> mails;
            try {
                mails = repository.listUnclaimed(uuid, now);
            } catch (SQLException e) {
                plugin.getLogger().log(Level.SEVERE, "우편 목록 조회 실패", e);
                Bukkit.getScheduler().runTask(plugin, () -> {
                    if (player.isOnline()) {
                        player.sendMessage(messages.prefixed(
                                plugin.getPlayerData().languageOf(player), "mailbox.error"));
                    }
                });
                return;
            }
            Bukkit.getScheduler().runTask(plugin, () -> {
                if (player.isOnline()) render(player, mails, page);
            });
        });
    }

    private void render(Player player, List<Mail> mails, int page) {
        String lang = plugin.getPlayerData().languageOf(player);

        int pages = Pages.pageCount(mails.size(), CONTENT.length);
        int current = Math.max(0, Math.min(page, pages - 1));

        MenuHolder holder = new MenuHolder(MenuHolder.Type.MAILBOX);
        holder.setPage(current);
        Inventory inv = Bukkit.createInventory(holder, Pages.SIZE,
                MessageService.colorize(messages.raw(lang, "mailbox.title")
                        .replace("%page%", String.valueOf(current + 1))
                        .replace("%pages%", String.valueOf(pages))));
        holder.setInventory(inv);

        // 테두리. 목록 칸은 아래에서 덮어씁니다.
        ItemStack pane = simple(Material.GRAY_STAINED_GLASS_PANE, " ", List.of());
        for (int i = 0; i < Pages.SIZE; i++) inv.setItem(i, pane);
        for (int slot : CONTENT) inv.setItem(slot, null);

        int from = current * CONTENT.length;
        for (int i = 0; i < CONTENT.length && from + i < mails.size(); i++) {
            Mail mail = mails.get(from + i);
            inv.setItem(CONTENT[i], display(mail, lang));
            holder.mapSlot(CONTENT[i], mail.id());
        }

        if (mails.isEmpty()) {
            // 목록 격자의 가운데쯤. 빈 화면에서 눈이 가는 자리입니다.
            int center = CONTENT[(CONTENT_ROWS / 2) * (Pages.COLUMNS - 2) + 3];
            inv.setItem(center, simple(Material.LIGHT_GRAY_DYE,
                    messages.raw(lang, "mailbox.empty-name"),
                    split(messages.raw(lang, "mailbox.empty-lore"))));
        }

        if (current > 0) {
            inv.setItem(Pages.SLOT_PREV, simple(Material.ARROW,
                    messages.raw(lang, "mailbox.prev"), List.of()));
        }
        if (current < pages - 1) {
            inv.setItem(Pages.SLOT_NEXT, simple(Material.ARROW,
                    messages.raw(lang, "mailbox.next"), List.of()));
        }
        if (!mails.isEmpty()) {
            inv.setItem(Pages.SLOT_ACTION, simple(Material.CHEST,
                    messages.raw(lang, "mailbox.claim-all-name"),
                    split(messages.raw(lang, "mailbox.claim-all-lore"))));
        }

        player.openInventory(inv);
        player.playSound(player.getLocation(), Sound.BLOCK_BARREL_OPEN, 0.6f, 1.4f);
    }

    /**
     * 목록에 보여 줄 아이템.
     *
     * 실제로 줄 아이템은 수령할 때 DB 에서 다시 읽습니다. 여기 사본의 설명을
     * 고쳐도 받는 물건에는 영향이 없습니다 — 그래서 남은 기간·보낸이를 마음껏
     * 덧붙일 수 있습니다.
     */
    private ItemStack display(Mail mail, String lang) {
        ItemStack stack = null;
        if (mail.hasItem()) {
            try {
                stack = decode(mail.item());
            } catch (Exception e) {
                plugin.getLogger().log(Level.WARNING,
                        "우편 아이템을 읽을 수 없습니다 (id " + mail.id() + ")", e);
            }
        }
        if (stack == null || stack.getType().isAir()) {
            // Ruc 우편이거나, 아이템을 읽지 못한 경우.
            stack = new ItemStack(mail.ruc() > 0 ? Material.EMERALD : Material.BARRIER);
        }

        List<Component> lore = new ArrayList<>();
        if (mail.ruc() > 0) {
            lore.add(plain(messages.raw(lang, "mailbox.entry-ruc")
                    .replace("%amount%", EconomyService.format(mail.ruc()))
                    .replace("%symbol%", plugin.getEconomy().symbol())));
        }
        lore.add(plain(messages.raw(lang, "mailbox.entry-sender")
                .replace("%sender%", mail.sender())));
        lore.add(plain(messages.raw(lang, "mailbox.entry-reason")
                .replace("%reason%", reasonText(lang, mail.reason()))));
        lore.add(plain(messages.raw(lang, "mailbox.entry-remain")
                .replace("%remain%", remaining(lang,
                        mail.expiresAt() - System.currentTimeMillis()))));
        lore.add(Component.empty());
        lore.add(plain(messages.raw(lang, "mailbox.entry-click")));

        ItemMeta meta = stack.getItemMeta();
        // 이름은 아이템 본래 이름을 살립니다 — 무엇이 왔는지가 제일 중요합니다.
        // Ruc 우편만 이름을 붙여 줍니다.
        if (!mail.hasItem() && mail.ruc() > 0) {
            meta.displayName(plain(messages.raw(lang, "mailbox.entry-ruc-name")
                    .replace("%amount%", EconomyService.format(mail.ruc()))
                    .replace("%symbol%", plugin.getEconomy().symbol())));
        }
        List<Component> existing = meta.lore();
        if (existing != null && !existing.isEmpty()) {
            List<Component> merged = new ArrayList<>(existing);
            merged.add(Component.empty());
            merged.addAll(lore);
            meta.lore(merged);
        } else {
            meta.lore(lore);
        }
        stack.setItemMeta(meta);
        return stack;
    }

    // ── 수령 ───────────────────────────────────────────────────────────

    /**
     * 한 통 수령. 클릭에서 부릅니다.
     *
     * @param page 끝나고 다시 그릴 장. 3장째에서 하나 받았는데 1장으로
     *             되돌아가면, 여러 통을 받는 동안 매번 찾아 들어가야 합니다.
     */
    public void claim(Player player, long id, int page) {
        UUID uuid = player.getUniqueId();
        String lang = plugin.getPlayerData().languageOf(player);

        Bukkit.getScheduler().runTaskAsynchronously(plugin, () -> {
            Mail mail;
            try {
                mail = repository.find(id);
            } catch (SQLException e) {
                plugin.getLogger().log(Level.SEVERE, "우편 조회 실패 (id " + id + ")", e);
                return;
            }
            long now = System.currentTimeMillis();
            if (mail == null || !mail.recipient().equals(uuid)
                    || mail.claimedAt() != null || mail.expiresAt() <= now) {
                Bukkit.getScheduler().runTask(plugin, () -> {
                    if (!player.isOnline()) return;
                    player.sendMessage(messages.prefixed(lang, "mailbox.gone"));
                    open(player, page);
                });
                return;
            }

            // 빈 칸 확인은 메인 스레드에서만 유효합니다.
            Bukkit.getScheduler().runTask(plugin, () -> {
                if (!player.isOnline()) return;
                if (mail.hasItem() && player.getInventory().firstEmpty() == -1) {
                    player.sendMessage(messages.prefixed(lang, "mailbox.inventory-full"));
                    player.playSound(player.getLocation(),
                            Sound.BLOCK_NOTE_BLOCK_BASS, 0.6f, 0.8f);
                    return;
                }

                Bukkit.getScheduler().runTaskAsynchronously(plugin, () -> {
                    boolean won;
                    try {
                        won = repository.claim(id, uuid, System.currentTimeMillis());
                    } catch (SQLException e) {
                        plugin.getLogger().log(Level.SEVERE, "우편 수령 실패 (id " + id + ")", e);
                        return;
                    }
                    if (!won) {
                        Bukkit.getScheduler().runTask(plugin, () -> {
                            if (!player.isOnline()) return;
                            player.sendMessage(messages.prefixed(lang, "mailbox.gone"));
                            open(player, page);
                        });
                        return;
                    }
                    Bukkit.getScheduler().runTask(plugin, () -> {
                        deliver(player, mail, lang);
                        open(player, page);
                    });
                });
            });
        });
    }

    /**
     * 현재 보이는 장의 우편을 빈 칸이 허락하는 만큼 받습니다.
     *
     * 목록 전체가 아니라 "받을 수 있는 만큼" 입니다. 빈 칸이 3개면 아이템 우편
     * 3통까지이고, Ruc 우편은 칸을 쓰지 않으므로 전부 들어옵니다.
     */
    public void claimAll(Player player, int page) {
        UUID uuid = player.getUniqueId();
        String lang = plugin.getPlayerData().languageOf(player);
        long now = System.currentTimeMillis();

        Bukkit.getScheduler().runTaskAsynchronously(plugin, () -> {
            List<Mail> mails;
            try {
                mails = repository.listUnclaimed(uuid, now);
            } catch (SQLException e) {
                plugin.getLogger().log(Level.SEVERE, "우편 목록 조회 실패", e);
                return;
            }
            if (mails.isEmpty()) return;

            Bukkit.getScheduler().runTask(plugin, () -> {
                if (!player.isOnline()) return;

                int free = freeSlots(player);
                List<Mail> candidates = new ArrayList<>();
                for (Mail mail : mails) {
                    if (mail.hasItem()) {
                        if (free <= 0) continue;
                        free--;
                    }
                    candidates.add(mail);
                }
                if (candidates.isEmpty()) {
                    player.sendMessage(messages.prefixed(lang, "mailbox.inventory-full"));
                    return;
                }

                Bukkit.getScheduler().runTaskAsynchronously(plugin, () -> {
                    List<Mail> won = new ArrayList<>();
                    for (Mail mail : candidates) {
                        try {
                            if (repository.claim(mail.id(), uuid,
                                    System.currentTimeMillis())) {
                                won.add(mail);
                            }
                        } catch (SQLException e) {
                            plugin.getLogger().log(Level.SEVERE,
                                    "우편 수령 실패 (id " + mail.id() + ")", e);
                        }
                    }
                    Bukkit.getScheduler().runTask(plugin, () -> {
                        if (!player.isOnline()) return;
                        int delivered = 0;
                        for (Mail mail : won) {
                            if (deliver(player, mail, lang)) delivered++;
                        }
                        player.sendMessage(messages.prefixed(lang, "mailbox.claim-all-done",
                                "count", String.valueOf(delivered)));
                        int left = mails.size() - delivered;
                        if (left > 0) {
                            player.sendMessage(messages.prefixed(lang, "mailbox.claim-all-left",
                                    "count", String.valueOf(left)));
                        }
                        open(player, page);
                    });
                });
            });
        });
    }

    /**
     * 실제 지급. <b>메인 스레드</b>에서만 부르세요.
     *
     * 실패하면 수령 표시를 되돌립니다. 그래야 다음에 다시 시도할 수 있습니다.
     */
    private boolean deliver(Player player, Mail mail, String lang) {
        if (mail.hasItem()) {
            ItemStack item;
            try {
                item = decode(mail.item());
            } catch (Exception e) {
                plugin.getLogger().log(Level.SEVERE,
                        "우편 아이템을 복원할 수 없습니다 (id " + mail.id() + ")", e);
                rollback(mail.id());
                player.sendMessage(messages.prefixed(lang, "mailbox.error"));
                return false;
            }
            if (item == null || item.getType().isAir()) {
                plugin.getLogger().warning("빈 우편 아이템 (id " + mail.id() + ")");
                rollback(mail.id());
                player.sendMessage(messages.prefixed(lang, "mailbox.error"));
                return false;
            }

            // addItem 은 넘겨준 스택을 건드릴 수 있어서 원본 사본을 먼저 떠 둡니다.
            ItemStack original = item.clone();
            var leftover = player.getInventory().addItem(item);
            if (!leftover.isEmpty()) {
                // 빈 칸을 확인하고 들어왔는데도 남았다면, 확인 시점과 이 시점
                // 사이에 인벤토리가 찬 것입니다. 바닥에 떨어뜨리지 않습니다 —
                // 약탈 서버에서는 그것이 곧 분실입니다.
                //
                // 되돌릴 양은 '남은 것' 이 아니라 '들어간 것' 입니다. 남은 양만큼
                // 빼면 원래 가지고 있던 같은 아이템을 빼앗게 됩니다.
                int remaining = 0;
                for (ItemStack part : leftover.values()) remaining += part.getAmount();
                int added = original.getAmount() - remaining;
                if (added > 0) {
                    ItemStack takeBack = original.clone();
                    takeBack.setAmount(added);
                    player.getInventory().removeItem(takeBack);
                }
                rollback(mail.id());
                player.sendMessage(messages.prefixed(lang, "mailbox.inventory-full"));
                return false;
            }
        }

        if (mail.ruc() > 0) {
            // deposit() 을 씁니다. reward() 는 드래곤 알 배수(D3)를 타므로
            // 보낸 금액과 받는 금액이 달라집니다.
            if (!plugin.getEconomy().deposit(player.getUniqueId(), mail.ruc())) {
                rollback(mail.id());
                player.sendMessage(messages.prefixed(lang, "mailbox.error"));
                return false;
            }
            player.sendMessage(messages.prefixed(lang, "mailbox.claimed-ruc",
                    "amount", EconomyService.format(mail.ruc()),
                    "symbol", plugin.getEconomy().symbol()));
        } else {
            player.sendMessage(messages.prefixed(lang, "mailbox.claimed"));
        }

        player.playSound(player.getLocation(), Sound.ENTITY_ITEM_PICKUP, 0.8f, 1.2f);
        return true;
    }

    private void rollback(long id) {
        Bukkit.getScheduler().runTaskAsynchronously(plugin, () -> {
            try {
                repository.unclaim(id);
            } catch (SQLException e) {
                plugin.getLogger().log(Level.SEVERE,
                        "우편 수령 되돌리기 실패 (id " + id + ") — 수동 복구 필요", e);
            }
        });
    }

    /** 소지품(0~35)의 빈 칸 수. 방어구·오프핸드는 세지 않습니다. */
    private int freeSlots(Player player) {
        int free = 0;
        for (ItemStack stack : player.getInventory().getStorageContents()) {
            if (stack == null || stack.getType().isAir()) free++;
        }
        return free;
    }

    // ── 직렬화 ────────────────────────────────────────────────────────

    /**
     * ItemStack → Base64.
     *
     * {@code RucWar} 의 국가창고와 다른 방식을 씁니다. 그쪽은 인벤토리 전체의
     * <b>빈 칸 위치</b>를 보존해야 해서 BukkitObjectOutputStream 을 쓰지만,
     * 우편은 한 뭉치뿐이라 그 문제가 없습니다. 대신 우편은 <b>30일을 버팁니다</b> —
     * 그 사이에 마인크래프트 버전이 올라갈 수 있습니다. Paper 의
     * {@code serializeAsBytes()} 는 데이터 버전을 함께 적어 두고 읽을 때
     * 자동으로 올려 주므로, 버전을 넘는 보관에는 이쪽이 맞습니다.
     */
    private String encode(ItemStack item) {
        return Base64.getEncoder().encodeToString(item.serializeAsBytes());
    }

    private ItemStack decode(String encoded) {
        return ItemStack.deserializeBytes(Base64.getDecoder().decode(encoded));
    }

    // ── 표시 도구 ─────────────────────────────────────────────────────

    /** 남은 보관 기간을 사람이 읽는 형태로. */
    private String remaining(String lang, long millis) {
        long minutes = Math.max(0, millis / 60_000);
        long days = minutes / 1440;
        long hours = (minutes % 1440) / 60;

        if (days > 0) {
            return messages.raw(lang, "mailbox.remain-days")
                    .replace("%days%", String.valueOf(days))
                    .replace("%hours%", String.valueOf(hours));
        }
        if (hours > 0) {
            return messages.raw(lang, "mailbox.remain-hours")
                    .replace("%hours%", String.valueOf(hours))
                    .replace("%minutes%", String.valueOf(minutes % 60));
        }
        return messages.raw(lang, "mailbox.remain-minutes")
                .replace("%minutes%", String.valueOf(minutes));
    }

    /**
     * 사유 표시. 번역 키가 없으면 저장된 문자열을 그대로 보여 줍니다.
     *
     * 키를 못 찾았을 때 MessageService 는 키 자체를 돌려주므로, 그 경우를
     * 걸러서 원문을 씁니다. 나중에 사유가 늘어날 때 번역을 미처 못 넣어도
     * 화면에 "mailbox.reason.shop" 같은 문자열이 뜨지 않습니다.
     */
    private String reasonText(String lang, String reason) {
        String key = "mailbox.reason." + reason;
        String text = messages.raw(lang, key);
        return text.equals(key) ? reason : text;
    }

    private ItemStack simple(Material material, String name, List<Component> lore) {
        ItemStack stack = new ItemStack(material);
        ItemMeta meta = stack.getItemMeta();
        meta.displayName(plain(name));
        if (!lore.isEmpty()) meta.lore(lore);
        stack.setItemMeta(meta);
        return stack;
    }

    private List<Component> split(String text) {
        List<Component> lore = new ArrayList<>();
        for (String line : text.split("\\|")) lore.add(plain(line));
        return lore;
    }

    /** 아이템 이름·설명의 기본값인 보라색 기울임을 끕니다. */
    private Component plain(String text) {
        return MessageService.colorize(text).decoration(TextDecoration.ITALIC, false);
    }

    private String truncate(String text, int max) {
        if (text == null) return "";
        return text.length() <= max ? text : text.substring(0, max);
    }

    private void complete(java.util.function.Consumer<Result> onResult, Result result) {
        if (onResult == null) return;
        if (Bukkit.isPrimaryThread()) {
            onResult.accept(result);
        } else {
            Bukkit.getScheduler().runTask(plugin, () -> onResult.accept(result));
        }
    }

    /** 발송 결과. 호출부가 사람에게 뭐라고 할지 정할 수 있게 구분해 둡니다. */
    public enum Result {
        OK,
        /** 받는 사람의 우편함이 가득 찼습니다. */
        FULL,
        /** 보낼 것이 없습니다 (빈 손, 0 Ruc). */
        EMPTY,
        ERROR
    }
}
