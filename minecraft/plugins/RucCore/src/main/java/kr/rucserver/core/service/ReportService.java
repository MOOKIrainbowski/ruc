package kr.rucserver.core.service;

import kr.rucserver.core.RucCore;
import kr.rucserver.core.model.RucPlayer;
import kr.rucserver.core.storage.ReportRepository;
import kr.rucserver.core.storage.ReportRepository.Report;
import org.bukkit.Bukkit;
import org.bukkit.entity.Player;

import java.sql.SQLException;
import java.util.List;
import java.util.UUID;
import java.util.function.Consumer;
import java.util.logging.Level;

/**
 * 인게임 신고 (Phase 6-5, §3.8).
 *
 * <h2>접수와 판정은 다릅니다</h2>
 * 신고가 들어왔다고 평판이 바로 내려가면, 남을 지목하는 것만으로 남의 평판을
 * 떨어뜨릴 수 있게 됩니다. 그건 신고가 아니라 괴롭힘 도구입니다.
 *
 * 그래서 이 서비스는 <b>접수</b>만 하고, 평판은 스태프가 <b>확정</b>했을 때만
 * 움직입니다. 기각도 기록으로 남깁니다 — 계속 기각당하는 신고를 넣는 사람도
 * 봐야 할 정보입니다.
 *
 * <h2>디스코드로는 플러그인이 직접 보냅니다</h2>
 * 6-3 에서 만든 웹훅 발송을 그대로 씁니다. 봇을 거칠 이유가 없습니다 —
 * 신고 내용을 정확한 값으로 들고 있는 자리가 여기입니다.
 *
 * 다만 <b>신고 채널은 중계 채널과 분리</b>합니다. 같은 채널로 보내면 입퇴장과
 * 채팅 사이에 신고가 묻힙니다.
 */
public class ReportService {

    private final RucCore plugin;
    private final ReportRepository repository;

    public ReportService(RucCore plugin, ReportRepository repository) {
        this.plugin = plugin;
        this.repository = repository;
    }

    public ReportRepository getRepository() { return repository; }

    // ── 설정 ───────────────────────────────────────────────────────────

    public boolean isEnabled() {
        return plugin.getConfig().getBoolean("report.enabled", true);
    }

    /** 같은 사람이 다시 신고하기까지 기다려야 하는 시간 (초). */
    private long cooldownMillis() {
        return plugin.getConfig().getLong("report.cooldown-seconds", 180) * 1000L;
    }

    private int minReasonLength() {
        return plugin.getConfig().getInt("report.min-reason-length", 5);
    }

    /** 확정 시 깎을 평판. */
    private int penalty() {
        return plugin.getConfig().getInt("report.reputation-penalty", 50);
    }

    // ── 접수 ───────────────────────────────────────────────────────────

