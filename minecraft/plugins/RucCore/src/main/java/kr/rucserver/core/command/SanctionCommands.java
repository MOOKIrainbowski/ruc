package kr.rucserver.core.command;

import kr.rucserver.core.RucCore;
import kr.rucserver.core.model.RucPlayer;
import kr.rucserver.core.service.SanctionService;
import kr.rucserver.core.storage.SanctionRepository.Sanction;
import org.bukkit.command.Command;
import org.bukkit.command.CommandExecutor;
import org.bukkit.command.CommandSender;
import org.bukkit.entity.Player;
import org.jetbrains.annotations.NotNull;

import java.sql.SQLException;
import java.util.Arrays;
import java.util.List;
import java.util.logging.Level;

/**
 * {@code /rucsanction} — 제재 (Phase 6-7). <b>RCON 전용.</b>
 *
 * 디스코드 봇의 {@code /제재} 가 부릅니다. 디스코드 뮤트·밴과 마크 밴을 한
 * 명령으로 거는 것이 D5 의 요구이고, 그 조율은 봇이 합니다. 여기는 마크 쪽
 * 절반입니다.
 *
 * <h2>응답 규격</h2>
 * 다른 RCON 명령과 같이 한 줄, {@code RUCSANCTION <결과> key=value...}.
 * <pre>
 * rucsanction apply &lt;ref&gt; &lt;닉네임&gt; &lt;단계&gt; &lt;밴분|perm&gt; &lt;몰수%&gt; &lt;평판효과&gt; &lt;집행자&gt; &lt;사유...&gt;
 *   → RUCSANCTION OK id=12 uuid=... applied=now|pending
 *   → RUCSANCTION DUP id=12          (같은 ref 가 이미 있음 — 재시도. 성공으로 봅니다)
 *   → RUCSANCTION NOT_FOUND
 * rucsanction revoke &lt;번호&gt; &lt;해제자&gt;
 *   → RUCSANCTION REVOKED id=12 | RUCSANCTION ALREADY | RUCSANCTION NOT_FOUND
 * rucsanction history &lt;닉네임&gt;
 *   → RUCSANCTION HISTORY count=3 active=1 max=4 last=4 lastAt=... confirmed=2 ids=12,9,4 name=X
 * </pre>
 */
public class SanctionCommands implements CommandExecutor {

    private final RucCore plugin;

    public SanctionCommands(RucCore plugin) {
        this.plugin = plugin;
    }

    public void register() {
        var command = plugin.getCommand("rucsanction");
        if (command == null) {
            plugin.getLogger().warning("plugin.yml에 'rucsanction' 명령어가 없습니다.");
            return;
        }
        command.setExecutor(this);
    }

    @Override
    public boolean onCommand(@NotNull CommandSender sender, @NotNull Command command,
                             @NotNull String label, @NotNull String[] args) {
        if (sender instanceof Player) {
            // 게임 안에서 쓰게 하면 디스코드 쪽 절반(뮤트·밴)이 빠진 제재가 생깁니다.
            sender.sendMessage("이 명령어는 콘솔에서만 사용할 수 있습니다. 디스코드의 /제재 를 쓰세요.");
            return true;
        }
        if (args.length == 0) {
            sender.sendMessage("RUCSANCTION ERROR usage: apply|revoke|history");
            return true;
        }

        switch (args[0].toLowerCase(java.util.Locale.ROOT)) {
            case "apply" -> apply(sender, args);
            case "revoke" -> revoke(sender, args);
            case "history" -> history(sender, args);
            default -> sender.sendMessage("RUCSANCTION ERROR usage: apply|revoke|history");
        }
        return true;
    }

