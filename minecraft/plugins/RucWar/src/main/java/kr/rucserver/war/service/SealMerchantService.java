package kr.rucserver.war.service;

import kr.rucserver.core.model.Guild;
import kr.rucserver.core.model.GuildRank;
import kr.rucserver.core.service.EconomyService;
import kr.rucserver.war.RucWar;
import net.kyori.adventure.text.serializer.legacy.LegacyComponentSerializer;
import org.bukkit.Bukkit;
import org.bukkit.Location;
import org.bukkit.NamespacedKey;
import org.bukkit.Sound;
import org.bukkit.World;
import org.bukkit.entity.Entity;
import org.bukkit.entity.EntityType;
import org.bukkit.entity.Player;
import org.bukkit.entity.Villager;
import org.bukkit.inventory.ItemStack;
import org.bukkit.persistence.PersistentDataType;

/**
 * 국가 인장 상인 (D2).
 *
 * 인장은 <b>제작할 수 없고</b> 250,000 Ruc 에 사야 합니다. 이것이 코어 하나의
 * 가격 하한을 만들고, "길드 하나가 일주일 정도 모아야 코어 1개" 라는 목표를
 * 지탱합니다.
 *
 * <h2>왜 길드 금고에서 받는가</h2>
 * 길드장 개인 지갑에서 빼면 부유한 한 사람이 전부 부담하게 되어 길드가 함께
 * 모을 이유가 사라집니다. 금고에서 빼면 길드원 전원이 기여해야 하고, 기여도도
 * 기록에 남습니다.
 */
public class SealMerchantService {

    private static final LegacyComponentSerializer LEGACY =
            LegacyComponentSerializer.legacyAmpersand();

    /** 이 엔티티가 인장 상인임을 표시하는 키. 이름으로 판별하면 위조가 됩니다. */
    private final NamespacedKey merchantKey;

    private final RucWar plugin;

    public SealMerchantService(RucWar plugin) {
        this.plugin = plugin;
        this.merchantKey = new NamespacedKey(plugin, "seal_merchant");
    }

    public long price() {
        return plugin.getConfig().getLong("core.seal-price", 250000);
    }

    // ── NPC ───────────────────────────────────────────────────────────

    /**
     * 상인을 세웁니다. 이미 있으면 다시 만들지 않습니다.
     *
     * 좌표가 설정되어 있지 않으면 세우지 않고, 명령으로만 살 수 있게 둡니다 —
     * 월드 좌표를 모르는 상태에서 아무 데나 세우면 허공이나 지하에 박힙니다.
     */
    public void spawn() {
        if (!plugin.getConfig().getBoolean("core.merchant.enabled", true)) return;

        String worldName = plugin.getConfig().getString("core.merchant.world", "world");
        World world = Bukkit.getWorld(worldName);
        if (world == null) {
            plugin.getLogger().warning("인장 상인 월드 '" + worldName + "' 가 없습니다.");
            return;
        }

        double x = plugin.getConfig().getDouble("core.merchant.x", 8.5);
        double z = plugin.getConfig().getDouble("core.merchant.z", 8.5);
        double y = plugin.getConfig().getDouble("core.merchant.y", -1);

        // y 가 음수면 지표면으로 스냅합니다. 드래곤 알 제단이 허공에 지어졌던
        // 것과 같은 실수를 반복하지 않기 위한 장치입니다.
        if (y < 0) y = world.getHighestBlockYAt((int) x, (int) z) + 1;

        Location location = new Location(world, x, y, z);

        // 청크를 비동기로 불러온 뒤 메인 스레드에서 확인·생성합니다.
        world.getChunkAtAsyncUrgently(location).thenAccept(chunk ->
                Bukkit.getScheduler().runTask(plugin, () -> {
                    if (findExisting(location) != null) return;
                    create(location);
                }));
    }

    private Entity findExisting(Location location) {
        for (Entity entity : location.getWorld().getNearbyEntities(location, 8, 8, 8)) {
            if (isMerchant(entity)) return entity;
        }
        return null;
    }

