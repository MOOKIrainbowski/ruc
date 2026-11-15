package kr.rucserver.rpgclient.mixin;

import kr.rucserver.rpgclient.RpgState;
import net.minecraft.world.entity.Entity;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfoReturnable;

/** 퀘스트 강조(F6): 서버가 보낸 엔티티(NPC · 몹의 보이는 몸)는 이 화면에서만 노란 발광 윤곽 */
@Mixin(Entity.class)
public abstract class EntityGlowMixin {

    @Inject(method = "isCurrentlyGlowing", at = @At("HEAD"), cancellable = true)
    private void ruc$glow(CallbackInfoReturnable<Boolean> cir) {
        if (!RpgState.markEntities.isEmpty() && RpgState.markEntities.contains(((Entity) (Object) this).getUUID())) cir.setReturnValue(true);
    }

    @Inject(method = "getTeamColor", at = @At("HEAD"), cancellable = true)
    private void ruc$color(CallbackInfoReturnable<Integer> cir) {
        if (!RpgState.markEntities.isEmpty() && RpgState.markEntities.contains(((Entity) (Object) this).getUUID())) cir.setReturnValue(0xFFD84A);
    }
}
