package kr.rucserver.rpg.ui;

import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import kr.rucserver.rpg.RucRpg;
import kr.rucserver.rpg.character.PlayerUnit;
import kr.rucserver.rpg.character.RpgChar;
import kr.rucserver.rpg.engine.Formulas;
import kr.rucserver.rpg.engine.Stats;
import kr.rucserver.rpg.skill.Progression;
import kr.rucserver.rpg.skill.SkillDefs;
import net.kyori.adventure.text.Component;
import net.kyori.adventure.text.format.NamedTextColor;
import net.kyori.adventure.text.format.TextColor;
import net.kyori.adventure.text.format.TextDecoration;
import org.bukkit.Material;
import org.bukkit.Sound;
import org.bukkit.entity.Player;
import org.bukkit.event.inventory.ClickType;
import org.bukkit.inventory.ItemStack;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;

/**
 * RPG 창들 (웹: 메뉴 · 스킬창 K · 스탯창 · 전직 · 설정). 마크엔 V · K · J · P · M · B 키가 없으므로 /창 (= /rpg) · /스킬 · /스탯 · /전직 으로 엶.
 * 인벤토리 · 장비(M4) · 퀘스트(M6) · 파티(M7) · 지도(M9) · 창고(M5)는 단계가 끝나면 이 메뉴에 붙음.
 */
public final class RpgMenus {

    private static final String[][] SLOT_KEYS = {{"Q", "Q"}, {"W", "웅크리고 Q"}, {"E", "F"}, {"R", "웅크리고 우클릭"}};

    private final RucRpg plugin;
    private final JsonObject lines, jobs, awakenName, elements;

    public RpgMenus(RucRpg plugin) {
        this.plugin = plugin;
        JsonObject j = plugin.data().file("jobs");
        lines = j.getAsJsonObject("LINES");
        jobs = j.getAsJsonObject("JOBS");
        awakenName = j.getAsJsonObject("AWAKEN_NAME");
        elements = plugin.data().file("elements").getAsJsonObject("ELEMENTS");
    }

    private static TextColor hex(String h) { return TextColor.fromHexString(h); }

    private PlayerUnit unit(Player p) { return plugin.runtime().unit(p); }

    public String jobName(RpgChar c) {
        if (c.job != null) return jobs.getAsJsonObject(c.job).get("name").getAsString();
        if (c.line != null) return lines.getAsJsonObject(c.line).get("name").getAsString();
        return "견습 모험가";
    }

    // ── 메인 메뉴 ───────────────────────────────────────────────────

    public void main(Player p) {
        PlayerUnit u = unit(p);
        if (u == null) return;
        RpgChar c = u.ch;
        Gui g = new Gui(3, Component.text("러크 RPG 메뉴", NamedTextColor.DARK_GRAY));
        for (int i = 0; i < 27; i++) g.set(i, Gui.filler(), null);
        g.set(4, Gui.icon(Material.PLAYER_HEAD, "element/" + c.element,
                Component.text(p.getName() + "  Lv." + c.level, NamedTextColor.GOLD, TextDecoration.BOLD),
                List.of(Gui.gray("직업: " + jobName(c)), Gui.gray("주 속성: " + elements.getAsJsonObject(c.element).get("name").getAsString()),
                        Gui.gray("경험치: " + c.exp + " / " + Formulas.expToNext(c.level)))), null);
        g.set(10, Gui.button("스킬 (K)", false, List.of(Gui.gray("배운 스킬 · 슬롯 장착 · 숙련도"))), (pl, t) -> skills(pl));
        g.set(11, Gui.button("스탯", false, List.of(Gui.gray("모든 스탯 · 보조 스탯 · 속성 방어"))), (pl, t) -> stats(pl));
        boolean canAdvance = canAdvance(c);
        g.set(12, Gui.button("전직", canAdvance, List.of(Gui.gray(canAdvance ? "지금 전직할 수 있습니다!" : "Lv10 1차 · Lv30 2차 · Lv60 각성"))), (pl, t) -> job(pl));
        g.set(13, Gui.button("인벤토리 · 장비 (V)", false, List.of(Gui.gray("준비 중 (M4)"))), null);
        g.set(14, Gui.button("퀘스트 (J)", false, List.of(Gui.gray("준비 중 (M6)"))), null);
        g.set(15, Gui.button("파티 (P)", false, List.of(Gui.gray("준비 중 (M7)"))), null);
        g.set(16, Gui.button("지도 (M)", false, List.of(Gui.gray("준비 중 (M9)"))), null);
        g.set(22, Gui.button("조작법", false, List.of(
                Gui.gray("좌클릭 = 평타"), Gui.gray("Q = Q 스킬 · 웅크리고 Q = C 스킬"), Gui.gray("F = E 스킬 · 웅크리고 우클릭 = 궁극기"),
                Gui.gray("공중에서 Space = 구르기 · 달리기 = 스태미나"), Gui.gray("웅크리고 F = 러크 메뉴 (기존)"))), null);
        g.open(p);
    }

