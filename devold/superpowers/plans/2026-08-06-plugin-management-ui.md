# 플러그인 관리 UI 재설계 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 내장(Built-in)과 커뮤니티 플러그인을 Installed 탭 안의 섹션으로 구분해 관리하고, 두 갈래로 흩어진 플러그인 설정을 Settings 창 하나로 단일화한다.

**Architecture:** 내장 플러그인의 매니페스트는 계속 번들의 `BUILTIN_PLUGINS`가 유일한 출처로 삼고, 영속화하는 것은 `builtinDisabled: string[]` 하나다(enabled 맵이 아니라 disabled 목록이므로 새 내장은 마이그레이션 없이 기본 켜짐). 세 출처(내장·커뮤니티·개발 중)를 순수 함수 `buildPluginRows()`가 하나의 `PluginRow[]`로 파생하고, 행이 무엇을 할 수 있는지는 `actionsFor(source)` 한 곳에서만 결정한다. 설정은 pluginId를 키로 하는 단일 페이지가 선언 필드와 등록 탭을 함께 렌더한다.

**Tech Stack:** React 19 · TypeScript (strict, `verbatimModuleSyntax`) · Zustand (persist middleware) · Vitest + @testing-library/react (jsdom) · Tailwind CSS 4 + 디자인 토큰 CSS 변수

**설계 문서:** `dev/superpowers/specs/2026-08-06-plugin-management-ui-design.md` (§ 참조는 그 문서 기준)

## Global Constraints

- **§ 주석 유지**: 새 코드와 커밋 메시지에 `§69`(플러그인 마켓플레이스) 또는 `§260`(실행 모델) 참조를 유지한다. 커밋 형식: `feat(§69): ...`, `fix(§69): ...`, `test(§69): ...`, `refactor(§69): ...`
- **파일 크기**: 단일 TS/TSX 파일 ~300줄 이하 유지, ~500줄 초과 시 분리. CSS 단일 파일 ~1,500줄 이하

  ‼️ **명시적 예외 1건 (사용자 결정 2026-08-06)**: `src/components/plugins/usePluginActions.ts`는 **~550줄까지 허용**한다. 그 본문은 §260/#261 리뷰 6라운드가 쌓은 보안 로직이고 Task 7의 규칙은 *수정 없는 순수 이동*이다 — 이동과 동시에 쪼개면 그 규칙이 깨지고, 리뷰어가 "이동이 맞는가"를 판정할 수 없게 된다. 분리는 별도 후속 커밋의 몫이며 Task 12 Step 7이 백로그에 남긴다. 리뷰어에게 이 예외를 전달할 것
- **`import type` 필수**: `verbatimModuleSyntax`가 켜져 있어 타입 전용 import는 반드시 `import type`
- **Zustand 셀렉터**: 컴포넌트에서 `useStore()` bare call 금지. 반드시 `useShallow((s) => ({...}))`
- **knip이 pre-push에서 돈다**: 소비처가 없는 export는 push를 실패시킨다. 다음 태스크가 쓸 예정인 함수라도 **그 태스크에서 실제로 import될 때까지 export하지 않는다**. 태스크 내에서 쓰이지 않으면 `export` 없이 두고, 소비 태스크에서 export를 추가한다
- **테스트 실행**: `npm test` (= `vitest run`). `npx jest` 금지. 단일 파일은 `npx vitest run <path>`
- **게이트 exit code는 파이프 없이 캡처**: `cmd > /tmp/log 2>&1; echo $?`. `cmd | tail`은 tail의 exit를 반환한다
- **`validateManifest`의 반환 모양**: 성공 시 `{ valid: true }` — **`errors` 키가 없다**. `toEqual([])`로 단정하지 말고 `result.valid`를 볼 것 (실측 확인됨)
- **i18n은 플랫 dot-notation JSON**: `src/i18n/en.json`과 `src/i18n/ko.json` 양쪽에 같은 키를 추가한다. 두 파일의 키 집합이 어긋나면 안 된다
- **`git commit --no-verify` 금지**
- **`src/components/plugins/**/*.tsx`에서 템플릿 리터럴을 쓰지 말 것** (Task 6에서 실측). `plugin-ui-i18n.test.tsx`가 그 디렉터리의 모든 `.tsx`를 훑으며 **모든 문자열 리터럴을 prose로 의심**하고, "prose가 아님"을 증명하는 형태 규칙에만 면제를 준다. `t(\`plugin.section.${source}\`)`나 `` data-testid={`plugin-section-${source}`} ``는 `"plugin.section."` / `"plugin-section-"`이라는 리터럴 조각을 남겨 스캐너가 잡는다. 이 저장소의 관례는 lookup map이다(`PluginTrustBadge.tsx:10`의 `LABEL_KEY: Record<PluginTrust, string>`):
  ```ts
  const SECTION_KEY: Record<PluginSource, string> = { builtin: "plugin.section.builtin", ... };
  ```
  `.ts` 파일은 스캔 대상이 아니다(`usePluginActions.ts`는 무관).
- **`npm run audit:css-vars`는 이미 exit 1이다** (실측, 2026-08-06). 기존 미정의 변수 **2건**이 베이스라인이다: `--color-danger-default`(`src/styles/dialogs.css`), `--graph-pinned-color`(`src/components/sidebar/graph-style.ts`). 둘 다 이 작업과 무관하다. 따라서 기준은 "exit 0"이 아니라 **"목록이 정확히 그 2건이고 새 항목이 없다"** — 특히 `plugins.css`에서 온 항목이 하나도 없어야 한다. 새 CSS 변수를 만들지 말고 `base.css`/`generated/`에 있는 토큰을 쓸 것
- **모듈을 mock할 때는 `importOriginal` + spread를 기본으로 쓸 것** (Task 4에서 실측). 객체 리터럴 팩토리는 그 모듈의 **모든** importer에게 적용되므로, 직접 import하는 파일이 쓰는 이름만 채우면 그래프 안의 다른 importer가 collection 시점에 깨진다 — Task 4에서 `plugin-lifecycle → plugin-loader → sandbox/host-ai-bridge`가 같은 `extension-context`에서 `createAIAPI`를 가져와 정확히 그 일이 났다(`extension-context`는 14개를 export한다). 직접 importer만 확인하는 것으로는 부족하다:
  ```ts
  vi.mock("../extension-context", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../extension-context")>()),
    unregisterPluginUI: h.unregisterPluginUI,   // 갈아끼울 것만 덮어쓴다
  }));
  ```
  선례: `external-file-sidebar.test.ts`. 리터럴 mock을 쓰려면 `grep -rn "<모듈명>" src`로 importer를 **전부** 열거하고 그 합집합을 채워야 한다.
- **키를 버릴 때 destructure-drop을 쓰지 말 것** (Task 3에서 실측). `eslint.config.js:20-23`은 `@typescript-eslint/no-unused-vars`에 `argsIgnorePattern: "^_"`만 주므로 밑줄 접두사는 **함수 인자만** 면제한다 — `const { engines: _x, ...rest } = obj`는 error이고 `eslint --fix`가 고칠 수 없어 pre-commit이 커밋을 되돌린다. 이 저장소의 기존 관례를 따를 것 (`registry-client.ts:187`, `plugin-engines-gate.test.tsx:247`에 선례):
  ```ts
  const without = { ...obj };
  delete (without as { engines?: unknown }).engines;
  ```
- **push는 백그라운드로**: pre-push가 `cargo clippy --all-targets` + `npx knip`을 돌려 base 변경 후 첫 push는 5~7분

---

# PR1 — 내장/커뮤니티 구분과 컴포넌트 분해

브랜치: `feature/plugin-management-ui-sections`

## Task 1: `builtinDisabled` 상태와 토글 액션

**Files:**
- Modify: `src/stores/system/plugin.ts` (인터페이스 ~16-91, 초기 상태 ~224, 액션 추가, `partialize` ~391)
- Test: `src/stores/__tests__/plugin-builtin-disabled.test.ts` (create)

**Interfaces:**
- Consumes: 없음 (첫 태스크)
- Produces: `usePluginStore` 상태에 `builtinDisabled: string[]`, 액션 `setBuiltinEnabled(id: string, enabled: boolean): void`

- [ ] **Step 1: Write the failing test**

`src/stores/__tests__/plugin-builtin-disabled.test.ts`:

```ts
// §69 — 내장 플러그인의 비활성 상태. enabled 맵이 아니라 DISABLED 목록인 것이 핵심:
// 다음 릴리스에 내장이 추가돼도 마이그레이션 없이 기본 켜짐이 된다.
import { beforeEach, describe, expect, it } from "vitest";

import { usePluginStore } from "../system/plugin";

describe("builtinDisabled (§69)", () => {
  beforeEach(() => {
    usePluginStore.setState({ builtinDisabled: [] });
  });

  it("defaults to empty, so an unknown built-in is enabled", () => {
    expect(usePluginStore.getState().builtinDisabled).toEqual([]);
  });

  it("records a disabled built-in", () => {
    usePluginStore.getState().setBuiltinEnabled("baram-media-viewer", false);
    expect(usePluginStore.getState().builtinDisabled).toEqual([
      "baram-media-viewer",
    ]);
  });

  it("removes it again when re-enabled", () => {
    usePluginStore.getState().setBuiltinEnabled("baram-media-viewer", false);
    usePluginStore.getState().setBuiltinEnabled("baram-media-viewer", true);
    expect(usePluginStore.getState().builtinDisabled).toEqual([]);
  });

  it("does not duplicate an id disabled twice", () => {
    // 같은 id가 두 번 들어가면 재활성이 한 번으로 끝나지 않는다.
    usePluginStore.getState().setBuiltinEnabled("a", false);
    usePluginStore.getState().setBuiltinEnabled("a", false);
    expect(usePluginStore.getState().builtinDisabled).toEqual(["a"]);
  });

  it("leaves other ids alone", () => {
    usePluginStore.getState().setBuiltinEnabled("a", false);
    usePluginStore.getState().setBuiltinEnabled("b", false);
    usePluginStore.getState().setBuiltinEnabled("a", true);
    expect(usePluginStore.getState().builtinDisabled).toEqual(["b"]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run src/stores/__tests__/plugin-builtin-disabled.test.ts > /tmp/t1.log 2>&1; echo $?
```

Expected: FAIL — `setBuiltinEnabled is not a function`

- [ ] **Step 3: Add the state, the action, and persistence**

`src/stores/system/plugin.ts` — `interface PluginState`에 (알파벳 순서를 지키는 파일이므로 `addPlugin` 아래, `clearUpdateAvailable` 위):

```ts
  /**
   * §69 — 비활성화된 내장 플러그인의 id.
   *
   * ‼️ DISABLED 목록이며 enabled 맵이 아니다. 내장의 매니페스트는 번들의
   * `BUILTIN_PLUGINS`가 유일한 출처이고(앱 업데이트마다 신선하게 온다), 여기 담기는 것은
   * 사용자가 끈 것뿐이다. 그래서 다음 릴리스가 내장을 추가해도 마이그레이션 없이 기본
   * 켜짐이 된다 — enabled 맵이었다면 새 id가 맵에 없어서 꺼진 것으로 읽혔을 것이다.
   */
  builtinDisabled: string[];
```

초기 상태(`installedPlugins: {}` 근처)에 `builtinDisabled: [],`를 추가하고, 액션을 추가한다:

```ts
      setBuiltinEnabled: (id, enabled) =>
        set((state) => ({
          builtinDisabled: enabled
            ? state.builtinDisabled.filter((x) => x !== id)
            : state.builtinDisabled.includes(id)
              ? state.builtinDisabled
              : [...state.builtinDisabled, id],
        })),
```

`partialize`에 추가한다 (`installedPlugins` 바로 아래):

```ts
        // §69 영속화. 마이그레이션 단계는 필요 없다: 키가 없으면 초기값 `[]`로 떨어지고,
        // 그것이 "아무 내장도 끄지 않았다"라는 올바른 최초 상태다 — `revocations`가
        // 아래에서 같은 근거로 version bump 없이 추가된 것과 같다.
        builtinDisabled: state.builtinDisabled,
```

`version: 3`은 **올리지 않는다**. 인터페이스 선언에도 `setBuiltinEnabled: (id: string, enabled: boolean) => void;`를 추가할 것.

- [ ] **Step 4: Run test to verify it passes**

```bash
npx vitest run src/stores/__tests__/plugin-builtin-disabled.test.ts > /tmp/t1.log 2>&1; echo $?
```

Expected: PASS (5 tests)

- [ ] **Step 5: Confirm no migration is needed**

```bash
npx vitest run src/stores/__tests__ src/plugins/__tests__/plugin-store.test.ts > /tmp/t1b.log 2>&1; echo $?
```

Expected: PASS — 기존 스토어 테스트가 그대로 통과해야 한다. 실패하면 `version`을 올린 것이거나 `merge`를 건드린 것이다.

- [ ] **Step 6: Commit**

```bash
git add src/stores/system/plugin.ts src/stores/__tests__/plugin-builtin-disabled.test.ts
git commit -m "feat(§69): persist which built-in plugins the user turned off

A disabled LIST rather than an enabled map, so a built-in added in a later
release defaults to on with no migration step."
```

---

## Task 2: `plugin-sources.ts` — 행 파생과 액션 세트

**Files:**
- Create: `src/plugins/plugin-sources.ts`
- Test: `src/plugins/__tests__/plugin-sources.test.ts` (create)

**Interfaces:**
- Consumes: Task 1의 `builtinDisabled`
- Produces:
  - `type PluginSource = "builtin" | "community" | "dev"`
  - `interface PluginRow { source; manifest; enabled; error?; installed?; updateVersion?; revocation? }`
  - `interface RowActions { canReload; canRemove; canToggle; canUpdate }`
  - `function actionsFor(source: PluginSource): RowActions`
  - `function buildPluginRows(input: BuildRowsInput): PluginRow[]` — 순서는 builtin → community → dev
  - ~~`function manifestFor(...)`~~ — **이 태스크에서 만들지 않는다** (Step 5의 정정 참조). 셀렉터 형태 `selectManifest`는 Task 5가, 비반응 래퍼 `manifestFor`는 PR2 Task 11이 각자의 첫 소비처와 함께 만든다

- [ ] **Step 1: Write the failing test**

`src/plugins/__tests__/plugin-sources.test.ts`:

```ts
// §69 — 세 출처를 하나의 행 모델로 파생한다. 순서와 액션 세트를 순수 함수로 고정하는 것이
// 요점: DOM 순서 테스트보다 결정적이고, 다음 탭이 같은 판단을 되풀이할 수 없게 만든다.
import type { InstalledPlugin, PluginManifest } from "../types";

import { describe, expect, it } from "vitest";

import { actionsFor, buildPluginRows } from "../plugin-sources";

function manifest(id: string, over: Partial<PluginManifest> = {}) {
  return {
    author: "T",
    capabilities: [],
    description: "d",
    engines: { baram: "*" },
    id,
    license: "MIT",
    main: "index.mjs",
    name: id.toUpperCase(),
    trust: "sandboxed",
    version: "1.0.0",
    ...over,
  } as PluginManifest;
}

function installed(id: string, enabled: boolean): InstalledPlugin {
  return {
    checksum: "c",
    enabled,
    installedAt: 0,
    installPath: `/p/${id}`,
    manifest: manifest(id),
    updatedAt: 0,
  } as unknown as InstalledPlugin;
}

const EMPTY = {
  builtinDisabled: [],
  builtins: [],
  devPlugins: {},
  installedPlugins: {},
  pluginErrors: {},
  revocations: null,
  updateAvailable: {},
};

describe("actionsFor (§69 §3.1)", () => {
  it("gives a built-in a toggle but no removal and no update", () => {
    expect(actionsFor("builtin")).toEqual({
      canReload: false,
      canRemove: false,
      canToggle: true,
      canUpdate: false,
    });
  });

  it("gives a community plugin everything except reload", () => {
    expect(actionsFor("community")).toEqual({
      canReload: false,
      canRemove: true,
      canToggle: true,
      canUpdate: true,
    });
  });

  it("gives a dev plugin reload and removal but no toggle", () => {
    // dev 플러그인은 Rust가 매 실행마다 무조건 로드하므로 `enabled`를 영속화할 자리가 없다.
    expect(actionsFor("dev")).toEqual({
      canReload: true,
      canRemove: true,
      canToggle: false,
      canUpdate: false,
    });
  });
});

describe("buildPluginRows (§69)", () => {
  it("orders builtin, then community, then dev", () => {
    const rows = buildPluginRows({
      ...EMPTY,
      builtins: [{ manifest: manifest("bi"), module: {} }],
      devPlugins: { dv: installed("dv", true) },
      installedPlugins: { cm: installed("cm", true) },
    });
    expect(rows.map((r) => r.source)).toEqual([
      "builtin",
      "community",
      "dev",
    ]);
    expect(rows.map((r) => r.manifest.id)).toEqual(["bi", "cm", "dv"]);
  });

  it("marks a built-in in builtinDisabled as disabled", () => {
    const rows = buildPluginRows({
      ...EMPTY,
      builtinDisabled: ["bi"],
      builtins: [{ manifest: manifest("bi"), module: {} }],
    });
    expect(rows[0]?.enabled).toBe(false);
  });

  it("enables a built-in that is not in the list", () => {
    const rows = buildPluginRows({
      ...EMPTY,
      builtinDisabled: ["other"],
      builtins: [{ manifest: manifest("bi"), module: {} }],
    });
    expect(rows[0]?.enabled).toBe(true);
  });

  it("reports a dev plugin as always enabled", () => {
    const rows = buildPluginRows({
      ...EMPTY,
      devPlugins: { dv: installed("dv", false) },
    });
    expect(rows[0]?.enabled).toBe(true);
  });

  it("carries the community plugin's own enabled flag, error and update", () => {
    const rows = buildPluginRows({
      ...EMPTY,
      installedPlugins: { cm: installed("cm", false) },
      pluginErrors: { cm: "boom" },
      updateAvailable: { cm: "2.0.0" },
    });
    expect(rows[0]).toMatchObject({
      enabled: false,
      error: "boom",
      source: "community",
      updateVersion: "2.0.0",
    });
    expect(rows[0]?.installed?.installPath).toBe("/p/cm");
  });

  it("leaves installed undefined for a built-in", () => {
    // §5.2 — 내장은 `installedPlugins`에 들어가지 않는다. 이 필드가 채워지면
    // 삭제·업데이트 코드 경로가 내장에 닿을 수 있다는 뜻이다.
    const rows = buildPluginRows({
      ...EMPTY,
      builtins: [{ manifest: manifest("bi"), module: {} }],
    });
    expect(rows[0]?.installed).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run src/plugins/__tests__/plugin-sources.test.ts > /tmp/t2.log 2>&1; echo $?
```

