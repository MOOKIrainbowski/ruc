package kr.rucserver.rpgclient;

import net.fabricmc.fabric.api.client.rendering.v1.hud.HudElementRegistry;
import net.fabricmc.fabric.api.client.rendering.v1.hud.VanillaHudElements;
import net.minecraft.client.DeltaTracker;
import net.minecraft.client.Minecraft;
import net.minecraft.client.gui.GuiGraphics;
import net.minecraft.client.gui.components.PlayerFaceRenderer;
import net.minecraft.client.multiplayer.PlayerInfo;
import net.minecraft.client.renderer.RenderPipelines;
import net.minecraft.core.component.DataComponents;
import net.minecraft.resources.Identifier;
import net.minecraft.world.entity.player.Player;
import net.minecraft.world.item.ItemStack;
import net.minecraft.world.item.Items;

import java.util.HashMap;
import java.util.Map;

/**
 * HUD (사용자 지시 2026-11-15, docs/13 F2) — 바닐라 화면 위에 같은 크기의 픽셀 아트로:
 *  - 체력 = 바닐라 하트(서버가 체력 비율로 맞춤) 그대로.
 *  - 스태미나 = 바닐라 배고픔 줄 모양(바닐라 배고픔 줄을 이것으로 바꿈, 탈진이면 초록 '허기' 모양).
 *  - 마나 · 기력 = 배고픔 줄 바로 위에 같은 아이콘 줄(Codex 그림), 둘 다 쓰는 직업이면 두 줄.
 *  - 그 위 스킬 칸 4(Q · C · Z · R, 쿨 · 자원 부족 덮개), 그 위 효과 줄.
 *  - 스탯 상세 = 핫바 왼쪽 판 8줄.  미니맵 = 왼쪽 위.
 */
public final class RpgHud {

    private static final String NS = "ruc_rpg";
    private static Identifier tex(String path) { return Identifier.fromNamespaceAndPath(NS, "textures/gui/" + path + ".png"); }
    private static final Identifier FOOD_FULL = Identifier.withDefaultNamespace("hud/food_full"), FOOD_HALF = Identifier.withDefaultNamespace("hud/food_half"),
            FOOD_EMPTY = Identifier.withDefaultNamespace("hud/food_empty"), HUNGER_FULL = Identifier.withDefaultNamespace("hud/food_full_hunger"),
            HUNGER_HALF = Identifier.withDefaultNamespace("hud/food_half_hunger"), HUNGER_EMPTY = Identifier.withDefaultNamespace("hud/food_empty_hunger");
    private static final String[] STAT_ICON = {"atk", "ap", "pdef", "mdef", "atkspeed", "movespeed", "crit", "luck"};
    private static final String[] STAT_NAME = {"공격력", "주문력", "물리 방어", "마법 방어", "공격 속도", "이동 속도", "치명타", "운"};
    /** 맵 그림 크기 (Codex 미니맵 생성기 — 1 타일 = 1 px = 2 블록, 둘레 32 px 여백) */
    static final Map<String, int[]> MAPS = Map.of("plaza", new int[]{160, 160}, "field", new int[]{176, 176}, "highland", new int[]{168, 184},
            "arena", new int[]{148, 108}, "dungeon", new int[]{148, 136});
    static final int PAD = 32;
    private static final Map<String, ItemStack> ICONS = new HashMap<>();

    static void register() {
        HudElementRegistry.replaceElement(VanillaHudElements.FOOD_BAR, old -> (g, dt) -> { if (RpgState.active) stamina(g); else old.render(g, dt); });
        HudElementRegistry.attachElementAfter(VanillaHudElements.HOTBAR, Identifier.fromNamespaceAndPath(NS, "hud"), RpgHud::render);
    }

    /** 리소스팩 모델로 그리는 아이콘 (스킬 · 효과 — 팩의 skill/<id> · effect/<id>) */
    static ItemStack icon(String model) {
        return ICONS.computeIfAbsent(model, m -> {
            ItemStack s = new ItemStack(Items.PAPER);
            s.set(DataComponents.ITEM_MODEL, Identifier.fromNamespaceAndPath("ruc", m));
            return s;
        });
    }

