package kr.rucserver.rpg.character;

import kr.rucserver.rpg.RucRpg;
import kr.rucserver.rpg.engine.Formulas;
import net.kyori.adventure.text.Component;
import net.kyori.adventure.text.format.NamedTextColor;
import net.kyori.adventure.text.format.TextDecoration;
import net.kyori.adventure.title.Title;
import org.bukkit.Bukkit;
import org.bukkit.Color;
import org.bukkit.GameMode;
import org.bukkit.GameRule;
import org.bukkit.Location;
import org.bukkit.Particle;
import org.bukkit.Sound;
import org.bukkit.World;
import org.bukkit.attribute.Attribute;
import org.bukkit.attribute.AttributeInstance;
import org.bukkit.entity.Player;
import org.bukkit.event.EventHandler;
import org.bukkit.event.EventPriority;
import org.bukkit.event.Listener;
import org.bukkit.event.entity.EntityDamageEvent;
import org.bukkit.event.entity.EntityRegainHealthEvent;
import org.bukkit.event.entity.FoodLevelChangeEvent;
import org.bukkit.event.player.PlayerQuitEvent;

import java.time.Duration;
import java.util.Collection;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;

/**
 * 접속 중인 캐릭터를 매 틱(20Hz) 돌림: 회복 · 스태미나 · 탈진 → 바닐라 화면 값(체력 칸 비율 · 배고픔 = 달리기 가능 여부 · 이동 속도 · 경험치 바)에 반영.
 * 바닐라 체력 · 배고픔은 표시용일 뿐, 진짜 값은 PlayerUnit (리소스팩이 바닐라 하트 · 배고픔 그림을 숨김).
 */
public final class PlayerRuntime implements Listener {

    private static final double DT = 0.05;   // 1 마크 틱 = 50ms

    private final RucRpg plugin;
    private final Formulas f;
    private final kr.rucserver.rpg.engine.EffectDefs defs;
    private final Map<UUID, PlayerUnit> units = new ConcurrentHashMap<>();
    private kr.rucserver.rpg.hud.Hud hud;

    public void hud(kr.rucserver.rpg.hud.Hud h) { hud = h; }

    public PlayerRuntime(RucRpg plugin, Formulas f, kr.rucserver.rpg.engine.EffectDefs defs) {
        this.plugin = plugin;
        this.f = f;
        this.defs = defs;
        for (World w : Bukkit.getWorlds()) w.setGameRule(GameRule.NATURAL_REGENERATION, false);
        Bukkit.getScheduler().runTaskTimer(plugin, this::tick, 1L, 1L);
    }

    public PlayerUnit unit(Player p) { return units.get(p.getUniqueId()); }
    public Collection<PlayerUnit> units() { return units.values(); }

    /** 캐릭터를 불러왔거나 새로 만들었을 때 */
    public void attach(Player p, RpgChar ch) {
        PlayerUnit u = new PlayerUnit(p, ch);
        rebuild(u);
        u.hp = ch.hp < 0 ? u.st.get("hp") : Math.min(ch.hp, u.st.get("hp"));
        u.mp = ch.mana < 0 ? u.st.get("mana") : Math.min(ch.mana, u.st.get("mana"));
        u.en = ch.energy < 0 ? u.st.get("energy") : Math.min(ch.energy, u.st.get("energy"));
        u.stamina = ch.stamina < 0 ? u.st.get("stamina") : Math.min(ch.stamina, u.st.get("stamina"));
        if (u.hp <= 0) u.hp = u.st.get("hp");   // 죽은 채 나갔으면 다시 들어올 때 살아 있음 (웹 RPG 와 같음)
        units.put(p.getUniqueId(), u);
        syncVanilla(u);
    }

    /** 레벨 · 직업 · 장비가 바뀌면 기본 스탯부터 다시 */
    public void rebuild(PlayerUnit u) {
        RpgChar c = u.ch;
        u.lv = c.level;
        u.el = c.element;
        u.job = c.job;
        u.base = f.jobStats(c.level, c.line, c.potPhys, c.potMag, c.job, c.awake);
        u.innate.clear();
        u.innate.addAll(f.elementMods(c.element));
        u.recalc(f, defs);
    }

    /** 저장 전에 자원 값을 캐릭터에 적어 둠 */
    public void writeBack(PlayerUnit u) {
        u.ch.hp = u.hp;
        u.ch.mana = u.mp;
        u.ch.energy = u.en;
        u.ch.stamina = u.stamina;
    }