Expected: FAIL — `Failed to resolve import "../plugin-sources"`

- [ ] **Step 3: Write the implementation**

`src/plugins/plugin-sources.ts`:

```ts
// §69 — 세 출처(내장·커뮤니티·개발 중)를 하나의 행 모델로 파생한다.
//
// 행이 무엇을 할 수 있는지는 `actionsFor` 한 곳에서만 결정된다. 그전에는 각 목록이 자기
// 마크업에서 개별 판단했고, 그래서 Installed 탭이 상세 화면 경로를 오래 갖지 못했고
// Updates 탭은 죽은 `onInstall` 콜백을 넘겼다.
import type { RevocationList } from "./revocation";
import type { BuiltinPlugin } from "./builtin";
import type { InstalledPlugin, PluginManifest } from "./types";

import { usePluginStore } from "../stores/system/plugin";
import { BUILTIN_PLUGINS } from "./builtin";
import { revocationFor } from "./revocation";

export type PluginSource = "builtin" | "community" | "dev";

export interface PluginRow {
  /**
   * builtin: `builtinDisabled`에 없으면 true
   * community: `InstalledPlugin.enabled`
   * dev: 항상 true — 토글로 렌더되지 않는다
   */
  enabled: boolean;
  error?: string;
  /** community와 dev만 채워진다. 내장은 디스크에 설치된 것이 아니다. */
  installed?: InstalledPlugin;
  manifest: PluginManifest;
  revocation?: null | ReturnType<typeof revocationFor>;
  source: PluginSource;
  updateVersion?: string;
}

export interface RowActions {
  canReload: boolean;
  canRemove: boolean;
  canToggle: boolean;
  canUpdate: boolean;
}

interface BuildRowsInput {
  builtinDisabled: string[];
  builtins: BuiltinPlugin[];
  devPlugins: Record<string, InstalledPlugin>;
  installedPlugins: Record<string, InstalledPlugin>;
  pluginErrors: Record<string, string>;
  revocations: null | RevocationList;
  updateAvailable: Record<string, string>;
}

/** §3.1의 표를 코드로 옮긴 것. 판단 지점은 여기 하나다. */
export function actionsFor(source: PluginSource): RowActions {
  switch (source) {
    case "builtin":
      // 앱 코드다. 삭제할 것도, 레지스트리에서 업데이트할 것도 없다.
      return {
        canReload: false,
        canRemove: false,
        canToggle: true,
        canUpdate: false,
      };
    case "community":
      return {
        canReload: false,
        canRemove: true,
        canToggle: true,
        canUpdate: true,
      };
    case "dev":
      // 토글이 없는 이유: Rust가 매 실행마다 목록을 받아 무조건 로드하므로 끈 상태를
      // 영속화할 자리가 없다. 대신 폴더를 제거한다.
      return {
        canReload: true,
        canRemove: true,
        canToggle: false,
        canUpdate: false,
      };
  }
}

export function buildPluginRows(input: BuildRowsInput): PluginRow[] {
  const rows: PluginRow[] = [];

  for (const { manifest } of input.builtins) {
    rows.push({
      enabled: !input.builtinDisabled.includes(manifest.id),
      error: input.pluginErrors[manifest.id],
      manifest,
      source: "builtin",
    });
  }

  for (const plugin of Object.values(input.installedPlugins)) {
    const id = plugin.manifest.id;
    rows.push({
      enabled: plugin.enabled,
      error: input.pluginErrors[id],
      installed: plugin,
      manifest: plugin.manifest,
      revocation: revocationFor(id, plugin.manifest.version, input.revocations),
      source: "community",
      updateVersion: input.updateAvailable[id],
    });
  }

  for (const plugin of Object.values(input.devPlugins)) {
    rows.push({
      enabled: true,
      error: input.pluginErrors[plugin.manifest.id],
      installed: plugin,
      manifest: plugin.manifest,
      source: "dev",
    });
  }

  return rows;
}

/**
 * 한 pluginId의 매니페스트. installed → dev → builtin 순.
 *
 * ‼️ §5.2 — 내장은 `installedPlugins`에 들어가지 않으므로, `installedPlugins[id] ?? devPlugins[id]`
 * 만 보는 코드는 내장에 대해 조용히 `undefined`를 받는다. `PluginSettingsForm`이 정확히 그랬고
 * (오류 없이 폼이 안 그려짐), 그것이 이 함수가 존재하는 이유다.
 */
export function manifestFor(pluginId: string): PluginManifest | undefined {
  const state = usePluginStore.getState();
  return (
    state.installedPlugins[pluginId]?.manifest ??
    state.devPlugins[pluginId]?.manifest ??
    BUILTIN_PLUGINS.find((b) => b.manifest.id === pluginId)?.manifest
  );
}
```

‼️ `manifestFor`는 이 태스크에서 아직 소비되지 않으므로 knip이 잡는다. **Task 5까지 `export`를 붙이지 말고** 파일 안에 두거나, Task 5와 함께 커밋한다. 이 계획은 후자를 택한다 — 아래 Step 5의 knip 확인을 볼 것.

- [ ] **Step 4: Run test to verify it passes**

```bash
npx vitest run src/plugins/__tests__/plugin-sources.test.ts > /tmp/t2.log 2>&1; echo $?
```

Expected: PASS (9 tests)

- [ ] **Step 5: Check knip before committing**

```bash
npx knip > /tmp/knip2.log 2>&1; echo $?; grep -n "plugin-sources" /tmp/knip2.log
```

‼️ **정정 (2026-08-06, 실행 중 실측)**: "`export` 키워드를 제거하고 Task 5에서 다시 붙인다"는 **틀렸다**. `tsconfig.json:24`의 `noUnusedLocals: true`는 export 여부와 무관하게 참조되지 않는 최상위 선언을 잡으므로, export를 떼면 knip 실패(pre-push)가 `npm run typecheck` 실패로 바뀐다 — 더 나쁘다.

**올바른 지시: `manifestFor`를 이 태스크에서 아예 만들지 않고 Task 5로 미룬다.** 위 Step 3의 코드에서 `manifestFor`와 그것만 쓰는 import(`usePluginStore`, `BUILTIN_PLUGINS` 값 import)를 빼고, 자리에 부재를 설명하는 주석만 남긴다. Task 5 Step 7이 첫 소비처와 함께 새로 추가한다. `buildPluginRows`/`actionsFor`는 테스트가 import하므로 어느 검사에도 걸리지 않는다.

- [ ] **Step 6: Commit**

```bash
git add src/plugins/plugin-sources.ts src/plugins/__tests__/plugin-sources.test.ts
git commit -m "feat(§69): derive one row model from the three plugin sources

actionsFor() is the single place that decides what a row can do, so a future
tab cannot reintroduce the per-list judgement that lost the Installed tab its
detail route."
```

---

## Task 3: 내장 매니페스트 가드

**Files:**
- Create: `src/plugins/__tests__/builtin-manifests.test.ts`

**Interfaces:**
- Consumes: `BUILTIN_PLUGINS`, `validateManifest`
- Produces: 없음 (가드 테스트만)

‼️ **이 테스트는 처음부터 통과한다** (실측 확인됨 — Media Viewer는 이미 `engines: ">=0.5.0"`이고 `main: "(builtin)"`은 `trusted` 티어에서 경로 검사를 받지 않는다). 그래서 TDD의 red 단계가 없고, 대신 **Step 3의 mutation으로 가드가 비어 있지 않음을 증명한다**. 그 단계를 건너뛰면 아무것도 검사하지 않는 테스트가 남는다.

- [ ] **Step 1: Write the guard test**

`src/plugins/__tests__/builtin-manifests.test.ts`:

```ts
// §69 — 내장 매니페스트도 출하 검증기를 통과해야 한다.
//
// 이것이 없어서 Media Viewer가 `engines: ">=0.4.0"`으로 출하됐다: 그 built-in을 담은 적
// 없는 두 릴리스를 가리키는 거짓 floor였고, 아무것도 내장 매니페스트를 검증하지 않아
// 통과했다. 픽스처가 아니라 실제 `BUILTIN_PLUGINS`를 순회해야 의미가 있다.
import { describe, expect, it } from "vitest";

import { BUILTIN_PLUGINS } from "../builtin";
import { validateManifest } from "../manifest";

describe("built-in manifests (§69)", () => {
  it("ships at least one built-in", () => {
    // 배열이 비면 아래 루프가 0회 돌면서 통과한다 — 그 공백을 막는다.
    expect(BUILTIN_PLUGINS.length).toBeGreaterThan(0);
  });

  it.each(BUILTIN_PLUGINS.map((b) => [b.manifest.id, b.manifest] as const))(
    "%s passes the shipping validator",
    (_id, manifest) => {
      const result = validateManifest(manifest);
      // ‼️ 성공 시 `errors` 키가 없다 — `toEqual([])`로 단정하면 항상 실패한다.
      expect(
        result.valid,
        `invalid: ${JSON.stringify(result)}`,
      ).toBe(true);
    },
  );

  it("declares a baram floor this app can evaluate", () => {
    // `engines.baram`이 있는 것만으로는 부족하다: `"*"`나 `^0.5.0`은 두 floor 검사 모두에게
    // "의견 없음"이고, 그러면 거짓 floor를 잡지 못한다.
    for (const { manifest } of BUILTIN_PLUGINS) {
      expect(
        manifest.engines.baram,
        `${manifest.id} must declare a >=X.Y.Z floor`,
      ).toMatch(/^>=\d+\.\d+\.\d+$/);
    }
  });

  // ‼️ 사용자 결정 2026-08-06 — 위 세 건은 현재 코드에서 처음부터 통과한다. 통과하는
  // 방향만 있는 가드는 단정이 죽어 있어도 초록이므로, 거부 방향을 레포지토리에 남긴다.
  // Step 3의 mutation은 여전히 수행하지만 그것은 수사업이고 증거가 남지 않는다.
  describe("the guard's rejecting direction", () => {
    const good = BUILTIN_PLUGINS[0]!.manifest;

    it("rejects a floor this app cannot evaluate", () => {
      // media-viewer가 `>=0.4.0`으로 출하된 것과 같은 계열의 결함: floor를 말하지 않는
      // 매니페스트는 위 세 번째 테스트가 잡아야 한다.
      expect(
        /^>=\d+\.\d+\.\d+$/.test("*"),
        "a '*' floor must not satisfy the floor assertion",
      ).toBe(false);
      expect(/^>=\d+\.\d+\.\d+$/.test("^0.5.0")).toBe(false);
      expect(/^>=\d+\.\d+\.\d+$/.test(">=0.5.0")).toBe(true);
    });

    it("rejects a built-in-shaped manifest with an empty license", () => {
      expect(validateManifest({ ...good, license: "" }).valid).toBe(false);
    });

    it("rejects a built-in-shaped manifest with no engines", () => {
      // Deleted from a copy rather than destructured away: this project's lint ignores `^_`
      // for arguments only, so `const { engines: _x, ...rest }` is an error here.
      // (선례: registry-client.ts:187, plugin-engines-gate.test.tsx:247)
      const noEngines = { ...good };
      delete (noEngines as { engines?: unknown }).engines;
      expect(validateManifest(noEngines).valid).toBe(false);
    });

    it("rejects a built-in-shaped manifest with no trust tier", () => {
      const noTrust = { ...good };
      delete (noTrust as { trust?: unknown }).trust;
      expect(validateManifest(noTrust).valid).toBe(false);
    });
  });
});
```

- [ ] **Step 2: Run it and confirm it passes as written**

```bash
npx vitest run src/plugins/__tests__/builtin-manifests.test.ts > /tmp/t3.log 2>&1; echo $?
```

Expected: PASS (7 tests — `it.each`가 내장 1개당 1건 + 거부 방향 4건)

- [ ] **Step 3: Mutation — prove the guard is not hollow**

`src/plugins/builtin/media-viewer.ts`의 `MEDIA_VIEWER_MANIFEST`에서 `engines` 줄을 일시적으로 `engines: { baram: "*" },`로 바꾼다. 그리고:

```bash
npx vitest run src/plugins/__tests__/builtin-manifests.test.ts > /tmp/t3m.log 2>&1; echo $?
grep -c "must declare a >=X.Y.Z floor" /tmp/t3m.log
```

Expected: exit 1, 그리고 floor 메시지가 잡힌다. 두 번째 mutation으로 `license: "Apache-2.0"`를 `license: ""`로 바꿔 `%s passes the shipping validator`가 실패하는 것도 확인한다.

‼️ 두 mutation을 **되돌린다**. `cp`/`mv`가 이 환경에서 `-i` 별칭이라 스크립트 복원이 조용히 실패할 수 있으므로, 되돌린 뒤 반드시 확인한다:

```bash
grep -n 'engines: { baram:' src/plugins/builtin/media-viewer.ts
grep -n 'license:' src/plugins/builtin/media-viewer.ts
git diff --stat src/plugins/builtin/media-viewer.ts
```

Expected: `>=0.5.0`과 `Apache-2.0`이 보이고, `git diff --stat`이 **빈 출력**이다.

- [ ] **Step 4: Commit**

```bash
git add src/plugins/__tests__/builtin-manifests.test.ts
git commit -m "test(§69): validate the built-in manifests the app compiles in

Nothing did, which is how media-viewer shipped a floor naming two releases
that never contained it. Both mutations (a '*' floor, an empty license) were
confirmed to fail this."
```

---

## Task 4: 내장 개별 lifecycle

**Files:**
- Modify: `src/plugins/plugin-lifecycle.ts` (`loadBuiltinPlugins` ~235-249, `shutdownBuiltinPlugins` ~265-287)
- Test: `src/plugins/__tests__/builtin-lifecycle.test.ts` (create)

**Interfaces:**
- Consumes: Task 1의 `builtinDisabled`
- Produces:
  - `function activateBuiltin(id: string): Promise<void>` — 내장 하나를 활성화 (이미 활성이면 no-op)
  - `function deactivateBuiltin(id: string): Promise<void>` — 내장 하나만 떼어냄 (활성이 아니면 no-op)
  - `loadBuiltinPlugins()`가 `builtinDisabled`를 건너뛴다

- [ ] **Step 1: Write the failing test**

`src/plugins/__tests__/builtin-lifecycle.test.ts`:

