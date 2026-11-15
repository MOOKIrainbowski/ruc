package kr.rucserver.rpgclient;

import com.mojang.blaze3d.platform.InputConstants;
import net.fabricmc.api.ClientModInitializer;
import net.fabricmc.fabric.api.client.event.lifecycle.v1.ClientTickEvents;
import net.fabricmc.fabric.api.client.keybinding.v1.KeyBindingHelper;
import net.fabricmc.fabric.api.client.networking.v1.ClientPlayConnectionEvents;
import net.fabricmc.fabric.api.client.networking.v1.ClientPlayNetworking;
import net.fabricmc.fabric.api.networking.v1.PayloadTypeRegistry;
import net.minecraft.client.KeyMapping;
import net.minecraft.client.Minecraft;
import org.lwjgl.glfw.GLFW;

import java.io.ByteArrayOutputStream;
import java.io.DataOutputStream;
import java.io.IOException;
import java.util.LinkedHashMap;
import java.util.Map;

/**
 * 러크 RPG 클라이언트 모드 (사용자 결정 K1, docs/13 F1 · F2).
 * 웹 RPG 기본 키 그대로: Q · C · Z · R 스킬, M 지도, V 장비, K 스킬창, J 퀘스트, P 파티, B 창고, O 영지 · 소셜, G 핑, F8 GM, Esc 는 마크 그대로.
 * 키는 마크 "조작" 설정에서 바꿀 수 있음(게임 플레이 분류). RPG 서버(악수 받은 뒤)에서만 동작 — 다른 서버에서는 아무것도 안 함.
 */
public final class RucRpgClient implements ClientModInitializer {

    public static final int VERSION = 1;
    private static final Map<KeyMapping, String> KEYS = new LinkedHashMap<>();
    private static KeyMapping mapKey;
    private static int helloWait;

    static KeyMapping mapKey() { return mapKey; }

    private static KeyMapping key(String id, int glfw, String action) {
        KeyMapping k = KeyBindingHelper.registerKeyBinding(new KeyMapping("key.ruc_rpg." + id, InputConstants.Type.KEYSYM, glfw, KeyMapping.Category.GAMEPLAY));
        if (action != null) KEYS.put(k, action);
        return k;
    }

    @Override
    public void onInitializeClient() {
        PayloadTypeRegistry.playC2S().register(RpgPayload.TYPE, RpgPayload.CODEC);
        PayloadTypeRegistry.playS2C().register(RpgPayload.TYPE, RpgPayload.CODEC);
        ClientPlayNetworking.registerGlobalReceiver(RpgPayload.TYPE, (payload, ctx) -> {
            try { RpgState.read(payload.data()); } catch (IOException ignored) {}
        });

        key("skill_q", GLFW.GLFW_KEY_Q, "skill:Q");
        key("skill_c", GLFW.GLFW_KEY_C, "skill:C");
        key("skill_z", GLFW.GLFW_KEY_Z, "skill:Z");
        key("skill_r", GLFW.GLFW_KEY_R, "skill:R");
        mapKey = key("map", GLFW.GLFW_KEY_M, null);
        key("equip", GLFW.GLFW_KEY_V, "open:equip");
        key("skills", GLFW.GLFW_KEY_K, "open:skills");
        key("journal", GLFW.GLFW_KEY_J, "open:journal");
        key("party", GLFW.GLFW_KEY_P, "open:party");
        key("storage", GLFW.GLFW_KEY_B, "open:storage");
        key("social", GLFW.GLFW_KEY_O, "open:social");
        key("ping", GLFW.GLFW_KEY_G, "ping:gather");
        key("gm", GLFW.GLFW_KEY_F8, "open:gm");
        key("menu", GLFW.GLFW_KEY_N, "open:menu");

        ClientPlayConnectionEvents.JOIN.register((h, s, mc) -> { RpgState.reset(); helloWait = 0; });
        ClientPlayConnectionEvents.DISCONNECT.register((h, mc) -> RpgState.reset());

        // 바닐라 Q(버리기)를 RPG 서버에서는 스킬로: 바닐라가 보기 전에(틱 시작) 눌림을 먹어 버림
        ClientTickEvents.START_CLIENT_TICK.register(mc -> {
            if (RpgState.active && mc.screen == null) while (mc.options.keyDrop.consumeClick()) { /* 스킬 Q 가 대신 */ }
        });
        ClientTickEvents.END_CLIENT_TICK.register(RucRpgClient::tick);

        RpgHud.register();
        SelfTest.register();
        AccessoryPanel.register();
    }

    private static void tick(Minecraft mc) {
        if (mc.player == null || mc.getConnection() == null) return;
        if (!RpgState.active && helloWait-- <= 0 && ClientPlayNetworking.canSend(RpgPayload.TYPE)) {   // 악수: 서버가 채널을 열면 1초마다 다시
            send(out -> { out.writeByte(1); out.writeInt(VERSION); });
            helloWait = 20;
        }
        if (!RpgState.active) {
            for (KeyMapping k : KEYS.keySet()) while (k.consumeClick()) { /* RPG 서버가 아니면 무시 */ }
            while (mapKey.consumeClick()) { }
            return;
        }
        for (Map.Entry<KeyMapping, String> e : KEYS.entrySet())
            while (e.getKey().consumeClick()) if (mc.screen == null) send(out -> { out.writeByte(2); out.writeUTF(e.getValue()); });
        while (mapKey.consumeClick()) if (mc.screen == null && !RpgState.map.isEmpty()) mc.setScreen(new MapScreen());
    }

    interface Writer { void write(DataOutputStream out) throws IOException; }

    static void send(Writer w) {
        ByteArrayOutputStream buf = new ByteArrayOutputStream();
        try (DataOutputStream out = new DataOutputStream(buf)) { w.write(out); } catch (IOException e) { return; }
        if (ClientPlayNetworking.canSend(RpgPayload.TYPE)) ClientPlayNetworking.send(new RpgPayload(buf.toByteArray()));
    }
}