    private static void render(GuiGraphics g, DeltaTracker dt) {
        Minecraft mc = Minecraft.getInstance();
        if (!RpgState.active || mc.player == null || mc.options.hideGui) return;
        int w = g.guiWidth(), h = g.guiHeight();
        int top = resources(g, w, h);
        int skillY = top - 26;
        skills(g, mc, w, skillY);
        effects(g, mc, w, skillY - 20);
        if (RpgState.showStats) stats(g, mc, w, h);
        if (RpgState.showMinimap) minimap(g, mc);
        if (!RpgState.toast.isEmpty()) {   // 스킬 사용 · 습득 알림: HUD 위에 작게 (사용자 지시)
            g.pose().pushMatrix();
            g.pose().translate(w / 2f, skillY - 30);
            g.pose().scale(0.75f, 0.75f);
            g.drawCenteredString(mc.font, RpgState.toast, 0, 0, 0xFFFFD27A);
            g.pose().popMatrix();
        }
    }

    // ── 스태미나 (바닐라 배고픔 자리 · 모양) ─────────────────────────

    private static void stamina(GuiGraphics g) {
        Minecraft mc = Minecraft.getInstance();
        if (mc.player == null || mc.player.isCreative() || mc.player.isSpectator()) return;
        int w = g.guiWidth(), h = g.guiHeight();
        int pts = RpgState.staminaMax <= 0 ? 20 : Math.round(20 * RpgState.stamina / RpgState.staminaMax);
        row(g, w / 2 + 91, h - 39, pts, RpgState.exhausted ? HUNGER_FULL : FOOD_FULL, RpgState.exhausted ? HUNGER_HALF : FOOD_HALF, RpgState.exhausted ? HUNGER_EMPTY : FOOD_EMPTY, true);
    }

    /** 오른쪽에서 왼쪽으로 10칸 (바닐라 배고픔 줄과 같은 배치) */
    private static void row(GuiGraphics g, int right, int y, int pts, Identifier full, Identifier half, Identifier empty, boolean sprite) {
        for (int i = 0; i < 10; i++) {
            int x = right - i * 8 - 9;
            if (sprite) {
                g.blitSprite(RenderPipelines.GUI_TEXTURED, empty, x, y, 9, 9);
                if (i * 2 + 1 < pts) g.blitSprite(RenderPipelines.GUI_TEXTURED, full, x, y, 9, 9);
                else if (i * 2 + 1 == pts) g.blitSprite(RenderPipelines.GUI_TEXTURED, half, x, y, 9, 9);
            } else {
                g.blit(RenderPipelines.GUI_TEXTURED, empty, x, y, 0, 0, 9, 9, 9, 9);
                if (i * 2 + 1 < pts) g.blit(RenderPipelines.GUI_TEXTURED, full, x, y, 0, 0, 9, 9, 9, 9);
                else if (i * 2 + 1 == pts) g.blit(RenderPipelines.GUI_TEXTURED, half, x, y, 0, 0, 9, 9, 9, 9);
            }
        }
    }

    // ── 마나 · 기력 줄 (배고픔 위) ───────────────────────────────────

    /** 반환 = 맨 위 줄의 y (그 위에 스킬 칸) */
    private static int resources(GuiGraphics g, int w, int h) {
        int y = h - 49;
        boolean mana = !RpgState.res.equals("energy"), energy = !RpgState.res.equals("mana");
        if (mana) {
            bottles(g, w / 2 + 91, y, pts(RpgState.mana, RpgState.manaMax));
            y -= 10;
        }
        if (energy) {
            row(g, w / 2 + 91, y, pts(RpgState.energy, RpgState.energyMax), tex("hud/energy_full"), tex("hud/energy_half"), tex("hud/energy_empty"), false);
            y -= 10;
        }
        return Math.min(y + 10, h - 49 - 10);   // 왼쪽 방어구 줄(h-49)보다 위
    }

    private static final ItemStack WATER = net.minecraft.world.item.alchemy.PotionContents.createItemStack(Items.POTION, net.minecraft.world.item.alchemy.Potions.WATER);
    private static final ItemStack BOTTLE = new ItemStack(Items.GLASS_BOTTLE);

