package kr.rucserver.rpgclient;

import net.minecraft.client.Minecraft;
import net.minecraft.client.gui.GuiGraphics;
import net.minecraft.client.gui.screens.Screen;
import net.minecraft.client.renderer.RenderPipelines;
import net.minecraft.network.chat.Component;
import net.minecraft.world.entity.player.Player;

/** 전체 지도 (웹 M 키): 지금 맵 전체 + 나(삼각형) · 파티원(초록 테두리 머리) · 다른 사람(파랑). M 또는 Esc 로 닫음. */
public final class MapScreen extends Screen {

    private static final java.util.Map<String, String> NAMES = java.util.Map.of("plaza", "햇살광장 솔라스", "field", "햇살 초원", "highland", "황혼 고원", "arena", "결투장", "dungeon", "고목의 유적");

    public MapScreen() { super(Component.literal("지도")); }

    @Override
    public void render(GuiGraphics g, int mouseX, int mouseY, float delta) {
        super.render(g, mouseX, mouseY, delta);
        Minecraft mc = Minecraft.getInstance();
        int[] size = RpgHud.MAPS.get(RpgState.map);
        if (size == null || mc.player == null) return;
        int pad = RpgHud.PAD, ww = size[0] - pad * 2, wh = size[1] - pad * 2;
        float scale = Math.max(1, Math.min((width - 40f) / ww, (height - 50f) / wh));
        int dw = Math.round(ww * scale), dh = Math.round(wh * scale), x0 = (width - dw) / 2, y0 = (height - dh) / 2 + 6;
        g.fill(x0 - 4, y0 - 4, x0 + dw + 4, y0 + dh + 4, 0xFF5A3A22);
        g.fill(x0 - 2, y0 - 2, x0 + dw + 2, y0 + dh + 2, 0xFF2A1E14);
        g.blit(RenderPipelines.GUI_TEXTURED, RpgHud.mapTex(RpgState.map), x0, y0, pad, pad, dw, dh, ww, wh, size[0], size[1]);
        g.drawCenteredString(font, NAMES.getOrDefault(RpgState.map, RpgState.map), width / 2, y0 - 16, 0xFFF2C94C);
        for (Player o : mc.level.players()) {
            if (o == mc.player || o.isSpectator()) continue;
            int px = Math.round(x0 + (float) (o.getX() / 2) * scale), pz = Math.round(y0 + (float) (o.getZ() / 2) * scale);
            RpgHud.head(g, mc, o, px - 4, pz - 4, 8, RpgState.party.contains(o.getGameProfile().name()) ? 0xFF55E05A : 0xFF3A6FD8);
        }
        RpgHud.me(g, mc, Math.round(x0 + (float) (mc.player.getX() / 2) * scale), Math.round(y0 + (float) (mc.player.getZ() / 2) * scale), 9);
        g.drawCenteredString(font, "M / Esc 닫기", width / 2, y0 + dh + 8, 0xFFB0A090);
    }

    @Override
    public boolean isPauseScreen() { return false; }

    @Override
    public boolean keyPressed(net.minecraft.client.input.KeyEvent e) {
        if (RucRpgClient.mapKey().matches(e)) { onClose(); return true; }
        return super.keyPressed(e);
    }
}
