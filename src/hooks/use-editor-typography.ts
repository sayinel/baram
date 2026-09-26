// §365 다이얼 6 — 병합된 본문 타이포를 읽는 두 입구(스펙 0060 §4.1). 계산은
// `appearance/editor-typography.ts` 의 `resolveEditorTypography` 하나이고, 두 입구는 층을 어디서
// 가져오는가만 다르다.

import { useMemo } from "react";

import type { EditorTypography } from "../appearance/editor-typography";

import { resolveEditorTypography } from "../appearance/editor-typography";
import { themeDialsFor } from "../appearance/theme-dials";
import { useSettingsStore } from "../stores/settings/store";
import { usePluginStore } from "../stores/system/plugin";
import { effectiveThemeIdOf } from "../themes/theme-revocation";
import { useThemeDials } from "./use-theme-dials";

/**
 * React 밖의 입구 — 수식 미리보기 팝오버(`extensions/plugins/math-inline-edit.ts`)처럼 스토어를
 * 직접 구독하는 곳이 쓴다. 유효 테마 id 는 `useEffectiveThemeId` 와 **같은** 순수 함수로 정한다 —
 * 그러지 않으면 철회된 테마의 서체가 이 경로에만 남는다.
 */
export function readEditorTypography(): EditorTypography {
  const { activeThemeId, appearanceOverrides, installedThemes } =
    useSettingsStore.getState();
  const { effectiveThemeId } = effectiveThemeIdOf(
    activeThemeId,
    installedThemes,
    usePluginStore.getState().revocations,
  );
  return resolveEditorTypography(
    themeDialsFor(effectiveThemeId, installedThemes),
    appearanceOverrides,
  );
}

/**
 * React 안의 입구. 테마 층은 `useThemeDials()`(철회된 테마는 빠진다), 사용자 층은
 * `appearanceOverrides` 다.
 *
 * ‼️ 반환 객체는 두 층 중 하나가 바뀔 때마다 새로 만들어진다 — 강조색처럼 다른 다이얼을
 * 움직여도 그렇다. 이펙트 의존성에는 객체가 아니라 필드(원시값)를 넣을 것.
 */
export function useEditorTypography(): EditorTypography {
  const themeDials = useThemeDials();
  const appearanceOverrides = useSettingsStore((s) => s.appearanceOverrides);
  return useMemo(
    () => resolveEditorTypography(themeDials, appearanceOverrides),
    [themeDials, appearanceOverrides],
  );
}
