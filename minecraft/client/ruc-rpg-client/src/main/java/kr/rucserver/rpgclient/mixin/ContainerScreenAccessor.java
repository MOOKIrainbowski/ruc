package kr.rucserver.rpgclient.mixin;

import net.minecraft.client.gui.screens.inventory.AbstractContainerScreen;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.gen.Accessor;

/** 인벤토리 창의 왼쪽 위 좌표 (장신구 칸을 방패 칸 위에 맞춰 그리려고) */
@Mixin(AbstractContainerScreen.class)
public interface ContainerScreenAccessor {
    @Accessor("leftPos") int ruc$left();
    @Accessor("topPos") int ruc$top();
}
