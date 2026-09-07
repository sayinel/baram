---
title: "빠르게 시작하기"
sourceHash: "bdb10b462cca"
---


새 플러그인을 시작하는 가장 빠른 길은 [`examples/plugins/`](https://github.com/sayinel/baram/tree/main/examples/plugins)의
참조 예제 둘 중 하나를 복사하는 것입니다.

- [`examples/plugins/word-count/`](https://github.com/sayinel/baram/tree/main/examples/plugins/word-count) — **샌드박스
  참조이고, 복사할 것은 이쪽입니다.** `editor:readonly` + `events` + `statusbar` 플러그인이 쓴
  선언형 상태바 항목입니다. 메인 렐름에서 아무것도 필요로 하지 않는다는 점이 핵심입니다.
- [`examples/plugins/ai-summary/`](https://github.com/sayinel/baram/tree/main/examples/plugins/ai-summary) — **trusted**
  티어입니다: Shadow DOM 사이드바 패널 + 설정 탭, `ai` + `storage`. 임의의 DOM이 정말로 필요할
  때만 복사하십시오. **레지스트리에 올라가지 않습니다** — 아직 선언형 `sidebar` 기여가 없고,
  trusted 플러그인은 샌드박스로 만들 수 없기 때문입니다.

폴더 둘은 내부 **테스트 픽스처이고 템플릿이 아닙니다**. 둘 다 빌드 단계 없이 손으로 쓴 파일
하나이고, `plugin-release.yml`이 둘 다 배포를 거부합니다.

- `examples/plugins/sandbox-smoke/`는 수동 스모크 실행 중에 샌드박스 티어의 브로커 표면을 찔러 봅니다.
- `examples/plugins/malicious-fixture/`는 적입니다. 권한 둘을 갖고 나머지 전부를 요구하며, CI가
  모든 호출이 거부되는 것을 단정합니다. 이 티어가 **허용하지 않는 것**의 목록으로 읽어 두면 좋습니다.

## 샌드박스 티어의 API는 다릅니다

`"trust": "sandboxed"` 플러그인은 자기 격리된 웹뷰에서 돌고 더 좁은, 데이터만 다루는 컨텍스트를
받습니다. 쓸 때 중요한 차이가 둘입니다.

- **`files` 경로는 알려 주지 않는 볼트 루트 기준 상대 경로입니다.** 그래서
  `readFile("a.md")`처럼 쓰고, 볼트 루트 자체를 가리킬 때는 `listDir("")`입니다.
  절대 경로나 `..`은 거부됩니다. 파일 이벤트에서 받은
  `{ context }`를 넘기면 그 이벤트가 온 볼트를 계속 가리킵니다.
  ```js
  ctx.events.on("file:open", async ({ context, path }) => {
    const text = await ctx.files.readFile(path, { context });
  });
  ```
- **`editor`는 마크다운이고 비동기입니다.** `getMarkdown()` / `setMarkdown()`이 앱 자신의 왕복
  파이프라인을 거치므로, 읽은 것을 그대로 되쓸 수 있습니다. `getSelection()`은 ProseMirror
  위치와 그것이 덮는 텍스트를 주고, `insertText()`는 커서 위치에 입력합니다. 모든 쓰기가 실행 취소
  한 단계입니다. 읽기에는 `editor` 또는 `editor:readonly`가, 쓰기에는 `editor`가 필요합니다.

  ```js
  const before = await ctx.editor.getMarkdown();
  await ctx.editor.setMarkdown(`${before}\n\n---\n`);
  ```

  문서를 읽은 결과는 응답에 실려 오지 않습니다 — 호스트가 세워 두고 샌드박스가 가져갑니다 —
  그러나 그것은 보이지 않고, `getMarkdown()`은 그냥 프로미스입니다.

  설계할 때 염두에 둘 것이 둘 있습니다.
  - **`setMarkdown()`은 거절할 수 있고, 다시 시도해야 합니다.** 메인 스레드 밖에서 파싱하는데,
    그 사이에 문서가 바뀌면 — 탭 전환이나 사용자가 한 글자를 입력하는 것만으로도 — 변경을
    덮어쓰지 않고 "the document changed"로 거절합니다. 큰 문서에서 누군가 계속 타이핑하고 있으면
    반복해서 실패할 수 있습니다. 의도한 것입니다 — 대안은 사용자가 방금 쓴 것을 조용히 버리는
    것이기 때문입니다.
  - **삽입을 묶으십시오.** `insertText()`는 트랜잭션 하나이고 ProseMirror는 트랜잭션 단위로 실행
    취소를 묶으므로, AI 스트림을 토큰마다 삽입하면 사용자에게 `Cmd+Z` 천 번을 안기는 셈입니다 —
    게다가 트랜잭션마다 문서 전체를 다시 렌더하는 비용이 들어 큰 파일에서는 호스트가 그것을
    조절합니다. 버퍼에 모아 덩어리로 삽입하십시오.

  에디터 호출은 호출 횟수가 아니라 **드는 일**로 측정됩니다 — 낙서 노트를 읽는 것은 거의 무료이고,
  10,000줄 파일을 반복해서 읽는 것은 아닙니다. "document budget is exhausted"가 보이면,
  `ctx.events`에서 받아야 할 것을 폴링하고 있는 것입니다.

- **`settings`는 사용자의 답이고 읽기 전용입니다.** `contributions.settings`에 필드를 선언하면
  **설정 → 플러그인** 아래 그 플러그인 페이지에 렌더됩니다. `await ctx.settings.getAll()`로
  읽으면 선언한 필드마다 선언한 타입의 값 하나를 항상 돌려줍니다.

  ```js
  const { prefix } = await ctx.settings.getAll();
  ctx.events.on("settings:changed", async () => {
    const next = await ctx.settings.getAll(); // 이벤트는 값을 싣지 않는다
  });
  ```

  "사용자의 답"이라는 데서 따라오는 것들:
  - **setter가 없습니다.** 사용자가 고른 값이 그 아래에서 움직여선 안 됩니다. 자기 상태에는
    `ctx.storage`를 쓰십시오.
  - **`settings:changed`는 아무것도 싣지 않습니다** — 다시 읽으십시오. (값은 일부러 밀어 보내는
    프레임에서 빼 둡니다.)
  - **값은 여러분의 현재 매니페스트를 기준으로 해석됩니다.** 그래서 업데이트가 필드 타입을 바꾸거나
    키를 없애면, 플러그인은 옛 값이 아니라 새 기본값을 봅니다. 키 이름을 바꾸면 초기화됩니다 —
    매니페스트가 `number`라고 한 자리에 `string`을 절대 넘기지 않기 위한 대가입니다.
  - 필드는 최대 16개, 문자열 값은 512자까지입니다. 매니페스트가 `settings` 권한도 선언해야
    필드가 렌더됩니다.

- **`ui`는 DOM이 아니라 데이터입니다.** `ctx.ui.showNotification(message, type?)`(호스트가 자기
  배지에 플러그인 이름을 붙여 토스트를 표시하고, 앱에 토스트 자리가 하나뿐이므로 4초에 한 번으로
  제한합니다)과, 매니페스트의 `contributions.statusBar`에 선언한 항목에 쓰는
  `ctx.ui.setStatusBarText(id, text)`가 있습니다. `addStyle`도, 패널 `onMount(el)`도 없습니다 —
  그것들은 `"trust": "trusted"`가 필요합니다.

선언형 상태바 항목은 플러그인 코드가 돌기 **전에** 매니페스트에서 등록됩니다 — 그래서 샌드박스가
아직 부팅하는 동안에도 보입니다 — 그리고 `command`가 있는 항목은 클릭할 수 있습니다. 불러오기가
실패하면 다시 제거됩니다.

플러그인 활성화가 끝나면, 이미 열려 있는 파일이 있다면 호스트가 그 파일에 대한 합성 `file:open`을
보냅니다. 그래야 시작할 때 불려온 플러그인이 사용자가 탭을 바꿀 때까지 자기가 어디 있는지 모르는
일이 없습니다.

기여 id(`commands[].id`, `statusBar[].id`, `settings[].key`, 그리고 상태바 항목이 가리키는
`command`)는 `^[A-Za-z0-9_-]+$`에 맞아야 하고 자기 구역 안에서 유일해야 합니다. 상태바 항목은
최대 다섯 개, 설정 필드는 열여섯 개까지 선언할 수 있고, 설정의 `default`는 그 필드가 선언한 타입이어야
합니다. 호스트가 `<pluginId>.<command>`와 `<pluginId>:sb:<item>`으로 이름 공간을 붙이므로,
뒷부분에 `.`이나 `:`가 있으면 그 id가 모호해집니다.

플러그인 프로젝트는 이렇게 생겼습니다.

```
my-plugin/
  baram-plugin.json      # 매니페스트 (필수)
  src/index.ts           # 소스 (TypeScript 권장)
  dist/index.mjs         # 빌드된 ESM 번들 — "main" 이 가리키는 것
  plugin-api.d.ts         # examples/plugins/plugin-api.d.ts 에서 복사
  types.d.ts              # examples/plugins/types.d.ts 에서 복사
  package.json
  tsconfig.json
```

1. `examples/plugins/plugin-api.d.ts`와 `examples/plugins/types.d.ts`를 소스 옆으로
   복사합니다(또는 두 예제의 `tsconfig.json`처럼 상대 `include`/`path`로 직접 참조합니다).
2. 거기서 타입을 import합니다.

   ```typescript
   import type { ExtensionContext, StatusBarItem } from "./plugin-api";
   ```

3. `activate(context)`를 씁니다(그리고 선택적으로 `deactivate()`).
4. esbuild로 ESM 번들 하나를 빌드합니다.

   ```bash
   npx esbuild src/index.ts --bundle --format=esm --outfile=dist/index.mjs \
     --external:@tiptap/core --external:@tiptap/pm
   ```

5. 아무것도 패키징하지 않고 플러그인을 개발 모드로 불러옵니다 — **설정 → 플러그인 →
   개발자 → 개발 플러그인 폴더 불러오기**를 누르고 폴더 선택기로 플러그인 디렉터리를 가리킵니다.
   [로컬 개발 루프](/baram/ko/docs/plugin-dev/local-development-and-bundling/#로컬-개발-루프) 참조.
