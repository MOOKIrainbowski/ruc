package kr.rucserver.rpg.client;

import com.google.gson.JsonElement;
import kr.rucserver.rpg.RucRpg;
import kr.rucserver.rpg.character.PlayerUnit;
import kr.rucserver.rpg.engine.EffectDefs;
import kr.rucserver.rpg.engine.Unit;
import kr.rucserver.rpg.skill.Progression;
import net.kyori.adventure.text.Component;
import net.kyori.adventure.text.format.NamedTextColor;
import org.bukkit.Bukkit;
import org.bukkit.entity.Player;
import org.bukkit.event.EventHandler;
import org.bukkit.event.Listener;
import org.bukkit.event.player.PlayerChangedWorldEvent;
import org.bukkit.event.player.PlayerJoinEvent;
import org.bukkit.event.player.PlayerQuitEvent;
import org.bukkit.plugin.messaging.PluginMessageListener;

import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.DataInputStream;
import java.io.DataOutputStream;
import java.io.IOException;
import java.util.Arrays;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;

/**
 * 러크 RPG 클라이언트 모드 ↔ 서버 (사용자 결정 K1 · docs/13 F1). 채널 `ruc:rpg`, 메시지 = 첫 바이트 종류 + DataOutput.
 * 모드 → 서버: 1 HELLO(int 판) · 2 KEY(UTF 동작 — "skill:Q|C|Z|R", "open:equip|skills|journal|party|storage|social|gm|menu", "ping:종류")
 * 서버 → 모드: 1 HELLO(int 판) · 2 HUD · 3 MAP(UTF 맵) · 4 PARTY(n, UTF 이름…) · 5 MARK(퀘스트 강조, F6)
 * 모드가 없으면 RPG 서버를 쓸 수 없음(사용자 결정) → 접속 20초 안에 HELLO 가 없으면 안내하고 내보냄(config client.require).
 * 키 매핑: 웹 슬롯 Q · W · E · R = 모드 키 Q · C · Z · R (사용자 지시: "Q키, C키, Z키(기존 E/W), R키(궁극기)").
 */
public final class ClientBridge implements Listener, PluginMessageListener {

    public static final String CHANNEL = "ruc:rpg";
    public static final int VERSION = 2;   // 2 = HUD 미니맵 켬/끔 · 장신구 칸(종류 6)
    private static final Map<String, String> SLOT = Map.of("Q", "Q", "C", "W", "Z", "E", "R", "R");

    private final RucRpg plugin;
    private final Set<UUID> modded = ConcurrentHashMap.newKeySet();
    private final Map<UUID, Integer> lastHud = new ConcurrentHashMap<>();

    public ClientBridge(RucRpg plugin) {
        this.plugin = plugin;
        Bukkit.getMessenger().registerIncomingPluginChannel(plugin, CHANNEL, this);
        Bukkit.getMessenger().registerOutgoingPluginChannel(plugin, CHANNEL);
        Bukkit.getScheduler().runTaskTimer(plugin, this::partyTick, 40L, 40L);
    }

    public boolean modded(Player p) { return modded.contains(p.getUniqueId()); }

    // ── 받기 ────────────────────────────────────────────────────────

    @Override
    public void onPluginMessageReceived(String channel, Player p, byte[] msg) {
        if (!CHANNEL.equals(channel) || msg.length == 0) return;
        try (DataInputStream in = new DataInputStream(new ByteArrayInputStream(msg))) {
            switch (in.readByte()) {
                case 1 -> hello(p, in.readInt());
                case 2 -> key(p, in.readUTF());
                default -> {}
            }
        } catch (IOException e) {
            plugin.getLogger().warning("모드 메시지 읽기 실패 (" + p.getName() + "): " + e.getMessage());
        }
    }

