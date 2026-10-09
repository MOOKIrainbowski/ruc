package kr.rucserver.core.service;

import kr.rucserver.core.RucCore;
import kr.rucserver.core.model.RucPlayer;
import kr.rucserver.core.storage.PaymentRepository;
import kr.rucserver.core.storage.PaymentRepository.Deposit;
import kr.rucserver.core.storage.PaymentRepository.EntitlementRow;
import kr.rucserver.core.storage.PaymentRepository.Order;
import org.bukkit.Bukkit;
import org.bukkit.Material;
import org.bukkit.entity.Player;
import org.bukkit.inventory.ItemStack;
import org.bukkit.scheduler.BukkitTask;

import java.security.SecureRandom;
import java.sql.SQLException;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.UUID;
import java.util.logging.Level;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * 현금 충전 — 주문 · 입금 매칭 · 지급 (docs/payment-design.md).
 *
 * <h2>상품표는 봇에 있습니다</h2>
 * 가격과 "무엇을 주는가" 는 {@code web/content/products.json} 한 곳에 있고, 봇이
 * 주문을 만들 때 금액과 지급 명세({@code grants})를 넘깁니다. 여기는 받은 값을
 * 주문에 적어 두고 <b>그대로 집행</b>만 합니다 — 제재 표(§6.44)와 같은 판단입니다.
 * 주문에 명세를 박아 두므로, 나중에 상품표를 고쳐도 이미 결제한 주문은 결제 당시의
 * 내용으로 지급됩니다.
 *
 * <h2>매칭 규칙 (설계 §2.4)</h2>
 * 코드 일치 + 금액 일치일 때만 자동으로 지급합니다. 조금이라도 다르면
 * {@code REVIEW} 로 보내 사람이 봅니다. 자동 매칭이 틀리는 것보다 늦는 것이 낫습니다.
 *
 * <h2>지급은 몇 번을 다시 해도 같습니다</h2>
 * <ul>
 *   <li>칭호 — {@code ruc_title} 이 (uuid, 키) PK 라 두 번 들어가지 않습니다</li>
 *   <li>권리 — 원장이 (주문, 키) UNIQUE 입니다</li>
 *   <li>아이템 — 우편 사유에 주문 번호를 적고, 이미 있으면 보내지 않습니다</li>
 * </ul>
 * 그래서 지급 도중 서버가 죽어도 "다시 지급" 은 빠진 것만 채웁니다.
 */
public class PaymentService {

    /** 엔더상자 확장 권리 키. */
    public static final String ENDER_PAGES = "ender_pages";

    /**
     * RUC (현금으로 사는 재화, 2026-10-05) 의 원장 키. 충전은 +, RUC 결제는 − 한 줄씩 쌓이고
     * 잔고는 그 합입니다. Gold(옛 Ruc)처럼 접속 캐시에 두지 않으므로 미접속자에게도
     * 바로 쓰고, 환불하면 그 주문의 줄만 회수됩니다.
     */
    public static final String RUC = "ruc";

    /** 후원 등급 = 권리 키 = 디스코드 역할 키. 낮은 것부터 (D7). */
    public static final List<String> RANKS = List.of("vip", "svip", "mvp", "prime", "premium", "elite");

    private static final long DAY = 24L * 60 * 60 * 1000;

    private final RucCore plugin;
    private final PaymentRepository repository;
    private final SecureRandom random = new SecureRandom();
    private BukkitTask expireTask;

    public PaymentService(RucCore plugin, PaymentRepository repository) {
        this.plugin = plugin;
        this.repository = repository;
    }

    public PaymentRepository getRepository() { return repository; }

    public void start() {
        // 만료는 조건부 UPDATE 하나라 4개 서버가 다 돌려도 결과가 같습니다.
        expireTask = Bukkit.getScheduler().runTaskTimerAsynchronously(plugin, () -> {
            try {
                int n = repository.expire(System.currentTimeMillis());
                if (n > 0) plugin.getLogger().info("[충전] 미입금 주문 " + n + "건 만료");
            } catch (SQLException e) {
                plugin.getLogger().log(Level.WARNING, "[충전] 만료 처리 실패", e);
            }
        }, 20L * 30, 20L * 60);
    }

    public void stop() {
        if (expireTask != null) expireTask.cancel();
    }

    private String prefix() {
        return plugin.getConfig().getString("payment.code-prefix", "R").toUpperCase(Locale.ROOT);
    }

    private int maxPending() {
        return plugin.getConfig().getInt("payment.max-pending-orders", 2);
    }

    private long reuseMillis() {
        return plugin.getConfig().getLong("payment.code-reuse-days", 7) * DAY;
    }