    // ── 경험치 · 레벨 (§7) ──────────────────────────────────────────

    /** 경험치 얻기 — 한 번에 많이 들어오면 여러 번 연속 레벨업, 레벨업마다 전부 회복 + 연출 */
    public void gainExp(Player p, long amount) {
        PlayerUnit u = unit(p);
        if (u == null || amount <= 0) return;
        RpgChar c = u.ch;
        int before = c.level;
        c.exp += amount;
        while (c.level < f.maxLevel() && c.exp >= Formulas.expToNext(c.level)) {
            c.exp -= Formulas.expToNext(c.level);
            c.level++;
        }
        if (c.level >= f.maxLevel()) c.exp = 0;
        if (c.level != before) {
            rebuild(u);
            u.hp = u.st.get("hp");
            u.mp = u.st.get("mana");
            u.en = u.st.get("energy");
            u.stamina = u.st.get("stamina");
            u.exhausted = false;
            levelUpShow(p, c.level);
            plugin.chars().saveAsync(c);
        }
        syncVanilla(u);
    }

    /** GM 레벨 변경 */
    public void setLevel(Player p, int level) {
        PlayerUnit u = unit(p);
        if (u == null) return;
        u.ch.level = Math.max(1, Math.min(f.maxLevel(), level));
        u.ch.exp = 0;
        rebuild(u);
        u.hp = u.st.get("hp");
        u.mp = u.st.get("mana");
        u.en = u.st.get("energy");
        u.stamina = u.st.get("stamina");
        syncVanilla(u);
        plugin.chars().saveAsync(u.ch);
    }

    /** 금색 빛기둥 + 소리, 주변 사람에게도 보임 (§7 레벨업 연출) */
    private void levelUpShow(Player p, int level) {
        Location at = p.getLocation();
        World w = at.getWorld();
        Particle.DustOptions gold = new Particle.DustOptions(Color.fromRGB(0xF2C94C), 1.6f);
        for (int i = 0; i < 40; i++) {
            double y = i * 0.12;
            w.spawnParticle(Particle.DUST, at.clone().add(0, y, 0), 3, 0.18, 0.02, 0.18, 0, gold);
        }
        w.spawnParticle(Particle.END_ROD, at.clone().add(0, 1, 0), 40, 0.4, 1.2, 0.4, 0.05);
        w.spawnParticle(Particle.TOTEM_OF_UNDYING, at.clone().add(0, 1, 0), 30, 0.5, 0.8, 0.5, 0.3);
        w.playSound(at, Sound.UI_TOAST_CHALLENGE_COMPLETE, 0.8f, 1.2f);
        p.showTitle(Title.title(
                Component.text("LEVEL UP", NamedTextColor.GOLD, TextDecoration.BOLD),
                Component.text("Lv." + level, NamedTextColor.YELLOW),
                Title.Times.times(Duration.ofMillis(150), Duration.ofMillis(1600), Duration.ofMillis(500))));
    }

    // ── 틱 ──────────────────────────────────────────────────────────

    private void tick() {
        long now = System.currentTimeMillis();
        for (PlayerUnit u : units.values()) {
            Player p = u.player;
            if (!p.isOnline()) continue;
            boolean safe = plugin.safeZones().contains(p.getLocation());
            boolean running = p.isSprinting() && p.getGameMode() != GameMode.CREATIVE && p.getGameMode() != GameMode.SPECTATOR;
            u.staminaTick(f, running, safe, DT * 1000, 1);
            u.regen(f, now, DT);
            u.exhaustDrain(f, DT);
            syncVanilla(u);
            writeBack(u);   // 자동 저장 · 나가기 저장이 늘 최신 값을 쓰게 (필드 복사뿐)
            hud.draw(u, now);
        }
    }