```ts
// §69 — 내장을 하나씩 켜고 끈다. 지금까지 `loadBuiltinPlugins`는 무조건 전부 로드했고
// `shutdownBuiltinPlugins`는 `activeBuiltins.splice(0)`로 전부 비우는 것뿐이었다.
//
// ‼️ `BuiltinPlugin` 타입은 import하지 않는다 — 픽스처는 `vi.hoisted` 안에서 만들고 캐스트가
// 필요 없으므로, import하면 `noUnusedLocals`와 lint가 둘 다 잡는다.
import { beforeEach, describe, expect, it, vi } from "vitest";

// ‼️ `vi.hoisted` — `vi.mock`은 import 위로 호이스팅되므로 팩토리가 실행될 때 평범한
// 최상위 `const FIXTURES`는 아직 초기화되지 않았다(TDZ 오류). 값을 즉시 평가하는
// 팩토리(`BUILTIN_PLUGINS: FIXTURES`)는 특히 그렇다 — 참조를 화살표 함수 안으로 미루는
// 형태와 달리 회피할 수 없다. 이 저장소의 관례이기도 하다: `plugin-lifecycle.errors.test.ts`,
// `tauri-sandbox-transport.test.ts` 등이 같은 이유로 `vi.hoisted`를 쓴다.
const h = vi.hoisted(() => {
  const builtinManifest = (id: string, name: string) => ({
    author: "Baram",
    capabilities: [],
    description: id,
    engines: { baram: ">=0.5.0" },
    id,
    license: "Apache-2.0",
    main: "(builtin)",
    name,
    trust: "trusted",
    version: "1.0.0",
  });
  const activateA = vi.fn();
  const activateB = vi.fn();
  const deactivateA = vi.fn();
  const unregisterPluginUI = vi.fn();
  return {
    activateA,
    activateB,
    deactivateA,
    FIXTURES: [
      {
        manifest: builtinManifest("fix-a", "Fixture A"),
        module: { activate: activateA, deactivate: deactivateA },
      },
      {
        manifest: builtinManifest("fix-b", "Fixture B"),
        module: { activate: activateB },
      },
    ],
    unregisterPluginUI,
  };
});

vi.mock("../builtin", () => ({ BUILTIN_PLUGINS: h.FIXTURES }));

// ‼️ `importOriginal` + spread이며 객체 리터럴이 아니다 (Task 4 실행 중 실측으로 교체).
// mock은 이 모듈의 모든 importer에게 적용되고, `plugin-lifecycle → plugin-loader →
// sandbox/host-ai-bridge`가 같은 모듈에서 `createAIAPI`를 가져온다 — 리터럴 mock은 그 import를
// collection 시점에 깨뜨린다("No createAIAPI export is defined on the mock"). 직접 importer가
// 쓰는 이름만 세는 것으로는 알 수 없다. 선례: `external-file-sidebar.test.ts`.
vi.mock("../extension-context", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../extension-context")>()),
  createExtensionContext: () => ({ subscriptions: [] }),
  unregisterPluginUI: h.unregisterPluginUI,
}));

// 아래 테스트 본문이 그대로 쓰도록 평범한 이름으로 풀어 둔다(호이스팅 이후 정상 순서로 실행된다).
const { activateA, activateB, deactivateA, unregisterPluginUI } = h;

import { usePluginStore } from "../../stores/system/plugin";
import {
  activateBuiltin,
  deactivateBuiltin,
  loadBuiltinPlugins,
  shutdownBuiltinPlugins,
} from "../plugin-lifecycle";