    /** 마나 = 바닐라 물병 아이콘 10개 (사용자 지시: 물 병 텍스처). 반 칸 = 빈 병 위에 물병 왼쪽 절반 */
    private static void bottles(GuiGraphics g, int right, int y, int pts) {
        for (int i = 0; i < 10; i++) {
            int x = right - i * 8 - 9;
            boolean full = i * 2 + 1 < pts, half = i * 2 + 1 == pts;
            item(g, full ? WATER : BOTTLE, x, y);
            if (half) { g.enableScissor(x, y - 1, x + 5, y + 10); item(g, WATER, x, y); g.disableScissor(); }
        }
    }

    /** 16px 아이템을 9~10px 칸에 */
    private static void item(GuiGraphics g, ItemStack s, int x, int y) {
        g.pose().pushMatrix();
        g.pose().translate(x - 0.5f, y - 0.5f);
        g.pose().scale(10 / 16f, 10 / 16f);
        g.renderItem(s, 0, 0);
        g.pose().popMatrix();
    }

    private static int pts(float cur, float max) { return max <= 0 ? 0 : Math.round(20 * cur / max); }

    // ── 스킬 칸 ─────────────────────────────────────────────────────

    private static void skills(GuiGraphics g, Minecraft mc, int w, int y) {
        int n = RpgState.skills.size();
        int x0 = w / 2 - (n * 24 - 2) / 2;
        long now = System.currentTimeMillis();
        for (int i = 0; i < n; i++) {
            RpgState.Skill s = RpgState.skills.get(i);
            int x = x0 + i * 24;
            g.blit(RenderPipelines.GUI_TEXTURED, tex("hud/skill_slot"), x, y, 0, 0, 22, 22, 22, 22);
            if (!s.model().isEmpty()) g.renderItem(icon(s.model()), x + 3, y + 3);
            long left = s.cdLeft() - (now - s.at());
            if (left > 0 && s.cdTotal() > 0) {
                int hgt = (int) Math.ceil(18.0 * Math.min(1, (double) left / s.cdTotal()));
                g.blit(RenderPipelines.GUI_TEXTURED, tex("hud/skill_cooldown"), x + 2, y + 2 + 18 - hgt, 0, 18 - hgt, 18, hgt, 18, 18);
                String t = left >= 10000 ? String.valueOf(left / 1000) : String.format("%.1f", left / 1000.0);
                g.drawCenteredString(mc.font, t, x + 11, y + 7, 0xFFFFFFFF);
            } else if (s.noRes()) g.blit(RenderPipelines.GUI_TEXTURED, tex("hud/skill_nores"), x + 2, y + 2, 0, 0, 18, 18, 18, 18);
            g.blit(RenderPipelines.GUI_TEXTURED, tex("hud/key_" + s.key().toLowerCase()), x - 1, y - 1, 0, 0, 7, 7, 7, 7);
        }
    }

    // ── 효과 줄 ─────────────────────────────────────────────────────

    private static void effects(GuiGraphics g, Minecraft mc, int w, int y) {
        int n = RpgState.effects.size();
        if (n == 0) return;
        int x0 = w / 2 - (n * 18 - 2) / 2;
        long now = System.currentTimeMillis();
        for (int i = 0; i < n; i++) {
            RpgState.Effect e = RpgState.effects.get(i);
            int x = x0 + i * 18;
            g.fill(x - 1, y - 1, x + 17, y + 17, e.buff() ? 0x6038A04A : 0x60A03838);
            g.renderItem(icon(e.model()), x, y);
            long left = e.left() - (now - e.at());
            if (left > 0 && left < 100000) g.drawString(mc.font, String.valueOf(left / 1000 + 1), x + 9, y + 9, 0xFFFFFFFF, true);
            if (e.stacks() > 1) g.drawString(mc.font, "×" + e.stacks(), x, y - 7, 0xFFFFE08A, true);
        }
    }

    // ── 스탯 상세 (핫바 왼쪽) ────────────────────────────────────────

