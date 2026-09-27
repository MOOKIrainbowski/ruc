package kr.rucserver.war.service;

import kr.rucserver.war.RucWar;
import net.kyori.adventure.text.Component;
import net.kyori.adventure.text.serializer.legacy.LegacyComponentSerializer;
import org.bukkit.Material;
import org.bukkit.NamespacedKey;
import org.bukkit.Server;
import org.bukkit.inventory.ItemStack;
import org.bukkit.inventory.RecipeChoice;
import org.bukkit.inventory.ShapedRecipe;
import org.bukkit.inventory.ShapelessRecipe;
import org.bukkit.inventory.meta.ItemMeta;
import org.bukkit.persistence.PersistentDataType;

import java.util.ArrayList;
import java.util.List;

/**
 * 코어 제작 체인 (D2).
 *
 * <pre>
 *   [ 강화 장갑판 ] [ 영토 렌즈 ] [ 강화 장갑판 ]
 *   [ 영토 렌즈   ] [ 네더의 별 ] [ 영토 렌즈   ]
 *   [ 강화 장갑판 ] [ 국가 인장 ] [ 강화 장갑판 ]
 * </pre>
 *
 * 설계 의도는 <b>혼자서는 못 만드는 것</b>입니다. 전투 자원(네더라이트) +
 * 탐험 자원(에코 파편) + 화폐(국가 인장)를 전부 요구해서 길드가 역할을
 * 나누도록 강제합니다.
 *
 * <h2>아이템 식별은 PDC 로만 합니다</h2>
 * 표시 이름으로 판별하면 이름만 같게 만든 위조품이 통과합니다. 모루로 이름을
 * 바꿀 수 있으니 실제로 가능한 공격입니다. PDC 태그는 플레이어가 붙일 수 없습니다.
 *
 * <h2>바닐라 용도 차단</h2>
 * 기반 재료가 바닐라 쓰임새를 가진 것들입니다(네더라이트 주괴 → 장비, 바다의
 * 심장 → conduit, 신호기 → 설치). 태그가 붙은 아이템이 <b>우리 레시피가 아닌</b>
 * 조합에 들어가면 {@code CraftGuardListener} 가 막습니다. 일주일 모은 코어가
 * 실수로 다른 것이 되어 사라지는 일은 없어야 합니다.
 */
public class CoreItems {

    private static final LegacyComponentSerializer LEGACY =
            LegacyComponentSerializer.legacyAmpersand();

    /** PDC 키 하나에 부품 종류를 문자열로 담습니다. 종류마다 키를 만들 이유가 없습니다. */
    private final NamespacedKey partKey;

    /** 코어에 길드 귀속을 기록하는 키 (D2 — 다른 길드원이 들면 기능 없음). */
    private final NamespacedKey ownerKey;

    private final RucWar plugin;

    public CoreItems(RucWar plugin) {
        this.plugin = plugin;
        this.partKey = new NamespacedKey(plugin, "war_part");
        this.ownerKey = new NamespacedKey(plugin, "war_core_guild");
    }

    /** 부품 종류. {@code material} 은 겉모습이고, 실제 판별은 PDC 값입니다. */
    public enum Part {
        /** 강화 장갑판 — 네더라이트 조각 ×4 + 흑요석 ×4 */
        PLATE("plate", Material.NETHERITE_INGOT, "&f&l강화 장갑판",
                List.of("&7코어의 외장을 이룹니다.", "&8네더 탐사로 얻는 재료가 필요합니다.")),

        /** 영토 렌즈 — 엔드 크리스탈 + 자수정 조각 ×4 + 에코 파편 */
        LENS("lens", Material.SPYGLASS, "&b&l영토 렌즈",
                List.of("&7코어가 영토를 인식하는 장치입니다.", "&8엔드와 고대 도시를 모두 거쳐야 합니다.")),

        /** 국가 인장 — 제작 불가. 인장 상인에게서 Ruc 로 구매 (길드장만) */
        SEAL("seal", Material.HEART_OF_THE_SEA, "&6&l국가 인장",
                List.of("&7국가의 권리를 증명합니다.", "&8제작할 수 없습니다. 인장 상인에게서 구매하세요.",
                        "&8길드장만 구매할 수 있습니다.")),

        /** 코어 — 최종 결과물. 설치 시 소모되고 영토가 됩니다. */
        CORE("core", Material.BEACON, "&c&l국가 코어",
                List.of("&7전쟁 시간대에 코어 거점에 설치하면",
                        "&7주변 영토가 길드의 소유가 됩니다.",
                        "&8설치하면 소모됩니다. 파괴되어도 회수할 수 없습니다.",
                        "&8길드장·부길드장만 설치할 수 있습니다."));

        private final String id;
        private final Material material;
        private final String displayName;
        private final List<String> lore;

        Part(String id, Material material, String displayName, List<String> lore) {
            this.id = id;
            this.material = material;
            this.displayName = displayName;
            this.lore = lore;
        }

        public String id() { return id; }
        public Material material() { return material; }

        public static Part byId(String id) {
            for (Part part : values()) {
                if (part.id.equals(id)) return part;
            }
            return null;
        }
    }

    // ── 아이템 만들기 ──────────────────────────────────────────────────

