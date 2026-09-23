# 레퍼런스 테마 (초안)

**성격:** 한글 본문 조판 우선 · 에디터 우선 (스펙 0055 §371.3).

**이 디렉터리는 아직 설치 가능한 패키지가 아니다.**

| 없는 것 | 누가 채우는가 |
|---|---|
| 다이얼을 읽는 릴리스 번호 — 지금 태그된 릴리스 중엔 없다 | 0097 (§371 출고) |
| 번들 · 설치 · 출고 경로 | 0097 (§371) |
| 다이얼 값의 export | 0097 (§371.2) |

**`engines.baram` 이 `">=0.7.4"` 인 이유:** 이 필드는 `theme-package-export.ts` 의
`MIN_BARAM_FOR_TOKENS_PACKAGE` 가 정의하는 뜻 그대로 "다이얼을 읽을 수 있다" 가
아니라 "이 패키지 포맷을 설치하고 쓸 수 있다" 를 답한다. v0.7.4 는 실제로 태그된
릴리스이고(`git log -1 --format='%ci %h' v0.7.4` → `8792afb4`), §360 테마 설치
경로를 들여온 커밋(`e07eeb44`)과 이 계획의 다이얼 메커니즘 커밋(`0cfa6b65`, PR
#712) 둘 다의 후손이다(`git merge-base --is-ancestor e07eeb44 v0.7.4`,
`git merge-base --is-ancestor 0cfa6b65 v0.7.4` 모두 참) — 즉 v0.7.4 가 이 패키지
포맷을 설치할 수 있는 첫 태그된 릴리스라는 것이 실측이다.

**단, v0.7.4 는 `dials` 필드를 조용히 버린다.** 그 태그의 `theme-manifest.ts` 를
확인하면(`git show v0.7.4:src/themes/theme-manifest.ts`) `validateThemeManifest`
가 `dials` 를 검사하지 않고(`capabilities`·`main` 만 명시적으로 거부한다),
`rebuildManifest` 도 `dials` 를 참조하지 않는 명시적 필드 목록으로 결과를 짓는다.
그래서 이 매니페스트는 v0.7.4 에서 설치를 막는 어떤 검사에도 걸리지 않고, 다이얼
제안값만 전달되지 않는다. `engines.baram` 은 "설치 가능" 의 정직한 하한이고, "다이얼을
읽는다" 는 별개의 사실이다 — 다이얼을 읽는 첫 릴리스는 아직 태그가 없다. 그 번호는
0097(§371, 이 테마를 실제로 출고하는 계획)이 그날 정한다.

**있는 것:** 매니페스트와 다이얼 값, 그리고 `light/tokens.json` · `dark/tokens.json`
(§367, 0095). `src/themes/__tests__/reference-theme.test.ts` 가 그것을 실제 관문에
통과시키고, **레퍼런스가 행사하지 않는 다이얼을 명시적으로 열거하도록 강제한다.**
다이얼을 새로 더하면 그 테스트가 빨개지는 것이 설계다.

## 색 (§367)

시드 24키를 모드마다 선언한다. 나머지 semantic 색 중 **29키는 앱이 시드에서 계산**하고
(`src/appearance/color-derive.ts`), 9키는 파생하지 않는다 — 반투명 오버레이 7개와
툴팁 쌍 2개이고, 그 근거는 계획 0095 의 "파생시키지 않는 9키" 표에 있다.

강조색 **이동량** 다이얼(`accentHueShift` · `accentSaturationShift`)은 쓰지 않는다.
이동량의 기준은 테마 자신의 강조 시드인데 이 테마는 그것을 직접 선언하므로, 이동량
0 이 옳고 0 은 기본값이라 선언할 값이 없다.

### 테마 CSS 로는 되찾을 수 없는 키 (§367)

`colors` 를 싣는 테마에서 앱은 **시드 24키와 파생 38키를 `<html>` 의 인라인 커스텀
프로퍼티로 쓴다**(`applyThemeVars`, `src/utils/theme-vars.ts`). 인라인은 테마 CSS 가
갇혀 있는 `@layer baram-theme` 를 이기고, 위생 검사가 `!important` 를 CSS 어디에
있든 토큰 단위로 거부하므로(`hasImportantSpelledAnywhere`,
`src/utils/theme-css/verify.ts`), **`tokens` 와 `css` 를 함께 싣는 테마는 이 키들을
자기 스타일시트에서 다시 선언해도 화면에 닿지 않는다.** 시드 24키는 §358 부터 이미
그랬고, §367 이 파생 29키를 그 계약 안으로 들여왔다.

| 집합 | 개수 | 어디서 오는가 |
|---|---|---|
| 시드 | 24 | 테마가 선언한 `tokens` 그대로 |
| 대비 짝 | 9 | `DERIVED_KEYS` — 강조·status 의 채움과 그 전경(#330) |
| 의미 색 | 29 | `DERIVED_COLOR_KEYS` — callout 13 · graph 7 · git 4 · status 3 · bg 2 |

세 목록의 canonical 한 집은 코드다(`src/utils/theme-vars.ts` 의 `DERIVED_KEYS`,
`src/appearance/color-derive.ts` 의 `DERIVED_COLOR_KEYS`) — 여기 키 이름을 베껴 적으면
낡는다.

**그래서 이 키들을 바꾸는 방법은 CSS 가 아니라 시드다.** 파생값은 시드에서 계산되므로
(`color-derive.ts` 의 규칙표 — 예: `--color-callout-info` 는 `--color-accent-default`
그대로, `--color-bg-selection` 은 강조의 명도를 `--color-bg-default` 쪽으로 82%
옮긴 값), 원하는 파생색이
나오도록 시드를 고르는 것이 지원되는 유일한 통로다. 테마 CSS 는 이 62키 **밖**의
것 — 선택자·간격·모양·아직 파생되지 않는 9키 — 을 위한 자리다.