    private void apply(CommandSender sender, String[] args) {
        if (args.length < 9) {
            sender.sendMessage("RUCSANCTION ERROR usage: apply <ref> <닉네임> <단계> "
                    + "<밴분|perm> <몰수%> <평판효과> <집행자> <사유...>");
            return;
        }

        String ref = args[1];
        String name = args[2];
        int tier;
        long banMinutes;
        int pct;
        try {
            tier = Integer.parseInt(args[3]);
            banMinutes = args[4].equalsIgnoreCase("perm") ? -1 : Long.parseLong(args[4]);
            pct = Integer.parseInt(args[5]);
        } catch (NumberFormatException e) {
            sender.sendMessage("RUCSANCTION ERROR 숫자 형식");
            return;
        }
        if (tier < 1 || tier > 10 || pct < 0 || pct > 100 || banMinutes == 0 || ref.length() > 32) {
            sender.sendMessage("RUCSANCTION ERROR 범위");
            return;
        }
        String repEffect = args[6];
        String issuer = args[7];
        String reason = String.join(" ", Arrays.copyOfRange(args, 8, args.length));
        if (reason.length() > 500) reason = reason.substring(0, 500);

        SanctionService.Outcome outcome = plugin.getSanctions().apply(
                ref, name, tier, banMinutes, pct, repEffect, issuer, reason);

        switch (outcome.kind()) {
            case OK -> sender.sendMessage("RUCSANCTION OK id=" + outcome.id()
                    + " uuid=" + outcome.target()
                    + " applied=" + (outcome.appliedNow() ? "now" : "pending"));
            case DUPLICATE -> sender.sendMessage("RUCSANCTION DUP id=" + outcome.id()
                    + " uuid=" + outcome.target());
            case NOT_FOUND -> sender.sendMessage("RUCSANCTION NOT_FOUND");
            default -> sender.sendMessage("RUCSANCTION ERROR");
        }
    }

    private void revoke(CommandSender sender, String[] args) {
        if (args.length < 3) {
            sender.sendMessage("RUCSANCTION ERROR usage: revoke <번호> <해제자>");
            return;
        }
        long id;
        try {
            id = Long.parseLong(args[1].replace("#", ""));
        } catch (NumberFormatException e) {
            sender.sendMessage("RUCSANCTION ERROR 숫자 형식");
            return;
        }

        switch (plugin.getSanctions().revoke(id, args[2])) {
            case OK -> sender.sendMessage("RUCSANCTION REVOKED id=" + id);
            case DUPLICATE -> sender.sendMessage("RUCSANCTION ALREADY id=" + id);
            case NOT_FOUND -> sender.sendMessage("RUCSANCTION NOT_FOUND");
            default -> sender.sendMessage("RUCSANCTION ERROR");
        }
    }

    /**
     * 누범 판단 재료. 봇이 다음 단계를 <b>제안</b>하는 데 씁니다 (자동 상향은
     * 하지 않습니다 — 단계는 스태프가 고릅니다).
     */
    private void history(CommandSender sender, String[] args) {
        if (args.length < 2) {
            sender.sendMessage("RUCSANCTION ERROR usage: history <닉네임>");
            return;
        }

        try {
            RucPlayer target = plugin.getPlayerData().getRepository().findByName(args[1]);
            if (target == null) {
                sender.sendMessage("RUCSANCTION NOT_FOUND");
                return;
            }

            List<Sanction> list = plugin.getSanctions().getRepository().history(target.getUuid());
            int confirmed = plugin.getReports().getRepository().confirmedAgainst(target.getUuid());

            long now = System.currentTimeMillis();
            // 해제된 제재는 누범 계산에서 뺍니다 — 오판으로 풀어 준 것까지
            // 세면 억울한 사람이 다음번에 더 무겁게 받습니다.
            List<Sanction> counted = list.stream().filter(s -> s.revokedAt() == null).toList();
            int max = counted.stream().mapToInt(Sanction::tier).max().orElse(0);
            Sanction last = counted.isEmpty() ? null : counted.get(0);
            Sanction active = list.stream().filter(s -> s.activeAt(now)).findFirst().orElse(null);

            StringBuilder ids = new StringBuilder();
            for (int i = 0; i < Math.min(10, list.size()); i++) {
                if (i > 0) ids.append(',');
                Sanction s = list.get(i);
                ids.append(s.id()).append(':').append(s.tier())
                        .append(s.revokedAt() != null ? "r" : "");
            }

            sender.sendMessage("RUCSANCTION HISTORY"
                    + " count=" + counted.size()
                    + " active=" + (active == null ? "-" : active.id() + ":"
                        + (active.permanent() ? "perm" : String.valueOf(active.banUntil())))
                    + " max=" + max
                    + " last=" + (last == null ? 0 : last.tier())
                    + " lastAt=" + (last == null ? 0 : last.createdAt())
                    + " confirmed=" + confirmed
                    + " uuid=" + target.getUuid()
                    + " discord=" + (target.getDiscordId() == null ? "-" : target.getDiscordId())
                    + " ids=" + (ids.isEmpty() ? "-" : ids)
                    + " name=" + target.getName());
        } catch (SQLException e) {
            plugin.getLogger().log(Level.SEVERE, "제재 이력 조회 실패", e);
            sender.sendMessage("RUCSANCTION ERROR");
        }
    }
}
