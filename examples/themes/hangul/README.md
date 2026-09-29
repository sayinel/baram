# Baram Hangul — 관리자 노트

이 폴더는 레지스트리에 게시할 테마 **Baram Hangul** 의 원본이다. 이 README 는 관리자 노트이고 게시 zip 에
들어가지 않는다(스펙 0063 §7.1 — 아래 "zip 에 들어가는 것").

## 무엇인가

**한글로 글을 쓰는 사람을 위한 기본 테마**다(스펙 0063 D8). 라이트 · 다크 두 모드를 `tokens.json` 으로만 싣고
CSS 는 없다. 매니페스트의 `description` 이 성격을 한 문장으로 적는다 — 줄바꿈에서 어절이 깨지지 않고, Pretendard 로,
미색 종이 위에.

초안(옮기기 전의 `src/themes/reference/` — 커밋 `a61e1317` 에 그대로 있다)은 "한글 본문 조판 우선 · 에디터
우선" 의 레퍼런스 테마였고, 크롬 세 표면을 감추는 몰입형 전제와 다이얼의 매니페스트 경로를 행사하려고 고른 값을 함께
실었다. 출고하면서 그 둘을 걷어 냈다(D10 · D11). 다이얼 스키마를 시험하는 역할은
`src/themes/__tests__/reference-theme.test.ts` 로 남는다(스펙 0063 §10 이 0055 §9.3 · §10.3 에 단 정정) — 아래
"테스트가 보는 것".

**게시 파이프라인은 `.github/workflows/plugin-release.yml` 의 `release-theme` 잡이다**(계획 0113, 스펙 0063 §7.3).
`theme-hangul-v<version>` 태그가 이 폴더를 묶어 레지스트리에 올린다 — 태그 단계의 허용 목록이 디렉터리 `hangul` 에 id
`baram-hangul` 을 고정한다. 무엇이 묶이고 게시 전에 무엇을 보는지는 아래 "zip 에 들어가는 것". 게시는 v0.7.7 릴리스
뒤다(스펙 0063 D3 · §7.6) — 묶기 단계가 `package.json` 의 버전을 하한 `">=0.7.7"` 과 비교해 그보다 낮으면 거부하고,
2026-09-28 의 `package.json` 은 0.7.6 이다. 같은 날 라이브 `index.json` 에 `baram-hangul` 항목은 없다.

## 매니페스트

| 필드 | 값 | 근거 |
|---|---|---|
| `id` | `baram-hangul` | 바꾸지 않는다. 설치 기록 `installedThemes` 가 id 를 키로 쓰므로(`src/stores/settings/appearance-settings.ts`) 게시 뒤 id 를 바꾸면 이미 설치한 사용자에게는 다른 테마가 된다. 폴더 `hangul` 과 게시 태그 `theme-hangul-v…` 도 그대로다(D8) |
| `name` | `Baram Hangul` | 레지스트리 항목은 한 언어라 내장 테마 이름과 같은 영문이다. `Baram` 은 내장 `Baram Garden Light` · `Baram Garden Dark` 의 선례, `Hangul` 은 Unicode 블록 이름 · id 에 맞춘 표기다(D8) |
| `version` | `1.0.0` | 첫 게시(D8). 게시된 버전은 바꾸지 않으므로(스펙 0063 §7.7) 게시 뒤 zip 에 드는 파일을 고치면 버전을 올린다 |
| `engines.baram` | `">=0.7.7"` | 아래 "`engines.baram`" 절 |
| `dials` | 여섯 | 아래 "다이얼" 절 |
| `chrome` | 키째 없다 | 아래 문단 |

