package kr.rucserver.core.command;

import kr.rucserver.core.RucCore;
import kr.rucserver.core.service.MessageService;
import kr.rucserver.core.service.PaymentService;
import kr.rucserver.core.service.PaymentService.DepositResult;
import kr.rucserver.core.service.PaymentService.OrderResult;
import kr.rucserver.core.service.PaymentService.RefundResult;
import kr.rucserver.core.storage.PaymentRepository.Deposit;
import kr.rucserver.core.storage.PaymentRepository.Order;
import net.kyori.adventure.text.Component;
import net.kyori.adventure.text.event.ClickEvent;
import net.kyori.adventure.text.event.HoverEvent;
import net.kyori.adventure.text.format.NamedTextColor;
import net.kyori.adventure.text.format.TextDecoration;
import org.bukkit.command.Command;
import org.bukkit.command.CommandExecutor;
import org.bukkit.command.CommandSender;
import org.bukkit.entity.Player;
import org.jetbrains.annotations.NotNull;

import java.sql.SQLException;
import java.util.List;
import java.util.Locale;
import java.util.logging.Level;

/**
 * 현금 충전 명령 둘.
 *
 * <h2>{@code /충전} (플레이어) — 디스코드로 안내만</h2>
 * 구매는 디스코드 {@code /충전} 에서만 합니다 (2026-10-02 소유자 결정). 게임 안에서
 * 사려고 하면 디스코드 초대 링크와 명령어를 보여 줍니다. 결제를 게임 안에 두지 않는
 * 이유: 누구에게 줄지를 정하는 근거가 디스코드 인증(D10)이고, 관리자 확인 · 알림이
 * 전부 디스코드에서 일어납니다.
 *
 * <h2>{@code /rucpay} (RCON 전용) — 봇의 결제 모듈이 부릅니다</h2>
 * 다른 RCON 명령과 같이 한 줄 응답 {@code RUCPAY <결과> key=value...} 입니다.
 * <pre>
 * rucpay order &lt;디스코드ID&gt; &lt;상품ID&gt; &lt;금액&gt; &lt;유효분&gt; &lt;지급명세&gt;
 *   → RUCPAY ORDER id= code= amount= expires= name= uuid=
 *   → RUCPAY NOT_VERIFIED | LIMIT | COOLDOWN | BAD_GRANTS | ERROR
 * rucpay deposit &lt;source&gt; &lt;외부ID&gt; &lt;금액&gt; &lt;입금자명...&gt;
 *   → RUCPAY DEPOSIT id= result=MATCHED|REVIEW reason= order= code= delivered=0|1 late=0|1 ...
 *   → RUCPAY DUP id= result=&lt;그때 상태&gt;
 * rucpay approve &lt;코드&gt; &lt;관리자&gt;          (D — 관리자가 토스 앱을 보고 확인)
 * rucpay link &lt;입금ID&gt; &lt;코드&gt; &lt;관리자&gt;    (확인 대기 입금을 주문에 연결)
 * rucpay refund &lt;입금ID&gt; &lt;관리자&gt;
 * rucpay ignore &lt;입금ID&gt; &lt;관리자&gt;
 * rucpay cancel &lt;코드&gt; &lt;요청자&gt; [디스코드ID]
 * rucpay redeliver &lt;주문ID&gt; &lt;요청자&gt;
 * rucpay status &lt;코드|#주문ID&gt;
 * rucpay lookup &lt;디스코드ID|닉네임&gt;
 * rucpay review                     → 확인 대기 입금 목록
 * rucpay failed                     → 지급 실패 주문 목록
 * rucpay roles                      → 디스코드 역할을 아직 안 준 지급 완료 주문
 * rucpay roles-done &lt;주문ID&gt;
 * rucpay expired                    → 끝났는데 역할을 안 뗀 기간제 권리
 * rucpay expired-done &lt;uuid&gt; &lt;키&gt;
 * </pre>
 * 목록 응답은 {@code items=a:b:c;d:e:f} 형식이고, 값 안의 공백 · 구분자는 {@code _} 로 바꿉니다.
 */
public class PaymentCommands implements CommandExecutor {

    private static final String USAGE = "RUCPAY ERROR usage: order|deposit|approve|link|refund|ignore|"
            + "cancel|redeliver|status|lookup|review|failed|roles|roles-done|expired|expired-done";

    private final RucCore plugin;
    private final MessageService messages;

