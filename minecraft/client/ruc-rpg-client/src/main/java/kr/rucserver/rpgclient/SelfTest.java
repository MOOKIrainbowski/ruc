package kr.rucserver.rpgclient;

import net.fabricmc.fabric.api.client.event.lifecycle.v1.ClientTickEvents;
import net.minecraft.client.Minecraft;
import net.minecraft.client.Screenshot;

/**
 * 개발 시험 (-Druc.selftest=단계들 일 때만): 서버와 악수한 뒤 단계를 차례로 실행하고 끝나면 종료. 일반 플레이에는 꺼져 있음.
 * 단계(';' 로 구분): "cmd 명령" · "wait 틱" · "shot 이름" · "key 동작"(예: key skill:Q) · "map" · "close" · "look 요 피치".
 * Claude 가 실제 클라이언트 화면을 직접 확인하려고 둠 (사람 없이).
 */
final class SelfTest {

    private static String[] steps;
    private static int i = -1, wait, joinTicks, useLeft;

    static void register() {
        String s = System.getProperty("ruc.selftest");
        if (s == null || s.isBlank()) return;
        steps = s.split(";");
        ClientTickEvents.END_CLIENT_TICK.register(SelfTest::tick);
    }

    private static void tick(Minecraft mc) {
        if (mc.player == null) return;
        if (i < 0) { if (!RpgState.active && joinTicks++ < 100) return; i = 0; wait = 40; log("시작 (악수 " + RpgState.active + "), 맵 = " + RpgState.map); }
        if (useLeft > 0 && --useLeft == 0) mc.options.keyUse.setDown(false);
        if (wait-- > 0) return;
        if (i >= steps.length) { log("끝"); mc.stop(); return; }
        String[] st = steps[i++].trim().split(" ", 2);
        String arg = st.length > 1 ? st[1] : "";
        switch (st[0]) {
            case "cmd" -> { mc.player.connection.sendCommand(arg); wait = 20; }
            case "wait" -> wait = Integer.parseInt(arg);
            case "shot" -> { Screenshot.grab(mc.gameDirectory, "selftest_" + arg + ".png", mc.getMainRenderTarget(), 1, c -> log(c.getString())); wait = 5; }
            case "key" -> { RucRpgClient.send(out -> { out.writeByte(2); out.writeUTF(arg); }); wait = 4; }
            case "map" -> { mc.setScreen(new MapScreen()); wait = 10; }
            case "close" -> { mc.setScreen(null); wait = 5; }
            case "click" -> { if (mc.player.containerMenu != null) mc.gameMode.handleInventoryMouseClick(mc.player.containerMenu.containerId, Integer.parseInt(arg), 0, net.minecraft.world.inventory.ClickType.PICKUP, mc.player); wait = 10; }
            case "hold" -> {   // 단축바에서 이 바닐라 아이템(예: potion)을 든 칸 고르기
                for (int k = 0; k < 9; k++) if (net.minecraft.core.registries.BuiltInRegistries.ITEM.getKey(mc.player.getInventory().getItem(k).getItem()).getPath().equals(arg)) { mc.player.getInventory().setSelectedSlot(k); break; }
                wait = 5;
            }
            case "use" -> { mc.options.keyUse.setDown(true); useLeft = Integer.parseInt(arg); wait = 0; }
            case "respawn" -> { if (mc.player.isDeadOrDying()) { mc.player.respawn(); mc.setScreen(null); } wait = 40; }
            case "nohud" -> { mc.options.hideGui = !mc.options.hideGui; wait = 2; }
            case "inv" -> { mc.setScreen(new net.minecraft.client.gui.screens.inventory.InventoryScreen(mc.player)); wait = 10; }
            case "pick" -> {   // 이름에 arg 가 들어간 칸을 클릭 (지금 열린 화면)
                var menu = mc.player.containerMenu;
                for (int k = 0; k < menu.slots.size(); k++)
                    if (menu.slots.get(k).getItem().getHoverName().getString().contains(arg)) { mc.gameMode.handleInventoryMouseClick(menu.containerId, k, 0, net.minecraft.world.inventory.ClickType.PICKUP, mc.player); break; }
                wait = 10;
            }
            case "acc" -> { RucRpgClient.send(out -> { out.writeByte(2); out.writeUTF("acc:" + arg); }); wait = 10; }   // 장신구 칸 누르기와 같음
            case "look" -> { String[] a = arg.split(" "); mc.player.setYRot(Float.parseFloat(a[0])); mc.player.setXRot(Float.parseFloat(a[1])); wait = 5; }
            default -> log("모르는 단계: " + st[0]);
        }
    }

    private static void log(String s) { System.out.println("[RUC SELFTEST] " + s); }
}
