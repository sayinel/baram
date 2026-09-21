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
// 논거가 깨진다. 그래서 이 함수가 거는 규칙은 "`colors` 가 없으면 건너뛴다"이지
// "`css` 를 가지면 건너뛴다"가 아니다 — 둘은 각각 optional이라(§355) `css`가 있어도
// `colors`가 있을 수 있고, 그 경우 `tokens.json`은 그대로 실린다. 리뷰(0091 fix round 1,
// Finding 8)가 짚었다: 예전 문구는 "css를 가진 모드는 tokens.json이 없다"는, 코드가
// 실제로 하지 않는 함의를 담고 있었다. 오늘 `ThemeModeAssets.css`가 "이 계획 범위에서는
// 항상 undefined"(`types/theme.ts`)라 둘이 실제로 갈리는 입력은 아직 없지만, 주장은
// 코드가 하는 일을 말해야 한다.
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
 * 이 함수가 만드는 패키지 포맷(모드별 `tokens.json` + 이 모양의 `baram-theme.json`)을
 * 처음으로 설치할 수 있는 Baram 버전. `baram-theme.json`의 `engines.baram`에 그대로 쓴다.
 *
 * ‼️ `">=0.0.0"`으로 두지 않는다(0091 fix round 1, Finding 3 — 리뷰가 잡았다). 실측:
 * `git tag --contains e07eeb44`(§360 커밋, 테마 설치 경로를 처음 들여온 커밋)가
 * **비어 있다** — 최신 태그는 `v0.7.3`이고 `package.json`도 `0.7.3`이다. 즉 **테마 설치
 * 경로 자체가 아직 릴리스된 적이 없다**. `">=0.0.0"`은 "릴리스된 모든 Baram이 설치할 수
 * 있다"는 주장인데, 사실은 "릴리스된 어떤 Baram도 테마 패키지를 설치할 수 없다"이므로 그
 * 값은 정직하지 않다.
 *
 * (이 함수가 순수해서 `getVersion()`을 부를 수 없다는 것은 이 필드가 상수인 이유가 아니다
 * — 앞 판의 이 주석이 그렇게 적었고 그것은 비약이었다. floor는 **런타임 값이 아니라
 * 릴리스 사실**이라 상수로 두는 것 자체는 항상 순수하다. 값을 못 정하는 진짜 이유는
 * 아래에 적힌 대로다: 그 릴리스가 아직 이름이 없다.)
 *
 * 그래서 지금은 **정확한 값을 쓸 수 없다** — 이 포맷을 처음 싣고 나갈 릴리스가 아직
 * 존재하지 않기 때문이다. §360(테마 설치 경로)이 실제로 릴리스되는 날, 그 버전 번호로
 * 이 상수를 바꿀 것. 그때까지는 어떤 값을 적어도 틀리므로, 최소한 문법은 유효해야 한다는
 * 요구만 `parseBaramFloor`로 고정한다(테스트가 `"banana"` 같은 파싱 불가 문자열을 막는다
 * — 그런 값은 `unmetFloorAgainstApp`에서 "의견 없음"으로 조용히 읽혀, 이 필드가 아예 없는
 * 것과 똑같이 동작하면서도 있는 것처럼 보인다).
 */
const MIN_BARAM_FOR_TOKENS_PACKAGE = ">=0.0.0";

/**
 * 테마 이름에서 패키지 id 기본값을 만든다 — `THEME_ID_RE`(`theme-manifest.ts`)가 요구하는
 * `[a-z0-9-]+`만 남기고 나머지는 하이픈으로 접는다.
 *
 * ‼️ 제안일 뿐이다(0091 fix round 1, Finding 4) — `ThemeEditor`가 이 값을 id 입력의
 * **초기값**으로만 쓰고, 저자가 그 뒤 자유롭게 고친다. 이름이 ASCII 영숫자·하이픈을 하나도
 * 담지 않으면(예: 순한글 이름) 빈 문자열이 나올 수 있다 — 그 경우 저자가 직접 채워야
 * 하고, 이 함수가 임의의 대체 문자열을 지어내지 않는다.
 */
export function slugifyThemeId(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

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
    engines: { baram: MIN_BARAM_FOR_TOKENS_PACKAGE },
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
