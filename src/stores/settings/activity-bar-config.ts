// Activity bar item configuration types and defaults.

import type { FeatureKey } from "./feature-keys";

export interface ActivityBarItemConfig {
  id: string;
  section: "bottom" | "top";
  visible: boolean;
}

export const DEFAULT_ACTIVITY_BAR_CONFIG: ActivityBarItemConfig[] = [
  // Top section — sidebar panels
  { id: "files", visible: true, section: "top" },
  { id: "search", visible: true, section: "top" },
  { id: "outline", visible: true, section: "top" },
  { id: "backlinks", visible: true, section: "top" },
  { id: "bookmarks", visible: true, section: "top" },
  { id: "graph", visible: true, section: "top" },
  { id: "git", visible: true, section: "top" },
  { id: "calendar", visible: true, section: "top" },
  { id: "tags", visible: true, section: "top" },
  { id: "tasks", visible: true, section: "top" },
  { id: "zettel", visible: true, section: "top" },
  { id: "skills-gallery", visible: true, section: "top" },
  { id: "plugins", visible: true, section: "top" },
  // Bottom section — right panels + utilities
  { id: "chat", visible: true, section: "bottom" },
  { id: "memories", visible: true, section: "bottom" },
  { id: "photo-gallery", visible: true, section: "bottom" },
  { id: "snapshots", visible: true, section: "bottom" },
];

/**
 * §338 항목이 어느 기능에 속하는가. 기능이 꺼지면 이 맵에 걸린 항목이 사라진다.
 *
 * ‼️ 여기 없는 id는 `ACTIVITY_BAR_ALWAYS_ON` 에 있어야 한다. 두 집합이
 * `DEFAULT_ACTIVITY_BAR_CONFIG` 를 정확히 분할하는지 테스트가 소진 산술로 검사하므로,
 * 새 항목을 분류하지 않으면 실패한다.
 */
export const ACTIVITY_BAR_ITEM_FEATURE: Readonly<Record<string, FeatureKey>> = {
  calendar: "journal",
  chat: "ai",
  memories: "journal",
  "photo-gallery": "journal",
  tasks: "tasks",
  zettel: "zettelkasten",
};

/** 기능에 속하지 않는 항목 — 늘 보인다. */
export const ACTIVITY_BAR_ALWAYS_ON: readonly string[] = [
  "backlinks",
  "bookmarks",
  "files",
  "git",
  "graph",
  "outline",
  "plugins",
  "search",
  "skills-gallery",
  "snapshots",
  "tags",
] as const;
