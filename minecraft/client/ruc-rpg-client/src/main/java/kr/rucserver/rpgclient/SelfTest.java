package kr.rucserver.rpgclient;

import net.fabricmc.fabric.api.client.event.lifecycle.v1.ClientTickEvents;
import net.minecraft.client.Minecraft;
import net.minecraft.client.Screenshot;

/**
 * 개발 시험 (-Druc.selftest=1 일 때만): 서버와 악수 → 스크린샷(HUD) → 스킬 Q → 스크린샷 → M 지도 → 스크린샷 → 종료.
 * Claude 가 실제 클라이언트 화면을 직접 확인하려고 둠 (사람 없이). 일반 플레이에는 꺼져 있음.
 */
final class SelfTest {

    private static int t = -1;

    static void register() {
        if (System.getProperty("ruc.selftest") == null) return;
        ClientTickEvents.END_CLIENT_TICK.register(SelfTest::tick);
    }

    private static void shot(Minecraft mc, String name) {
        Screenshot.grab(mc.gameDirectory, "selftest_" + name + ".png", mc.getMainRenderTarget(), 1, c -> System.out.println("[RUC SELFTEST] " + c.getString()));
    }

    private static void tick(Minecraft mc) {
        if (mc.player == null) return;
        if (t < 0) { if (!RpgState.active) return; t = 0; System.out.println("[RUC SELFTEST] 악수 완료, 맵 = " + RpgState.map); }
        t++;
        String steps = System.getProperty("ruc.selftest.cmds", "");
        if (t == 20 && !steps.isEmpty()) for (String c : steps.split(";")) mc.player.connection.sendCommand(c.trim());
        if (t == 100) shot(mc, "hud");
        if (t == 110) RucRpgClient.send(out -> { out.writeByte(2); out.writeUTF("skill:Q"); });
        if (t == 116) shot(mc, "skill");
        if (t == 140) mc.setScreen(new MapScreen());
        if (t == 160) shot(mc, "map");
        if (t == 170) mc.setScreen(null);
        if (t == 180) RucRpgClient.send(out -> { out.writeByte(2); out.writeUTF("open:skills"); });
        if (t == 210) shot(mc, "window");
        if (t == 230) { System.out.println("[RUC SELFTEST] 끝"); mc.stop(); }
    }
}
