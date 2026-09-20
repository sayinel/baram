---
title: "컨텍스트: AI·네트워크·저장소·설정"
sourceHash: "054463461ae4"
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

### 값이 바뀐 것을 전해 듣기

```javascript
context.events.on("settings:changed", () => {
  rebuild(context.settings.getAll()); // 이벤트는 값을 싣지 않는다
});
```

이 이벤트 하나만은 두 티어 모두 `events`가 아니라 **`settings`**로 게이트됩니다 — 페이로드가
없고, `events`를 요구하면 설치 대화상자가 "사용자가 파일에 하는 일을 지켜본다"고 주장하게 되기
때문입니다. 디바운스되므로, 문자열 필드를 입력하는 동안에는 키마다가 아니라 값이 멎은 뒤에 한 번
알려 줍니다.

‼️ `tiptapExtensions` 팩토리가 받는 `settings`는 플러그인이 로드될 때 찍은 **스냅샷**입니다.
팩토리는 다시 실행되지 않으므로, 현재 값이 필요하면 그때 `context.settings.getAll()`을
읽으십시오.

### 필드가 선언할 수 있는 것

```typescript
interface PluginSettingField {
  key: string;
  label: string;
  type: "boolean" | "color" | "enum" | "number" | "string";
  default?: boolean | number | string;
  description?: string;   // 라벨 아래 한 줄
  min?: number;           // number 전용, 경계 포함
  max?: number;           // number 전용, 경계 포함
  options?: { value: string; label: string }[]; // enum 전용, 필수
}
```

`color`는 텍스트 입력 옆에 앱의 테마 스와치를 함께 렌더하고, 값은 CSS에 쓸 수 있는 것이면
됩니다 — hex, `rgb(…)`, 색 이름, 또는 사용자의 테마를 따라가는 `var(--token)`. `enum`은
`options`에 대한 select로 렌더됩니다.

`min`/`max` 밖이거나 `options`에 없는 값은 타입 불일치와 같은 방식으로 되돌아갑니다 — 선언한
`default`로, 다음에는 타입의 영값(enum은 첫 option)으로. 자기 필드가 거부할 `default`는
설치 시점 오류입니다.

‼️ 그렇다고 값을 직접 확인할 필요가 사라지지는 않습니다. 제약은 **사용자가 실행 중인 Baram이**
*현재* 매니페스트를 기준으로 해석하는 것이고, 그 제약보다 오래된 Baram은 필드를 제약 없이
해석합니다.

## `context.subscriptions`

`Disposable[]` — `commands.register`, `events.on`, `ui.showStatusBarItem`, `ui.addStyle`,
`ui.addSidebarPanel`, `ui.addSettingsTab`가 돌려주는 모든 `Disposable`이 여기 자동으로 쌓이고,
플러그인이 내려갈 때(다시 불러오기, 제거, 앱 종료) 정리됩니다. 직접 추적할 필요가 없습니다.