    private void create(Location location) {
        Villager villager = (Villager) location.getWorld()
                .spawnEntity(location, EntityType.VILLAGER);

        villager.customName(LEGACY.deserialize(
                plugin.msg().raw(Bukkit.getConsoleSender(), "war.merchant-name")));
        villager.setCustomNameVisible(true);

        // 바닐라 거래·이동·번식을 전부 끕니다. 그냥 두면 걸어 다니다 사라지고,
        // 좀비에게 물리면 상인이 없어집니다.
        villager.setAI(false);
        villager.setInvulnerable(true);
        villager.setSilent(true);
        villager.setProfession(Villager.Profession.CARTOGRAPHER);
        villager.setRemoveWhenFarAway(false);
        villager.setPersistent(true);

        villager.getPersistentDataContainer().set(merchantKey, PersistentDataType.BYTE, (byte) 1);
        plugin.getLogger().info("인장 상인 배치: " + location.getWorld().getName()
                + " (" + location.getBlockX() + ", " + location.getBlockY()
                + ", " + location.getBlockZ() + ")");
    }

    public boolean isMerchant(Entity entity) {
        return entity.getPersistentDataContainer().has(merchantKey, PersistentDataType.BYTE);
    }

    // ── 구매 ──────────────────────────────────────────────────────────

    /**
     * 인장을 구매합니다. 길드장만, 길드 금고에서 차감합니다.
     *
     * 금고 차감이 비동기라서 <b>차감이 확인된 뒤에</b> 아이템을 줍니다. 순서를
     * 뒤집으면 차감이 실패했는데 인장이 남는 경로가 생깁니다.
     */
    public void buy(Player player) {
        Guild guild = plugin.core().getGuilds().of(player);
        if (guild == null) {
            plugin.msg().send(player, "war.seal-no-guild");
            return;
        }
        if (guild.rankOf(player.getUniqueId()) != GuildRank.MASTER) {
            plugin.msg().send(player, "war.seal-master-only");
            return;
        }

        long price = price();
        if (guild.getBank() < price) {
            // 캐시 기준의 사전 안내입니다. 실제 판정은 아래 spendBank 가 DB 에서 합니다.
            plugin.msg().send(player, "war.seal-not-enough",
                    "price", EconomyService.format(price),
                    "bank", EconomyService.format(guild.getBank()),
                    "symbol", plugin.core().getEconomy().symbol());
            return;
        }

        // 인벤토리가 꽉 찬 상태에서 사면 인장이 바닥에 떨어져 분실 위험이 생깁니다.
        if (player.getInventory().firstEmpty() == -1) {
            plugin.msg().send(player, "war.seal-inventory-full");
            return;
        }

        plugin.core().getGuilds().spendBank(guild.getId(), price, ok -> {
            if (!ok) {
                plugin.msg().send(player, "war.seal-not-enough",
                        "price", EconomyService.format(price),
                        "bank", EconomyService.format(guild.getBank()),
                        "symbol", plugin.core().getEconomy().symbol());
                return;
            }
            if (!player.isOnline()) {
                // 접속이 끊겼으면 돈을 돌려줍니다. 아이템을 줄 방법이 없습니다.
                plugin.core().getGuilds().depositBankDirect(guild.getId(), price);
                return;
            }

            ItemStack seal = plugin.getItems().create(CoreItems.Part.SEAL, 1);
            player.getInventory().addItem(seal);

            plugin.msg().send(player, "war.seal-bought",
                    "price", EconomyService.format(price),
                    "symbol", plugin.core().getEconomy().symbol());
            player.playSound(player.getLocation(), Sound.ENTITY_VILLAGER_YES, 1.0f, 1.0f);

            plugin.getLogger().info("국가 인장 판매: " + guild.getName()
                    + " (" + player.getName() + ") -" + price);
        });
    }

    /** 상인에게 말을 걸었을 때의 안내. */
    public void greet(Player player) {
        Guild guild = plugin.core().getGuilds().of(player);

        plugin.msg().sendPlain(player, "war.merchant-greet",
                "price", EconomyService.format(price()),
                "symbol", plugin.core().getEconomy().symbol());

        if (guild == null) {
            plugin.msg().sendPlain(player, "war.merchant-no-guild");
            return;
        }
        plugin.msg().sendPlain(player, "war.merchant-bank",
                "bank", EconomyService.format(guild.getBank()),
                "symbol", plugin.core().getEconomy().symbol());

        if (guild.rankOf(player.getUniqueId()) == GuildRank.MASTER) {
            plugin.msg().sendPlain(player, "war.merchant-how");
        } else {
            plugin.msg().sendPlain(player, "war.merchant-master-only");
        }
    }
}