    public ItemStack create(Part part, int amount) {
        ItemStack stack = new ItemStack(part.material(), amount);
        ItemMeta meta = stack.getItemMeta();

        meta.displayName(LEGACY.deserialize(part.displayName)
                // 아이템 이름에 기본으로 붙는 기울임을 끕니다. 켜져 있으면
                // 바닐라 아이템에 이름만 바꾼 것처럼 보입니다.
                .decoration(net.kyori.adventure.text.format.TextDecoration.ITALIC, false));

        List<Component> lore = new ArrayList<>();
        for (String line : part.lore) {
            lore.add(LEGACY.deserialize(line)
                    .decoration(net.kyori.adventure.text.format.TextDecoration.ITALIC, false));
        }
        meta.lore(lore);

        meta.getPersistentDataContainer().set(partKey, PersistentDataType.STRING, part.id());
        stack.setItemMeta(meta);
        return stack;
    }

    /** 길드에 귀속된 코어. 다른 길드원이 들면 설치할 수 없습니다 (D2). */
    public ItemStack createCore(int guildId, String guildName) {
        ItemStack stack = create(Part.CORE, 1);
        ItemMeta meta = stack.getItemMeta();

        List<Component> lore = new ArrayList<>(meta.lore() == null ? List.of() : meta.lore());
        lore.add(Component.empty());
        lore.add(LEGACY.deserialize("&7소유: &f" + guildName)
                .decoration(net.kyori.adventure.text.format.TextDecoration.ITALIC, false));
        meta.lore(lore);

        meta.getPersistentDataContainer().set(ownerKey, PersistentDataType.INTEGER, guildId);
        stack.setItemMeta(meta);
        return stack;
    }

    // ── 판별 ──────────────────────────────────────────────────────────

    /** 이 아이템의 부품 종류. 우리 아이템이 아니면 null. */
    public Part partOf(ItemStack stack) {
        if (stack == null || stack.getType() == Material.AIR || !stack.hasItemMeta()) return null;
        String id = stack.getItemMeta().getPersistentDataContainer()
                .get(partKey, PersistentDataType.STRING);
        return id == null ? null : Part.byId(id);
    }

    public boolean isPart(ItemStack stack) {
        return partOf(stack) != null;
    }

    public boolean is(ItemStack stack, Part part) {
        return partOf(stack) == part;
    }

    /** 코어에 기록된 소유 길드 id. 귀속이 없으면 null. */
    public Integer coreOwner(ItemStack stack) {
        if (!is(stack, Part.CORE) || !stack.hasItemMeta()) return null;
        return stack.getItemMeta().getPersistentDataContainer()
                .get(ownerKey, PersistentDataType.INTEGER);
    }

    // ── 레시피 ────────────────────────────────────────────────────────

    /**
     * 레시피 등록.
     *
     * 국가 인장은 레시피가 없습니다 — 제작 불가가 D2 의 요구사항이고, 그래서
     * 코어 하나에 반드시 250,000 Ruc 가 들어갑니다.
     *
     * 재료 자리에 {@code RecipeChoice.ExactChoice} 를 쓰는 이유: 기본
     * {@code MaterialChoice} 는 종류만 보므로, 평범한 네더라이트 주괴로도
     * 코어가 만들어집니다. 그러면 하위 부품 체인이 통째로 무의미해집니다.
     */
    public void registerRecipes() {
        Server server = plugin.getServer();

        // 강화 장갑판 ×4  ←  네더라이트 조각 ×4 + 흑요석 ×4
        ShapedRecipe plate = new ShapedRecipe(new NamespacedKey(plugin, "reinforced_plate"),
                create(Part.PLATE, 4));
        plate.shape("SOS", "OSO", "SOS");
        plate.setIngredient('S', Material.NETHERITE_SCRAP);
        plate.setIngredient('O', Material.OBSIDIAN);
        server.addRecipe(plate);

        // 영토 렌즈 ×1  ←  엔드 크리스탈 + 자수정 조각 ×4 + 에코 파편
        // 3개가 필요하므로 세 번 만들어야 합니다 (에코 파편 3개 = 고대 도시 반복 탐사).
        ShapedRecipe lens = new ShapedRecipe(new NamespacedKey(plugin, "territory_lens"),
                create(Part.LENS, 1));
        lens.shape(" A ", "ACA", " E ");
        lens.setIngredient('A', Material.AMETHYST_SHARD);
        lens.setIngredient('C', Material.END_CRYSTAL);
        lens.setIngredient('E', Material.ECHO_SHARD);
        server.addRecipe(lens);

        // 코어 ×1  ←  장갑판 ×4 + 렌즈 ×3 + 네더의 별 + 국가 인장
        ShapedRecipe core = new ShapedRecipe(new NamespacedKey(plugin, "nation_core"),
                create(Part.CORE, 1));
        core.shape("PLP", "LNL", "PSP");
        core.setIngredient('P', new RecipeChoice.ExactChoice(create(Part.PLATE, 1)));
        core.setIngredient('L', new RecipeChoice.ExactChoice(create(Part.LENS, 1)));
        core.setIngredient('N', Material.NETHER_STAR);
        core.setIngredient('S', new RecipeChoice.ExactChoice(create(Part.SEAL, 1)));
        server.addRecipe(core);

        plugin.getLogger().info("코어 제작 체인 등록 완료 (장갑판 / 렌즈 / 코어)");
    }

    /**
     * 우리 레시피의 결과물인지.
     *
     * {@code CraftGuardListener} 가 "태그 붙은 재료가 들어갔는데 결과가 우리
     * 것이 아니다" 를 판정할 때 씁니다.
     */
    public boolean isOurResult(ItemStack result) {
        return isPart(result);
    }

    /** 셰이프리스 레시피가 필요해지면 쓰는 도우미. 지금은 쓰지 않습니다. */
    @SuppressWarnings("unused")
    private ShapelessRecipe shapeless(String key, ItemStack result) {
        return new ShapelessRecipe(new NamespacedKey(plugin, key), result);
    }

    public NamespacedKey partKey() { return partKey; }
}
