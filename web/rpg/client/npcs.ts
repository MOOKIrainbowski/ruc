import type { Appearance } from "../shared/data/appearance";
import type { Outfit } from "./art/character";

/** 시설 창 (NPC · 오브젝트가 여는 것). board = 퀘스트 게시판(일지의 게시판 탭) */
export type Place = "job" | "skills" | "mail" | "shop" | "market" | "forge" | "alchemy" | "board";

/** NPC 외형 (§19-1) */
export const NPC_LOOK: Record<string, { ap: Appearance; outfit: Outfit }> = {
  lumi: { ap: { hair: 5, hairColor: 6, skin: 0, eyes: 1 }, outfit: { shirt: ["#fff4b0", "#f2d27a", "#c9a24a"], pants: ["#a3d95f", "#6fb840", "#4b902f"], shoe: "#6d513b" } },
  volt: { ap: { hair: 1, hairColor: 3, skin: 2, eyes: 2 }, outfit: { shirt: ["#8a8f99", "#6f7680", "#4f555e"], pants: ["#6d513b", "#523b2a", "#3a2a1e"], shoe: "#2f2620", gloves: "#4f555e", weapon: { kind: "axe", c: ["#e2e8ee", "#9aa3ad", "#5b636c"] } } },
  mir: { ap: { hair: 2, hairColor: 4, skin: 1, eyes: 3 }, outfit: { shirt: ["#c8a0f0", "#9B5DE5", "#6b3fa0"], pants: ["#6b3fa0", "#4e2d78", "#36204f"], shoe: "#36204f" } },
  sera: { ap: { hair: 3, hairColor: 1, skin: 1, eyes: 0 }, outfit: { shirt: ["#ff9a9e", "#E5484D", "#a8323a"], pants: ["#ddd3c3", "#bdb2a1", "#9e917c"], shoe: "#4a3428", cape: ["#ff9a9e", "#E5484D", "#a8323a"], emblem: "warrior", weapon: { kind: "sword", c: ["#ffffff", "#c9d1d9", "#8a949e"] } } },
  owen: { ap: { hair: 0, hairColor: 7, skin: 0, eyes: 0 }, outfit: { shirt: ["#7fb0ff", "#3b6fd6", "#2a4f9e"], pants: ["#ddd3c3", "#bdb2a1", "#9e917c"], shoe: "#4a3428", cape: ["#c8a0f0", "#9B5DE5", "#6b3fa0"], emblem: "mage", weapon: { kind: "staff", c: ["#c98d58", "#a36a3c", "#7d4f2b"], gem: "#c8a0f0" } } },
  pip: { ap: { hair: 4, hairColor: 2, skin: 0, eyes: 1 }, outfit: { shirt: ["#7fd0ff", "#3BA7FF", "#2a78b8"], pants: ["#94735a", "#6d513b", "#523b2a"], shoe: "#4a3428" } },
  dario: { ap: { hair: 0, hairColor: 0, skin: 2, eyes: 2 }, outfit: { shirt: ["#d9b07a", "#b08a5a", "#806240"], pants: ["#6d513b", "#523b2a", "#3a2a1e"], shoe: "#2f2620", helm: { kind: "cap", c: ["#a0764c", "#7a5636", "#523b2a"] }, weapon: { kind: "dagger", c: ["#d9dde2", "#a7aeb6", "#6f7780"] } } },
};

/** NPC 대화창에서 열 수 있는 시설 (§19-1) */
export const NPC_PLACE: Record<string, Place> = { sera: "job", owen: "skills", pip: "mail", volt: "forge", mir: "alchemy" };