    private long cooldownMillis() {
        return plugin.getConfig().getLong("payment.order-cooldown-seconds", 60) * 1000L;
    }

    // ── 주문 ───────────────────────────────────────────────────────────

    /** 주문 생성. <b>메인 스레드 · 블로킹</b> (RCON 이 동기 응답을 기대합니다). */
    public OrderResult createOrder(String discordId, String productId, int amount,
                                   int ttlMinutes, String grants) {
        try {
            List<Grant> parsed = parseGrants(grants);
            if (parsed == null) return OrderResult.of(OrderKind.BAD_GRANTS);

            RucPlayer player = plugin.getPlayerData().getRepository().findByDiscordId(discordId);
            if (player == null) return OrderResult.of(OrderKind.NOT_VERIFIED);

            if (enderCapReached(player.getUuid(), parsed)) return OrderResult.of(OrderKind.CAP);

            long now = System.currentTimeMillis();
            if (repository.countPending(discordId, now) >= maxPending()) {
                return OrderResult.of(OrderKind.LIMIT);
            }
            if (now - repository.lastOrderAt(discordId) < cooldownMillis()) {
                return OrderResult.of(OrderKind.COOLDOWN);
            }

            String code = newCode(prefix(), now);
            if (code == null) return OrderResult.of(OrderKind.ERROR);

            Order draft = Order.draft(code, discordId, player.getUuid(), player.getName(),
                    productId, grants, amount, now, now + ttlMinutes * 60_000L);
            long id = repository.insertOrder(draft);
            if (id <= 0) return OrderResult.of(OrderKind.ERROR);

            repository.log(id, null, "ORDER_CREATE", discordId,
                    productId + " " + amount + "원 " + code + " → " + player.getName());
            plugin.getLogger().info("[충전] 주문 #" + id + " " + code + " " + productId + " "
                    + amount + "원 — " + player.getName());
            return new OrderResult(OrderKind.OK, repository.findOrder(id));
        } catch (SQLException e) {
            plugin.getLogger().log(Level.SEVERE, "[충전] 주문 생성 실패", e);
            return OrderResult.of(OrderKind.ERROR);
        }
    }

    /**
     * 활성 주문 · 최근 7일 주문과 겹치지 않는 코드.
     * 7일 안에 재사용하지 않으므로, 만료 뒤에 늦게 들어온 입금도 어느 주문인지 모호하지 않습니다.
     */
    private String newCode(String prefix, long now) throws SQLException {
        for (int i = 0; i < 40; i++) {
            String code = prefix + (1000 + random.nextInt(9000));
            if (!repository.codeUsedSince(code, now - reuseMillis())) return code;
        }
        return null;
    }

    public Kind cancel(String code, String by, String requiredDiscordId) {
        try {
            Order order = repository.findOrderByCode(code.toUpperCase(Locale.ROOT));
            if (order == null) return Kind.NOT_FOUND;
            if (requiredDiscordId != null && !requiredDiscordId.equals(order.discordId())) {
                return Kind.NOT_FOUND;
            }
            if (!repository.transition(order.id(), "CANCELLED", System.currentTimeMillis(), "PENDING")) {
                return Kind.NOT_PENDING;
            }
            repository.log(order.id(), null, "CANCEL", by, null);
            return Kind.OK;
        } catch (SQLException e) {
            plugin.getLogger().log(Level.SEVERE, "[충전] 주문 취소 실패", e);
            return Kind.ERROR;
        }
    }

    /**
     * 엔더상자 확장은 유료 · 무과금 합쳐 등급별 상한이 있습니다. 상한에 닿은 사람이
     * 돈을 내고 아무것도 못 받는 일이 없도록 주문 단계에서 막습니다.
     */
    private boolean enderCapReached(UUID uuid, List<Grant> grants) throws SQLException {
        int ender = grants.stream().filter(g -> g.type().equals("ender")).mapToInt(Grant::number).sum();
        return ender > 0 && total(uuid, ENDER_PAGES) + ender > enderCap(uuid);
    }

    // ── RUC · Gold 결제 (2026-10-05) ───────────────────────────────────

