package kr.rucserver.core.service;

import kr.rucserver.core.RucCore;
import kr.rucserver.core.storage.CosmeticRepository;
import net.kyori.adventure.text.Component;
import net.kyori.adventure.text.format.NamedTextColor;
import net.kyori.adventure.text.format.TextDecoration;
import org.bukkit.Bukkit;
import org.bukkit.GameMode;
import org.bukkit.Location;
import org.bukkit.Material;
import org.bukkit.NamespacedKey;
import org.bukkit.Particle;
import org.bukkit.Sound;
import org.bukkit.World;
import org.bukkit.entity.Ageable;
import org.bukkit.entity.Breedable;
import org.bukkit.entity.Entity;
import org.bukkit.entity.EntityType;
import org.bukkit.entity.LivingEntity;
import org.bukkit.entity.Mob;
import org.bukkit.entity.Player;
import org.bukkit.event.EventHandler;
import org.bukkit.event.EventPriority;
import org.bukkit.event.Listener;
import org.bukkit.event.entity.EntityDamageEvent;
import org.bukkit.event.entity.PlayerDeathEvent;
import org.bukkit.event.entity.ProjectileHitEvent;
import org.bukkit.event.inventory.InventoryClickEvent;
import org.bukkit.event.inventory.InventoryDragEvent;
import org.bukkit.event.player.PlayerChangedWorldEvent;
import org.bukkit.event.player.PlayerInteractEntityEvent;
import org.bukkit.event.player.PlayerJoinEvent;
import org.bukkit.event.player.PlayerQuitEvent;
import org.bukkit.event.world.EntitiesLoadEvent;
import org.bukkit.inventory.Inventory;
import org.bukkit.inventory.InventoryHolder;
import org.bukkit.inventory.ItemFlag;
import org.bukkit.inventory.ItemStack;
import org.bukkit.inventory.meta.ItemMeta;
import org.bukkit.persistence.PersistentDataType;
import org.bukkit.potion.PotionEffectType;
import org.bukkit.scheduler.BukkitTask;
import org.bukkit.scoreboard.Scoreboard;
import org.bukkit.scoreboard.Team;
import org.bukkit.util.Vector;
import org.jetbrains.annotations.NotNull;

import java.util.ArrayList;
import java.util.EnumMap;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.logging.Level;

/**
 * 코스메틱 (2026-10-05) — 파티클 · 펫 · 발광 · 킬 이펙트. 종류마다 하나씩 장착합니다.
 *
 * <h2>등급으로 열립니다 (D7)</h2>
 * 코스메틱마다 필요한 최소 등급이 있고, 등급이 끝나면 장착은 남아 있어도 보이지 않습니다
 * (다시 등급을 사면 그대로 돌아옵니다). 스태프({@code ruccore.admin})는 전부 쓸 수 있습니다.
 * 등급이 모자라도 목록에서 Shift+클릭하면 {@link Tier} 가격의 Gold 로 <b>영구</b> 구매합니다 (2026-10-09).
 *
 * <h2>싸움에 영향이 없어야 합니다 (D7 대원칙)</h2>
 * <ul>
 *   <li>펫은 무적 · AI 없음 · 충돌 없음이고, <b>투사체가 통과합니다</b> — 화살 방패가 되지 않게</li>
 *   <li>투명 물약을 마신 동안에는 파티클 · 펫이 꺼집니다 — 위치가 새지 않게</li>
 *   <li>킬 이펙트의 번개 · 폭발은 겉모습뿐입니다 (피해 없음)</li>
 *   <li>발광은 벽 너머로 보이므로 쓰는 사람에게만 불리합니다</li>
 * </ul>
 *
 * <h2>발광 색</h2>
 * 색은 팀 색으로 정해지는데, 스코어보드가 사람마다 따로라(ScoreboardService) 보는 사람의
 * 스코어보드마다 색 팀({@code rg_<색>})을 만들어 1초마다 맞춥니다. 팀 색은 이름표 색도 바꿉니다.
 */
public class CosmeticService implements Listener {

    // ── 카탈로그 ──────────────────────────────────────────────────────

    public enum Kind {
        PARTICLE(Material.BLAZE_POWDER, 10),
        PET(Material.LEAD, 12),
        GLOW(Material.GLOWSTONE_DUST, 14),
        KILL(Material.IRON_SWORD, 16);

        final Material icon;
        final int slot;

        Kind(Material icon, int slot) {
            this.icon = icon;
            this.slot = slot;
        }

        String key() { return name().toLowerCase(); }
    }

    /** 등급 순번 — PaymentService.RANKS 와 같은 순서. -1 = 일반. */
    private static final int VIP = 0, SVIP = 1, MVP = 2, PRIME = 3, PREMIUM = 4, ELITE = 5;
    private static final String[] RANK_NAMES = {"VIP", "SVIP", "MVP", "Prime", "Premium", "Elite"};

    record ParticleSpec(Particle particle, int count, double spread, double speed) { }
    record PetSpec(EntityType type, boolean flying, boolean baby) { }
    /** color 가 null 이면 무지개 (1초마다 색이 바뀜). */
    record GlowSpec(NamedTextColor color) { }
    record KillSpec(Particle particle, int count, double spread, double speed, Sound sound,
                    Object data, boolean lightning) { }

    /**
     * Gold 로 영구 구매할 때의 가격 등급 (2026-10-09). 등급(VIP~Elite)과 따로 매깁니다 —
     * 눈에 띄는 정도와 오래 써도 질리지 않는지로 나눴습니다. 가격은 config {@code cosmetic-shop.price}.
     */
    public enum Tier {
        COMMON(20_000), RARE(60_000), LEGENDARY(150_000);

