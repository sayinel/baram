---
title: "진입점과 공개 타입"
sourceHash: "3bd9d53c6adc"
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
