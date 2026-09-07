---
title: "컨텍스트: UI 와 Shadow DOM 격리"
sourceHash: "ec9a05c92763"
---

## `context.ui`

```typescript
showNotification(message: string, type?: "error" | "info" | "warning"): void;

showStatusBarItem(text: string, align?: "left" | "right"): StatusBarItem;
// StatusBarItem = { setText(text: string): void; dispose(): void }

addStyle(css: string): Disposable;

addSidebarPanel(opts: PluginSidebarPanelOptions): Disposable;
addSettingsTab(opts: PluginSettingsTabOptions): Disposable;
// PluginSidebarPanelOptions = { id: string; title: string; icon?: string;
//   onMount(el: HTMLElement): void; onUnmount?(el: HTMLElement): void }
// PluginSettingsTabOptions  = { id: string; title: string;
//   onMount(el: HTMLElement): void; onUnmount?(el: HTMLElement): void }

registerFileViewer(opts: PluginFileViewerOptions): Disposable;
// PluginFileViewerOptions = { id: string; extensions: string[];
//   onMount(el: HTMLElement, ctx: PluginFileViewerContext): void;
//   onUpdate?(el: HTMLElement, ctx: PluginFileViewerContext): void;
//   onUnmount?(el: HTMLElement): void }
// PluginFileViewerContext = { assetUrl: string; filePath: string;
//   refreshKey: number; zoomLevel: number }
```

`context.ui` 자체는 매니페스트가 `sidebar`·`statusbar`·`settings`·`viewer` 중 하나라도 선언하면
쓸 수 있지만(하나만 있어도 객체가 열립니다), 메서드마다 자기 관문이 있습니다.

| 메서드               | 필요한 권한                                            |
| -------------------- | ------------------------------------------------------ |
| `showStatusBarItem`  | `statusbar`                                            |
| `addSidebarPanel`    | `sidebar`                                              |
| `addSettingsTab`     | `settings`                                             |
| `registerFileViewer` | `viewer`                                               |
| `showNotification`   | `sidebar` / `statusbar` / `settings` / `viewer` 중 하나 |
| `addStyle`           | `sidebar` / `statusbar` / `settings` / `viewer` 중 하나 |

참고:

- `showStatusBarItem`은 `StatusBarItem` 객체를 돌려줍니다 — `.setText(...)`로 텍스트를 그 자리에서
  갱신하고 `.dispose()`로 제거합니다. 두 번째 매개변수는 `align: "left" | "right"`이고 기본값은
  `"right"`입니다.
- `addStyle(css)`는 `document.head`(light DOM)에 `<style>` 태그를 넣습니다. Shadow DOM
  사이드바 패널이나 설정 탭 **안의** 내용에는 스타일을 걸 수 **없습니다** —
  [Shadow DOM UI 격리](#shadow-dom-ui-격리)를 보십시오.
- `addSidebarPanel` / `addSettingsTab`은 둘 다 `onMount(el)`을 통해 격리된 Shadow DOM 하위
  트리에 붙습니다 — 다음 절을 보십시오.
- `registerFileViewer`는 나열한 확장자의 파일을 코드 에디터가 아니라 여러분의 뷰어로 열게 합니다.
  호스트가 `onMount`에 평범한(light DOM) 요소와 컨텍스트를 넘깁니다 — `assetUrl`은 `asset:`
  프로토콜로 서빙되는 그 파일이고(`refreshKey`로 이미 캐시가 무효화돼 있습니다), `zoomLevel`은
  공유되는 에디터 배율입니다(Cmd+= / Cmd+- / Cmd+0, Ctrl+휠) — 그것에 맞춰 내용을 확대·축소하는
  것은 뷰어의 몫입니다. `onUpdate`는 붙어 있는 동안 컨텍스트가 바뀌면 발생합니다(배율, 저장,
  외부 재적재). **텍스트** 확장자에서는 앱이 미리보기 ↔ 소스 전환을 유지합니다 — 여러분의 뷰어가
  미리보기 쪽을, CodeMirror가 소스 쪽을 렌더합니다. **바이너리** 확장자는 뷰어 전용이고, 앱의
  바이너리 가드(UTF-8 읽기 금지, 텍스트 저장 금지)는 그 플러그인이 켜져 있든 아니든 적용됩니다.
  내장 `media-viewer` 플러그인(`src/plugins/builtin/media-viewer.ts`)이 참조 구현입니다.

## Shadow DOM UI 격리

`addSidebarPanel`과 `addSettingsTab`은 여러분의 마크업을 앱의 DOM 트리에 바로 렌더하지 않습니다.
대신 호스트가 마운트 지점에 **open Shadow DOM**을 붙이고, 그 shadow root **안에** 사는 `<div>`로
`onMount(el)`을 호출합니다. 그래서 패널의 CSS가 앱의 나머지와 서로 격리됩니다 — 앱의 전역
스타일시트가 새어 들어오지 않고, 패널이 넣은 CSS도 새어 나가지 않습니다.

실무에서 따라오는 것들:

- **shadow 안의 내용에는 `onMount` 안에서 `el`에 `<style>` 요소를 붙여 스타일을 거십시오** —
  `context.ui.addStyle()`은 `document.head`(light DOM)를 대상으로 하므로 shadow 내용에 절대
  닿지 않습니다. 두 예제 플러그인이 모두 이렇게 합니다.

  ```typescript
  function appendStyle(el: HTMLElement, css: string): void {
    const style = document.createElement("style");
    style.textContent = css;
    el.appendChild(style);
  }

  onMount(el) {
    appendStyle(el, PANEL_STYLE);
    // ...el 아래에 패널 DOM 을 만든다
  }
  ```

- **CSS 커스텀 속성은 shadow 경계를 넘어 상속됩니다.** 앱의 디자인 토큰
  변수(`var(--color-text-default)`, `var(--color-border-default)`, `var(--color-bg-subtle)` 등)가
  여러분의 shadow root 안에서도 보이므로, 토큰 값을 복제하지 않고 살아 있는 앱 테마에 맞춰 패널을
  꾸밀 수 있습니다. 상속된 커스텀 속성만으로 전부 꾸미는 완전한 예는
  `examples/plugins/ai-summary/src/index.ts`를 보십시오.
- `onMount(el)`은 `ShadowRoot` 객체 자체가 아니라 shadow root의 내부 내용 `<div>`를 받습니다
  (`ShadowRoot`에는 `.style`/`.classList`가 없습니다). `onUnmount(el)`이 있으면 호스트가 하위
  트리를 제거하기 전에 호출됩니다 — 추적되는 `Disposable`이 아닌 정리(타이머, `el`의 자손에 직접
  붙인 수동 이벤트 리스너 등)에 쓰십시오.
