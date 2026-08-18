# 플러그인 개발 환경 정비 — 설계 문서

- **작성일**: 2026-07-13
- **상태**: 승인됨 (brainstorming 완료, 구현 계획 대기)
- **설계 문서 참조**: §69 Plugin Marketplace, Part 3 §3.4 Extension, Part 6 §6.3 Provider
- **선행 조사**: Obsidian Plugin API / Logseq Plugin SDK 비교 (본 문서 §2)

---

## 1. 동기 (Motivation)

§69 Plugin Marketplace로 **런타임·배포 인프라는 완성**되어 있으나, "외부·1st-party 개발자가 실제로 플러그인을 만들어 로드하고 반복 개발하는 환경"은 사실상 비어 있다.

### 1.1 현재 갖춰진 것 (✅)

| 영역 | 파일 | 상태 |
|------|------|------|
| 동적 로더 (ESM `import()` via `convertFileSrc`, activate/deactivate 타임아웃 5s/1s, Tiptap 확장 수집) | `src/plugins/plugin-loader.ts` | 완료 |
| Capability 게이팅 (Proxy 기반 거부 `createDeniedProxy`) | `src/plugins/extension-context.ts` | 완료 |
| Rust 백엔드 (install/uninstall/list/read_manifest/fetch_registry/get_dir, ZIP 다운로드·추출·checksum) | `src-tauri/src/commands/plugin_cmd.rs` + `plugin` 모듈 | 완료 |
| 마켓플레이스 UI | `src/components/plugins/*` (4파일) | 완료 |
| Zustand store | `src/stores/system/plugin.ts` | 완료 |
| 개발 가이드 문서 | `docs/plugin-development.md` (256줄) | 완료 (단, 코드와 불일치) |

### 1.2 공백 (❌) — 본 정비의 대상

1. **예제/스타터 플러그인 없음.** `examples/`는 마크다운 데모 노트일 뿐. 문서가 참조하는 `baram-word-count` 실물이 없음.
2. **스캐폴딩 없음.** `/new-extension`·`/new-component`·`/new-ipc`는 앱 내부용. 독립 플러그인 생성 경로 없음.
3. **공개 타입 배포 없음.** `ExtensionContext`/`PluginManifest` 타입이 `src/plugins/types.ts` 내부에만 존재 → 외부 개발자가 `import type` 할 `.d.ts`가 없음.
4. **로컬 개발 워크플로 없음.** 설치는 URL/레지스트리 경유만. 언팩된 로컬 폴더 로드·재로드가 없어 반복 개발 불가.
5. **커뮤니티 레지스트리 실체 없음.** 기본 URL `baram-community/plugin-registry`만 박제, 실제 리포 미존재.

### 1.3 스텁/미배선 (⚠️)

`ExtensionContext`는 `commands`/`editor`/`events`/`files`만 실동작한다. `ui`는 `console` 출력 스텁(`extension-context.ts:242,251`), `sidebar`/`settings`/`ai`/`network`는 capability만 있고 API가 없다.

---

## 2. 선행 조사 — Obsidian vs Logseq

두 생태계를 조사하고 각각의 강점을 취사선택했다.

| 축 | Obsidian | Logseq | Baram 채택 |
|----|----------|--------|-----------|
| 로딩/격리 | 같은 컨텍스트, 샌드박스 없음(신뢰 기반) | iframe/Shadow-DOM 샌드박스 + postMessage RPC | **Obsidian식 유지** |
| UI 확장 | `registerView` + `ItemView.onOpen(contentEl)` 명령형 | `provideUI` 슬롯 주입 + `provideStyle` | Obsidian식 `onMount(el)` **+ Logseq식 CSS 격리** |
| 생명주기 | `registerX()` 자동 정리 (Component) | 네임스페이스 격리 | **Obsidian 자동 정리 채택** |
| 스타일 | `styles.css` 자동 로드 | `provideStyle` 동적 주입 | **둘 다** |
| 명령 | Command Palette 통합 | `App.registerCommand` | **팔레트 통합** |
| 저장 | vault 파일 직접 | 네임스페이스 `plugin_storage`(전용 dir) | **Logseq식 전용 storage dir** |
| 개발 루프 | `.hotreload`/`.git` 마커 + 디바운스 재로드 | unpacked 모드 + HMR | Dev폴더 + Reload 버튼 |

### 2.1 핵심 아키텍처 결정: 왜 Obsidian 모델인가

