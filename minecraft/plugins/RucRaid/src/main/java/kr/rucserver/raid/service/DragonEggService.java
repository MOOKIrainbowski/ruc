package kr.rucserver.raid.service;

import kr.rucserver.raid.RucRaid;
import kr.rucserver.raid.storage.RaidRepository;
import org.bukkit.Bukkit;
import org.bukkit.Location;
import org.bukkit.Material;
import org.bukkit.NamespacedKey;
import org.bukkit.Particle;
import org.bukkit.Sound;
import org.bukkit.World;
import org.bukkit.attribute.Attribute;
import org.bukkit.attribute.AttributeInstance;
import org.bukkit.attribute.AttributeModifier;
import org.bukkit.entity.Player;
import org.bukkit.inventory.ItemStack;
import org.bukkit.persistence.PersistentDataType;
import org.bukkit.potion.PotionEffect;
import org.bukkit.potion.PotionEffectType;
import org.bukkit.scheduler.BukkitTask;

import java.sql.SQLException;
import java.util.HashMap;
import java.util.Map;
import java.util.UUID;
import java.util.logging.Level;

/**
 * 드래곤 알 (D3).
 *
 * 엔더 드래곤을 처치하면 떨어지는 알만 버프 알입니다 (2026-10-10 — 오버월드 제단 폐지).
 * 서버당 동시에 1개만 유통됩니다.
 *
 * 설계 의도는 "강력하되 숨길 수 없게"입니다. 버프만 빨아먹고 잠수하면 콘텐츠가
 * 죽으므로, 이득에는 반드시 <b>추적당하는 대가</b>가 붙습니다.
 *
 * <table>
 *   <tr><td>최대 체력</td><td>+4 (하트 2칸)</td></tr>
 *   <tr><td>성급함</td><td>I</td></tr>
 *   <tr><td>Ruc 획득량</td><td>+15%</td></tr>
 *   <tr><td>자체 XP 획득량</td><td>+10%</td></tr>
 *   <tr><td>비전투 재생</td><td>전투 해제 10초 후 재생 I</td></tr>
 * </table>
 *
 * 대가: 30초마다 발광 노출, 하루 1회 전 서버 공지, 컨테이너 보관 불가,
 * 사망 시 무조건 드랍.
 */
public class DragonEggService {

    /** 최대 체력 보정을 나중에 정확히 되돌리기 위한 고정 키. */
    private final NamespacedKey healthKey;
    /** 버프 알 표식 (드래곤 처치로 나온 알만). */
    private final NamespacedKey eggKey;

    private final RucRaid plugin;
    private final RaidRepository repository;
    private final String serverId;

    private final boolean enabled;
    private final double bonusHealth;
    private final double rucMultiplier;
    private final double xpMultiplier;
    private final int glowIntervalTicks;
    private final int regenAfterCombatSeconds;

    /** 알을 들고 있는 사람이 마지막으로 전투에서 벗어난 시각. */
    private final Map<UUID, Long> peaceSince = new HashMap<>();

    /** 현재 알을 소지한 사람. 공지와 /알 명령이 봅니다. */
    private volatile UUID holder;

    private BukkitTask buffTask;
    private BukkitTask glowTask;
    private BukkitTask announceTask;

    // ── 통치 (2026-10-09, docs/08 B) ──
    /** DB 에 아직 안 쓴 통치 초 (메인 스레드) */
    private final Map<UUID, Long> reignPending = new HashMap<>();
    /** 마지막 소지자 (잠깐 나갔다 와도 같은 사람이면 "교체" 가 아님) · 그 사람이 알을 잡은 시각 */
    private UUID lastHolder;
    private long holderSince;
    private long reignTicks;
    private long lastFeedAt;
    private BukkitTask reignTask;

