---
title: "코드 블록 렌더러"
sourceHash: "792a63c450c4"
---

## `context.codeBlocks` (`codeblocks` 필요)

자기 언어의 fenced 코드 블록 — ```` ```backlinks ````, ```` ```chart ```` — 을 직접 만든 HTML이나 SVG로
그립니다. 플러그인은 문자열을 돌려주고, Baram이 그것을 걸러 블록 안의 자기만의 shadow root에 그립니다.
마크다운은 바뀌지 않습니다. 플러그인을 끄거나 지우면 그 블록은 같은 글을 담은 평범한 코드 블록입니다.

두 티어가 같은 API를 씁니다. trusted 플러그인도 DOM이 아니라 문자열을 돌려줍니다. 타입은
`plugin-api.d.ts`에 있습니다([공개 타입 쓰기](/ko/docs/plugin-dev/entry-point-and-types/#공개-타입-쓰기) 참조).

```typescript
register(lang: string, render: CodeBlockRenderer): Disposable;
invalidate(lang?: string): void;
onAction(handler: (action: RenderedAction) => Promise<void> | void): Disposable;

// CodeBlockRenderer = (source: string, info: CodeBlockInfo)
//                       => Promise<RenderedContent> | RenderedContent
// CodeBlockInfo     = { lang: string; context: string | null; path: string | null }
// RenderedContent   = { html: string; css?: string }
// RenderedAction    = CodeBlockInfo & { action: string }
```

## 언어 선언

모든 언어를 매니페스트에 `codeblocks` 권한과 함께 선언합니다 — 둘 중 하나만 있으면 매니페스트 오류입니다.

```json
{
  "capabilities": ["codeblocks", "files:readonly"],
  "contributions": { "codeBlocks": [{ "lang": "backlinks" }] }
}
```

- 이름은 `^[a-z0-9][a-z0-9-]{0,31}$`에 맞아야 합니다 — ```` ```backlinks-v2 ````와 공백을 쳐서 만들 수 있는
  이름입니다. 플러그인마다 최대 10개이고, 같은 이름은 한 번만 씁니다.
- 거부되는 것: Baram이 직접 그리는 언어(`mermaid`, `query`, `svg`, `journal-…`)와 코드 블록이 구문 강조하는 모든
  언어 이름(별칭 포함 — `js`, `ts`, `python`, `py`, `md`, `yml` …). `js`를 가져가면 사용자 노트의 모든 JavaScript
  블록이 플러그인 출력으로 바뀌기 때문입니다.
- 동의 화면은 권한을 보입니다. 레지스트리 목록에는 언어가 없으므로 레지스트리 설치는 언어 없이 `codeblocks`를
  묻고, Baram은 내려받은 버전의 언어를 기록합니다. 개발 폴더의 동의 화면은 언어를 보입니다.
- 승인에 언어가 담긴 뒤에는, 언어를 더하는 업데이트가 내려받은 뒤 다시 묻고 — 언어를 보이며 새 언어에 표시를
  합니다 — 빌드가 언어를 더한 개발 폴더도 **다시 불러오기**에서 다시 묻습니다. `codeblocks`를 처음 더하는
  업데이트는 설치처럼 묻습니다 — 내려받기 전에, 언어 없이 권한을 묻습니다.
- 두 플러그인이 같은 언어를 선언하면 먼저 불러온 쪽이 그리고, 다른 쪽의 `register`는 언어와 그리는 플러그인
  이름을 담아 throw합니다.

`register`는 `activate`에서 부르십시오. 선언하지 않은 언어면 throw합니다. `dispose()`와 나중의 `register`가
하는 일은 티어마다 다릅니다.

- **trusted.** `register`는 `activate` 안이든 그 뒤든 바로 묶습니다. `dispose()`는 렌더러를 풉니다. 그 언어의
  블록은 평범한 코드 블록이 됩니다.
- **sandboxed.** Baram은 `activate`가 끝날 때까지 등록된 언어를 묶고, 플러그인이 내려갈 때까지 묶어 둡니다.
  그 뒤에 처음 등록한 언어는 그려지지 않습니다. `dispose()`는 렌더러가 답하지 않게 할 뿐입니다 — 그 뒤에
  그리는 블록은 오류를 보이고, Baram이 아직 기억하는 결과는 그대로 보입니다.

두 티어 모두, 묶인 언어를 다시 등록하면 렌더러가 바뀌고 기억해 둔 결과는 버려집니다.

## `info`가 알려 주는 것

| 필드      | sandboxed                                                                                                      | trusted                       |
| --------- | -------------------------------------------------------------------------------------------------------------- | ----------------------------- |
| `context` | 노트를 담은 등록된 컨텍스트의 id — 볼트, 폴더, 또는 단일 파일로 연 노트 자신 — 없으면 `null`                   | 같음                          |
| `path`    | 그 컨텍스트 루트 기준 상대 경로, 구분자는 `/`(컨텍스트가 노트 자신이면 `""`). 컨텍스트가 없거나 저장 전이면 `null` | 절대 경로. 저장 전이면 `null` |
| `lang`    | 블록의 언어                                                                                                    | 같음                          |

렌더러의 설정은 블록의 글 안에 적으십시오. Baram은 fence의 언어와 글을 지키지만 여는 줄의 나머지는 지키지
않습니다. ```` ```chart title="x" ````는 ```` ```chart ````로 저장됩니다.

## 돌려줄 수 있는 것

Baram은 두 티어 모두 모든 결과를 거릅니다.

- **요소.** 지워지는 것 가운데: 스크립트, `<style>`, `<link>`, `<meta>`, `<base>`, 프레임과 임베드(`iframe`,
  `object`, `embed`), 폼과 그 입력(`form`, `input`, `select`, `textarea`, `label` …), `<dialog>`, 미디어(`video`,
  `audio`, `picture`, `source`, `track`), `<area>`와 `<map>`, `<slot>`, `<template>`, SVG의 `use`, `animate`,
  `set`, `foreignObject`와 필터, 그리고 MathML. `<button>`은 `data-action`을 위해 남습니다.
- **속성.** 이벤트 핸들러, `style`, `popover`와 그 대상 속성, `command`와 `commandfor`, `srcset`과 `sizes`가
  지워집니다.
- **URL.** `<a>`의 `href`는 Baram 링크 정책이 허용하면 남습니다. 다른 요소의 `src`, `href`, `xlink:href`,
  `poster`, `background`는 `data:image/…`나 `#조각`일 때만 남습니다 — 원격 이미지는 지워집니다. 불러오는 순간
  노트를 열었다는 사실이 서버에 알려지기 때문입니다. `network`로 받아 `data:`로 실으십시오.
- **속성 안의 CSS.** CSS 방식으로 자원을 가리키는 값 — `url(…)`이나 URL을 받는 함수 — 은 지워지고, `(`가 든
  값에서 CSS가 깨진 것으로 읽는 `url(`이나 문자열이 있어도 지워집니다. 예외는 값 전체가 따옴표 없는 `url(#id)`
  하나인 SVG 페인트 서버입니다. `fill="url(#grad)"`는 남고 `fill="url('#grad')"`는 지워집니다.
- **크기.** HTML은 UTF-8로 최대 1 MiB, 거른 뒤 요소와 텍스트 노드 30,000개입니다. HTML이나 CSS에 짝 없는
  서로게이트(이모지의 반쪽)가 있으면 그 결과는 실패합니다.

CSS는 블록의 shadow root에 들어가 거기에만 적용됩니다. 거부되는 것: 모든 `url()`(`data:`와 상대 경로 포함)과
URL을 받는 함수(`image-set()` …), `@media`, `@supports`, `@keyframes`, `@container` 밖의 at-rule, `:host`,
`:host-context()`, `::slotted()`, `::part()`, Baram이 파싱하지 못하는 CSS(선택자 포함), 그리고 글 `</` —
문자열 안에서도, 이스케이프해도 — 입니다. 내보내기가 CSS를 `<style>` 요소에 쓰는데 그것이 그 요소를 닫기
때문입니다. 주석 안의 `</`도 거부될 수 있습니다 — 대부분의 주석은 먼저 지워지지만 최상위의 `/*! … */` 주석처럼
남는 것도 있습니다. `!important`는 지워집니다.
UTF-8로 최대 64 KiB입니다. 앱의 CSS 변수는 블록 안까지 닿으므로 `var(--color-text-primary)`는 테마를 따릅니다.

에디터에서 그림은 최대 600 px 높이이고 그보다 길면 스크롤됩니다. 옆으로는 스크롤되지 않습니다 — 블록보다 넓은
부분은 잘리므로, 넓은 내용은 `overflow-x: auto`를 준 자기 요소에 담으십시오. 예제 플러그인이 그렇게 합니다.

지워진 마크업은 오류가 아닙니다. 개발 빌드(`npm run tauri dev`)는 거르면서 지운 요소와 속성의 수를 웹 인스펙터
콘솔에 적습니다 — 적어도 그만큼 지웠다는 뜻입니다. 릴리스 빌드에는 웹 인스펙터가 없습니다. 거부된 CSS, 상한을
넘은 결과, 시간 초과, 렌더러가 던진 오류는 플러그인 이름을 보이는 블록 머리 아래에 `그리지 못했습니다 — `와 이유를
한 줄로 보입니다(거부된 CSS는 `rendered CSS was refused (resourceNotAllowed)`처럼 규칙을 밝히고, 직접 던진 메시지는
200자에서 잘립니다). 마지막 그림은 흐리게 남습니다.

## 클릭

출력 안의 클릭은 모두 Baram이 받아 판정합니다. 주 버튼 클릭은 이렇게 됩니다.

- `<a href>` — `http`, `https`, `mailto`, `tel` 절대 링크는 Baram 밖에서 엽니다. `#조각`, 상대 링크, 다른
  scheme은 아무것도 하지 않습니다.
- `data-note="notes/a.md"` — 그 노트를 엽니다. 블록의 컨텍스트 루트 기준 상대 경로이고, 그 루트 아래에 있는
  `.md`·`.markdown` 파일이어야 합니다. 그 밖의 값, 컨텍스트가 없는 블록, 단일 파일로 연 노트의 블록은
  아무것도 열지 않고 Baram이 그렇게 알립니다.
- `data-action="name"`(1–64자) — 그 이름과 블록의 `info`로 `onAction` 핸들러를 부릅니다. 모든 핸들러가 끝날
  때까지 [`ctx.prompts`](/ko/docs/plugin-dev/context-prompts/)를 열 수 있습니다 — 블록을 누르는 것은 플러그인의
  명령을 실행하는 것처럼 사용자가 그 플러그인에 묻는 일입니다. trusted 티어에서는 클릭부터 길어야 30초이고,
  sandboxed 티어에서는 그 30초가 명령의 것처럼 클릭부터, 그리고 선택창이나 입력창이 닫힐 때마다 다시 흐릅니다.
  렌더 함수에는 이 권리가 없습니다.

한 요소에서는 `data-note`가 `data-action`보다, 둘 다 `href`보다 먼저입니다. 가운데 클릭은 링크나 노트를 열지만
action은 부르지 않고, 오른쪽 클릭은 셋 다 하지 않습니다. 그 밖의 자리를 그냥 누르면 블록이 선택되고 편집할 수
있게 글이 보입니다. 출력 위로 끌면 블록 대신 그 글이 선택됩니다. 블록 머리의 **원문 보기**는 **렌더 보기**를
누를 때까지 글을 보입니다. 출력 안의 포커스된 요소 — `<button>`, `tabindex`가 있는 요소 — 에서 누른 키는 블록
안에 머물고 에디터는 그 키에 반응하지 않습니다.

## 다시 그리기

Baram은 블록이 화면에 가까워질 때 그리고, 탭이 숨은 동안에는 그리지 않으며, 최근 결과를 플러그인과 그 버전,
언어, 노트, 블록의 글로 묶어 기억합니다. 글이 바뀌면 — 입력이 멈춘 뒤, 또는 원문 편집을 닫을 때 — 다시 그리고,
`invalidate`를 부르면 다시 그립니다.

```typescript
ctx.events.on("vault:changed", () => ctx.codeBlocks.invalidate("backlinks"));
```

`invalidate(lang)`는 그 언어의 결과를 잊고 보이는 블록을 다시 그립니다. 화면 밖 블록은 보일 때 그립니다. 언어를
빼면 이 플러그인의 모든 언어입니다. 0.25초 안의 호출은 한 번의 다시 그리기가 됩니다. 선언하지 않은 언어면
throw하고, 다른 플러그인이 그리는 언어면 아무 일도 없습니다. `invalidate`를 부를 때, 또는 플러그인을 끄거나 다시
불러올 때 돌고 있던 렌더의 결과는 버려집니다.

한 플러그인의 렌더는 두 개까지 함께 돌고, 10초를 넘기면 실패합니다. trusted 렌더러는 앱의 스레드에서 돕니다 —
제어를 돌려주지 않는 렌더러는 시간 초과로도 멈출 수 없으니 비동기로 쓰십시오.

## 내보내기

HTML과 PDF 내보내기는 블록마다 그림을 자기 shadow root(선언형 shadow DOM)로 적으므로 그 CSS는 블록 안에
머뭅니다. 내보내기는 먼저, 그림이 지금 글의 것이 아닌 블록을 화면 밖이어도 모두 그리고 내보내기의 시간 한도
안에서 기다립니다. 한 번도 그려지지 않은 블록은 평범한 코드 블록으로 나가고, 마지막 렌더가 실패한 블록은
마지막으로 보인 그림으로 나갑니다. 블록 머리와 오류 줄은 빠집니다. 내보낸 HTML을 보려면 선언형 shadow DOM을
읽는 브라우저가 필요하고 — Chrome 111 이상은 읽습니다 — PDF는 Baram이 설치된 Chrome이나 Chromium으로
인쇄합니다. Pandoc과 Notion 내보내기는 fenced 코드를 그대로 둡니다.

Baram 저장소의 예제 플러그인 `examples/plugins/backlinks-block`은 ```` ```backlinks ````를 `ctx.index`와
`data-note` 링크로 노트의 백링크 목록으로 그립니다.

## 버전 하한

`context.codeBlocks`는 새 API입니다. `engines.baram`을 릴리스 노트에 이것이 처음 실린 버전으로 적으십시오 —
[버전 하한](/ko/docs/plugin-dev/manifest/#버전-하한)을 보십시오.