        final long defaultPrice;

        Tier(long defaultPrice) { this.defaultPrice = defaultPrice; }

        String key() { return name().toLowerCase(); }
    }

    private static final Tier C = Tier.COMMON, R = Tier.RARE, L = Tier.LEGENDARY;

    public record Cosmetic(String key, Kind kind, Tier tier, String ko, String en, Material icon, int minRank, Object spec) {
        String name(String lang) { return lang.equals("en") ? en : ko; }
    }

    private static final List<Cosmetic> CATALOG = new ArrayList<>();

    private static void add(String key, Kind kind, Tier tier, String ko, String en, Material icon, int rank, Object spec) {
        // 구매 기록(ruc_cosmetic_owned)은 키만 남기므로 종류가 달라도 키가 겹치면 안 됩니다.
        for (Cosmetic c : CATALOG) if (c.key.equals(key)) throw new IllegalStateException("코스메틱 키 중복: " + key);
        CATALOG.add(new Cosmetic(key, kind, tier, ko, en, icon, rank, spec));
    }

    static {
        // 파티클 — D7: VIP 3종 · SVIP 8종 · 그 위로 늘어남
        add("heart", Kind.PARTICLE, C, "하트", "Hearts", Material.RED_DYE, VIP, new ParticleSpec(Particle.HEART, 1, 0.4, 0));
        add("note", Kind.PARTICLE, C, "음표", "Notes", Material.NOTE_BLOCK, VIP, new ParticleSpec(Particle.NOTE, 1, 0.4, 0));
        add("happy", Kind.PARTICLE, C, "초록 반짝이", "Green Sparkles", Material.EMERALD, VIP, new ParticleSpec(Particle.HAPPY_VILLAGER, 2, 0.4, 0));
        add("flame", Kind.PARTICLE, C, "불꽃", "Flames", Material.BLAZE_POWDER, SVIP, new ParticleSpec(Particle.FLAME, 2, 0.3, 0.01));
        add("snow", Kind.PARTICLE, C, "눈송이", "Snowflakes", Material.SNOWBALL, SVIP, new ParticleSpec(Particle.SNOWFLAKE, 2, 0.4, 0.01));
        add("cloud", Kind.PARTICLE, C, "구름", "Clouds", Material.WHITE_WOOL, SVIP, new ParticleSpec(Particle.CLOUD, 2, 0.3, 0.01));
        add("enchant", Kind.PARTICLE, R, "마법 글자", "Enchant Runes", Material.ENCHANTING_TABLE, SVIP, new ParticleSpec(Particle.ENCHANT, 6, 0.5, 0.5));
        add("witch", Kind.PARTICLE, R, "보랏빛 마법", "Witch Magic", Material.AMETHYST_SHARD, SVIP, new ParticleSpec(Particle.WITCH, 2, 0.4, 0));
        add("soul", Kind.PARTICLE, R, "영혼불", "Soul Fire", Material.SOUL_TORCH, MVP, new ParticleSpec(Particle.SOUL_FIRE_FLAME, 2, 0.3, 0.01));
        add("endrod", Kind.PARTICLE, R, "별빛", "Starlight", Material.END_ROD, MVP, new ParticleSpec(Particle.END_ROD, 1, 0.4, 0.01));
        add("cherry", Kind.PARTICLE, R, "벚꽃잎", "Cherry Petals", Material.PINK_PETALS, MVP, new ParticleSpec(Particle.CHERRY_LEAVES, 2, 0.5, 0));
        add("spark", Kind.PARTICLE, R, "전기 불꽃", "Electric Sparks", Material.LIGHTNING_ROD, MVP, new ParticleSpec(Particle.ELECTRIC_SPARK, 3, 0.4, 0.05));
        add("glowdot", Kind.PARTICLE, R, "야광 먹물", "Glow Ink", Material.GLOW_INK_SAC, PRIME, new ParticleSpec(Particle.GLOW, 2, 0.4, 0));
        add("firefly", Kind.PARTICLE, R, "반딧불이", "Fireflies", Material.FIREFLY_BUSH, PRIME, new ParticleSpec(Particle.FIREFLY, 2, 0.6, 0));
        add("totem", Kind.PARTICLE, L, "토템 빛", "Totem Glow", Material.TOTEM_OF_UNDYING, PREMIUM, new ParticleSpec(Particle.TOTEM_OF_UNDYING, 2, 0.4, 0.05));
        add("rift", Kind.PARTICLE, L, "차원의 틈", "Void Rift", Material.CRYING_OBSIDIAN, ELITE, new ParticleSpec(Particle.REVERSE_PORTAL, 4, 0.3, 0.02));

        // 펫 — D7: MVP 부터
        add("cat", Kind.PET, R, "아기 고양이", "Kitten", Material.STRING, MVP, new PetSpec(EntityType.CAT, false, true));
        add("fox", Kind.PET, R, "아기 여우", "Fox Kit", Material.SWEET_BERRIES, MVP, new PetSpec(EntityType.FOX, false, true));
        add("rabbit", Kind.PET, C, "아기 토끼", "Bunny", Material.CARROT, MVP, new PetSpec(EntityType.RABBIT, false, true));
        add("chick", Kind.PET, C, "병아리", "Chick", Material.EGG, MVP, new PetSpec(EntityType.CHICKEN, false, true));
        add("parrot", Kind.PET, R, "앵무새", "Parrot", Material.FEATHER, PRIME, new PetSpec(EntityType.PARROT, true, false));
        add("bee", Kind.PET, R, "꿀벌", "Bee", Material.HONEYCOMB, PRIME, new PetSpec(EntityType.BEE, true, true));
        add("axolotl", Kind.PET, R, "아홀로틀", "Axolotl", Material.AXOLOTL_BUCKET, PRIME, new PetSpec(EntityType.AXOLOTL, false, true));
        add("frog", Kind.PET, R, "개구리", "Frog", Material.SLIME_BALL, PRIME, new PetSpec(EntityType.FROG, false, false));
        add("panda", Kind.PET, L, "아기 판다", "Panda Cub", Material.BAMBOO, PREMIUM, new PetSpec(EntityType.PANDA, false, true));
        add("wolf", Kind.PET, R, "아기 늑대", "Wolf Pup", Material.BONE, PREMIUM, new PetSpec(EntityType.WOLF, false, true));
        add("armadillo", Kind.PET, R, "아기 아르마딜로", "Armadillo Pup", Material.ARMADILLO_SCUTE, PREMIUM, new PetSpec(EntityType.ARMADILLO, false, true));
        add("allay", Kind.PET, L, "알레이", "Allay", Material.AMETHYST_CLUSTER, ELITE, new PetSpec(EntityType.ALLAY, true, false));

        // 발광 — 색
        add("white", Kind.GLOW, C, "흰색 발광", "White Glow", Material.WHITE_DYE, VIP, new GlowSpec(NamedTextColor.WHITE));
        add("yellow", Kind.GLOW, C, "노란 발광", "Yellow Glow", Material.YELLOW_DYE, SVIP, new GlowSpec(NamedTextColor.YELLOW));
        add("green", Kind.GLOW, C, "초록 발광", "Green Glow", Material.LIME_DYE, SVIP, new GlowSpec(NamedTextColor.GREEN));
        add("aqua", Kind.GLOW, C, "하늘 발광", "Aqua Glow", Material.LIGHT_BLUE_DYE, MVP, new GlowSpec(NamedTextColor.AQUA));
        add("red", Kind.GLOW, C, "빨간 발광", "Red Glow", Material.RED_DYE, MVP, new GlowSpec(NamedTextColor.RED));
        add("gold", Kind.GLOW, R, "황금 발광", "Gold Glow", Material.ORANGE_DYE, MVP, new GlowSpec(NamedTextColor.GOLD));
        add("blue", Kind.GLOW, C, "파란 발광", "Blue Glow", Material.BLUE_DYE, PRIME, new GlowSpec(NamedTextColor.BLUE));
        add("pink", Kind.GLOW, R, "분홍 발광", "Pink Glow", Material.PINK_DYE, PRIME, new GlowSpec(NamedTextColor.LIGHT_PURPLE));
        add("purple", Kind.GLOW, R, "보라 발광", "Purple Glow", Material.PURPLE_DYE, PREMIUM, new GlowSpec(NamedTextColor.DARK_PURPLE));
        add("rainbow", Kind.GLOW, L, "무지개 발광", "Rainbow Glow", Material.PRISMARINE_CRYSTALS, ELITE, new GlowSpec(null));

        // 킬 이펙트 — 상대를 쓰러뜨린 자리에서. 전부 겉모습뿐입니다.
        add("k_heart", Kind.KILL, C, "하트 폭발", "Heart Burst", Material.RED_DYE, VIP, new KillSpec(Particle.HEART, 12, 0.6, 0, Sound.ENTITY_PLAYER_LEVELUP, null, false));
        add("k_note", Kind.KILL, C, "승리의 음표", "Victory Notes", Material.NOTE_BLOCK, VIP, new KillSpec(Particle.NOTE, 15, 0.8, 1, Sound.BLOCK_NOTE_BLOCK_BELL, null, false));
        add("k_snow", Kind.KILL, C, "눈보라", "Blizzard", Material.SNOWBALL, SVIP, new KillSpec(Particle.SNOWFLAKE, 60, 0.6, 0.1, Sound.BLOCK_SNOW_BREAK, null, false));
        add("k_cherry", Kind.KILL, R, "벚꽃 흩날림", "Cherry Blossom", Material.PINK_PETALS, SVIP, new KillSpec(Particle.CHERRY_LEAVES, 60, 1.0, 0, Sound.BLOCK_CHERRY_LEAVES_BREAK, null, false));
        add("k_firework", Kind.KILL, R, "불꽃놀이", "Fireworks", Material.FIREWORK_ROCKET, MVP, new KillSpec(Particle.FIREWORK, 80, 0.3, 0.25, Sound.ENTITY_FIREWORK_ROCKET_BLAST, null, false));
        add("k_soul", Kind.KILL, R, "영혼 이탈", "Soul Escape", Material.SOUL_LANTERN, MVP, new KillSpec(Particle.SOUL, 25, 0.5, 0.05, Sound.PARTICLE_SOUL_ESCAPE, null, false));
        add("k_ender", Kind.KILL, R, "차원 붕괴", "Rift", Material.ENDER_PEARL, MVP, new KillSpec(Particle.PORTAL, 120, 0.5, 1, Sound.ENTITY_ENDERMAN_TELEPORT, null, false));
        add("k_blood", Kind.KILL, R, "붉은 파편", "Crimson Shards", Material.REDSTONE_BLOCK, PRIME, new KillSpec(Particle.BLOCK, 50, 0.4, 0.1, Sound.BLOCK_NOTE_BLOCK_BASS, Material.REDSTONE_BLOCK.createBlockData(), false));
        add("k_totem", Kind.KILL, L, "토템 섬광", "Totem Flash", Material.TOTEM_OF_UNDYING, PRIME, new KillSpec(Particle.TOTEM_OF_UNDYING, 80, 0.5, 0.5, Sound.ITEM_TOTEM_USE, null, false));
        add("k_boom", Kind.KILL, L, "폭발", "Explosion", Material.TNT, PREMIUM, new KillSpec(Particle.EXPLOSION_EMITTER, 1, 0, 0, Sound.ENTITY_GENERIC_EXPLODE, null, false));
        add("k_lightning", Kind.KILL, L, "번개", "Lightning", Material.LIGHTNING_ROD, PREMIUM, new KillSpec(Particle.ELECTRIC_SPARK, 40, 0.5, 0.2, Sound.ENTITY_LIGHTNING_BOLT_THUNDER, null, true));
        add("k_sonic", Kind.KILL, L, "음파 폭발", "Sonic Boom", Material.ECHO_SHARD, ELITE, new KillSpec(Particle.SONIC_BOOM, 1, 0, 0, Sound.ENTITY_WARDEN_SONIC_BOOM, null, false));
    }

