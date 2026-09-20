---
title: "명령 팔레트와 Tiptap 확장"
sourceHash: "06a5ab6e25db"
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

플러그인이 살아 있는 에디터에 ProseMirror 플러그인을 기여할 수 있습니다. 매니페스트에
선언하고, `extensions` capability 를 요구하십시오.

```json
{
  "capabilities": ["extensions"],
  "tiptapExtensions": [
    {
      "type": "plugin",
      "name": "highlighter",
      "exportName": "Highlighter"
    }
  ]
}
```

`type`은 반드시 `"plugin"`이어야 합니다 — `"node"`와 `"mark"`는 `validateManifest`가
**거부**합니다. node 나 mark 는 ProseMirror *스키마*를 바꾸는데, 스키마는 그것을 쓰는 에디터를
만들 때 고정됩니다. 게다가 닿아야 할 에디터가 하나가 아닙니다 — 공유 에디터 말고도, 큰 문서를
열 때마다 자기 스키마를 가진 keep-alive 에디터가 따로 만들어지고, 그것은 플러그인이 로드된
한참 뒤에도 생깁니다. 지금은 플러그인이 스키마에 더할 수 있는 경로가 없습니다. 데코레이션·키보드
핸들러·입력 규칙·붙여넣기 규칙 — 에디터 플러그인이 원하는 것의 대부분은 ProseMirror `Plugin`
하나 안에 들어가므로, 실제로는 거의 제약이 되지 않습니다.

그다음 진입점에서 **팩토리**를 내보냅니다. 팩토리는 컨텍스트 객체를 받아 ProseMirror
`Plugin`을 정확히 하나 돌려줘야 합니다.

```javascript
// ProseMirror에서 아무것도 import하지 않습니다. 아래 "ctx.pm으로 만드십시오" 참조 —
// 자기 사본을 싣는 것은 번들이 무거워지는 문제가 아니라 크래시입니다.

let host; // `activate`가 받은 컨텍스트 — 설정값을 그때그때 읽으려고 들고 있습니다

// `ctx.key`는 앱이 발급합니다. 그대로 쓰십시오 — 다른 키로 만든 플러그인은 등록이
// 거부됩니다. 언로드가 정확히 이 키만 제거해야 하기 때문입니다.
export const Highlighter = (ctx) =>
  new ctx.pm.Plugin({
    key: ctx.key,
    // `ctx.settings`가 아닙니다 — 그것은 이 팩토리가 만들어질 때의 스냅숏입니다.
    props: {
      decorations: (state) =>
        buildDecorations(state, ctx.pm, host.settings.getAll()),
    },
  });

export function activate(context) {
  host = context;
}
```

**키는 앱이 발급합니다 — 직접 고르는 게 아닙니다.** `ctx.key`가 아닌 다른 키로 플러그인을
만들면 등록이 거부됩니다. 언로드는 정확히 이 플러그인의 키만 제거해야 하는데, 작성자가 직접
키를 고를 수 있다면 두 플러그인이(서로, 또는 앱 자신의 플러그인과) 충돌할 수 있기 때문입니다.
컨텍스트는 `ctx.pm`(바로 아래 참조)·`ctx.editor`(더 아래 참조)·`ctx.pluginId`·`ctx.settings`도
함께 담고 있습니다.

### `ctx.pm`으로 만드십시오 — 직접 import하지 마십시오

`ctx.pm`은 앱 자신의 `Decoration`·`DecorationSet`·`Plugin`·`PluginKey`를 담고 있고 얼려져
있습니다. ProseMirror에 관한 것은 전부 여기서 꺼내 쓰고, 에디터에 기여하는 플러그인에서는
`@tiptap/pm/*`을 import하지 마십시오.

플러그인은 자기 번들로 배포되므로 안에서 `@tiptap/pm/view`를 import하면 prosemirror-view의
**두 번째 사본**이 됩니다. 그 사본은 앱의 것과 상호운용되지 않고, 그 실패가 하필 **가장 먼저
시험해 보는 자리에서 조용하기** 때문에 정확히 적어 둡니다.

| 데코레이션 소스 | 자기 사본으로 만든 `DecorationSet` |
| --- | --- |
| 자기 것 하나뿐 | 등록·렌더·트랜잭션 전부 정상 — 멀쩡해 보입니다 |
| 자기 것 + 다른 것 | `Cannot read properties of undefined (reading 'localsInner')` |

