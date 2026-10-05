---
title: "컨텍스트: 명령·에디터·파일·이벤트"
sourceHash: "49e88dc99db6"
---


`activate()`에 넘어오는 `context` 객체는 아래 API들을 노출하고, 각각 매니페스트에 선언한
권한으로 통제됩니다. 아래 시그니처는 `src/plugins/types.ts`에서 그대로 가져온 것입니다
([`examples/plugins/plugin-api.d.ts`](https://github.com/sayinel/baram/blob/main/examples/plugins/plugin-api.d.ts)로 배포됩니다).

## `context.commands` (`commands` 필요)

```typescript
interface CommandRegisterOptions {
  paletteVisible?: boolean;
  title?: string;
}

register(
  id: string,
  handler: (...args: unknown[]) => unknown,
  opts?: CommandRegisterOptions,
): Disposable;

execute(id: string, ...args: unknown[]): Promise<unknown>;
```

`opts.paletteVisible === true`이거나 `opts.title`이 있으면 그 명령이 명령 팔레트에 나타납니다 —
[명령 팔레트 연동](/ko/docs/plugin-dev/commands-and-tiptap-extensions/#명령-팔레트-연동) 참조.

## `context.editor` (`editor` 또는 `editor:readonly` 필요)

두 티어가 같은 마크다운 API를 쓰고, 모든 메서드가 async입니다. 읽기에는 `editor` 또는
`editor:readonly`가, 쓰기에는 `editor`가 필요합니다.

```typescript
interface EditorSelection {
  from: number;
  ref: string;
  text: string;
  to: number;
}

interface EditorInsertOptions {
  replace?: string;
}

getMarkdown(): Promise<string>;
getSelection(): Promise<EditorSelection>;
getText(): Promise<string>;                     // 산문 — 상태바가 세는 글
insertMarkdown(markdown: string, opts?: EditorInsertOptions): Promise<void>; // editor 전용
insertText(text: string, opts?: EditorInsertOptions): Promise<void>;         // editor 전용
setMarkdown(markdown: string): Promise<void>;   // editor 전용
```

`getText()`는 코드 블록과 frontmatter를 뺍니다. `insertText()`는 평문을 그대로 넣고, 그 안의
어떤 것도 파싱하지 않습니다.

### 선택과 `ref`

`getSelection()`은 ProseMirror 위치, 선택한 텍스트, 그리고 `ref`를 돌려줍니다. 텍스트는 마크다운
문법이 없는 평문입니다 — 서식, 링크 대상, 코드의 백틱이 빠지고, 에디터가 커서 둘레에 펼쳐 보이는
문법도 빠집니다. 위치와 `ref`는 그래도 범위 전체를 덮습니다. 선택의 마크다운을 돌려주는 메서드는
없고, `getMarkdown()`은 문서 전체의 마크다운을 돌려줍니다. 나중에 `ref`를 `replace`로 넘기면 정확히
그 범위를 바꿉니다. `insertMarkdown(markdown, { replace: ref })`는 넘긴 마크다운을 그대로 그 자리에
넣으므로, 범위 안의 서식은 넘기는 마크다운에 들어 있을 때만 다시 쓰기 뒤에 남습니다.

- 범위 밖에서 편집하면 범위가 함께 옮겨 갑니다. 범위 안의 글이 바뀌었거나 지워졌거나, 선택한
  노드가 바뀌었거나, 에디터에 다른 문서가 들어 있으면(소스 모드로 갔다 돌아온 것도 여기 듭니다)
  쓰기가 거부되므로 선택을 다시 읽으십시오.
- `ref`는 그것을 읽은 플러그인에서만 통합니다. 쓰기가 성공하면 그 `ref`는 소진되고, 거부되면
  그대로 남으므로 다시 시도할 수 있습니다. 다만 샌드박스 티어에서는 범위를 확인한 뒤에 거부된
  쓰기도 — 예를 들어 범위의 글이 바뀐 `ref` — 그 범위의 길이만큼 예산을 쓰고, 에디터가 그 자리에
  문법을 펼쳐 보이고 있었다면(사용자의 커서가 그곳의 굵은 단어 안에 있을 때처럼) 쓰기 비용 전부를
  씁니다. 플러그인마다
  소진되지 않은 최근 `ref` 16개를 보관하고, 17번째를 읽으면 가장 오래된 것이 버려집니다.
- `editor:readonly`만 있어도 `ref`는 받지만, 그 `ref`에 대해서는 아무것도 보관하지 않습니다.
  쓰기는 `ref`를 보기 전에 `not-permitted`로 거부됩니다.
- `replace`가 없으면 삽입은 호출한 순간의 선택으로 갑니다. `insertMarkdown()`은 파싱하는 동안 그
  선택을 같은 방식으로 따라가므로, 같은 `ref-*` 코드로 거부될 수 있습니다.

### `insertMarkdown()`이 넣는 자리

- **텍스트나 커서.** 코드 블록이나 frontmatter 안(두 끝이 같은 블록 안)이거나 인라인 코드
  안이면 마크다운을 글자 그대로 넣습니다. 그 밖에서는 문단 하나인 결과가 인라인으로 들어가
  서식과 링크를 유지합니다 — 글 블록 하나 안(문단, 제목, 표 셀)이면 어디서든, 또는 문단끼리 걸친
  범위에서. 다만 그 줄에 이미지도 있으면(`x ![a](y.png) z`) 블록으로 들어가 이미지를 사이에 두고
  갈리므로, 제목이나 표 셀은 그 결과를 거부합니다. 그 밖의 결과(문단 여럿, 제목, 목록, 표)는
  블록으로 들어가고, 문단에만 들어갑니다.
  범위를 잘라 내고 그 앞뒤 글 사이에 블록을 넣으며, 결과 양 끝의 문단은 맞닿은 글에 붙습니다.
  범위가 한 문단의 내용 전체이면(예: 빈 문단의 커서) 블록이 그 문단을 대신합니다.
  `insertMarkdown("")`은 빈 문단 하나로 파싱되므로 범위를 지웁니다.
- **선택한 노드.** 글 줄 안의 노드(예: 위키링크)는 텍스트로 칩니다. 이미지나 표처럼 선택한
  블록은 결과가 온전한 블록으로 대신합니다.
- **전체 선택.** 결과가 문서를 대신합니다.

다음은 `insertText()`와 `insertMarkdown()`이 모두 `cannot-insert-here`로 거부합니다.

- 표 셀 단위의 선택이나 갭 커서(글을 담을 수 없는 블록 옆의 커서) — 또는 그런 선택에서 읽은
  `ref`
- 에디터가 위키링크 대신 보여 주는 원문 안(가장자리는 제외)이나, 블록 이미지·동영상 대신 보여
  주는 원문 안(가장자리 포함)에 끝이 있는 범위

`insertMarkdown()`만 거부하는 것은 다음과 같습니다.

- 한 끝만 코드 블록이나 frontmatter 안에 있거나, 두 끝이 그런 블록 둘에 나뉘어 있는 범위
- 둘 다 문단은 아닌 두 글 블록에 걸친 범위에 넣는, 문단 하나짜리 결과
- 블록으로 들어가는 결과 — 범위의 한 끝이 문단 밖(빈 제목 포함)이거나 표 셀 안일 때
- 표 셀 안의 선택한 노드를 대신하는, 문단 하나가 아닌 결과(문단 하나는 그 자리에 들어갑니다)
- 문서 첫머리에서 시작하는 결과의 첫 블록이 아닌 자리의 frontmatter
- 이미지나 동영상이 글이나 다른 이미지·동영상과 함께 있는 줄 — 블록 여럿 가운데 마지막 블록일
  때, 첫 블록이나 하나뿐인 블록에서 글이 두 이미지·동영상을 떼어 놓을 때, 블록 여럿 가운데 첫
  블록의 줄이 이미지나 동영상으로 시작하지 않고 블록이 문단 하나를 통째로 대신할 때
- 들어갈 자리보다 위의 노드를 가르는 삽입

쓰기가 적용될 때 사용자의 선택이 대상 안에 있으면(양 끝 포함) — `replace`를 넘기지 않았고
사용자가 움직이지 않았다면 그렇습니다 — 커서가 들어간 내용의 끝으로 가고 에디터가 그 자리로
스크롤합니다. 아니면 사용자의 선택은 있던 자리에 그대로 있습니다. `insertText()`,
`insertMarkdown()`, `setMarkdown()` 어느 쓰기든 호출 하나가 실행 취소 한 단계이고, 그 앞뒤에서
사용자가 입력한 것과 섞이지 않습니다.

### 거부

거부는 `EditorRefusal`로 옵니다 — `code`(`EditorRefusalCode`)가 이유를 말하는 `Error`입니다.
문장이 아니라 `code`로 가르십시오.

| `code` | 이유 | 할 일 |
|---|---|---|
| `no-editor` | 에디터가 아예 없습니다 | 사용자에게 알립니다 |
| `surface-blocked` | 에디터가 마크다운 문서를 담고 있지 않습니다 — 열린 파일이 없거나, 탭이 마크다운이 아니거나, 소스 모드이거나, 아직 불러오는 중이거나 전환 중입니다 | 사용자에게 알립니다 |
| `not-permitted` | `editor:readonly`만으로 한 쓰기, 또는 샌드박스에서 에디터 권한이 아예 없음 | 매니페스트를 고칩니다 |
| `budget` | 샌드박스 전용: 플러그인의 문서 예산이 바닥났습니다 | 기다렸다가 다시 시도합니다 |
| `document-changed` | `setMarkdown()`: 마크다운을 파싱하는 동안 문서가 바뀌었습니다 | 다시 시도합니다 |
| `ref-unknown` | 이 플러그인이 읽은 `ref`가 아니거나, 소진됐거나, 버려졌습니다 — trusted에서는 형식이 틀린 것도 | 선택을 다시 읽습니다 |
| `ref-other-document` | 에디터에 다른 문서가 들어 있습니다 — 다른 탭이거나, 소스 모드로 갔다 돌아올 때처럼 파일을 다시 불러왔습니다. `insertMarkdown()`이 파싱하는 동안 탭이 바뀌었다면 사용자가 `ref`의 탭으로 돌아와 있어도 거부될 수 있습니다 | 선택을 다시 읽습니다 |
| `ref-range-changed` | 범위 안의 글이 바뀌었거나, 범위가 지워졌거나, 선택한 노드가 바뀌었습니다 | 다시 읽고, 결과가 그 글에 달려 있었다면 다시 만듭니다 |
| `cannot-insert-here` | 그 내용은 그 자리에 들어갈 수 없습니다(위 목록) | 내용이나 자리를 바꿉니다 |

`code`가 없는 오류는 다른 데서 온 것입니다. 그 가운데 몇 가지를 들면, trusted 티어에서 에디터
권한이 없는 플러그인은 `ctx.editor`의 메서드를 읽는 순간 동기적으로 던져지는 평범한 `Error`를
받습니다. 마크다운 파서의 예외는 그대로 전달됩니다. 샌드박스 티어는 프레임 검사가 거부한
요청(삽입은 문자열 `length`가 65,536을, `setMarkdown`은 2,097,152를 넘거나, `replace`의 형식이
틀린 경우), 네 개가 처리 중일 때 보낸 다섯 번째 에디터 요청, 시간이 초과된 요청, 전송 실패를
`code` 없이 거부합니다.

### 옛 trusted API에서 옮기기

trusted 티어에는 원래 자체 동기 에디터 API가 있었습니다. 그것을 쓰던 trusted 플러그인은 다음
자리에서 깨집니다.

| 예전(trusted, 동기) | 지금(두 티어, async) |
|---|---|
| `getContent()`는 Tiptap의 평문(`editor.getText()`)을 돌려줬습니다 | 없어졌습니다. 산문은 `await getText()`, 원본은 `await getMarkdown()`을 쓰십시오 |
| `setContent(content)` | 없어졌습니다 — 옛 호출은 문서를 비웠습니다. `await setMarkdown(markdown)`을 쓰십시오 |
| `insertText(text)`는 `text`를 HTML로 파싱했습니다(Tiptap의 `insertContent`) | 글자를 그대로 넣습니다. 서식이 있는 내용은 `insertMarkdown()`을 쓰십시오 |
| `getSelection()`은 객체를 돌려줬습니다 | Promise를 돌려줍니다 — `await` 없이 읽으면 `getSelection().text`는 `undefined`입니다 |
| `editor:readonly`에서의 쓰기, 막힌 표면, 에디터 없음은 평범한 `Error`를 동기로 던졌습니다 | 호출이 `code`(`not-permitted`·`surface-blocked`·`no-editor`)와 함께 reject되므로, 모든 호출을 `await`하십시오 |

## `context.files` (`files` 또는 `files:readonly` 필요)

```typescript
readFile(path: string): Promise<string>;
writeFile(path: string, content: string): Promise<void>;  // files 전용 — files:readonly 에서는 던진다
listDir(path: string): Promise<string[]>;                  // 전체 경로가 아니라 항목 이름을 준다
```

## `context.events` (`events` 필요)

```typescript
on(event: string, handler: (...args: unknown[]) => void): Disposable;
emit(event: string, ...args: unknown[]): void;
```

호스트가 지금 내보내는 이벤트는 `"editor:ready"`, `"file:open"`, `"file:save"`뿐입니다
(`PluginEventName` 유니언 타입). **키 입력마다 오는 이벤트나 실시간 문서 변경 이벤트는 아직
없습니다** — 편집에 반응해야 한다면 폴링하거나 `"editor:change"` 같은 이벤트를 기대하지 말고
(그런 것은 없습니다) `editor:ready`/`file:open`/`file:save`에서 다시 계산하십시오. 그 패턴은
word-count 예제를 보십시오.

`"file:open"`은 열린 파일의 내용이 실제로 에디터에 적재된 뒤에 발생합니다 — 탭이 열리는 순간이
아닙니다 — 그래서 마크다운 파일이라면 핸들러 안에서 `ctx.editor.getMarkdown()`이 맞는 문서를
읽습니다. 이미 열려 있던 탭으로 전환할 때도 발생합니다(처음 열 때만이 아닙니다). 마크다운이 아닌
파일에서도 소스 에디터가 적재된 뒤 이벤트가 발생하지만, 그때 `ctx.editor` 호출은
`code: "surface-blocked"`로 거부됩니다.