describe("built-in lifecycle (§69)", () => {
  beforeEach(async () => {
    await shutdownBuiltinPlugins(); // 이전 테스트의 활성 상태를 비운다
    activateA.mockReset();
    activateB.mockReset();
    deactivateA.mockReset();
    unregisterPluginUI.mockReset();
    usePluginStore.setState({ builtinDisabled: [] });
  });

  it("activates every built-in when none is disabled", async () => {
    await loadBuiltinPlugins();
    expect(activateA).toHaveBeenCalledTimes(1);
    expect(activateB).toHaveBeenCalledTimes(1);
  });

  it("skips a disabled built-in at startup", async () => {
    usePluginStore.setState({ builtinDisabled: ["fix-a"] });
    await loadBuiltinPlugins();
    expect(activateA).not.toHaveBeenCalled();
    expect(activateB).toHaveBeenCalledTimes(1);
  });

  it("activates a built-in the disabled list does not name", async () => {
    // ‼️ disabled 목록 방식의 핵심 보장: 다음 릴리스가 내장을 추가해도 기본 켜짐이다.
    // enabled 맵이었다면 새 id가 맵에 없어서 꺼진 것으로 읽혔을 것이다.
    usePluginStore.setState({ builtinDisabled: ["some-old-id"] });
    await loadBuiltinPlugins();
    expect(activateA).toHaveBeenCalledTimes(1);
    expect(activateB).toHaveBeenCalledTimes(1);
  });

  it("deactivates only the named built-in", async () => {
    await loadBuiltinPlugins();
    await deactivateBuiltin("fix-a");
    expect(deactivateA).toHaveBeenCalledTimes(1);
    expect(unregisterPluginUI).toHaveBeenCalledWith("fix-a");
    expect(unregisterPluginUI).not.toHaveBeenCalledWith("fix-b");
  });

  it("re-activates after a deactivate", async () => {
    // 한 방향만 테스트하면 재활성 경로가 죽어도 통과한다.
    await loadBuiltinPlugins();
    await deactivateBuiltin("fix-a");
    activateA.mockClear();
    await activateBuiltin("fix-a");
    expect(activateA).toHaveBeenCalledTimes(1);
  });

  it("is a no-op to activate one that is already active", async () => {
    await loadBuiltinPlugins();
    await activateBuiltin("fix-a");
    expect(activateA).toHaveBeenCalledTimes(1);
  });

  it("is a no-op to deactivate one that is not active", async () => {
    await deactivateBuiltin("fix-a");
    expect(deactivateA).not.toHaveBeenCalled();
  });

  it("still tears every built-in down on shutdown", async () => {
    await loadBuiltinPlugins();
    await shutdownBuiltinPlugins();
    expect(unregisterPluginUI).toHaveBeenCalledWith("fix-a");
    expect(unregisterPluginUI).toHaveBeenCalledWith("fix-b");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run src/plugins/__tests__/builtin-lifecycle.test.ts > /tmp/t4.log 2>&1; echo $?
```

Expected: FAIL — `activateBuiltin`/`deactivateBuiltin`가 export되지 않았고, `shutdownBuiltinPlugins`도 export되지 않았을 수 있다(현재는 모듈 내부 함수다 — export를 추가할 것).

- [ ] **Step 3: Rework the built-in lifecycle**

`src/plugins/plugin-lifecycle.ts`에서 `loadBuiltinPlugins`를 다음으로 교체한다:

```ts
/**
 * Activate the compiled-in plugins through the same ExtensionContext external
 * plugins get. Idempotent per plugin: React.StrictMode double-invokes the mounting
 * effect in dev, and a second activation would register every viewer twice.
 *
 * §69 — `builtinDisabled`에 담긴 것은 건너뛴다. 내장은 앱 코드이므로 플러그인 API는
 * 통합 지점이지 신뢰 경계가 아니고, 그래서 여전히 설치 플러그인보다 먼저 로드된다.
 * 끄는 수단이 필요한 이유는 `matchFileViewer`가 먼저 등록된 뷰어를 택하기 때문이다:
 * 내장이 잡은 확장자는 그것을 끄지 않는 한 커뮤니티 뷰어가 가져올 수 없다.
 */
export async function loadBuiltinPlugins(): Promise<void> {
  const { builtinDisabled } = usePluginStore.getState();
  for (const builtin of BUILTIN_PLUGINS) {
    if (builtinDisabled.includes(builtin.manifest.id)) continue;
    await activateOne(builtin);
  }
}

/** 내장 하나를 활성화한다. 이미 활성이면 아무것도 하지 않는다. */
export async function activateBuiltin(id: string): Promise<void> {
  const builtin = BUILTIN_PLUGINS.find((b) => b.manifest.id === id);
  if (!builtin) return;
  await activateOne(builtin);
}

/**
 * 내장 하나만 떼어낸다.
 *
 * ‼️ `shutdownBuiltinPlugins`에서 분리한 것이 이 태스크의 요점이다. 그 함수는
 * `activeBuiltins.splice(0)`로 전체를 비우므로 하나만 끄는 데 쓸 수 없었다.
 */
export async function deactivateBuiltin(id: string): Promise<void> {
  const index = activeBuiltins.findIndex((b) => b.id === id);
  if (index === -1) return;
  const [active] = activeBuiltins.splice(index, 1);
  if (active) await teardownBuiltin(active);
}

async function activateOne(builtin: BuiltinPlugin): Promise<void> {
  if (activeBuiltins.some((b) => b.id === builtin.manifest.id)) return;
  try {
    const context = createExtensionContext(builtin.manifest, "");
    await builtin.module.activate?.(context);
    activeBuiltins.push({
      context,
      id: builtin.manifest.id,
      module: builtin.module,
    });
  } catch (err) {
    logger.error(
      `[PluginLifecycle] builtin ${builtin.manifest.id} activate failed:`,
      err,
    );
  }
}

/** 하나의 활성 내장을 정리한다. 전체 종료와 개별 비활성이 공유한다. */
async function teardownBuiltin(active: ActiveBuiltin): Promise<void> {
  try {
    await active.module.deactivate?.();
  } catch (err) {
    logger.error(
      `[PluginLifecycle] builtin ${active.id} deactivate failed:`,
      err,
    );
  }
  for (const disposable of active.context.subscriptions) {
    try {
      disposable.dispose();
    } catch (err) {
      logger.error(`[PluginLifecycle] builtin ${active.id} dispose failed:`, err);
    }
  }
  unregisterPluginUI(active.id);
}
```

그리고 `shutdownBuiltinPlugins`를 `export`하고 공유 정리 함수를 쓰도록 바꾼다:

```ts
export async function shutdownBuiltinPlugins(): Promise<void> {
  for (const active of activeBuiltins.splice(0)) {
    await teardownBuiltin(active);
  }
}
```

`BuiltinPlugin` 타입 import를 추가한다: `import type { BuiltinPlugin } from "./builtin";`

- [ ] **Step 4: Run test to verify it passes**

```bash
npx vitest run src/plugins/__tests__/builtin-lifecycle.test.ts > /tmp/t4.log 2>&1; echo $?
```

Expected: PASS (8 tests)

- [ ] **Step 5: Run the whole plugin suite for regressions**

```bash
npx vitest run src/plugins src/components/plugins > /tmp/t4b.log 2>&1; echo $?
tail -20 /tmp/t4b.log
```

Expected: PASS. `plugin-lifecycle.events.test.ts`와 `plugin-lifecycle.errors.test.ts`가 특히 이 함수들을 건드린다.

- [ ] **Step 6: Commit**

```bash
git add src/plugins/plugin-lifecycle.ts src/plugins/__tests__/builtin-lifecycle.test.ts
git commit -m "feat(§69): activate and deactivate built-ins one at a time

shutdownBuiltinPlugins() spliced the whole array, so there was no way to turn
one off. Turning one off is the only way a community viewer can ever claim an
extension the built-in already registered — matchFileViewer takes the first."
```

---

## Task 5: `PluginRow` 컴포넌트와 CSS

**Files:**
- Create: `src/components/plugins/PluginRow.tsx`
- Modify: `src/styles/plugins.css` (append)
- Modify: `src/plugins/plugin-sources.ts` (`selectManifest` **신규 추가** — Step 7 참조)
- Modify: `src/components/plugins/PluginSettingsForm.tsx:41-53` (`selectManifest` 사용)
- Test: `src/components/plugins/__tests__/PluginRow.test.tsx` (create)
- Test: `src/plugins/__tests__/select-manifest.test.ts` (create)

**Interfaces:**
- Consumes: Task 2의 `PluginRow`, `actionsFor`
- Produces:
  - `<PluginRowView row={...} onToggle onRemove onUpdate onReload onDetails onSettings? />` — `onSettings`는 optional
  - `selectManifest(sources: {devPlugins, installedPlugins}, pluginId): PluginManifest | undefined` — installed → dev → builtin 순. **셀렉터 형태**이며, 비반응 래퍼(`manifestFor`)는 PR2 Task 11이 첫 소비처와 함께 만든다

- [ ] **Step 1: Write the failing test**

`src/components/plugins/__tests__/PluginRow.test.tsx`:

```tsx
// §69 — 액션 세트가 `source`에서 파생되는지 행 단위로 고정한다.
import type { PluginRow } from "../../../plugins/plugin-sources";
import type { PluginManifest } from "../../../plugins/types";

import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { PluginRowView } from "../PluginRow";

function row(over: Partial<PluginRow>): PluginRow {
  return {
    enabled: true,
    manifest: {
      author: "T",
      capabilities: [],
      description: "d",
      engines: { baram: "*" },
      id: "x",
      license: "MIT",
      main: "index.mjs",
      name: "Ex",
      trust: "sandboxed",
      version: "1.0.0",
    } as PluginManifest,
    source: "community",
    ...over,
  };
}

/** `onSettings`는 의도적으로 빠져 있다 — optional prop이고, 넘기지 않는 것이 PR1의 상태다. */
const handlers = {
  onDetails: vi.fn(),
  onReload: vi.fn(),
  onRemove: vi.fn(),
  onToggle: vi.fn(),
  onUpdate: vi.fn(),
};

describe("PluginRowView (§69)", () => {
  it("gives a built-in a toggle and no remove button", () => {
    render(<PluginRowView row={row({ source: "builtin" })} {...handlers} />);
    expect(screen.getByRole("checkbox")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /remove/i })).toBeNull();
  });

  it("gives a community plugin a remove button", () => {
    render(<PluginRowView row={row({ source: "community" })} {...handlers} />);
    expect(screen.getByRole("button", { name: /remove/i })).toBeTruthy();
  });

  it("gives a dev plugin reload and no toggle", () => {
    render(<PluginRowView row={row({ source: "dev" })} {...handlers} />);
    expect(screen.getByRole("button", { name: /reload/i })).toBeTruthy();
    expect(screen.queryByRole("checkbox")).toBeNull();
  });

  it("shows an update button only when a version is offered", () => {
    const { rerender } = render(<PluginRowView row={row({})} {...handlers} />);
    expect(screen.queryByRole("button", { name: /update/i })).toBeNull();
    rerender(
      <PluginRowView row={row({ updateVersion: "2.0.0" })} {...handlers} />,
    );
    expect(screen.getByRole("button", { name: /update/i })).toBeTruthy();
  });

  it("never offers a built-in an update, even if one is somehow set", () => {
    // canUpdate가 source에서 파생된다는 것을 고정한다 — updateVersion만 보고 그리면 안 된다.
    render(
      <PluginRowView
        row={row({ source: "builtin", updateVersion: "2.0.0" })}
        {...handlers}
      />,
    );
    expect(screen.queryByRole("button", { name: /update/i })).toBeNull();
  });

  it("omits the settings button when no onSettings is given", () => {
    // ‼️ PR1의 상태. 부재를 no-op 콜백으로 위장하지 않는다 (사용자 결정 2026-08-06).
    render(<PluginRowView row={row({})} {...handlers} />);
    expect(screen.queryByRole("button", { name: /settings/i })).toBeNull();
  });

  it("shows the settings button when onSettings is given", () => {
    const onSettings = vi.fn();
    render(
      <PluginRowView onSettings={onSettings} row={row({})} {...handlers} />,
    );
    expect(screen.getByRole("button", { name: /settings/i })).toBeTruthy();
  });

  it("names the plugin in each control's accessible name", () => {
    // 행마다 같은 이름의 버튼이 생기므로, 스코핑 없는 질의가 모호해지지 않게 한다.
    render(<PluginRowView row={row({})} {...handlers} />);
    expect(screen.getByRole("button", { name: /Ex/ })).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run src/components/plugins/__tests__/PluginRow.test.tsx > /tmp/t5.log 2>&1; echo $?
```

Expected: FAIL — `Failed to resolve import "../PluginRow"`

- [ ] **Step 3: Write the component**

`src/components/plugins/PluginRow.tsx` — 인라인 스타일 없이 클래스만 쓴다. 액션 가시성은 전부 `actionsFor(row.source)`에서 나온다. 각 버튼의 `aria-label`에 `row.manifest.name`을 넣는다(행마다 같은 문구의 버튼이 생기므로 필수). 구조:

```tsx
// §69 — 한 행. 액션 세트는 `actionsFor(source)`에서만 나온다.
import type { PluginRow } from "../../plugins/plugin-sources";

import { useTranslation } from "../../i18n/useTranslation";
import { actionsFor } from "../../plugins/plugin-sources";
import { PluginCapabilityBadge } from "./PluginCapabilityBadge";
import { PluginRevokedNotice } from "./PluginRevokedNotice";

interface PluginRowViewProps {
  onDetails: () => void;
  onReload: () => void;
  onRemove: () => void;
  /**
   * ‼️ OPTIONAL, 사용자 결정 2026-08-06. PR1에는 설정 페이지가 아직 없으므로 아무도 이것을
   * 넘기지 않고, ⚙는 그려지지 않는다. 앞선 초안은 `hasSettings={() => false}`와 no-op
   * `onSettings`를 넘기게 했는데, 그것은 이 작업이 지적하려는 결함 그 자체다 — Updates 탭의
   * `onInstall={() => {}}`. 부재를 no-op으로 위장하지 않고 부재로 표현한다.
   */
  onSettings?: () => void;
  onToggle: () => void;
  onUpdate: () => void;
  row: PluginRow;
}

export function PluginRowView({
  onDetails,
  onReload,
  onRemove,
  onSettings,
  onToggle,
  onUpdate,
  row,
}: PluginRowViewProps) {
  const { t } = useTranslation();
  const can = actionsFor(row.source);
  const { manifest } = row;
  const named = { name: manifest.name };

  return (
    <div className="plugin-row">
      <div className="plugin-row__main">
        <div className="plugin-row__head">
          {manifest.icon && (
            <span className="plugin-row__icon">{manifest.icon}</span>
          )}
          <span className="plugin-row__name">{manifest.name}</span>
          <span className="plugin-row__version">v{manifest.version}</span>
          {row.source === "builtin" && (
            <span className="plugin-row__badge">
              {t("plugin.builtin.badge")}
            </span>
          )}
        </div>
        <p className="plugin-row__desc text-truncate">{manifest.description}</p>
        {row.error && <p className="plugin-row__error">⚠ {row.error}</p>}
        {manifest.capabilities.length > 0 && (
          <div className="plugin-row__caps">
            {manifest.capabilities.slice(0, 3).map((c) => (
              <PluginCapabilityBadge capability={c} key={c} />
            ))}
          </div>
        )}
        <PluginRevokedNotice onRemove={onRemove} revocation={row.revocation ?? null} />
      </div>
      <div className="plugin-row__actions">
        <button
          aria-label={t("plugin.marketplace.viewDetails", named)}
          className="plugin-row__btn"
          onClick={onDetails}
          type="button"
        >
          {t("plugin.action.details")}
        </button>
        {onSettings && (
          <button
            aria-label={t("plugin.action.settingsFor", named)}
            className="plugin-row__btn"
            onClick={onSettings}
            type="button"
          >
            {t("plugin.action.settings")}
          </button>
        )}
        {can.canReload && (
          <button
            aria-label={t("plugin.action.reloadFor", named)}
            className="plugin-row__btn"
            onClick={onReload}
            type="button"
          >
            {t("plugin.action.reload")}
          </button>
        )}
        {can.canUpdate && row.updateVersion && (
          <button
            aria-label={t("plugin.action.updateFor", named)}
            className="plugin-row__btn plugin-row__btn--warn"
            onClick={onUpdate}
            type="button"
          >
            {t("plugin.action.updateTo", { version: row.updateVersion })}
          </button>
        )}
        {can.canToggle && (
          <label className="plugin-row__toggle">
            <input checked={row.enabled} onChange={onToggle} type="checkbox" />
            <span>{row.enabled ? t("plugin.action.on") : t("plugin.action.off")}</span>
          </label>
        )}
        {can.canRemove && (
          <button
            aria-label={t("plugin.action.removeFor", named)}
            className="plugin-row__btn plugin-row__btn--danger"
            onClick={onRemove}
            type="button"
          >
            {t("plugin.action.remove")}
          </button>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Add the i18n keys this component needs**

`src/i18n/en.json`과 `src/i18n/ko.json` **양쪽에** 기존 `plugin.*` 블록 근처에 추가한다:

```json
  "plugin.builtin.badge": "Built-in",
  "plugin.action.settings": "Settings",
  "plugin.action.settingsFor": "Settings for {name}",
  "plugin.action.reloadFor": "Reload {name}",
  "plugin.action.updateFor": "Update {name}",
  "plugin.action.removeFor": "Remove {name}",
```

ko.json:

```json
  "plugin.builtin.badge": "내장",
  "plugin.action.settings": "설정",
  "plugin.action.settingsFor": "{name} 설정",
  "plugin.action.reloadFor": "{name} 다시 로드",
  "plugin.action.updateFor": "{name} 업데이트",
  "plugin.action.removeFor": "{name} 삭제",
```

`plugin.action.reload`, `plugin.action.remove`, `plugin.action.details`, `plugin.action.on`, `plugin.action.off`, `plugin.action.updateTo`, `plugin.marketplace.viewDetails`는 이미 존재한다 — 다음으로 확인할 것:

```bash
for k in plugin.action.reload plugin.action.remove plugin.action.details plugin.action.on plugin.action.off plugin.action.updateTo plugin.marketplace.viewDetails; do
  printf '%s: en=%s ko=%s\n' "$k" \
    "$(grep -c "\"$k\"" src/i18n/en.json)" "$(grep -c "\"$k\"" src/i18n/ko.json)"
done
```

Expected: 전부 `en=1 ko=1`. 0이 나오면 그 키도 이 단계에서 추가한다.

- [ ] **Step 5: Write the CSS**

`src/styles/plugins.css` 끝에 추가한다. 인라인 스타일을 쓰지 않고 토큰만 쓴다:

```css
/* §69 — 한 행. 사이드바(~280px)와 설정 모달(넓음) 양쪽에서 같은 레이아웃으로 동작한다:
   단일 컬럼 + 오른쪽 정렬 액션, 설명문만 잘린다. 폭에 따라 분기하지 않는다. */
.plugin-row {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  padding: 12px 16px;
  border-bottom: 1px solid var(--color-border-default);
}

.plugin-row:hover {
  background-color: var(--color-bg-subtle);
}

.plugin-row__main {
  flex: 1;
  min-width: 0;
}

.plugin-row__head {
  display: flex;
  align-items: center;
  gap: 8px;
}

.plugin-row__icon {
  font-size: 20px;
}

.plugin-row__name {
  font-weight: 600;
  font-size: 14px;
  color: var(--color-text-primary);
}

.plugin-row__version {
  font-size: 12px;
  color: var(--color-text-muted);
}

.plugin-row__badge {
  padding: 1px 6px;
  border-radius: 4px;
  font-size: 11px;
  background-color: var(--color-bg-subtle);
  border: 1px solid var(--color-border-default);
  color: var(--color-text-muted);
}

.plugin-row__desc {
  margin: 2px 0 0;
  font-size: 12px;
  color: var(--color-text-secondary);
}

.plugin-row__error {
  margin: 6px 0 0;
  padding: 6px 10px;
  border-radius: 6px;
  background-color: var(--color-status-error-bg);
  border: 1px solid var(--color-status-error-border);
  color: var(--color-status-danger);
  font-size: 12px;
  line-height: 1.5;
  /* 체크섬과 경로는 끊기지 않는 토큰이라 이것 없이는 패널보다 넓어진다. */
  overflow-wrap: anywhere;
}

.plugin-row__caps {
  display: flex;
  gap: 4px;
  margin-top: 6px;
  flex-wrap: wrap;
}

.plugin-row__actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}

.plugin-row__btn {
  padding: 4px 8px;
  border-radius: 4px;
  font-size: 12px;
  background-color: transparent;
  color: var(--color-text-primary);
  border: 1px solid var(--color-border-default);
  cursor: pointer;
}

.plugin-row__btn--warn {
  background-color: var(--color-status-warning);
  color: var(--color-status-warning-on-solid);
  border-color: transparent;
}

.plugin-row__btn--danger {
  color: var(--color-status-danger);
  border-color: var(--color-status-danger);
}

.plugin-row__toggle {
  display: flex;
  align-items: center;
  gap: 4px;
  cursor: pointer;
  font-size: 12px;
  color: var(--color-text-muted);
}
```

- [ ] **Step 6: Run test and the CSS variable audit**

```bash
npx vitest run src/components/plugins/__tests__/PluginRow.test.tsx > /tmp/t5.log 2>&1; echo $?
npm run audit:css-vars > /tmp/t5css.log 2>&1; echo $?
tail -15 /tmp/t5css.log
```

Expected: 테스트 PASS (8 tests). audit은 **exit 1이 정상**이다 — 기존 2건(`--color-danger-default`, `--graph-pinned-color`)이 베이스라인이다. 확인할 것은 목록에 **`plugins.css`에서 온 항목이 없다**는 것뿐이다. 있으면 그 변수를 `base.css`/`generated/`에 있는 것으로 바꾼다 — **새 CSS 변수를 만들지 말 것**.

- [ ] **Step 7: Add `selectManifest` and point `PluginSettingsForm` at it**

‼️ **두 가지가 실행 중 실측으로 바뀌었다 (2026-08-06). 이 절이 계획의 원래 지시를 대체한다.**

**(a) Task 2에서 `manifestFor`는 아예 만들어지지 않았다.** `tsconfig.json:24`의 `noUnusedLocals: true`는 export 여부와 무관하게 참조되지 않는 최상위 선언을 잡으므로, Task 2에서 `export`만 떼는 것은 knip 실패를 typecheck 실패로 바꾸는 일이었다. 그래서 조회 함수는 **첫 소비처와 함께** 만든다.

**(b) 그 소비처가 필요한 것은 비반응 조회가 아니라 셀렉터다.** `PluginSettingsForm`은 지금 `plugin`을 `useShallow`로 **구독**한다. `usePluginStore.getState()`로 읽는 `manifestFor`를 쓰면 그 구독이 사라지고, 매니페스트가 교체돼도 재렌더가 트리거되지 않는다 — dev 플러그인 "다시 로드"가 `addDevPlugin(fresh)`로 매니페스트를 갈아끼우므로, 열려 있는 설정 폼이 갱신되지 않는 실제 회귀가 된다.

**그리고 PR1에는 비반응 조회를 쓸 곳이 없다** (`hasSettings` 판정은 PR2 Task 11에서 온다). 그러므로 **이 태스크는 셀렉터만 추가한다** — `manifestFor`를 지금 만들면 (a)의 knip 함정을 그대로 되풀이한다.

`src/plugins/plugin-sources.ts` 하단(현재 부재를 설명하는 주석이 있는 자리)에 넣고, 그 주석은 `manifestFor`가 아직 없는 이유만 남기도록 고친다:

```ts
/**
 * 한 pluginId의 매니페스트. installed → dev → builtin 순.
 *
 * ‼️ §5.2 — 내장은 `installedPlugins`에 들어가지 않으므로, `installedPlugins[id] ?? devPlugins[id]`
 * 만 보는 코드는 내장에 대해 조용히 `undefined`를 받는다. `PluginSettingsForm`이 정확히 그랬고
 * (오류 없이 폼이 안 그려짐), 그것이 이 함수가 존재하는 이유다.
 *
 * ‼️ 셀렉터 형태인 것이 핵심이다: 호출자가 `useShallow` 안에서 부르면 구독이 유지된다.
 * `getState()`로 읽는 형태였다면 dev 플러그인 다시 로드가 매니페스트를 교체해도 열려 있는
 * 폼이 갱신되지 않는다. 스토어 타입은 export되지 않으므로 필요한 두 필드만 구조적으로 받는다.
 */
export function selectManifest(
  sources: {
    devPlugins: Record<string, InstalledPlugin>;
    installedPlugins: Record<string, InstalledPlugin>;
  },
  pluginId: string,
): PluginManifest | undefined {
  return (
    sources.installedPlugins[pluginId]?.manifest ??
    sources.devPlugins[pluginId]?.manifest ??
    BUILTIN_PLUGINS.find((b) => b.manifest.id === pluginId)?.manifest
  );
}
```

`BUILTIN_PLUGINS`의 **값** import를 추가한다: `import { BUILTIN_PLUGINS } from "./builtin";` (`BuiltinPlugin`은 이미 타입으로 import돼 있으므로 값 import는 별도다). `usePluginStore` import는 **필요하지 않다** — 셀렉터는 스토어를 모른다.

그다음 `src/components/plugins/PluginSettingsForm.tsx:41-53`을 바꾼다:

```tsx
  const { manifest, persisted, setPluginSetting } = usePluginStore(
    useShallow((s) => ({
      // ‼️ §5.2 — `installedPlugins[id] ?? devPlugins[id]`였다. 내장은 어느 쪽에도 없으므로
      // 내장의 설정 폼이 조용히, 오류 없이 안 그려졌다. `selectManifest`가 세 출처를 다 본다.
      // 셀렉터 안에서 부르는 것이 구독을 유지하는 유일한 방법이다 — 위 함수의 주석을 볼 것.
      manifest: selectManifest(s, pluginId),
      persisted: s.pluginSettings[pluginId],
      setPluginSetting: s.setPluginSetting,
    })),
  );
  // Memoised for its IDENTITY, not its cost: `declaredSettingsFor` returns a fresh `[]`
  // for a plugin with no fields, which would re-run the resolver below every render.
  const declared = useMemo(
    () => (manifest ? declaredSettingsFor(manifest) : []),
    [manifest],
  );
```

`plugin`을 참조하는 나머지 자리도 `manifest`로 바꾼다 — `grep -n "plugin\b" src/components/plugins/PluginSettingsForm.tsx`로 남은 참조가 없는지 확인할 것.

- [ ] **Step 8: Test `selectManifest`, including the two properties that motivated it**

`src/plugins/__tests__/select-manifest.test.ts`:

```ts
// §69 §5.2 — 세 출처를 다 보는 매니페스트 조회. 내장이 `installedPlugins`에 없다는 사실이
// 조용한 `undefined`를 만들던 자리다.
import type { InstalledPlugin } from "../types";

import { describe, expect, it } from "vitest";

import { BUILTIN_PLUGINS } from "../builtin";
import { selectManifest } from "../plugin-sources";

function rec(id: string, version: string): InstalledPlugin {
  return {
    checksum: "c",
    enabled: true,
    installedAt: 0,
    installPath: `/p/${id}`,
    manifest: {
      author: "T",
      capabilities: [],
      description: "d",
      engines: { baram: "*" },
      id,
      license: "MIT",
      main: "index.mjs",
      name: id,
      trust: "sandboxed",
      version,
    },
    updatedAt: 0,
  } as unknown as InstalledPlugin;
}

const EMPTY = { devPlugins: {}, installedPlugins: {} };

describe("selectManifest (§69 §5.2)", () => {
  it("resolves an installed plugin", () => {
    expect(
      selectManifest({ ...EMPTY, installedPlugins: { a: rec("a", "1.0.0") } }, "a")
        ?.version,
    ).toBe("1.0.0");
  });

  it("resolves a dev plugin", () => {
    expect(
      selectManifest({ ...EMPTY, devPlugins: { d: rec("d", "9.9.9") } }, "d")
        ?.version,
    ).toBe("9.9.9");
  });

  it("resolves a BUILT-IN, which is in neither map", () => {
    // ‼️ 이 케이스가 이 함수의 존재 이유다. 실제 `BUILTIN_PLUGINS`로 확인한다 —
    // 픽스처로 하면 정작 앱이 쓰는 배열을 검사하지 않는다.
    const id = BUILTIN_PLUGINS[0]!.manifest.id;
    expect(selectManifest(EMPTY, id)?.id).toBe(id);
  });

  it("prefers installed over dev over builtin", () => {
    const id = BUILTIN_PLUGINS[0]!.manifest.id;
    expect(
      selectManifest(
        { devPlugins: { [id]: rec(id, "2.0.0") }, installedPlugins: {} },
        id,
      )?.version,
      "dev must win over builtin",
    ).toBe("2.0.0");
    expect(
      selectManifest(
        {
          devPlugins: { [id]: rec(id, "2.0.0") },
          installedPlugins: { [id]: rec(id, "3.0.0") },
        },
        id,
      )?.version,
      "installed must win over dev",
    ).toBe("3.0.0");
  });

  it("returns undefined for an id from no source", () => {
    expect(selectManifest(EMPTY, "nobody")).toBeUndefined();
  });
});
```

- [ ] **Step 9: Verify the form still works AND stays reactive**

```bash
npx vitest run src/plugins/__tests__/select-manifest.test.ts src/components/plugins/__tests__/PluginSettingsForm.test.tsx > /tmp/t5b.log 2>&1; echo $?
```

Expected: PASS. 기존 `PluginSettingsForm.test.tsx`는 모듈 mock 없이 실제 스토어를 `setState`로 쓰므로(확인됨) 회귀하지 않아야 한다.

그리고 반응성을 고정하는 테스트를 `PluginSettingsForm.test.tsx`에 **추가**한다 — 이것이 셀렉터를 쓰는 이유이고, `getState()` 형태로 되돌리면 실패해야 한다:

```tsx
  it("re-renders when the manifest is replaced (dev reload)", () => {
    // ‼️ dev 플러그인 "다시 로드"는 `addDevPlugin(fresh)`로 매니페스트를 갈아끼운다.
    // 비반응 `getState()` 조회였다면 열려 있는 폼이 낡은 필드를 계속 보여준다.
    usePluginStore.setState({
      devPlugins: {},
      installedPlugins: { "p-1": makePlugin([{ default: "", key: "old", label: "Old Field", type: "string" }]) },
      pluginSettings: {},
    });
    render(<PluginSettingsForm pluginId="p-1" />);
    expect(screen.getByText("Old Field")).toBeTruthy();

    act(() => {
      usePluginStore.setState({
        installedPlugins: { "p-1": makePlugin([{ default: "", key: "new", label: "New Field", type: "string" }]) },
      });
    });
    expect(screen.getByText("New Field")).toBeTruthy();
    expect(screen.queryByText("Old Field")).toBeNull();
  });
```

‼️ `makePlugin`은 그 파일에 이미 있는 헬퍼 이름과 다를 수 있다 — **파일을 먼저 읽고 기존 픽스처 헬퍼를 그대로 재사용할 것.** 없으면 파일의 기존 픽스처 모양을 따라 만든다. `act`와 `screen`이 이미 import돼 있는지 확인하고, 없으면 추가한다.

- [ ] **Step 10: Confirm the reactivity test actually discriminates**

‼️ **정정 (Task 5 실행 중 실측, 2026-08-06).** 원래 지시는 "`selectManifest(s, pluginId)`를 `selectManifest(usePluginStore.getState(), pluginId)`로 바꿔라"였는데, 그것은 **판별하지 않는다** — 실제로 돌려보니 7개 테스트가 그대로 통과한다. zustand는 스토어 알림마다 셀렉터를 다시 실행하고, 그 시점에 `s`와 `getState()`는 같은 상태를 준다. 즉 구독을 없애는 것은 `getState()`를 쓰는 것이 아니라 **조회를 구독된 셀렉터 밖으로 옮기는 것**이다.

**올바른 재현**: 조회를 `useShallow` 셀렉터 **바깥**의 렌더 본문으로 옮긴다 — 즉 비반응 헬퍼를 잘못 쓰는 형태를 그대로 만든다:

```tsx
  // 일시적 — 판별 확인용
  const { persisted, setPluginSetting } = usePluginStore(useShallow((s) => ({ ... })));
  const manifest = selectManifest(usePluginStore.getState(), pluginId);  // 구독 밖
```

이 형태에서 Step 9의 테스트가 실패해야 한다("Old Field"가 "New Field"로 바뀌지 않는다). 그다음 되돌리고 `git diff`로 복원을 확인한다 — 이 환경에서 `cp`/`mv`는 `-i` 별칭이라 스크립트 복원이 조용히 실패할 수 있으니 Edit로 되돌릴 것.

‼️ **PR2 Task 11에 대한 함의**: 위험은 "`getState()`를 쓰는 것"이 아니라 **비반응 헬퍼를 구독 밖에서 부르는 것**이다. `manifestFor`를 렌더 본문에서 `const manifest = manifestFor(id)`로 부르면 정확히 이 회귀가 재현된다. Task 11의 유일한 정당한 사용처는 렌더가 아닌 판정 시점(`useCallback` 안)이며, 리뷰가 그것을 확인해야 한다.

- [ ] **Step 11: Commit**

```bash
git add src/components/plugins/PluginRow.tsx \
  src/components/plugins/__tests__/PluginRow.test.tsx \
  src/components/plugins/PluginSettingsForm.tsx \
  src/components/plugins/__tests__/PluginSettingsForm.test.tsx \
  src/plugins/plugin-sources.ts \
  src/plugins/__tests__/select-manifest.test.ts \
  src/styles/plugins.css src/i18n/en.json src/i18n/ko.json
git commit -m "feat(§69): one row component whose actions come from its source

Also fixes the call site the disabled-list design creates: PluginSettingsForm
resolved manifests from installedPlugins/devPlugins only, so a built-in's
declared-settings form was silently never rendered. selectManifest is a
SELECTOR, not a getState() read, so replacing a manifest — which a dev-plugin
reload does — still refreshes an open form."
```

---

## Task 6: `PluginInstalledList` 섹션 그룹

**Files:**
- Create: `src/components/plugins/PluginInstalledList.tsx`
- Modify: `src/styles/plugins.css` (append)
- Test: `src/components/plugins/__tests__/PluginInstalledList.test.tsx` (create)

‼️ **`plugin-marketplace-toggle.test.tsx`는 이 태스크가 건드리지 않는다** (정정, 2026-08-06). 앞선 초안이 이 목록에 넣었지만, `PluginInstalledList`는 이 태스크에서 `PluginMarketplace`에 배선되지 않으므로 그 테스트의 전역 checkbox 헬퍼는 아직 모호해지지 않는다. 스코핑은 배선하는 태스크(Task 7 Step 1)의 몫이다.

**Interfaces:**
- Consumes: Task 2의 `buildPluginRows`, Task 5의 `PluginRowView`
- Produces: `<PluginInstalledList rows={...} onToggle onRemove onUpdate onReload onDetails onSettings hasSettings={(id) => boolean} />`. 각 섹션은 `data-testid="plugin-section-{source}"`를 갖는다

- [ ] **Step 1: Write the failing test**

`src/components/plugins/__tests__/PluginInstalledList.test.tsx`:

```tsx
// §69 — 섹션 그룹. 단정은 섹션 안으로 스코핑한다: 전역 부재 단정은 같은 목록의 다른
// 섹션이 그 버튼을 갖고 있어서 결과가 뒤집힌다.
import type { PluginRow } from "../../../plugins/plugin-sources";
import type { PluginManifest } from "../../../plugins/types";

import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { PluginInstalledList } from "../PluginInstalledList";

function row(id: string, source: PluginRow["source"], over: Partial<PluginRow> = {}): PluginRow {
  return {
    enabled: true,
    manifest: {
      author: "T",
      capabilities: [],
      description: "d",
      engines: { baram: "*" },
      id,
      license: "MIT",
      main: "index.mjs",
      name: id,
      trust: "sandboxed",
      version: "1.0.0",
    } as PluginManifest,
    source,
    ...over,
  };
}

/** `hasSettings`/`onSettings`는 빼 둔다 — optional이고, PR1은 넘기지 않는다. */
const handlers = {
  onDetails: vi.fn(),
  onReload: vi.fn(),
  onRemove: vi.fn(),
  onToggle: vi.fn(),
  onUpdate: vi.fn(),
};

const ROWS = [
  row("bi", "builtin"),
  row("cm", "community", { updateVersion: "2.0.0" }),
  row("dv", "dev"),
];

describe("PluginInstalledList (§69)", () => {
  it("renders the sections in order: builtin, community, dev", () => {
    render(<PluginInstalledList rows={ROWS} {...handlers} />);
    // ‼️ `(?!count-)` 없이는 카운트 span의 `plugin-section-count-*` testid도 함께 잡힌다
    // — 카운트 모호성을 고치려 넣은 그 testid가 이 접두사 질의와 충돌한다 (Task 6 실측).
    const sections = screen.getAllByTestId(/^plugin-section-(?!count-)/);
    expect(sections.map((s) => s.dataset.testid)).toEqual([
      "plugin-section-builtin",
      "plugin-section-community",
      "plugin-section-dev",
    ]);
  });

  it("has no remove or update control INSIDE the built-in section", () => {
    // ‼️ 전역 queryByRole("button", {name:/remove/i}) 금지 — 커뮤니티 행이 갖고 있다.
    render(<PluginInstalledList rows={ROWS} {...handlers} />);
    const builtin = screen.getByTestId("plugin-section-builtin");
    expect(within(builtin).queryAllByRole("button", { name: /remove/i })).toHaveLength(0);
    expect(within(builtin).queryAllByRole("button", { name: /update/i })).toHaveLength(0);
    expect(within(builtin).getAllByRole("checkbox")).toHaveLength(1);
  });

  it("has exactly one remove and one update inside the community section", () => {
    render(<PluginInstalledList rows={ROWS} {...handlers} />);
    const community = screen.getByTestId("plugin-section-community");
    expect(within(community).getAllByRole("button", { name: /remove/i })).toHaveLength(1);
    expect(within(community).getAllByRole("button", { name: /update/i })).toHaveLength(1);
  });

  it("has no toggle inside the dev section", () => {
    render(<PluginInstalledList rows={ROWS} {...handlers} />);
    const dev = screen.getByTestId("plugin-section-dev");
    expect(within(dev).queryAllByRole("checkbox")).toHaveLength(0);
    expect(within(dev).getAllByRole("button", { name: /reload/i })).toHaveLength(1);
  });

  it("omits an empty builtin or community section", () => {
    render(<PluginInstalledList rows={[row("dv", "dev")]} {...handlers} />);
    expect(screen.queryByTestId("plugin-section-builtin")).toBeNull();
    expect(screen.queryByTestId("plugin-section-community")).toBeNull();
  });

  it("counts the rows in each section heading", () => {
    // ‼️ 카운트에는 자체 testid가 있다 (계획 수정, 2026-08-06). 앞선 초안은
    // `within(builtin).getByText(/1/)`이었는데, 섹션 안의 행이 `v1.0.0`을 포함하므로
    // 복수 매치로 던진다. 헤더 텍스트 전체를 보는 것도 안 된다 — textContent가
    // "▾Built-in1"로 붙어 `\b1\b`가 성립하지 않는다.
    render(<PluginInstalledList rows={ROWS} {...handlers} />);
    expect(
      screen.getByTestId("plugin-section-count-builtin").textContent,
    ).toBe("1");
    expect(
      screen.getByTestId("plugin-section-count-community").textContent,
    ).toBe("1");
  });

  it("shows no gear at all when the settings props are absent", () => {
    // ‼️ PR1의 상태 (사용자 결정 2026-08-06).
    render(<PluginInstalledList rows={ROWS} {...handlers} />);
    expect(screen.queryAllByRole("button", { name: /settings/i })).toHaveLength(0);
  });

  it("shows a gear only for the rows hasSettings admits", () => {
    render(
      <PluginInstalledList
        hasSettings={(id) => id === "cm"}
        onSettings={vi.fn()}
        rows={ROWS}
        {...handlers}
      />,
    );
    expect(
      within(screen.getByTestId("plugin-section-community")).getAllByRole(
        "button",
        { name: /settings/i },
      ),
    ).toHaveLength(1);
    expect(
      within(screen.getByTestId("plugin-section-builtin")).queryAllByRole(
        "button",
        { name: /settings/i },
      ),
    ).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run src/components/plugins/__tests__/PluginInstalledList.test.tsx > /tmp/t6.log 2>&1; echo $?
```

Expected: FAIL — 모듈 없음

- [ ] **Step 3: Write the component**

`src/components/plugins/PluginInstalledList.tsx`:

```tsx
// §69 — 하나의 목록 안에서 provenance로 그룹핑한다(JetBrains Bundled/Downloaded 방식).
// 탭을 늘리지 않으므로 좁은 사이드바와 넓은 설정 모달 양쪽에서 같은 구조가 동작한다.
import type { PluginRow, PluginSource } from "../../plugins/plugin-sources";

import { useState } from "react";

import { useTranslation } from "../../i18n/useTranslation";
import { PluginRowView } from "./PluginRow";

interface PluginInstalledListProps {
  /**
   * ‼️ 둘 다 OPTIONAL이며 함께 온다 (사용자 결정 2026-08-06). PR1에는 설정 페이지가 없어
   * 아무도 넘기지 않고, ⚙는 그려지지 않는다. `onSettings` 없이 `hasSettings`만 넘기는 것은
   * 의미가 없으므로 아래에서 두 값이 모두 있을 때만 행에 전달한다.
   */
  hasSettings?: (pluginId: string) => boolean;
  onDetails: (row: PluginRow) => void;
  onReload: (row: PluginRow) => void;
  onRemove: (row: PluginRow) => void;
  onSettings?: (row: PluginRow) => void;
  onToggle: (row: PluginRow) => void;
  onUpdate: (row: PluginRow) => void;
  rows: PluginRow[];
}

/** 표시 순서. `buildPluginRows`도 이 순서로 반환하지만, 표시는 표시가 정한다. */
const ORDER: PluginSource[] = ["builtin", "community", "dev"];

export function PluginInstalledList({
  hasSettings,
  onDetails,
  onReload,
  onRemove,
  onSettings,
  onToggle,
  onUpdate,
  rows,
}: PluginInstalledListProps) {
  const { t } = useTranslation();
  // 접기 상태는 영속화하지 않는다 — 영속 키를 하나 더 만들 값어치가 없다.
  const [collapsed, setCollapsed] = useState<Set<PluginSource>>(new Set());

  return (
    <>
      {ORDER.map((source) => {
        const group = rows.filter((r) => r.source === source);
        if (group.length === 0) return null;
        const isCollapsed = collapsed.has(source);
        return (
          <section
            className="plugin-section"
            data-testid={`plugin-section-${source}`}
            key={source}
          >
            <button
              aria-expanded={!isCollapsed}
              className="plugin-section__head btn-unstyled"
              onClick={() =>
                setCollapsed((cur) => {
                  const next = new Set(cur);
                  if (!next.delete(source)) next.add(source);
                  return next;
                })
              }
              type="button"
            >
              <span className="plugin-section__caret">
                {isCollapsed ? "▸" : "▾"}
              </span>
              <span className="plugin-section__title">
                {t(`plugin.section.${source}`)}
              </span>
              <span
                className="plugin-section__count"
                data-testid={`plugin-section-count-${source}`}
              >
                {group.length}
              </span>
            </button>
            {!isCollapsed &&
              group.map((r) => (
                <PluginRowView
                  key={r.manifest.id}
                  onDetails={() => onDetails(r)}
                  onReload={() => onReload(r)}
                  onRemove={() => onRemove(r)}
                  onSettings={
                    onSettings && hasSettings?.(r.manifest.id)
                      ? () => onSettings(r)
                      : undefined
                  }
                  onToggle={() => onToggle(r)}
                  onUpdate={() => onUpdate(r)}
                  row={r}
                />
              ))}
          </section>
        );
      })}
    </>
  );
}
```

- [ ] **Step 4: Add the section i18n keys and CSS**

en.json / ko.json 양쪽:

```json
  "plugin.section.builtin": "Built-in",
  "plugin.section.community": "Community",
  "plugin.section.dev": "In development",
```

```json
  "plugin.section.builtin": "내장",
  "plugin.section.community": "커뮤니티",
  "plugin.section.dev": "개발 중",
```

`src/styles/plugins.css` 끝에:

```css
/* §69 — 접이식 섹션 머리. `.btn-unstyled`는 base.css의 공유 유틸리티다. */
.plugin-section__head {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  padding: 8px 16px 4px;
  cursor: pointer;
  text-align: left;
}

.plugin-section__caret {
  font-size: 10px;
  color: var(--color-text-muted);
}

.plugin-section__title {
  font-size: 12px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--color-text-muted);
}

.plugin-section__count {
  font-size: 11px;
  color: var(--color-text-muted);
}
```

- [ ] **Step 5: Run test to verify it passes**

```bash
npx vitest run src/components/plugins/__tests__/PluginInstalledList.test.tsx > /tmp/t6.log 2>&1; echo $?
npm run audit:css-vars > /tmp/t6css.log 2>&1; echo $?
```

Expected: PASS (8 tests). audit은 exit 1이 정상(베이스라인 2건) — 목록에 `plugins.css` 항목이 없는지만 볼 것

- [ ] **Step 6: Commit**

```bash
git add src/components/plugins/PluginInstalledList.tsx \
  src/components/plugins/__tests__/PluginInstalledList.test.tsx \
  src/styles/plugins.css src/i18n/en.json src/i18n/ko.json
git commit -m "feat(§69): group the installed list by where the plugin came from"
```

---

## Task 7: 셸 축소 — `usePluginActions` 순수 이동

**Files:**
- Create: `src/components/plugins/usePluginActions.ts`
- Create: `src/components/plugins/PluginBrowseList.tsx`
- Modify: `src/components/plugins/PluginMarketplace.tsx` (전면 축소)
- Modify: `src/components/plugins/__tests__/plugin-marketplace-toggle.test.tsx:53-58`

**Interfaces:**
- Consumes: Task 2·5·6의 전부
- Produces: `usePluginActions()` → `{ handleInstall, handleUninstall, handleUpdate, handleToggleEnabled, handleToggleBuiltin, consentDialog }`

‼️ **이 태스크의 규칙: 로직은 순수 이동만.** `handleInstall`/`handleUpdate`/`handleUninstall`/`handleToggleEnabled`의 본문은 §260/#261 리뷰 6라운드가 쌓은 것이다(스테이징, consent 재검증, in-flight 가드, 언로드 복구). **한 줄도 고치지 말고 옮긴다.** 개선하고 싶은 것이 보이면 별도 커밋으로 남기고 이 태스크에서 하지 않는다.

- [ ] **Step 0: Widen three existing `ipc/plugin-invoke` mocks BEFORE touching the shell**

‼️ **이 단계를 건너뛰면 §260/#261 보안 테스트 3개가 "Task 7이 깨뜨린 것"처럼 보인다** (디스패치 전 실측, 2026-08-06). 이 태스크는 `usePluginActions`에 `plugin-lifecycle` import를 **새로** 만든다(`handleToggleBuiltin`이 `activateBuiltin`/`deactivateBuiltin`을 쓴다). 그런데 `plugin-lifecycle.ts`는 `../ipc/plugin-invoke`에서 `pluginListDev`, `pluginPrepareScopes`, `toInstalledDevPlugin`을 가져오고, 아래 세 테스트는 그 모듈을 **객체 리터럴**로 mock하며 `pluginInstallStage`/`pluginInstallCommit`/`pluginInstallDiscard`/`pluginUninstall`(+ 일부 `pluginFetchRevocations`)만 제공한다. 리터럴 mock은 그래프의 모든 importer에게 적용되므로 collection 시점에 "No pluginListDev export is defined on the mock"으로 죽는다 — Task 4가 맞았던 것과 같은 계열이다.

대상:
- `src/components/plugins/__tests__/plugin-install-consent.test.tsx:42`
- `src/components/plugins/__tests__/plugin-engines-gate.test.tsx:31`
- `src/components/plugins/__tests__/plugin-revoked-gates.test.tsx:21`

각각의 `vi.mock(".../ipc/plugin-invoke", () => ({ ... }))`를 `importOriginal` + spread로 바꾼다. **팩토리 안의 기존 항목은 한 글자도 바꾸지 말고 그대로 두고**, spread만 앞에 얹는다 — override가 spread 뒤에 와야 이긴다:

```tsx
vi.mock("../../../ipc/plugin-invoke", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../ipc/plugin-invoke")>()),
  // ↓ 기존 항목을 그대로 유지
  pluginInstallCommit: ...,
  pluginInstallDiscard: ...,
  pluginInstallStage: ...,
  pluginUninstall: ...,
}));
```

선례는 같은 디렉터리에 있다: `plugin-installed-detail-route.test.tsx:24`가 `ipc/invoke`에 이미 이 형태를 쓴다.

‼️ **assertion은 건드리지 않는다.** 이 태스크가 기존 테스트에서 바꿔도 되는 것은 (1) 이 세 mock 팩토리의 형태와 (2) Step 1의 모호한 질의 하나, 그 둘뿐이다. Step 5가 그 경계를 검사한다.

- [ ] **Step 1: Fix the ambiguous query in the existing toggle test FIRST**

내장이 Installed 탭에 렌더되면 체크박스가 2개가 되어 `screen.findByRole("checkbox")`가 "found multiple elements"로 던진다. 실측으로 이 파일이 유일한 모호 질의다. `src/components/plugins/__tests__/plugin-marketplace-toggle.test.tsx:53-58`을 바꾼다:

```tsx
/** Render, switch to the Installed tab, and return the demo plugin's enable toggle. */
async function installedToggle() {
  render(<PluginMarketplace />);
  fireEvent.click(screen.getByRole("button", { name: /^Installed / }));
  // §69 — 커뮤니티 섹션으로 스코핑한다. 내장(Media Viewer)도 이 탭에서 토글을 갖게 되어
  // 전역 `findByRole("checkbox")`는 모호하다.
  const community = await screen.findByTestId("plugin-section-community");
  return within(community).getByRole("checkbox");
}
```

`within`을 import에 추가한다: `import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";`

- [ ] **Step 2: Run the full plugin suite and record what fails**

```bash
npx vitest run src/components/plugins src/plugins > /tmp/t7base.log 2>&1; echo $?
grep -E "✓|×|FAIL" /tmp/t7base.log | tail -40
```

이 시점에는 아직 `PluginMarketplace`가 섹션을 렌더하지 않으므로 Step 1의 변경은 **실패한다**(testid 없음). 그것이 예상 상태다 — Step 4 이후 통과해야 한다. 다른 실패가 있으면 적어 두고 원인을 확인한다.

- [ ] **Step 3: Move the handlers into the hook**

`src/components/plugins/usePluginActions.ts`를 만들고, `PluginMarketplace.tsx`의 다음을 **본문 그대로** 옮긴다:

- `PendingConsent` 인터페이스
- `askConsent` / `settleConsent` / 언마운트 정리 effect
- `handleInstall` (477-749) · `handleUninstall` (759-772) · `handleUpdate` (774-858) · `handleToggleEnabled` (860-905)
- `consentDialog` JSX (910-919)
- 모듈 하단의 `currentAppVersion` · `floorRefusal` · `getPluginStatus`
- `inFlight` / `togglingRef` ref

훅은 `registryIndex`를 인자로 받아야 한다(`handleUpdate`가 리스팅을 재해석하는 데 쓴다):

```ts
export function usePluginActions(registryIndex: null | RegistryIndex) { ... }
```

그리고 내장 토글을 **새로** 추가한다 (이것만 신규 로직):

```ts
  /**
   * §69 — 내장 토글. 커뮤니티 토글과 같은 형태(스토어 먼저, 그다음 런타임)이지만
   * 로더를 거치지 않는다: 내장은 디스크에 없고 `activateBuiltin`/`deactivateBuiltin`이
   * 그 수명을 소유한다.
   */
  const handleToggleBuiltin = useCallback(
    (id: string, nextEnabled: boolean) => {
      if (togglingRef.current.has(id)) return;
      togglingRef.current.add(id);
      setBuiltinEnabled(id, nextEnabled);
      const run = nextEnabled ? activateBuiltin(id) : deactivateBuiltin(id);
      void run
        .then(
          () => setError(id, null),
          (err: unknown) => {
            setError(id, String(err));
            setBuiltinEnabled(id, !nextEnabled);
          },
        )
        .finally(() => togglingRef.current.delete(id));
    },
    [setBuiltinEnabled, setError],
  );
```

- [ ] **Step 4: Rewrite the shell**

`PluginMarketplace.tsx`를 셸만 남긴다: 탭 상태, 검색, 폐기 목록 안내문(1018-1042 그대로), 상세 라우팅, 그리고 세 탭의 렌더를 `PluginBrowseList` / `PluginInstalledList` / 업데이트 목록에 위임. Installed 탭은:

```tsx
        {activeTab === "installed" &&
          (rows.length === 0 ? (
            <div className="plugin-marketplace__empty">
              {t("plugin.marketplace.emptyInstalled")}
            </div>
          ) : (
            <PluginInstalledList
              onDetails={(r) => setSelectedEntry(entryFromRow(r))}
              onRemove={(r) => void handleUninstall(r.manifest.id)}
              onToggle={(r) =>
                r.source === "builtin"
                  ? handleToggleBuiltin(r.manifest.id, !r.enabled)
                  : handleToggleEnabled(r.manifest.id)
              }
              onUpdate={(r) => void handleUpdate(entryFromRow(r))}
              rows={rows}
            />
          ))}
```

`rows`는 `buildPluginRows`로 만든다:

```tsx
  const rows = buildPluginRows({
    builtinDisabled,
    builtins: BUILTIN_PLUGINS,
    devPlugins,
    installedPlugins,
    pluginErrors,
    revocations,
    updateAvailable,
  });
```

`entryFromRow(r)`는 기존 Installed 탭의 합성 로직(1108-1113)을 함수로 뺀 것이다:

```tsx
/** 설치된 매니페스트로부터 상세 화면이 읽는 모양을 합성한다. `downloadUrl`은 비어
 *  있고, `handleUpdate`가 리스팅을 재해석하므로 그것을 신뢰하지 않는다. */
function entryFromRow(row: PluginRow): RegistryEntry {
  return {
    ...row.manifest,
    checksum: row.installed?.checksum ?? "",
    downloadUrl: "",
    downloads: undefined,
  };
}
```

‼️ **설정 관련 prop을 아예 넘기지 않는다** (사용자 결정 2026-08-06). `hasSettings`/`onSettings`는 optional이므로 부재가 곧 "⚙ 없음"이고, PR2 Task 11이 두 prop을 추가하기만 하면 된다. 앞선 초안은 `hasSettings={() => false}`와 no-op `onSettings`를 넘기게 했는데, 그것은 이 작업이 §1-4에서 지적하는 결함 그 자체였다 — Updates 탭의 `onInstall={() => {}}`. **부재를 no-op으로 위장하지 않는다.**

‼️ **죽은 `STYLES` 항목 16개를 삭제한다** (디스패치 전 실측, 2026-08-06). Installed 탭의 마크업이 `PluginInstalledList`로 옮겨가면 셸의 `STYLES` 객체(30개 키) 중 다음 **16개**가 아무도 참조하지 않게 된다. **`noUnusedLocals`는 이것을 잡지 못한다** — 여전히 쓰이는 객체의 속성이라서다. 그러니 손으로 지운다:

`installedRow` · `installedRowInner` · `installedRowInfo` · `installedRowNameRow` · `installedPluginName` · `installedPluginVersion` · `installedPluginError` · `installedPluginErrorText` · `installedPluginDescription` · `installedRowActions` · `updateButton` · `toggleLabel` · `toggleCheckbox` · `toggleText` · `removeButton` · `detailsButton`

삭제 후 `grep -n "STYLES\." src/components/plugins/PluginMarketplace.tsx`로 남은 참조가 위 16개를 하나도 가리키지 않음을 확인한다.

**남는 14개(셸 크롬 — `container`, `header`, `title`, `tabBar`, `searchInput`, `content`, `centeredMessage`, `errorMessage`, `errorSubtext`, `retryButton`, `loadingMessage`, `tabButtonActive`, `tabButtonInactive`, `refreshButton`)는 인라인으로 그대로 둔다.** 이것들을 CSS로 옮기는 것은 의도적으로 미룬다: 이 태스크의 리뷰 대상은 §260/#261 보안 로직이 의미상 동일하게 이동했는지이고, 같은 커밋에서 셸 스타일까지 마이그레이션하면 그 판정이 흐려진다. Task 12 Step 7이 백로그에 남긴다. `PluginCard.tsx`의 인라인 스타일도 같은 이유로 손대지 않는다(Browse 탭이 계속 쓴다).

‼️ **`onReload`도 optional로 만든다 — `onSettings`와 같은 이유다** (디스패치 전 실측, 2026-08-06).

PR1에서는 dev 섹션의 다시 로드를 `PluginDeveloperSection`이 계속 담당하므로, `rows`에서 dev를 제외하고(`devPlugins: {}`) 그 컴포넌트를 셸 하단에 그대로 유지한다. dev 통합은 범위 밖이고 `dev/backlog.md`에 남긴다.

그런데 그러면 **dev 섹션이 렌더되지 않으므로 `onReload`는 절대 호출되지 않는다.** Task 5·6이 그것을 필수 prop으로 만들어 뒀으니, 셸은 부를 수 없는 핸들러를 넘겨야 한다 — §1-4가 지적하는 죽은 콜백 그 자체다. `onSettings`에 적용한 원칙을 여기에도 적용한다:

1. `src/components/plugins/PluginRow.tsx` — `onReload: () => void;`를 `onReload?: () => void;`로 바꾸고, 렌더 조건을 `{can.canReload && (`에서 `{can.canReload && onReload && (`로 바꾼다. `actionsFor`는 여전히 액션 세트의 유일한 결정자이며, 이것은 "그 액션을 배선했는가"라는 별개 질문이다 — `onSettings`가 이미 같은 형태다.
2. `src/components/plugins/PluginInstalledList.tsx` — `onReload: (row: PluginRow) => void;`를 optional로 바꾸고, 행에 넘길 때 `onReload={onReload ? () => onReload(r) : undefined}`로 바꾼다.
3. 두 컴포넌트의 기존 테스트는 `onReload`를 계속 넘기므로 **그대로 통과해야 한다** — dev 행의 다시 로드 버튼을 검사하는 케이스가 깨지면 1번의 조건을 잘못 쓴 것이다.
4. 셸은 `onReload`를 **넘기지 않는다.**

이로써 PR1의 `PluginInstalledList` 호출부에는 부를 수 없는 콜백이 하나도 남지 않는다.

따라서 `rows`는 dev를 뺀다:

```tsx
    devPlugins: {},   // dev 섹션은 아직 PluginDeveloperSection이 담당한다 (backlog)
```

- [ ] **Step 5: Run the full suite**

```bash
npx vitest run > /tmp/t7.log 2>&1; echo $?
grep -E "Tests|Test Files" /tmp/t7.log
```

Expected: 전부 PASS. §260/#261 테스트(`plugin-install-consent`, `plugin-engines-gate`, `plugin-revoked-gates`, `plugin-installed-detail-route`, `installed-error-text`, `legacy-install-upgrade`)의 **assertion이 하나도 바뀌지 않았어야 한다**. 바뀌었다면 리팩터가 아니라 동작 변경이다 — 되돌리고 원인을 찾는다.

‼️ `installed-error-text.test.tsx:135`가 `queryByText(/^⚠/)).not.toBeInTheDocument()`로 **전역 부재**를 단정한다. Media Viewer가 오류를 갖지 않으므로 통과해야 하지만, 통과를 가정하지 말고 로그에서 이 파일을 확인한다.

- [ ] **Step 6: Typecheck and knip**

```bash
npm run typecheck > /tmp/t7tc.log 2>&1; echo $?
npx knip > /tmp/t7knip.log 2>&1; echo $?
tail -20 /tmp/t7knip.log
```

Expected: 둘 다 exit 0. knip이 `PluginCard`를 unused로 잡으면 Browse 탭이 아직 그것을 쓰는지 확인한다(써야 한다).

- [ ] **Step 7: Check the file sizes**

```bash
wc -l src/components/plugins/*.tsx src/components/plugins/*.ts src/styles/plugins.css | sort -rn | head
```

Expected: `PluginMarketplace.tsx`가 ~200줄 이하, `usePluginActions.ts`가 ~500줄 이하, `plugins.css`가 1,500줄 이하.

- [ ] **Step 8: Commit**

```bash
git add -A src/components/plugins src/plugins
git commit -m "refactor(§69): split the 1,309-line marketplace into a shell and a hook

The install/update/uninstall/toggle bodies moved VERBATIM — they are what six
review rounds of §260/#261 produced. The §260/#261 tests pass unchanged, which
is the gate on that claim."
```

---

## Task 8: 내장을 껐을 때의 안내 문구

**Files:**
- Modify: `src/i18n/en.json:516`, `src/i18n/ko.json:516`
- Test: `src/plugins/__tests__/builtin-viewer-handoff.test.ts` (create)

**Interfaces:**
- Consumes: Task 4의 `deactivateBuiltin`
- Produces: 없음

- [ ] **Step 1: Write the failing test — the community viewer can finally win**

`src/plugins/__tests__/builtin-viewer-handoff.test.ts`:

```ts
// §69 — 이 작업의 실제 사용자 가치. `matchFileViewer`는 먼저 등록된 뷰어를 택하고 내장은
// 설치 플러그인보다 먼저 로드되므로, 내장이 잡은 확장자는 그것을 끄지 않는 한 커뮤니티
// 뷰어가 절대 가져올 수 없었다.
import { beforeEach, describe, expect, it } from "vitest";

import { usePluginStore } from "../../stores/system/plugin";
import { matchFileViewer, usePluginUIStore } from "../plugin-ui-store";
import { deactivateBuiltin, loadBuiltinPlugins } from "../plugin-lifecycle";
import { shutdownBuiltinPlugins } from "../plugin-lifecycle";

describe("built-in viewer hand-off (§69)", () => {
  beforeEach(async () => {
    await shutdownBuiltinPlugins();
    usePluginUIStore.setState({ fileViewers: [] });
    usePluginStore.setState({ builtinDisabled: [] });
  });

  it("the built-in claims png while it is enabled", async () => {
    await loadBuiltinPlugins();
    const viewer = matchFileViewer(
      usePluginUIStore.getState().fileViewers,
      "/x/a.png",
    );
    expect(viewer?.pluginId).toBe("baram-media-viewer");
  });

  it("no viewer claims png once the built-in is deactivated", async () => {
    await loadBuiltinPlugins();
    await deactivateBuiltin("baram-media-viewer");
    expect(
      matchFileViewer(usePluginUIStore.getState().fileViewers, "/x/a.png"),
    ).toBeNull();
  });

  it("a community viewer wins png after the built-in is deactivated", async () => {
    await loadBuiltinPlugins();
    await deactivateBuiltin("baram-media-viewer");
    usePluginUIStore.getState().registerFileViewer({
      extensions: ["png"],
      onMount: () => {},
      pluginId: "third-party",
      viewerId: "third-party:img",
    });
    expect(
      matchFileViewer(usePluginUIStore.getState().fileViewers, "/x/a.png")
        ?.pluginId,
    ).toBe("third-party");
  });
});
```

- [ ] **Step 2: Run it**

```bash
npx vitest run src/plugins/__tests__/builtin-viewer-handoff.test.ts > /tmp/t8.log 2>&1; echo $?
tail -20 /tmp/t8.log
```

Task 4가 끝났으므로 통과할 것으로 예상한다. 실패하면 `registerFileViewer`가 요구하는 필드를 로그에서 확인해 픽스처를 맞춘다(`PluginFileViewer`는 `extensions`, `onMount`, `pluginId`, `viewerId`를 요구하고 `onUnmount`/`onUpdate`는 선택이다).

- [ ] **Step 3: Improve the no-viewer message**

`src/i18n/en.json:516`:

```json
  "viewer.noPlugin": "No viewer plugin is enabled for this file type. You can turn one on in Settings → Plugins.",
```

`src/i18n/ko.json:516`:

```json
  "viewer.noPlugin": "이 파일 형식을 표시할 뷰어 플러그인이 활성화되어 있지 않습니다. 설정 → 플러그인에서 켤 수 있습니다.",
```

- [ ] **Step 4: Verify the i18n key sets still match**

```bash
node -e "const a=require('./src/i18n/en.json'),b=require('./src/i18n/ko.json');const ka=Object.keys(a).sort(),kb=Object.keys(b).sort();const miss=ka.filter(k=>!(k in b)).concat(kb.filter(k=>!(k in a)));console.log(miss.length?'MISMATCH: '+miss.join(', '):'keys match ('+ka.length+')')"
```

Expected: `keys match (N)`

- [ ] **Step 5: Run everything**

```bash
npm test > /tmp/t8full.log 2>&1; echo $?
grep -E "Tests|Test Files" /tmp/t8full.log
npm run typecheck > /tmp/t8tc.log 2>&1; echo $?
```

Expected: 전부 PASS, typecheck exit 0

- [ ] **Step 6: Commit and open the PR**

```bash
git add src/i18n/en.json src/i18n/ko.json src/plugins/__tests__/builtin-viewer-handoff.test.ts
git commit -m "test(§69): pin the hand-off a built-in toggle exists to allow

And say where to turn a viewer back on — the message named the state without
naming the remedy, which reads as a broken app."
```

PR을 열기 전에 브라우저에서 육안 확인한다 (R4 — CSS 이관의 시각적 회귀는 테스트로 안 잡힌다):

```bash
npm run tauri dev
```

확인 항목: 사이드바 플러그인 패널의 섹션·행이 280px에서 깨지지 않는지, 설정 창의 같은 패널이 넓은 폭에서 정상인지, 내장 토글을 껐다 켜는 동작, PNG 파일을 열었을 때의 안내 문구.

푸시는 백그라운드로 (pre-push가 clippy + knip을 돌린다):

```bash
git push -u origin feature/plugin-management-ui-sections
```

---

# PR2 — 설정 단일화

브랜치: `feature/plugin-settings-unification` (PR1 머지 후 main에서 분기)

## Task 9: `openSettings`와 `activePluginSettings`

**Files:**
- Modify: `src/stores/ui/ui.ts` (인터페이스 ~107·127, 초기 상태 ~159, 액션 ~214)
- Test: `src/stores/__tests__/ui-plugin-settings-route.test.ts` (create)

**Interfaces:**
- Consumes: 없음
- Produces: `openSettings(): void`, `activePluginSettings: null | string`, `setActivePluginSettings(pluginId: null | string): void`

- [ ] **Step 1: Write the failing test**

`src/stores/__tests__/ui-plugin-settings-route.test.ts`:

```ts
// §69 — 사이드바의 ⚙가 설정 창을 열어야 한다. `toggleSettings`만 있으면 이미 열린 창을
// 닫는다 — 그것이 이 액션이 별도로 존재하는 이유다.
import { beforeEach, describe, expect, it } from "vitest";

import { useUIStore } from "../ui/ui";

describe("plugin settings routing (§69)", () => {
  beforeEach(() => {
    useUIStore.setState({ activePluginSettings: null, settingsOpen: false });
  });

  it("openSettings opens a closed settings window", () => {
    useUIStore.getState().openSettings();
    expect(useUIStore.getState().settingsOpen).toBe(true);
  });

  it("openSettings leaves an already-open window open", () => {
    // ‼️ `toggleSettings`를 재사용하면 이 케이스가 창을 닫는다.
    useUIStore.setState({ settingsOpen: true });
    useUIStore.getState().openSettings();
    expect(useUIStore.getState().settingsOpen).toBe(true);
  });

  it("toggleSettings still toggles", () => {
    useUIStore.getState().toggleSettings();
    expect(useUIStore.getState().settingsOpen).toBe(true);
    useUIStore.getState().toggleSettings();
    expect(useUIStore.getState().settingsOpen).toBe(false);
  });

  it("records and clears the targeted plugin", () => {
    useUIStore.getState().setActivePluginSettings("demo");
    expect(useUIStore.getState().activePluginSettings).toBe("demo");
    useUIStore.getState().setActivePluginSettings(null);
    expect(useUIStore.getState().activePluginSettings).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run src/stores/__tests__/ui-plugin-settings-route.test.ts > /tmp/t9.log 2>&1; echo $?
```

Expected: FAIL — `openSettings is not a function`

- [ ] **Step 3: Add the state and actions**

`src/stores/ui/ui.ts` 인터페이스에:

```ts
  /**
   * §69 — 설정 창이 보여줄 플러그인의 id, 또는 null.
   *
   * ‼️ pluginId 기준이며 tabId 기준이 아니다. 선언 필드만 가진 플러그인 — 즉 대부분 — 은
   * 등록 탭이 없어 tabId로 가리킬 수 없다.
   *
   * ‼️ 영속화하지 않는다. 삭제된 플러그인의 id가 디스크에 남으면 다음 실행에서 빈 페이지로
   * 열린다.
   */
  activePluginSettings: null | string;
```

그리고 `openSettings: () => void;`, `setActivePluginSettings: (pluginId: null | string) => void;`. 초기 상태에 `activePluginSettings: null,`. 액션:

```ts
  /**
   * §69 — 여는 것만 한다. `toggleSettings`와 별개인 이유: 사이드바의 ⚙가 토글을 쓰면
   * 설정 창이 이미 열려 있을 때 그것을 닫는다.
   */
  openSettings: () => set({ settingsOpen: true }),
  setActivePluginSettings: (pluginId) =>
    set({ activePluginSettings: pluginId }),
```

`persist`를 쓰는 스토어라면 `partialize`에 `activePluginSettings`를 **넣지 않는다**. `ui.ts`가 무엇을 영속화하는지 확인할 것:

```bash
grep -n "partialize" -A 25 src/stores/ui/ui.ts | head -35
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx vitest run src/stores/__tests__/ui-plugin-settings-route.test.ts > /tmp/t9.log 2>&1; echo $?
```

Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add src/stores/ui/ui.ts src/stores/__tests__/ui-plugin-settings-route.test.ts
git commit -m "feat(§69): route to a plugin's settings page by plugin id

openSettings() is separate from toggleSettings() because a gear button in the
sidebar that toggles would close an already-open settings window."
```

---

## Task 10: `PluginSettingsPage`와 좌측 내비 기준

**Files:**
- Create: `src/components/settings/PluginSettingsPage.tsx`
- Modify: `src/components/settings/SettingsModal.tsx:42-55, 128-142, 155-158`
- Test: `src/components/settings/__tests__/PluginSettingsPage.test.tsx` (create)

**Interfaces:**
- Consumes: Task 9의 `activePluginSettings`, Task 5의 `selectManifest`
- Produces: `<PluginSettingsPage pluginId={...} />`, 그리고 `pluginsWithSettings(): {id, name}[]` (내비가 쓴다)

- [ ] **Step 1: Write the failing test**

`src/components/settings/__tests__/PluginSettingsPage.test.tsx`:

```tsx
// §69 — 한 플러그인의 설정이 한 페이지에 모인다: 선언 필드(앱이 그림)와 등록 탭
// (플러그인이 그림). 그전에는 선언 필드가 세 곳에, 등록 탭이 설정 창에만 있었다.
import type { InstalledPlugin } from "../../../plugins/types";

import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import { usePluginUIStore } from "../../../plugins/plugin-ui-store";
import { usePluginStore } from "../../../stores/system/plugin";
import { PluginSettingsPage } from "../PluginSettingsPage";

const withFields = {
  checksum: "c",
  enabled: true,
  installedAt: 0,
  installPath: "/p/demo",
  manifest: {
    author: "T",
    capabilities: ["settings"],
    contributions: {
      settings: [
        { default: "a", key: "mode", label: "Mode", type: "string" },
      ],
    },
    description: "d",
    engines: { baram: "*" },
    id: "demo",
    license: "MIT",
    main: "index.mjs",
    name: "Demo",
    trust: "sandboxed",
    version: "1.0.0",
  },
  updatedAt: 0,
} as unknown as InstalledPlugin;

describe("PluginSettingsPage (§69)", () => {
  beforeEach(() => {
    usePluginStore.setState({
      installedPlugins: { demo: withFields },
      pluginSettings: {},
    });
    usePluginUIStore.setState({ settingsTabs: [] });
  });

  it("renders the plugin's declared fields", () => {
    render(<PluginSettingsPage pluginId="demo" />);
    expect(screen.getByText("Mode")).toBeTruthy();
  });

  it("renders the declared fields of a BUILT-IN too", () => {
    // ‼️ §5.2 — 내장은 `installedPlugins`에 없다. `selectManifest`가 세 출처를 다 보지
    // 않으면 이 페이지는 조용히 비어 있게 된다.
    usePluginStore.setState({ installedPlugins: {} });
    render(<PluginSettingsPage pluginId="baram-media-viewer" />);
    expect(screen.getByText(/Media Viewer/)).toBeTruthy();
  });

  it("renders every settings tab the plugin registered", () => {
    // `addSettingsTab`은 `${pluginId}:${id}`로 push하므로 한 플러그인이 여러 개를 등록한다.
    usePluginUIStore.setState({
      settingsTabs: [
        { onMount: () => {}, pluginId: "demo", tabId: "demo:one", title: "One" },
        { onMount: () => {}, pluginId: "demo", tabId: "demo:two", title: "Two" },
      ],
    });
    render(<PluginSettingsPage pluginId="demo" />);
    expect(screen.getByText("One")).toBeTruthy();
    expect(screen.getByText("Two")).toBeTruthy();
  });

  it("ignores another plugin's tabs", () => {
    usePluginUIStore.setState({
      settingsTabs: [
        { onMount: () => {}, pluginId: "other", tabId: "other:x", title: "Nope" },
      ],
    });
    render(<PluginSettingsPage pluginId="demo" />);
    expect(screen.queryByText("Nope")).toBeNull();
  });

  it("keeps the declared fields when the plugin is disabled", () => {
    // 비활성화는 등록 탭을 걷어내지만(unregisterPluginUI) 선언 필드의 값은 앱이 소유한다.
    // 껐다고 값을 잃으면 안 된다.
    usePluginStore.setState({
      installedPlugins: { demo: { ...withFields, enabled: false } },
    });
    usePluginUIStore.setState({ settingsTabs: [] });
    render(<PluginSettingsPage pluginId="demo" />);
    expect(screen.getByText("Mode")).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run src/components/settings/__tests__/PluginSettingsPage.test.tsx > /tmp/t10.log 2>&1; echo $?
```

Expected: FAIL — 모듈 없음

- [ ] **Step 3: Write the page**

`src/components/settings/PluginSettingsPage.tsx`:

```tsx
// §69 — 한 플러그인의 설정이 사는 단일 장소. 선언 필드와 등록 탭을 위·아래로 합친다.
import { useShallow } from "zustand/shallow";

import { selectManifest } from "../../plugins/plugin-sources";
import { usePluginUIStore } from "../../plugins/plugin-ui-store";
import { usePluginStore } from "../../stores/system/plugin";
import { PluginSettingsForm } from "../plugins/PluginSettingsForm";
import { PluginSettingsTabHost } from "./PluginSettingsTabHost";

export function PluginSettingsPage({ pluginId }: { pluginId: string }) {
  // ‼️ `selectManifest`이며 `installedPlugins[id]`가 아니다 — 내장은 그 맵에 없다 (§5.2).
  // 셀렉터 안에서 부르므로 구독이 유지된다: 커뮤니티 플러그인 업데이트가 매니페스트를
  // 교체하면 열려 있는 이 페이지가 새 필드를 반영한다 (Task 5 Step 7 참조).
  const manifest = usePluginStore(
    useShallow((s) => selectManifest(s, pluginId)),
  );
  const tabIds = usePluginUIStore(
    useShallow((s) =>
      s.settingsTabs.filter((t) => t.pluginId === pluginId).map((t) => t.tabId),
    ),
  );
  if (!manifest) return null;
  return (
    <div className="plugin-settings-page">
      <h3 className="settings-section-title">{manifest.name}</h3>
      <p className="settings-section-desc">{manifest.description}</p>
      <PluginSettingsForm pluginId={pluginId} />
      {tabIds.map((tabId) => (
        <PluginSettingsTabHost key={tabId} tabId={tabId} />
      ))}
    </div>
  );
}
```

`PluginSettingsTabHost`가 탭 제목을 렌더하지 않으면 이 페이지에서 제목을 그린다 — Step 2의 로그를 보고 확인할 것. 렌더하지 않는다면 `tabIds` 대신 탭 객체를 매핑해 `<h4>{tab.title}</h4>`를 위에 둔다.

- [ ] **Step 4: Rewire the SettingsModal nav**

`SettingsModal.tsx`에서:

- `useState<null | string>(null)`의 `activePluginTab`을 삭제하고 UI 스토어의 `activePluginSettings`/`setActivePluginSettings`를 쓴다 (`useShallow` 셀렉터로).
- 좌측 내비의 플러그인 그룹 나열 기준을 바꾼다 — 등록 탭이 있는 것만이 아니라 **설정 UI를 가진 모든 플러그인**:

```tsx
  // §69 — 등록 탭이 있는 것만 나열하던 목록. 선언 필드만 가진 플러그인(대부분)이
  // 내비에 없었고, 내장은 어느 쪽으로도 나타나지 않았다.
  const settingsTabs = usePluginUIStore(useShallow((s) => s.settingsTabs));
  const { builtinDisabled, devPlugins, installedPlugins } = usePluginStore(
    useShallow((s) => ({
      builtinDisabled: s.builtinDisabled,
      devPlugins: s.devPlugins,
      installedPlugins: s.installedPlugins,
    })),
  );
  const pluginPages = buildPluginRows({
    builtinDisabled,
    builtins: BUILTIN_PLUGINS,
    devPlugins,
    installedPlugins,
    pluginErrors: {},
    revocations: null,
    updateAvailable: {},
  })
    .filter(
      (r) =>
        declaredSettingsFor(r.manifest).length > 0 ||
        settingsTabs.some((t) => t.pluginId === r.manifest.id),
    )
    .map((r) => ({ id: r.manifest.id, name: r.manifest.name }));
```

- 내비 렌더를 `pluginPages`로 바꾸고 `onClick={() => setActivePluginSettings(page.id)}`.
- 콘텐츠 분기를 `activePluginSettings ? <PluginSettingsPage pluginId={activePluginSettings} /> : ...`로 바꾼다.
- 정리 effect(50-55)를 pluginId 기준으로 바꾼다:

```tsx
  // §69 — 가리키던 플러그인이 사라지면(삭제, 또는 dev 폴더 제거) 초기화한다.
  // ‼️ 비활성화는 사유가 아니다: 등록 탭은 걷히지만 선언 필드의 값은 앱이 소유하므로
  // 페이지는 남아야 한다.
  useEffect(() => {
    if (
      activePluginSettings &&
      !pluginPages.some((p) => p.id === activePluginSettings)
    ) {
      setActivePluginSettings(null);
    }
  }, [pluginPages, activePluginSettings, setActivePluginSettings]);
```

- [ ] **Step 5: Run the tests**

```bash
npx vitest run src/components/settings > /tmp/t10b.log 2>&1; echo $?
tail -25 /tmp/t10b.log
```

Expected: PASS. `PluginSettingsTabHost.test.tsx`와 기존 SettingsModal 테스트가 회귀하지 않아야 한다.

- [ ] **Step 6: Commit**

```bash
git add src/components/settings/PluginSettingsPage.tsx \
  src/components/settings/__tests__/PluginSettingsPage.test.tsx \
  src/components/settings/SettingsModal.tsx
git commit -m "feat(§69): one settings page per plugin, listed by having settings

The nav listed only plugins that registered a tab, so a plugin with declared
fields — most of them — was absent, and a built-in appeared under neither."
```

---

## Task 11: ⚙ 라우팅과 인라인 폼 3곳 제거

**Files:**
- Modify: `src/components/plugins/PluginMarketplace.tsx` (`hasSettings`/`onSettings` 채우기, 인라인 폼 제거)
- Modify: `src/components/plugins/PluginDetail.tsx:333` (인라인 폼 제거 → 설정 열기 버튼)
- Modify: `src/components/plugins/PluginDeveloperSection.tsx:206` (인라인 폼 제거 → 설정 열기 버튼)
- Test: `src/components/plugins/__tests__/plugin-settings-routing.test.tsx` (create)

**Interfaces:**
- Consumes: Task 9·10
- Produces: 없음

- [ ] **Step 1: Write the failing test**

`src/components/plugins/__tests__/plugin-settings-routing.test.tsx`:

```tsx
// §69 — 목록은 런처다. ⚙는 설정 창의 그 플러그인 페이지로 보낸다.
import type { InstalledPlugin, RegistryIndex } from "../../../plugins/types";

import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../plugins/plugin-loader", () => ({
  pluginLoader: { loadPlugin: vi.fn(), unloadPlugin: vi.fn() },
}));
vi.mock("../../../plugins/registry-client", () => ({
  checkForUpdates: () => Promise.resolve({}),
  fetchRegistryIndex: () => Promise.resolve({ plugins: [] } satisfies RegistryIndex),
  searchRegistry: () => [],
}));

import { usePluginStore } from "../../../stores/system/plugin";
import { useUIStore } from "../../../stores/ui/ui";
import { PluginMarketplace } from "../PluginMarketplace";

const withFields = {
  checksum: "c",
  enabled: true,
  installedAt: 0,
  installPath: "/p/demo",
  manifest: {
    author: "T",
    capabilities: ["settings"],
    contributions: {
      settings: [{ default: "a", key: "mode", label: "Mode", type: "string" }],
    },
    description: "d",
    engines: { baram: "*" },
    id: "demo",
    license: "MIT",
    main: "index.mjs",
    name: "Demo",
    trust: "sandboxed",
    version: "1.0.0",
  },
  updatedAt: 0,
} as unknown as InstalledPlugin;

const noFields = {
  ...withFields,
  installPath: "/p/plain",
  manifest: { ...withFields.manifest, capabilities: [], contributions: undefined, id: "plain", name: "Plain" },
} as unknown as InstalledPlugin;

async function installedSection() {
  render(<PluginMarketplace />);
  fireEvent.click(screen.getByRole("button", { name: /^Installed / }));
  return await screen.findByTestId("plugin-section-community");
}

describe("settings routing from the list (§69)", () => {
  beforeEach(() => {
    usePluginStore.setState({
      installedPlugins: { demo: withFields },
      pluginErrors: {},
      pluginSettings: {},
      updateAvailable: {},
    });
    useUIStore.setState({ activePluginSettings: null, settingsOpen: false });
  });

  it("opens the settings window at that plugin", async () => {
    const section = await installedSection();
    fireEvent.click(within(section).getByRole("button", { name: /Settings for Demo/i }));
    expect(useUIStore.getState().activePluginSettings).toBe("demo");
    expect(useUIStore.getState().settingsOpen).toBe(true);
  });

  it("leaves an already-open settings window open", async () => {
    // ‼️ `toggleSettings`를 쓰면 여기서 창이 닫힌다.
    useUIStore.setState({ settingsOpen: true });
    const section = await installedSection();
    fireEvent.click(within(section).getByRole("button", { name: /Settings for Demo/i }));
    expect(useUIStore.getState().settingsOpen).toBe(true);
  });

  it("shows no gear for a plugin with no settings UI", async () => {
    usePluginStore.setState({ installedPlugins: { plain: noFields } });
    const section = await installedSection();
    expect(within(section).queryAllByRole("button", { name: /Settings for/i })).toHaveLength(0);
  });

  it("no longer renders the settings form inline in the list", async () => {
    // 단일화의 요점: 목록은 런처이고 폼은 설정 창에만 있다.
    const section = await installedSection();
    expect(within(section).queryByText("Mode")).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run src/components/plugins/__tests__/plugin-settings-routing.test.tsx > /tmp/t11.log 2>&1; echo $?
```

Expected: FAIL — `hasSettings`가 아직 `() => false`이므로 ⚙ 버튼이 없다

- [ ] **Step 3: Wire the gear**

먼저 `src/plugins/plugin-sources.ts`에 비반응 래퍼를 추가한다 — Task 5가 만든 `selectManifest`를 감싸는 3줄이고, 아래 `hasSettingsUI`가 그 첫 소비처다:

```ts
/**
 * `selectManifest`의 비반응 래퍼. 렌더가 아니라 이벤트/판정 시점에 한 번 읽는 곳에서 쓴다.
 *
 * ‼️ 컴포넌트 안에서 이것을 쓰지 말 것 — 구독이 없으므로 매니페스트가 교체돼도 재렌더되지
 * 않는다. 렌더 경로는 `useShallow((s) => selectManifest(s, id))`를 쓴다.
 */
export function manifestFor(pluginId: string): PluginManifest | undefined {
  return selectManifest(usePluginStore.getState(), pluginId);
}
```

`import { usePluginStore } from "../stores/system/plugin";`를 추가한다(Task 5는 셀렉터만 만들었으므로 이 파일에 아직 없다).

그다음 `PluginMarketplace.tsx`에서 Task 7이 넘기지 않았던 두 prop을 채운다:

```tsx
  const { openSettings, setActivePluginSettings } = useUIStore(
    useShallow((s) => ({
      openSettings: s.openSettings,
      setActivePluginSettings: s.setActivePluginSettings,
    })),
  );

  // §69 — 목록은 런처다. 판정은 좌측 내비와 같은 식을 쓴다: 두 곳이 다른 답을 내면
  // "⚙를 눌렀는데 빈 페이지"가 된다.
  //
  // ‼️ 여기가 `manifestFor`(비반응 래퍼)의 유일한 정당한 소비처다. 렌더가 아니라 판정
  // 시점에 한 번 읽으므로 구독이 필요 없다. 그래서 이 태스크가 그 함수를 만든다 —
  // Task 5는 셀렉터만 만들었다 (`noUnusedLocals` + knip 때문에 소비처 없이 만들 수 없다).
  const hasSettingsUI = useCallback(
    (id: string) =>
      declaredSettingsFor(manifestFor(id)).length > 0 ||
      usePluginUIStore.getState().settingsTabs.some((t) => t.pluginId === id),
    [],
  );

  const openPluginSettings = useCallback(
    (id: string) => {
      setActivePluginSettings(id);
      openSettings();
    },
    [openSettings, setActivePluginSettings],
  );
```

`PluginInstalledList`에 `hasSettings={hasSettingsUI}`와 `onSettings={(r) => openPluginSettings(r.manifest.id)}`를 넘긴다 — **두 prop을 추가하는 것이 전부다.** PR1은 둘을 넘기지 않았고(optional), `PluginInstalledList`가 `onSettings && hasSettings?.(id)`일 때만 행에 전달하므로 이 한 번의 추가로 ⚙가 켜진다. 대체하거나 삭제할 no-op은 없다.

- [ ] **Step 4: Remove the three inline forms**

- `PluginMarketplace.tsx`: Task 7에서 Installed 행이 이미 `PluginRowView`로 바뀌었으므로 인라인 `<PluginSettingsForm>`은 사라졌다. `PluginSettingsForm` import가 남아 있으면 제거한다.
- `PluginDetail.tsx:333`: `<PluginSettingsForm pluginId={entry.id} />`를 설정 열기 버튼으로 바꾼다:

```tsx
      {/* §69 — 설정은 Settings 창에 단일 존재한다. 상세 화면에도 폼을 두면 장소가 둘이
          되고, 그러면 단일화가 아니다. */}
      {hasSettings && (
        <button className="plugin-detail__settings-btn" onClick={onOpenSettings} type="button">
          {t("plugin.action.openSettings")}
        </button>
      )}
```

`PluginDetail`에 `hasSettings: boolean`과 `onOpenSettings: () => void` prop을 추가하고 `PluginMarketplace`가 넘긴다.

- `PluginDeveloperSection.tsx:206`: 같은 방식으로 바꾼다. 이 컴포넌트는 UI 스토어에 이미 접근하므로(`showToast`) `openSettings`/`setActivePluginSettings`를 직접 셀렉터에 추가한다.

새 i18n 키:

```json
  "plugin.action.openSettings": "Open settings"
```

```json
  "plugin.action.openSettings": "설정 열기"
```

- [ ] **Step 5: Run the tests**

```bash
npx vitest run src/components/plugins src/components/settings > /tmp/t11b.log 2>&1; echo $?
tail -30 /tmp/t11b.log
```

Expected: PASS. `PluginSettingsForm.test.tsx`가 컴포넌트를 직접 렌더한다면 계속 통과한다(컴포넌트는 삭제하지 않고 호출 지점만 옮겼다). `PluginDetail.trust.test.tsx`와 `PluginDeveloperSection.test.tsx`는 새 prop 때문에 조정이 필요할 수 있다 — 필요하면 조정하되, **무엇을 왜 바꿨는지 커밋 메시지에 적는다**.

- [ ] **Step 6: Verify the two judgements agree**

```bash
grep -n "declaredSettingsFor" src/components/plugins/PluginMarketplace.tsx src/components/settings/SettingsModal.tsx
```

Expected: 양쪽이 `declaredSettingsFor(...)` + `settingsTabs.some(...)`의 같은 조합을 쓴다. 어긋나면 공용 함수로 뽑아 둘 다 호출하게 한다.

- [ ] **Step 7: Commit**

```bash
git add -A src/components/plugins src/components/settings src/i18n
git commit -m "feat(§69): make the plugin list a launcher, not a settings surface

The declared-fields form lived in three places and the registered tabs in a
fourth. Now the list routes to one page per plugin."
```

---

## Task 12: 전체 검증과 PR

**Files:** 없음 (검증만)

- [ ] **Step 1: Full suite, typecheck, knip, CSS audit**

```bash
npm test > /tmp/final-test.log 2>&1; echo "test=$?"
npm run typecheck > /tmp/final-tc.log 2>&1; echo "tc=$?"
npx knip > /tmp/final-knip.log 2>&1; echo "knip=$?"
npm run audit:css-vars > /tmp/final-css.log 2>&1; echo "css=$?"
grep -E "Tests|Test Files" /tmp/final-test.log
```

Expected: test·typecheck·knip은 exit 0. **`audit:css-vars`는 exit 1이 정상** — 목록이 정확히 베이스라인 2건(`--color-danger-default` in `dialogs.css`, `--graph-pinned-color` in `graph-style.ts`)이어야 하고 `plugins.css` 항목이 하나라도 있으면 실패로 취급한다

- [ ] **Step 2: i18n key parity**

```bash
node -e "const a=require('./src/i18n/en.json'),b=require('./src/i18n/ko.json');const ka=Object.keys(a),kb=Object.keys(b);const miss=ka.filter(k=>!(k in b)).concat(kb.filter(k=>!(k in a)));console.log(miss.length?'MISMATCH: '+miss.join(', '):'keys match ('+ka.length+')')"
```

- [ ] **Step 3: File sizes**

```bash
wc -l src/components/plugins/*.tsx src/components/plugins/*.ts src/components/settings/PluginSettingsPage.tsx src/styles/plugins.css | sort -rn | head -12
```

Expected: TSX/TS 파일이 ~500줄 이하(가능하면 300), `plugins.css`가 1,500줄 이하

- [ ] **Step 4: Visual check in the real app**

```bash
npm run tauri dev
```

확인 항목:
1. 사이드바 플러그인 패널 — 섹션·행이 280px에서 가로 스크롤 없이 들어가는가
2. 설정 창의 같은 패널 — 넓은 폭에서 정상인가
3. 내장 행의 ⚙ → 설정 창이 Media Viewer 페이지로 열리는가
4. 설정 창이 이미 열린 상태에서 ⚙ → 닫히지 않는가
5. 내장 토글 off → PNG를 열면 안내 문구가 뜨고, 다시 on → 이미지가 보이는가
6. 라이트/다크 테마 양쪽에서 섹션 머리와 배지의 대비

- [ ] **Step 5: Push (background — pre-push runs clippy + knip, 5~7 min)**

```bash
git push -u origin feature/plugin-settings-unification
```

- [ ] **Step 6: Dispatch review agents**

리뷰는 인라인 자체 점검으로 끝내지 않는다. `oh-my-claudecode:code-reviewer`(opus)를 디스패치하고, PR1의 훅 추출은 보안 로직 이동이므로 `oh-my-claudecode:security-reviewer`를 병렬로 함께 돌린다. 리뷰에게 명시할 것: **`usePluginActions`의 본문이 `PluginMarketplace`의 원본과 의미적으로 동일한지**가 가장 중요한 확인 항목이다.

- [ ] **Step 7: Record what was left out**

`dev/backlog.md`에 추가한다:

- dev 플러그인 섹션을 `PluginInstalledList`로 통합 (PR1 Task 7에서 `PluginDeveloperSection` 유지로 미룸)
- 설정 검색(`SettingsSearchResults`)이 플러그인 설정 필드를 색인
- **셸 크롬의 인라인 스타일 14개(`STYLES`의 남은 항목)를 `plugins.css`로 이관** — Task 7이 순수 이동 리뷰를 흐리지 않으려 의도적으로 미뤘다
- **`PluginCard.tsx`의 인라인 스타일 이관** (Browse 탭 전용, 같은 이유로 미룸)
- `plugin-lifecycle.ts` 359줄 분리 여부 (Task 4 deferred minor)
- `usePluginActions.ts`를 `usePluginInstall`(install/update)과 토글로 분리 — Task 7이 ~550줄 예외를 받은 대가
- `baram-word-count`를 내장으로 승격할지 (제품 결정)
- 내장 그룹 단위 일괄 Enable/Disable (내장이 1개인 지금은 무의미)

---

## Self-Review 결과

**스펙 커버리지** — 스펙의 각 절이 어느 태스크에 대응하는가:

| 스펙 | 태스크 |
|---|---|
| §3 결정사항 (내장 토글/섹션/disabled 목록) | Task 1, 4, 6 |
| §3.1 액션 세트 표 | Task 2 (`actionsFor`), Task 5·6 (렌더) |
| §4 두 설정 메커니즘 | Task 10 (한 페이지에 합침) |
| §5.1 B안 채택 | Task 1 |
| §5.2 콜사이트 (매니페스트 조회) | Task 5 Step 7·8 (`selectManifest`), Task 10, Task 11 (`manifestFor`) |
| §5.3 데이터 모델 | Task 2 |
| §5.4 lifecycle 3곳 | Task 4 (1·2), Task 3 (3) |
| §6 컴포넌트 분해 | Task 5, 6, 7 |
| §6 CSS 이관 | Task 5, 6 |
| §7 설정 단일화 7항목 | Task 9 (1·2), 10 (3·4·7), 11 (5·6) |
| §8 테스트 A1-4 | Task 6 |
| §8 테스트 B5-8 | Task 4, 8 |
| §8 테스트 C9 | Task 3 |
| §8 테스트 D10-15 | Task 10, 11 |
| §8 테스트 E16 | Task 7 Step 5 |
| §9 위험 R1-R4 | R1=Task 7 규칙+Step 5, R2=Task 9, R3=Task 8, R4=Task 8·12 육안 |
| §10 작업 순서 | Task 1-12의 순서 |
| §11 범위 밖 | Task 12 Step 7 |

**스펙과 어긋나 계획에서 바로잡은 것 2건:**

1. 스펙 §10 단계 2가 "Media Viewer `engines` 수정"이라 했지만, 실측으로 **이미 `>=0.5.0`으로 고쳐져 있다**. 없는 것은 검증뿐이므로 Task 3은 가드 추가이고, 즉시 통과하는 가드이므로 mutation 단계를 필수로 넣었다.
2. 스펙 §8 E16이 "기존 테스트가 수정 없이 통과"라 했지만, `plugin-marketplace-toggle.test.tsx:57`의 `findByRole("checkbox")`는 내장 토글이 추가되면 필연적으로 모호해진다. 실측으로 이 파일이 **유일한** 모호 질의이며(다른 후보는 `within(dialog)` 스코핑됨), Task 7 Step 1이 그 헬퍼만 스코핑한다. **assertion은 그대로 두고 질의만 좁힌다** — 그것이 E16이 실제로 보증할 수 있는 형태다.

**타입 일관성**: `PluginRow`/`RowActions`/`PluginSource`가 Task 2에서 정의되고 Task 5·6·7·10이 같은 이름으로 소비한다. 매니페스트 조회는 두 형태로 갈라진다(실행 중 실측에 따른 변경): **`selectManifest`**(셀렉터, 구독 유지)는 Task 5가 정의하고 Task 5의 `PluginSettingsForm`과 Task 10의 `PluginSettingsPage`가 소비하며, **`manifestFor`**(비반응 래퍼)는 Task 11이 정의하고 그 태스크의 `hasSettingsUI`만 소비한다. 어느 쪽도 소비처 없이 먼저 만들 수 없다 — `noUnusedLocals`와 knip이 각각 잡는다. `openSettings`/`setActivePluginSettings`/`activePluginSettings`는 Task 9에서 정의, Task 10·11이 소비. `buildPluginRows`의 입력 7필드가 Task 7과 Task 10 양쪽에서 같은 이름으로 전달된다.