    /**
     * 결제가 이미 끝난 주문 — RUC · Gold 로 산 것. 현금 주문과 같은 표에 남겨서 지급 ·
     * 재지급 · 디스코드 역할(봇의 {@code rucpay roles}) · 조회가 전부 같은 길을 탑니다.
     * 코드 접두가 현금({@code R})과 달라서 입금자명 매칭에 걸리지 않습니다.
     */
    private Order instantOrder(String codePrefix, RucPlayer player, String productId, int price,
                               String grants, String note, String actor) throws SQLException {
        long now = System.currentTimeMillis();
        String code = newCode(codePrefix, now);
        if (code == null) return null;
        long id = repository.insertOrder(Order.draft(code, player.getDiscordId(), player.getUuid(),
                player.getName(), productId, grants, price, now, now + 60_000L));
        if (id <= 0) return null;
        // 만료 작업이 그 사이에 EXPIRED 로 바꿨어도 결제로 넘깁니다.
        if (!repository.transition(id, "PAID", now, "PENDING", "EXPIRED")) return null;
        repository.setOrderNote(id, note);
        repository.log(id, null, "ORDER_CREATE", actor,
                productId + " " + price + " " + note + " → " + player.getName());
        return repository.findOrder(id);
    }

    /** RUC 잔고. 블로킹. */
    public long rucBalance(UUID uuid) throws SQLException {
        long sum = 0;
        for (EntitlementRow row : repository.entitlements(uuid, RUC)) sum += row.amount();
        return sum;
    }

    /** 이벤트 · 운영 지급. 음수면 차감 (잘못 준 것 회수). 블로킹. */
    public boolean grantRuc(UUID uuid, int amount, String source) throws SQLException {
        return amount != 0 && repository.addEntitlement(uuid, RUC, 0, amount, null, source,
                System.currentTimeMillis());
    }

    /**
     * 디스코드 {@code /충전 결제:RUC} — RUC 를 내고 상품을 받습니다. <b>메인 스레드 · 블로킹.</b>
     * 가격(할인 적용 후)은 봇이 상품표에서 계산해 넘깁니다 — 현금 주문과 같은 판단입니다.
     */
    public RucBuyResult buyWithRuc(String discordId, String productId, int price, String grants) {
        try {
            List<Grant> parsed = parseGrants(grants);
            // RUC 로 RUC 를 사는 것은 막습니다 (RUC 가 RUC 를 낳는 길을 열지 않습니다).
            if (parsed == null || parsed.stream().anyMatch(g -> g.type().equals("ruc"))) {
                return RucBuyResult.of(RucBuyKind.BAD_GRANTS);
            }
            RucPlayer player = plugin.getPlayerData().getRepository().findByDiscordId(discordId);
            if (player == null) return RucBuyResult.of(RucBuyKind.NOT_VERIFIED);
            if (enderCapReached(player.getUuid(), parsed)) return RucBuyResult.of(RucBuyKind.CAP);

            // ponytail: 잔고 확인과 차감 사이에 잠금이 없습니다. RUC 결제는 봇 → 홈 RCON(메인 스레드
            // 하나)으로만 들어와 차례로 처리되므로 겹치지 않습니다. 게임 안에서도 RUC 를 쓰게 되면
            // 차감을 잔고 조건이 붙은 한 문장으로 바꿔야 합니다.
            long balance = rucBalance(player.getUuid());
            if (balance < price) return new RucBuyResult(RucBuyKind.SHORT, null, balance, false);

            Order order = instantOrder("U", player, productId, price, grants, "RUC", discordId);
            if (order == null) return RucBuyResult.of(RucBuyKind.ERROR);
            if (!repository.addEntitlement(player.getUuid(), RUC, 0, -price, order.id(), "spend",
                    System.currentTimeMillis())) {
                repository.transition(order.id(), "CANCELLED", System.currentTimeMillis(), "PAID");
                return RucBuyResult.of(RucBuyKind.ERROR);
            }
            plugin.getLogger().info("[충전] RUC 결제 #" + order.id() + " " + productId + " "
                    + price + " RUC — " + player.getName());
            boolean delivered = deliver(order, discordId);
            return new RucBuyResult(RucBuyKind.OK, repository.findOrder(order.id()), balance - price, delivered);
        } catch (SQLException e) {
            plugin.getLogger().log(Level.SEVERE, "[충전] RUC 결제 실패", e);
            return RucBuyResult.of(RucBuyKind.ERROR);
        }
    }

    /** Gold 로 파는 상품 (config {@code rank-shop}). 없으면 null. */
    public GoldOffer goldOffer(String productId) {
        var section = plugin.getConfig().getConfigurationSection("rank-shop." + productId);
        if (section == null) return null;
        long price = section.getLong("gold");
        String grants = section.getString("grants");
        if (price <= 0 || price > Integer.MAX_VALUE || parseGrants(grants) == null) return null;
        return new GoldOffer(productId, section.getString("name", productId), price,
                section.getString("period", ""), grants);
    }