    private static final NamedTextColor[] RAINBOW = {
            NamedTextColor.RED, NamedTextColor.GOLD, NamedTextColor.YELLOW, NamedTextColor.GREEN,
            NamedTextColor.AQUA, NamedTextColor.BLUE, NamedTextColor.LIGHT_PURPLE};

    /** 목록 화면에서 코스메틱을 놓는 칸 (최대 21개). */
    private static final int[] LIST_SLOTS = {
            10, 11, 12, 13, 14, 15, 16, 19, 20, 21, 22, 23, 24, 25, 28, 29, 30, 31, 32, 33, 34};
    private static final int SLOT_BACK = 48, SLOT_UNEQUIP = 49, SLOT_CLOSE = 50, SLOT_MAIN_CLOSE = 22;

    public static List<Cosmetic> catalog() { return List.copyOf(CATALOG); }

    static Cosmetic find(Kind kind, String key) {
        for (Cosmetic c : CATALOG) if (c.kind == kind && c.key.equals(key)) return c;
        return null;
    }

    // ── 상태 ─────────────────────────────────────────────────────────

    private final RucCore plugin;
    private final MessageService messages;
    private final CosmeticRepository repository;
    private final NamespacedKey petKey;

    /** 접속 중인 사람의 장착 (메인 스레드). */
    private final Map<UUID, Map<Kind, String>> equipped = new HashMap<>();
    /** 등급 순번 캐시. 접속 · 메뉴 열 때 다시 읽습니다. */
    private final Map<UUID, Integer> ranks = new ConcurrentHashMap<>();
    /** Gold 로 산 코스메틱 키 (메인 스레드). 접속 · 메뉴 열 때 다시 읽습니다. */
    private final Map<UUID, Set<String>> owned = new HashMap<>();
    private final Map<UUID, Entity> pets = new HashMap<>();
    /** 우리가 켠 발광 — 다른 이유(분광 화살 등)로 켜진 것은 건드리지 않습니다. */
    private final Set<UUID> glowing = new HashSet<>();

