import PageShell from "@/components/PageShell";

export const metadata = { title: "러크 RPG 클라이언트 모드" };

/** 러크 RPG 마인크래프트 서버 전용 모드 설치 안내 (사용자 결정 K1, 2026-11-15) */
const MOD = "/rpg-mod/ruc-rpg-client-0.2.0.jar";

export default function Page() {
  const steps: [string, React.ReactNode][] = [
    ["Fabric 설치", <>마인크래프트 <b>1.21.11</b> 용 Fabric Loader 를 설치하세요 (<a className="underline" href="https://fabricmc.net/use/installer/" target="_blank" rel="noreferrer">fabricmc.net</a> → Installer).</>],
    ["Fabric API", <>Fabric API <b>0.141 이상 (1.21.11)</b> 를 받아 <code>.minecraft/mods</code> 폴더에 넣으세요 (<a className="underline" href="https://modrinth.com/mod/fabric-api" target="_blank" rel="noreferrer">Modrinth</a>).</>],
    ["러크 RPG 모드", <>아래 단추로 받은 jar 를 같은 <code>mods</code> 폴더에 넣으세요.</>],
    ["실행", <>런처에서 <b>fabric-loader-1.21.11</b> 프로필로 실행 → 러크 서버 → RPG 로 들어가면 됩니다.</>],
  ];
  return (
    <PageShell eyebrow="RUC RPG" title="러크 RPG 클라이언트 모드" lead="RPG 서버는 이 모드가 있어야 들어갈 수 있어요 — 웹 RPG 와 같은 키(Q · C · Z · R 스킬, M 지도 …) · HUD · 미니맵을 그대로 씁니다.">
      <a href={MOD} download className="glass glass-hover mb-6 inline-block rounded-xl px-6 py-3 text-white">러크 RPG 모드 받기 (0.2.0)</a>
      <ol className="grid gap-3">
        {steps.map(([t, d], i) => (
          <li key={t} className="glass rounded-xl p-5">
            <p className="text-[14px] text-white">{i + 1}. {t}</p>
            <p className="mt-1.5 text-[12.5px] text-white/70">{d}</p>
          </li>
        ))}
      </ol>
      <div className="glass mt-6 rounded-xl p-5 text-[12.5px] text-white/70">
        <p className="text-[14px] text-white">키 (마크 설정 → 조작 → 게임 플레이 에서 바꿀 수 있어요)</p>
        <p className="mt-2">Q · C · Z 스킬 · R 궁극기 · Space(공중) 구르기 · M 전체 지도 · V 장비 · K 스킬창 · J 퀘스트 · P 파티 · B 창고 · O 영지 · G 핑 · N 메뉴</p>
        <p className="mt-2">OptiFine 은 Fabric 과 함께 쓸 수 없어요 — 대신 Sodium · Iris 를 쓰세요. 다른 서버(집 · 로비)는 모드가 있어도 그대로입니다.</p>
      </div>
    </PageShell>
  );
}