    /** {@code rank-shop} 의 상품 ID 들. */
    public List<String> goldOfferIds() {
        var section = plugin.getConfig().getConfigurationSection("rank-shop");
        return section == null ? List.of() : List.copyOf(section.getKeys(false));
    }

    /**
     * 게임 안 {@code /등급 구매} — Gold 를 내고 상품을 받습니다. 메인 스레드에서 부릅니다.
     * Gold 는 접속 캐시에 있으므로 먼저 받고(메인 스레드), 주문 기록이 실패하면 돌려줍니다.
     * 기록이 된 뒤의 지급 실패는 돌려주지 않습니다 — 봇이 재지급합니다 (현금과 같음).
     * @param done 메시지 키 ({@code ok} = 성공). 메인 스레드에서 불립니다.
     */
    public void buyWithGold(Player player, GoldOffer offer, java.util.function.Consumer<String> done) {
        RucPlayer data = plugin.getPlayerData().get(player);
        if (data == null || !data.isVerified()) { done.accept("rank.need-verify"); return; }
        if (!plugin.getEconomy().withdraw(player.getUniqueId(), offer.gold())) {
            done.accept("rank.need-gold");
            return;
        }
        Bukkit.getScheduler().runTaskAsynchronously(plugin, () -> {
            String result;
            try {
                Order order = instantOrder("G", data, offer.id(), (int) offer.gold(), offer.grants(),
                        "GOLD", player.getName());
                if (order == null) {
                    result = "rank.error";
                } else {
                    plugin.getLogger().info("[충전] Gold 결제 #" + order.id() + " " + offer.id() + " "
                            + offer.gold() + " Gold — " + player.getName());
                    deliver(order, player.getName());
                    result = "ok";
                }
            } catch (SQLException e) {
                plugin.getLogger().log(Level.SEVERE, "[충전] Gold 결제 실패", e);
                result = "rank.error";
            }
            String outcome = result;
            Bukkit.getScheduler().runTask(plugin, () -> {
                if (!outcome.equals("ok")) plugin.getEconomy().deposit(player.getUniqueId(), offer.gold());
                done.accept(outcome);
            });
        });
    }

    // ── 입금 ───────────────────────────────────────────────────────────

    /**
     * 입금 한 건을 기록하고 매칭합니다. 알림(A) · 관리자 확인(D) 이 전부 여기로 옵니다.
     * <b>메인 스레드 · 블로킹.</b>
     */
    public DepositResult deposit(String source, String externalId, int amount,
                                 String depositor, String actor) {
        long now = System.currentTimeMillis();
        try {
            long id = repository.insertDeposit(Deposit.draft(source, externalId, amount, depositor, now));
            if (id == 0) return DepositResult.error();
            if (id < 0) {
                // 같은 알림의 재전송 — 이미 처리했습니다.
                Deposit existing = repository.findDeposit(-id);
                return new DepositResult(DepositKind.DUPLICATE, existing, null, existing.reason(), false, false);
            }
            repository.log(null, id, "DEPOSIT_IN", actor,
                    source + " " + amount + "원 입금자=" + depositor);
            return match(repository.findDeposit(id), actor, now);
        } catch (SQLException e) {
            plugin.getLogger().log(Level.SEVERE, "[충전] 입금 기록 실패", e);
            return DepositResult.error();
        }
    }

    private DepositResult match(Deposit deposit, String actor, long now) throws SQLException {
        String code = extractCode(deposit.depositor());
        if (code == null) return review(deposit, "NO_CODE", null, actor, now);

        Order order = repository.findOrderByCode(code);
        if (order == null) return review(deposit, "UNKNOWN_CODE", null, actor, now);

        switch (order.status()) {
            case "PENDING", "EXPIRED" -> { }
            case "CANCELLED" -> { return review(deposit, "CANCELLED", order, actor, now); }
            default -> { return review(deposit, "DUPLICATE", order, actor, now); }
        }
        if (order.createdAt() < now - reuseMillis()) {
            return review(deposit, "EXPIRED_OLD", order, actor, now);
        }
        if (deposit.amount() != order.amount()) {
            return review(deposit, "AMOUNT", order, actor, now);
        }
        return pay(deposit, order, "MATCHED", null, actor, now);
    }

