package kr.rucserver.core.service;

import kr.rucserver.core.RucCore;
import kr.rucserver.core.model.RucPlayer;
import kr.rucserver.core.service.ScoreboardService.ReputationTier;
import kr.rucserver.core.storage.SanctionRepository;
import kr.rucserver.core.storage.SanctionRepository.Sanction;
import net.kyori.adventure.text.Component;
import org.bukkit.Bukkit;
import org.bukkit.entity.Player;

import java.sql.SQLException;
import java.time.Instant;
import java.time.ZoneId;
import java.time.format.DateTimeFormatter;
import java.util.List;
import java.util.UUID;
import java.util.logging.Level;

/**
 * 제재 집행 (Phase 6-7, §3.9 + D5).
 *
 * <h2>정책은 봇에 있습니다</h2>
 * D5 의 10단계 표(몇 시간·몇 %)는 봇(MOOKI)이 들고 있고, 여기는 받은 값을
 * <b>그대로 집행</b>만 합니다. 표를 두 군데 두면 디스코드 밴 기간과 마크 밴
 * 기간이 따로 고쳐져 어긋납니다 (§6.27 과 같은 판단).
 *
 * <h2>무엇을 하는가</h2>
 * <ol>
 *   <li>{@code ruc_sanction} 에 기록 — 이것이 곧 네트워크 밴입니다.
 *       프록시(RucGate)가 로그인 때 봅니다.</li>
 *   <li>이 서버에 접속해 있으면 즉시 몰수·평판 적용 후 킥.
 *       다른 서버에 있으면 프록시가 주기 갱신 때 끊습니다.</li>
 *   <li>여기 없으면 몰수·평판은 <b>다음 데이터 로드 때</b> 적용합니다
 *       ({@link #applyPendingOnLoad}).</li>
 * </ol>
 */
public class SanctionService {

    private static final DateTimeFormatter UNTIL_FORMAT =
            DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm");

    private final RucCore plugin;
    private final SanctionRepository repository;

    public SanctionService(RucCore plugin, SanctionRepository repository) {
        this.plugin = plugin;
        this.repository = repository;
    }

    public SanctionRepository getRepository() { return repository; }

    // ── 집행 ───────────────────────────────────────────────────────────

    /**
     * 제재를 기록하고 가능한 것은 즉시 집행합니다. <b>메인 스레드 전용</b>
     * (RCON 이 동기 응답을 기대합니다 — rucinfo 와 같은 판단).
     */
    public Outcome apply(String ref, String targetName, int tier, long banMinutes,
                         int confiscatePct, String repEffect, String issuedBy, String reason) {
        RucPlayer target;
        try {
            target = plugin.getPlayerData().getRepository().findByName(targetName);
        } catch (SQLException e) {
            plugin.getLogger().log(Level.SEVERE, "제재 대상 조회 실패: " + targetName, e);
            return Outcome.error();
        }
        if (target == null) return new Outcome(Kind.NOT_FOUND, 0, null, false);

        long now = System.currentTimeMillis();
        long banUntil = banMinutes < 0
                ? SanctionRepository.PERMANENT
                : now + banMinutes * 60_000L;

        Sanction draft = new Sanction(0, ref, target.getUuid(), target.getName(), tier,
                reason, issuedBy, now, banUntil, confiscatePct, repEffect,
                false, null, null);

        long id;
        try {
            id = repository.insert(draft);
        } catch (SQLException e) {
            plugin.getLogger().log(Level.SEVERE, "제재 기록 실패: " + targetName, e);
            return Outcome.error();
        }
        if (id == 0) return Outcome.error();
        if (id < 0) {
            // 재시도로 같은 제재가 다시 왔습니다. 이미 들어가 있으므로 성공입니다.
            return new Outcome(Kind.DUPLICATE, -id, target.getUuid(), false);
        }

        Sanction sanction = new Sanction(id, ref, target.getUuid(), target.getName(), tier,
                reason, issuedBy, now, banUntil, confiscatePct, repEffect,
                false, null, null);

        boolean appliedNow = false;
        Player online = Bukkit.getPlayer(target.getUuid());
        RucPlayer cached = plugin.getPlayerData().get(target.getUuid());
        if (online != null && cached != null) {
            // 이 서버에 있습니다. 캐시를 고치고 킥합니다 — 퇴장 처리가 캐시를
            // 저장하므로 DB 를 따로 만질 필요가 없습니다.
            try {
                if (repository.markApplied(id)) {
                    applyEffects(cached, sanction);
                    appliedNow = true;
                }
            } catch (SQLException e) {
                plugin.getLogger().log(Level.WARNING,
                        "제재 즉시 적용 실패 #" + id + " — 다음 접속 때 적용됩니다", e);
            }
        }
        // 데이터가 아직 로드 중이어도 킥은 합니다. 몰수는 다음 로드 때 적용됩니다.
        if (online != null) online.kick(kickMessage(sanction));

        plugin.getLogger().info("[제재] #" + id + " " + target.getName() + " " + tier + "단계"
                + " 밴 " + (banMinutes < 0 ? "영구" : banMinutes + "분")
                + " 몰수 " + confiscatePct + "% 평판 " + repEffect
                + " by " + issuedBy + (appliedNow ? " (즉시 적용)" : " (적용 대기)")
                + " : " + reason);

        return new Outcome(Kind.OK, id, target.getUuid(), appliedNow);
    }