    private BukkitTask task;
    private long tick;

    public CosmeticService(RucCore plugin, MessageService messages, CosmeticRepository repository) {
        this.plugin = plugin;
        this.messages = messages;
        this.repository = repository;
        this.petKey = new NamespacedKey(plugin, "cosmetic_pet");
    }

    public void start() {
        Map<Kind, Integer> counts = new EnumMap<>(Kind.class);
        for (Cosmetic c : CATALOG) {
            counts.merge(c.kind, 1, Integer::sum);
            if (c.spec instanceof ParticleSpec ps && ps.particle.getDataType() != Void.class) {
                plugin.getLogger().warning("[코스메틱] " + c.key + " 은 데이터가 필요한 입자라 보이지 않습니다: " + ps.particle);
            }
        }
        plugin.getLogger().info("[코스메틱] " + counts);
        task = Bukkit.getScheduler().runTaskTimer(plugin, this::tick, 20L, 2L);
        for (Player p : Bukkit.getOnlinePlayers()) load(p);   // /reload 대비
    }

    public void stop() {
        if (task != null) task.cancel();
        for (Entity pet : pets.values()) pet.remove();
        pets.clear();
        for (UUID uuid : glowing) {
            Player p = Bukkit.getPlayer(uuid);
            if (p != null) p.setGlowing(false);
        }
        glowing.clear();
    }

    private String lang(Player p) { return plugin.getPlayerData().languageOf(p); }

    private boolean allowed(Player player, Cosmetic c) {
        return player.hasPermission("ruccore.admin") || ranks.getOrDefault(player.getUniqueId(), -1) >= c.minRank
                || owned.getOrDefault(player.getUniqueId(), Set.of()).contains(c.key);
    }

    public long price(Tier tier) {
        return Math.max(1, plugin.getConfig().getLong("cosmetic-shop.price." + tier.key(), tier.defaultPrice));
    }

    /** 지금 효과를 내야 하는 장착 코스메틱. 없거나 등급이 모자라면 null. */
    private Cosmetic active(Player player, Kind kind) {
        Map<Kind, String> map = equipped.get(player.getUniqueId());
        if (map == null) return null;
        String key = map.get(kind);
        Cosmetic c = key == null ? null : find(kind, key);
        return c != null && allowed(player, c) ? c : null;
    }