    /** 코드 · 금액이 맞았거나 관리자가 연결한 입금으로 주문을 결제 처리하고 지급합니다. */
    private DepositResult pay(Deposit deposit, Order order, String depositStatus, String reason,
                              String actor, long now) throws SQLException {
        boolean late = order.status().equals("EXPIRED") || order.expiresAt() <= now;
        if (!repository.transition(order.id(), "PAID", now, "PENDING", "EXPIRED")) {
            // 다른 경로(자동 매칭 ↔ 관리자 버튼)가 한발 먼저 처리했습니다.
            return review(deposit, "DUPLICATE", repository.findOrder(order.id()), actor, now);
        }
        repository.resolveDeposit(deposit.id(), depositStatus, reason, order.id(), actor, now,
                "NEW", "REVIEW");
        repository.attachDeposit(order.id(), deposit.id());
        repository.log(order.id(), deposit.id(), "MATCH", actor,
                (late ? "늦은 입금 " : "") + deposit.amount() + "원");

        boolean delivered = deliver(repository.findOrder(order.id()), actor);
        return new DepositResult(DepositKind.MATCHED, repository.findDeposit(deposit.id()),
                repository.findOrder(order.id()), reason, delivered, late);
    }

    private DepositResult review(Deposit deposit, String reason, Order order, String actor, long now)
            throws SQLException {
        repository.resolveDeposit(deposit.id(), "REVIEW", reason,
                order == null ? null : order.id(), actor, now, "NEW");
        repository.log(order == null ? null : order.id(), deposit.id(), "REVIEW", actor, reason);
        plugin.getLogger().info("[충전] 입금 #" + deposit.id() + " 확인 필요 — " + reason
                + " (" + deposit.amount() + "원, " + deposit.depositor() + ")");
        return new DepositResult(DepositKind.REVIEW, repository.findDeposit(deposit.id()),
                order, reason, false, false);
    }

    /** 입금자명에서 주문 코드를 찾습니다. 앞뒤에 다른 글자가 붙어 있어도 됩니다. */
    String extractCode(String depositor) {
        if (depositor == null) return null;
        Matcher m = Pattern.compile("(?i)" + Pattern.quote(prefix()) + "\\s*-?\\s*(\\d{4})")
                .matcher(depositor);
        return m.find() ? prefix() + m.group(1) : null;
    }

    // ── 관리자 처리 (D) ────────────────────────────────────────────────

    /** 관리자가 토스 앱을 보고 "입금 확인" 을 눌렀습니다. */
    public DepositResult approve(String code, String admin) {
        try {
            Order order = repository.findOrderByCode(code.toUpperCase(Locale.ROOT));
            if (order == null) return DepositResult.of(DepositKind.NOT_FOUND);
            if (!order.status().equals("PENDING") && !order.status().equals("EXPIRED")) {
                return new DepositResult(DepositKind.NOT_PENDING, null, order, order.status(), false, false);
            }
            // 수동 확인도 입금 한 건으로 남깁니다. 같은 주문에 두 번 누르면 UNIQUE 가 막습니다.
            return deposit("manual", "order-" + order.id(), order.amount(), order.code(), admin);
        } catch (SQLException e) {
            plugin.getLogger().log(Level.SEVERE, "[충전] 수동 확인 실패", e);
            return DepositResult.error();
        }
    }

    /** 확인 대기 입금을 주문에 연결합니다 (코드 오타 · 금액 차이를 사람이 판단). */
    public DepositResult link(long depositId, String code, String admin) {
        long now = System.currentTimeMillis();
        try {
            Deposit deposit = repository.findDeposit(depositId);
            if (deposit == null) return DepositResult.of(DepositKind.NOT_FOUND);
            if (!deposit.status().equals("REVIEW")) {
                return new DepositResult(DepositKind.NOT_REVIEW, deposit, null, deposit.status(), false, false);
            }
            Order order = repository.findOrderByCode(code.toUpperCase(Locale.ROOT));
            if (order == null) return DepositResult.of(DepositKind.NOT_FOUND);
            if (!order.status().equals("PENDING") && !order.status().equals("EXPIRED")) {
                return new DepositResult(DepositKind.NOT_PENDING, deposit, order, order.status(), false, false);
            }
            String note = deposit.amount() == order.amount() ? "LINKED"
                    : "LINKED_DIFF:" + (deposit.amount() - order.amount());
            return pay(deposit, order, "MATCHED", note, admin, now);
        } catch (SQLException e) {
            plugin.getLogger().log(Level.SEVERE, "[충전] 입금 연결 실패", e);
            return DepositResult.error();
        }
    }

    /** 확인 대기 입금을 무시 (테스트 송금 · 본인 이체 등). */
    public Kind ignore(long depositId, String admin) {
        try {
            if (!repository.resolveDeposit(depositId, "IGNORED", null, null, admin,
                    System.currentTimeMillis(), "REVIEW")) {
                return repository.findDeposit(depositId) == null ? Kind.NOT_FOUND : Kind.NOT_PENDING;
            }
            repository.log(null, depositId, "IGNORE", admin, null);
            return Kind.OK;
        } catch (SQLException e) {
            plugin.getLogger().log(Level.SEVERE, "[충전] 입금 무시 처리 실패", e);
            return Kind.ERROR;
        }
    }

