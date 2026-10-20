---
title: "사이드바 패널"
sourceHash: "0459c55d8482"
---

## `context.ui.setPanel` (`sidebar` 필요, sandboxed)

sandboxed 플러그인은 사이드바에 자기 패널을 세 개까지 둘 수 있습니다. 패널마다 활동 표시줄에 버튼이 하나 생기고, 패널은
Baram이 그리는 머리 — 패널 제목과 `플러그인 · ` 뒤의 플러그인 이름 — 아래에서 사이드바를 채웁니다. 패널의 내용은
문자열로 보냅니다. [코드 블록 렌더러](/ko/docs/plugin-dev/code-blocks/)가 돌려주는 것과 같은 HTML과 CSS이고, Baram이
그것을 걸러 패널만의 shadow root에 그립니다.

trusted 플러그인은 대신 `ctx.ui.addSidebarPanel`로 패널에 자기 DOM을 붙입니다 —
[컨텍스트: UI 와 Shadow DOM 격리](/ko/docs/plugin-dev/context-ui-and-shadow-dom/)를 보십시오.

```typescript
setPanel(id: string, content: RenderedContent): void;
onPanelAction(id: string, handler: (action: string) => Promise<void> | void): Disposable;

// RenderedContent = { html: string; css?: string }
```

## 패널 선언

모든 패널을 매니페스트에 `sidebar` 권한과 함께 선언합니다.

```json
{
  "trust": "sandboxed",
  "capabilities": ["sidebar", "files:readonly"],
  "contributions": {
    "panels": [{ "id": "recent", "title": "Recent notes", "icon": "🕘" }]
  }
}
```

- 패널은 최대 3개입니다. `id`는 영문자, 숫자, `_`, `-`로 64자까지이고 한 번씩만 씁니다. `title`은 비어 있지 않은
  글입니다. `icon`을 주면 한 글자 — 이모지나 문자 하나 — 이고 UTF-16으로 16 단위까지입니다. 아이콘이 없거나, 아무것도 그리지
  않는 것(공백, 줄바꿈, 폭 없는 결합자, 변이 선택자 하나, 한글 채움 문자)이면 버튼에 일반 플러그인 아이콘이 나옵니다.
- `sidebar` 권한이 없는 `panels`는 매니페스트 오류이고, trusted 매니페스트의 `panels`도 오류입니다.
- 버튼은 플러그인 코드가 돌기 전에 나오므로 플러그인이 시작하는 동안에도 보입니다. 버튼의 이름은 패널 제목 뒤에
  `플러그인 · `과 플러그인 이름을 붙인 것이라, 패널이 Baram의 패널인 척할 수 없습니다.
- 사용자가 `sidebar` 권한을 주지 않고 플러그인을 설치할 수도 있습니다. 플러그인은 그대로 로드되지만 Baram이 `setPanel`을
  하나하나 거부합니다 — throw하지 않고, 거부는 플러그인 콘솔에 기록됩니다.

## 내용 보내기

```typescript
const escape = (text: string) =>
  text.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);

export function activate(ctx: SandboxContext) {
  const draw = async () => {
    const names = (await ctx.files.listDir("")).filter((n) => n.endsWith(".md"));
    ctx.ui.setPanel("recent", {
      html: `<ul>${names
        .map((n) => `<li><a data-note="${escape(n)}">${escape(n)}</a></li>`)
        .join("")}</ul>`,
      css: "ul { margin: 0; padding: 0 12px; }",
    });
  };
  void draw();
  ctx.events.on("vault:changed", () => void draw());
}
```

- `setPanel`은 선언하지 않은 id와 상한을 넘는 내용 — UTF-8로 HTML 1 MiB나 CSS 64 KiB를 넘거나, 고립 서로게이트(이모지의
  반쪽)가 든 것 — 에 곧바로 throw합니다. 문구는 렌더러의 결과가 받는 것과 같습니다.
- Baram은 패널마다 마지막 내용을 기억합니다. 화면에 없는 패널은 그리지 않고, 사용자가 패널을 열면 마지막으로 받은
  내용을 그립니다.
- `setPanel`은 얼마든지 자주 불러도 됩니다. 가장 최근 내용이 이기고, Baram은 화면에 있는 패널을 250밀리초에 한 번까지
  그립니다. 앞 호출이 아직 가는 동안 한 호출은 보낼 차례를 기다리는 내용을 바꾸므로, 마지막 내용은 늘 도착합니다.
- 첫 `setPanel` 전에는 패널에 아직 보일 것이 없다고 나옵니다.

## 돌려줄 수 있는 것

Baram은 패널의 내용을 코드 블록 렌더러의 결과처럼 거릅니다 — 무엇이 지워지거나 거부되는지와 상한은
[돌려줄 수 있는 것](/ko/docs/plugin-dev/code-blocks/#돌려줄-수-있는-것)을 보십시오. 다른 점은 둘입니다.

- 패널은 사이드바 안에서 세로로 스크롤되고 자기 높이 상한이 없습니다. 옆으로는 스크롤되지 않습니다 — 사이드바보다
  넓은 부분은 잘리므로, 넓은 내용은 `overflow-x: auto`를 준 자기 요소에 담으십시오.
- 거부된 CSS나 노드 상한을 넘은 내용은 패널 머리 아래에 `그리지 못했습니다 — `와 이유를 한 줄로 보이고, 마지막 그림은
  흐리게 남습니다.

## 클릭

클릭은 코드 블록에서처럼 판정됩니다 — [클릭](/ko/docs/plugin-dev/code-blocks/#클릭)을 보십시오. 다른 점은 이렇습니다.

- `data-note="notes/a.md"`는 **사용자가 누를 때** 활성인 볼트나 폴더의 루트 기준입니다 — 패널은 어느 노트에도 속하지
  않습니다. 활성인 볼트나 폴더가 없거나 그 경로가 거기 있는 노트가 아니면 아무것도 열지 않고 Baram이 그렇게 알립니다.
  패널이 한 볼트의 노트를 보인다면 사용자가 전환할 때 다시 그리십시오 — `vault:changed`가 컨텍스트를 싣고(`files`나
  `files:readonly`가 필요합니다) `file:open`도 싣습니다. `file:open`은 sandboxed 플러그인이 `events` 권한이 있을 때만
  받습니다.
- `data-action="name"`은 `onPanelAction(id, handler)`로 그 패널에 등록한 핸들러를 부르고, 핸들러마다 그 이름을
  받습니다. 모든 핸들러가 끝날 때까지 [`ctx.prompts`](/ko/docs/plugin-dev/context-prompts/)를 열 수 있습니다 — 명령이
  도는 30초와 같고, 클릭부터, 그리고 선택창이나 입력창이 닫힐 때마다 다시 흐릅니다. `onPanelAction`은 선언하지 않은
  id에 throw합니다.
- 오른쪽 클릭은 이 가운데 아무것도 하지 않습니다.

패널을 보이거나 그리는 것만으로는 아무 권리도 생기지 않습니다. 플러그인이 선택창을 열 수 있는 것은 `data-action` 요소를
누를 때뿐입니다.

Baram 저장소에는 패널을 쓰는 예제 플러그인이 없습니다. `examples/plugins/backlinks-block`이 같은 종류의 내용을 코드
블록에 그립니다.

## 버전 하한

`ctx.ui.setPanel`, `ctx.ui.onPanelAction`, `contributions.panels`는 새 API입니다. `engines.baram`을 릴리스 노트에 이것이
처음 실린 버전으로 적으십시오 — [버전 하한](/ko/docs/plugin-dev/manifest/#버전-하한)을 보십시오.
