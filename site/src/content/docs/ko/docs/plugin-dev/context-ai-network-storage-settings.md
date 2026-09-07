---
title: "컨텍스트: AI·네트워크·저장소·설정"
sourceHash: "f902654d5326"
---

## `context.ai` (`ai` 필요)

```typescript
interface AICompleteOptions {
  maxTokens?: number;
  systemPrompt?: string;
}
interface AIModel { id: string; name: string; }

complete(prompt: string, opts?: AICompleteOptions): Promise<string>;
stream(prompt: string, opts: AICompleteOptions, onToken: (token: string) => void): Promise<void>;
listModels(): Promise<AIModel[]>;
```

`complete`·`stream`·`listModels`는 모두 **사용자가 직접 설정한 AI 프로바이더·모델·API
키**(설정 → AI에 정해진 것)를 씁니다 — 플러그인이 자기 키나 프로바이더를 넣을 수는 없습니다.
개인정보 보호 모드가 여기서 무엇을 막고 무엇을 막지 않는지는
[신뢰 모델과 보안](/ko/docs/plugin-dev/trust-model-and-errors/#신뢰-모델과-보안)을 보십시오.

## `context.network` (`network` 필요)

```typescript
interface PluginFetchInit {
  body?: string;
  headers?: Record<string, string>;
  method?: string;
}
interface PluginFetchResponse {
  body: string;
  headers: Record<string, string>;
  status: number;
}

fetch(url: string, init?: PluginFetchInit): Promise<PluginFetchResponse>;
```

이것은 Rust 쪽 `reqwest` 프록시이고(브라우저의 CORS 제약을 우회합니다) 브라우저 `fetch`가
**아닙니다**. `http`/`https` URL만 허용되고, 응답 본문은 항상 UTF-8 문자열입니다(바이너리 응답은
손실 있게 디코드되어 바이트로 쓸 수 없습니다). 중복된 응답 헤더는 `reqwest`가 마지막으로 순회한
값으로 접힙니다. 전체 유출·크기·타임아웃 정책은
[신뢰 모델과 보안](/ko/docs/plugin-dev/trust-model-and-errors/#신뢰-모델과-보안)을 보십시오.

## `context.storage` (`storage` 필요)

```typescript
read(key: string): Promise<string | null>;
write(key: string, value: string): Promise<void>;
list(): Promise<string[]>;
remove(key: string): Promise<void>;
```

단순한 문자열 키/값 저장소이고, 플러그인마다 디렉터리 하나입니다. 어디에 사는지와 무엇을
보장하는지(또는 보장하지 않는지)는
[신뢰 모델과 보안](/ko/docs/plugin-dev/trust-model-and-errors/#신뢰-모델과-보안)을 보십시오.

## `context.settings` (`settings` 필요)

```typescript
getAll(): Record<string, boolean | number | string>;
```

매니페스트의 `contributions.settings`에 선언한 필드에 대한 사용자의 답이고, **설정 →
플러그인** 아래 그 플러그인 페이지에 폼으로 렌더됩니다. 선언한 필드마다 항목 하나이고 항상 선언한
타입입니다. 현재 매니페스트가 선언하지 않은 키는 돌려주지 않습니다.

여기서는 동기이고 샌드박스 티어에서는 `Promise`를 돌려줍니다 — 그 밖에는 같은 함수이고 같은 방식으로
해석되므로, 같은 플러그인 소스가 양쪽에서 동작합니다. 어느 티어에도 setter는 없습니다 — 사용자가
고른 값은 플러그인이 옮길 것이 아닙니다. 자기 상태에는 `context.storage`를 쓰십시오.

```javascript
const { prefix = "»" } = context.settings.getAll();
```

## `context.subscriptions`

`Disposable[]` — `commands.register`, `events.on`, `ui.showStatusBarItem`, `ui.addStyle`,
`ui.addSidebarPanel`, `ui.addSettingsTab`가 돌려주는 모든 `Disposable`이 여기 자동으로 쌓이고,
플러그인이 내려갈 때(다시 불러오기, 제거, 앱 종료) 정리됩니다. 직접 추적할 필요가 없습니다.
