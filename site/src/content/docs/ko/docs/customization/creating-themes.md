---
title: "테마 만들기"
sourceHash: "2170372f3e0f"
---

다른 사람에게 건넬 수 있는 테마는 패키지입니다 — 누구나 **테마 가져오기...**로 설치하는 `.zip`
파일 하나입니다. 이 페이지는 패키지에 무엇이 들어가는지, 설치할 때 Baram이 무엇을 검사하는지, 그리고
시험하고 나누는 방법을 다룹니다. 테마를 고르고 설치하는 방법은 [테마](/ko/docs/customization/themes/)에
있습니다.

## 패키지

- 매니페스트 `baram-theme.json`은 zip의 **루트**에 둡니다. 매니페스트가 폴더 안에 있는 패키지는
  거부합니다.
- 모드마다 색을 담은 `tokens.json`, CSS 파일, 또는 둘 다를 둡니다. 경로는 매니페스트가 패키지 루트
  기준 상대 경로로 적습니다. Baram이 내보내는 패키지는 `light/tokens.json`과 `dark/tokens.json`을
  씁니다.

## 매니페스트

```json
{
  "id": "my-theme",
  "name": "My Theme",
  "description": "Warm paper tones for long reading.",
  "author": "Your Name",
  "license": "MIT",
  "version": "1.0.0",
  "engines": { "baram": ">=0.7.6" },
  "modes": {
    "light": { "tokens": "light/tokens.json", "css": "theme.css" },
    "dark": { "tokens": "dark/tokens.json", "css": "theme.css" }
  },
  "dials": { "density": "compact", "editorFontSize": 17 },
  "chrome": { "statusBar": false }
}
```