    /** 투명 · 관전 중에는 파티클 · 펫을 끕니다 (위치가 새지 않게). */
    private static boolean hidden(Player p) {
        return p.getGameMode() == GameMode.SPECTATOR || p.hasPotionEffect(PotionEffectType.INVISIBILITY) || p.isDead();
    }

    // ── 접속 · 퇴장 ───────────────────────────────────────────────────

    @EventHandler(priority = EventPriority.MONITOR)
    public void onJoin(PlayerJoinEvent event) {
        load(event.getPlayer());
    }

    private void load(Player player) {
        UUID uuid = player.getUniqueId();
        Bukkit.getScheduler().runTaskAsynchronously(plugin, () -> {
            Map<Kind, String> map = new EnumMap<>(Kind.class);
            Set<String> bought = new HashSet<>();
            try {
                for (Map.Entry<String, String> e : repository.load(uuid).entrySet()) {
                    for (Kind k : Kind.values()) if (k.key().equals(e.getKey())) map.put(k, e.getValue());
                }
                bought.addAll(repository.loadOwned(uuid));
                ranks.put(uuid, plugin.getPayments().rankLevel(uuid));
            } catch (Exception e) {
                plugin.getLogger().log(Level.WARNING, "[코스메틱] 불러오기 실패: " + player.getName(), e);
            }
            Bukkit.getScheduler().runTask(plugin, () -> {
                if (!player.isOnline()) return;
                equipped.put(uuid, map);
                owned.computeIfAbsent(uuid, k -> new HashSet<>()).addAll(bought);
            });
        });
    }

    @EventHandler
    public void onQuit(PlayerQuitEvent event) {
        UUID uuid = event.getPlayer().getUniqueId();
        removePet(uuid);
        equipped.remove(uuid);
        ranks.remove(uuid);
        owned.remove(uuid);
        if (glowing.remove(uuid)) event.getPlayer().setGlowing(false);
    }

    @EventHandler
    public void onWorldChange(PlayerChangedWorldEvent event) {
        removePet(event.getPlayer().getUniqueId());   // 다음 틱에 새 월드에서 다시 생깁니다
    }

    // ── 매 2틱 ────────────────────────────────────────────────────────

    private void tick() {
        tick++;
        for (Player player : Bukkit.getOnlinePlayers()) {
            try {
                if (!equipped.containsKey(player.getUniqueId())) continue;
                updatePet(player);
                if (tick % 2 == 0) particle(player);
            } catch (Exception e) {
                plugin.getLogger().log(Level.WARNING, "[코스메틱] " + player.getName(), e);
            }
        }
        if (tick % 10 == 0) syncGlow();
    }

    private void particle(Player player) {
        Cosmetic c = active(player, Kind.PARTICLE);
        if (c == null || hidden(player)) return;
        ParticleSpec s = (ParticleSpec) c.spec;
        if (s.particle.getDataType() != Void.class) return;   // 추가 데이터가 필요한 입자는 여기서 못 씁니다
        double angle = (tick * 0.35) % (Math.PI * 2);
        Location at = player.getLocation().add(Math.cos(angle) * 0.6, 0.4 + (tick % 8) * 0.2, Math.sin(angle) * 0.6);
        player.getWorld().spawnParticle(s.particle, at, s.count, s.spread * 0.3, s.spread * 0.3, s.spread * 0.3, s.speed);
    }

    // ── 펫 ───────────────────────────────────────────────────────────

    private void updatePet(Player player) {
        UUID uuid = player.getUniqueId();
        Cosmetic c = active(player, Kind.PET);
        Entity pet = pets.get(uuid);
        if (c == null || hidden(player)) {
            if (pet != null) removePet(uuid);
            return;
        }
        PetSpec spec = (PetSpec) c.spec;
        if (pet != null && (!pet.isValid() || pet.getType() != spec.type || pet.getWorld() != player.getWorld())) {
            removePet(uuid);
            pet = null;
        }
        Location target = petTarget(player, spec);
        if (pet == null) {
            pets.put(uuid, spawnPet(target, spec));
            return;
        }
        Location now = pet.getLocation();
        if (now.distanceSquared(target) > 64) {
            pet.teleport(target);
        } else if (now.distanceSquared(target) > 0.02) {
            // 반씩 다가갑니다 — 순간이동보다 부드럽게 따라옵니다.
            Vector step = target.toVector().subtract(now.toVector()).multiply(0.5);
            Location next = now.add(step);
            next.setYaw(player.getLocation().getYaw());
            pet.teleport(next);
        }
    }

    /** 플레이어의 오른쪽 뒤. 나는 펫은 어깨 높이. */
    private static Location petTarget(Player player, PetSpec spec) {
        Location base = player.getLocation();
        Vector dir = base.getDirection().setY(0);
        if (dir.lengthSquared() < 1e-4) dir = new Vector(0, 0, 1);
        dir.normalize();
        Vector right = new Vector(-dir.getZ(), 0, dir.getX());
        Location at = base.clone().subtract(dir.multiply(1.1)).add(right.multiply(0.8));
        at.add(0, spec.flying ? 1.5 : 0, 0);
        at.setYaw(base.getYaw());
        at.setPitch(0);
        return at;
    }