    private boolean canAdvance(RpgChar c) {
        return (c.line == null && c.level >= 10) || (c.line != null && c.job == null && c.level >= 30) || (c.job != null && !c.awake && c.level >= 60);
    }

    // ── 스킬창 (K) ──────────────────────────────────────────────────

    private List<Component> skillLore(RpgChar c, String id, RpgChar.Learned l, PlayerUnit u) {
        SkillDefs defs = plugin.progression().defs();
        JsonObject sk = defs.get(id);
        SkillDefs.Nums n = defs.nums(sk, l == null ? "low" : l.grade(), l == null ? 1 : l.lv(), u.st.get("cdr"));
        List<Component> lore = new ArrayList<>();
        String grade = switch (l == null ? "low" : l.grade()) { case "mid" -> "중급"; case "high" -> "상급"; case "trans" -> "초월급"; default -> "하급"; };
        lore.add(Gui.line(grade + " · " + slotName(sk.get("slot").getAsString()), NamedTextColor.YELLOW));
        if (l != null) {
            long need = Formulas.needMastery(l.lv());
            lore.add(Gui.line("Lv." + l.lv() + "  숙련도 " + (long) l.mastery() + " / " + need, NamedTextColor.AQUA));
        }
        String cost = (n.mana() > 0 ? "마나 " + (long) n.mana() + "  " : "") + (n.energy() > 0 ? "기력 " + (long) n.energy() + "  " : "") + (n.stamina() > 0 ? "스태미나 " + (long) n.stamina() : "");
        if (!cost.isBlank()) lore.add(Gui.gray("소모: " + cost.trim()));
        lore.add(Gui.gray("쿨타임: " + Math.round(n.cooldownMs() / 100) / 10.0 + "초  ·  사거리: " + Math.round(n.range() / 16 * 10) / 10.0 + "칸"));
        for (String part : wrap(sk.get("desc").getAsString(), 26)) lore.add(Gui.line(part, NamedTextColor.WHITE));
        return lore;
    }

    private static String slotName(String s) {
        for (String[] k : SLOT_KEYS) if (k[0].equals(s)) return k[0].equals("W") ? "C 슬롯 (" + k[1] + ")" : k[0] + " 슬롯 (" + k[1] + ")";
        return s.equals("A") ? "평타" : s;
    }

    private static List<String> wrap(String s, int w) {
        List<String> out = new ArrayList<>();
        StringBuilder line = new StringBuilder();
        for (String word : s.split(" ")) {
            if (line.length() + word.length() > w && line.length() > 0) { out.add(line.toString()); line.setLength(0); }
            if (line.length() > 0) line.append(' ');
            line.append(word);
        }
        if (line.length() > 0) out.add(line.toString());
        return out;
    }

    private ItemStack skillIcon(String id, Component name, List<Component> lore) {
        return Gui.icon(Material.ENCHANTED_BOOK, "skill/" + id, name, lore);
    }

