// §54 · §371 6a 테마 가져오기 — 대화상자(Rust) → 색 설정이면 검증 → sanitize → 저장, 패키지면 파일 설치
// (`use-theme-file-install.ts`).
//
// 대화상자와 읽기는 Rust(`theme_import_pick`)가 한다 — 전에 쓰던 웹뷰의 `readFile` 은 `check_vault`(fs_cmd.rs)를
// 거쳐 `~/Downloads` 에 받은 테마 같은 볼트 밖 파일을 거부하고, Rust 가 네이티브 대화상자에서 고른 파일 하나만
// 읽으면 웹뷰의 경로 권한이 늘지 않는다(스펙 0062 §1.4 · D8).
//
// AppearanceTab에서 분리(적대 리뷰: 탭이 500줄 규칙을 넘었고, import 검증은
// 갤러리 렌더와 독립된 도메인이다). 검증이 막은 이유는 오류 **코드**로 던지고
// 여기서 locale 문장으로 바꾼다 — Error 원문을 그대로 렌더하면 한국어 UI에
// 영문 절반이 섞인다. 원문 상세는 logger에만 남는다.
import { useCallback, useRef, useState } from "react";

import type { RustStagedThemeInfo } from "../../../ipc/theme";
import type { ThemeColors, ThemeDef, ThemeMode } from "../../../types/theme";

import { useShallow } from "zustand/shallow";

import { useTranslation } from "../../../i18n/useTranslation";
import { themeImportPick } from "../../../ipc/theme";
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
  | "packageTooLarge"
  | "readFailed"
  | "tooLarge";

class ThemeImportError extends Error {
  constructor(
    readonly code: ImportErrorCode,
    readonly params?: Record<string, string>,
  ) {
    super(code);
  }
}

export function useThemeImport(
  onPackage: (
    staged: RustStagedThemeInfo,
    fileName: string,
  ) => Promise<null | string>,
): {
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
  // 가져오기 하나가 끝날 때까지 다음 클릭은 아무것도 하지 않는다 — 두 번 누르면 네이티브 대화상자가 둘
  // 열렸다(계획 0110 최종 리뷰). 대화상자 · 색 저장 · 패키지 설치(`onPackage`, 동의까지)가 모두 한 번의
  // 가져오기이고, 첫 await 앞에서 막아야 두 번째 클릭이 `themeImportPick` 에 닿지 않는다.
  const inFlight = useRef(false);

  const handleImport = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    setImportError(null);
    try {
      // 대화상자도 try 안이다(적대 리뷰) — 권한 · 초기화 문제로 reject 되면 unhandled rejection 으로 죽는다.
      const pick = await themeImportPick();
      if (pick === null) return;
      if (pick.kind === "tooLarge") {
        throw new ThemeImportError(
          pick.format === "package" ? "packageTooLarge" : "tooLarge",
        );
      }
      if (pick.kind === "package") {
        const message = await onPackage(pick.staged, pick.fileName);
        if (message !== null) setImportError(message);
        return;
      }
      // 64 KiB 는 Rust 가 읽기 전에 판정했다(`theme_import.rs` 의 `MAX_THEME_COLORS_IMPORT_BYTES`, 계획 0110 P8).
      const data = JSON.parse(pick.text);
      const name = typeof data.name === "string" ? data.name.trim() : "";
      // 길이 상한과 제어·bidi 문자 거부 — 카드/삭제 라벨을 속이는 표기 방지.
      if (
        !name ||
        name.length > 100 ||
        // eslint-disable-next-line no-control-regex -- 제어문자 거부가 목적이다
        /[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/.test(name)
      ) {
        throw new ThemeImportError("invalidName");
      }
      if (data.base !== "light" && data.base !== "dark") {
        throw new ThemeImportError("invalidBase");
      }
      // 배열도 typeof === "object"다 — plain object만 색 지도로 받는다.
      if (
        !data.colors ||
        typeof data.colors !== "object" ||
        Array.isArray(data.colors)
      ) {
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
      // THEME_COLOR_VALUE_RE — 불투명 3·6자리 hex만(alpha 거부 근거는 그쪽 주석).
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
        name,
        source: "custom",
        modes: { [data.base as ThemeMode]: { colors: sanitized } },
      };
      saveCustomTheme(newTheme);
      setActiveTheme(newTheme.id);
    } catch (err) {
      // `JSON.parse` 의 `SyntaxError` 는 종류만 적는다(계획 0110 보안 관문) — V8 의 문구는 입력의 앞부분을
      // 인용하므로(`Unexpected token 'S', "SECRET-TOK"... is not valid JSON`), 실수로 고른 테마가 아닌 파일의
      // 한 조각이 로그에 남는다. 그 밖의 오류(`ThemeImportError` · Rust 의 거부 문구)는 원문 그대로다.
      logger.error(
        "Theme import failed:",
        err instanceof SyntaxError ? err.name : err,
      );
      const code = err instanceof ThemeImportError ? err.code : "readFailed";
      const params = err instanceof ThemeImportError ? err.params : undefined;
      setImportError(t(`settings.appearance.importError.${code}`, params));
    } finally {
      inFlight.current = false;
    }
  }, [onPackage, saveCustomTheme, setActiveTheme, t]);

  return { handleImport, importError };
}
