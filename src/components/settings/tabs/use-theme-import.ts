// §54 테마 JSON import — 파일 선택 → 검증 → sanitize → 저장.
//
// AppearanceTab에서 분리(적대 리뷰: 탭이 500줄 규칙을 넘었고, import 검증은
// 갤러리 렌더와 독립된 도메인이다). 검증이 막은 이유는 오류 **코드**로 던지고
// 여기서 locale 문장으로 바꾼다 — Error 원문을 그대로 렌더하면 한국어 UI에
// 영문 절반이 섞인다. 원문 상세는 logger에만 남는다.
import { useCallback, useState } from "react";

import { open } from "@tauri-apps/plugin-dialog";

import type { ThemeColors, ThemeDef } from "../../../types/theme";

import { useShallow } from "zustand/shallow";

import { useTranslation } from "../../../i18n/useTranslation";
import { readFile } from "../../../ipc/invoke";
import { useSettingsStore } from "../../../stores/settings/store";
import {
  defaultColorsForBase,
  migrateThemeColors,
  THEME_COLOR_KEYS,
  THEME_COLOR_VALUE_RE,
} from "../../../types/theme";
import { logger } from "../../../utils/logger";

/** i18n 키 `settings.appearance.importError.*`의 마지막 조각. */
type ImportErrorCode =
  | "invalidBase"
  | "invalidColors"
  | "invalidColorValue"
  | "invalidName"
  | "readFailed";

class ThemeImportError extends Error {
  constructor(
    readonly code: ImportErrorCode,
    readonly params?: Record<string, string>,
  ) {
    super(code);
  }
}

export function useThemeImport(): {
  handleImport: () => Promise<void>;
  importError: null | string;
} {
  const { t } = useTranslation();
  const { saveCustomTheme, setActiveTheme } = useSettingsStore(
    useShallow((s) => ({
      saveCustomTheme: s.saveCustomTheme,
      setActiveTheme: s.setActiveTheme,
    })),
  );
  // import 실패는 logger에만 남고 화면은 무반응이었다(감사 순서 10) — 사용자
  // 입장에선 버튼이 조용히 죽은 것. 막힌 이유를 locale 문장으로 보여준다.
  const [importError, setImportError] = useState<null | string>(null);

  const handleImport = useCallback(async () => {
    setImportError(null);
    try {
      // dialog 호출도 try 안이다(적대 리뷰): 권한/초기화 문제로 open()이
      // reject되면 종전엔 unhandled rejection으로 죽고 화면은 무반응이었다.
      const selected = await open({
        filters: [{ name: "JSON", extensions: ["json"] }],
      });
      if (!selected) return;
      const content = await readFile(selected);
      const data = JSON.parse(content);
      if (typeof data.name !== "string" || !data.name) {
        throw new ThemeImportError("invalidName");
      }
      if (data.base !== "light" && data.base !== "dark") {
        throw new ThemeImportError("invalidBase");
      }
      if (!data.colors || typeof data.colors !== "object") {
        throw new ThemeImportError("invalidColors");
      }
      // Migrate old key names (pre-v10) to current names. fill은 테마의 base에
      // 맞는 기본 팔레트에서 — Default Light 고정 fill은 키가 모자란 다크
      // 테마를 라이트 값과 섞었다(적대 리뷰).
      data.colors = migrateThemeColors(
        data.colors,
        defaultColorsForBase(data.base),
      );
      // 감사 BLOCKER: 필수 키 존재만 검사하고 객체를 그대로 저장하면, JSON에
      // 끼어든 여분 키(진짜 CSS 속성명 포함)가 applyThemeVars까지 흘러가
      // <html>의 inline style에 영구 주입된다. 존재·형식을 검사한 뒤 whitelist
      // 키만으로 객체를 **재구성**해 여분 키를 여기서 떨어뜨린다. 값 계약은
      // THEME_COLOR_VALUE_RE — alpha hex(4·8자리)도 color-contrast 계층과
      // 같은 폭으로 받는다.
      const sanitized = {} as ThemeColors;
      for (const { key } of THEME_COLOR_KEYS) {
        const value = data.colors[key];
        if (typeof value !== "string" || !THEME_COLOR_VALUE_RE.test(value)) {
          throw new ThemeImportError("invalidColorValue", { key });
        }
        sanitized[key] = value;
      }
      const newTheme: ThemeDef = {
        id: "custom-" + Date.now(),
        name: data.name,
        base: data.base,
        colors: sanitized,
        builtIn: false,
      };
      saveCustomTheme(newTheme);
      setActiveTheme(newTheme.id);
    } catch (err) {
      logger.error("Theme import failed:", err);
      const code = err instanceof ThemeImportError ? err.code : "readFailed";
      const params = err instanceof ThemeImportError ? err.params : undefined;
      setImportError(t(`settings.appearance.importError.${code}`, params));
    }
  }, [saveCustomTheme, setActiveTheme, t]);

  return { handleImport, importError };
}
