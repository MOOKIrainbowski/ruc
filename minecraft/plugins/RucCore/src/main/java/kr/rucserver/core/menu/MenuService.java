package kr.rucserver.core.menu;

import kr.rucserver.core.RucCore;
import kr.rucserver.core.model.RucPlayer;
import kr.rucserver.core.service.EconomyService;
import kr.rucserver.core.service.MessageService;
import kr.rucserver.core.service.ScoreboardService;
import net.kyori.adventure.text.Component;
import net.kyori.adventure.text.format.TextDecoration;
import org.bukkit.Bukkit;
import org.bukkit.Material;
import org.bukkit.Sound;
import org.bukkit.entity.Player;
import org.bukkit.inventory.Inventory;
import org.bukkit.inventory.ItemStack;
import org.bukkit.inventory.meta.ItemMeta;
import org.bukkit.inventory.meta.SkullMeta;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;

/**
 * Shift + F 로 열리는 네트워크 메뉴 (Phase 3.5).
 *
 * <b>왜 하필 Shift + F 인가:</b> 서버는 클라이언트의 임의 키 입력을 볼 수 없습니다.
 * 바닐라 클라이언트가 키 때문에 패킷을 보내는 경우는 정해져 있고, 그중 하나가
 * <b>F(손에 든 아이템 교체)</b> 입니다. 이건 PlayerSwapHandItemsEvent 로 잡히고,
 * 웅크림 여부는 서버가 이미 알고 있으므로 "웅크린 채 F" = Shift + F 가 됩니다.
 * 모드나 리소스팩 없이 되는 유일한 방법입니다.
 *
 * F 키를 다른 곳에 재배치한 사람도 있으므로 /메뉴 명령을 같이 둡니다.
 */
public class MenuService {

    private static final int SIZE = 45;

    /** 서버 칸 배치. 4개를 가운데에 고르게 둡니다. */
    private static final int[] SERVER_SLOTS = {10, 12, 14, 16};

    public static final int SLOT_PROFILE = 14;
    public static final int SLOT_VERIFY = 15;
    public static final int SLOT_LANGUAGE = 16;

    // 기능 줄. 28 · 30 · 32 · 34 로 좌우 대칭입니다 (우편함 · 엔더상자 · 유저 상점 · 국가전).
    // 도움말은 맨 아랫줄 38, 닫기 40, 가이드(Phase 11) 42 — 좌우 대칭.
    public static final int SLOT_MAILBOX = 28;
    public static final int SLOT_ENDER = 29;
    public static final int SLOT_SHOP = 30;
    /** 국가전 바로가기 (2026-10-11 — 스폰 버튼은 허브 칸과 겹쳐서 대체). */
    public static final int SLOT_WAR = 11;
    public static final int SLOT_HELP = 33;
    public static final int SLOT_GUIDE = 34;
    public static final int SLOT_COSMETIC = 31;
    public static final int SLOT_CLOSE = 40;

    private final RucCore plugin;
    private final MessageService messages;

    public MenuService(RucCore plugin, MessageService messages) {
        this.plugin = plugin;
        this.messages = messages;
    }

    // ── 열기 ───────────────────────────────────────────────────────────

    public void openMain(Player player) {
        if (plugin.getGuide() != null) plugin.getGuide().trigger(player, "menu");
        String lang = plugin.getPlayerData().languageOf(player);

        MenuHolder holder = new MenuHolder(MenuHolder.Type.MAIN);
        Inventory inv = Bukkit.createInventory(holder, SIZE,
                MessageService.colorize(messages.raw(lang, "menu.title")));
        holder.setInventory(inv);

        fillBackground(inv);
        placeServers(inv, player, lang);
        placeFeatures(inv, player, lang);

        player.openInventory(inv);
        player.playSound(player.getLocation(), Sound.BLOCK_ENDER_CHEST_OPEN, 0.5f, 1.6f);
    }

    public void openHelp(Player player) {
        String lang = plugin.getPlayerData().languageOf(player);

        MenuHolder holder = new MenuHolder(MenuHolder.Type.HELP);
        Inventory inv = Bukkit.createInventory(holder, 27,
                MessageService.colorize(messages.raw(lang, "menu.help.title")));
        holder.setInventory(inv);

        fillBackground(inv);

        inv.setItem(11, item(Material.NETHERITE_SWORD,
                messages.raw(lang, "menu.help.combat-name"),
                loreOf(lang, "menu.help.combat-lore")));
        inv.setItem(13, item(Material.ENDER_PEARL,
                messages.raw(lang, "menu.help.travel-name"),
                loreOf(lang, "menu.help.travel-lore")));
        inv.setItem(15, item(Material.EMERALD,
                messages.raw(lang, "menu.help.economy-name"),
                loreOf(lang, "menu.help.economy-lore")));
        inv.setItem(22, item(Material.ARROW,
                messages.raw(lang, "menu.back"), List.of()));

        player.openInventory(inv);
    }

