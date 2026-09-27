package kr.rucserver.war.service;

import kr.rucserver.core.model.Guild;
import kr.rucserver.war.RucWar;
import net.kyori.adventure.text.Component;
import org.bukkit.Bukkit;
import org.bukkit.entity.HumanEntity;
import org.bukkit.entity.Player;
import org.bukkit.inventory.Inventory;
import org.bukkit.inventory.InventoryHolder;
import org.bukkit.inventory.ItemStack;
import org.bukkit.scheduler.BukkitTask;
import org.bukkit.util.io.BukkitObjectInputStream;
import org.bukkit.util.io.BukkitObjectOutputStream;
import org.jetbrains.annotations.NotNull;

import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.sql.SQLException;
import java.util.Base64;
import java.util.HashMap;
import java.util.Map;
import java.util.logging.Level;

/**
 * 국가창고 (§3.3 {@code /국가창고}).
 *
 * <h2>길드당 인벤토리 객체 하나</h2>
 * 같은 길드원 둘이 동시에 열어도 <b>같은 Inventory 객체</b>를 봅니다. 사람마다
 * 사본을 주면 각자 닫을 때 자기 사본을 저장해서, 나중에 닫은 쪽이 상대의 변경을
 * 통째로 덮어씁니다 — 아이템이 조용히 사라지는 가장 흔한 경로입니다.
 *
 * <h2>서버 간 동시 접근</h2>
 * 이 명령은 국가전 서버에만 있으므로(§3.3) 모든 접근이 한 프로세스 안에서
 * 일어납니다. 그래서 위의 "객체 하나" 규칙만으로 충분합니다. 나중에 다른
 * 서버에서도 창고를 열게 한다면 DB 수준의 잠금이 필요해집니다.
 *
 * <h2>내용 판별은 홀더 타입으로</h2>
 * 인벤토리 제목 문자열로 "우리 창고인지" 보면 언어나 색코드가 조금 바뀌는 순간
 * 판별이 풀립니다. {@link StorageHolder} 타입으로 봅니다.
 */
public class StorageService {

    /** 우리 창고임을 타입으로 증명하는 홀더. 소속 길드 id 도 같이 들고 있습니다. */
    public static final class StorageHolder implements InventoryHolder {
        private final int guildId;
        private Inventory inventory;

        StorageHolder(int guildId) {
            this.guildId = guildId;
        }

        public int guildId() { return guildId; }

        void attach(Inventory inventory) { this.inventory = inventory; }

        @Override
        public @NotNull Inventory getInventory() { return inventory; }
    }

    private final RucWar plugin;

    /** 길드 id → 살아 있는 창고. 마지막 사람이 닫으면 저장하고 비웁니다. */
    private final Map<Integer, Inventory> open = new HashMap<>();

    /** 불러오는 중인 길드. 두 사람이 같은 순간에 열 때 두 번 읽지 않게 합니다. */
    private final Map<Integer, Boolean> loading = new HashMap<>();

    private final int rows;
    private BukkitTask autoSaveTask;

    public StorageService(RucWar plugin) {
        this.plugin = plugin;
        // 9칸 단위여야 합니다. 아니면 createInventory 가 예외를 던집니다.
        int configured = plugin.getConfig().getInt("storage.rows", 6);
        this.rows = Math.max(1, Math.min(6, configured));
    }

    public void start() {
        long minutes = plugin.getConfig().getLong("storage.autosave-minutes", 5);
        if (minutes > 0) {
            autoSaveTask = Bukkit.getScheduler().runTaskTimer(plugin, this::saveOpen,
                    minutes * 60 * 20L, minutes * 60 * 20L);
        }
    }

    public void stop() {
        if (autoSaveTask != null) autoSaveTask.cancel();

        // 종료 시에는 동기로 저장합니다. 비동기로 넘기면 스케줄러가 이미 멈춰서
        // 창고 내용이 유실됩니다 — 하루치 자원이 사라지는 상황입니다.
        for (Map.Entry<Integer, Inventory> entry : open.entrySet()) {
            try {
                plugin.getWarRepository().saveStorage(entry.getKey(), serialize(entry.getValue()));
            } catch (Exception e) {
                plugin.getLogger().log(Level.SEVERE,
                        "종료 중 국가창고 저장 실패 (길드 " + entry.getKey() + ")", e);
            }
        }
        open.clear();
    }

    // ── 열기 ──────────────────────────────────────────────────────────

    public void openFor(Player player) {
        Guild guild = plugin.core().getGuilds().of(player);
        if (guild == null) {
            plugin.msg().send(player, "war.storage-no-guild");
            return;
        }

        Inventory existing = open.get(guild.getId());
        if (existing != null) {
            player.openInventory(existing);
            return;
        }

        if (Boolean.TRUE.equals(loading.get(guild.getId()))) {
            plugin.msg().send(player, "war.storage-loading");
            return;
        }
        loading.put(guild.getId(), true);

        int guildId = guild.getId();
        String guildName = guild.getName();

        Bukkit.getScheduler().runTaskAsynchronously(plugin, () -> {
            String contents;
            try {
                contents = plugin.getWarRepository().loadStorage(guildId);
            } catch (SQLException e) {
                plugin.getLogger().log(Level.SEVERE, "국가창고 불러오기 실패: " + guildName, e);
                Bukkit.getScheduler().runTask(plugin, () -> {
                    loading.remove(guildId);
                    plugin.msg().send(player, "war.storage-error");
                });
                return;
            }

            String loaded = contents;
            Bukkit.getScheduler().runTask(plugin, () -> {
                loading.remove(guildId);

                // 불러오는 사이에 다른 사람이 먼저 열었을 수 있습니다.
                Inventory already = open.get(guildId);
                if (already != null) {
                    if (player.isOnline()) player.openInventory(already);
                    return;
                }

                Inventory inventory = create(guildId, guildName);
                if (loaded != null && !loaded.isBlank()) {
                    try {
                        ItemStack[] items = deserialize(loaded);
                        // 설정에서 줄 수를 줄였을 때 넘치는 아이템을 잘라 버리지
                        // 않도록 크기를 맞춰서 넣습니다.
                        for (int i = 0; i < Math.min(items.length, inventory.getSize()); i++) {
                            inventory.setItem(i, items[i]);
                        }
                        if (items.length > inventory.getSize()) {
                            plugin.getLogger().warning("국가창고 " + guildName
                                    + " 의 저장 내용이 현재 칸 수보다 큽니다 ("
                                    + items.length + " > " + inventory.getSize()
                                    + "). storage.rows 를 줄이지 마세요.");
                        }
                    } catch (Exception e) {
                        plugin.getLogger().log(Level.SEVERE,
                                "국가창고 역직렬화 실패: " + guildName, e);
                        plugin.msg().send(player, "war.storage-error");
                        return;
                    }
                }

                open.put(guildId, inventory);
                if (player.isOnline()) player.openInventory(inventory);
            });
        });
    }

