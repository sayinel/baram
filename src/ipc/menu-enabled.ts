import { invoke } from "@tauri-apps/api/core";

import type { FeatureKey } from "../stores/settings/feature-keys";

/**
 * §341 기능 소속 네이티브 메뉴 항목 → 그 기능.
 *
 * ‼️ 네이티브 accelerator 는 DOM 과 별개 레이어라 조건부 양보가 안 된다. 항목을
 * 비활성화하는 것이 그 accelerator(⌘⇧A · ⌘J · ⌘⌥2 · ⌘⌥3)를 멈추는 유일한 방법이다.
 *
 * ‼️ `view_inline_ai` 는 `ai.` 패턴 grep 에 걸리지 않아 이 설계의 첫 열거에서
 * 빠졌다. `insert_task_list` 는 여기 **없다** — 그건 마크다운 체크박스를 삽입하는
 * 편집 커맨드이고 태스크 기능이 아니다.
 */
export const MENU_FEATURE_MAP: Record<string, FeatureKey> = {
  view_ai_chat: "ai",
  view_calendar: "journal",
  view_inline_ai: "ai",
  workspace_journal: "journal",
  workspace_zettel: "zettelkasten",
};

/** 꺼진 기능의 네이티브 메뉴 항목을 회색 처리한다. */
export async function syncMenuEnabled(
  flags: Record<FeatureKey, boolean>,
): Promise<void> {
  const items: Record<string, boolean> = {};
  for (const [menuId, feature] of Object.entries(MENU_FEATURE_MAP)) {
    items[menuId] = flags[feature];
  }
  await invoke("update_menu_enabled", { items });
}