    public PaymentCommands(RucCore plugin, MessageService messages) {
        this.plugin = plugin;
        this.messages = messages;
    }

    public void register() {
        var pay = plugin.getCommand("rucpay");
        var charge = plugin.getCommand("charge");
        if (pay == null || charge == null) {
            plugin.getLogger().warning("plugin.yml에 'rucpay' 또는 'charge' 명령어가 없습니다.");
            return;
        }
        pay.setExecutor(this);
        charge.setExecutor(this::onCharge);
    }

    // ── /충전 (플레이어) ───────────────────────────────────────────────

    private boolean onCharge(CommandSender sender, Command command, String label, String[] args) {
        String lang = sender instanceof Player p ? plugin.getPlayerData().languageOf(p) : "ko";
        String invite = plugin.getConfig().getString("payment.discord-invite", "https://discord.gg/K3Z5CDn3GK");

        sender.sendMessage(messages.prefixed(lang, "payment.redirect"));
        sender.sendMessage(Component.text("  ▶ ", NamedTextColor.GRAY)
                .append(Component.text(messages.raw(lang, "payment.redirect-link"), NamedTextColor.AQUA)
                        .decorate(TextDecoration.UNDERLINED)
                        .clickEvent(ClickEvent.openUrl(invite))
                        .hoverEvent(HoverEvent.showText(Component.text(invite)))));
        sender.sendMessage(messages.get(lang, "payment.redirect-how"));
        return true;
    }

    // ── /rucpay (RCON) ─────────────────────────────────────────────────