    private static void stats(GuiGraphics g, Minecraft mc, int w, int h) {
        if (RpgState.stats.size() < 8) return;
        int pw = 86, ph = 84, x = w / 2 - 91 - 29 - 4 - pw, y = h - ph - 1;   // 왼손 칸(핫바 왼쪽 29px)과 겹치지 않게 (사용자 지시)
        g.fill(x, y, x + pw, y + ph, 0xB0281C14);
        g.fill(x, y, x + pw, y + 1, 0xFFC8A06A);
        for (int i = 0; i < 8; i++) {
            int ry = y + 3 + i * 10;
            g.blit(RenderPipelines.GUI_TEXTURED, tex("hud/stat_" + STAT_ICON[i]), x + 3, ry, 0, 0, 8, 8, 8, 8);
            g.pose().pushMatrix();
            g.pose().translate(x + 13, ry + 1);
            g.pose().scale(0.75f, 0.75f);
            g.drawString(mc.font, STAT_NAME[i], 0, 0, 0xFFE8D8C0, false);
            g.pose().popMatrix();
            String v = RpgState.stats.get(i);
            g.drawString(mc.font, v, x + pw - 3 - mc.font.width(v), ry, 0xFFFFFFFF, true);
        }
    }

    // ── 미니맵 (왼쪽 위) ─────────────────────────────────────────────

    private static void minimap(GuiGraphics g, Minecraft mc) {
        int[] size = MAPS.get(RpgState.map);
        if (size == null || mc.player == null) return;
        int fx = 4, fy = 4, vx = fx + 3, vy = fy + 3, vw = 64, scale = 2;
        g.blit(RenderPipelines.GUI_TEXTURED, tex("hud/minimap_frame"), fx, fy, 0, 0, 70, 70, 70, 70);
        double tx = mc.player.getX() / 2 + PAD, tz = mc.player.getZ() / 2 + PAD;
        g.enableScissor(vx, vy, vx + vw, vy + vw);
        g.fill(vx, vy, vx + vw, vy + vw, 0xFF2A1E14);
        int ox = (int) Math.round(vx + vw / 2.0 - tx * scale), oz = (int) Math.round(vy + vw / 2.0 - tz * scale);
        g.blit(RenderPipelines.GUI_TEXTURED, tex("map/" + RpgState.map), ox, oz, 0, 0, size[0] * scale, size[1] * scale, size[0], size[1], size[0], size[1]);
        for (Player o : mc.level.players()) {
            if (o == mc.player || o.isSpectator()) continue;
            int px = (int) Math.round(vx + vw / 2.0 + (o.getX() / 2 + PAD - tx) * scale), pz = (int) Math.round(vy + vw / 2.0 + (o.getZ() / 2 + PAD - tz) * scale);
            head(g, mc, o, px - 3, pz - 3, 6, RpgState.party.contains(o.getGameProfile().name()) ? 0xFF55E05A : 0xFF3A6FD8);
        }
        arrow(g, vx + vw / 2, vy + vw / 2, mc.player.getYRot());
        g.disableScissor();
    }

    static void head(GuiGraphics g, Minecraft mc, Player o, int x, int y, int s, int border) {
        g.fill(x - 1, y - 1, x + s + 1, y + s + 1, border);
        PlayerInfo info = mc.getConnection() == null ? null : mc.getConnection().getPlayerInfo(o.getUUID());
        if (info != null) PlayerFaceRenderer.draw(g, info.getSkin(), x, y, s);
        else g.fill(x, y, x + s, y + s, 0xFFC8956C);
    }

    /** 내 위치 삼각형 (그림은 위쪽 = 북쪽을 가리킴, 마크 yaw 0 = 남쪽) */
    static void arrow(GuiGraphics g, int cx, int cy, float yaw) {
        g.pose().pushMatrix();
        g.pose().translate(cx, cy);
        g.pose().rotate((float) Math.toRadians(yaw + 180));
        g.blit(RenderPipelines.GUI_TEXTURED, tex("hud/minimap_me"), -3, -3, 0, 0, 7, 7, 7, 7);
        g.pose().popMatrix();
    }

    static Identifier mapTex(String kind) { return tex("map/" + kind); }
}
