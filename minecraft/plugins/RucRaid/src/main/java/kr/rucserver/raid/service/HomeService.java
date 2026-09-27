package kr.rucserver.raid.service;

import kr.rucserver.core.storage.HomeRepository;
import kr.rucserver.raid.RucRaid;
import org.bukkit.Location;
import org.bukkit.World;
import org.bukkit.entity.Player;
import org.bukkit.plugin.Plugin;

/**
 * 약탈 서버의 /sethome · /home · /spawn.
 *
 * 로직 본체는 {@link kr.rucserver.core.service.HomeService}(Core) 에 있습니다.
 * 평화 서버(§2.5)도 같은 명령을 제공하는데, 텔레포트의 세 가지 안전 장치
 * (시전 시간 · 이동 시 취소 · 쿨타임)가 두 군데에 따로 적혀 있으면 한쪽만
 * 고쳐지고 그 한쪽이 <b>전투 중 탈출 버튼</b>이 됩니다.
 *
 * 이 클래스에는 약탈 서버만의 차이 세 가지만 남깁니다:
 * <ul>
 *   <li>전투 태그 중에는 텔레포트를 막습니다 (§2.4 의 핵심).</li>
 *   <li>홈은 약탈 월드에서만 지정할 수 있습니다.</li>
 *   <li>스폰 좌표는 약탈 서버 설정을 봅니다.</li>
 * </ul>
 */
public class HomeService extends kr.rucserver.core.service.HomeService {

    public HomeService(RucRaid plugin, HomeRepository repository, String serverId) {
        super(repository, serverId, new Host() {
            @Override
            public Plugin plugin() {
                return plugin;
            }

            @Override
            public void send(Player player, String key, String... placeholders) {
                plugin.msg().send(player, key, placeholders);
            }

            @Override
            public void sendActionBar(Player player, String key, String... placeholders) {
                plugin.msg().sendActionBar(player, key, placeholders);
            }

            /**
             * 전투 태그 중이면 막습니다. 이걸 풀면 §2.4 의 처형 규칙이
             * 무의미해집니다 — 불리할 때 /home 으로 빠져나가면 되기 때문입니다.
             * blockIfTagged 가 안내까지 직접 합니다.
             */
            @Override
            public boolean teleportBlocked(Player player) {
                return plugin.getCombatTags().blockIfTagged(player);
            }

            @Override
            public boolean isHomeWorld(World world) {
                return plugin.isRaidWorld(world);
            }

            @Override
            public Location spawn() {
                return plugin.raidSpawn();
            }

            @Override
            public String bypassWarmupPermission() {
                return "rucraid.bypass.warmup";
            }

            @Override
            public String bypassCooldownPermission() {
                return "rucraid.bypass.cooldown";
            }
        });
    }
}
