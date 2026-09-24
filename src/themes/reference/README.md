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

## 크롬 (§370.3)

이 테마는 세 크롬 표면(활동 표시줄 · 상태 표시줄 · 탭 표시줄)을 **감춘 채로 시작할
것을 제안한다** — §370.3 이 "레퍼런스 테마는 포커스 모드를 기본으로 제안한다" 고
적는다. 매니페스트의 `chrome` 셋이 모두 `false` 인 것이 그 선언이다.

**제안이지 강제가 아니다.** 앱은 이번 세션에 사용자가 아직 손대지 않은 표면에만 이
값을 쓴다 — 상태 표시줄을 켠 뒤 이 테마를 입으면 상태 표시줄은 켜진 채로 남는다.
그 판정을 아는 것은 `chromeTouched`(`src/stores/ui/ui.ts`)이고, 적용은 테마 id 가
바뀌는 전이에서 한 번이다(`src/stores/ui/chrome-proposal.ts`).

되돌리는 길은 앱 안에 있다. 아래 세 경로로 되살린 표면은 그 세션 동안 "사용자가
고른 것" 이 되어 테마가 다시 감추지 못한다 — 셋 다 `chromeTouched` 를 기록하는
입구(`toggleActivityBar`·`toggleStatusBar`·`toggleTabBar`·`revealAllChrome`,
`src/stores/ui/ui.ts`)로 이어지기 때문이다:

- **단축키** — `Mod+Alt+A`(활동 표시줄) · `Mod+Alt+S`(상태 표시줄) · `Mod+Alt+B`
  (탭 표시줄). 하나씩 되살린다. `Mod` 는 macOS 에서 ⌘, 그 밖에서 Ctrl 이고, 셋 다
  리매핑할 수 있다(`src/keybindings/keybinding-registry.ts` 의
  `view.toggleActivityBar` · `view.toggleStatusBar` · `view.toggleTabBar` 전사).
- **가장자리 복귀 버튼** — 셋이 **모두** 숨었을 때 화면 위 가장자리에 얇은 버튼이
  뜬다(`src/components/layout/chrome-reveal.tsx`). 포인터 호버와 키보드 포커스 양쪽에서
  드러나고, 누르면 셋이 한 번에 돌아온다. 이 테마의 제안이 만드는 상태가 정확히 그
  "모두 숨음" 이라, 단축키를 모르는 사용자에게도 길이 남는다.
- **설정 > 화면 배치**의 "표시 여부" 토글 셋. 단축키와 같은 입구를 쓴다
  (`src/components/settings/tabs/layout/ChromeVisibilitySection.tsx`).

**화면구성(Perspective)을 고르는 것은 이 목록에 들지 않는다.** `Writing` 등 다른
프리셋을 골라 크롬을 되살리는 것은 `applyPreset`(`src/stores/file/workspace.ts`)이
부르는 `setChromeVisibility`(`src/stores/ui/ui.ts`)를 거치는데, 이 입구는 표면
하나가 아니라 화면 전체를 고르는 행위라 의도적으로 아무것도 기록하지 않는다
(`src/stores/ui/ui.ts` 의 `setChromeVisibility` doc 주석).
그래서 이 테마가 감춘 채로 시작한 뒤 프리셋으로 크롬을 되살려도 "손댄 것" 으로
남지 않고, 다음에 고르는 테마(또는 이 테마로의 재전이)가 다시 감출 수 있다.

기록은 세션 범위다 — 앱을 다시 켜면 가시성도 기록도 기본으로 돌아가고, 제안이 다시
닿는다. 그 이유는 `chromeTouched` 의 doc 주석에 있다.

## 간격과 모서리 (§365)

`density: "compact"` · `cornerRadius: "round"` 를 선언한다 — 밀도(4)는 강하게, 모서리(5)는
약하게 행사하라는 스펙 0055 §10.3 의 지시를 따른다.

**compact 인 이유:** 이 테마는 위 §370.3 절에서 크롬 세 표면을 모두 감추도록 제안한다
(`chrome` 이 셋 다 `false`) — 본문 조판이 우선이고 크롬은 물러난다는 §371.3 의 성격
그대로다. 밀도 다이얼이 옮기는 것은 UI 크롬의 간격(패널·팝오버·버튼 등, `--space-*`
스케일)이고, 본문의 리듬은 따로 정해진다. 문단 간격·자간은 에디터 다이얼
`editorParagraphSpacing` · `editorLetterSpacing` 이 갖고(변수 `--editor-paragraph-spacing` ·
`--editor-letter-spacing` — 예: `src/styles/editor/blocks.css` 의
`.tiptap p { margin: var(--editor-paragraph-spacing, 0.5em) 0; }`), 줄 높이는 다이얼이 아닌
에디터 설정 `lineHeight` 가 갖는다(`src/hooks/use-settings-effects.ts` 가 에디터 DOM 에
인라인 `line-height` 로 쓴다).
그래서 `compact` 는 본문 조판을 건드리지 않고 크롬만 더 좁혀, "크롬이 물러난다" 는 이
테마의 성격을 한 번 더 강하게 만든다.

**round 인 이유(그리고 "약하게" 가 이 스키마에서 표현되지 못하는 이유):** 스펙 0055
§10.3 은 모서리를 "약하게" 행사하라고 하지만, 스펙 0057 D1 은 두 다이얼을 곱수 슬라이더가
아니라 **3단 열거**(`sharp`/`default`/`round`)로 정했다 — 연속값이 없으니 "약하게" 에
해당하는 중간 눈금이 없다. 레퍼런스는 `default`(선언 생략)가 아니라 비기본 단을 골라
다이얼의 매니페스트 경로(값이 파싱되어 `<html>` 에 CSS 변수로 나오는 길)를 실제로 행사하는
쪽을 택했다 — "약하게" 라는 지시가 이 3단 스키마에서 표현될 수 없었다는 사실을 여기
기록한다.
