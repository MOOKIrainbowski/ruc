package kr.rucserver.rpgclient;

import net.minecraft.client.Minecraft;
import net.minecraft.core.BlockPos;
import net.minecraft.world.entity.Display;
import net.minecraft.world.entity.Entity;
import net.minecraft.world.entity.EntityType;

import java.util.ArrayList;
import java.util.List;

/**
 * 퀘스트 강조 블록 (F6): 그 블록과 같은 모양의 클라이언트 전용 블록 디스플레이를 겹쳐 놓고 발광 → 바닐라 발광 윤곽(노랑).
 * 서버에는 없는 엔티티(음수 id) — 이 화면에서만 보임.
 */
final class Marks {

    private static final List<Display.BlockDisplay> live = new ArrayList<>();
    private static int nextId = -0x4000_0000;

    static void refresh() {
        Minecraft mc = Minecraft.getInstance();
        if (mc.level == null) { live.clear(); return; }
        for (Display.BlockDisplay d : live) mc.level.removeEntity(d.getId(), Entity.RemovalReason.DISCARDED);
        live.clear();
        for (int[] b : RpgState.markBlocks) {
            BlockPos pos = new BlockPos(b[0], b[1], b[2]);
            Display.BlockDisplay d = new Display.BlockDisplay(EntityType.BLOCK_DISPLAY, mc.level);
            d.setId(nextId++);
            d.setBlockState(mc.level.getBlockState(pos));
            d.setPos(b[0], b[1], b[2]);
            d.setGlowColorOverride(0xFFD84A);
            d.setGlowingTag(true);
            mc.level.addEntity(d);
            live.add(d);
        }
    }
}