    private Entity spawnPet(Location at, PetSpec spec) {
        World world = at.getWorld();
        return world.spawn(at, spec.type.getEntityClass(), e -> {
            e.getPersistentDataContainer().set(petKey, PersistentDataType.BYTE, (byte) 1);
            e.setPersistent(false);
            e.setInvulnerable(true);
            e.setSilent(true);
            e.setGravity(false);
            if (e instanceof LivingEntity living) {
                living.setAI(false);
                living.setCollidable(false);
                living.setRemoveWhenFarAway(false);
                living.setCanPickupItems(false);
            }
            if (e instanceof Mob mob) mob.setLootTable(null);
            if (spec.baby && e instanceof Ageable ageable) ageable.setBaby();
            if (e instanceof Breedable breedable) breedable.setAgeLock(true);
        });
    }

    private void removePet(UUID uuid) {
        Entity pet = pets.remove(uuid);
        if (pet != null) pet.remove();
    }

    private boolean isPet(Entity e) {
        return e != null && e.getPersistentDataContainer().has(petKey, PersistentDataType.BYTE);
    }

    @EventHandler(ignoreCancelled = true)
    public void onPetDamage(EntityDamageEvent event) {
        if (isPet(event.getEntity())) event.setCancelled(true);
    }

    @EventHandler(ignoreCancelled = true)
    public void onPetInteract(PlayerInteractEntityEvent event) {
        // 이름표 · 끈 · 먹이 · 길들이기 전부 막습니다.
        if (isPet(event.getRightClicked())) event.setCancelled(true);
    }

    @EventHandler(ignoreCancelled = true)
    public void onPetHit(ProjectileHitEvent event) {
        // 화살이 펫을 그대로 통과합니다 — 펫이 방패가 되면 싸움에 영향을 줍니다.
        if (isPet(event.getHitEntity())) event.setCancelled(true);
    }

    /** 서버가 갑자기 꺼져 남은 펫 정리. */
    @EventHandler
    public void onEntitiesLoad(EntitiesLoadEvent event) {
        for (Entity e : event.getEntities()) {
            if (isPet(e) && !pets.containsValue(e)) e.remove();
        }
    }

    // ── 발광 ─────────────────────────────────────────────────────────

    private void syncGlow() {
        Map<NamedTextColor, Set<String>> byColor = new HashMap<>();
        for (Player player : Bukkit.getOnlinePlayers()) {
            Cosmetic c = active(player, Kind.GLOW);
            UUID uuid = player.getUniqueId();
            if (c == null || player.getGameMode() == GameMode.SPECTATOR) {
                if (glowing.remove(uuid)) player.setGlowing(false);
                continue;
            }
            NamedTextColor color = ((GlowSpec) c.spec).color;
            if (color == null) color = RAINBOW[(int) ((tick / 10 + Math.abs(uuid.hashCode())) % RAINBOW.length)];
            byColor.computeIfAbsent(color, k -> new HashSet<>()).add(player.getName());
            if (glowing.add(uuid)) player.setGlowing(true);
        }
        Set<NamedTextColor> colors = new HashSet<>(byColor.keySet());
        for (Cosmetic c : CATALOG) if (c.kind == Kind.GLOW && c.spec instanceof GlowSpec g && g.color != null) colors.add(g.color);
        for (NamedTextColor rc : RAINBOW) colors.add(rc);

        // 보는 사람의 스코어보드마다 색 팀을 맞춥니다.
        Set<Scoreboard> boards = new HashSet<>();
        for (Player viewer : Bukkit.getOnlinePlayers()) boards.add(viewer.getScoreboard());
        for (Scoreboard board : boards) {
            for (NamedTextColor color : colors) {
                Set<String> want = byColor.getOrDefault(color, Set.of());
                String name = "rg_" + color;
                Team team = board.getTeam(name);
                if (team == null) {
                    if (want.isEmpty()) continue;
                    team = board.registerNewTeam(name);
                    team.color(color);
                }
                for (String entry : new ArrayList<>(team.getEntries())) {
                    if (!want.contains(entry)) team.removeEntry(entry);
                }
                for (String entry : want) {
                    if (!team.hasEntry(entry)) team.addEntry(entry);
                }
            }
        }
    }

    // ── 킬 이펙트 ────────────────────────────────────────────────────

    @EventHandler(priority = EventPriority.MONITOR)
    public void onKill(PlayerDeathEvent event) {
        Player victim = event.getPlayer();
        Player killer = victim.getKiller();
        if (killer == null || killer.equals(victim)) return;
        Cosmetic c = active(killer, Kind.KILL);
        if (c == null) return;
        KillSpec s = (KillSpec) c.spec;
        Location at = victim.getLocation().add(0, 1, 0);
        World world = at.getWorld();
        if (s.lightning) world.strikeLightningEffect(victim.getLocation());   // 겉모습뿐 — 불 · 피해 없음
        if (s.data != null) {
            world.spawnParticle(s.particle, at, s.count, s.spread, s.spread, s.spread, s.speed, s.data);
        } else {
            world.spawnParticle(s.particle, at, s.count, s.spread, s.spread, s.spread, s.speed);
        }
        world.playSound(at, s.sound, 1f, 1f);
    }

    // ── 화면 ─────────────────────────────────────────────────────────

    /** /코스메틱 · Shift+F. 등급을 새로 읽고 엽니다 (방금 산 등급이 바로 보이게). */
    public void open(Player player) {
        UUID uuid = player.getUniqueId();
        Bukkit.getScheduler().runTaskAsynchronously(plugin, () -> {
            Set<String> bought = new HashSet<>();
            try {
                ranks.put(uuid, plugin.getPayments().rankLevel(uuid));
                bought.addAll(repository.loadOwned(uuid));   // 다른 서버에서 산 것
            } catch (Exception e) {
                plugin.getLogger().log(Level.WARNING, "[코스메틱] 등급 조회 실패", e);
            }
            Bukkit.getScheduler().runTask(plugin, () -> {
                if (!player.isOnline()) return;
                owned.computeIfAbsent(uuid, k -> new HashSet<>()).addAll(bought);
                player.openInventory(mainMenu(player));
            });
        });
    }