**크롬을 싣지 않는다(D10).** 기본 테마를 골랐는데 탭 · 상태 · 활동 표시줄이 모두 사라지는 것은 기본 테마에서
기대할 일이 아니다 — 스펙 0063 D10 은 몰입을 화면구성 프리셋의 몫으로 둔다. 표시줄 셋을 감추는 내장 프리셋은
`Focus`(한국어 UI `포커스`)다 — 사이드바 · 오른쪽 패널과 함께 다섯 표면을 감춘다(`src/stores/file/workspace.ts` 의
`BUILTIN_PRESETS`). 이름이 비슷한 `Writing`(`글쓰기`)은 사이드바와 오른쪽 패널만 닫고 표시줄 셋은 그대로 둔다. 잃은 것은
레퍼런스가 다이얼 9(크롬)를 실제로 쓰는 게시물이라는 역할이다. 초안은 세 표면을 모두 `false` 로 제안했고, 그 제안
경로의 테스트는 이제 테스트 전용 픽스처 `src/themes/__tests__/fixtures/focus-theme.json` 을 읽는다 —
`src/stores/ui/__tests__/chrome-proposal.test.ts` · `src/hooks/__tests__/use-settings-effects-theme-chrome.test.tsx`
가 그 픽스처를 실제 관문(`validateThemeManifest`)에 통과시켜 쓰고, `src/themes/__tests__/focus-theme-fixture.test.ts`
가 픽스처 자신이 관문을 지나며 세 표면을 모두 `false` 로 선언하고 그 선언이 관문에서 버려지지 않는지 고정한다.

## `engines.baram` — 무엇을 답하는가, 왜 `">=0.7.7"` 인가

**이 필드가 답하는 것은 "이 패키지 포맷을 설치하고 쓸 수 있는가" 다 — "이 안의 모든 필드를 읽는가" 가 아니다.**
`src/themes/theme-package-export.ts` 의 `MIN_BARAM_FOR_TOKENS_PACKAGE`(`">=0.7.4"`)가 정의하는 뜻 그대로다. 설치
경로는 이 값을 `finishStagedThemeInstall` 의 `unmetFloorAgainstApp` 으로 읽고, 하한에 못 미치는 앱은 설치를
`appTooOld` 로 거부한다(`src/themes/theme-install.ts` — 앱 버전을 읽지 못하면 "의견 없음" 으로 통과시킨다).

**v0.7.4 가 그 간극을 보인다.** v0.7.4(태그 커밋 `8792afb4`)는 이 포맷을 설치할 수 있는 첫 태그된 릴리스다 —
`src/themes/theme-install.ts` 가 v0.7.3 에 없고 v0.7.4 에 있다(`git cat-file -e <태그>:src/themes/theme-install.ts`).
그런데 그 태그의 `theme-manifest.ts` 를 보면(`git show v0.7.4:src/themes/theme-manifest.ts`) `validateThemeManifest`
가 `dials` 를 검사하지 않고(`capabilities` · `main` 만 명시적으로 거부한다), `rebuildManifest` 도 `dials` 를 참조하지
않는 명시적 필드 목록으로 결과를 짓는다 — 그 파일에 `dials` 라는 낱말이 없다. 그래서 다이얼을 싣는 매니페스트는
v0.7.4 에서 설치를 막는 어떤 검사에도 걸리지 않고, 다이얼 제안값만 전달되지 않는다.

**다이얼을 읽는 첫 릴리스는 v0.7.5 다.** 매니페스트에 `dials` 를 들인 `ff5610ae`(§371)는 v0.7.4 에 없고 v0.7.5 에
있다(`git merge-base --is-ancestor ff5610ae v0.7.4` 거짓, `… v0.7.5` 참). 다만 설치할 때 앱이 모르는 다이얼 id 는
버려지고 앱을 올려도 되살아나지 않는다(`src/themes/theme-manifest.ts` 의 `dials` doc 주석). 이 테마의 여섯 가운데
`editorFontFamily` · `editorFontSize` 가 v0.7.5 에서 그렇게 버려진다 — 둘을 `DIALS` 에 들인 `4b91d20a`(§365)는
v0.7.5 에 없고 v0.7.6 에 있다(`git merge-base --is-ancestor 4b91d20a v0.7.5` 거짓, `… v0.7.6` 참). 나머지 넷은
v0.7.5 의 `src/appearance/dials.ts` 에 이미 있다.

**이 테마의 하한 `">=0.7.7"` 의 근거는 다이얼이 아니라 Low-4 다(스펙 0063 D3).** 파일로 설치한 테마의 출처를
갤러리 · 찾아보기에 보이고, 레지스트리가 같은 id 의 파일 설치본을 바꾸기 전에 묻는 변경(`99022700`)은 v0.7.6 에
없다(`git merge-base --is-ancestor 99022700 v0.7.6` 거짓). 하한이 그보다 낮으면 이 테마가 게시되는 순간 v0.7.6
사용자에게 파일 사본이 레지스트리 테마로 보이는 경우가 열린다. v0.7.4 · v0.7.5 · v0.7.6 의 `theme-install.ts` 가 모두
`unmetFloorAgainstApp` 을 부르므로, 그 셋은 이 테마를 설치 단계에서 `appTooOld` 로 거부한다. 같은 하한 덕에 위 두
문단의 간극도 이 테마에 닿지 않는다 — 여섯 다이얼은 v0.7.6 의 `DIALS` 에도, 2026-09-28 의 `src/appearance/dials.ts`
에도 모두 있다. D3 의 처음 근거에는 크롬 거절 기록도 있었는데, D10 으로 이 테마가 크롬을 싣지 않게 되어 근거가
Low-4 하나로 좁혀졌다(D3 의 정정).

