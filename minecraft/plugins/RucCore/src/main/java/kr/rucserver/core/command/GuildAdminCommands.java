package kr.rucserver.core.command;

import kr.rucserver.core.RucCore;
import kr.rucserver.core.model.Guild;
import kr.rucserver.core.model.GuildMember;
import kr.rucserver.core.service.EconomyService;
import kr.rucserver.core.service.GuildService;
import org.bukkit.command.Command;
import org.bukkit.command.CommandExecutor;
import org.bukkit.command.CommandSender;
import org.bukkit.command.TabCompleter;
import org.jetbrains.annotations.NotNull;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.Locale;

/**
 * /길드관리 — 스태프·콘솔용 길드 운영 도구.
 *
 * <b>콘솔에서도 동작합니다.</b> RCON 이 유일한 원격 조작 통로이고, 시즌 정산처럼
 * 접속하지 않고 돌려야 하는 작업이 있습니다. 그래서 응답을 색코드 없는 한 줄로
 * 내보내 RCON 으로 읽기 쉽게 합니다.
 *
 * 문구를 messages_*.yml 에 두지 않은 이유: 운영자만 보는 출력이라 번역이 필요
 * 없고, 카탈로그가 커지면 플레이어용 문구를 찾기 어려워집니다.
 */
public class GuildAdminCommands implements CommandExecutor, TabCompleter {

    private static final List<String> SUBS = List.of(
            "목록", "정보", "점수", "국가", "시즌마감", "새로고침");

    private final RucCore plugin;

    public GuildAdminCommands(RucCore plugin) {
        this.plugin = plugin;
    }

    public void register() {
        var command = plugin.getCommand("guildadmin");
        if (command == null) {
            plugin.getLogger().warning("plugin.yml에 'guildadmin' 명령어가 없습니다.");
            return;
        }
        command.setExecutor(this);
        command.setTabCompleter(this);
    }