    public DragonEggService(RucRaid plugin, RaidRepository repository, String serverId) {
        this.plugin = plugin;
        this.repository = repository;
        this.serverId = serverId;
        this.healthKey = new NamespacedKey(plugin, "dragon_egg_health");
        this.eggKey = new NamespacedKey(plugin, "buff_egg");

        this.enabled = plugin.getConfig().getBoolean("dragon-egg.enabled", true);
        this.bonusHealth = plugin.getConfig().getDouble("dragon-egg.bonus-health", 4.0);
        this.rucMultiplier = 1.0 + plugin.getConfig().getDouble("dragon-egg.ruc-bonus-percent", 15) / 100.0;
        this.xpMultiplier = 1.0 + plugin.getConfig().getDouble("dragon-egg.xp-bonus-percent", 10) / 100.0;
        this.glowIntervalTicks = plugin.getConfig().getInt("dragon-egg.glow-interval-seconds", 30) * 20;
        this.regenAfterCombatSeconds = plugin.getConfig().getInt("dragon-egg.regen-after-combat-seconds", 10);
    }

    public boolean isEnabled() {
        return enabled;
    }

    public UUID getHolder() {
        return holder;
    }

    // ── 수명 주기 ──────────────────────────────────────────────────────

    public void start() {
        if (!enabled) {
            plugin.getLogger().info("드래곤 알 비활성화 (config)");
            return;
        }

        // Core의 보상 배수에 등록해 둡니다. Core는 지급 직전에 이 값을 곱합니다.
        plugin.core().getBonuses().registerRuc(
                uuid -> uuid.equals(holder) ? rucMultiplier : 1.0);
        plugin.core().getBonuses().registerXp(
                uuid -> uuid.equals(holder) ? xpMultiplier : 1.0);

        buffTask = Bukkit.getScheduler().runTaskTimer(plugin, this::applyBuffs, 40L, 20L);
        glowTask = Bukkit.getScheduler().runTaskTimer(plugin, this::exposeHolder,
                glowIntervalTicks, glowIntervalTicks);

        long announceMinutes = plugin.getConfig().getLong("dragon-egg.announce-interval-minutes", 1440);
        announceTask = Bukkit.getScheduler().runTaskTimer(plugin, this::announceHolder,
                announceMinutes * 60L * 20L, announceMinutes * 60L * 20L);

        reignTask = Bukkit.getScheduler().runTaskTimer(plugin, this::reignTick, 20L, 20L);

        clearLegacyAltar();
    }

    public void stop() {
        if (buffTask != null) buffTask.cancel();
        if (glowTask != null) glowTask.cancel();
        if (announceTask != null) announceTask.cancel();
        if (reignTask != null) reignTask.cancel();
        flushReign(false);   // 종료 중이라 동기로

        // 서버가 내려갈 때 보정을 남기면, 알 없이도 체력이 늘어난 채로 남습니다.
        for (Player player : Bukkit.getOnlinePlayers()) removeHealthBonus(player);
    }

    // ── 배치 (2026-10-10 개편) ─────────────────────────────────────────
    //
    // 오버월드 제단은 없앴습니다. 버프 알은 <b>엔더 드래곤을 처치했을 때 떨어지는 알</b>뿐이고,
    // PDC 태그로 구분합니다 — 바닐라 알(출구 포탈 위 블록, 크리에이티브 등)은 버프가 없습니다.
    // 서버당 동시에 1개: DB 상태 dragon_egg_live 가 "true" 면 드래곤을 다시 잡아도 알이 안 나옵니다.
    // 알이 사라지면(공허 · 소멸) 플래그를 내리고, 다음 드래곤 처치 때 다시 떨어집니다.

    private static final String LIVE = "dragon_egg_live";