v0.7.7 은 아직 태그되지 않았다(2026-09-28, `git tag`). 스펙 0063 §7.6 이 v0.7.7 릴리스를 이 테마의 게시 앞에 둔다.

## 다이얼

선언한 다이얼은 사용자 설정 행에 테마 출처로 서고 앱 기본을 가리므로, 기본 테마는 적게 선언한다(D11). 그래서
**한글 때문에 앱 기본과 달라야 하는 여섯**만 싣는다. 앱 기본은 `src/appearance/dials.ts` 의 `defaultValue` 다.

| 다이얼 | 값 | 앱 기본 | 한글 근거 |
|---|---|---|---|
| `editorLineBreak` | `keepAll` | `normal` | 기본 줄바꿈은 한글 단어를 임의 위치에서 자른다(스펙 0055 §368). `keepAll` 은 `--editor-word-break: keep-all` 과 `--editor-overflow-wrap: break-word` 를 쓴다 — 넘치는 어절만 끊는다 |
| `editorEmphasisStyle` | `weight` | `italic` | 한글에는 진짜 italic 이 없어 `*강조*` 가 가짜 기울임으로 찌그러진다(0055 §368). `weight` 는 기울이지 않고 굵힌다. 표시 층의 선택이라 문서와 마크다운은 그대로다(스펙 0055 의 7.2 절) |
| `editorFontFamily` | `Pretendard Variable` | `""` — 토큰 스택 `--font-family-editor` | 지금은 기본 스택의 첫 항목과 같은 서체다(`tokens/primitive/typography.json`). 선언하는 것은 앱 기본이 바뀌어도 한글 본문이 제 서체를 지키게 하려는 것이다(스펙 0060 §9.1). 서체 파일은 싣지 않는다 — 앱이 번들한다(`src/utils/font/bundled-fonts.ts` 의 `BUNDLED_FONTS`) |
| `editorFontSize` | `17` | `16` | 초안이 "읽기 우선 테마의 비기본값" 으로 고른 값이고(0060 §9.1) D11 이 남겼다. 0060 §9.1 · 0063 D11 은 이 1px 에 한글 고유의 측정을 적지 않는다 — 판단이다 |
| `editorLetterSpacing` | `-0.01`(em) | `0` | 한글 본문은 약간의 음수 자간이 관례다(0055 §368) |
| `editorParagraphSpacing` | `1`(em) | `0.5` | 0055 §368 의 한글 본문 조판 요구 넷 가운데 하나다 — 들여쓰기가 아니라 문단 사이 공백 |

**싣지 않는 다이얼과 그 이유는 `reference-theme.test.ts` 의 `NOT_EXERCISED` 가 적는다** — 여기 베끼지 않는다(베끼면
낡는다). 선언한 다이얼과 그 목록의 합집합이 `DIALS` 의 id 와 정확히 같아야 하므로(양방향), 다이얼을 더한 사람은 그
테스트가 빨개져서 이 테마가 그 다이얼을 행사할지를 한 번 답하게 된다.

## 색 (§367)

**미색 종이 · 먹색 글자 · 쪽빛 강조 · 호박색 경고**(스펙 0063 D12). 값은 `light/tokens.json` · `dark/tokens.json` 이
갖는다 — 모드마다 시드 24키다. 의미 색 29키는 앱이 그 시드에서 계산하고(`src/appearance/color-derive.ts`), 반투명
오버레이 7키와 툴팁 쌍 2키는 파생하지 않는다 — 그 근거는 계획 0095 의 "파생시키지 않는 9키" 다.

