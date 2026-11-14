package kr.rucserver.rpg.hud;

import kr.rucserver.rpg.character.PlayerUnit;
import net.kyori.adventure.text.Component;
import net.kyori.adventure.text.TextComponent;
import net.kyori.adventure.text.format.NamedTextColor;
import net.kyori.adventure.text.format.TextColor;

import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;

/**
 * 하단 HUD (계획서 4장) — 액션바 한 줄. 내용이 바뀌면 바로(최대 4Hz), 안 바뀌어도 1초마다 다시 보냄(액션바는 3초 뒤 사라지므로).
 * 지금은 글자판(리소스팩 없이도 읽힘). Codex 의 hud-glyphs.json 이 들어오면 글리프 조립(GlyphHud)으로 바뀜.
 */
public class Hud {

    private record Sent(String key, long at) {}

    private final Map<UUID, Sent> last = new ConcurrentHashMap<>();
    /** 짧은 안내 (스킬 실패 이유 · 습득 알림) — HUD 줄 맨 앞에 1.6초 */
    private final Map<UUID, Sent> toasts = new ConcurrentHashMap<>();

    public void toast(org.bukkit.entity.Player p, String text) {
        toasts.put(p.getUniqueId(), new Sent(text, System.currentTimeMillis() + 1600));
        last.remove(p.getUniqueId());   // 바로 다시 그림
    }

    protected String toastOf(UUID id, long now) {
        Sent t = toasts.get(id);
        if (t == null) return null;
        if (now > t.at) { toasts.remove(id); return null; }
        return t.key;
    }

    public final void draw(PlayerUnit u, long now) {
        Component c = compose(u, now);
        String key = c.toString();
        Sent s = last.get(u.player.getUniqueId());
        if (s != null && (s.key.equals(key) ? now - s.at < 1000 : now - s.at < 250)) return;
        u.player.sendActionBar(c);
        last.put(u.player.getUniqueId(), new Sent(key, now));
    }

    public void forget(UUID id) { last.remove(id); toasts.remove(id); }

    protected Component compose(PlayerUnit u, long now) {
        TextComponent.Builder b = Component.text();
        String toast = toastOf(u.player.getUniqueId(), now);
        if (toast != null) return Component.text(toast, TextColor.color(0xFFD27A));
        bar(b, "❤", u.hp, u.st.get("hp"), TextColor.color(0x4CC764));
        b.append(Component.text("  "));
        bar(b, "👣", u.stamina, u.st.get("stamina"), u.exhausted ? NamedTextColor.RED : TextColor.color(0xC9A27A));
        b.append(Component.text("  "));
        bar(b, "◆", u.mp, u.st.get("mana"), TextColor.color(0x2F7BFF));
        b.append(Component.text("  "));
        bar(b, "✦", u.en, u.st.get("energy"), TextColor.color(0xFF8A1F));
        // 스킬 쿨 (글리프 HUD 전 임시): Q ⇧Q F ⇧우
        String[][] keys = {{"Q", "Q"}, {"W", "⇧Q"}, {"E", "F"}, {"R", "⇧우"}};
        for (String[] k : keys) {
            String id = kr.rucserver.rpg.skill.Progression.slotSkill(u.ch, k[0]);
            if (id == null) continue;
            long left = u.cd.getOrDefault(id, 0L) - now;
            b.append(Component.text("  " + k[1] + (left > 0 ? " " + (left / 100) / 10.0 : " ●"), left > 0 ? NamedTextColor.DARK_GRAY : NamedTextColor.YELLOW));
        }
        return b.build();
    }

    private static void bar(TextComponent.Builder b, String icon, double cur, double max, TextColor color) {
        b.append(Component.text(icon + " ", color)).append(Component.text((long) Math.floor(cur) + "/" + Math.round(max), NamedTextColor.WHITE));
    }
}
