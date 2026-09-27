package kr.rucserver.war.service;

import kr.rucserver.war.RucWar;
import org.bukkit.Bukkit;
import org.bukkit.Sound;
import org.bukkit.entity.Player;
import org.bukkit.scheduler.BukkitTask;

import java.time.DayOfWeek;
import java.time.Duration;
import java.time.LocalTime;
import java.time.ZoneId;
import java.time.ZonedDateTime;
import java.time.format.DateTimeParseException;
import java.util.ArrayList;
import java.util.EnumSet;
import java.util.List;
import java.util.Locale;
import java.util.Set;

/**
 * 전쟁 시간대 (§2.6).
 *
 * 이 시간대에만 코어를 설치할 수 있고 영토를 탈취할 수 있습니다. 그 외
 * 시간에는 자기 영토에서 자원을 모으고 장비를 강화합니다.
 *
 * <h2>왜 "현재 열려 있는가" 를 계산으로만 판단하나</h2>
 * 개전·종전을 이벤트로만 관리하면, 시간대 도중에 서버가 재시작되면 그 사이의
 * 전환을 놓쳐서 영원히 평시이거나 영원히 전시가 됩니다. 항상 현재 시각으로
 * 계산하고, 상태가 바뀌는 순간만 알림에 씁니다.
 */
public class WarScheduleService {

    private final RucWar plugin;

    private final boolean enabled;
    private final Set<DayOfWeek> days;
    private final LocalTime start;
    private final LocalTime end;
    private final ZoneId zone;

    /** 직전 점검에서 전쟁이 열려 있었는지. 전환 순간을 잡는 데만 씁니다. */
    private boolean wasOpen;

    /** 이미 안내한 남은 시간(분). 같은 분에 두 번 알리지 않게 합니다. */
    private final Set<Integer> warned = new java.util.HashSet<>();

    private BukkitTask task;

    public WarScheduleService(RucWar plugin) {
        this.plugin = plugin;
        this.enabled = plugin.getConfig().getBoolean("war.enabled", true);
        this.zone = resolveZone();
        this.days = parseDays(plugin.getConfig().getStringList("war.days"));
        this.start = parseTime(plugin.getConfig().getString("war.start", "20:00"), LocalTime.of(20, 0));
        this.end = parseTime(plugin.getConfig().getString("war.end", "22:00"), LocalTime.of(22, 0));
    }

    /**
     * 기준 시간대. RucCore 의 {@code timezone} 을 따릅니다.
     *
     * 서버의 시스템 시간대를 쓰지 않는 이유: 운영 VPS 가 UTC 인 경우가 많고,
     * 그러면 "저녁 8시" 가 실제로는 새벽 5시가 됩니다.
     */
    private ZoneId resolveZone() {
        String id = plugin.core().getConfig().getString("timezone", "Asia/Seoul");
        try {
            return ZoneId.of(id);
        } catch (Exception e) {
            plugin.getLogger().warning("알 수 없는 시간대 '" + id + "' — 시스템 기본값을 씁니다.");
            return ZoneId.systemDefault();
        }
    }

    private Set<DayOfWeek> parseDays(List<String> raw) {
        if (raw == null || raw.isEmpty()) return EnumSet.allOf(DayOfWeek.class);

        Set<DayOfWeek> out = EnumSet.noneOf(DayOfWeek.class);
        for (String token : raw) {
            DayOfWeek day = dayOf(token);
            if (day == null) {
                plugin.getLogger().warning("알 수 없는 요일 '" + token + "' — 무시합니다.");
                continue;
            }
            out.add(day);
        }
        // 전부 잘못 적혀 있으면 매일로 둡니다. 빈 집합이면 전쟁이 영원히 열리지
        // 않는데, 설정 오타 하나로 서버의 핵심 콘텐츠가 사라지는 것은 과합니다.
        if (out.isEmpty()) {
            plugin.getLogger().warning("war.days 가 모두 유효하지 않습니다 — 매일로 둡니다.");
            return EnumSet.allOf(DayOfWeek.class);
        }
        return out;
    }

    /** 한국어 요일과 영어 약어를 모두 받습니다. */
    private DayOfWeek dayOf(String token) {
        return switch (token.trim().toLowerCase(Locale.ROOT)) {
            case "월", "월요일", "mon", "monday" -> DayOfWeek.MONDAY;
            case "화", "화요일", "tue", "tuesday" -> DayOfWeek.TUESDAY;
            case "수", "수요일", "wed", "wednesday" -> DayOfWeek.WEDNESDAY;
            case "목", "목요일", "thu", "thursday" -> DayOfWeek.THURSDAY;
            case "금", "금요일", "fri", "friday" -> DayOfWeek.FRIDAY;
            case "토", "토요일", "sat", "saturday" -> DayOfWeek.SATURDAY;
            case "일", "일요일", "sun", "sunday" -> DayOfWeek.SUNDAY;
            default -> null;
        };
    }

    private LocalTime parseTime(String raw, LocalTime fallback) {
        try {
            return LocalTime.parse(raw);
        } catch (DateTimeParseException e) {
            plugin.getLogger().warning("시각 '" + raw + "' 을 읽을 수 없습니다 — "
                    + fallback + " 을 씁니다. (HH:mm 형식)");
            return fallback;
        }
    }