    // ── 구성 ───────────────────────────────────────────────────────────

    private void fillBackground(Inventory inv) {
        ItemStack pane = item(Material.GRAY_STAINED_GLASS_PANE, " ", List.of());
        for (int i = 0; i < inv.getSize(); i++) inv.setItem(i, pane);
    }

    /** 서버 이동 칸. 현재 서버는 이동 대상이 아니라 표시만 합니다. */
    private void placeServers(Inventory inv, Player player, String lang) {
        Map<String, Integer> counts = plugin.getNetwork().snapshot();
        String current = plugin.getNetwork().getCurrentServer();

        int i = 0;
        for (Map.Entry<String, Integer> entry : counts.entrySet()) {
            if (i >= SERVER_SLOTS.length) break;
            String id = entry.getKey();
            Integer count = entry.getValue();
            boolean here = id.equals(current);

            List<Component> lore = new ArrayList<>();
            for (String line : messages.raw(lang, "menu.server." + id + "-lore").split("\\|")) {
                lore.add(plain(line));
            }
            lore.add(Component.empty());
            lore.add(plain(messages.raw(lang, "menu.server.count")
                    .replace("%count%", count == null ? "?" : String.valueOf(count))));
            lore.add(plain(here
                    ? messages.raw(lang, "menu.server.here")
                    : messages.raw(lang, "menu.server.click")));

            ItemStack stack = item(serverIcon(id),
                    messages.raw(lang, "menu.server." + id + "-name"), lore);

            // 현재 서버는 반짝이게 해서 한눈에 구분되게 합니다.
            if (here) {
                ItemMeta meta = stack.getItemMeta();
                meta.setEnchantmentGlintOverride(true);
                stack.setItemMeta(meta);
            }

            inv.setItem(SERVER_SLOTS[i++], stack);
        }
    }

    private Material serverIcon(String id) {
        return switch (id) {
            case "home" -> Material.BEACON;
            case "raid" -> Material.NETHERITE_SWORD;
            case "war" -> Material.SHIELD;
            case "peace" -> Material.OAK_SAPLING;
            default -> Material.PAPER;
        };
    }