**초안의 결함 — 강조와 경고가 겹쳤다.** 초안의 강조는 황토였고, `--color-status-warning` 이 다크에서는
`--color-accent-default` 와 같은 `#d4a960`, 라이트에서는 색상 차 1.6°(강조 `#8a6d3b` · 경고 `#b07d1a`)였다
(`a61e1317` 의 두 `tokens.json`, 색상은 `src/appearance/color-hsl.ts` 의 `hexToHsl`). `src/appearance/color-derive.ts`
의 규칙표가 `--color-callout-info` 를 강조에서, `--color-callout-warning` 을 경고에서 그대로 가져오므로 정보 콜아웃과
경고 콜아웃이 다크에서는 같은 색, 라이트에서는 거의 같은 색상이었다. D12 가 강조를 쪽빛으로, 경고를 호박색으로
옮겼다 — 모드마다 시드 일곱(`accent-default` · `accent-hover` · `accent-subtle` · `editor-selection` · `editor-cursor` ·
`graph-active` · `status-warning`)이 바뀌었고, 종이 · 먹색 · 테두리 · `accent-ai` · 위험 · 성공 · 그래프 노드 · 선은
그대로다.

**앱의 대비 보고는 이것을 못 잡는다.** `src/appearance/contrast-report.ts` 의 `contrastWarningsFor` 는 `TEXT_PAIRS`
여섯 쌍(`text-primary` · `text-secondary` · `editor-text` 와 그 배경)만 보고, 강조도 경고도 그 여섯에 없다. 그래서
`reference-theme.test.ts` 가 직접 단언한다 — 경고와 강조, 경고와 위험(`--color-status-danger`)의 색상 거리가 두 모드
모두 30° 이상, 강조(링크 글자색이다 — `src/styles/editor/media.css` 의 `.tiptap a`)가 `--color-editor-bg` 위에서
`AA_TEXT_RATIO`(`src/utils/color-contrast.ts`) 이상. 경고와 위험을 가르는 이유도 같은 규칙표에 있다 —
`--color-callout-warning` · `--color-callout-question` 은 경고에서, `--color-callout-danger` · `--color-callout-bug` ·
`--color-callout-failure` 는 위험에서 색상 회전 없이 나오므로, 경고가 위험 쪽으로 기울면 경고 · 질문 콜아웃이 위험 ·
버그 · 실패 콜아웃처럼 읽힌다(처음 고른 주황 `#b45f1a` · `#e5935a` 는 위험과 22.3° · 19.2° 였다). 2026-09-28 값으로는
(라이트 · 다크) 경고와 강조의 거리 177.9° · 179.6°, 경고와 위험의 거리 35.5° · 34.2°, 강조 대비 7.73 · 7.26 이다.
경고의 대비(4.62 · 8.46)는 두 모드 모두 `AA_TEXT_RATIO`(4.5) 이상이지만 단언하지 않는다 — 대비를 보는 두 케이스(강조의
AA, `contrastWarningsFor` 의 여섯 쌍) 어느 쪽도 경고를 보지 않으므로, 경고가 AA 아래로 내려가도 `reference-theme.test.ts`
는 빨개지지 않는다.

**남은 확인:** D12 의 값은 계산으로 고른 후보다. 색상 거리는 이제 두 쌍(경고 ↔ 강조, 경고 ↔ 위험)을 테스트가 고정하지만
거리가 눈에 보이는 구별을 보장하지는 않는다 — 게시 전 파일 설치 점검(스펙 0063 §7.5)에서 콜아웃 넷이 구별되는지 눈으로
보고 확정한다.

**24키인 이유 — `--color-editor-guide-tint` 를 싣지 않는다.** 앱의 시드는 25키(`src/types/theme-color-keys.ts` 의
`THEME_COLOR_KEYS`)이고, 25번째인 `--color-editor-guide-tint` 는 `aliasOf: "--color-editor-text"` 를 가진 늦게 생긴
키다. 설치가 그 키를 같은 팔레트의 `--color-editor-text` 값으로 채운다(`fillAliasedColors`).
`src/themes/__tests__/theme-install.test.ts` 의 "installs the reference theme's palette, which predates the guide tint"
가 이 폴더의 `light/tokens.json` 을 그 옛 24키 팔레트의 실물로 읽는다 — 이 파일에 그 키를 더하면 그 케이스가
빨개진다.

### 테마 CSS 로는 되찾을 수 없는 키 (§367)

