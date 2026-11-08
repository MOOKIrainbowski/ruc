/**
 * 에셋 교체 (P17, §25 "에셋 ID 기반 로드" · D104): 코드가 그린 그림 · 합성 소리 대신 진짜 파일을 쓰고 싶으면
 * `web/public/rpg/assets/` 에 파일을 넣고 `manifest.json` 에 "에셋 ID → 파일"을 적으면 됨 (형식은 같은 폴더의 README.md).
 * 목록에 없는 ID 는 지금처럼 코드 그림 · 합성 소리. 파일을 못 읽으면 조용히 원래대로.
 */
export type AssetManifest = {
  /** 스킬 · 상태 아이콘 (skillIcon id) → PNG 32×32 (16×16 도 됨) */
  icons?: Record<string, string>;
  /** 아이템 템플릿 id → PNG */
  items?: Record<string, string>;
  /** 몹 키 → PNG 가로 띠 (오른쪽을 보는 8프레임, 프레임 크기 = 높이) */
  mobs?: Record<string, string>;
  /** 배경음 (plaza · field · highland · arena · dungeon · boss) · 효과음 (sfx 이름) → 오디오 파일 (ogg · mp3) */
  bgm?: Record<string, string>;
  sfx?: Record<string, string>;
};

const BASE = "/rpg/assets/";
export const overrides = {
  icons: new Map<string, HTMLCanvasElement>(),
  items: new Map<string, HTMLCanvasElement>(),
  mobs: new Map<string, HTMLCanvasElement>(),
  bgm: new Map<string, string>(),
  sfx: new Map<string, string>(),
};

function image(url: string): Promise<HTMLCanvasElement | null> {
  return new Promise((ok) => {
    const img = new Image();
    img.onload = () => {
      const c = document.createElement("canvas");
      c.width = img.naturalWidth;
      c.height = img.naturalHeight;
      c.getContext("2d")!.drawImage(img, 0, 0);
      ok(c);
    };
    img.onerror = () => ok(null);
    img.src = BASE + url;
  });
}

let ready: Promise<void> | null = null;
/** 한 번만 읽음 (게임 화면을 만들기 전에 기다림) */
export function loadAssets(): Promise<void> {
  ready ??= (async () => {
    let m: AssetManifest = {};
    try {
      const r = await fetch(BASE + "manifest.json", { cache: "no-cache" });
      if (r.ok) m = await r.json();
    } catch { /* 없으면 전부 코드 그림 */ }
    const jobs: Promise<void>[] = [];
    for (const kind of ["icons", "items", "mobs"] as const)
      for (const [id, url] of Object.entries(m[kind] ?? {})) jobs.push(image(url).then((c) => { if (c) overrides[kind].set(id, c); }));
    for (const [id, url] of Object.entries(m.bgm ?? {})) overrides.bgm.set(id, BASE + url);
    for (const [id, url] of Object.entries(m.sfx ?? {})) overrides.sfx.set(id, BASE + url);
    await Promise.all(jobs);
  })();
  return ready;
}
