package kr.rucserver.core.service;

import kr.rucserver.core.RucCore;
import org.bukkit.Bukkit;
import org.bukkit.Location;
import org.bukkit.Sound;
import org.bukkit.entity.Player;

import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;

/**
 * /tpa, /tpahere, /tpaccept, /tpdeny, /tpcancel (§3.3)
 *
 * 워밍업 중에 움직이면 취소됩니다. 전투 중 순간이동으로 도주하는 것을 막기
 * 위한 장치이고, 레이드 서버의 콤벳로그 규칙(§2.4)과 같은 목적입니다.
 */
public class TpaService {

    /** 한 건의 텔레포트 요청. */
    public record Request(UUID sender, UUID target, boolean here, long expiresAt) {}

    private final RucCore plugin;
    private final MessageService messages;

    /** 받는 사람 UUID → 요청. 한 번에 하나만 유지합니다. */
    private final Map<UUID, Request> incoming = new ConcurrentHashMap<>();
    /** 보낸 사람 UUID → 받는 사람 UUID. 취소와 중복 방지에 씁니다. */
    private final Map<UUID, UUID> outgoing = new ConcurrentHashMap<>();
    /** 보낸 사람 UUID → 쿨타임 종료 시각. */
    private final Map<UUID, Long> cooldowns = new ConcurrentHashMap<>();

    public TpaService(RucCore plugin, MessageService messages) {
        this.plugin = plugin;
        this.messages = messages;
    }

    private int timeoutSeconds() {
        return plugin.getConfig().getInt("tpa.request-timeout", 60);
    }

    private int warmupSeconds() {
        return plugin.getConfig().getInt("tpa.warmup-seconds", 3);
    }

    private int cooldownSeconds() {
        return plugin.getConfig().getInt("tpa.cooldown-seconds", 60);
    }

    public void request(Player sender, Player target, boolean here) {
        String lang = plugin.getPlayerData().languageOf(sender);

        if (sender.equals(target)) {
            sender.sendMessage(messages.prefixed(lang, "tpa.self"));
            return;
        }

        Long cooldownEnd = cooldowns.get(sender.getUniqueId());
        if (cooldownEnd != null && System.currentTimeMillis() < cooldownEnd) {
            long remain = (cooldownEnd - System.currentTimeMillis() + 999) / 1000;
            sender.sendMessage(messages.prefixed(lang, "tpa.cooldown",
                    "seconds", String.valueOf(remain)));
            return;
        }

        if (outgoing.containsKey(sender.getUniqueId())) {
            sender.sendMessage(messages.prefixed(lang, "tpa.already-pending"));
            return;
        }

        long expiresAt = System.currentTimeMillis() + timeoutSeconds() * 1000L;
        Request request = new Request(sender.getUniqueId(), target.getUniqueId(), here, expiresAt);

        incoming.put(target.getUniqueId(), request);
        outgoing.put(sender.getUniqueId(), target.getUniqueId());

        sender.sendMessage(messages.prefixed(lang, "tpa.sent",
                "player", target.getName(),
                "seconds", String.valueOf(timeoutSeconds())));

        String targetLang = plugin.getPlayerData().languageOf(target);
        target.sendMessage(messages.prefixed(targetLang,
                here ? "tpa.received-here" : "tpa.received",
                "player", sender.getName()));
        target.playSound(target.getLocation(), Sound.BLOCK_NOTE_BLOCK_PLING, 1.0f, 1.5f);

        // 만료 처리
        Bukkit.getScheduler().runTaskLater(plugin, () -> {
            Request current = incoming.get(target.getUniqueId());
            if (current != null && current.expiresAt() == expiresAt) {
                incoming.remove(target.getUniqueId());
                outgoing.remove(sender.getUniqueId());

                Player s = Bukkit.getPlayer(sender.getUniqueId());
                if (s != null) s.sendMessage(messages.prefixed(
                        plugin.getPlayerData().languageOf(s), "tpa.expired"));
            }
        }, timeoutSeconds() * 20L);
    }