`colors` 를 싣는 테마에서 앱은 **시드 25키와 파생 38키를 `<html>` 의 인라인 커스텀 프로퍼티로 쓴다**(`applyThemeVars`,
`src/utils/theme-vars.ts`). 인라인은 테마 CSS 가 갇혀 있는 `@layer baram-theme` 를 이기고, `!important` 로 뒤집을 수도
없다 — 설치가 선언의 `!important` 를 지우고(`sanitizeThemeCss`, `src/utils/theme-css/sanitize.ts`), 그러고도
`!important` 토큰이 CSS 어디에든 남으면 설치는 그 CSS 를 거부하고 로드는 주입하지 않는다(`verifyStoredThemeCss` 의
`hasImportantSpelledAnywhere`, `src/utils/theme-css/verify.ts`). 그래서 **`tokens` 와 `css` 를 함께 싣는 테마는 이
키들을 자기 스타일시트에서 다시 선언해도 화면에 닿지 않는다.** 시드는 §358 부터 이미 그랬고, §367 이 파생 29키를 그
계약 안으로 들여왔다.

| 집합 | 개수 | 어디서 오는가 |
|---|---|---|
| 시드 | 25 | 테마가 선언한 `tokens` 그대로 — `aliasOf` 를 가진 키가 빠졌으면 설치가 같은 팔레트의 값으로 채운다(`fillAliasedColors`) |
| 대비 짝 | 9 | `DERIVED_KEYS` — 강조·status 의 채움과 그 전경(`#330`) |
| 의미 색 | 29 | `DERIVED_COLOR_KEYS` — callout 13 · graph 7 · git 4 · status 3 · bg 2 |

세 목록의 canonical 한 집은 코드다(`src/types/theme-color-keys.ts` 의 `THEME_COLOR_KEYS`, `src/utils/theme-vars.ts` 의
`DERIVED_KEYS`, `src/appearance/color-derive.ts` 의 `DERIVED_COLOR_KEYS`) — 여기 키 이름을 베껴 적으면 낡는다.

**그래서 이 키들을 바꾸는 방법은 CSS 가 아니라 시드다.** 파생값은 시드에서 계산되므로(`color-derive.ts` 의 규칙표 —
예: `--color-callout-info` 는 `--color-accent-default` 그대로, `--color-bg-selection` 은 강조의 명도를
`--color-bg-default` 쪽으로 82% 옮긴 값), 원하는 파생색이 나오도록 시드를 고르는 것이 지원되는 유일한 통로다.
테마 CSS 는 이 63키 **밖**의 것 — 선택자·간격·모양·아직 파생되지 않는 9키 — 을 위한 자리다.

**배경 대비 다이얼이 기본이 아니면 최대 다섯 키 — `flat` 은 셋(`bg-panel` 과 역할 토큰 둘), `white`·`black` 은
다섯 — 이 더 다이얼의 것이다.** 역할 토큰 `--color-bg-bar` · `--color-bg-chrome-fill`(`src/appearance/background-contrast.ts`
의 `BG_ROLE_KEYS`)이 인라인에 실리고, 시드 `--color-bg-default` · `--color-editor-bg` · `--color-bg-panel` 은 테마의
선언 대신 다이얼의 재배선을 따른다(스펙 0059 §3.2). 이 테마는 배경 대비 다이얼을 싣지 않는다 — 사용자 층에 값이
없으면 두 모드 모두 앱 기본 `default` 다.

## 테스트가 보는 것

`src/themes/__tests__/reference-theme.test.ts` 가 이 폴더의 `baram-theme.json` 과 두 `tokens.json` 을 경로로 읽는다.