Baram 매니페스트는 이미 `tiptapExtensions`를 지원한다(`src/plugins/types.ts:121`, `plugin-loader.ts:22 getTiptapExtensions`). 이는 플러그인이 host의 ProseMirror 스키마에 Node/Mark를 기여한다는 뜻으로, **같은 JS 컨텍스트 로딩이 필수**다. Logseq식 iframe 샌드박스는 RPC 경계 너머로 PM 객체를 넘길 수 없어 이 기능을 원천적으로 불가능하게 만든다. 따라서 코어는 Obsidian식(같은 컨텍스트)을 유지하고, 샌드박스에 의존하지 않는 Logseq 강점만 흡수한다.

### 2.2 Logseq에서 흡수 (샌드박스 없이)

- **(A) Shadow-DOM 패널 격리** — 플러그인 UI를 shadow root에 마운트해 CSS 누수 차단. iframe RPC 없이 진짜 UI 격리.
- **(B) `provideStyle`** — 플러그인 CSS 동적 주입 + `styles.css` 자동 로드, `[data-plugin-id]` 스코프 & unload 자동 제거.
- **(C) 전용 storage 디렉토리** — 넓은 `files` 권한 없이 데이터 저장. 최소권한 강화.

### 2.3 Obsidian에서 흡수

- **(B) 자동 정리 `registerX` (Component 패턴)** — 모든 `context.*` 등록이 `subscriptions`에 자동 push, unload 시 자동 dispose. "reload 시 불안정 상태" 문제 예방.
- **(C) Command Palette 통합** — 플러그인 커맨드를 Baram Command Palette에 노출.
- 명령형 `onMount(el)` 패널 모델 (Obsidian `ItemView.onOpen(contentEl)` 검증).

### 2.4 채택하지 않음

- Logseq iframe 샌드박스 + postMessage RPC (tiptapExtensions·깊은 에디터 접근과 상충).
- Logseq datascript DB 쿼리 API (스코프 크리프; `context.vault` 쿼리는 향후 노트만).

