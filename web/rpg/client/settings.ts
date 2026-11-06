/** 설정 (§24). localStorage 와 서버(계정별) 양쪽에 저장. */

export const ACTIONS_KEYS = {
  up: "위로 이동", down: "아래로 이동", left: "왼쪽 이동", right: "오른쪽 이동",
  run: "달리기", dodge: "구르기", interact: "상호작용", map: "전체 지도",
  skillQ: "Q 슬롯", skillW: "W 슬롯", skillE: "E 슬롯", skillR: "궁극기", skillR2: "궁극기 (보조)",
} as const;
export type KeyAction = keyof typeof ACTIONS_KEYS;

export const DEFAULT_KEYS: Record<KeyAction, string> = {
  up: "KeyW", down: "KeyS", left: "KeyA", right: "KeyD",
  run: "ShiftLeft", dodge: "Space", interact: "KeyF", map: "KeyM",
  skillQ: "KeyQ", skillW: "KeyC", skillE: "KeyE", skillR: "KeyR", skillR2: "KeyX",
};

export type Settings = {
  fpsLimit: number; // 0 = 무제한
  quality: "low" | "medium" | "high";
  shadows: boolean;
  zoom: number; // 0 = 자동
  shake: boolean;
  damageNumbers: boolean;
  interfaceScale: number;
  uiScale: number;
  hudScale: number;
  minimapSize: number;
  nameplates: "all" | "party" | "me";
  castMode: "quick" | "indicator";
  volMaster: number;
  volBgm: number;
  volSfx: number;
  keys: Record<KeyAction, string>;
};

export const DEFAULT_SETTINGS: Settings = {
  fpsLimit: 60, quality: "medium", shadows: true, zoom: 0, shake: true, damageNumbers: true,
  interfaceScale: 100, uiScale: 100, hudScale: 100, minimapSize: 160, nameplates: "all", castMode: "quick",
  volMaster: 80, volBgm: 60, volSfx: 80, keys: DEFAULT_KEYS,
};

const LS = "ruc-rpg-settings";

/** 저장된 값 위에 기본값을 깔아 새 항목이 생겨도 깨지지 않게 */
export function mergeSettings(...src: (Partial<Settings> | null | undefined)[]): Settings {
  const out = { ...DEFAULT_SETTINGS, keys: { ...DEFAULT_KEYS } };
  for (const s of src) if (s) Object.assign(out, s, { keys: { ...out.keys, ...(s.keys || {}) } });
  return out;
}

export function loadLocal(): Partial<Settings> | null {
  try {
    return JSON.parse(localStorage.getItem(LS) || "null");
  } catch {
    return null;
  }
}

export const saveLocal = (s: Settings) => localStorage.setItem(LS, JSON.stringify(s));

/** "KeyW" → "W", "ShiftLeft" → "Shift" */
export function keyLabel(code: string) {
  return code.replace(/^Key/, "").replace(/^Digit/, "").replace(/(Left|Right)$/, "");
}
