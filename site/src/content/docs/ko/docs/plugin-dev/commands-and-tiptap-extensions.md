---
title: "명령 팔레트와 Tiptap 확장"
sourceHash: "bc8845772b01"
---

## 명령 팔레트 연동

`context.commands.register(id, handler, opts)`에 `opts.title`이나
`opts.paletteVisible: true`를 넘기면 그 명령이 앱의 명령 팔레트에 나타나고,
`${pluginId}.${id}`로 이름 공간이 붙습니다(그래서 두 플러그인이 글자 그대로 `id`라는 명령을
각각 등록해도 충돌하지 않습니다). 팔레트 항목은 `opts.title`이 있으면 그것을, 없으면 맨 `id`를
보여 줍니다. 돌려받은 `Disposable`을 정리하면(또는 플러그인을 내리면) 명령 등록과 함께 팔레트
항목도 사라집니다.

```typescript
context.commands.register("summarize", () => summarize(), {
  title: "AI Summary: Summarize current document",
  paletteVisible: true,
});
```

## Tiptap 확장 플러그인

플러그인이 사용자 Tiptap(ProseMirror) 확장을 제공할 수 있습니다. 매니페스트에 선언하십시오.

```json
{
  "tiptapExtensions": [
    {
      "type": "node",
      "name": "customBlock",
      "exportName": "CustomBlock"
    }
  ]
}
```

그다음 진입점에서 그 Tiptap 확장을 내보냅니다.

```javascript
import { Node } from "@tiptap/core";

export const CustomBlock = Node.create({
  name: "customBlock",
  group: "block",
  content: "inline*",
  parseHTML() {
    return [{ tag: 'div[data-type="custom-block"]' }];
  },
  renderHTML({ HTMLAttributes }) {
    return ["div", { ...HTMLAttributes, "data-type": "custom-block" }, 0];
  },
});

export function activate(context) {
  // 그 밖의 플러그인 로직
}
```

**중요:** ProseMirror 스키마는 앱이 시작할 때 딱 한 번 만들어집니다. 그래서
`tiptapExtensions`가 있는 플러그인은 **앱을 완전히 재시작**해야 적용됩니다 — 개발자 구역에서
플러그인을 다시 불러오면(아래 참조) `activate`/`deactivate`는 다시 돌지만 스키마는 **다시 만들지
않으므로**, 스키마에 기여하는 변경은 앱을 재시작할 때까지 나타나지 않습니다.
