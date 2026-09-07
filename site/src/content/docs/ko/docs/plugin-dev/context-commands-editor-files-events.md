---
title: "컨텍스트: 명령·에디터·파일·이벤트"
sourceHash: "cfef32e457c8"
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

```typescript
getContent(): string;                       // 평문. Markdown/HTML 이 아니다
setContent(content: string): void;          // editor 전용 — editor:readonly 에서는 던진다
getSelection(): { from: number; to: number; text: string };
insertText(text: string): void;             // editor 전용 — editor:readonly 에서는 던진다
```

`getContent()`는 문서의 평문을 돌려줍니다(내부적으로 `editor.getText()`) — 마크다운 원본도,
HTML도 아닙니다.

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
아닙니다 — 그래서 마크다운 파일이라면 핸들러 안에서 `ctx.editor.getContent()`가 맞는 문서를
읽습니다. 이미 열려 있던 탭으로 전환할 때도 발생합니다(처음 열 때만이 아닙니다). 마크다운이 아닌
파일에서도 소스 에디터가 적재된 뒤 이벤트가 발생하지만, `ctx.editor`는 ProseMirror(마크다운)
에디터를 감싸므로 `getContent()`가 코드 파일 내용을 반영하지는 않습니다.
