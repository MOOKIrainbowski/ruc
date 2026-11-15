package kr.rucserver.rpgclient;

import net.minecraft.network.FriendlyByteBuf;
import net.minecraft.network.codec.StreamCodec;
import net.minecraft.network.protocol.common.custom.CustomPacketPayload;
import net.minecraft.resources.Identifier;

/** 채널 `ruc:rpg` — 내용은 그대로의 바이트(첫 바이트 = 종류, 나머지는 Java DataOutput). 서버(Paper) 플러그인 메시지와 같은 모양. */
public record RpgPayload(byte[] data) implements CustomPacketPayload {

    public static final Type<RpgPayload> TYPE = new Type<>(Identifier.fromNamespaceAndPath("ruc", "rpg"));

    public static final StreamCodec<FriendlyByteBuf, RpgPayload> CODEC = StreamCodec.of(
            (buf, p) -> buf.writeBytes(p.data()),
            buf -> { byte[] b = new byte[buf.readableBytes()]; buf.readBytes(b); return new RpgPayload(b); });

    @Override
    public Type<? extends CustomPacketPayload> type() { return TYPE; }
}
