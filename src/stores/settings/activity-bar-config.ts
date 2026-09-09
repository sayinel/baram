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

/**
 * 이 항목이 기능 게이트를 통과하는가. 기능에 속하지 않는 항목은 늘 통과한다.
 *
 * 표를 읽는 유일한 함수 — `ActivityBar.tsx`와 `ActivityBarTab.tsx`가 각자 지역
 * 클로저로 이 로직을 복제하면 표류면이 생긴다(한쪽이 바뀌어도 다른 쪽은 모른다).
 * 플래그를 인자로 받는 순수 함수라 스토어 없이 직접 테스트할 수 있고, 이 파일이
 * `features.ts`(→ `store.ts`)를 import하지 않아도 된다.
 */
export function isActivityBarItemVisible(
  id: string,
  flags: Record<FeatureKey, boolean>,
): boolean {
  const f = ACTIVITY_BAR_ITEM_FEATURE[id];
  return f === undefined || flags[f];
}

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