    /**
     * 환불 처리됨. 돈은 사람이 토스로 돌려보내고, 여기서는 기록과 권리 회수만 합니다.
     * 이미 지급된 주문이면 칭호 · 권리를 회수합니다. 우편 아이템은 회수할 수 없어
     * 로그에 "수동" 으로 남깁니다.
     */
    public RefundResult refund(long depositId, String admin) {
        long now = System.currentTimeMillis();
        try {
            Deposit deposit = repository.findDeposit(depositId);
            if (deposit == null) return new RefundResult(Kind.NOT_FOUND, null, 0, false);
            if (!repository.resolveDeposit(depositId, "REFUNDED", deposit.reason(), null, admin, now,
                    "REVIEW", "MATCHED")) {
                return new RefundResult(Kind.NOT_PENDING, deposit, 0, false);
            }
            repository.log(deposit.orderId(), depositId, "REFUND", admin, deposit.amount() + "원");

            // 확인 대기 입금(중복 · 금액 차이)은 주문과 무관하게 돈만 돌려줍니다.
            if (!deposit.status().equals("MATCHED") || deposit.orderId() == null) {
                return new RefundResult(Kind.OK, deposit, 0, false);
            }
            Order order = repository.findOrder(deposit.orderId());
            if (order == null || !repository.transition(order.id(), "REFUNDED", now,
                    "PAID", "DELIVERED", "DELIVER_FAILED")) {
                return new RefundResult(Kind.OK, deposit, 0, false);
            }
            Revoked revoked = revokeGrants(order);
            repository.log(order.id(), depositId, "REVOKE", admin,
                    revoked.count + "건 회수" + (revoked.manual ? " · 우편 아이템은 수동 회수 필요" : ""));
            return new RefundResult(Kind.OK, deposit, revoked.count, revoked.manual);
        } catch (SQLException e) {
            plugin.getLogger().log(Level.SEVERE, "[충전] 환불 처리 실패", e);
            return new RefundResult(Kind.ERROR, null, 0, false);
        }
    }

    // ── 지급 ───────────────────────────────────────────────────────────

    /** 결제됐는데 지급이 안 끝난 주문을 다시 지급합니다. */
    public Kind redeliver(long orderId, String actor) {
        try {
            Order order = repository.findOrder(orderId);
            if (order == null) return Kind.NOT_FOUND;
            if (!order.status().equals("PAID") && !order.status().equals("DELIVER_FAILED")) {
                return Kind.NOT_PENDING;
            }
            return deliver(order, actor) ? Kind.OK : Kind.ERROR;
        } catch (SQLException e) {
            plugin.getLogger().log(Level.SEVERE, "[충전] 재지급 실패", e);
            return Kind.ERROR;
        }
    }

    /**
     * 주문의 지급 명세를 집행합니다. 전부 멱등이라 여러 번 불러도 됩니다.
     * @return 전부 성공했는가. 실패하면 주문은 {@code DELIVER_FAILED} 로 남습니다.
     */
    private boolean deliver(Order order, String actor) throws SQLException {
        long now = System.currentTimeMillis();
        List<Grant> grants = parseGrants(order.grants());
        List<String> failed = new ArrayList<>();
        if (grants == null) {
            failed.add("명세 해석 불가: " + order.grants());
        } else {
            for (Grant g : grants) {
                String error = apply(order, g, now);
                if (error != null) failed.add(error);
            }
        }

        if (!failed.isEmpty()) {
            repository.transition(order.id(), "DELIVER_FAILED", now, "PAID", "DELIVER_FAILED");
            repository.log(order.id(), null, "DELIVER_FAIL", actor, String.join(" / ", failed));
            plugin.getLogger().warning("[충전] 주문 #" + order.id() + " 지급 실패 — " + failed);
            return false;
        }

        repository.transition(order.id(), "DELIVERED", now, "PAID", "DELIVER_FAILED");
        repository.log(order.id(), null, "DELIVER", actor, order.grants());
        plugin.getLogger().info("[충전] 주문 #" + order.id() + " 지급 완료 — " + order.playerName()
                + " " + order.productId());

        Bukkit.getScheduler().runTask(plugin, () -> {
            Player online = Bukkit.getPlayer(order.uuid());
            if (online == null) return;
            String lang = plugin.getPlayerData().languageOf(online);
            online.sendMessage(plugin.getMessages().prefixed(lang, "payment.delivered",
                    "product", order.productId()));
        });
        return true;
    }