    @Override
    public boolean onCommand(@NotNull CommandSender sender, @NotNull Command command,
                             @NotNull String label, @NotNull String[] args) {
        if (sender instanceof Player) {
            // 게임 안에서 부르면 디스코드 쪽(관리자 기록 · 역할 · DM)이 빠진 처리가 됩니다.
            sender.sendMessage("이 명령어는 콘솔에서만 사용할 수 있습니다.");
            return true;
        }
        if (args.length == 0) {
            sender.sendMessage(USAGE);
            return true;
        }
        PaymentService pay = plugin.getPayments();
        try {
            switch (args[0].toLowerCase(Locale.ROOT)) {
                case "order" -> order(sender, pay, args);
                case "deposit" -> deposit(sender, pay, args);
                case "approve" -> {
                    if (need(sender, args, 3, "approve <코드> <관리자>")) return true;
                    sender.sendMessage(depositLine(pay.approve(args[1], args[2])));
                }
                case "link" -> {
                    if (need(sender, args, 4, "link <입금ID> <코드> <관리자>")) return true;
                    sender.sendMessage(depositLine(pay.link(id(args[1]), args[2], args[3])));
                }
                case "refund" -> {
                    if (need(sender, args, 3, "refund <입금ID> <관리자>")) return true;
                    RefundResult r = pay.refund(id(args[1]), args[2]);
                    sender.sendMessage(switch (r.kind()) {
                        case OK -> "RUCPAY REFUNDED deposit=" + r.deposit().id()
                                + " order=" + (r.deposit().orderId() == null ? "-" : r.deposit().orderId())
                                + " revoked=" + r.revoked() + " manual=" + (r.manual() ? 1 : 0);
                        case NOT_FOUND -> "RUCPAY NOT_FOUND";
                        case NOT_PENDING -> "RUCPAY NOT_PENDING status=" + r.deposit().status();
                        default -> "RUCPAY ERROR";
                    });
                }
                case "ignore" -> {
                    if (need(sender, args, 3, "ignore <입금ID> <관리자>")) return true;
                    sender.sendMessage("RUCPAY " + switch (pay.ignore(id(args[1]), args[2])) {
                        case OK -> "IGNORED";
                        case NOT_FOUND -> "NOT_FOUND";
                        case NOT_PENDING -> "NOT_PENDING";
                        default -> "ERROR";
                    });
                }
                case "cancel" -> {
                    if (need(sender, args, 3, "cancel <코드> <요청자> [디스코드ID]")) return true;
                    String owner = args.length >= 4 ? args[3] : null;
                    sender.sendMessage("RUCPAY " + switch (pay.cancel(args[1], args[2], owner)) {
                        case OK -> "CANCELLED";
                        case NOT_FOUND -> "NOT_FOUND";
                        case NOT_PENDING -> "NOT_PENDING";
                        default -> "ERROR";
                    });
                }
                case "redeliver" -> {
                    if (need(sender, args, 3, "redeliver <주문ID> <요청자>")) return true;
                    long orderId = id(args[1]);
                    PaymentService.Kind k = pay.redeliver(orderId, args[2]);
                    sender.sendMessage(switch (k) {
                        case OK -> "RUCPAY DELIVERED order=" + orderId;
                        case NOT_FOUND -> "RUCPAY NOT_FOUND";
                        case NOT_PENDING -> "RUCPAY NOT_PENDING";
                        default -> "RUCPAY DELIVER_FAILED order=" + orderId;
                    });
                }
                case "status" -> {
                    if (need(sender, args, 2, "status <코드|#주문ID>")) return true;
                    Order o = args[1].startsWith("#")
                            ? pay.getRepository().findOrder(id(args[1]))
                            : pay.getRepository().findOrderByCode(args[1].toUpperCase(Locale.ROOT));
                    sender.sendMessage(o == null ? "RUCPAY NOT_FOUND" : "RUCPAY STATUS " + orderFields(o));
                }
                case "lookup" -> {
                    if (need(sender, args, 2, "lookup <디스코드ID|닉네임>")) return true;
                    List<Order> list = pay.getRepository().recentOrders(args[1], 10);
                    StringBuilder items = new StringBuilder();
                    for (Order o : list) {
                        if (!items.isEmpty()) items.append(';');
                        items.append(o.id()).append(':').append(o.code()).append(':').append(o.status())
                                .append(':').append(safe(o.productId())).append(':').append(o.amount())
                                .append(':').append(o.createdAt());
                    }
                    sender.sendMessage("RUCPAY LOOKUP count=" + list.size()
                            + " items=" + (items.isEmpty() ? "-" : items));
                }
                case "review" -> {
                    List<Deposit> list = pay.getRepository().depositsByStatus("REVIEW", 20);
                    StringBuilder items = new StringBuilder();
                    for (Deposit d : list) {
                        if (!items.isEmpty()) items.append(';');
                        items.append(d.id()).append(':').append(d.amount()).append(':')
                                .append(safe(d.depositor())).append(':').append(safe(d.reason()))
                                .append(':').append(d.orderId() == null ? "-" : d.orderId())
                                .append(':').append(d.receivedAt());
                    }
                    sender.sendMessage("RUCPAY REVIEW count=" + list.size()
                            + " items=" + (items.isEmpty() ? "-" : items));
                }
                case "failed" -> sender.sendMessage("RUCPAY FAILED " + orderList(
                        pay.getRepository().deliverFailed(20)));
                case "roles" -> sender.sendMessage("RUCPAY ROLES " + orderList(
                        pay.getRepository().discordPending(20)));
                case "roles-done" -> {
                    if (need(sender, args, 2, "roles-done <주문ID>")) return true;
                    boolean ok = pay.getRepository().markDiscordDone(id(args[1]));
                    sender.sendMessage(ok ? "RUCPAY OK" : "RUCPAY ALREADY");
                }
                case "expired" -> {
                    List<String[]> list = pay.expiredRoles();
                    StringBuilder items = new StringBuilder();
                    for (String[] row : list) {
                        if (!items.isEmpty()) items.append(';');
                        items.append(row[0]).append(':').append(row[1]).append(':').append(safe(row[2]));
                    }
                    sender.sendMessage("RUCPAY EXPIRED count=" + list.size()
                            + " items=" + (items.isEmpty() ? "-" : items));
                }
                case "expired-done" -> {
                    if (need(sender, args, 3, "expired-done <uuid> <키>")) return true;
                    int n = pay.getRepository().markRoleCleared(java.util.UUID.fromString(args[1]), args[2]);
                    sender.sendMessage("RUCPAY OK rows=" + n);
                }
                default -> sender.sendMessage(USAGE);
            }
        } catch (NumberFormatException e) {
            sender.sendMessage("RUCPAY ERROR 숫자 형식");
        } catch (IllegalArgumentException e) {
            sender.sendMessage("RUCPAY ERROR 형식 " + e.getMessage());
        } catch (SQLException e) {
            plugin.getLogger().log(Level.SEVERE, "[충전] rucpay " + args[0] + " 실패", e);
            sender.sendMessage("RUCPAY ERROR");
        }
        return true;
    }