    /** 버프 알 하나. 태그가 곧 정품 증명입니다 (모루 이름으로 위조 불가). */
    public ItemStack createEgg() {
        ItemStack egg = new ItemStack(Material.DRAGON_EGG);
        egg.editMeta(meta -> {
            meta.getPersistentDataContainer().set(eggKey, PersistentDataType.BYTE, (byte) 1);
            meta.lore(java.util.List.of(net.kyori.adventure.text.Component.text("엔더 드래곤의 유산 — 소지 시 버프",
                    net.kyori.adventure.text.format.NamedTextColor.LIGHT_PURPLE)
                    .decoration(net.kyori.adventure.text.format.TextDecoration.ITALIC, false)));
        });
        return egg;
    }

    public boolean isBuffEgg(ItemStack item) {
        return item != null && item.getType() == Material.DRAGON_EGG && item.hasItemMeta()
                && item.getItemMeta().getPersistentDataContainer().has(eggKey, PersistentDataType.BYTE);
    }

    /**
     * 드래곤 사망 (EntityDeathEvent). 바닐라 알은 막고, 유통 중인 알이 없으면 버프 알을 떨어뜨립니다.
     * 사망 연출(200틱)이 끝난 뒤 출구 포탈 위에 떨굽니다 — 바로 떨구면 공중에서 섬 밖으로 떨어지기도 합니다.
     */
    public void onDragonKilled(World end) {
        if (!enabled) return;
        // previouslyKilled 가 true 면 바닐라는 포탈 위에 알 블록을 놓지 않습니다 (연출 끝에 판정).
        if (end.getEnderDragonBattle() != null) end.getEnderDragonBattle().setPreviouslyKilled(true);

        Bukkit.getScheduler().runTaskAsynchronously(plugin, () -> {
            try {
                if ("true".equals(repository.getState(serverId, LIVE))) return;
                repository.setState(serverId, LIVE, "true");
            } catch (SQLException e) {
                plugin.getLogger().log(Level.SEVERE, "드래곤 알 상태 조회 실패 — 이번 처치는 알 없음", e);
                return;
            }
            Bukkit.getScheduler().runTaskLater(plugin, () -> {
                var battle = end.getEnderDragonBattle();
                Location at = battle != null && battle.getEndPortalLocation() != null
                        ? battle.getEndPortalLocation().clone()
                        : new Location(end, 0, end.getHighestBlockYAt(0, 0), 0);
                at = new Location(end, at.getBlockX() + 0.5, end.getHighestBlockYAt(at.getBlockX(), at.getBlockZ()) + 1.5, at.getBlockZ() + 0.5);
                end.dropItem(at, createEgg());
                Bukkit.broadcast(plugin.msg().broadcast("egg.dropped"));
                plugin.core().getRelay().relayChronicle("🐉 엔더 드래곤이 쓰러지고 **드래곤 알**이 나타났습니다.");
            }, 220L);
        });
    }

    /** 버프 알이 월드에서 사라졌습니다. 다음 드래곤 처치 때 다시 떨어집니다. */
    public void markLost() {
        Bukkit.broadcast(plugin.msg().broadcast("egg.lost"));
        Bukkit.getScheduler().runTaskAsynchronously(plugin, () -> {
            try {
                repository.setState(serverId, LIVE, "false");
            } catch (SQLException e) {
                plugin.getLogger().log(Level.SEVERE, "드래곤 알 상태 저장 실패", e);
            }
        });
    }

    /** (스태프) 분실 복구 — 버프 알을 손에 줍니다. 이미 유통 중이면 거절 (개수 보존). */
    public void giveTo(Player staff, Runnable onDenied) {
        Bukkit.getScheduler().runTaskAsynchronously(plugin, () -> {
            boolean live;
            try {
                live = "true".equals(repository.getState(serverId, LIVE));
                if (!live) repository.setState(serverId, LIVE, "true");
            } catch (SQLException e) {
                plugin.getLogger().log(Level.SEVERE, "드래곤 알 상태 조회 실패", e);
                return;
            }
            Bukkit.getScheduler().runTask(plugin, () -> {
                if (live) { onDenied.run(); return; }
                staff.getInventory().addItem(createEgg()).values()
                        .forEach(left -> staff.getWorld().dropItem(staff.getLocation(), left));
            });
        });
    }