    /** @return 실패 사유. 성공이면 null. */
    private String apply(Order order, Grant g, long now) {
        try {
            switch (g.type) {
                case "title" -> {
                    if (plugin.getTitles().definition(g.key) == null) return "없는 칭호 " + g.key;
                    if (!plugin.getTitles().grantBlocking(order.uuid(), g.key, "purchase")) {
                        return "칭호 부여 실패 " + g.key;
                    }
                }
                case "ent" -> repository.addEntitlement(order.uuid(), g.key, g.number, 0,
                        order.id(), "purchase", now);
                case "ender" -> repository.addEntitlement(order.uuid(), ENDER_PAGES, 0, g.number,
                        order.id(), "purchase", now);
                case "ruc" -> repository.addEntitlement(order.uuid(), RUC, 0, g.number,
                        order.id(), "purchase", now);
                case "item" -> {
                    Material material = Material.matchMaterial(g.key);
                    if (material == null || !material.isItem()) return "없는 아이템 " + g.key;
                    MailboxService.Result r = plugin.getMailbox().sendItemOnce(order.uuid(),
                            new ItemStack(material, Math.max(1, Math.min(g.number, material.getMaxStackSize()))),
                            "러크 충전", mailReason(order));
                    if (r != MailboxService.Result.OK) return "우편 실패 " + r;
                }
                default -> { return "모르는 지급 " + g.type; }
            }
            return null;
        } catch (SQLException e) {
            plugin.getLogger().log(Level.SEVERE, "[충전] 지급 실패 " + g, e);
            return g.type + " DB 오류";
        }
    }

    /** 우편 사유 — 주문 번호가 들어가 있어야 재지급 때 중복 발송을 막습니다. */
    private static String mailReason(Order order) {
        return "충전 " + order.code() + " #" + order.id();
    }

    private record Revoked(int count, boolean manual) { }

    private Revoked revokeGrants(Order order) throws SQLException {
        List<Grant> grants = parseGrants(order.grants());
        int count = 0;
        boolean manual = false;
        if (grants == null) return new Revoked(0, true);
        for (Grant g : grants) {
            switch (g.type) {
                case "title" -> {
                    // 산 것만 뗍니다. 디스코드 역할로 같은 칭호를 가진 사람이면 남겨 둡니다.
                    boolean purchased = plugin.getTitles().ownedBlocking(order.uuid()).stream()
                            .anyMatch(r -> r.key().equals(g.key) && r.source().equals("purchase"));
                    if (purchased && plugin.getTitles().revokeBlocking(order.uuid(), g.key) > 0) count++;
                }
                case "ent", "ender", "ruc" -> { }
                default -> manual = true;
            }
        }
        count += repository.revokeEntitlements(order.id(), System.currentTimeMillis());
        return new Revoked(count, manual);
    }

    // ── 권리 조회 ──────────────────────────────────────────────────────

    /**
     * 기간제 권리의 만료 시각. 원장을 오래된 순으로 쌓습니다 —
     * 끝난 뒤에 산 것은 산 날부터, 남아 있을 때 산 것은 끝나는 날 뒤로 붙습니다.
     * @return 0 이면 권리 없음
     */
    public long activeUntil(UUID uuid, String key) throws SQLException {
        long until = 0;
        for (EntitlementRow row : repository.entitlements(uuid, key)) {
            if (row.days() <= 0) continue;
            until = Math.max(until, row.createdAt()) + row.days() * DAY;
        }
        return until;
    }

    /** 지금 유효한 가장 높은 후원 등급의 순번 ({@link #RANKS}). 없으면 -1. 블로킹. */
    public int rankLevel(UUID uuid) throws SQLException {
        long now = System.currentTimeMillis();
        for (int i = RANKS.size() - 1; i >= 0; i--) {
            if (activeUntil(uuid, RANKS.get(i)) > now) return i;
        }
        return -1;
    }

    /** MVP 이상인가. Shift+F 엔더상자가 이 등급부터 열립니다 (2026-10-05). 블로킹. */
    public boolean isMvpOrAbove(UUID uuid) throws SQLException {
        return rankLevel(uuid) >= RANKS.indexOf("mvp");
    }