    @Override
    public boolean onCommand(@NotNull CommandSender sender, @NotNull Command command,
                             @NotNull String label, @NotNull String[] args) {
        GuildService guilds = plugin.getGuilds();

        if (args.length == 0) {
            sender.sendMessage("사용법: /길드관리 <" + String.join("|", SUBS) + ">");
            return true;
        }

        switch (normalize(args[0])) {
            case "목록" -> {
                List<Guild> ranking = guilds.ranking();
                if (ranking.isEmpty()) { sender.sendMessage("길드가 없습니다."); return true; }
                sender.sendMessage("길드 " + ranking.size() + "개 (국가 기준 "
                        + guilds.nationThreshold() + "명):");
                for (Guild guild : ranking) {
                    sender.sendMessage(String.format(
                            "  #%d %s [%s] %s %d명 금고 %s 점수 %s",
                            guild.getId(), guild.getName(), guild.getTag(),
                            guild.isNation() ? "국가" : "길드", guild.size(),
                            EconomyService.format(guild.getBank()),
                            EconomyService.format(guild.getPoints())));
                }
            }

            case "정보" -> {
                if (args.length < 2) { sender.sendMessage("사용법: /길드관리 정보 <길드>"); return true; }
                Guild guild = guilds.byName(args[1]);
                if (guild == null) { sender.sendMessage("그런 길드가 없습니다: " + args[1]); return true; }

                sender.sendMessage("#" + guild.getId() + " " + guild.getName()
                        + " [" + guild.getTag() + "] " + (guild.isNation() ? "국가" : "길드"));
                sender.sendMessage("  금고 " + EconomyService.format(guild.getBank())
                        + " / 점수 " + EconomyService.format(guild.getPoints()));
                for (GuildMember member : guild.membersSorted()) {
                    sender.sendMessage("  - " + member.getName() + " (" + member.getRank()
                            + ", 기여 " + EconomyService.format(member.getContribution()) + ")");
                }
            }

            case "점수" -> {
                if (args.length < 3) {
                    sender.sendMessage("사용법: /길드관리 점수 <길드> <증감>");
                    return true;
                }
                Guild guild = guilds.byName(args[1]);
                if (guild == null) { sender.sendMessage("그런 길드가 없습니다: " + args[1]); return true; }
                long delta;
                try {
                    delta = Long.parseLong(args[2]);
                } catch (NumberFormatException e) {
                    sender.sendMessage("숫자를 입력하세요.");
                    return true;
                }
                guilds.addPoints(guild.getId(), delta);
                sender.sendMessage(guild.getName() + " 점수 " + (delta >= 0 ? "+" : "") + delta
                        + " 적용을 요청했습니다. (반영은 다음 갱신에서 보입니다)");
            }

            case "국가" -> {
                if (args.length < 3) {
                    sender.sendMessage("사용법: /길드관리 국가 <길드> <on|off>");
                    return true;
                }
                Guild guild = guilds.byName(args[1]);
                if (guild == null) { sender.sendMessage("그런 길드가 없습니다: " + args[1]); return true; }

                boolean on = args[2].equalsIgnoreCase("on") || args[2].equals("켜기");
                String name = guild.getName();
                guilds.forceNation(guild.getId(), on, ok -> {
                    if (!ok) { sender.sendMessage("변경에 실패했습니다."); return; }
                    sender.sendMessage(name + " → " + (on ? "국가" : "일반 길드"));
                    // 이 값은 인원 기준으로 다시 계산됩니다. 모르고 쓰면 "왜 되돌아갔지"
                    // 하고 헤매게 되므로 반드시 알립니다.
                    sender.sendMessage("주의: 다음 가입·탈퇴 때 인원(" + guilds.nationThreshold()
                            + "명) 기준으로 다시 계산됩니다.");
                });
            }

            case "시즌마감" -> {
                // 되돌릴 수 없으므로 확인 토큰을 요구합니다.
                if (args.length < 2 || !args[1].equals("확인")) {
                    sender.sendMessage("시즌을 마감하면 순위별 보상이 지급되고 점수가 초기화됩니다.");
                    sender.sendMessage("되돌릴 수 없습니다. 실행: /길드관리 시즌마감 확인");
                    return true;
                }
                // RCON 은 응답을 동기로 기대하므로 비동기 결과가 실려 나가지 않습니다.
                // 그래서 먼저 접수 사실을 알리고, 상세 내역은 서버 로그에 남깁니다.
                sender.sendMessage("시즌 정산을 시작했습니다. 상세 내역은 서버 로그를 보세요.");
                guilds.settleSeason(payouts -> {
                    if (payouts.isEmpty()) { sender.sendMessage("정산할 길드가 없습니다."); return; }
                    sender.sendMessage("시즌 정산 완료 — " + payouts.size() + "개 길드:");
                    for (GuildService.SeasonPayout payout : payouts) {
                        sender.sendMessage(String.format("  %d위 %s (%s점) → 금고 +%s",
                                payout.rank(), payout.guildName(),
                                EconomyService.format(payout.points()),
                                EconomyService.format(payout.reward())));
                    }
                });
            }

            case "새로고침" -> {
                sender.sendMessage("길드 캐시를 다시 읽습니다…");
                guilds.forceRefresh(() -> {
                    String line = "길드 캐시를 다시 읽었습니다. (길드 " + guilds.count() + "개)";
                    sender.sendMessage(line);
                    // 콘솔/RCON 에서는 위 비동기 응답이 도착하지 않으므로 로그로도 냅니다.
                    plugin.getLogger().info(line);
                });
            }

            default -> sender.sendMessage("사용법: /길드관리 <" + String.join("|", SUBS) + ">");
        }
        return true;
    }

    /** 영어 별칭도 받습니다. 콘솔에서 한글 입력이 까다로운 환경이 있습니다. */
    private String normalize(String raw) {
        return switch (raw.toLowerCase(Locale.ROOT)) {
            case "list", "목록" -> "목록";
            case "info", "정보" -> "정보";
            case "points", "점수" -> "점수";
            case "nation", "국가" -> "국가";
            case "season", "시즌마감" -> "시즌마감";
            case "reload", "refresh", "새로고침" -> "새로고침";
            default -> raw;
        };
    }

    @Override
    public List<String> onTabComplete(@NotNull CommandSender sender, @NotNull Command command,
                                      @NotNull String label, @NotNull String[] args) {
        if (args.length == 1) return filter(SUBS, args[0]);

        String sub = normalize(args[0]);
        if (args.length == 2 && List.of("정보", "점수", "국가").contains(sub)) {
            List<String> names = new ArrayList<>();
            for (Guild guild : plugin.getGuilds().all().values()) names.add(guild.getName());
            return filter(names, args[1]);
        }
        if (args.length == 3 && sub.equals("국가")) return filter(List.of("on", "off"), args[2]);
        if (args.length == 2 && sub.equals("시즌마감")) return filter(List.of("확인"), args[1]);
        return Collections.emptyList();
    }

    private List<String> filter(List<String> options, String prefix) {
        String lower = prefix.toLowerCase(Locale.ROOT);
        List<String> result = new ArrayList<>();
        for (String option : options) {
            if (option.toLowerCase(Locale.ROOT).startsWith(lower)) result.add(option);
        }
        return result;
    }
}