    /**
     * 신고 접수. <b>메인 스레드에서 불러도 됩니다</b> (DB 는 안에서 비동기).
     *
     * @param onResult 메인 스레드에서 불립니다.
     */
    public void submit(Player reporter, String targetName, String reason,
                       Consumer<Result> onResult) {
        if (!isEnabled()) {
            done(onResult, Kind.DISABLED, null);
            return;
        }
        if (reason == null || reason.trim().length() < minReasonLength()) {
            done(onResult, Kind.REASON_TOO_SHORT, null);
            return;
        }
        if (reporter.getName().equalsIgnoreCase(targetName)) {
            done(onResult, Kind.SELF, null);
            return;
        }

        UUID reporterId = reporter.getUniqueId();
        String trimmed = reason.trim();
        String serverId = plugin.getConfig().getString("server-id", "unknown");

        Bukkit.getScheduler().runTaskAsynchronously(plugin, () -> {
            // 1) 쿨타임 — 한 사람이 도배하지 못하게. 여러 사람이 같은 사람을
            //    신고하는 것은 정상이므로 중복 자체는 막지 않습니다.
            try {
                long last = repository.lastReportAt(reporterId);
                long wait = last + cooldownMillis() - System.currentTimeMillis();
                if (wait > 0) {
                    done(onResult, Kind.COOLDOWN, String.valueOf((wait / 1000) + 1));
                    return;
                }
            } catch (SQLException e) {
                plugin.getLogger().log(Level.WARNING, "신고 쿨타임 조회 실패", e);
            }

            // 2) 대상이 실제로 있는 사람인지. 오타로 접수되면 스태프가 존재하지
            //    않는 사람을 조사하게 됩니다.
            RucPlayer target;
            try {
                target = plugin.getPlayerData().getRepository().findByName(targetName);
            } catch (SQLException e) {
                plugin.getLogger().log(Level.SEVERE, "신고 대상 조회 실패: " + targetName, e);
                done(onResult, Kind.ERROR, null);
                return;
            }
            if (target == null) {
                done(onResult, Kind.TARGET_NOT_FOUND, null);
                return;
            }
            if (target.getUuid().equals(reporterId)) {
                done(onResult, Kind.SELF, null);
                return;
            }

            // 3) 기록
            long id;
            try {
                id = repository.insert(Report.incoming(reporterId, reporter.getName(),
                        target.getUuid(), target.getName(), trimmed, serverId));
            } catch (SQLException e) {
                plugin.getLogger().log(Level.SEVERE, "신고 기록 실패", e);
                done(onResult, Kind.ERROR, null);
                return;
            }
            if (id < 0) {
                done(onResult, Kind.ERROR, null);
                return;
            }

            // 4) 스태프에게 알립니다 — 디스코드와 접속 중인 스태프 양쪽으로.
            int priorConfirmed = 0;
            try {
                priorConfirmed = repository.confirmedAgainst(target.getUuid());
            } catch (SQLException ignored) {
                // 부가 정보입니다. 못 읽어도 신고는 접수됩니다.
            }

            plugin.getRelay().relayReport(id, reporter.getName(), target.getName(),
                    trimmed, serverId, priorConfirmed);

            final int confirmed = priorConfirmed;
            Bukkit.getScheduler().runTask(plugin, () -> {
                notifyStaff(id, reporter.getName(), target.getName(), trimmed, confirmed);
                if (onResult != null) onResult.accept(new Result(Kind.OK, String.valueOf(id)));
            });

            plugin.getLogger().info("[신고] #" + id + " " + reporter.getName()
                    + " → " + target.getName() + " : " + trimmed);
        });
    }

    /** 접속 중인 스태프에게 즉시 알립니다. 디스코드를 안 보고 있을 수 있습니다. */
    private void notifyStaff(long id, String reporter, String target,
                             String reason, int priorConfirmed) {
        String extra = priorConfirmed > 0 ? " §7(확정 이력 " + priorConfirmed + "건)" : "";
        String line = "§c[신고 #" + id + "] §f" + reporter + " §7→ §f" + target
                + extra + "\n§7  " + reason + "\n§8  /신고처리 " + id + " 확정|기각";

        for (Player staff : Bukkit.getOnlinePlayers()) {
            if (!staff.hasPermission("ruccore.admin")) continue;
            staff.sendMessage(MessageService.colorize(line));
        }
    }

    // ── 판정 ───────────────────────────────────────────────────────────

    /**
     * 스태프 판정. <b>여기서만</b> 평판이 움직입니다.
     *
     * @param confirm true 면 확정(평판 하락), false 면 기각
     */
    public void handle(org.bukkit.command.CommandSender staff, long id, boolean confirm,
                       Consumer<Result> onResult) {
        String who = staff.getName();

        Bukkit.getScheduler().runTaskAsynchronously(plugin, () -> {
            Report report;
            try {
                report = repository.find(id);
            } catch (SQLException e) {
                plugin.getLogger().log(Level.SEVERE, "신고 조회 실패 #" + id, e);
                done(onResult, Kind.ERROR, null);
                return;
            }
            if (report == null) {
                done(onResult, Kind.NOT_FOUND, null);
                return;
            }
            if (!"PENDING".equals(report.status())) {
                done(onResult, Kind.ALREADY_HANDLED, report.status());
                return;
            }

            boolean won;
            try {
                won = repository.handle(id, confirm ? "CONFIRMED" : "REJECTED",
                        who, System.currentTimeMillis());
            } catch (SQLException e) {
                plugin.getLogger().log(Level.SEVERE, "신고 처리 실패 #" + id, e);
                done(onResult, Kind.ERROR, null);
                return;
            }
            if (!won) {
                // 다른 스태프가 먼저 처리했습니다. 평판을 두 번 깎지 않습니다.
                done(onResult, Kind.ALREADY_HANDLED, null);
                return;
            }

            if (confirm) {
                applyPenalty(report);
            }

            plugin.getLogger().info("[신고] #" + id + " "
                    + (confirm ? "확정" : "기각") + " by " + who
                    + " (대상 " + report.targetName() + ")");

            done(onResult, confirm ? Kind.CONFIRMED : Kind.REJECTED,
                    report.targetName());
        });
    }