    /**
     * 등급별 엔더상자 확장 상한 — 일반 1 · VIP 2 · SVIP 3, MVP 이상은 {@code ender.max-pages}
     * (2026-10-05 소유자 결정). 값은 config {@code ender.rank-caps}. 블로킹.
     */
    public int enderCap(UUID uuid) throws SQLException {
        int max = plugin.getEnder().maxPages();
        int rank = rankLevel(uuid);
        if (rank >= RANKS.indexOf("mvp")) return max;
        String key = rank < 0 ? "none" : RANKS.get(rank);
        return Math.min(max, plugin.getConfig().getInt("ender.rank-caps." + key));
    }

    /** 개수형 권리(엔더상자 확장 등)의 합. */
    public int total(UUID uuid, String key) throws SQLException {
        int sum = 0;
        for (EntitlementRow row : repository.entitlements(uuid, key)) sum += row.amount();
        return sum;
    }

    /** 끝났는데 디스코드 역할을 아직 떼지 않은 (uuid, 디스코드 ID, 키). 봇이 역할을 뗍니다. */
    public List<String[]> expiredRoles() throws SQLException {
        long now = System.currentTimeMillis();
        List<String[]> out = new ArrayList<>();
        for (String[] pair : repository.roleHolders()) {
            UUID uuid = UUID.fromString(pair[0]);
            if (activeUntil(uuid, pair[1]) > now) continue;
            RucPlayer p = plugin.getPlayerData().getRepository().find(uuid);
            out.add(new String[] { pair[0], p == null || p.getDiscordId() == null ? "-" : p.getDiscordId(), pair[1] });
        }
        return out;
    }

    // ── 지급 명세 ──────────────────────────────────────────────────────

    /**
     * {@code title:supporter,ent:vip:30,ender:1,item:NAME_TAG:1,ruc:10000}
     * @return 해석 실패면 null. 빈 명세도 null (아무것도 안 주는 상품은 실수입니다).
     */
    static List<Grant> parseGrants(String spec) {
        if (spec == null || spec.isBlank() || spec.equals("-")) return null;
        List<Grant> out = new ArrayList<>();
        for (String part : spec.split(",")) {
            String[] f = part.trim().split(":");
            try {
                switch (f[0]) {
                    case "title" -> { if (f.length != 2) return null; out.add(new Grant("title", f[1], 0)); }
                    case "ent" -> {
                        if (f.length != 3) return null;
                        int days = Integer.parseInt(f[2]);
                        if (days <= 0 || days > 3650) return null;
                        out.add(new Grant("ent", f[1], days));
                    }
                    case "ruc" -> {
                        if (f.length != 2) return null;
                        int n = Integer.parseInt(f[1]);
                        if (n <= 0 || n > 1_000_000) return null;
                        out.add(new Grant("ruc", RUC, n));
                    }
                    case "ender" -> {
                        if (f.length != 2) return null;
                        int n = Integer.parseInt(f[1]);
                        if (n <= 0 || n > 10) return null;
                        out.add(new Grant("ender", ENDER_PAGES, n));
                    }
                    case "item" -> {
                        if (f.length != 3) return null;
                        int n = Integer.parseInt(f[2]);
                        if (n <= 0 || n > 64) return null;
                        out.add(new Grant("item", f[1], n));
                    }
                    default -> { return null; }
                }
            } catch (NumberFormatException e) {
                return null;
            }
        }
        return out.isEmpty() ? null : out;
    }

    record Grant(String type, String key, int number) { }

    // ── 결과 ──────────────────────────────────────────────────────────

    public enum Kind { OK, NOT_FOUND, NOT_PENDING, ERROR }

    public enum OrderKind { OK, NOT_VERIFIED, LIMIT, COOLDOWN, BAD_GRANTS, CAP, ERROR }

    public record OrderResult(OrderKind kind, Order order) {
        static OrderResult of(OrderKind kind) { return new OrderResult(kind, null); }
    }

    public enum DepositKind { MATCHED, REVIEW, DUPLICATE, NOT_FOUND, NOT_PENDING, NOT_REVIEW, ERROR }

    public record DepositResult(DepositKind kind, Deposit deposit, Order order, String reason,
                                boolean delivered, boolean late) {
        static DepositResult error() { return of(DepositKind.ERROR); }
        static DepositResult of(DepositKind kind) {
            return new DepositResult(kind, null, null, null, false, false);
        }
    }

    public record RefundResult(Kind kind, Deposit deposit, int revoked, boolean manual) { }

    public enum RucBuyKind { OK, NOT_VERIFIED, SHORT, CAP, BAD_GRANTS, ERROR }

    public record RucBuyResult(RucBuyKind kind, Order order, long balance, boolean delivered) {
        static RucBuyResult of(RucBuyKind kind) { return new RucBuyResult(kind, null, 0, false); }
    }

    public record GoldOffer(String id, String name, long gold, String period, String grants) { }
}