| 무엇을 보는가 | 무엇이 실패시키는가 |
|---|---|
| 매니페스트가 실제 관문 `validateThemeManifest` 를 지난다 | 관문이 거부하는 매니페스트 |
| 선언한 다이얼이 재구성 뒤에도 선언과 같다 | 범위 밖의 값, 또는 앱이 모르는 다이얼 id — 그 이름이 곧 스키마가 부족한 자리다 |
| 원본에도 검증 결과에도 `chrome` 이 없다(D10) | `chrome` 을 되살리면 |
| `engines.baram` 이 `">=0.7.7"` 이다(D3) | 하한을 바꾸면 |
| 강조와 경고의 색상 거리가 두 모드 모두 30° 이상(D12) | 경고를 강조 가까이로 옮기면. hex 가 아니거나 무채색인 값은 던진다 |
| 위험과 경고의 색상 거리가 두 모드 모두 30° 이상(D12) | 경고를 위험 가까이로 옮기면 — 처음 고른 주황이 그랬다(22.3° · 19.2°) |
| 강조가 `--color-editor-bg` 위에서 두 모드 모두 `AA_TEXT_RATIO` 이상 | 강조의 대비가 그 아래로 가면 |
| 선언한 다이얼 ∪ `NOT_EXERCISED` = `DIALS` 의 id | `DIALS` 에 다이얼이 생기거나 빠지면, 또는 한 다이얼이 양쪽에 다 있거나 어느 쪽에도 없으면 |
| 두 모드의 시드에서 파생 29키(`DERIVED_COLOR_KEYS`)가 모두 나온다 | 파생의 입력 시드가 빠지면 |
| 두 모드의 파생이 키마다 서로 다르다 | 두 모드가 같은 색을 내면(위 단언의 비공허성 짝) |
| `contrastWarningsFor` 가 두 모드 모두 경고를 내지 않는다 | `TEXT_PAIRS` 여섯 쌍 가운데 하나가 `AA_TEXT_RATIO` 아래로 가면 |

이 폴더를 경로로 읽는 곳은 테스트 여덟과 워크플로 잡 하나다(`git grep -n "examples/themes" -- src scripts .github`,
2026-09-29). 그 명령이 찾는 파일은 열하나이고, 나머지 둘은 읽지 않는다 — `scripts/run-theme-package.ts` 는 사용법 주석에
이 경로를 예로 적을 뿐 폴더를 `--dir` 로 받고, `src/themes/theme-manifest.ts` 의 두 doc 주석은 이 README 를 가리킨다.

| 파일 | 읽는 방법 |
|---|---|
| `src/themes/__tests__/reference-theme.test.ts` | `resolve(__dirname, "../../../examples/themes/hangul/…")` — `baram-theme.json` 과 두 `tokens.json` |
| `src/themes/__tests__/theme-install.test.ts` | 같은 `resolve` — `light/tokens.json`(위 "24키인 이유") |
| `src/themes/__tests__/theme-tokens.test.ts` | 같은 `resolve` — `light/tokens.json` |
| `src/plugins/__tests__/registry-index-theme-mode.test.ts` | 같은 `resolve` — `baram-theme.json` |
| `src/themes/__tests__/theme-package-script.test.ts` | 같은 `resolve` 로 폴더째(`HANGUL`) — 임시 폴더로 복사해 한 가지씩 망가뜨리기도 한다 |
| `src/themes/__tests__/theme-package-install-parity.test.ts` | 같은 `resolve` 로 폴더째 `packageTheme` 에 넘긴다 |
| `src/themes/__tests__/theme-registry-chain.test.ts` | `join(ROOT, "examples/themes/hangul")` — `ROOT` 는 `resolve(__dirname, "../../..")` |
| `.github/workflows/plugin-release.yml` | `release-theme` 잡의 `examples/themes/$DIR` — 태그 단계가 그 아래 `baram-theme.json` 이 있는지 보고, 묶기 단계가 `--dir` 로 넘기고, checksum 관문이 그 아래 `SHA256SUMS` 를 읽는다(아래 "zip 에 들어가는 것") |
| `src/themes/__tests__/theme-release-workflow.test.ts` | 그 잡의 묶기 단계를 실행한다(`runPackageAndVerify`) — 저장소의 `examples` 를 링크한 합성 루트에서 `DIR=hangul` 로 |

마지막 파일은 위 명령에 단언 문자열 · 테스트 이름 · doc 주석 덕에 걸렸다 — 그 파일에서 경로를 짓는 줄은 `"examples"` 를
따로 쓰고(`runPackageAndVerify` 가 링크하는 이름 목록, `runTagStep` 과 `runChecksumStep` 이 임시 폴더에 가짜 폴더를 짓는
`join(root, "examples", "themes", …)`), 그런 철자는 `"examples/themes"` 로 찾으면 걸리지 않는다. 가짜 폴더를 짓는 두
함수는 이 폴더를 읽지 않는다. `git grep -n '"examples"' -- src scripts .github` 로 한 번 더 훑으면(2026-09-29) 네 줄이
나오고, 그 파일의 그 세 줄 말고 하나는 `examples/plugins` 를 짓는 `malicious-fixture.test.ts` 다.
폴더를 옮기면 컴파일은 통과해도 위 테스트 여덟이 모두 빨개진다(2026-09-29 — 폴더를 치우고 여덟 파일을 돌려 8 파일 · 27
테스트 실패) — 옮길 때 위 표의 경로를 함께 고친다.