| 필드 | 필수 | 담는 것 |
| ---- | ---- | ------- |
| `id` | 예 | 영문 소문자·숫자·`-`만 씁니다. 이미 가진 id의 테마를 설치하면, Baram이 물은 뒤 그 테마를 바꿉니다. 내장 테마의 id와 `system`은 예약돼 있습니다: `default-light`, `default-dark`, `tokyo-night`, `solarized-light`, `solarized-dark`, `nord`, `baram-garden-light`, `baram-garden-dark`, `system` |
| `name`, `description` | 예 | 각각 100자 이하이고, 제어 문자나 bidi 재정의 문자를 넣을 수 없습니다 |
| `author`, `license`, `version` | 예 | 문자열입니다. 갤러리 카드가 제작자와 버전을 보여 줍니다 |
| `engines.baram` | 예 | 테마에 필요한 가장 오래된 Baram을 `>=X.Y.Z`로 적습니다. 그보다 오래된 버전은 설치를 거부합니다. Baram은 이 형식만 읽고, 다른 형식은 하한이 없는 것으로 봅니다 |
| `modes` | 예 | `light`, `dark`, 또는 둘 다. 각각 `tokens` 경로, `css` 경로, 또는 둘 다를 갖습니다 |
| `dials` | 아니요 | 테마가 제안하는 외관 설정 — [아래](#제안하는-설정) 참고 |
| `chrome` | 아니요 | 테마가 숨기자고 제안하는 표시줄: `activityBar`·`statusBar`·`tabBar`. 각각 `false`면 숨기자고, `true`면 보이자고 제안합니다. 사용자에게 어떻게 보이는지는 [테마](/ko/docs/customization/themes/#테마가-표시줄을-숨기자고-제안할-때)에 있습니다 |

`capabilities`나 `main`을 선언한 매니페스트는 거부합니다 — 두 필드는 플러그인의 것입니다.

## 색

모드마다 `tokens.json`은 테마 편집기의 색 25개를 CSS 변수 이름으로 적고, 값은 불투명 hex 색(`#rgb`
또는 `#rrggbb`)으로 적는 JSON 객체입니다 — 예를 들어 `"--color-bg-default": "#fbf9f4"`. 이름은
내보낸 패키지에서 얻는 것이 가장 쉽습니다. 색이 하나라도 빠졌거나 값이 그런 hex 색이 아니면, Baram은
테마를 설치할 때 오류 없이 그 모드의 색을 버리고, 대신 Baram의 기본 색이 보입니다. 예외는
`--color-editor-guide-tint`(**List Guide**) 하나로, 빠지면 `--color-editor-text`의 값을 받습니다.

## 제안하는 설정

`dials`는 외관 설정의 값을 제안합니다. 제안된 값은 그 설정 행에 **테마**로 보이고, 사용자가 정한 값이
그보다 앞섭니다. 각 설정이 하는 일은 [외관 다이얼](/ko/docs/customization/settings-and-themes/#외관-다이얼)과
[글꼴](/ko/docs/customization/settings-and-themes/#글꼴)에 있습니다.

| `id` | 설정 | 값 |
| ---- | ---- | -- |
| `accentHueShift` | **강조색 색상** | -180 ~ 180 |
| `accentSaturationShift` | **강조색 채도** | -50 ~ 50 |
| `backgroundContrastLight` | **라이트 배경 대비** | `"default"`, `"flat"`, `"white"`(전부 흰색) |
| `backgroundContrastDark` | **다크 배경 대비** | `"default"`, `"flat"`, `"black"`(순흑) |
| `density` | **밀도** | `"compact"`, `"default"`, `"spacious"` |
| `cornerRadius` | **모서리** | `"sharp"`, `"default"`, `"round"` |
| `editorLineBreak` | **줄바꿈** | `"normal"`(기본), `"keepAll"`(단어 단위 (한글)) |
| `editorLetterSpacing` | **자간** | -0.05 ~ 0.1 (em) |
| `editorParagraphSpacing` | **문단 간격** | 0 ~ 2 (em) |
| `editorEmphasisStyle` | **강조 표시** | `"italic"`, `"color"`(강조색), `"weight"`(굵게) |
| `editorMaxWidth` | **본문 폭** | 0 ~ 4000 (px, 0은 제한 없음) |
| `editorPadding` | **본문 여백** | 0 ~ 16 (rem) |
| `editorListGuideStrength` | **리스트 가이드 농도** | 0 ~ 40 |
| `editorOrderedMarkerAlign` | **리스트 번호 정렬** | `"number"`(숫자 기준), `"period"`(마침표 기준) |
| `editorFontFamily` | **글꼴** | 서체 이름, 128자 이하 |
| `editorCodeFontFamily` | **코드 서체** | 서체 이름, 128자 이하 |
| `editorFontSize` | **글꼴 크기** | 8 ~ 32 (px) |
| `editorLineHeight` | **줄 높이** | 1 ~ 3 |

이 Baram이 모르는 id나 받지 않는 값은 테마를 설치할 때 오류 없이 버려지고, 나중에 Baram을 업데이트해도
되살아나지 않습니다 — 테마를 다시 설치해야 합니다. `chrome`도 같습니다. Baram이 모르는 표시줄 이름이나
`true`·`false`가 아닌 값은 버려집니다.

## 테마 CSS

- Baram은 스타일시트를 캐스케이드 레이어 `@layer baram-theme`로 감쌉니다. Baram 자체의 컴포넌트
  스타일은 어떤 레이어에도 들어 있지 않고, CSS 캐스케이드에서는 레이어 밖의 규칙이 레이어 안의 규칙을
  이깁니다. 그래서 같은 요소의 같은 속성을 둘 다 정하면 Baram의 규칙이 이깁니다.
- 색은 CSS가 아니라 `tokens.json`에서 정합니다. Baram은 색 변수 25개와 거기서 파생한 색을 루트 요소에
  레이어 밖에서 선언하고, 모드의 색을 `tokens.json`에서 가져왔다면 그 자리에 인라인으로도 씁니다. 그래서 CSS에서
  `:root`나 `html`에 같은 변수를 선언해도 효과가 없습니다.
- 테마는 `!important`를 쓸 수 없습니다. 설치할 때 떼어 내고, 남은 것이 있는 스타일시트는 거부합니다.
- CSS가 가리키는 이미지와 서체(`url()` 등)는 패키지 안의 파일이어야 하고 상대 경로로 가리켜야 합니다.
  설치할 때 그 파일을 스타일시트 안에 옮겨 담습니다. 받는 형식: `.gif`, `.jpeg`, `.jpg`, `.otf`,
  `.png`, `.svg`, `.ttf`, `.webp`, `.woff`, `.woff2`.
- 거부하는 것: `@import`, 패키지 밖의 주소(`https:` 같은 주소와 직접 쓴 `data:` URI), `#`·`?`·`%`·`\`가
  든 경로나 `/`로 시작하거나 패키지 밖으로 나가는 경로, `var()`·`env()`·`attr()`로 만든 주소, 패키지에
  없는 파일.
- 중첩한 스타일 규칙은 `&`로 시작합니다(`.card { & .title { … } }`). Baram은 그 밖의 중첩 스타일
  규칙을 읽지 못하고, 읽지 못한 스타일시트는 거부합니다 — 닫히지 않은 블록이 있는 스타일시트도
  마찬가지입니다.

| 대상 | 상한 | 넘으면 |
| ---- | ---- | ------ |
| 패키지(`.zip`) | 32 MiB | 거부 |
| `baram-theme.json` | 64 KiB | 거부 |
| 한 모드의 스타일시트, 쓴 그대로 | 512 KiB | 거부 |
| 한 모드의 스타일시트가 가리키는 파일들의 합 — 파일마다 한 번씩 셈 | 2 MiB | 거부 |
| 그 파일들을 옮겨 담은 한 모드의 스타일시트 | 4 MiB | 거부 |
| 한 모드의 `tokens.json` | 64 KiB | 그 모드의 색을 버림 |

## 시작하는 세 가지 방법

- **외관을 내보냅니다.** **설정 > 외관**의 **외관을 테마로 내보내기...**는 입고 있는 색, Baram 기본값과
  다른 다이얼·글꼴 설정, 그리고 원하면 숨긴 표시줄을 패키지로 저장합니다 —
  [외관을 테마로 내보내기](/ko/docs/customization/themes/#외관을-테마로-내보내기) 참고. 압축을 풀고
  거기서부터 고칩니다.
- **테마 편집기에서 시작합니다.** **커스터마이즈...**에서 패키지 정보를 채우고 **테마 패키지로
  내보내기**를 누르면, 편집 중인 팔레트를 색만 담은 패키지로 저장합니다. **색 설정 내보내기**는 같은 색을
  색 설정 파일로 저장합니다 — **테마 가져오기...**가 받기는 하지만 패키지가 아니어서 id·버전·라이선스가
  없습니다.
- **직접 씁니다.** 이 페이지의 규칙을 따릅니다.

## 테마 시험하기

패키지를 **설정 > 외관**의 **테마 가져오기...**로 설치합니다 —
[파일에서 테마 설치](/ko/docs/customization/themes/#파일에서-테마-설치) 참고. Baram은 편집하는 폴더에서
테마를 다시 읽어 들이지 않습니다. 파일을 고친 뒤 `baram-theme.json`이 루트에 오도록 다시 압축하고,
패키지를 다시 설치합니다. id가 같으므로 Baram은 설치된 사본을 바꾸기 전에 묻습니다. 테마의 색에서
글자가 AA 대비 최소치에 못 미치면 설치 토스트가 그런 텍스트 조합의 개수를 알려 줍니다 — 거부가 아니라
안내입니다.

## 테마 나누기

`.zip` 파일을 건네면 받는 사람이 **테마 가져오기...**로 설치합니다. **테마 찾아보기**는 Baram이 게시한
테마만 싣고, 플러그인을 싣는 커뮤니티 목록은 테마를 받지 않습니다.