    /** 옛 오버월드 제단의 알 블록을 한 번만 치웁니다 (배포본 config 의 altar 좌표). */
    private void clearLegacyAltar() {
        if (!plugin.getConfig().isConfigurationSection("dragon-egg.altar")) return;
        World world = Bukkit.getWorld(plugin.getConfig().getString("dragon-egg.altar.world", "world"));
        if (world == null) return;
        int x = plugin.getConfig().getInt("dragon-egg.altar.x", 0);
        int z = plugin.getConfig().getInt("dragon-egg.altar.z", 0);
        world.getChunkAtAsync(x >> 4, z >> 4).thenAccept(c -> {
            var top = world.getHighestBlockAt(x, z);
            if (top.getType() == Material.DRAGON_EGG) {
                top.setType(Material.AIR);
                plugin.getLogger().info("옛 제단의 드래곤 알 블록을 치웠습니다 (" + x + ", " + top.getY() + ", " + z + ")");
            }
        });
    }

    // ── 버프 ───────────────────────────────────────────────────────────

    private void applyBuffs() {
        UUID found = null;

        for (Player player : Bukkit.getOnlinePlayers()) {
            if (!holdsEgg(player)) {
                removeHealthBonus(player);
                peaceSince.remove(player.getUniqueId());
                continue;
            }

            found = player.getUniqueId();
            addHealthBonus(player);

            // 지속시간을 주기(1초)보다 넉넉히 잡아야 깜빡이지 않습니다.
            player.addPotionEffect(new PotionEffect(
                    PotionEffectType.HASTE, 60, 0, true, false, true));

            applyPeaceRegen(player);
        }

        // 소지자가 오프라인이면 holder 를 지웁니다. 남겨두면 그 사람이 다른
        // 서버에서 배수를 계속 받습니다 (Ruc는 네트워크 공용 지갑입니다).
        holder = found;
    }

    private void applyPeaceRegen(Player player) {
        UUID uuid = player.getUniqueId();

        if (plugin.getCombatTags().isTagged(uuid)) {
            peaceSince.remove(uuid);
            return;
        }

        long since = peaceSince.computeIfAbsent(uuid, k -> System.currentTimeMillis());
        if (System.currentTimeMillis() - since < regenAfterCombatSeconds * 1000L) return;

        player.addPotionEffect(new PotionEffect(
                PotionEffectType.REGENERATION, 60, 0, true, false, true));
    }

    public boolean holdsEgg(Player player) {
        for (ItemStack item : player.getInventory().getContents()) {
            if (isBuffEgg(item)) return true;
        }
        return isBuffEgg(player.getItemOnCursor());
    }

    private void addHealthBonus(Player player) {
        AttributeInstance attribute = player.getAttribute(Attribute.MAX_HEALTH);
        if (attribute == null) return;
        if (attribute.getModifier(healthKey) != null) return;

        // Transient 로 넣으면 플레이어 데이터에 저장되지 않습니다. 서버가 비정상
        // 종료돼도 보정이 영구히 남지 않아, 알 없이 체력만 늘어난 계정을 막습니다.
        attribute.addTransientModifier(new AttributeModifier(
                healthKey, bonusHealth, AttributeModifier.Operation.ADD_NUMBER));
    }

    private void removeHealthBonus(Player player) {
        AttributeInstance attribute = player.getAttribute(Attribute.MAX_HEALTH);
        if (attribute == null || attribute.getModifier(healthKey) == null) return;

        attribute.removeModifier(healthKey);

        // 보정이 빠지면 최대치가 줄어드는데, 현재 체력이 그보다 크면
        // 클라이언트가 이상한 상태로 남습니다. 잘라 맞춥니다.
        if (player.getHealth() > attribute.getValue()) {
            player.setHealth(attribute.getValue());
        }
    }

    // ── 대가 ───────────────────────────────────────────────────────────

