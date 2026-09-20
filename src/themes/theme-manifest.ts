// §360 테마 매니페스트 검증 (스펙 0049 §4)
//
// `src/plugins/manifest.ts`의 `validateManifest`를 본보기로 삼되 복사하지 않는다 — 에러를
// 첫 건에서 멈추지 않고 전부 모아 돌려주는 방식은 같지만, 테마 매니페스트는 `capabilities`도
// `main`도 없고 대신 `modes`를 갖는 다른 모양이다. 텍스트 필드 길이 상한과 제어·bidi 문자
// 거부, 매니페스트 크기 상한 값은 카드 라벨 위장을 이미 막고 있는
// `src/components/settings/tabs/use-theme-import.ts`와 같은 값을 그대로 쓴다 — 그 파일은
// 다른 wire 포맷(`{name, base, colors}`)을 검증하므로 셰이프가 아니라 값만 재사용한다.
import type { ThemeMode } from "../types/theme";

/**
 * `[a-z0-9-]` — 플러그인 id 규칙과 동일(스펙 0049 §4: "플러그인 id 규칙과 동일").
 *
 * `src/plugins/manifest.ts`에는 id 정규식이 **둘** 있고 서로 다르다: `:87`의
 * `/^[a-z0-9-]+$/`(플러그인 id — 이 규칙)와 `:48`의 `CONTRIBUTION_ID`
 * (`/^[A-Za-z0-9_-]+$/`, 대문자·언더스코어까지 허용하는 contribution id 규칙, 여기
 * 대상이 아니다). 테마 id는 설치 디렉터리 이름이 되므로, 느슨한 쪽을 쓰면 대소문자
 * 구분 없는 파일시스템에서 두 테마가 같은 디렉터리로 충돌한다.
 */
const THEME_ID_RE = /^[a-z0-9-]+$/;

/** 이름·설명 길이 상한 — `use-theme-import.ts`의 이름 상한과 같은 값. */
const MAX_TEXT_FIELD_CHARS = 100;

/**
 * 제어·bidi 문자 거부 — `use-theme-import.ts`의 이름 검사와 같은 문자 집합. 카드·삭제
 * 라벨을 속이는 표기(bidi override 등)를 막는다.
 */
// eslint-disable-next-line no-control-regex -- 제어문자 거부가 목적이다
const UNSAFE_TEXT_CHARS_RE = /[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/;

/**
 * 매니페스트 직렬화 크기 상한 — `use-theme-import.ts`가 import 파일 전체에 거는 상한과
 * 같은 값. `data`는 이미 `JSON.parse`를 거친 뒤이므로(호출부 주석 참조) 이 상한이 막는
 * 것은 파싱 비용이 아니라, 그 뒤를 잇는 필드별 검사가 거대한 문자열을 반복해서 훑는
 * 비용이다. `baram-theme.json`은 메타데이터 몇 줄이면 충분하니, 이보다 크면 실수이거나
 * (예: `license` 필드에 거대한 문자열을 채워) 그 비용을 부풀리려는 시도다.
 */
const MAX_MANIFEST_JSON_CHARS = 64 * 1024;

const MODE_KEYS: readonly ThemeMode[] = ["light", "dark"];

export interface ManifestValidationError {
  field: string;
  message: string;
}

export interface ThemeManifest {
  author: string;
  description: string;
  engines: { baram: string };
  id: string;
  license: string;
  /** 선언된 모드만 키로 갖는다. 최소 하나(스펙 0049 §4). */
  modes: Partial<Record<ThemeMode, ThemeManifestModeAssets>>;
  name: string;
  version: string;
}

/** 한 모드가 선언하는 자산 경로. 패키지 루트 기준 상대 경로(스펙 0049 §4). */
export interface ThemeManifestModeAssets {
  css?: string;
  tokens?: string;
}

export function validateThemeManifest(
  data: unknown,
):
  | { errors: ManifestValidationError[]; valid: false }
  | { manifest: ThemeManifest; valid: true } {
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    return {
      valid: false,
      errors: [{ field: "root", message: "manifest must be a JSON object" }],
    };
  }

  // 크기 상한을 먼저 본다 — 그 뒤 필드별 검사가 거대한 문자열을 여러 번 훑지 않도록.
  // `data`는 (호출자가 계약대로) `JSON.parse`의 결과이므로 순환 참조가 없고
  // `JSON.stringify`는 여기서 던지지 않는다.
  if (JSON.stringify(data).length > MAX_MANIFEST_JSON_CHARS) {
    return {
      valid: false,
      errors: [
        {
          field: "root",
          message: `manifest exceeds ${MAX_MANIFEST_JSON_CHARS} characters`,
        },
      ],
    };
  }

  const errors: ManifestValidationError[] = [];
  const obj = data as Record<string, unknown>;

  for (const field of [
    "id",
    "name",
    "description",
    "version",
    "author",
    "license",
  ]) {
    if (!obj[field] || typeof obj[field] !== "string") {
      errors.push({
        field,
        message: `${field} is required and must be a string`,
      });
    }
  }

  if (typeof obj.id === "string" && !THEME_ID_RE.test(obj.id)) {
    errors.push({
      field: "id",
      message: "id must contain only lowercase letters, digits, and hyphens",
    });
  }

  validateTextField(obj, "name", errors);
  validateTextField(obj, "description", errors);

  if (
    !obj.engines ||
    typeof obj.engines !== "object" ||
    Array.isArray(obj.engines)
  ) {
    errors.push({ field: "engines", message: "engines is required" });
  } else {
    const engines = obj.engines as Record<string, unknown>;
    if (!engines.baram || typeof engines.baram !== "string") {
      errors.push({
        field: "engines.baram",
        message: "engines.baram version is required",
      });
    }
  }

  // 스펙 0049 §4: 테마는 능력을 요구하지 않고 JS 진입점도 갖지 않는다. 둘 중 하나라도
  // 실려 있으면 테마인 척하는 플러그인 매니페스트다 — 실수이거나 공격이고, 어느 쪽이든
  // 조용히 무시하지 않고 거부한다.
  if (obj.capabilities !== undefined) {
    errors.push({
      field: "capabilities",
      message:
        "a theme manifest must not declare capabilities (that field belongs to a plugin manifest)",
    });
  }
  if (obj.main !== undefined) {
    errors.push({
      field: "main",
      message:
        "a theme manifest must not declare a JS entry point (main belongs to a plugin manifest)",
    });
  }

  errors.push(...validateModes(obj.modes));

  if (errors.length > 0) {
    return { valid: false, errors };
  }

  return { valid: true, manifest: obj as unknown as ThemeManifest };
}