    public void accept(Player target) {
        String lang = plugin.getPlayerData().languageOf(target);

        Request request = incoming.remove(target.getUniqueId());
        if (request == null) {
            target.sendMessage(messages.prefixed(lang, "tpa.no-request"));
            return;
        }
        outgoing.remove(request.sender());

        Player sender = Bukkit.getPlayer(request.sender());
        if (sender == null) {
            target.sendMessage(messages.prefixed(lang, "tpa.no-request"));
            return;
        }

        target.sendMessage(messages.prefixed(lang, "tpa.accepted"));
        sender.sendMessage(messages.prefixed(plugin.getPlayerData().languageOf(sender),
                "tpa.accepted-by", "player", target.getName()));

        // here=true 면 받는 사람이 보낸 사람에게로 갑니다.
        Player moving = request.here() ? target : sender;
        Player destination = request.here() ? sender : target;

        cooldowns.put(request.sender(),
                System.currentTimeMillis() + cooldownSeconds() * 1000L);

        startWarmup(moving, destination);
    }

    public void deny(Player target) {
        String lang = plugin.getPlayerData().languageOf(target);

        Request request = incoming.remove(target.getUniqueId());
        if (request == null) {
            target.sendMessage(messages.prefixed(lang, "tpa.no-request"));
            return;
        }
        outgoing.remove(request.sender());

        target.sendMessage(messages.prefixed(lang, "tpa.denied"));

        Player sender = Bukkit.getPlayer(request.sender());
        if (sender != null) {
            sender.sendMessage(messages.prefixed(plugin.getPlayerData().languageOf(sender),
                    "tpa.denied-by", "player", target.getName()));
        }
    }

    public void cancel(Player sender) {
        String lang = plugin.getPlayerData().languageOf(sender);

        UUID targetId = outgoing.remove(sender.getUniqueId());
        if (targetId == null) {
            sender.sendMessage(messages.prefixed(lang, "tpa.no-request"));
            return;
        }
        incoming.remove(targetId);
        sender.sendMessage(messages.prefixed(lang, "tpa.cancelled"));
    }

    /** 워밍업 동안 제자리에 있어야 이동합니다. */
    private void startWarmup(Player moving, Player destination) {
        int seconds = warmupSeconds();
        String lang = plugin.getPlayerData().languageOf(moving);

        if (seconds <= 0) {
            moving.teleport(destination.getLocation());
            moving.sendMessage(messages.prefixed(lang, "tpa.teleported"));
            return;
        }

        Location origin = moving.getLocation().clone();
        moving.sendMessage(messages.prefixed(lang, "tpa.warmup",
                "seconds", String.valueOf(seconds)));

        Bukkit.getScheduler().runTaskLater(plugin, () -> {
            if (!moving.isOnline() || !destination.isOnline()) return;

            // 블록 단위로 움직였는지 확인 (시점 회전은 허용)
            Location now = moving.getLocation();
            boolean moved = now.getWorld() != origin.getWorld()
                    || now.getBlockX() != origin.getBlockX()
                    || now.getBlockY() != origin.getBlockY()
                    || now.getBlockZ() != origin.getBlockZ();

            if (moved) {
                moving.sendMessage(messages.prefixed(lang, "tpa.warmup-cancelled"));
                return;
            }

            moving.teleport(destination.getLocation());
            moving.sendMessage(messages.prefixed(lang, "tpa.teleported"));
            moving.playSound(moving.getLocation(), Sound.ENTITY_ENDERMAN_TELEPORT, 1.0f, 1.0f);
        }, seconds * 20L);
    }

    /** 퇴장 시 남은 요청 정리. */
    public void clear(UUID uuid) {
        UUID targetId = outgoing.remove(uuid);
        if (targetId != null) incoming.remove(targetId);

        Request request = incoming.remove(uuid);
        if (request != null) outgoing.remove(request.sender());
    }
}