**출처**: [Obsidian Views](https://docs.obsidian.md/Plugins/User+interface/Views), [Obsidian Plugin API](https://github.com/obsidianmd/obsidian-api), [Obsidian hot-reload](https://github.com/pjeby/hot-reload), [Logseq Plugin System](https://deepwiki.com/logseq/logseq), [@logseq/libs](https://logseq.github.io/plugins/)

---

## 3. 목표 / 범위 / 비목표

### 3.1 목표
외부·1st-party 개발자가 로컬에서 플러그인을 **만들어 → 로드 → 반복**하고, 문서화된 모든 capability를 실제로 사용할 수 있는 개발 환경.

### 3.2 범위
- 로컬 dev 루프 (폴더 등록 + Reload)
- 전 Context API 실배선 (ui / sidebar / settings / ai / network / storage)
- Obsidian/Logseq 강점 A(Shadow-DOM) / B(provideStyle + 자동정리) / C(팔레트 + storage) 반영
- 공개 `.d.ts` 타입 + 실물 예제 플러그인 2종
- 레지스트리 스키마 + 시드

### 3.3 비목표 (명시적으로 "나중")
- npm 패키지 발행
- 외부 `baram-community/plugin-registry` 리포 실제 생성
- iframe/worker 하드 샌드박스
- 파일워처 자동 핫리로드
- 모바일
- `context.vault` DB/그래프 쿼리 API

---

## 4. ExtensionContext API 계약

기존 `commands`/`editor`/`events`/`files`는 유지. 아래를 추가·실배선한다. 모든 신규 API는 capability 게이팅(`createDeniedProxy`)을 유지하고, 반환 `Disposable`은 자동으로 `subscriptions`에 push되어 unload 시 자동 dispose된다 (§2.3 자동 정리).

### 4.1 `ui` (statusbar/sidebar/settings 중 하나라도 있으면 생성; 메서드별 세부 게이팅)

```ts
// 알림 — useUIStore.showToast 재사용 (type/duration 지원 위해 시그니처 확장)
showNotification(message: string, type?: "info" | "warning" | "error"): void

// 상태바 — plugin-ui-store에 등록, StatusBar가 left/right 슬롯 렌더
showStatusBarItem(text: string, align?: "left" | "right"): StatusBarItem
// StatusBarItem: { setText(t): void; dispose(): void }

// 사이드바 패널 — 명령형 컨테이너 (el은 Shadow root; §5.3)
addSidebarPanel(opts: {
  id: string; title: string; icon?: string;
  onMount(el: HTMLElement): void;
  onUnmount?(el: HTMLElement): void;
}): Disposable

// 설정 탭 — Settings "Plugins" 그룹에 등록 (el은 Shadow root)
addSettingsTab(opts: {
  id: string; title: string;
  onMount(el: HTMLElement): void;
  onUnmount?(el: HTMLElement): void;
}): Disposable

// (B) 동적 CSS 주입 — [data-plugin-id] 스코프, unload 자동 제거
addStyle(css: string): Disposable
```

### 4.2 `ai` (requires `ai`) — 기존 `llmComplete` 재사용 (`src/ipc/llm.ts:12`)

```ts
complete(prompt: string, opts?: AICompleteOptions): Promise<string>       // 버퍼링 편의
stream(prompt: string, opts: AICompleteOptions, onToken: (t: string) => void): Promise<void>
listModels(): Promise<AIModel[]>
```
- `stream`은 CLAUDE.md 규칙대로 `createLLMStream()` 반환값을 `try/finally`로 cleanup.

### 4.3 `network` (requires `network`) — Rust 프록시 경유 (CORS 회피, 실동작 보장)

```ts
fetch(url: string, init?: PluginFetchInit): Promise<PluginFetchResponse>
// PluginFetchResponse: { status: number; headers: Record<string,string>; body: string }
```
- Rust `plugin_http_fetch(url, init)` (reqwest) 신규 커맨드.

### 4.4 `storage` (requires 신규 `storage` cap) — 전용 디렉토리

> **결정**: 최소권한 원칙에 따라 `files`와 분리된 **신규 `storage` capability**를 `PluginCapability` 유니온(`src/plugins/types.ts:58`)에 추가한다. 플러그인은 넓은 `files` 권한 없이 전용 데이터만 저장할 수 있다.

```ts
read(key: string): Promise<string | null>       // .baram/plugin-data/<pluginId>/<key>
write(key: string, value: string): Promise<void>
list(): Promise<string[]>
remove(key: string): Promise<void>
```
- 넓은 `files` 권한 없이 플러그인 전용 데이터 저장 (최소권한).

### 4.5 `commands` 확장 — Command Palette 통합 (§2.3 C)
기존 `commands.register(id, handler)`에 옵션 추가:
```ts
register(id: string, handler: Fn, opts?: { title?: string; paletteVisible?: boolean }): Disposable
```
- `paletteVisible: true`(또는 `title` 제공) 시 Baram Command Palette(`src/components/command/`)에 노출. id는 기존대로 `${pluginId}.${id}` 네임스페이스 유지(`extension-context.ts:55`).

---

## 5. Host 확장점

### 5.1 `src/plugins/plugin-ui-store.ts` (신규 Zustand)
플러그인이 등록한 상태바 아이템·사이드바 패널·설정 탭·팔레트 커맨드를 `pluginId`별로 보관. `Disposable`이 항목을 제거하고, 플러그인 unload 시 해당 pluginId 전체 정리.

```ts
interface PluginUIState {
  statusBarItems: PluginStatusBarItem[];   // { pluginId, id, text, align }
  sidebarPanels: PluginSidebarPanel[];      // { pluginId, id, title, icon, onMount, onUnmount }
  settingsTabs: PluginSettingsTab[];
  paletteCommands: PluginPaletteCommand[];
  styles: PluginStyle[];                    // { pluginId, id, css }
  activePluginPanelId: string | null;
  // register*/unregister*/unregisterPlugin(pluginId) 액션
}
```

### 5.2 상태바
`src/components/layout/StatusBar.tsx`에 `<PluginStatusBarItems align="left" />` / `align="right"` 슬롯 추가. plugin-ui-store 구독(`useShallow`).

### 5.3 사이드바 (Shadow-DOM, §2.2 A)
- 닫힌 `SidebarPanel` 유니온(`src/stores/ui/ui.ts:18`)을 플러그인마다 늘리지 않고 **단일 `"plugin"` 종류**만 추가. 활성 플러그인 패널은 `plugin-ui-store.activePluginPanelId`로 구분.
- Activity Bar에 등록된 플러그인 패널 아이콘 노출. 선택 시 host가 컨테이너 하나를 렌더하고 **shadow root를 생성**해 `onMount(shadowRoot)` 1회 호출. 패널 제거/unload 시 `onUnmount`.
- 가시성 토글은 CSS(언마운트 안 함) — 명령형 격리 단순화.

### 5.4 설정
`src/components/settings/SettingsModal.tsx` + `settings-registry.ts`에 "Plugins" 그룹 추가 → 등록된 탭들을 각자 shadow root 컨테이너에 `onMount`.

### 5.5 Command Palette
`src/components/command/`의 팔레트 소스에 plugin-ui-store의 `paletteCommands`를 병합. 선택 시 `executePluginCommand(fullId)` (`extension-context.ts:170`).

### 5.6 마운트 수명주기
컨테이너 최초 표시 시 `onMount(el)` 1회, 패널/탭 제거·플러그인 unload 시 `onUnmount(el)`. `el`은 항상 shadow root(패널/설정) 또는 스코프된 컨테이너.

---

## 6. 로컬 dev 루프 (Dev폴더 + Reload)

### 6.1 Rust
- `plugin_add_dev_folder(path)` — 매니페스트 검증 후 config `dev_plugins` 목록 등록(재시작 생존) + 런타임 `app.asset_protocol_scope().allow_directory(path, true)`로 임의 경로 `index.mjs`를 `convertFileSrc`가 로드 가능하게 함 **(핵심 제약 해결)**.
- `plugin_list_installed`가 설치본 + dev 병합, `is_dev: true` 플래그.
- `plugin_remove_dev_folder(path)`.
- `plugin_http_fetch(url, init)` — §4.3.

### 6.2 로더 (`plugin-loader.ts`)
- `reloadPlugin(id)` = `unloadPlugin(id)` → 캐시버스팅 URL로 `loadPlugin`. `import()`는 URL(쿼리 포함) 단위 캐시이므로 `assetUrl + "?v=" + (++counter)`로 강제 갱신.
- clean unload는 §2.3 자동 정리 subscriptions가 보장 → 안정적 재로드.

### 6.3 제약 (문서화)
`tiptapExtensions` 포함 플러그인은 재로드 시 PM 스키마 재빌드 불가 → "앱 재시작 필요" 토스트. Reload 완전 적용은 비-스키마 플러그인.

### 6.4 UI
`PluginMarketplace`에 "Developer" 섹션: 폴더 선택 로드(`@tauri-apps/plugin-dialog`) + dev별 Reload / 폴더 열기 / 제거. 파일워처는 비목표.

---

## 7. 타입 배포 + 스타터 템플릿 + 예제

### 7.1 타입 (단일 소스, 드리프트 방지)
- `src/plugins/public-api.ts` — 공개 타입 배럴 (`ExtensionContext`, `PluginManifest`, `PluginCapability`, 모든 `*API` 인터페이스, 이벤트명 유니온) re-export. 이것이 단일 소스.
- 빌드 스텝(`scripts/build-plugin-types.ts` 또는 `tsc --emitDeclarationOnly`)으로 `plugin-api.d.ts` 생성. 스타터 템플릿에 동봉.

### 7.2 예제 플러그인 2종 (리포 내, 실물·빌드·로드 가능)
- `examples/plugins/word-count/` (정본·최소): `editor:readonly` + `statusbar` + events + `styles.css`. dev-load·reload·타입 전 과정 검증. 파일: `baram-plugin.json`, `src/index.ts`, `package.json`(esbuild + external `@tiptap/core`,`@tiptap/pm`), `tsconfig.json`, `styles.css`, `README.md`, `dist/index.mjs`.
- `examples/plugins/ai-summary/` (고급): sidebar 패널(Shadow-DOM `onMount`) + settings 탭 + `ai` + `storage`. A/B/C + ai 전 표면 검증.

> **주의**: `examples/` 현재 내용(Dijkstra 등 데모 vault 노트)은 유지하고 `examples/plugins/` 하위에 추가한다.

### 7.3 문서
`docs/plugin-development.md`를 실제 API와 일치하도록 재작성: 신규 API(ui 패널/addStyle/ai/network/storage), Shadow-DOM 격리, dev 루프, 팔레트, 타입 사용법 + 템플릿 기반 Quick Start.

---

## 8. 레지스트리 스키마 + 시드
- `RegistryEntry`/`RegistryIndex`(`src/plugins/types.ts:98,116) 스키마 확정.
- 리포에 유효한 시드 `registry/index.json` 커밋(두 예제 엔트리, `download_url`은 TBD 표기).
- 기본 URL(`DEFAULT_REGISTRY_URL`, `plugin.ts:38`) 유지. 마켓플레이스의 로컬/파일 레지스트리 로드로 테스트(`registryUrl` 설정 기존 존재).
- 외부 `baram-community` 리포 생성은 비목표(문서화만).

---

## 9. 보안 태도 (정직하게)
- capability는 설치 시 승인(`PluginCapabilityBadge` 기존). `ai`/`network`는 **민감 등급**으로 승인 UI에서 구분 표기.
- **하드 샌드박스 없음** — capability는 의도 선언 + API 게이팅이지 부작용 완전 차단이 아니다. 단, §2.2 A의 Shadow-DOM으로 **UI CSS 레이어는 실제 격리**된다.
- checksum(SHA-256) 검증은 기존 유지. dev 폴더는 checksum 미적용(로컬 신뢰).

---

## 10. 테스트 전략
- **Vitest**:
  - `extension-context`: 무권한 시 `ai`/`network`/`storage` 거부 프록시; `ui` 등록 → plugin-ui-store 반영; `addStyle` 스코프 + unload 정리; Shadow-DOM 마운트; `ai.complete` 버퍼링(모킹된 llmComplete); unload 시 subscriptions 자동 정리.
  - `plugin-loader`: `reloadPlugin` 캐시버스팅 URL + clean unload.
  - `plugin-ui-store`: 등록/해제/pluginId 일괄 정리.
  - 매니페스트 검증: 신규 capability.
  - 팔레트 커맨드 노출.
- **Rust cargo test**: `plugin_add_dev_folder`(매니페스트 검증·asset scope), `plugin_http_fetch`, storage dir 경로.
- **CI 스모크**: `examples/plugins/word-count` `npm run build` 성공 — 템플릿 + 타입 회귀 방지.

---

## 11. 페이즈드 구현 로드맵 (단일 스펙, 순차 구현)

| Phase | 내용 | 주요 파일 |
|-------|------|----------|
| **A** 생명주기·dev루프 | 자동정리 subscriptions + Rust `plugin_add_dev_folder`·asset scope + 로더 `reloadPlugin` + Developer UI | `plugin-loader.ts`, `plugin_cmd.rs`, `plugin` 모듈, `PluginMarketplace.tsx`, `stores/system/plugin.ts` |
| **B** 실 UI | `ui.showNotification`(toast) + `showStatusBarItem`(슬롯) + `plugin-ui-store` + `provideStyle`/`addStyle` | `extension-context.ts`, `plugin-ui-store.ts`(신규), `StatusBar.tsx`, `stores/ui/ui.ts` |
| **C** 패널 | `addSidebarPanel` + `addSettingsTab` (Shadow-DOM) + Command Palette 통합 | `extension-context.ts`, `ui.ts`, `SettingsModal.tsx`, `settings-registry.ts`, `command/*` |
| **D** ai/network/storage | `ai.complete`/`stream` (llmComplete 재사용) + Rust `plugin_http_fetch` + 전용 storage dir + 민감 cap 승인 UX | `extension-context.ts`, `ipc/llm.ts`, `plugin_cmd.rs`, `PluginCapabilityBadge.tsx` |
| **E** 타입·템플릿·예제·문서 | `public-api.ts` + d.ts emit + word-count + ai-summary + `docs/plugin-development.md` 재작성 | `public-api.ts`(신규), `scripts/`, `examples/plugins/*`, `docs/` |
| **F** 레지스트리 | 스키마 확정 + 시드 `registry/index.json` + 로컬 레지스트리 테스트 | `types.ts`, `registry/index.json`(신규), `PluginMarketplace.tsx` |

Phase A가 반복 개발을 즉시 언블록하므로 최우선. B→C→D는 API 표면을 쌓아 올리고, E는 그 위에서 예제로 전 표면을 검증, F는 배포 경로를 마무리한다.

---

## 12. 열린 질문 / 향후 작업
- (해결됨) `storage` cap은 §4.4에서 **별도 신규 capability로 확정** (최소권한).
- `context.vault` 쿼리 API(백링크/태그/검색) — Logseq DB API에 대응하는 향후 확장.
- 외부 `baram-community/plugin-registry` 리포 생성 및 CI 자동 검증 — 커뮤니티 개방 시점.
- 파일워처 기반 자동 핫리로드 — dev UX 고도화 시점.