## zip 에 들어가는 것

묶는 곳은 `scripts/theme-package.ts` 의 `packageTheme` 이다. `plugin-release.yml` 의 `release-theme` 잡(`theme-*`
태그)과 아래 게시 전 점검이 같은 CLI `scripts/run-theme-package.ts` 를 지난다 — 잡은
`npx tsx scripts/run-theme-package.ts package` 로, 점검은 같은 명령을 부르는 `npm run theme:package`(`package.json`)로.

zip 에는 **`baram-theme.json` 과, 검증을 통과한 매니페스트의 `modes` 가 선언한 파일만** 목록대로 들어간다
(`themePackageFiles`) — 폴더를 통째로 묶지 않는다. 이 테마에서는 `baram-theme.json` · `light/tokens.json` ·
`dark/tokens.json` 셋이다(`packageTheme` 이 돌려주는 `files`, 2026-09-28). **이 README 는 들어가지 않는다** — 플러그인
zip(`plugin-release.yml` 의 `Package ZIP` 단계가 `README.md` 를 함께 묶는다)과 다른 점이다. 아래 게시 전 점검의 sha256 을
적는 `SHA256SUMS` 도 선언된 모드 파일이 아니라 들어가지 않는다(`theme-package-script.test.ts` 가 고정한다). 테마 경로에는
빌드 단계가 없다(§7.3).

- **zip 은 레지스트리의 `plugins/` 에 간다** — `baram-plugins` 저장소의 `plugins/baram-hangul-1.0.0.zip`, 플러그인 zip 과
  나란히(계획 0113 P1 — 스펙 0063 D9 의 정정). 색인의 `downloadUrl` 도 그 경로다(`scripts/update-registry-index.mjs`).
- **바이트가 재현된다**(P5) — 무압축(`level: 0`)에 고정 시각(`ZIP_DATE`)이고 확장 타임스탬프를 꺼서
  (`extendedTimestamp: false` — 켜면 그 extra field 가 시각을 UTC 로 따로 적어, 2026-09-29 에 시간대 `UTC` ·
  `America/Los_Angeles` · `Asia/Seoul` 에서 묶은 zip 의 sha256 셋이 서로 달랐다) 같은 원본(zip 에 드는 세 파일)은
  같은 바이트가 된다. 세 조건은 `theme-package-script.test.ts` 의 "같은 원본은 같은 바이트가 된다" 가 zip 을 다시 읽어
  항목마다 본다. 시간대 · zlib 판본 · 파일 시각이 끼지 않고, `theme-package.ts` 의 머리 주석이 드는 남은 변수는
  `package.json` 이 캐럿 없이 고정한 `@zip.js/zip.js` 판본 하나다. 2026-09-28 에 `package.json` 을 0.7.7 로 둔 합성 루트에서 시간대 `UTC` · `America/Los_Angeles` 로
  한 번씩 묶은 두 zip(2,732바이트)의 sha256 이 같았다. 그래서 게시 전 점검에서 만든 zip 의 `sha256=` 값이 워크플로가 태그
  커밋에서 만든 zip 의 sha256 과 같아야 한다 — 다르면 점검한 파일이 게시될 파일이 아니고, 워크플로가 그 태그를 push 전에
  거부한다(아래 4 · 5).
- **CSS 를 선언한 테마는 거부한다**(P6) — `themePackageFiles` 는 `modes.<mode>.css` 가 비어 있지 않으면 거부한다. 테마
  CSS 는 `url()` 로 패키지 안의 다른 파일을 끌어 오는데(`src/utils/theme-css/inline-assets.ts`), 그 파일을 목록에 올리는
  규칙이 이 파이프라인에 없다. 이 테마는 CSS 를 싣지 않는다.

게시 전 점검(스펙 0063 §7.5)은 레지스트리로 나갈 바로 그 zip 을 로컬에서 만들어 **파일에서 설치**로 넣어 보는 것이다.
순서는 이렇다.