    /** 30초마다 반경 안 전원에게 위치를 드러냅니다. */
    private void exposeHolder() {
        UUID current = holder;
        if (current == null) return;

        Player player = Bukkit.getPlayer(current);
        if (player == null) return;

        int seconds = plugin.getConfig().getInt("dragon-egg.glow-duration-seconds", 6);
        player.addPotionEffect(new PotionEffect(
                PotionEffectType.GLOWING, seconds * 20, 0, true, false, true));

        double radius = plugin.getConfig().getDouble("dragon-egg.reveal-radius", 200);
        for (Player nearby : player.getWorld().getPlayers()) {
            if (nearby.equals(player)) continue;
            if (nearby.getLocation().distanceSquared(player.getLocation()) > radius * radius) continue;
            plugin.msg().sendActionBar(nearby, "egg.nearby", "player", player.getName());
        }

        player.getWorld().spawnParticle(Particle.DRAGON_BREATH,
                player.getLocation().add(0, 1.2, 0), 30, 0.4, 0.6, 0.4, 0.01);
        plugin.msg().sendActionBar(player, "egg.exposed");
    }

    /** 하루 1회 전 서버에 소지자를 알립니다. */
    private void announceHolder() {
        UUID current = holder;
        if (current == null) {
            Bukkit.broadcast(plugin.msg().broadcast("egg.announce-none"));
            return;
        }
        Player player = Bukkit.getPlayer(current);
        if (player == null) return;

        Bukkit.broadcast(plugin.msg().broadcast("egg.announce", "player", player.getName()));
        for (Player online : Bukkit.getOnlinePlayers()) {
            online.playSound(online.getLocation(), Sound.ENTITY_ENDER_DRAGON_GROWL, 0.4f, 1.0f);
        }
    }

    // ── 통치 시간 · 웹 피드 ────────────────────────────────────────────

    private String season() {
        return plugin.core().getConfig().getString("egg-reign.season", "S1");
    }

    /** 1초마다 — 소지자의 통치 시간을 쌓고, 바뀌면 알립니다. 1분마다 DB, 10분마다(또는 교체 때) 웹 피드. */
    private void reignTick() {
        reignTicks++;
        UUID h = holder;
        if (h != null) {
            reignPending.merge(h, 1L, Long::sum);
            if (!h.equals(lastHolder)) {
                lastHolder = h;
                holderSince = System.currentTimeMillis();
                Player p = Bukkit.getPlayer(h);
                String name = p == null ? "?" : p.getName();
                Bukkit.broadcast(plugin.msg().broadcast("egg.new-holder", "player", name));
                plugin.core().getRelay().relaySystem("egg", "🥚 **" + name + "** 이(가) 드래곤 알을 차지했습니다.", 0x9B5DE5);
                plugin.core().getRelay().relayChronicle("🥚 **" + name + "** 이(가) 드래곤 알을 차지했습니다.");
                if (System.currentTimeMillis() - lastFeedAt > 30_000) postFeed();
            }
        }
        if (reignTicks % 60 == 0) flushReign(true);
        if (reignTicks % 600 == 0) postFeed();
    }

    private void flushReign(boolean async) {
        if (reignPending.isEmpty() || plugin.core().getEggReign() == null) return;
        Map<UUID, Long> batch = new HashMap<>(reignPending);
        Map<UUID, String> names = new HashMap<>();
        for (UUID u : batch.keySet()) names.put(u, Bukkit.getOfflinePlayer(u).getName());
        reignPending.clear();
        String season = season();
        Runnable write = () -> {
            for (Map.Entry<UUID, Long> e : batch.entrySet()) {
                try {
                    plugin.core().getEggReign().addSeconds(season, e.getKey(),
                            names.getOrDefault(e.getKey(), "?"), e.getValue());
                } catch (SQLException ex) {
                    plugin.getLogger().log(Level.WARNING, "[알 통치] 기록 실패", ex);
                }
            }
        };
        if (async) Bukkit.getScheduler().runTaskAsynchronously(plugin, write); else write.run();
    }