    /** 바닐라 화면 값 맞추기 */
    void syncVanilla(PlayerUnit u) {
        Player p = u.player;
        if (p.isDead()) return;
        double max = u.st.get("hp");
        AttributeInstance mh = p.getAttribute(Attribute.MAX_HEALTH);
        double vmax = mh == null ? 20 : mh.getValue();
        if (!u.dead) p.setHealth(Math.max(0.5, Math.min(vmax, vmax * u.hp / Math.max(1, max))));
        // 배고픔 = 달리기 가능 여부 (6 이하면 바닐라가 달리기를 막음 = 탈진)
        p.setFoodLevel(u.exhausted ? 6 : 20);
        p.setSaturation(0);
        AttributeInstance ms = p.getAttribute(Attribute.MOVEMENT_SPEED);
        if (ms != null) {
            double want = 0.1 * Math.min(u.st.get("moveSpeed"), f.cap("moveSpeed")) / 100 * (u.exhausted ? 0.7 : 1);
            if (Math.abs(ms.getBaseValue() - want) > 1e-6) ms.setBaseValue(want);
        }
        // 경험치 바 = RPG 레벨 (RucCore 레벨은 스코어보드에 그대로, 사용자 결정 Q4)
        if (p.getLevel() != u.ch.level) p.setLevel(u.ch.level);
        float prog = u.ch.level >= f.maxLevel() ? 1f : (float) Math.min(0.9999, (double) u.ch.exp / Formulas.expToNext(u.ch.level));
        if (Math.abs(p.getExp() - prog) > 1e-4) p.setExp(prog);
    }

    // ── 바닐라 규칙 끄기 ──────────────────────────────────────────────

    @EventHandler(ignoreCancelled = true)
    public void onFood(FoodLevelChangeEvent e) {
        if (e.getEntity() instanceof Player p && units.containsKey(p.getUniqueId())) e.setCancelled(true);
    }

    @EventHandler(ignoreCancelled = true)
    public void onRegain(EntityRegainHealthEvent e) {
        if (e.getEntity() instanceof Player p && units.containsKey(p.getUniqueId())) e.setCancelled(true);
    }

    /**
     * 환경 피해(낙하 · 불 · 질식 · 익사 · 폭발 …)를 RPG HP 로: 바닐라 피해 × 최대HP / 20 (Codex 리뷰 4).
     * 공허 · /kill 은 즉사. 몹 · 플레이어 · 투사체 공격은 M2 전투 엔진이 따로 처리 → 여기서는 건드리지 않음.
     */
    @EventHandler(priority = EventPriority.HIGH, ignoreCancelled = true)
    public void onDamage(EntityDamageEvent e) {
        if (!(e.getEntity() instanceof Player p)) return;
        PlayerUnit u = units.get(p.getUniqueId());
        if (u == null) return;
        EntityDamageEvent.DamageCause c = e.getCause();
        if (COMBAT_CAUSES.contains(c)) return;   // M2
        if (c == EntityDamageEvent.DamageCause.VOID || c == EntityDamageEvent.DamageCause.KILL) {
            u.hp = 0;
            return;   // 바닐라 죽음 그대로
        }
        double dmg = e.getDamage() * u.st.get("hp") / 20;
        e.setDamage(0.0001);   // 맞는 소리 · 빨간 깜빡임은 남김
        u.hp = Math.max(0, u.hp - dmg);
        u.combatAt = System.currentTimeMillis();
        if (u.hp <= 0) {
            u.dead = true;
            p.setHealth(0);
        }
    }

    private static final List<EntityDamageEvent.DamageCause> COMBAT_CAUSES = List.of(
            EntityDamageEvent.DamageCause.ENTITY_ATTACK, EntityDamageEvent.DamageCause.ENTITY_SWEEP_ATTACK,
            EntityDamageEvent.DamageCause.PROJECTILE, EntityDamageEvent.DamageCause.MAGIC, EntityDamageEvent.DamageCause.THORNS,
            EntityDamageEvent.DamageCause.CUSTOM);

    /** 바닐라 죽음 뒤 부활 — 전부 회복 (사망 패널티 · 부활 위치는 M2) */
    @EventHandler
    public void onRespawn(org.bukkit.event.player.PlayerRespawnEvent e) {
        PlayerUnit u = units.get(e.getPlayer().getUniqueId());
        if (u == null) return;
        u.dead = false;
        u.hp = u.st.get("hp");
        u.mp = u.st.get("mana");
        u.en = u.st.get("energy");
        u.stamina = u.st.get("stamina");
        u.exhausted = false;
        Bukkit.getScheduler().runTask(plugin, () -> syncVanilla(u));
    }

    @EventHandler(priority = EventPriority.LOWEST)
    public void onQuit(PlayerQuitEvent e) {
        PlayerUnit u = units.remove(e.getPlayer().getUniqueId());
        if (u != null) writeBack(u);   // CharService(MONITOR)가 이어서 저장
    }

    public void writeBackAll() {
        for (PlayerUnit u : units.values()) writeBack(u);
    }
}