1. `package.json` 의 `version` 이 0.7.7 이상인 커밋의 저장소 루트에서 먼저 `npm ci` 로 `node_modules` 를
   `package-lock.json` 에 맞춘다 — 위 "바이트가 재현된다" 의 남은 변수가 `@zip.js/zip.js` 판본이라, 낡은 `node_modules`
   로 만든 zip 은 같은 바이트라는 보장이 없다. 그렇게 sha256 이 어긋나면 5 의 관문이 태그를 거부하면서 CI 가 만든 zip 이
   점검한 zip 이 아니라고 말할 뿐, 원인이 로컬의 `node_modules` 라고는 말하지 않는다. 그다음
   `npm run theme:package -- --dir examples/themes/hangul --version 1.0.0 --out <폴더>` 를 돌리고(없는 폴더는 만든다) 출력의 `zip_name=` ·
   `sha256=` 두 줄을 적어 둔다. CLI 가 앱 버전을 `./package.json` 에서 읽어 하한과 비교하므로(`releaseFloorProblem`, 계획 0113 P12) 그보다
   낮은 커밋에서는 zip 을 쓰지 않고 종료 코드 1 로 거부한다 — 2026-09-28 에는 `package.json` 이 0.7.6 이라
   `app version 0.7.6 does not satisfy this theme's engines.baram (>=0.7.7) — release the app first` 가 나온다. 그래서
   이 점검은 v0.7.7 릴리스를 준비할 때 한다.
2. 그 zip 을 `테마 가져오기...` 로 설치한다. 하한 때문에 이 점검은 앱이 스스로 보고하는 버전(`src/plugins/engines-app.ts`
   의 `currentAppVersion` 이 읽는 `getVersion()`)이 0.7.7 이상인 빌드에서만 설치까지 간다 — 그보다 낮은 빌드는
   `appTooOld` 로 거부한다.
3. 두 모드에서 정보 · 경고 · 위험 · 성공 콜아웃이 서로 구별되는지 눈으로 본다 — 위 "남은 확인", 스펙 0063 D12 가 이
   점검에 남긴 확인이다. D12 는 "콜아웃 넷" 의 이름을 적지 않는다 — 이 넷은 계획 0113 이 적은 것이고,
   `color-derive.ts` 의 규칙표에서 `--color-callout-info` · `--color-callout-warning` · `--color-callout-danger` ·
   `--color-callout-success` 가 각각 다른 시드(강조 · 경고 · 위험 · 성공)에서 나온다.
4. 1 의 두 값을 `sha256sum` 형식의 한 줄 `<sha256>  <zip_name>`(64자 소문자 16진수, 공백 두 칸, zip 이름 — 이 릴리스는
   `…  baram-hangul-1.0.0.zip`)으로 이 폴더의 `SHA256SUMS` 끝에 더하고, 태그할 릴리스 커밋에 함께 커밋한다. 릴리스마다
   한 줄을 더한다. 이 파일은 zip 에 들지 않으므로 이 커밋은 zip 의 바이트를 바꾸지 않는다 — 1 을 돌린 커밋과 태그할
   커밋이 이 파일만 다르면 같은 zip 이 나온다. 2026-09-29 에 이 파일은 아직 없다 — 게시된 릴리스가 없다.
5. main 에 있는 그 커밋에 태그 `theme-hangul-v1.0.0` 을 push 한다. `release-theme` 잡의
   `Check the checksum the pre-publish check recorded` 단계가 그 커밋에서 만든 zip 의 `<sha256>  <zip_name>` 줄이
   `SHA256SUMS` 에 글자 그대로 있는지 보고(`grep -qxF`), 파일이 없거나 일반 파일이 아니거나(심볼릭 링크 포함) 그 줄이
   없으면 색인을 쓰기 전에 잡을 멈춘다. 줄이 없다는 것은 CI 가 만든 zip 이 2 에서 설치한 zip 이 아니라는 뜻이다(또는 4 의 줄이
   없거나 잘못 적혔다). 게시된 zip 은 바꾸지 않으므로(스펙 0063 §7.7) push 뒤에 알게 되면 폐기와 새 버전이 든다 — 그래서 push
   앞에서 대조한다.
6. (선택) 잡이 끝난 뒤 라이브 `index.json`(`src/stores/system/plugin.ts` 의 `DEFAULT_REGISTRY_URL`)에서 `baram-hangul`
   항목의 `checksum` 이 1 의 `sha256=` 값과 같은지 본다. 5 의 관문이 대조한 값과 색인에 쓰이는 값은 같은 단계
   (`Compute the theme checksum`)의 출력이므로 이것은 push 가 닿았는지의 확인이지 유일한 대조가 아니다.