    public void skills(Player p) {
        PlayerUnit u = unit(p);
        if (u == null) return;
        RpgChar c = u.ch;
        SkillDefs defs = plugin.progression().defs();
        Gui g = new Gui(6, Component.text("스킬 — " + jobName(c), NamedTextColor.DARK_GRAY));
        g.onBack = () -> main(p);
        for (int i = 0; i < 54; i++) g.set(i, Gui.filler(), null);
        g.set(0, Gui.icon(Material.BOOK, c.line == null ? null : "line/" + c.line, Component.text(jobName(c), NamedTextColor.GOLD, TextDecoration.BOLD),
                List.of(Gui.gray("물리 잠재력 " + c.potPhys + " · 마법 잠재력 " + c.potMag), Gui.gray("잠재력이 높을수록 숙련도가 빨리 오르고"), Gui.gray("새 스킬의 시작 레벨이 높습니다"))), null);
        if (canAdvance(c)) g.set(8, Gui.button("전직하기", true, List.of(Gui.gray("지금 전직할 수 있습니다"))), (pl, t) -> job(pl));
        // 장착 슬롯 줄
        int[] slotPos = {2, 3, 5, 6};
        for (int i = 0; i < 4; i++) {
            String slot = SLOT_KEYS[i][0];
            String id = Progression.slotSkill(c, slot);
            if (id == null) {
                g.set(slotPos[i], Gui.icon(Material.GRAY_STAINED_GLASS_PANE, "ui/lock", Component.text(slotName(slot) + " — 비어 있음", NamedTextColor.GRAY),
                        List.of(Gui.gray(slot.equals("R") ? "궁극기는 1차 전직(Lv10) 후 열립니다" : "아래에서 스킬을 눌러 넣으세요"))), null);
                continue;
            }
            RpgChar.Learned l = Progression.learned(c, id);
            List<Component> lore = skillLore(c, id, l, u);
            lore.add(Component.empty());
            lore.add(Gui.line("우클릭: 슬롯에서 빼기", NamedTextColor.RED));
            g.set(slotPos[i], skillIcon(id, Component.text("[" + slotName(slot) + "] " + defs.get(id).get("name").getAsString(), NamedTextColor.GREEN, TextDecoration.BOLD), lore),
                    (pl, t) -> { if (t == ClickType.RIGHT) equip(pl, id, null); });
        }
        // 패시브 (2차 전직)
        if (c.job != null) {
            JsonObject pas = jobs.getAsJsonObject(c.job).getAsJsonObject("passive");
            g.set(4, Gui.icon(Material.NETHER_STAR, "job/" + c.job, Component.text("[패시브] " + pas.get("name").getAsString(), NamedTextColor.LIGHT_PURPLE, TextDecoration.BOLD),
                    wrap(pas.get("desc").getAsString(), 26).stream().map(s -> Gui.line(s, NamedTextColor.WHITE)).toList()), null);
        }
        // 배운 스킬 목록 (슬롯 순서)
        List<RpgChar.Learned> list = new ArrayList<>(c.skills);
        list.sort((a, b) -> ("QWER".indexOf(defs.get(a.id()).get("slot").getAsString())) - ("QWER".indexOf(defs.get(b.id()).get("slot").getAsString())));
        int pos = 18;
        for (RpgChar.Learned l : list) {
            if (pos >= 54) break;
            String id = l.id();
            JsonObject sk = defs.get(id);
            boolean on = l.slot() != null;
            List<Component> lore = skillLore(c, id, l, u);
            lore.add(Component.empty());
            lore.add(Gui.line(on ? "장착됨" : "클릭: " + slotName(sk.get("slot").getAsString()) + "에 장착", on ? NamedTextColor.GREEN : NamedTextColor.YELLOW));
            g.set(pos++, skillIcon(id, Component.text(sk.get("name").getAsString(), on ? NamedTextColor.GREEN : NamedTextColor.WHITE, TextDecoration.BOLD), lore),
                    on ? null : (pl, t) -> equip(pl, id, sk.get("slot").getAsString()));
        }
        g.open(p);
    }

    private void equip(Player p, String id, String slot) {
        PlayerUnit u = unit(p);
        if (u == null) return;
        String err = plugin.progression().equip(u, id, slot, u.inCombat(System.currentTimeMillis(), plugin.formulas()));
        if (err != null) { p.sendMessage(Component.text(err, NamedTextColor.RED)); p.playSound(p.getLocation(), Sound.ENTITY_VILLAGER_NO, 0.6f, 1f); }
        else plugin.chars().saveAsync(u.ch);
        skills(p);
    }

    // ── 전직 ────────────────────────────────────────────────────────

