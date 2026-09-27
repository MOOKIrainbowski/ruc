package kr.rucserver.core.listener;

import io.papermc.paper.event.player.AsyncChatEvent;
import kr.rucserver.core.RucCore;
import net.kyori.adventure.text.Component;
import org.bukkit.event.EventHandler;
import org.bukkit.event.EventPriority;
import org.bukkit.event.Listener;

/**
 * 채팅 한 줄의 모양 (Phase 6).
 *
 * 요구사항의 형식은 <b>[머리] [칭호] [닉네임]: [내용]</b> 입니다.
 *
 * <h2>renderer 를 쓰고 이벤트를 취소하지 않습니다</h2>
 * 취소하고 직접 broadcast 하면 그 줄이 Paper 의 채팅 파이프라인 밖으로
 * 나갑니다. 서명된 채팅, 신고 기능, 다른 플러그인의 필터가 전부 그 줄을 보지
 * 못하게 됩니다. {@code renderer} 는 파이프라인 안에서 모양만 바꿉니다.
 *
 * <h2>우선순위를 LOW 보다 뒤로 두는 이유</h2>
 * {@code VerificationListener} 가 LOWEST 에서 미인증자의 채팅을 취소합니다.
 * {@code ignoreCancelled = true} 로 그 뒤에 서면, 취소된 줄에 대고 칭호를
 * 조립하는 헛일을 하지 않습니다.
 */
public class ChatListener implements Listener {

    private final RucCore plugin;

    public ChatListener(RucCore plugin) {
        this.plugin = plugin;
    }

    @EventHandler(priority = EventPriority.NORMAL, ignoreCancelled = true)
    public void onChat(AsyncChatEvent event) {
        if (!plugin.getConfig().getBoolean("chat.enabled", true)) return;

        // renderer 는 보는 사람마다 한 번씩 불립니다. 접두부는 보는 사람과
        // 무관하므로 여기서 한 번 만들어 붙잡아 둡니다 — 접속자 100명이면
        // 100번 조립하게 되고, 그 안에 MiniMessage 파싱이 들어 있습니다.
        Component prefix = plugin.getTitles().chatPrefix(event.getPlayer());
        var color = plugin.getTitles().messageColor();

        event.renderer((source, sourceDisplayName, message, viewer) ->
                prefix.append(message.colorIfAbsent(color)));
    }
}
