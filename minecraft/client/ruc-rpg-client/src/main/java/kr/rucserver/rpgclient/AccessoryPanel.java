package kr.rucserver.rpgclient;

import com.google.gson.JsonParser;
import com.mojang.serialization.JsonOps;
import kr.rucserver.rpgclient.mixin.ContainerScreenAccessor;
import net.fabricmc.fabric.api.client.screen.v1.ScreenEvents;
import net.fabricmc.fabric.api.client.screen.v1.ScreenMouseEvents;
import net.minecraft.ChatFormatting;
import net.minecraft.client.Minecraft;
import net.minecraft.client.gui.GuiGraphics;
import net.minecraft.client.gui.screens.inventory.InventoryScreen;
import net.minecraft.core.component.DataComponents;
import net.minecraft.network.chat.Component;
import net.minecraft.network.chat.ComponentSerialization;
import net.minecraft.resources.Identifier;
import net.minecraft.world.item.ItemStack;
import net.minecraft.world.item.Items;
import org.lwjgl.glfw.GLFW;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;

/**
 * 장신구 칸 (사용자 지시 2026-11-15 2차): E 인벤토리 화면의 방패(왼손) 칸 바로 위에 보호구 칸처럼 세로 5칸 —
 * 위에서 목걸이 · 귀걸이 · 반지 · 장갑 · 망토. 위 두 칸은 창 위로 튀어나온 판에. 칸 내용은 서버가 보냄(종류 6), 누르면 서버가 커서와 맞바꿈.
 */
final class AccessoryPanel {

    record Slot(String key, String model, String name, List<String> lore) {}

    static final List<Slot> slots = new ArrayList<>();
    // 사용자 지시 2026-11-16: 반지 · 목걸이 하나씩만 — 2칸이면 창 안(플레이어 그림과 제작 칸 사이)에 들어가 창이 튀어나오지 않음
    private static final String[] ORDER = {"necklace", "ring1"};
    private static final String[] NAMES = {"목걸이", "반지"};
    private static final Map<String, ItemStack> ICONS = new HashMap<>();

    static void register() {
        ScreenEvents.AFTER_INIT.register((mc, screen, w, h) -> {
            if (!(screen instanceof InventoryScreen inv)) return;
            ScreenEvents.afterRender(screen).register((s, g, mx, my, dt) -> { if (RpgState.active) render(inv, g, mx, my); });
            ScreenMouseEvents.allowMouseClick(screen).register((s, e) -> !(RpgState.active && click(inv, e.x(), e.y(), (e.modifiers() & GLFW.GLFW_MOD_SHIFT) != 0)));
        });
    }

    /** 칸 i 의 왼쪽 위 (방패 칸 상자 = 76,61 → 그 위로 18 씩) */
    private static int[] box(InventoryScreen inv, int i) {
        ContainerScreenAccessor a = (ContainerScreenAccessor) inv;
        return new int[]{a.ruc$left() + 76, a.ruc$top() + 61 - 18 * (ORDER.length - i)};
    }

    private static ItemStack stack(String model) {
        return ICONS.computeIfAbsent(model, m -> { ItemStack s = new ItemStack(Items.PAPER); s.set(DataComponents.ITEM_MODEL, Identifier.parse(m)); return s; });
    }

    private static Slot find(String key) { for (Slot s : slots) if (s.key().equals(key)) return s; return null; }

    private static void render(InventoryScreen inv, GuiGraphics g, int mx, int my) {
        Minecraft mc = Minecraft.getInstance();
        int[] top = box(inv, 0);
        int pt = top[1] - 4, pb = ((ContainerScreenAccessor) inv).ruc$top() + 4;
        if (pt < pb) {   // 창 위로 나온 판 (바닐라 창 색)
            g.fill(top[0] - 4, pt, top[0] + 22, pb, 0xFF000000);
            g.fill(top[0] - 3, pt + 1, top[0] + 21, pb, 0xFFC6C6C6);
            g.fill(top[0] - 3, pt + 1, top[0] + 21, pt + 2, 0xFFFFFFFF);
        }
        for (int i = 0; i < ORDER.length; i++) {
            int[] b = box(inv, i);
            g.fill(b[0], b[1], b[0] + 18, b[1] + 18, 0xFF373737);
            g.fill(b[0] + 1, b[1] + 1, b[0] + 18, b[1] + 18, 0xFFFFFFFF);
            g.fill(b[0] + 1, b[1] + 1, b[0] + 17, b[1] + 17, 0xFF8B8B8B);
            Slot s = find(ORDER[i]);
            boolean filled = s != null && !s.model().isEmpty();
            g.renderItem(stack(filled ? s.model() : "ruc:ui/slot_" + ORDER[i]), b[0] + 1, b[1] + 1);
            if (mx >= b[0] && mx < b[0] + 18 && my >= b[1] && my < b[1] + 18) {
                g.fill(b[0] + 1, b[1] + 1, b[0] + 17, b[1] + 17, 0x80FFFFFF);
                List<Component> tip = new ArrayList<>();
                if (filled) { tip.add(json(mc, s.name())); for (String l : s.lore()) tip.add(json(mc, l)); }
                else tip.add(Component.literal(NAMES[i] + " 칸 — 들고 누르면 장착").withStyle(ChatFormatting.GRAY));
                g.setTooltipForNextFrame(mc.font, tip, Optional.empty(), mx, my);
            }
        }
    }

    private static Component json(Minecraft mc, String s) {
        try {
            return ComponentSerialization.CODEC.parse(mc.level.registryAccess().createSerializationContext(JsonOps.INSTANCE), JsonParser.parseString(s)).result().orElse(Component.literal(s));
        } catch (Exception e) { return Component.literal(s); }
    }

    private static boolean click(InventoryScreen inv, double mx, double my, boolean shift) {
        for (int i = 0; i < ORDER.length; i++) {
            int[] b = box(inv, i);
            if (mx >= b[0] && mx < b[0] + 18 && my >= b[1] && my < b[1] + 18) {
                String key = ORDER[i];
                RucRpgClient.send(out -> { out.writeByte(2); out.writeUTF("acc:" + key + (shift ? ":shift" : "")); });
                return true;
            }
        }
        return false;
    }
}