    public void job(Player p) {
        PlayerUnit u = unit(p);
        if (u == null) return;
        RpgChar c = u.ch;
        Gui g = new Gui(4, Component.text("전직", NamedTextColor.DARK_GRAY));
        g.onBack = () -> main(p);
        for (int i = 0; i < 36; i++) g.set(i, Gui.filler(), null);
        if (c.line == null) {
            if (c.level < 10) { g.set(13, Gui.button("1차 전직은 Lv10 부터", false, List.of(Gui.gray("지금 Lv." + c.level))), null); g.open(p); return; }
            int pos = 10;
            for (Map.Entry<String, JsonElement> e : lines.entrySet()) {
                JsonObject l = e.getValue().getAsJsonObject();
                String id = e.getKey();
                List<Component> lore = new ArrayList<>();
                lore.add(Gui.line(l.get("role").getAsString(), NamedTextColor.WHITE));
                lore.add(Gui.gray("주 자원: " + ("mana".equals(l.get("res").getAsString()) ? "마나" : "기력") + " · 사거리: " + l.get("reach").getAsString()));
                JsonObject gr = l.getAsJsonObject("g");
                lore.add(Gui.gray("체력 " + gr.get("hp").getAsString() + " · 방어 " + gr.get("def").getAsString() + " · 공격력 " + gr.get("atk").getAsString()
                        + " · 주문력 " + gr.get("ap").getAsString() + " · 이속 " + gr.get("moveSpeed").getAsString()));
                lore.add(Component.empty());
                lore.add(Gui.line("클릭: 이 계열로 1차 전직 (되돌릴 수 없음)", NamedTextColor.YELLOW));
                g.set(pos++, Gui.icon(Material.IRON_SWORD, "line/" + id, Component.text(l.get("name").getAsString(), hex(l.get("color").getAsString()), TextDecoration.BOLD), lore),
                        (pl, t) -> apply(pl, plugin.progression().changeLine(unit(pl), id), l.get("name").getAsString()));
                if (pos == 13) pos = 14;
            }
        } else if (c.job == null) {
            if (c.level < 30) { g.set(13, Gui.button("2차 전직은 Lv30 부터", false, List.of(Gui.gray("지금 Lv." + c.level))), null); g.open(p); return; }
            int pos = 10;
            for (Map.Entry<String, JsonElement> e : jobs.entrySet()) {
                JsonObject j = e.getValue().getAsJsonObject();
                if (!c.line.equals(j.get("line").getAsString())) continue;
                String id = e.getKey();
                List<Component> lore = new ArrayList<>();
                lore.add(Gui.line(j.get("concept").getAsString(), NamedTextColor.WHITE));
                JsonObject pas = j.getAsJsonObject("passive");
                lore.add(Gui.line("패시브 「" + pas.get("name").getAsString() + "」", NamedTextColor.LIGHT_PURPLE));
                for (String s : wrap(pas.get("desc").getAsString(), 26)) lore.add(Gui.gray(s));
                if (j.has("kind")) lore.add(Gui.line("magic".equals(j.get("kind").getAsString()) ? "마법형 — 주문력 · 마나" : "혼합형 — 공격력 + 주문력", NamedTextColor.AQUA));
                lore.add(Component.empty());
                lore.add(Gui.line("클릭: 이 직업으로 2차 전직 (되돌릴 수 없음)", NamedTextColor.YELLOW));
                g.set(pos++, Gui.icon(Material.DIAMOND_SWORD, "job/" + id, Component.text(j.get("name").getAsString(), NamedTextColor.GOLD, TextDecoration.BOLD), lore),
                        (pl, t) -> { if (id.equals("elementalist")) subElement(pl); else apply(pl, plugin.progression().changeJob(unit(pl), id, null), j.get("name").getAsString()); });
            }
        } else if (!c.awake) {
            boolean ok = c.level >= 60;
            g.set(13, Gui.button(ok ? awakenName.get(c.line).getAsString() : "3차 각성은 Lv60 부터", ok, List.of(Gui.gray("기본 스탯 +10% · 전용 궁극기 피해/치유 +50% · 쿨 −25%"))),
                    ok ? (pl, t) -> apply(pl, plugin.progression().awaken(unit(pl)), awakenName.get(c.line).getAsString()) : null);
        } else g.set(13, Gui.button("모든 전직을 마쳤습니다", true, List.of()), null);
        g.open(p);
    }

    /** 원소술사: 주 속성과 다른 보조 속성 고르기 */
    private void subElement(Player p) {
        PlayerUnit u = unit(p);
        Gui g = new Gui(3, Component.text("원소술사 — 보조 속성", NamedTextColor.DARK_GRAY));
        g.onBack = () -> job(p);
        int pos = 9;
        for (Map.Entry<String, JsonElement> e : elements.entrySet()) {
            String id = e.getKey();
            if (id.equals(u.ch.element) || id.equals("none")) continue;
            JsonObject el = e.getValue().getAsJsonObject();
            g.set(pos++, Gui.icon(Material.AMETHYST_SHARD, "element/" + id, Component.text(el.get("name").getAsString() + " 속성", hex(el.get("color").getAsString()), TextDecoration.BOLD),
                    List.of(Gui.gray(el.get("passive").getAsString()))), (pl, t) -> apply(pl, plugin.progression().changeJob(unit(pl), "elementalist", id), "원소술사"));
        }
        g.open(p);
    }