    // ── 수명 주기 ──────────────────────────────────────────────────────

    public void start() {
        wasOpen = isOpen();
        plugin.getLogger().info("전쟁 시간대: " + describe()
                + (wasOpen ? " — 지금 개전 중" : " — 지금 평시"));

        // 1초마다 보면 전환을 놓치지 않고, 남은 시간 안내도 분 단위로 맞습니다.
        task = Bukkit.getScheduler().runTaskTimer(plugin, this::tick, 20L, 20L);
    }

    public void stop() {
        if (task != null) task.cancel();
    }

    private void tick() {
        boolean open = isOpen();

        if (open != wasOpen) {
            wasOpen = open;
            warned.clear();
            if (open) onWarOpen();
            else onWarClose();
            return;
        }

        // 개전 예고. 평시에만 의미가 있습니다.
        if (!open) {
            long minutes = minutesUntilOpen();
            for (int mark : plugin.getConfig().getIntegerList("war.warn-minutes")) {
                if (minutes == mark && warned.add(mark)) {
                    plugin.msg().broadcastAll("war.opening-soon",
                            "minutes", String.valueOf(mark));
                }
            }
        }
    }

    private void onWarOpen() {
        plugin.getLogger().info("전쟁 시간대 시작");
        plugin.msg().broadcastAll("war.opened", "end", end.toString());
        for (Player player : Bukkit.getOnlinePlayers()) {
            plugin.msg().sendTitle(player, "war.title-opened", "war.subtitle-opened");
            player.playSound(player.getLocation(), Sound.EVENT_RAID_HORN, 1.0f, 1.0f);
        }
    }

    private void onWarClose() {
        plugin.getLogger().info("전쟁 시간대 종료 — 살아남은 코어를 영토로 확정합니다.");
        plugin.msg().broadcastAll("war.closed");
        for (Player player : Bukkit.getOnlinePlayers()) {
            plugin.msg().sendTitle(player, "war.title-closed", "war.subtitle-closed");
        }
        // 방어에 성공한 코어를 확정합니다 (§2.6).
        plugin.getTerritory().confirmSurvivors();
    }

    // ── 판정 ──────────────────────────────────────────────────────────

    /** 지금 전쟁 시간대인지. */
    public boolean isOpen() {
        if (!enabled) return false;

        ZonedDateTime now = ZonedDateTime.now(zone);
        LocalTime time = now.toLocalTime();

        // 자정을 넘는 시간대(예: 22:00~01:00)는 시작일과 종료일이 다릅니다.
        // 오늘 새벽 구간은 "어제 시작한 전쟁" 이므로 어제 요일로 판정합니다.
        if (end.isBefore(start)) {
            if (!time.isBefore(start)) {
                return days.contains(now.getDayOfWeek());
            }
            if (time.isBefore(end)) {
                return days.contains(now.minusDays(1).getDayOfWeek());
            }
            return false;
        }

        if (!days.contains(now.getDayOfWeek())) return false;
        return !time.isBefore(start) && time.isBefore(end);
    }

    /** 다음 개전까지 남은 분. 이미 열려 있으면 0. */
    public long minutesUntilOpen() {
        if (isOpen()) return 0;

        ZonedDateTime now = ZonedDateTime.now(zone);
        // 최대 8일을 훑습니다. 요일이 하나만 지정되어 있으면 7일 뒤가 답이고,
        // 오늘 시작 시각이 이미 지났으면 다음 해당 요일이므로 여유를 둡니다.
        for (int i = 0; i <= 8; i++) {
            ZonedDateTime day = now.plusDays(i);
            if (!days.contains(day.getDayOfWeek())) continue;

            ZonedDateTime open = day.with(start);
            if (open.isAfter(now)) {
                return Duration.between(now, open).toMinutes();
            }
        }
        return -1;
    }

    /** 종전까지 남은 분. 평시면 -1. */
    public long minutesUntilClose() {
        if (!isOpen()) return -1;

        ZonedDateTime now = ZonedDateTime.now(zone);
        ZonedDateTime close = now.with(end);
        // 자정을 넘는 시간대에서 새벽 구간이면 종료는 오늘, 저녁 구간이면 내일입니다.
        if (end.isBefore(start) && !now.toLocalTime().isBefore(start)) {
            close = close.plusDays(1);
        }
        return Math.max(0, Duration.between(now, close).toMinutes());
    }

    /** "매일 20:00~22:00" 같은 사람이 읽는 문구. */
    public String describe() {
        String dayPart = days.size() == 7 ? "매일" : String.join("·", koreanDays());
        return dayPart + " " + start + "~" + end + " (" + zone.getId() + ")";
    }

    private List<String> koreanDays() {
        List<String> out = new ArrayList<>();
        for (DayOfWeek day : DayOfWeek.values()) {
            if (!days.contains(day)) continue;
            out.add(switch (day) {
                case MONDAY -> "월";
                case TUESDAY -> "화";
                case WEDNESDAY -> "수";
                case THURSDAY -> "목";
                case FRIDAY -> "금";
                case SATURDAY -> "토";
                case SUNDAY -> "일";
            });
        }
        return out;
    }

    public ZoneId zone() { return zone; }
    public boolean isEnabled() { return enabled; }
}