function validateTextField(
  obj: Record<string, unknown>,
  field: "description" | "name",
  errors: ManifestValidationError[],
): void {
  const value = obj[field];
  if (typeof value !== "string") return; // 이미 필수 필드 루프가 보고했다
  if (value.length > MAX_TEXT_FIELD_CHARS) {
    errors.push({
      field,
      message: `${field} may be at most ${MAX_TEXT_FIELD_CHARS} characters`,
    });
  }
  if (UNSAFE_TEXT_CHARS_RE.test(value)) {
    errors.push({
      field,
      message: `${field} may not contain control or bidi-override characters`,
    });
  }
}

/**
 * `modes`의 각 항목은 `tokens`·`css` 중 최소 하나를 가져야 하고, `modes` 자체는
 * 최소 하나의 모드를 선언해야 한다(스펙 0049 §4). `light`·`dark` 밖의 키는 이 함수가
 * 검사하지 않고 넘어간다 — `ThemeManifest`도 `ThemeMode`로만 인덱싱하므로 다운스트림도
 * 그 키를 읽지 않는다.
 */
function validateModes(value: unknown): ManifestValidationError[] {
  const errors: ManifestValidationError[] = [];
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    errors.push({
      field: "modes",
      message: "modes is required and must be an object",
    });
    return errors;
  }

  const modes = value as Record<string, unknown>;
  let declaredCount = 0;
  for (const mode of MODE_KEYS) {
    const entry = modes[mode];
    if (entry === undefined) continue;
    declaredCount++;

    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
      errors.push({
        field: `modes.${mode}`,
        message: `modes.${mode} must be an object`,
      });
      continue;
    }

    const assets = entry as Record<string, unknown>;
    if (assets.tokens !== undefined && typeof assets.tokens !== "string") {
      errors.push({
        field: `modes.${mode}.tokens`,
        message: `modes.${mode}.tokens must be a string path`,
      });
    }
    if (assets.css !== undefined && typeof assets.css !== "string") {
      errors.push({
        field: `modes.${mode}.css`,
        message: `modes.${mode}.css must be a string path`,
      });
    }

    const hasTokens =
      typeof assets.tokens === "string" && assets.tokens.length > 0;
    const hasCss = typeof assets.css === "string" && assets.css.length > 0;
    if (!hasTokens && !hasCss) {
      errors.push({
        field: `modes.${mode}`,
        message: `modes.${mode} must declare at least one of tokens or css`,
      });
    }
  }

  if (declaredCount === 0) {
    errors.push({
      field: "modes",
      message: "modes must declare at least one of light or dark",
    });
  }

  return errors;
}