    /**
     * 웹이 읽는 피드 한 줄 (Core DiscordRelayService.relayFeed → 디스코드 피드 채널 → web/app/api/feed).
     * 이름은 마인크래프트 닉네임(영문 · 숫자 · _)이라 JSON 이스케이프가 필요 없습니다.
     */
    private void postFeed() {
        if (plugin.core().getEggReign() == null) return;
        lastFeedAt = System.currentTimeMillis();
        UUID h = lastHolder;
        String holderName = h == null ? null : Bukkit.getOfflinePlayer(h).getName();
        boolean online = h != null && h.equals(holder);
        long since = holderSince;
        long pool = plugin.getBounty() == null ? 0 : plugin.getBounty().pool();
        int wanted = plugin.getBounty() == null ? 0 : plugin.getBounty().wantedCount();
        String season = season();
        Bukkit.getScheduler().runTaskAsynchronously(plugin, () -> {
            StringBuilder top = new StringBuilder("[");
            try {
                var list = plugin.core().getEggReign().top(season, 5);
                for (int i = 0; i < list.size(); i++) {
                    if (i > 0) top.append(',');
                    top.append("{\"name\":\"").append(list.get(i).name())
                            .append("\",\"seconds\":").append(list.get(i).seconds()).append('}');
                }
            } catch (SQLException e) {
                plugin.getLogger().log(Level.WARNING, "[알 통치] 순위 조회 실패", e);
            }
            top.append(']');
            String json = "{\"type\":\"raid\",\"season\":\"" + season + "\""
                    + ",\"egg\":{\"holder\":" + (holderName == null ? "null" : "\"" + holderName + "\"")
                    + ",\"since\":" + (h == null ? "null" : String.valueOf(since)) + ",\"online\":" + online + "}"
                    + ",\"top\":" + top
                    + ",\"bounty\":{\"pool\":" + pool + ",\"wanted\":" + wanted + "}"
                    + ",\"at\":" + System.currentTimeMillis() + "}";
            plugin.core().getRelay().relayFeed(json);
        });
    }

    /** /알순위 — 이번 시즌 통치 상위 5 · 지금 소지자 */
    public void showRanking(org.bukkit.command.CommandSender to) {
        if (plugin.core().getEggReign() == null) return;
        String season = season();
        UUID h = holder;
        String holderName = h == null ? plugin.msg().raw(to, "egg.ranking-nobody") : Bukkit.getOfflinePlayer(h).getName();
        Bukkit.getScheduler().runTaskAsynchronously(plugin, () -> {
            StringBuilder sb = new StringBuilder();
            try {
                var list = plugin.core().getEggReign().top(season, 5);
                for (int i = 0; i < list.size(); i++) {
                    sb.append(i == 0 ? "" : " · ").append(i + 1).append(". ").append(list.get(i).name())
                            .append(' ').append(kr.rucserver.core.storage.EggReignRepository.format(list.get(i).seconds()));
                }
            } catch (SQLException e) {
                plugin.getLogger().log(Level.WARNING, "[알 통치] 순위 조회 실패", e);
            }
            String ranking = sb.length() == 0 ? plugin.msg().raw(to, "egg.ranking-nobody") : sb.toString();
            Bukkit.getScheduler().runTask(plugin, () -> plugin.msg().send(to, "egg.ranking",
                    "season", season, "holder", holderName, "ranking", ranking));
        });
    }

    /** 소지자가 바뀌었을 때 즉시 반영. 줍기/버리기 이벤트에서 부릅니다. */
    public void refreshSoon() {
        Bukkit.getScheduler().runTask(plugin, this::applyBuffs);
    }

    public void clear(UUID uuid) {
        peaceSince.remove(uuid);
        if (uuid.equals(holder)) holder = null;
    }
}