    private void order(CommandSender sender, PaymentService pay, String[] args) {
        if (need(sender, args, 6, "order <디스코드ID> <상품ID> <금액> <유효분> <지급명세>")) return;
        int amount = Integer.parseInt(args[3]);
        int ttl = Integer.parseInt(args[4]);
        if (amount <= 0 || amount > 1_000_000 || ttl < 5 || ttl > 1440 || args[2].length() > 32
                || args[5].length() > 255) {
            sender.sendMessage("RUCPAY ERROR 범위");
            return;
        }
        OrderResult r = pay.createOrder(args[1], args[2], amount, ttl, args[5]);
        if (r.kind() != PaymentService.OrderKind.OK) {
            sender.sendMessage("RUCPAY " + r.kind().name());
            return;
        }
        Order o = r.order();
        sender.sendMessage("RUCPAY ORDER id=" + o.id() + " code=" + o.code() + " amount=" + o.amount()
                + " expires=" + o.expiresAt() + " name=" + o.playerName() + " uuid=" + o.uuid());
    }

    private void deposit(CommandSender sender, PaymentService pay, String[] args) {
        if (need(sender, args, 5, "deposit <source> <외부ID> <금액> <입금자명...>")) return;
        String source = args[1].toLowerCase(Locale.ROOT);
        if (!source.matches("[a-z]{2,16}") || args[2].length() > 64) {
            sender.sendMessage("RUCPAY ERROR 범위");
            return;
        }
        int amount = Integer.parseInt(args[3]);
        if (amount <= 0) {
            sender.sendMessage("RUCPAY ERROR 범위");
            return;
        }
        String depositor = String.join(" ", java.util.Arrays.copyOfRange(args, 4, args.length));
        if (depositor.length() > 64) depositor = depositor.substring(0, 64);
        sender.sendMessage(depositLine(pay.deposit(source, args[2], amount, depositor, source)));
    }

    // ── 응답 조립 ──────────────────────────────────────────────────────

    private String depositLine(DepositResult r) {
        return switch (r.kind()) {
            case MATCHED, REVIEW -> "RUCPAY DEPOSIT id=" + r.deposit().id()
                    + " result=" + r.kind().name()
                    + " reason=" + safe(r.reason())
                    + " delivered=" + (r.delivered() ? 1 : 0)
                    + " late=" + (r.late() ? 1 : 0)
                    + " amount=" + r.deposit().amount()
                    + " depositor=" + safe(r.deposit().depositor())
                    + (r.order() == null ? " order=-" : " " + orderFields(r.order()));
            case DUPLICATE -> "RUCPAY DUP id=" + r.deposit().id() + " result=" + r.deposit().status()
                    + " order=" + (r.deposit().orderId() == null ? "-" : r.deposit().orderId());
            case NOT_FOUND -> "RUCPAY NOT_FOUND";
            case NOT_PENDING -> "RUCPAY NOT_PENDING status=" + safe(r.reason());
            case NOT_REVIEW -> "RUCPAY NOT_REVIEW status=" + safe(r.reason());
            default -> "RUCPAY ERROR";
        };
    }

    /** 주문 한 건을 key=value 로. 봇이 같은 파서로 읽습니다. */
    private String orderFields(Order o) {
        return "order=" + o.id() + " code=" + o.code() + " status=" + o.status()
                + " product=" + safe(o.productId()) + " price=" + o.amount()
                + " discord=" + o.discordId() + " name=" + o.playerName() + " uuid=" + o.uuid()
                + " created=" + o.createdAt() + " expires=" + o.expiresAt()
                + " grants=" + safe(o.grants());
    }

    private String orderList(List<Order> list) {
        StringBuilder items = new StringBuilder();
        for (Order o : list) {
            if (!items.isEmpty()) items.append(';');
            items.append(o.id()).append(':').append(o.discordId()).append(':')
                    .append(safe(o.productId())).append(':').append(o.code());
        }
        return "count=" + list.size() + " items=" + (items.isEmpty() ? "-" : items);
    }

    /** 응답 한 칸에 들어가게 — 공백과 구분자를 바꿉니다. */
    private static String safe(String s) {
        if (s == null || s.isEmpty()) return "-";
        return s.replaceAll("[\\s;=]+", "_").replace(':', '_').replace(',', '+');
    }

    private static long id(String s) {
        return Long.parseLong(s.replace("#", ""));
    }

    private static boolean need(CommandSender sender, String[] args, int n, String usage) {
        if (args.length >= n) return false;
        sender.sendMessage("RUCPAY ERROR usage: " + usage);
        return true;
    }
}