    private void placeFeatures(Inventory inv, Player player, String lang) {
        RucPlayer data = plugin.getPlayerData().get(player);

        // ── 내 정보 — 본인 머리를 씁니다. 스킨이 제대로 로드됐는지도 여기서 보입니다.
        ItemStack head = new ItemStack(Material.PLAYER_HEAD);
        SkullMeta skull = (SkullMeta) head.getItemMeta();
        skull.setOwningPlayer(player);
        skull.displayName(plain(messages.raw(lang, "menu.profile.name")
                .replace("%player%", player.getName())));

        List<Component> lore = new ArrayList<>();
        if (data == null) {
            lore.add(plain(messages.raw(lang, "menu.profile.loading")));
        } else {
            int percent = (int) Math.round(plugin.getXp().progress(data) * 100);
            long required = plugin.getXp().requiredXp(data.getLevel());
            ScoreboardService.ReputationTier tier =
                    ScoreboardService.ReputationTier.of(data.getReputation());

            for (String line : messages.raw(lang, "menu.profile.lore")
                    .replace("%level%", String.valueOf(data.getLevel()))
                    .replace("%xp%", String.valueOf(data.getXp()))
                    .replace("%required%", data.getLevel() >= plugin.getXp().getMaxLevel()
                            ? "-" : String.valueOf(required))
                    .replace("%percent%", String.valueOf(percent))
                    .replace("%ruc%", EconomyService.format(data.getRuc()))
                    .replace("%symbol%", plugin.getEconomy().symbol())
                    .replace("%kills%", String.valueOf(data.getKills()))
                    .replace("%deaths%", String.valueOf(data.getDeaths()))
                    .replace("%assists%", String.valueOf(data.getAssists()))
                    .replace("%repcolor%", tier.color())
                    .replace("%reptier%", messages.raw(lang, "reputation." + tier.key()))
                    .split("\\|")) {
                lore.add(plain(line));
            }
        }
        skull.lore(lore);
        head.setItemMeta(skull);
        inv.setItem(SLOT_PROFILE, head);

        // ── 디스코드 인증 상태
        boolean verified = data != null && data.isVerified();
        inv.setItem(SLOT_VERIFY, item(
                verified ? Material.ENDER_EYE : Material.ENDER_PEARL,
                messages.raw(lang, verified ? "menu.verify.done-name" : "menu.verify.todo-name"),
                loreOf(lang, verified ? "menu.verify.done-lore" : "menu.verify.todo-lore")));

        // ── 언어 전환. 지금 언어와 바뀔 언어를 같이 보여줘야 눌러도 되는지 압니다.
        String next = "ko".equals(lang) ? "en" : "ko";
        inv.setItem(SLOT_LANGUAGE, item(Material.BOOK,
                messages.raw(lang, "menu.language.name"),
                split(messages.raw(lang, "menu.language.lore")
                        .replace("%current%", lang)
                        .replace("%next%", next))));

        // ── 우편함 (Phase 5.5). 안 받은 우편 수는 여기서 세지 않습니다 —
        // 메뉴를 열 때마다 사람마다 DB 를 한 번 더 때리게 되고, 그 수치는
        // 접속 알림과 우편함 화면에서 이미 보입니다.
        inv.setItem(SLOT_MAILBOX, item(Material.CHEST,
                messages.raw(lang, "menu.mailbox.name"),
                loreOf(lang, "menu.mailbox.lore")));

        // ── 내 엔더상자 (기본 + 확장). 어디서나 열립니다 (2026-10-02 소유자 결정).
        inv.setItem(SLOT_ENDER, item(Material.ENDER_CHEST,
                messages.raw(lang, "menu.ender.name"),
                loreOf(lang, "menu.ender.lore")));

        // ── 유저 상점 (Phase 10)
        inv.setItem(SLOT_SHOP, item(Material.EMERALD,
                messages.raw(lang, "menu.shop.name"),
                loreOf(lang, "menu.shop.lore")));

        // ── 코스메틱 (2026-10-05)
        inv.setItem(SLOT_COSMETIC, item(Material.NETHER_STAR,
                messages.raw(lang, "menu.cosmetic.name"),
                loreOf(lang, "menu.cosmetic.lore")));

        // ── 가이드 (Phase 11)
        inv.setItem(SLOT_GUIDE, item(Material.KNOWLEDGE_BOOK,
                messages.raw(lang, "menu.guide.name"),
                loreOf(lang, "menu.guide.lore")));

        // ── 국가전 바로가기. 서버 칸과 같은 이름·설명을 씁니다.
        inv.setItem(SLOT_WAR, item(Material.SHIELD,
                messages.raw(lang, "menu.server.war-name"),
                loreOf(lang, "menu.server.war-lore")));

        // ── 도움말
        inv.setItem(SLOT_HELP, item(Material.WRITABLE_BOOK,
                messages.raw(lang, "menu.help.name"),
                loreOf(lang, "menu.help.lore")));

        // ── 닫기
        inv.setItem(SLOT_CLOSE, item(Material.BARRIER,
                messages.raw(lang, "menu.close.name"), List.of()));
    }

    /** 메뉴를 닫지 않은 채 짧게 알려줄 때. 실패한 클릭에 씁니다. */
    public void click(Player player, String key) {
        String lang = plugin.getPlayerData().languageOf(player);
        player.sendActionBar(MessageService.colorize(messages.raw(lang, key)));
        player.playSound(player.getLocation(), Sound.BLOCK_NOTE_BLOCK_BASS, 0.6f, 0.8f);
    }

    /** 서버 칸 인덱스 → 서버 id. 클릭 처리에서 씁니다. */
    public String serverAtSlot(int slot) {
        List<String> servers = plugin.getNetwork().getServers();
        for (int i = 0; i < SERVER_SLOTS.length && i < servers.size(); i++) {
            if (SERVER_SLOTS[i] == slot) return servers.get(i);
        }
        return null;
    }

    // ── 도구 ───────────────────────────────────────────────────────────

    private ItemStack item(Material material, String name, List<Component> lore) {
        ItemStack stack = new ItemStack(material);
        ItemMeta meta = stack.getItemMeta();
        meta.displayName(plain(name));
        if (!lore.isEmpty()) meta.lore(lore);
        stack.setItemMeta(meta);
        return stack;
    }

    private List<Component> loreOf(String lang, String key) {
        return split(messages.raw(lang, key));
    }

    /** 여러 줄은 '|' 로 나눕니다. YAML 리스트보다 번역본을 맞춰 두기 쉽습니다. */
    private List<Component> split(String text) {
        List<Component> lore = new ArrayList<>();
        for (String line : text.split("\\|")) lore.add(plain(line));
        return lore;
    }

    /**
     * 아이템 이름·설명은 기본이 보라색 기울임입니다. 그대로 두면 우리가 넣은
     * 색이 묻히므로 기울임을 명시적으로 끕니다.
     */
    private Component plain(String text) {
        return MessageService.colorize(text).decoration(TextDecoration.ITALIC, false);
    }
}