    private Inventory create(int guildId, String guildName) {
        StorageHolder holder = new StorageHolder(guildId);
        Component title = plugin.msg().component("war.storage-title", "guild", guildName);
        Inventory inventory = Bukkit.createInventory(holder, rows * 9, title);
        holder.attach(inventory);
        return inventory;
    }

    // ── 닫기 · 저장 ────────────────────────────────────────────────────

    /**
     * 창고가 닫혔습니다. <b>마지막</b> 사람이 나갈 때만 저장하고 메모리에서 비웁니다.
     *
     * 닫을 때마다 비우면, 둘이 같이 보고 있다가 한 명이 닫는 순간 남은 사람은
     * 이미 버려진 객체를 들고 있게 됩니다.
     */
    public void onClose(Inventory inventory, HumanEntity closer) {
        if (!(inventory.getHolder() instanceof StorageHolder holder)) return;

        // 지금 닫는 사람은 아직 viewer 목록에 남아 있을 수 있습니다.
        int remaining = 0;
        for (HumanEntity viewer : inventory.getViewers()) {
            if (!viewer.equals(closer)) remaining++;
        }

        int guildId = holder.guildId();
        String serialized;
        try {
            serialized = serialize(inventory);
        } catch (Exception e) {
            plugin.getLogger().log(Level.SEVERE, "국가창고 직렬화 실패 (길드 " + guildId + ")", e);
            return;
        }

        if (remaining == 0) open.remove(guildId);

        Bukkit.getScheduler().runTaskAsynchronously(plugin, () -> {
            try {
                plugin.getWarRepository().saveStorage(guildId, serialized);
            } catch (SQLException e) {
                plugin.getLogger().log(Level.SEVERE,
                        "국가창고 저장 실패 (길드 " + guildId + ")", e);
            }
        });
    }

    /** 열려 있는 창고를 주기적으로 저장합니다. 서버가 죽어도 잃는 양을 줄입니다. */
    private void saveOpen() {
        for (Map.Entry<Integer, Inventory> entry : open.entrySet()) {
            int guildId = entry.getKey();
            String serialized;
            try {
                serialized = serialize(entry.getValue());
            } catch (Exception e) {
                plugin.getLogger().log(Level.SEVERE,
                        "국가창고 직렬화 실패 (길드 " + guildId + ")", e);
                continue;
            }
            Bukkit.getScheduler().runTaskAsynchronously(plugin, () -> {
                try {
                    plugin.getWarRepository().saveStorage(guildId, serialized);
                } catch (SQLException e) {
                    plugin.getLogger().log(Level.SEVERE,
                            "국가창고 주기 저장 실패 (길드 " + guildId + ")", e);
                }
            });
        }
    }

    // ── 직렬화 ────────────────────────────────────────────────────────

    /**
     * 인벤토리를 Base64 문자열로.
     *
     * {@code ItemStack.serializeAsBytes()} 대신 BukkitObjectOutputStream 을 쓰는
     * 이유는 null 슬롯을 그대로 보존해야 하기 때문입니다. 칸 위치가 어긋나면
     * 플레이어가 정리해 둔 배치가 매번 뒤섞입니다.
     *
     * Base64 는 JDK 것을 씁니다. Bukkit 예제들이 쓰는
     * {@code org.yaml.snakeyaml...Base64Coder} 는 서버가 번들한 snakeyaml 에
     * 딸린 것이라, 그쪽이 버전을 올리거나 relocate 하면 조용히 깨집니다.
     */
    private String serialize(Inventory inventory) throws Exception {
        ByteArrayOutputStream bytes = new ByteArrayOutputStream();
        try (BukkitObjectOutputStream out = new BukkitObjectOutputStream(bytes)) {
            out.writeInt(inventory.getSize());
            for (int i = 0; i < inventory.getSize(); i++) {
                out.writeObject(inventory.getItem(i));
            }
        }
        return Base64.getEncoder().encodeToString(bytes.toByteArray());
    }

    private ItemStack[] deserialize(String encoded) throws Exception {
        byte[] raw = Base64.getDecoder().decode(encoded);
        try (BukkitObjectInputStream in =
                     new BukkitObjectInputStream(new ByteArrayInputStream(raw))) {
            int size = in.readInt();
            ItemStack[] items = new ItemStack[size];
            for (int i = 0; i < size; i++) {
                items[i] = (ItemStack) in.readObject();
            }
            return items;
        }
    }

    public int rows() { return rows; }
}