    private void hello(Player p, int version) {
        if (version == VERSION) modded.add(p.getUniqueId());
        send(p, out -> { out.writeByte(1); out.writeInt(VERSION); });
        sendMap(p);
        lastHud.remove(p.getUniqueId());
        if (plugin.accessories() != null) plugin.accessories().send(p);
        if (version != VERSION) {   // 통신 모양이 바뀌면 옛 모드는 HUD 를 잘못 읽음 → 안내하고 내보냄
            String url = plugin.getConfig().getString("client.url", "https://ruc-server.vercel.app/rpg-mod");
            p.kick(Component.text("러크 RPG 모드를 새 판으로 바꿔 주세요 (모드 " + version + " / 서버 " + VERSION + ")
", NamedTextColor.GOLD).append(Component.text(url, NamedTextColor.AQUA)));
            return;
        }
    }

    private void key(Player p, String action) {
        if (!modded(p)) return;
        String[] a = action.split(":", 2);
        String arg = a.length > 1 ? a[1] : "";
        switch (a[0]) {
            case "skill" -> { String slot = SLOT.get(arg); if (slot != null) plugin.skills().castFromKey(p, slot); }
            case "open" -> open(p, arg);
            case "ping" -> plugin.parties().ping(p, arg.isEmpty() ? "gather" : arg);
            case "acc" -> { String[] s = arg.split(":"); if (plugin.accessories() != null) plugin.accessories().click(p, s[0], s.length > 1 && s[1].equals("shift")); }
            default -> {}
        }
    }

    private void open(Player p, String what) {
        if (plugin.runtime().unit(p) == null) return;
        switch (what) {
            case "equip" -> plugin.equipMenu().open(p);
            case "skills" -> plugin.menus().skills(p);
            case "journal" -> plugin.quests().journal(p);
            case "party" -> plugin.windows().party(p);
            case "storage" -> plugin.econGui().storage(p);
            case "social" -> plugin.realm().open(p);
            case "gm" -> plugin.windows().gm(p);
            case "menu" -> plugin.menus().main(p);
            case "settings" -> plugin.windows().settings(p);
            default -> {}
        }
    }

    // ── 보내기 ──────────────────────────────────────────────────────

    public interface Writer { void write(DataOutputStream out) throws IOException; }

    public void send(Player p, Writer w) {
        ByteArrayOutputStream buf = new ByteArrayOutputStream();
        try (DataOutputStream out = new DataOutputStream(buf)) { w.write(out); } catch (IOException e) { return; }
        p.sendPluginMessage(plugin, CHANNEL, buf.toByteArray());
    }

    /** 지금 맵 (미니맵 · 전체 지도 그림) */
    public void sendMap(Player p) {
        String n = p.getWorld().getName();
        String kind = n.startsWith("rpg_dg_") ? "dungeon" : plugin.worlds().kindOf(p.getWorld());
        send(p, out -> { out.writeByte(3); out.writeUTF(kind == null ? "" : kind); });
    }

    /** 파티원 이름 (미니맵에서 초록) */
    public void sendParty(Player p, java.util.List<String> names) {
        if (!modded(p)) return;
        send(p, out -> { out.writeByte(4); out.writeByte(names.size()); for (String s : names) out.writeUTF(s); });
    }

    private final Map<UUID, Integer> lastMarks = new ConcurrentHashMap<>();

    /** 바뀐 때만 (월드를 옮기면 다시 — 모드 쪽 가짜 블록이 월드와 함께 사라지므로) */
    public void sendMarksIfChanged(Player p, java.util.List<int[]> blocks, java.util.List<UUID> entities) {
        StringBuilder sb = new StringBuilder(p.getWorld().getName());
        for (int[] b : blocks) sb.append(b[0]).append(',').append(b[1]).append(',').append(b[2]).append(';');
        for (UUID id : entities) sb.append(id);
        int h = sb.toString().hashCode();
        Integer prev = lastMarks.put(p.getUniqueId(), h);
        if (prev == null || prev != h) sendMarks(p, blocks, entities);
    }

    /** 퀘스트 강조 (F6): 블록 좌표 · 엔티티 UUID 목록 */
    public void sendMarks(Player p, java.util.List<int[]> blocks, java.util.List<UUID> entities) {
        if (!modded(p)) return;
        send(p, out -> {
            out.writeByte(5);
            out.writeShort(blocks.size());
            for (int[] b : blocks) { out.writeInt(b[0]); out.writeInt(b[1]); out.writeInt(b[2]); }
            out.writeShort(entities.size());
            for (UUID id : entities) { out.writeLong(id.getMostSignificantBits()); out.writeLong(id.getLeastSignificantBits()); }
        });
    }

    private static final String[] STAT_ROWS = {"attack", "spell", "pdef", "mdef", "attack_speed", "move_speed", "crit", "luck"};

    /** HUD 상태 (Hud.draw 가 모드 사용자에게 액션바 대신 부름). 바뀐 것이 없으면 안 보냄 */
    public void sendHud(PlayerUnit u, long now, String toast) {
        Player p = u.player;
        EffectDefs defs = plugin.combat().defs();
        StringBuilder sig = new StringBuilder();
        ByteArrayOutputStream buf = new ByteArrayOutputStream();
        try (DataOutputStream out = new DataOutputStream(buf)) {
            out.writeByte(2);
            String res = resource(u);
            out.writeUTF(res);
            out.writeFloat((float) u.mp); out.writeFloat((float) u.st.get("mana"));
            out.writeFloat((float) u.en); out.writeFloat((float) u.st.get("energy"));
            out.writeFloat((float) u.stamina); out.writeFloat((float) u.st.get("stamina"));
            out.writeBoolean(u.exhausted);
            sig.append(res).append((int) u.mp).append('/').append((int) u.en).append('/').append((int) u.stamina).append(u.exhausted);
            String[][] keys = {{"Q", "Q"}, {"W", "C"}, {"E", "Z"}, {"R", "R"}};
            out.writeByte(keys.length);
            for (String[] k : keys) {
                String id = Progression.slotSkill(u.ch, k[0]);
                long left = id == null ? 0 : Math.max(0, u.cd.getOrDefault(id, 0L) - now);
                boolean noRes = id != null && !plugin.skills().affordable(u, id);
                out.writeUTF(k[1]);
                out.writeUTF(id == null ? "" : "skill/" + id);
                out.writeInt((int) left);
                out.writeInt(id == null ? 0 : (int) plugin.skills().cooldownOf(u, id));
                out.writeBoolean(noRes);
                sig.append(id).append(left / 100).append(noRes);
            }
            java.util.List<Unit.Effect> fx = u.fx.stream().filter(e -> defs.get(e.id) != null).limit(12).toList();
            out.writeByte(fx.size());
            for (Unit.Effect e : fx) {
                out.writeUTF("effect/" + e.id);
                out.writeInt((int) Math.max(0, e.until - now));
                out.writeByte(Math.min(127, e.stacks));
                out.writeBoolean(defs.get(e.id).buff());
                sig.append(e.id).append((e.until - now) / 1000).append(e.stacks);
            }
            out.writeByte(STAT_ROWS.length);
            for (String r : STAT_ROWS) { String v = statText(u, r); out.writeUTF(v); sig.append(v); }
            out.writeBoolean(u.showStats);
            out.writeBoolean(plugin.windows() == null || plugin.windows().prefs(p.getUniqueId()).minimap());
            out.writeUTF(toast == null ? "" : toast);
            sig.append(u.showStats).append(toast);
        } catch (IOException e) { return; }
        int h = sig.toString().hashCode();
        Integer prev = lastHud.put(p.getUniqueId(), h);
        if (prev != null && prev == h) return;
        p.sendPluginMessage(plugin, CHANNEL, buf.toByteArray());
    }

    /** 웹 CombatHud statRows 와 같은 모양: 소수 한 자리(.0 은 뺌), 치명은 % */
    static String statText(PlayerUnit u, String row) {
        String k = switch (row) { case "attack" -> "atk"; case "spell" -> "ap"; case "attack_speed" -> "atkSpeed"; case "move_speed" -> "moveSpeed"; default -> row; };
        double v = u.st.get(k);
        if (row.equals("crit")) return Math.round(v * 100) + "%";
        double r = Math.round(v * 10) / 10.0;
        return r == Math.floor(r) ? String.valueOf((long) r) : String.valueOf(r);
    }

    /** 파티원 이름을 2초마다 (바뀐 때만) — 미니맵 · 지도에서 초록 */
    private final Map<UUID, String> lastParty = new ConcurrentHashMap<>();

    private void partyTick() {
        for (Player p : Bukkit.getOnlinePlayers()) {
            if (!modded(p)) continue;
            var party = plugin.parties().of(p);
            java.util.List<String> names = new java.util.ArrayList<>();
            if (party != null) for (UUID id : party.members) { Player m = Bukkit.getPlayer(id); if (m != null && m != p) names.add(m.getName()); }
            String key = String.join(",", names);
            if (key.equals(lastParty.put(p.getUniqueId(), key))) continue;
            sendParty(p, names);
        }
    }

    /** 이 직업이 쓰는 자원 (웹: 안 쓰는 구슬은 회색) — mana · energy · both */
    private String resource(PlayerUnit u) {
        if (u.ch.line == null) return "both";
        JsonElement jl = plugin.data().get("jobs.LINES." + u.ch.line + ".res");
        JsonElement jk = u.ch.job == null ? null : plugin.data().get("jobs.JOBS." + u.ch.job + ".kind");
        String kind = jk == null ? null : jk.getAsString();
        return "magic".equals(kind) ? "mana" : "hybrid".equals(kind) ? "both" : jl == null ? "both" : jl.getAsString();
    }

    // ── 접속 · 모드 필수 ────────────────────────────────────────────

    @EventHandler
    public void onJoin(PlayerJoinEvent e) {
        Player p = e.getPlayer();
        if (!plugin.getConfig().getBoolean("client.require", true)) return;
        Bukkit.getScheduler().runTaskLater(plugin, () -> {
            if (!p.isOnline() || modded(p) || p.hasPermission("rucrpg.nomod")) return;
            String url = plugin.getConfig().getString("client.url", "https://ruc-server.vercel.app/rpg-mod");
            p.kick(Component.text("러크 RPG 는 전용 클라이언트 모드가 필요합니다.\n\n", NamedTextColor.GOLD)
                    .append(Component.text("Fabric 1.21.11 + Fabric API + 러크 RPG 모드를 설치해 주세요\n", NamedTextColor.WHITE))
                    .append(Component.text(url, NamedTextColor.AQUA)));
        }, 20L * plugin.getConfig().getInt("client.grace-seconds", 20));
    }

    @EventHandler
    public void onWorld(PlayerChangedWorldEvent e) { if (modded(e.getPlayer())) { sendMap(e.getPlayer()); lastMarks.remove(e.getPlayer().getUniqueId()); } }

    @EventHandler
    public void onQuit(PlayerQuitEvent e) { modded.remove(e.getPlayer().getUniqueId()); lastHud.remove(e.getPlayer().getUniqueId()); lastParty.remove(e.getPlayer().getUniqueId()); lastMarks.remove(e.getPlayer().getUniqueId()); }

}