    /**
     * 평판 하락. <b>비동기에서 부릅니다.</b>
     *
     * 접속 중이면 캐시를 고치고 저장합니다. 접속 중이 아니면 DB 를 직접
     * 고칩니다 — 그 사람이 다른 서버에 있으면 그쪽 캐시가 나중에 덮어쓸 수
     * 있지만, 평판은 우편함처럼 "도착할 곳" 을 따로 둘 성질이 아니고
     * 스태프가 처리하는 시점에 대상이 접속 중인 경우가 대부분입니다.
     * 어긋나면 다시 처리하면 됩니다.
     */
    private void applyPenalty(Report report) {
        int drop = penalty();
        if (drop <= 0) return;

        RucPlayer cached = plugin.getPlayerData().get(report.target());
        if (cached != null) {
            cached.setReputation(cached.getReputation() - drop);
            plugin.getPlayerData().saveAsync(cached);

            Bukkit.getScheduler().runTask(plugin, () -> {
                Player online = Bukkit.getPlayer(report.target());
                if (online == null) return;

                String lang = plugin.getPlayerData().languageOf(online);
                online.sendMessage(plugin.getMessages().prefixed(lang, "report.penalized",
                        "amount", String.valueOf(drop),
                        "reputation", String.valueOf(cached.getReputation())));
                plugin.getScoreboards().attach(online);
            });
            return;
        }

        // 미접속 — DB 에서 직접 내립니다.
        try {
            RucPlayer data = plugin.getPlayerData().getRepository().find(report.target());
            if (data == null) return;
            data.setReputation(data.getReputation() - drop);
            plugin.getPlayerData().getRepository().save(data);
        } catch (SQLException e) {
            plugin.getLogger().log(Level.SEVERE,
                    "평판 하락 적용 실패: " + report.targetName(), e);
        }
    }

    // ── 조회 ───────────────────────────────────────────────────────────

    public void pending(int limit, Consumer<List<Report>> onResult) {
        Bukkit.getScheduler().runTaskAsynchronously(plugin, () -> {
            List<Report> list;
            try {
                list = repository.pending(limit);
            } catch (SQLException e) {
                plugin.getLogger().log(Level.SEVERE, "신고 목록 조회 실패", e);
                list = List.of();
            }
            List<Report> result = list;
            Bukkit.getScheduler().runTask(plugin, () -> onResult.accept(result));
        });
    }

    // ── 도구 ───────────────────────────────────────────────────────────

    private void done(Consumer<Result> onResult, Kind kind, String detail) {
        if (onResult == null) return;
        Result result = new Result(kind, detail == null ? "" : detail);
        if (Bukkit.isPrimaryThread()) {
            onResult.accept(result);
        } else {
            Bukkit.getScheduler().runTask(plugin, () -> onResult.accept(result));
        }
    }

    /** 무슨 일이 일어났는가. */
    public enum Kind {
        OK, DISABLED, SELF, REASON_TOO_SHORT, COOLDOWN, TARGET_NOT_FOUND,
        NOT_FOUND, ALREADY_HANDLED, CONFIRMED, REJECTED, ERROR
    }

    /**
     * 결과와 딸린 값.
     *
     * {@code detail} 에는 쿨타임의 남은 초, 이미 처리된 신고의 상태, 대상
     * 닉네임처럼 호출부가 사람에게 보여 줄 값이 들어갑니다.
     *
     * 값을 enum 에 매달지 않는 이유: 이 결과는 <b>비동기 스레드에서 만들어
     * 메인 스레드에서 읽습니다.</b> enum 은 인스턴스가 하나뿐이라 값을 붙이면
     * 다음 호출이 덮어쓰고, ThreadLocal 로 넘기면 스레드를 건너가면서
     * 사라집니다. 값을 들고 다니려면 값 객체여야 합니다.
     */
    public record Result(Kind kind, String detail) {
        public boolean is(Kind other) { return kind == other; }
    }
}