    private void apply(Player p, String err, String name) {
        PlayerUnit u = unit(p);
        if (err != null) { p.sendMessage(Component.text(err, NamedTextColor.RED)); p.closeInventory(); return; }
        plugin.runtime().rebuild(u);
        u.hp = u.st.get("hp");
        u.mp = u.st.get("mana");
        u.en = u.st.get("energy");
        u.stamina = u.st.get("stamina");
        plugin.chars().saveAsync(u.ch);
        p.closeInventory();
        p.showTitle(net.kyori.adventure.title.Title.title(Component.text(name, NamedTextColor.GOLD, TextDecoration.BOLD), Component.text("전직 완료!", NamedTextColor.YELLOW)));
        p.getWorld().playSound(p.getLocation(), Sound.UI_TOAST_CHALLENGE_COMPLETE, 1f, 1f);
        p.getWorld().spawnParticle(org.bukkit.Particle.TOTEM_OF_UNDYING, p.getLocation().add(0, 1, 0), 60, 0.5, 1, 0.5, 0.3);
    }

    // ── 스탯창 ──────────────────────────────────────────────────────

    public void stats(Player p) {
        PlayerUnit u = unit(p);
        if (u == null) return;
        Stats s = u.st;
        Gui g = new Gui(3, Component.text("스탯 — Lv." + u.ch.level + " " + jobName(u.ch), NamedTextColor.DARK_GRAY));
        g.onBack = () -> main(p);
        for (int i = 0; i < 27; i++) g.set(i, Gui.filler(), null);
        Object[][] rows = {
                {"체력", "hp", "heart", 0x4CC764}, {"스태미나", "stamina", "foot", 0xC9A27A}, {"마나", "mana", "drop", 0x2F7BFF}, {"기력", "energy", "flame", 0xFF8A1F},
                {"공격력", "atk", "sword", 0xE5484D}, {"주문력", "ap", "star", 0x9B5DE5}, {"공격 속도", "atkSpeed", "bolt", 0xF5C542}, {"이동 속도", "moveSpeed", "wing", 0x3FC8E8},
                {"물리 방어", "pdef", "shield", 0x9AA3AD}, {"마법 방어", "mdef", "ring", 0xB39DDB}, {"정신력", "spirit", "sparkle", 0xFF7EB6}, {"재생력", "regen", "heartPlus", 0x9BE15D},
                {"지구력", "endurance", "clock", 0x8D6E63}, {"운", "luck", "clover", 0x2ECC71}};
        int pos = 0;
        for (Object[] r : rows) {
            double v = s.get((String) r[1]);
            g.set(pos++, Gui.icon(Material.PAPER, "stat/" + r[2], Component.text(r[0] + "  " + Math.round(v * 10) / 10.0, TextColor.color((int) r[3]), TextDecoration.BOLD), List.of()), null);
        }
        String pct = "치명타 " + pctOf(s.get("crit")) + " · 치명 피해 " + pctOf(s.get("critDmg")) + " · 관통 " + pctOf(s.get("penPhys")) + "/" + pctOf(s.get("penMag"));
        String pct2 = "쿨감 " + pctOf(s.get("cdr")) + " · 강인함 " + pctOf(s.get("tenacity")) + " · 흡혈 " + pctOf(s.get("lifesteal")) + "/" + pctOf(s.get("spellVamp"));
        List<Component> el = new ArrayList<>();
        for (var e : s.elDef.entrySet()) if (e.getValue() > 0) el.add(Gui.gray(elements.getAsJsonObject(e.getKey()).get("name").getAsString() + " " + Math.round(e.getValue())));
        g.set(22, Gui.icon(Material.BOOK, "stat/star", Component.text("보조 스탯", NamedTextColor.GOLD, TextDecoration.BOLD),
                java.util.stream.Stream.concat(java.util.stream.Stream.of(Gui.gray(pct), Gui.gray(pct2), Gui.gray("잠재력 물리 " + u.ch.potPhys + " / 마법 " + u.ch.potMag), Gui.line("속성 방어", NamedTextColor.WHITE)),
                        el.isEmpty() ? java.util.stream.Stream.of(Gui.gray("—")) : el.stream()).toList()), null);
        g.open(p);
    }

    private static String pctOf(double v) { return Math.round(v * 100) + "%"; }
}
