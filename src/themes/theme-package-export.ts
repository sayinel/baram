// §363 테마 패키지 내보내기 (스펙 0049 §12.1) — ThemeEditor 가 편집 중인 팔레트를, 이
// 앱의 설치 경로가 읽을 수 있는 `baram-theme.json` + 모드별 `tokens.json` 엔트리 맵으로.
//
// ‼️ 순수 함수다 — 파일도 IPC 도 건드리지 않는다(그래서 `Promise` 가 아니다). zip 바이트를
// 만드는 것은 Rust `theme_package_build`(`plugin::build_zip_bytes`)다: 프런트엔드에는 zip
// 라이브러리가 없다(실측: `npm ls fflate jszip` 이 비어 있다). 이 파일이 만드는 것은 그
// 커맨드가 받을 `Record<string, Uint8Array>` 뿐이다.
//
// ‼️ 매니페스트가 zip **루트**에 있어야 설치된다 — `dir.join("baram-theme.json")`
// (`src-tauri/src/plugin/install.rs`)이 스테이징 루트를 그대로 쓰고, 추출은 최상위 폴더를
// 벗기지 않는다(`plugin/archive.rs`). 그래서 아래 키는 `"baram-theme.json"` 이지
// `"<무언가>/baram-theme.json"` 이 아니다 — 이 파일이 내보내는 `Record` 의 키가 곧 zip
// 안 경로이므로, 그 사실 하나가 루트 배치를 보장한다.
//
// CSS 는 다루지 않는다. `ThemeEditor` 의 `resolvedTheme` 은 `lookupThemes` 를 캐시 인자
// 없이 불러 설치 테마의 CSS 를 절대 `customThemes` 로 옮기지 않는데(그 파일의 주석이
// §360 의 보안 논거가 거기 기댄다고 적어 두었다), 그 CSS 를 여기서 따로 읽어와 실으면 그
// 논거가 깨진다. 그래서 이 함수는 `colors` 만 본다 — `css` 를 가진 모드는 `tokens.json`
// 이 없으므로(관계는 `tokens`·`css` 각각 optional, §355) 통째로 건너뛴다.
import type { ThemeDef, ThemeMode } from "../types/theme";
import type { ThemeManifest } from "./theme-manifest";

import { themeModes } from "../types/theme";

/** GUI 가 모르는, 매니페스트가 요구하는 값들. 전부 필수 — 비면 설치되지 않는 패키지가 나온다. */
export interface PackageMeta {
  author: string;
  description: string;
  license: string;
  version: string;
}

/**
 * `baram-theme.json` 이 요구하는 `engines.baram` 값.
 *
 * ‼️ 실행 중인 앱 버전(`getVersion()`)에서 유도하지 **않는다** — 그러려면 IPC 가 필요하고
 * 이 함수는 순수해야 한다(§363 인터페이스, `Promise` 가 아니다). `PackageMeta` 도 이 값을
 * 받지 않는다(0091 Task 3 브리프의 고정 인터페이스). 그래서 항상 통과하는 최소 하한을
 * 쓴다: 이 패키지가 쓰는 모드 맵 셰이프를 실제로 요구하는 최저 버전을 이 순수 함수 안에서
 * 확인할 방법이 없는 이상, 틀릴 수 있는 구체적 하한보다 항상-충족 하한이 정직하다.
 * `validateThemeManifest` 는 이 필드가 비어있지 않은 문자열이기만을 요구한다(§4) — semver
 * 형식 자체는 검증하지 않는다.
 */
const PACKAGE_ENGINES_BARAM = ">=0.0.0";

export function themePackageEntries(
  theme: ThemeDef,
  meta: PackageMeta,
): Record<string, Uint8Array> {
  const encoder = new TextEncoder();
  const entries: Record<string, Uint8Array> = {};
  const manifestModes: ThemeManifest["modes"] = {};

  for (const mode of modesWithColors(theme)) {
    const colors = theme.modes[mode]?.colors;
    // `modesWithColors` 가 이미 `colors !== undefined` 로 걸렀다 — narrowing 뿐이다.
    if (colors === undefined) continue;
    const tokensPath = `${mode}/tokens.json`;
    entries[tokensPath] = encoder.encode(JSON.stringify(colors, null, 2));
    manifestModes[mode] = { tokens: tokensPath };
  }

  const manifest: ThemeManifest = {
    author: meta.author,
    description: meta.description,
    engines: { baram: PACKAGE_ENGINES_BARAM },
    id: theme.id,
    license: meta.license,
    modes: manifestModes,
    name: theme.name,
    version: meta.version,
  };
  // 루트 배치 — 파일 헤더 참조. 다른 어떤 접두사도 붙이지 않는다.
  entries["baram-theme.json"] = encoder.encode(
    JSON.stringify(manifest, null, 2),
  );

  return entries;
}

/**
 * `theme` 가 선언한 모드 중 이 함수가 실제로 실을 수 있는 것 — 색이 있는 모드만.
 *
 * `css` 만 있고 `colors` 가 없는 모드(§358)는 이 함수가 다루지 않으므로(파일 헤더 참조)
 * 빠진다. 결과가 비어 있을 수 있다 — 호출자가 `ThemeEditor` 인 한 편집 중인 `base` 모드는
 * 항상 색을 갖지만, 이 함수 자체의 계약은 그 전제에 기대지 않는다.
 */
function modesWithColors(theme: ThemeDef): ThemeMode[] {
  return themeModes(theme).filter(
    (mode) => theme.modes[mode]?.colors !== undefined,
  );
}
