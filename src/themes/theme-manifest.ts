// §360 테마 매니페스트 검증 (스펙 0049 §4)
//
// `src/plugins/manifest.ts`의 `validateManifest`를 본보기로 삼되 복사하지 않는다 — 에러를
// 첫 건에서 멈추지 않고 전부 모아 돌려주는 방식은 같지만, 테마 매니페스트는 `capabilities`도
// `main`도 없고 대신 `modes`를 갖는 다른 모양이다. 텍스트 필드 길이 상한과 제어·bidi 문자
// 거부, 매니페스트 크기 상한 값은 카드 라벨 위장을 이미 막고 있는
// `src/components/settings/tabs/use-theme-import.ts`와 같은 값을 그대로 쓴다 — 그 파일은
// 다른 wire 포맷(`{name, base, colors}`)을 검증하므로 셰이프가 아니라 값만 재사용한다.
import type { DialValue } from "../appearance/dials";
import type { ThemeMode } from "../types/theme";

import { DIALS } from "../appearance/dials";
import { THEME_MODES } from "../types/theme";

/**
 * `[a-z0-9-]` — 플러그인 id 규칙과 동일(스펙 0049 §4: "플러그인 id 규칙과 동일").
 *
 * `src/plugins/manifest.ts`에는 id 정규식이 **둘** 있고 서로 다르다: `:87`의
 * `/^[a-z0-9-]+$/`(플러그인 id — 이 규칙)와 `:48`의 `CONTRIBUTION_ID`
 * (`/^[A-Za-z0-9_-]+$/`, 대문자·언더스코어까지 허용하는 contribution id 규칙, 여기
 * 대상이 아니다). 테마 id는 설치 디렉터리 이름이 되므로, 느슨한 쪽을 쓰면 대소문자
 * 구분 없는 파일시스템에서 두 테마가 같은 디렉터리로 충돌한다.
 *
 * export한다(0091 fix round 1, Finding 4) — `ThemeEditor`의 패키지 id 입력이 여기 있는
 * 것과 같은 규칙으로 미리 거부해야 하고(설치 시점에야 Rust가 독립적으로 재확인하는
 * 규칙과 같은 값), 로컬로 다시 적으면 세 번째 사본이 생긴다. 이미 둘(TS 여기, Rust
 * `install.rs`의 `read_staged_theme_manifest`)이 같은 문자 집합을 따로 적고 있다.
 */
export const THEME_ID_RE = /^[a-z0-9-]+$/;

/**
 * 이름·설명 길이 상한 — `use-theme-import.ts`의 이름 상한과 같은 값.
 *
 * 0090 최종 리뷰(L5) 에서 export 로 열었다: `scripts/validate-index.ts` 가 **레지스트리
 * 항목**의 `name` 에 같은 상한을 걸어야 하는데(동의 대화상자가 그리는 것은 매니페스트가
 * 아니라 그 항목의 이름이다), 숫자를 두 번 적는 대신 하나를 나눠 쓴다.
 */
export const MAX_TEXT_FIELD_CHARS = 100;

/**
 * 제어·bidi 문자 거부 — `use-theme-import.ts`의 이름 검사와 같은 문자 집합. 카드·삭제
 * 라벨을 속이는 표기(bidi override 등)를 막는다.
 *
 * {@link MAX_TEXT_FIELD_CHARS} 와 같은 이유로 export 다 — 발행 게이트가 같은 집합을 쓴다.
 */