    /** 해제. <b>메인 스레드 전용.</b> */
    public Kind revoke(long id, String by) {
        try {
            Sanction s = repository.find(id);
            if (s == null) return Kind.NOT_FOUND;
            if (!repository.revoke(id, by, System.currentTimeMillis())) {
                return Kind.DUPLICATE;
            }
            plugin.getLogger().info("[제재] #" + id + " 해제 by " + by
                    + " (대상 " + s.targetName() + ")");
            return Kind.OK;
        } catch (SQLException e) {
            plugin.getLogger().log(Level.SEVERE, "제재 해제 실패 #" + id, e);
            return Kind.ERROR;
        }
    }

    /**
     * 미뤄 둔 몰수·평판을 적용합니다. {@link PlayerDataService#loadAsync} 의
     * <b>비동기 스레드에서, 캐시에 넣기 전에</b> 부릅니다.
     *
     * 캐시에 들어가기 전이라 다른 누구도 이 객체를 보고 있지 않습니다. 여기서
     * 고치고 저장하면 끝입니다. 캐시에 넣은 뒤에 하면 그 사이 스코어보드가
     * 옛 잔고를 그리고, 퇴장이 끼어들면 적용이 유실됩니다.
     */
    public void applyPendingOnLoad(RucPlayer data) {
        List<Sanction> pending;
        try {
            pending = repository.unapplied(data.getUuid());
        } catch (SQLException e) {
            plugin.getLogger().log(Level.WARNING, "미적용 제재 조회 실패: " + data.getName(), e);
            return;
        }
        if (pending.isEmpty()) return;

        boolean changed = false;
        for (Sanction s : pending) {
            try {
                // 표시를 먼저 합니다 (§6.21). 반대 순서면 표시 전에 서버가 죽었을 때
                // 다음 로드에서 또 몰수합니다.
                if (!repository.markApplied(s.id())) continue;
            } catch (SQLException e) {
                plugin.getLogger().log(Level.WARNING, "제재 적용 표시 실패 #" + s.id(), e);
                continue;
            }
            applyEffects(data, s);
            changed = true;
        }

        if (changed) {
            try {
                plugin.getPlayerData().getRepository().save(data);
            } catch (SQLException e) {
                // 캐시에는 적용된 값이 들어가므로 퇴장 때 다시 저장됩니다.
                plugin.getLogger().log(Level.WARNING, "제재 적용 후 저장 실패: " + data.getName(), e);
            }
        }
    }

    /** 몰수와 평판. 호출부가 DB 표시를 끝낸 뒤에 부릅니다. */
    private void applyEffects(RucPlayer data, Sanction s) {
        long before = data.getRuc();
        if (s.confiscatePct() > 0 && before > 0) {
            // 내림입니다. 100% 는 정확히 0 이 됩니다.
            long taken = Math.min(before, before * s.confiscatePct() / 100);
            data.setRuc(before - taken);
        }

        int rep = data.getReputation();
        data.setReputation(nextReputation(rep, s.repEffect()));

        plugin.getLogger().info("[제재] #" + s.id() + " 적용 — " + data.getName()
                + " Ruc " + before + " → " + data.getRuc()
                + ", 평판 " + rep + " → " + data.getReputation());
    }

    /**
     * 평판 효과.
     *
     * <ul>
     *   <li>{@code none} — 변화 없음</li>
     *   <li>{@code -50} 같은 숫자 — 그만큼 더함</li>
     *   <li>{@code down1} — 한 티어 강등. 지금 티어 바로 아래 티어의 <b>꼭대기</b>로
     *       갑니다. 한 칸 떨어뜨리는 것이지 바닥까지 떨어뜨리는 게 아닙니다</li>
     *   <li>{@code dark} — 검정 티어로. 이미 더 낮으면 그대로</li>
     * </ul>
     */
    static int nextReputation(int rep, String effect) {
        if (effect == null || effect.isBlank() || effect.equals("none")) return rep;

        if (effect.equals("dark")) {
            return Math.min(rep, ReputationTier.INDIGO.minScore() - 1);
        }
        if (effect.equals("down1")) {
            ReputationTier tier = ReputationTier.of(rep);
            if (tier == ReputationTier.DARK) return rep;
            return tier.minScore() - 1;
        }
        try {
            return rep + Integer.parseInt(effect);
        } catch (NumberFormatException e) {
            return rep;
        }
    }

    // ── 안내 ──────────────────────────────────────────────────────────

    /** 사유는 사람이 쓴 글이라 색코드로 해석하지 않고 글자 그대로 붙입니다. */
    public Component kickMessage(Sanction s) {
        return MessageService.colorize("&c[러크] 제재 " + s.tier() + "단계 (#" + s.id() + ")\n\n&f사유: ")
                .append(Component.text(s.reason(), net.kyori.adventure.text.format.NamedTextColor.GRAY))
                .append(MessageService.colorize("\n&f기간: &7" + untilText(s) + "\n\n"
                        + "&8이의가 있으면 디스코드에서 소명해 주세요."));
    }

    public String untilText(Sanction s) {
        if (s.permanent()) return "영구";
        String zone = plugin.getConfig().getString("timezone", "Asia/Seoul");
        return UNTIL_FORMAT.format(Instant.ofEpochMilli(s.banUntil()).atZone(ZoneId.of(zone)))
                + " 까지";
    }

    // ── 결과 ──────────────────────────────────────────────────────────

    public enum Kind { OK, DUPLICATE, NOT_FOUND, ERROR }

    /**
     * @param appliedNow 몰수·평판이 지금 적용됐는가. false 면 다음 로드 때입니다.
     */
    public record Outcome(Kind kind, long id, UUID target, boolean appliedNow) {
        static Outcome error() { return new Outcome(Kind.ERROR, 0, null, false); }
    }
}