    private Inventory mainMenu(Player player) {
        String lang = lang(player);
        Holder holder = new Holder(null);
        Inventory inv = Bukkit.createInventory(holder, 27, messages.get(lang, "cosmetic.title"));
        holder.inventory = inv;
        fill(inv);
        for (Kind kind : Kind.values()) {
            Cosmetic on = active(player, kind);
            String current = on == null ? messages.raw(lang, "cosmetic.none") : on.name(lang);
            inv.setItem(kind.slot, item(kind.icon, messages.raw(lang, "cosmetic.kind." + kind.key()),
                    messages.raw(lang, "cosmetic.kind-lore").replace("%item%", current)));
        }
        inv.setItem(SLOT_MAIN_CLOSE, item(Material.BARRIER, messages.raw(lang, "cosmetic.close"), null));
        return inv;
    }

    private Inventory listMenu(Player player, Kind kind) {
        String lang = lang(player);
        Holder holder = new Holder(kind);
        Inventory inv = Bukkit.createInventory(holder, 54, messages.get(lang, "cosmetic.list-title",
                "kind", messages.raw(lang, "cosmetic.kind." + kind.key())));
        holder.inventory = inv;
        fill(inv);
        Map<Kind, String> mine = equipped.getOrDefault(player.getUniqueId(), Map.of());
        int i = 0;
        for (Cosmetic c : CATALOG) {
            if (c.kind != kind || i >= LIST_SLOTS.length) continue;
            boolean ok = allowed(player, c);
            boolean on = c.key.equals(mine.get(kind));
            String lore = messages.raw(lang, "cosmetic.tier." + c.tier.key()) + "|" + (!ok
                    ? messages.raw(lang, "cosmetic.locked").replace("%rank%", RANK_NAMES[c.minRank])
                            .replace("%price%", EconomyService.format(price(c.tier)))
                            .replace("%symbol%", plugin.getEconomy().symbol())
                    : messages.raw(lang, on ? "cosmetic.equipped" : "cosmetic.click"));
            ItemStack stack = item(ok ? c.icon : Material.GRAY_DYE,
                    (on ? "&a" : ok ? "&f" : "&7") + c.name(lang), lore);
            if (on) {
                ItemMeta meta = stack.getItemMeta();
                meta.setEnchantmentGlintOverride(true);
                stack.setItemMeta(meta);
            }
            inv.setItem(LIST_SLOTS[i], stack);
            holder.slots.put(LIST_SLOTS[i], c);
            i++;
        }
        inv.setItem(SLOT_BACK, item(Material.ARROW, messages.raw(lang, "cosmetic.back"), null));
        inv.setItem(SLOT_UNEQUIP, item(Material.BUCKET, messages.raw(lang, "cosmetic.unequip"), null));
        inv.setItem(SLOT_CLOSE, item(Material.BARRIER, messages.raw(lang, "cosmetic.close"), null));
        return inv;
    }

    @EventHandler(priority = EventPriority.HIGH)
    public void onClick(InventoryClickEvent event) {
        if (!(event.getView().getTopInventory().getHolder() instanceof Holder holder)) return;
        event.setCancelled(true);
        if (!(event.getWhoClicked() instanceof Player player)) return;
        if (event.getClickedInventory() != event.getView().getTopInventory()) return;
        int slot = event.getRawSlot();
        String lang = lang(player);

        if (holder.kind == null) {
            for (Kind kind : Kind.values()) {
                if (kind.slot == slot) {
                    later(player, () -> player.openInventory(listMenu(player, kind)));
                    return;
                }
            }
            if (slot == SLOT_MAIN_CLOSE) player.closeInventory();
            return;
        }
        if (slot == SLOT_BACK) { later(player, () -> player.openInventory(mainMenu(player))); return; }
        if (slot == SLOT_CLOSE) { player.closeInventory(); return; }
        if (slot == SLOT_UNEQUIP) {
            set(player, holder.kind, null);
            player.sendMessage(messages.prefixed(lang, "cosmetic.unequipped",
                    "kind", messages.raw(lang, "cosmetic.kind." + holder.kind.key())));
            later(player, () -> player.openInventory(listMenu(player, holder.kind)));
            return;
        }
        Cosmetic c = holder.slots.get(slot);
        if (c == null) return;
        if (!allowed(player, c)) {
            // 그냥 클릭은 안내만 — 잘못 눌러 Gold 가 빠지지 않게 구매는 Shift+클릭으로만.
            if (event.isShiftClick()) { buy(player, c); return; }
            player.playSound(player.getLocation(), Sound.BLOCK_NOTE_BLOCK_BASS, 0.6f, 0.8f);
            player.sendMessage(messages.prefixed(lang, "cosmetic.locked-msg",
                    "item", c.name(lang), "rank", RANK_NAMES[c.minRank],
                    "price", EconomyService.format(price(c.tier)), "symbol", plugin.getEconomy().symbol()));
            return;
        }
        boolean on = c.key.equals(equipped.getOrDefault(player.getUniqueId(), Map.of()).get(c.kind));
        set(player, c.kind, on ? null : c.key);
        player.playSound(player.getLocation(), Sound.UI_BUTTON_CLICK, 0.6f, 1.2f);
        player.sendMessage(on
                ? messages.prefixed(lang, "cosmetic.unequipped", "kind", messages.raw(lang, "cosmetic.kind." + c.kind.key()))
                : messages.prefixed(lang, "cosmetic.equipped-msg", "item", c.name(lang)));
        later(player, () -> player.openInventory(listMenu(player, c.kind)));
    }