export const UNSAFE_TEXT_CHARS_RE =
  // ‼️ 이 자리다 — 선언 위가 아니라. export 로 열면서 선언이 두 줄로 접혔고, 위에 두면
  // `-next-line` 이 가리키는 것은 `export const …` 줄이라 정규식에 닿지 않는다(실측).
  // eslint-disable-next-line no-control-regex -- 제어문자 거부가 목적이다
  /[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/;

/**
 * 매니페스트 직렬화 크기 상한 — `use-theme-import.ts`가 import 파일 전체에 거는 상한과
 * 같은 값. `data`는 이미 `JSON.parse`를 거친 뒤이므로(호출부 주석 참조) 이 상한이 막는
 * 것은 파싱 비용이 아니라, 그 뒤를 잇는 필드별 검사가 거대한 문자열을 반복해서 훑는
 * 비용이다. `baram-theme.json`은 메타데이터 몇 줄이면 충분하니, 이보다 크면 실수이거나
 * (예: `description` 필드에 거대한 문자열을 채워) 그 비용을 부풀리려는 시도다.
 *
 * ‼️ 이 숫자는 Rust `MAX_THEME_MANIFEST_BYTES`(`src-tauri/src/plugin/install.rs`)와
 * 값이 같을 뿐, **단위와 대상이 다르다**(0091 fix round 1 리뷰, LOW 6 — 값을 맞추는 것이
 * 아니라 여기 적어 두는 것으로 처리하기로 판정됨). 여기는 `JSON.stringify(data)`(이미
 * 파싱된 객체를 compact 하게 다시 직렬화한 것)의 **문자** 수를 잰다. Rust 쪽은 디스크에
 * 있는 파일의 **바이트** 수를 잰다(`std::fs::metadata`) — 그 파일이 어떻게 포매팅돼
 * 있든. 들여쓴 JSON은 이 익스포터가 쓰는 패키지의 성질이지 Rust 가 재는 대상의 성질이
 * 아니다: 이 검증기의 다른 호출자는 커뮤니티 설치 경로이고, 거기 오는 매니페스트는 다른
 * 도구가 만든 compact JSON 일 수 있다. 한글처럼
 * UTF-16 코드 유닛 하나가 UTF-8 세 바이트가 되는 문자가 많으면 이 관문이 더 느슨하게
 * 통과시킬 수 있다는 뜻이다. 두 층 모두 "먼저 도는" 쪽이 상대가 이미 걸렀다고 가정하지
 * 않으므로 구조적으로 안전하지만(§360 문서 순서: 상한 → parse → 검증, 두 언어 각각),
 * 값 자체를 맞추려면 어느 쪽이 단위를 바꿀지 정해야 하고 양쪽 다 자기 값을 다른 곳에서
 * 인용하는 주석을 이미 갖고 있다 — 그래서 여기는 값을 맞추지 않고 이 사실만 적어 둔다.
 *
 * ‼️ 그리고 이 필드별 검사(`validateTextField`)는 `name`·`description` 둘에만 걸린다. `author`·`license`·`version`은 이 함수 안에서 "빈 문자열이
 * 아닌 string" 검사만 받고, `MAX_TEXT_FIELD_CHARS`(100자) 상한도 `UNSAFE_TEXT_CHARS_RE`
 * (제어·bidi 문자 거부)도 받지 않는다 — 매니페스트 전체 상한(위) 안에서라면 임의 길이의
 * `author` 문자열이 통과한다. 이 파일이 §360 커뮤니티 테마 설치 경로의 유일한 구조
 * 검증기이므로(`read_staged_theme_manifest`가 이 검증을 재구현하지 않고 위임한다), 세 필드를
 * 여기 추가하는 것은 이 함수 하나만 고치면 되는 일이 아니라 오늘 설치되는 실제 커뮤니티
 * 매니페스트들에 대한 행동 변경이다 — 그래서 고치지 않고 이 자리에 남겨 둔다.
 */
const MAX_MANIFEST_JSON_CHARS = 64 * 1024;

export interface ManifestValidationError {
  field: string;
  message: string;
}

export interface ThemeManifest {
  author: string;
  description: string;
  /**
   * §371.1 테마가 **제안하는** 다이얼 값. 강제가 아니다 — 사용자 층이 언제나 이긴다
   * (§366 의 층 순서).
   *
   * ‼️ 모드별이 아니라 최상위다. 지금 있는 다이얼 중 라이트/다크에 따라 갈릴 값이
   * **하나도 없고**(본문 폭·여백·줄바꿈은 해가 져도 그대로다), 모드에 의존하는 값은
   * `data-theme` 과 `prefers-color-scheme` 리스너를 소유한 이펙트에서 적용해야 한다
   * — 붙이는 곳과 떼는 곳이 갈리면 #330 이 다시 난다(`use-settings-effects.ts` 와
   * `theme-vars.ts` 가 그 사고를 기록한다). 모드별 다이얼(`modes.{light,dark}.dials`)
   * 은 그런 다이얼이 처음 생기는 계획(0095, §367 강조색)이 함께 들여온다.
   *
   * ‼️ 설치 시점에 앱이 모르는 다이얼 id 는 **버려지고, 앱을 올려도 되살아나지 않는다**
   * — `rebuildManifest` 의 결과가 그대로 `InstalledTheme.manifest` 로 저장되기 때문이다.
   * 되살리려면 재설치다. `engines.baram` 은 이 사실을 표현하지 못한다 — 그 필드가
   * 답하는 것은 "이 패키지 포맷을 설치하고 쓸 수 있는가" 뿐이고 "이 안의 모든 필드를
   * 읽는가" 가 아니다(`src/themes/reference/README.md`). v0.7.4 가 정확히 그 간극을
   * 보인다: 이 포맷을 설치할 수 있는 첫 태그된 릴리스이면서, 동시에 `dials` 를
   * 검사도 참조도 하지 않아 조용히 버리는 릴리스이기도 하다 — 버려짐이 곧
   * `engines.baram` 만으로는 알 수 없는 것이다.
   */
  dials?: Readonly<Record<string, DialValue>>;
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
  errors.push(...validateDials(obj.dials));

  if (errors.length > 0) {
    return { valid: false, errors };
  }

  return { valid: true, manifest: rebuildManifest(obj) };
}

/**
 * The validated fields, and only those — a whitelist REBUILD, not a cast.
 *
 * ‼️ THE CAST STORED UNKNOWN KEYS FOR THE LIFE OF THE INSTALL (external review #6). Every
 * field above is checked and none was copied, so `obj as unknown as ThemeManifest` carried
 * whatever else the JSON held: `installTheme` puts that object in the record,
 * `partialize` (`stores/settings/store.ts`) includes `installedThemes`, and
 * `tauriStorage.setItem` has no debounce and no diff — so zustand serializes the whole blob
 * and IPCs it to `config.json` after every `set`. `MAX_MANIFEST_JSON_CHARS` bounds it at
 * 64 KiB, which is the size of the rider, not a reason to carry one.
 *
 * `readModeColors` (`theme-install.ts`) already does exactly this for `tokens.json`, and its
 * doc comment names the audit BLOCKER that forced it: checking that a key EXISTS and then
 * storing the whole object lets everything unnamed through. Same rule, the other file.
 *
 * Every read here is preceded by a check above, so the assertions are narrowings of values
 * already proven — `modes` is the only one that needs its own walk, because the checker
 * validates entries in place rather than collecting them.
 */
function rebuildManifest(obj: Record<string, unknown>): ThemeManifest {
  const modes: ThemeManifest["modes"] = {};
  for (const mode of THEME_MODES) {
    const declared = obj.modes as Record<string, unknown>;
    const entry = declared[mode];
    if (entry === undefined) continue;
    const assets = entry as Record<string, unknown>;
    // Present-and-a-string is what `validateModes` proved; an absent one stays absent
    // rather than becoming `undefined`-valued, so a round trip through JSON is identical.
    const rebuilt: ThemeManifestModeAssets = {};
    if (typeof assets.css === "string") rebuilt.css = assets.css;
    if (typeof assets.tokens === "string") rebuilt.tokens = assets.tokens;
    modes[mode] = rebuilt;
  }

  // ‼️ `DIALS` 를 돈다 — 입력을 돌면 낯선 키가 저장분에 실린다. 값은 그 다이얼의
  // `parse` 를 지나야 하고, 그것은 설정 UI·사용자 층이 쓰는 **같은** 관문이다.
  const dials: Record<string, DialValue> = {};
  const declared = obj.dials;
  if (
    typeof declared === "object" &&
    declared !== null &&
    !Array.isArray(declared)
  ) {
    const source = declared as Record<string, unknown>;
    for (const dial of DIALS) {
      const parsed = dial.parse(source[dial.id]);
      if (parsed !== undefined) dials[dial.id] = parsed;
    }
  }

  return {
    author: obj.author as string,
    description: obj.description as string,
    ...(Object.keys(dials).length > 0 ? { dials } : {}),
    engines: { baram: (obj.engines as { baram: string }).baram },
    id: obj.id as string,
    license: obj.license as string,
    modes,
    name: obj.name as string,
    version: obj.version as string,
  };
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
 * `dials` 는 **선택**이다. 있으면 객체여야 하고, 내용은 여기서 거부하지 않는다 —
 * 모르는 id 와 통과하지 못한 값은 `rebuildManifest` 가 **조용히 버린다.**
 *
 * 거부가 아니라 버리기인 이유: 이 필드는 보안 경계가 아니라 호환성 표면이다. 새
 * 다이얼을 쓰는 테마가 구 버전 앱에서 설치조차 되지 않으면, 테마 저자는 다이얼을
 * 쓰지 않는 쪽을 고르게 된다. 값이 `<html>` 에 도달하는 경로는 `DIALS` 화이트리스트
 * 순회 하나뿐이라(§366), 버려진 값은 아무 데도 닿지 않는다.
 */
function validateDials(value: unknown): ManifestValidationError[] {
  if (value === undefined) return [];
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return [{ field: "dials", message: "dials must be an object" }];
  }
  return [];
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
  for (const mode of THEME_MODES) {
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
