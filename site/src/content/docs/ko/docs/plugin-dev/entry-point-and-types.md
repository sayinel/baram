---
title: "진입점과 공개 타입"
sourceHash: "4e731a241166"
---

## 진입점

진입점(매니페스트의 `main`)은 `activate`를 내보내고 선택적으로 `deactivate`를 내보내는
ESM 번들 하나여야 합니다.

```javascript
export function activate(context) {
  // 플러그인이 불려올 때 호출된다. `context` 는 권한으로 통제되는
  // ExtensionContext 다 — 전체 API 는 아래를 보라.
  context.commands.register("sayHello", () => {
    context.ui.showNotification("Hello from my plugin!");
  });

  context.events.on("file:save", (filePath) => {
    console.log("File saved:", filePath);
  });
}

export function deactivate() {
  // 플러그인이 내려갈 때 호출된다. context.subscriptions 로 등록한 것
  // (명령, 이벤트 리스너, 상태바 항목, 스타일, 패널, 탭)은 자동으로
  // 정리된다 — 이 훅은 Disposable 로 추적되지 않는 정리(예: 타이머)에만
  // 필요하다.
}
```

**`deactivate`는 trusted 티어 전용 훅입니다.** 샌드박스 플러그인은 되호출되지 않습니다 —
내려가면 그 웹뷰 렐름 전체가 파괴되므로 타이머·리스너·선언 항목이 함께 사라집니다. 거기에
`deactivate`를 내보내는 것은 생명주기 훅처럼 읽히는 죽은 코드입니다 — 참조 플러그인
`word-count`에는 일부러 없습니다.

## 샌드박스 플러그인의 타이머

샌드박스 플러그인은 숨은 웹뷰에서 돌고, 브라우저 엔진은 숨은 페이지를 붙잡아 둡니다. 타이머가 제때 울린다는
전제로 만들지 마십시오. 아래는 macOS 26의 개발 빌드에서 1분 안팎으로, 그리고 화면을 잠근 채 한 번은 7분 동안
돌려 잰 것입니다. 다른 macOS 버전과 Windows, Linux는 재지 않았습니다.

- **빠른 타이머는 초당 한 번쯤으로 느려집니다.** 잰 간격인 `setInterval(fn, 50)`은 처음 몇 번은 제 속도로, 그
  뒤로는 초당 한 번쯤 울렸습니다. 지난 시간은 횟수를 세지 말고 `Date.now()`로 재십시오. `Worker`로 피할 수도
  없습니다. 샌드박스가 `worker-src`를 막습니다.
- **페이지가 아예 멈출 수 있습니다.** 기본 설정에서는 Baram이 마지막으로 메시지를 보낸 뒤 몇 초 지나 페이지가
  멈췄고, 타이머도 오류 없이 함께 멈췄습니다. 플러그인의 `ctx.storage.write` 호출에 오는 답은 이 메시지로 치지
  않았습니다. 이것을 막는 설정을 Tauri는 macOS 14 이상에서만 제공하고, Baram은 거기서 그 설정을 씁니다.
  그보다 낮은 macOS와 Windows, Linux에서는 타이머가 멈출 수 있다고 보십시오.
- **일은 Baram이 알려 줄 때 시작하십시오.** 커맨드나 이벤트는 멈춘 페이지를 깨웠으므로, 주기적으로 확인하는
  타이머 대신 그것을 받아 시작하십시오. macOS의 기본 설정에서는 페이지가 몇 초 뒤 다시 멈췄으니, 페이지가 멈출 수
  있는 곳에서는 오래 걸리는 일이 한 번에 끝나지 않을 수 있습니다.

## 공개 타입 쓰기

Baram의 내부 소스가 아니라 생성된 공개 타입 선언에 맞춰 작성하십시오.

- [`examples/plugins/plugin-api.d.ts`](https://github.com/sayinel/baram/blob/main/examples/plugins/plugin-api.d.ts) —
  `npm run types:plugin`(`tsc -p tsconfig.plugin-api.json`)으로 `src/plugins/public-api.ts`에서
  생성됩니다. 모든 공개 인터페이스(`ExtensionContext`, `AIAPI`, `NetworkAPI`, `StorageAPI`,
  `UIAPI`, `CommandsAPI`, `EditorAPI`, `EventsAPI`, `FilesAPI`,
  `PluginManifest`/`PluginCapability`/`PluginEventName`, 그리고 옵션·모델 타입)를 타입 전용
  선언으로 다시 내보냅니다.
- [`examples/plugins/types.d.ts`](https://github.com/sayinel/baram/blob/main/examples/plugins/types.d.ts) —
  그 배럴이 의존하는 작은 형제 `.d.ts`입니다.

두 파일을 플러그인 소스 옆으로 복사하고(두 예제 플러그인의 `tsconfig.json`은 대신 상대
`include` 경로로 참조합니다 — 어느 쪽이든 됩니다) 거기서 타입을 import하십시오.

```typescript
// sandboxed (기본 티어)
import type { SandboxContext } from "./plugin-api";

// trusted
import type { ExtensionContext, StatusBarItem } from "./plugin-api";
```

이렇게 하면 **Baram 내부 소스 트리에 의존하지 않고** 에디터 자동완성과 타입 검사를 온전히
받습니다 — `word-count/src/index.ts`와 `ai-summary/src/index.ts`는 커밋된 `.d.ts` 파일만으로
타입 검사를 통과합니다(예제 디렉터리에서 `npm run typecheck`, 또는 `tsc --noEmit`).
