package kr.rucserver.rpg.skill;

import kr.rucserver.rpg.RucRpg;
import kr.rucserver.rpg.ui.Gui;
import org.bukkit.Bukkit;
import org.bukkit.Color;
import org.bukkit.Location;
import org.bukkit.Material;
import org.bukkit.NamespacedKey;
import org.bukkit.entity.Display;
import org.bukkit.entity.ItemDisplay;
import org.bukkit.inventory.ItemStack;
import org.bukkit.util.Transformation;
import org.joml.Quaternionf;
import org.joml.Vector3f;

/**
 * 스킬 이펙트 스프라이트 (docs/13 F7, 웹 fx.ts 의 swing · shock · spark · burst …) — Codex 작업 13 그림(fx/*, 흰색 명암)을
 * ItemDisplay 로 띄우고 속성 색으로 물들임(custom_model_data 색). 크기 · 회전은 디스플레이 보간으로 부드럽게, 끝나면 지움.
 * 팩에 그 그림이 없으면 아무것도 안 함(파티클 이펙트는 그대로) — 보라 검정 네모가 뜨지 않게.
 */
public final class FxSprites {

    private final RucRpg plugin;

    public FxSprites(RucRpg plugin) { this.plugin = plugin; }

    public static boolean has(String sprite) { return Gui.hasModel("fx/" + sprite); }

    @SuppressWarnings("UnstableApiUsage")
    private static ItemStack item(String sprite, Color c) {
        ItemStack it = new ItemStack(Material.PAPER);
        var m = it.getItemMeta();
        m.setItemModel(new NamespacedKey("ruc", "fx/" + sprite));
        it.setItemMeta(m);
        it.setData(io.papermc.paper.datacomponent.DataComponentTypes.CUSTOM_MODEL_DATA, io.papermc.paper.datacomponent.item.CustomModelData.customModelData().addColor(c).build());
        return it;
    }

    /**
     * 스프라이트 하나.
     * @param flat   바닥에 눕힘(원 · 충격파), 아니면 세워서 카메라를 봄(빌보드)
     * @param yawDeg 눕힌 것 · 세운 것의 돌림(베기 방향)
     */
    public ItemDisplay show(Location at, String sprite, Color c, float from, float to, float yawDeg, long ms, boolean flat) {
        if (!has(sprite) || at.getWorld() == null) return null;
        Quaternionf rot = flat ? new Quaternionf().rotateY((float) Math.toRadians(-yawDeg)).rotateX((float) Math.toRadians(-90))
                : new Quaternionf().rotateY((float) Math.toRadians(-yawDeg));
        ItemDisplay d = at.getWorld().spawn(at, ItemDisplay.class, e -> {
            e.setItemStack(item(sprite, c));
            e.setPersistent(false);
            e.setBillboard(flat || yawDeg != 0 ? Display.Billboard.FIXED : Display.Billboard.CENTER);
            e.setBrightness(new Display.Brightness(15, 15));
            e.setTransformation(new Transformation(new Vector3f(), rot, new Vector3f(from, from, from), new Quaternionf()));
        });
        int ticks = (int) Math.max(1, ms / 50);
        Bukkit.getScheduler().runTaskLater(plugin, () -> {   // 다음 틱에 목표 크기로 보간 시작
            if (!d.isValid()) return;
            d.setInterpolationDelay(0);
            d.setInterpolationDuration(ticks);
            d.setTransformation(new Transformation(new Vector3f(), rot, new Vector3f(to, to, to), new Quaternionf()));
        }, 1L);
        Bukkit.getScheduler().runTaskLater(plugin, d::remove, ticks + 2L);
        return d;
    }

    /** 터짐 4프레임 (웹 ultImpact · burst) */
    public void burst(Location at, Color c, float size) {
        if (!has("burst_0")) return;
        ItemDisplay d = show(at, "burst_0", c, size * 0.6f, size, 0, 240, false);
        if (d == null) return;
        for (int f = 1; f <= 3; f++) {
            int k = f;
            Bukkit.getScheduler().runTaskLater(plugin, () -> { if (d.isValid()) d.setItemStack(item("burst_" + k, c)); }, f * 1L + 1);
        }
    }

    /** 투사체에 붙는 그림 (구슬 · 화살) — 위치는 Projectiles 가 매 틱 옮김 */
    public ItemDisplay projectile(Location at, String sprite, Color c, float size, float yawDeg) {
        if (!has(sprite)) return null;
        return at.getWorld().spawn(at, ItemDisplay.class, e -> {
            e.setItemStack(item(sprite, c));
            e.setPersistent(false);
            e.setTeleportDuration(1);
            e.setBillboard(sprite.equals("arrow") ? Display.Billboard.FIXED : Display.Billboard.CENTER);
            e.setBrightness(new Display.Brightness(15, 15));
            e.setTransformation(new Transformation(new Vector3f(), sprite.equals("arrow") ? new Quaternionf().rotateY((float) Math.toRadians(-yawDeg)) : new Quaternionf(),
                    new Vector3f(size, size, size), new Quaternionf()));
        });
    }
}