에디터 자신의 확장들이 언제나 무언가를 그리고 있으므로 사용자가 만나는 것은 **두 번째 줄**입니다.
작은 재현 예제는 첫 번째 줄에 걸리기 쉽고, 그러면 import가 무해하다고 믿게 됩니다.

논거는 `ctx.key`와 같습니다 — 정체성이 하나여야 하고, 그것을 보장할 수 있는 쪽은 앱뿐입니다.

번들러를 쓴다면 `@tiptap/pm`을 의존성으로 둘 필요조차 없습니다 —
`examples/plugins/bullet-threading`은 ProseMirror가 한 글자도 없는 번들로 빌드되고,
테스트가 그것을 단언합니다.

**`ctx.settings`는 로드 시점의 스냅숏이지, 살아 있는 값이 아닙니다.** 플러그인이 로드될 때
반영돼 있던 설정값을 담고 있습니다. 설정 폼에서 값을 바꿔도 플러그인이 다시 로드되지는 않으므로
팩토리도 다시 실행되지 않습니다 — `ctx.settings`를 읽는 prop 은 플러그인이 시작할 때의 값을
계속 내놓습니다. 현재 값이 필요하면 그 시점에 `context.settings.getAll()`을 부르십시오
(`activate`가 받은 그 `context`이며, `settings` capability 가 필요합니다). 스냅숏은 플러그인을
다시 불러올 때 갱신됩니다.

**설정이 바뀌어도 플러그인을 다시 부르는 것은 없습니다.** 설정 이벤트가 없고
(`PluginEventName`은 `editor:ready`·`file:open`·`file:save`뿐), `SettingsAPI`에는
`getAll()`밖에 없습니다. 그래서 상태 변경마다 도는 prop은 살아 있습니다 — 매번 현재 값을
읽을 수 있으니까요. 반면 `activate`에서 한 번만 하는 일, 예컨대 스타일시트 주입은 그렇지
않고, 다시 로드될 때까지 시작 시점의 값에 머뭅니다. 설정이 즉시 반영돼야 한다면 그것이
제어하는 것을 스타일시트가 아니라 데코레이션에 실으십시오.

기여한 플러그인은 `props.editable`도 선언할 수 없습니다 — 그 호출 역시 거부됩니다.
편집 가능 여부는 에디터의 코어 Editable 확장과 vim 의 몫입니다(§298 §12-⑪). 그것을 거부할 수
있는 제3의 주인이 생기면 그 계약이 깨집니다.

**재시작이 필요 없습니다.** Tiptap 플러그인은 여러분의 플러그인이 활성화되거나 언로드되는
순간 — 스키마를 다시 만드는 것이 아니라 평범한 `editor.registerPlugin` / `editor.unregisterPlugin`
API를 통해 — 에디터에 설치되거나 제거됩니다. 개발자 구역에서 플러그인을 다시 불러오면(아래
참조) 바뀐 기여분이 즉시 반영됩니다.

### 함정 두 가지

**에디터의 DOM을 직접 건드리지 마십시오.** ProseMirror의 `DOMObserver`는 `view.dom`의 서브트리
전체를 속성 변경까지 포함해 관찰하고, `contentDOM`을 가진 노드에서는 그것을 **무시하지 않습니다**
— 그 구간을 문서 변경처럼 다시 읽고 다시 그립니다. 플러그인이 에디터 밖에서 쓴 속성은 즉시
지워지고, 같은 구간의 위젯 데코레이션은 재생성되며(눈에 보이는 깜박임), `readDOMChange`가 그
"변경"을 실제 문서 트랜잭션으로 만들 수도 있습니다. 에디터에 무언가를 그려야 한다면 `"plugin"`
기여를 만들고 데코레이션을 쓰십시오 — 이 API가 그러라고 있는 것입니다.

**에디터는 하나가 아닙니다.** 마크다운 표면은 공유 에디터와 — 큰 문서라면 — keep-alive
에디터를 형제로 함께 마운트하고, 활성이 아닌 쪽에 `display: none`을 겁니다. 그래서
`document.querySelector(".tiptap")`이 사용자가 보고 있는 에디터가 아니라 숨은 쪽을 집을 수
있습니다. 기여한 플러그인의 팩토리는 자신이 설치된 표면의 `ctx.editor`를 그대로 받으므로, 이
문제를 겪지 않습니다.