    @EventHandler(priority = EventPriority.HIGH)
    public void onDrag(InventoryDragEvent event) {
        if (event.getView().getTopInventory().getHolder() instanceof Holder) event.setCancelled(true);
    }

    /**
     * Gold 영구 구매. 차감 · 소유를 메인 스레드에서 먼저 반영하고(연타해도 두 번 빠지지 않게),
     * DB 기록이 실패하면 둘 다 되돌립니다. 산 것은 바로 장착합니다.
     */
    private void buy(Player player, Cosmetic c) {
        String lang = lang(player);
        UUID uuid = player.getUniqueId();
        long cost = price(c.tier);
        String symbol = plugin.getEconomy().symbol();
        if (!plugin.getEconomy().withdraw(uuid, cost)) {
            player.playSound(player.getLocation(), Sound.BLOCK_NOTE_BLOCK_BASS, 0.6f, 0.8f);
            player.sendMessage(messages.prefixed(lang, "rank.need-gold",
                    "cost", EconomyService.format(cost), "symbol", symbol));
            return;
        }
        owned.computeIfAbsent(uuid, k -> new HashSet<>()).add(c.key);
        Bukkit.getScheduler().runTaskAsynchronously(plugin, () -> {
            boolean saved;
            try {
                repository.addOwned(uuid, c.key, cost);
                saved = true;
            } catch (Exception e) {
                plugin.getLogger().log(Level.SEVERE, "[코스메틱] 구매 기록 실패 — 되돌림: " + player.getName() + " " + c.key, e);
                saved = false;
            }
            boolean ok = saved;
            Bukkit.getScheduler().runTask(plugin, () -> {
                if (!ok) {
                    Set<String> mine = owned.get(uuid);
                    if (mine != null) mine.remove(c.key);
                    if (!plugin.getEconomy().deposit(uuid, cost)) {
                        plugin.getLogger().severe("[코스메틱] 환불 실패(접속 끊김) — 수동 환불 필요: "
                                + player.getName() + " " + cost + " " + symbol);
                    }
                    if (player.isOnline()) player.sendMessage(messages.prefixed(lang, "rank.error", "symbol", symbol));
                    return;
                }
                plugin.getLogger().info("[코스메틱] Gold 구매 " + c.key + " " + cost + " — " + player.getName());
                if (!player.isOnline()) return;
                set(player, c.kind, c.key);
                player.playSound(player.getLocation(), Sound.ENTITY_PLAYER_LEVELUP, 0.6f, 1.4f);
                player.sendMessage(messages.prefixed(lang, "cosmetic.bought",
                        "item", c.name(lang), "price", EconomyService.format(cost), "symbol", symbol));
                if (player.getOpenInventory().getTopInventory().getHolder() instanceof Holder) {
                    player.openInventory(listMenu(player, c.kind));
                }
            });
        });
    }

    /** 장착 바꾸기 — 메모리 먼저(바로 보이게), DB 는 비동기. */
    private void set(Player player, Kind kind, String key) {
        UUID uuid = player.getUniqueId();
        Map<Kind, String> map = equipped.computeIfAbsent(uuid, k -> new EnumMap<>(Kind.class));
        if (key == null) map.remove(kind); else map.put(kind, key);
        if (kind == Kind.PET) removePet(uuid);
        if (kind == Kind.GLOW) syncGlow();
        Bukkit.getScheduler().runTaskAsynchronously(plugin, () -> {
            try {
                repository.save(uuid, kind.key(), key);
            } catch (Exception e) {
                plugin.getLogger().log(Level.WARNING, "[코스메틱] 저장 실패: " + player.getName(), e);
            }
        });
    }

    /** 클릭 이벤트 안에서 창을 바꾸면 안 됩니다. 다음 틱에. */
    private void later(Player player, Runnable r) {
        Bukkit.getScheduler().runTask(plugin, () -> { if (player.isOnline()) r.run(); });
    }

    private static void fill(Inventory inv) {
        ItemStack pane = item(Material.BLACK_STAINED_GLASS_PANE, " ", null);
        for (int i = 0; i < inv.getSize(); i++) inv.setItem(i, pane);
    }

    /** lore 는 | 로 줄을 나눕니다. */
    private static ItemStack item(Material material, String name, String lore) {
        ItemStack stack = new ItemStack(material);
        ItemMeta meta = stack.getItemMeta();
        meta.displayName(MessageService.colorize(name).decoration(TextDecoration.ITALIC, false));
        if (lore != null) {
            List<Component> lines = new ArrayList<>();
            for (String line : lore.split("\\|")) {
                lines.add(MessageService.colorize(line).decoration(TextDecoration.ITALIC, false));
            }
            meta.lore(lines);
        }
        meta.addItemFlags(ItemFlag.HIDE_ATTRIBUTES, ItemFlag.HIDE_ADDITIONAL_TOOLTIP);
        stack.setItemMeta(meta);
        return stack;
    }

    public static final class Holder implements InventoryHolder {
        private final Kind kind;
        private final Map<Integer, Cosmetic> slots = new HashMap<>();
        private Inventory inventory;

        Holder(Kind kind) { this.kind = kind; }

        @Override
        public @NotNull Inventory getInventory() { return inventory; }
    }
}
