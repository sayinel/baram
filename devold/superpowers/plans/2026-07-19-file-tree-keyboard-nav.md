# File Tree Keyboard Navigation + Accessibility Implementation Plan (PR 3/5)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 파일 트리에 키보드 내비게이션(↑↓→←/Enter/Shift+↑↓)과 접근성(role/aria/roving tabindex)을 추가한다.

**Architecture:** 키보드 로직은 순수 헬퍼(`file-tree-keyboard-nav.ts`)로 트리 탐색(다음/이전/부모/첫자식)을 계산하고, `focusedPath` 상태와 keydown 디스패치는 신규 훅(`use-file-tree-keyboard.ts`)에 캡슐화한다. FileTree/FileTreeNode는 `focusedPath`를 컨텍스트로 받아 `role="tree"`/`role="treeitem"` + aria 속성 + roving tabindex를 렌더한다. 이동 순서는 PR1의 `visiblePaths`를 재사용하고, Enter 파일 열기는 PR2의 `actions.openInNewTab`을 재사용한다.

**Tech Stack:** React 19 + TypeScript(strict, verbatimModuleSyntax), Zustand, Vitest + @testing-library/react.

**Spec:** `dev/superpowers/specs/2026-07-18-file-tree-enhancements-design.md` §4.4, §5 PR3 행.

## Global Constraints

- TypeScript strict + `verbatimModuleSyntax` — 타입 전용 import는 반드시 `import type`
- 컴포넌트에서 Zustand bare call 금지 — `useShallow((s) => ({...}))` 셀렉터 사용
- 공유 유틸 재구현 금지: `dirname`/`basename` → `src/utils/path-utils.ts`; `computeVisibleEntries` → `src/components/sidebar/file-tree-visible.ts`
- 파일명 kebab-case, 단일 파일 ~300줄 이하
- 테스트는 `npm test`(vitest run) — `npx jest` 금지. exit code는 파이프 없이 캡처: `cmd > /tmp/log 2>&1; echo $?`
- 커밋: Conventional Commits + § 참조, 영어 (예: `feat(§4.4): ...`)
- pre-push hook이 clippy+knip 실행(콜드 시 5~7분) — push는 백그라운드로 (단 이 PR은 사용자 GUI 테스트 후 push/PR)
- `git commit --no-verify` 금지
- SSH: fetch/push 시 `-c core.sshCommand="ssh -i ~/.ssh/id_ed25519_macbook"`

## 현재 상태 (PR1/2 후, 조사 확인)

- `FileTree.tsx`: `visiblePaths: string[]`(computeVisibleEntries.map(e=>e.path), 86–95행), `selectedPaths`/`selectSingle`/`selectRange`/`toggleSelect`(useFileTreeSelection, 68행), `handleTreeKeyDown`(F2·Cmd+Delete만, 158–176행), `treeRef`+`tabIndex={0}`+`onKeyDown={handleTreeKeyDown}`(417·420행), `expandedDirs`/`toggleExpandedDir`/`expandDir`(file store), `actions.openInNewTab`(124행, PR2).
- `useFileTreeSelection`: `selectRange(targetPath, visiblePaths)`가 내부 `anchorRef`를 읽어 범위 계산(anchor는 selectSingle/toggleSelect가 갱신, selectRange는 유지) — Shift+↑↓ 범위 확장에 그대로 사용 가능.
- `FileTreeContext`: `selectedPaths: Set<string>` 등 read-only 상태를 FileTreeNode에 전달. `focusedPath` 추가 필요.
- `computeVisibleEntries(tree, expandedDirs, filteredPaths, matchesTagFilter): FileEntry[]` — 렌더 순서의 FileEntry(경로+isDir+depth 없음, children有) 목록.

---

### Task 1: 브랜치 + 키보드 내비게이션 순수 헬퍼

**Files:**
- Create: `src/components/sidebar/file-tree-keyboard-nav.ts`
- Test: `src/components/sidebar/__tests__/file-tree-keyboard-nav.test.ts`

**Interfaces:**
- Consumes: `FileEntry` from `src/stores/file/file.ts` (`{ children?, isDir, name, path }`), `dirname` from `src/utils/path-utils.ts`
- Produces (Task 2가 사용):
  - `interface NavEntry { isDir: boolean; path: string }`
  - `nextPath(paths: string[], current: null | string): null | string` — current 다음(없으면 첫 항목)
  - `prevPath(paths: string[], current: null | string): null | string` — current 이전(없으면 첫 항목)
  - `firstChildPath(entries: NavEntry[], parentPath: string): null | string` — visible에서 parent 바로 뒤 항목이 parent의 자식이면 그 경로
  - `parentPath(entries: NavEntry[], childPath: string, rootPath: string): null | string` — childPath의 부모 디렉토리가 visible에 있으면 그 경로(루트 직속은 null)
  - `isDirPath(entries: NavEntry[], path: string): boolean`

- [ ] **Step 1: 브랜치 생성**

```bash
cd /Users/donghoon.yoo/work/projects/baram
git checkout main && git -c core.sshCommand="ssh -i ~/.ssh/id_ed25519_macbook" pull --ff-only && git checkout -b feature/file-tree-keyboard-nav
```

- [ ] **Step 2: 실패하는 테스트 작성**

`src/components/sidebar/__tests__/file-tree-keyboard-nav.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import {
  firstChildPath,
  isDirPath,
  type NavEntry,
  nextPath,
  parentPath,
  prevPath,
} from "../file-tree-keyboard-nav";

// visible 순서 (렌더 순서): docs(dir) > docs/a.md > docs/sub(dir) > docs/sub/b.md > z.md
const entries: NavEntry[] = [
  { path: "/r/docs", isDir: true },
  { path: "/r/docs/a.md", isDir: false },
  { path: "/r/docs/sub", isDir: true },
  { path: "/r/docs/sub/b.md", isDir: false },
  { path: "/r/z.md", isDir: false },
];
const paths = entries.map((e) => e.path);

describe("nextPath / prevPath", () => {
  it("current 다음/이전 항목을 반환한다", () => {
    expect(nextPath(paths, "/r/docs")).toBe("/r/docs/a.md");
    expect(prevPath(paths, "/r/docs/a.md")).toBe("/r/docs");
  });
  it("끝/처음에서는 경계를 유지한다", () => {
    expect(nextPath(paths, "/r/z.md")).toBe("/r/z.md");
    expect(prevPath(paths, "/r/docs")).toBe("/r/docs");
  });
  it("current가 null이면 첫 항목을 반환한다", () => {
    expect(nextPath(paths, null)).toBe("/r/docs");
    expect(prevPath(paths, null)).toBe("/r/docs");
  });
  it("current가 목록에 없으면 첫 항목을 반환한다", () => {
    expect(nextPath(paths, "/gone")).toBe("/r/docs");
  });
});

describe("firstChildPath", () => {
  it("펼친 폴더의 첫 자식(바로 뒤 + 더 깊은 경로)을 반환한다", () => {
    expect(firstChildPath(entries, "/r/docs")).toBe("/r/docs/a.md");
    expect(firstChildPath(entries, "/r/docs/sub")).toBe("/r/docs/sub/b.md");
  });
  it("바로 뒤 항목이 자식이 아니면 null (접힌 폴더)", () => {
    const collapsed: NavEntry[] = [
      { path: "/r/docs", isDir: true },
      { path: "/r/z.md", isDir: false },
    ];
    expect(firstChildPath(collapsed, "/r/docs")).toBeNull();
  });
});

describe("parentPath", () => {
  it("자식의 부모 디렉토리가 visible에 있으면 반환한다", () => {
    expect(parentPath(entries, "/r/docs/a.md", "/r")).toBe("/r/docs");
    expect(parentPath(entries, "/r/docs/sub/b.md", "/r")).toBe("/r/docs/sub");
  });
  it("루트 직속 항목은 null", () => {
    expect(parentPath(entries, "/r/z.md", "/r")).toBeNull();
    expect(parentPath(entries, "/r/docs", "/r")).toBeNull();
  });
});

describe("isDirPath", () => {
  it("경로의 isDir 여부를 반환한다", () => {
    expect(isDirPath(entries, "/r/docs")).toBe(true);
    expect(isDirPath(entries, "/r/z.md")).toBe(false);
    expect(isDirPath(entries, "/gone")).toBe(false);
  });
});
```

- [ ] **Step 3: 테스트 실패 확인**

```bash
npx vitest run src/components/sidebar/__tests__/file-tree-keyboard-nav.test.ts > /tmp/t1.log 2>&1; echo $?
```
Expected: exit 1 (모듈 없음)

- [ ] **Step 4: 구현**

`src/components/sidebar/file-tree-keyboard-nav.ts`:

```ts
// §4.4 File tree — 키보드 내비게이션 순수 헬퍼 (트리 탐색)
import { dirname } from "../../utils/path-utils";

export interface NavEntry {
  isDir: boolean;
  path: string;
}

/** current 다음 경로 (경계에서 유지; null/미존재면 첫 항목) */
export function nextPath(paths: string[], current: null | string): null | string {
  if (paths.length === 0) return null;
  const idx = current === null ? -1 : paths.indexOf(current);
  if (idx === -1) return paths[0];
  return idx < paths.length - 1 ? paths[idx + 1] : paths[idx];
}

/** current 이전 경로 (경계에서 유지; null/미존재면 첫 항목) */
export function prevPath(paths: string[], current: null | string): null | string {
  if (paths.length === 0) return null;
  const idx = current === null ? -1 : paths.indexOf(current);
  if (idx === -1) return paths[0];
  return idx > 0 ? paths[idx - 1] : paths[idx];
}

/** 펼친 폴더의 첫 자식: visible에서 parent 바로 뒤 항목이 parent의 자식이면 그 경로 */
export function firstChildPath(
  entries: NavEntry[],
  parentDir: string,
): null | string {
  const idx = entries.findIndex((e) => e.path === parentDir);
  if (idx === -1 || idx + 1 >= entries.length) return null;
  const nextEntry = entries[idx + 1];
  return nextEntry.path.startsWith(parentDir + "/") ? nextEntry.path : null;
}

/** childPath의 부모 디렉토리가 visible에 있으면 반환 (루트 직속은 null) */
export function parentPath(
  entries: NavEntry[],
  childPath: string,
  rootPath: string,
): null | string {
  const parent = dirname(childPath);
  if (parent === rootPath || parent === "") return null;
  return entries.some((e) => e.path === parent) ? parent : null;
}

/** 경로의 isDir 여부 (미존재면 false) */
export function isDirPath(entries: NavEntry[], path: string): boolean {
  return entries.find((e) => e.path === path)?.isDir ?? false;
}
```

- [ ] **Step 5: 테스트 통과 확인**

```bash
npx vitest run src/components/sidebar/__tests__/file-tree-keyboard-nav.test.ts > /tmp/t1.log 2>&1; echo $?
```
Expected: exit 0

- [ ] **Step 6: 커밋**

```bash
git add src/components/sidebar/file-tree-keyboard-nav.ts src/components/sidebar/__tests__/file-tree-keyboard-nav.test.ts
git commit -m "feat(§4.4): add file-tree keyboard navigation helpers"
```

---

### Task 2: use-file-tree-keyboard 훅 (focusedPath + keydown)

**Files:**
- Create: `src/components/sidebar/hooks/use-file-tree-keyboard.ts`
- Test: `src/components/sidebar/__tests__/use-file-tree-keyboard.test.ts`

**Interfaces:**
- Consumes: Task 1 헬퍼, `computeVisibleEntries` 결과(호출자가 넘김)
- Produces (Task 3이 사용):

```ts
export interface UseFileTreeKeyboardArgs {
  expandedDirs: Set<string>;
  expandDir: (path: string) => void;
  navEntries: import("../file-tree-keyboard-nav").NavEntry[];
  onOpenFile: (path: string) => void;
  rootPath: string;
  selectRange: (targetPath: string, visiblePaths: string[]) => void;
  selectSingle: (path: string) => void;
  toggleExpandedDir: (path: string) => void;
  visiblePaths: string[];
}
export interface UseFileTreeKeyboardReturn {
  focusedPath: null | string;
  handleNavKeyDown: (e: React.KeyboardEvent) => void;
  setFocusedPath: (path: null | string) => void;
}
export function useFileTreeKeyboard(args: UseFileTreeKeyboardArgs): UseFileTreeKeyboardReturn;
```

동작(스펙 §4.4):
- ↓/↑: `nextPath`/`prevPath`로 focus 이동 + `selectSingle(new)` (선택 동반, VSCode). preventDefault.
- Shift+↓/↑: focus 이동 + `selectRange(new, visiblePaths)` (anchor 기반 범위 확장).
- →: focused가 폴더이고 **접힘**이면 `expandDir`; **펼침**이면 `firstChildPath`로 focus. 파일이면 무시.
- ←: focused가 폴더이고 **펼침**이면 `toggleExpandedDir`(접기); 아니면 `parentPath`로 focus. 부모 없으면 무시.
- Enter: focused가 파일이면 `onOpenFile(focused)`; 폴더면 `toggleExpandedDir(focused)`.

- [ ] **Step 1: 실패하는 테스트 작성**

`src/components/sidebar/__tests__/use-file-tree-keyboard.test.ts`:

```ts
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { NavEntry } from "../file-tree-keyboard-nav";

import { useFileTreeKeyboard } from "../hooks/use-file-tree-keyboard";

const navEntries: NavEntry[] = [
  { path: "/r/docs", isDir: true },
  { path: "/r/docs/a.md", isDir: false },
  { path: "/r/z.md", isDir: false },
];
const visiblePaths = navEntries.map((e) => e.path);

function makeArgs(over: Partial<Parameters<typeof useFileTreeKeyboard>[0]> = {}) {
  return {
    navEntries,
    visiblePaths,
    rootPath: "/r",
    expandedDirs: new Set<string>(["/r/docs"]),
    expandDir: vi.fn(),
    toggleExpandedDir: vi.fn(),
    selectSingle: vi.fn(),
    selectRange: vi.fn(),
    onOpenFile: vi.fn(),
    ...over,
  };
}

function key(k: string, shift = false): React.KeyboardEvent {
  return { key: k, shiftKey: shift, preventDefault: vi.fn() } as unknown as React.KeyboardEvent;
}

describe("useFileTreeKeyboard", () => {
  it("ArrowDown은 focus를 다음으로 옮기고 selectSingle을 호출한다", () => {
    const args = makeArgs();
    const { result } = renderHook(() => useFileTreeKeyboard(args));
    act(() => result.current.setFocusedPath("/r/docs"));
    act(() => result.current.handleNavKeyDown(key("ArrowDown")));
    expect(result.current.focusedPath).toBe("/r/docs/a.md");
    expect(args.selectSingle).toHaveBeenCalledWith("/r/docs/a.md");
  });

  it("focus가 없을 때 ArrowDown은 첫 항목으로 간다", () => {
    const args = makeArgs();
    const { result } = renderHook(() => useFileTreeKeyboard(args));
    act(() => result.current.handleNavKeyDown(key("ArrowDown")));
    expect(result.current.focusedPath).toBe("/r/docs");
  });

  it("Shift+ArrowDown은 selectRange를 호출한다(단일선택 대신)", () => {
    const args = makeArgs();
    const { result } = renderHook(() => useFileTreeKeyboard(args));
    act(() => result.current.setFocusedPath("/r/docs"));
    act(() => result.current.handleNavKeyDown(key("ArrowDown", true)));
    expect(args.selectRange).toHaveBeenCalledWith("/r/docs/a.md", visiblePaths);
    expect(args.selectSingle).not.toHaveBeenCalled();
  });

  it("ArrowRight: 접힌 폴더는 expandDir", () => {
    const args = makeArgs({ expandedDirs: new Set<string>() });
    const { result } = renderHook(() => useFileTreeKeyboard(args));
    act(() => result.current.setFocusedPath("/r/docs"));
    act(() => result.current.handleNavKeyDown(key("ArrowRight")));
    expect(args.expandDir).toHaveBeenCalledWith("/r/docs");
  });

  it("ArrowRight: 펼친 폴더는 첫 자식으로 focus 이동", () => {
    const args = makeArgs(); // docs 펼침
    const { result } = renderHook(() => useFileTreeKeyboard(args));
    act(() => result.current.setFocusedPath("/r/docs"));
    act(() => result.current.handleNavKeyDown(key("ArrowRight")));
    expect(result.current.focusedPath).toBe("/r/docs/a.md");
  });

  it("ArrowLeft: 펼친 폴더는 접기(toggleExpandedDir)", () => {
    const args = makeArgs();
    const { result } = renderHook(() => useFileTreeKeyboard(args));
    act(() => result.current.setFocusedPath("/r/docs"));
    act(() => result.current.handleNavKeyDown(key("ArrowLeft")));
    expect(args.toggleExpandedDir).toHaveBeenCalledWith("/r/docs");
  });

  it("ArrowLeft: 자식 파일은 부모로 focus 이동", () => {
    const args = makeArgs();
    const { result } = renderHook(() => useFileTreeKeyboard(args));
    act(() => result.current.setFocusedPath("/r/docs/a.md"));
    act(() => result.current.handleNavKeyDown(key("ArrowLeft")));
    expect(result.current.focusedPath).toBe("/r/docs");
  });

  it("Enter: 파일은 onOpenFile, 폴더는 toggleExpandedDir", () => {
    const args = makeArgs();
    const { result } = renderHook(() => useFileTreeKeyboard(args));
    act(() => result.current.setFocusedPath("/r/z.md"));
    act(() => result.current.handleNavKeyDown(key("Enter")));
    expect(args.onOpenFile).toHaveBeenCalledWith("/r/z.md");
    act(() => result.current.setFocusedPath("/r/docs"));
    act(() => result.current.handleNavKeyDown(key("Enter")));
    expect(args.toggleExpandedDir).toHaveBeenCalledWith("/r/docs");
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

```bash
npx vitest run src/components/sidebar/__tests__/use-file-tree-keyboard.test.ts > /tmp/t2.log 2>&1; echo $?
```
Expected: exit 1

- [ ] **Step 3: 구현**

`src/components/sidebar/hooks/use-file-tree-keyboard.ts`:

```ts
// §4.4 File tree — 키보드 내비게이션 훅 (focusedPath roving + keydown 디스패치)
import { useCallback, useState } from "react";

import type { NavEntry } from "../file-tree-keyboard-nav";

import {
  firstChildPath,
  isDirPath,
  nextPath,
  parentPath,
  prevPath,
} from "../file-tree-keyboard-nav";

export interface UseFileTreeKeyboardArgs {
  expandedDirs: Set<string>;
  expandDir: (path: string) => void;
  navEntries: NavEntry[];
  onOpenFile: (path: string) => void;
  rootPath: string;
  selectRange: (targetPath: string, visiblePaths: string[]) => void;
  selectSingle: (path: string) => void;
  toggleExpandedDir: (path: string) => void;
  visiblePaths: string[];
}

export interface UseFileTreeKeyboardReturn {
  focusedPath: null | string;
  handleNavKeyDown: (e: React.KeyboardEvent) => void;
  setFocusedPath: (path: null | string) => void;
}

export function useFileTreeKeyboard(
  args: UseFileTreeKeyboardArgs,
): UseFileTreeKeyboardReturn {
  const {
    navEntries,
    visiblePaths,
    rootPath,
    expandedDirs,
    expandDir,
    toggleExpandedDir,
    selectSingle,
    selectRange,
    onOpenFile,
  } = args;
  const [focusedPath, setFocusedPath] = useState<null | string>(null);

  const moveFocus = useCallback(
    (target: null | string, shift: boolean): void => {
      if (!target) return;
      setFocusedPath(target);
      if (shift) selectRange(target, visiblePaths);
      else selectSingle(target);
    },
    [selectRange, selectSingle, visiblePaths],
  );

  const handleNavKeyDown = useCallback(
    (e: React.KeyboardEvent): void => {
      switch (e.key) {
        case "ArrowDown":
          e.preventDefault();
          moveFocus(nextPath(visiblePaths, focusedPath), e.shiftKey);
          break;
        case "ArrowUp":
          e.preventDefault();
          moveFocus(prevPath(visiblePaths, focusedPath), e.shiftKey);
          break;
        case "ArrowRight": {
          if (!focusedPath || !isDirPath(navEntries, focusedPath)) break;
          e.preventDefault();
          if (!expandedDirs.has(focusedPath)) {
            expandDir(focusedPath);
          } else {
            const child = firstChildPath(navEntries, focusedPath);
            if (child) moveFocus(child, false);
          }
          break;
        }
        case "ArrowLeft": {
          if (!focusedPath) break;
          e.preventDefault();
          if (
            isDirPath(navEntries, focusedPath) &&
            expandedDirs.has(focusedPath)
          ) {
            toggleExpandedDir(focusedPath);
          } else {
            const parent = parentPath(navEntries, focusedPath, rootPath);
            if (parent) moveFocus(parent, false);
          }
          break;
        }
        case "Enter":
          if (!focusedPath) break;
          e.preventDefault();
          if (isDirPath(navEntries, focusedPath)) toggleExpandedDir(focusedPath);
          else onOpenFile(focusedPath);
          break;
      }
    },
    [
      focusedPath,
      navEntries,
      visiblePaths,
      rootPath,
      expandedDirs,
      expandDir,
      toggleExpandedDir,
      onOpenFile,
      moveFocus,
    ],
  );

  return { focusedPath, setFocusedPath, handleNavKeyDown };
}
```

- [ ] **Step 4: 테스트 통과 확인**

```bash
npx vitest run src/components/sidebar/__tests__/use-file-tree-keyboard.test.ts > /tmp/t2.log 2>&1; echo $?
```
Expected: exit 0, 8 passed

- [ ] **Step 5: 커밋**

```bash
git add src/components/sidebar/hooks/use-file-tree-keyboard.ts src/components/sidebar/__tests__/use-file-tree-keyboard.test.ts
git commit -m "feat(§4.4): add use-file-tree-keyboard hook"
```

---

### Task 3: FileTree/FileTreeNode/Context 배선 + 접근성

**Files:**
- Modify: `src/components/sidebar/FileTreeContext.tsx` (focusedPath 추가)
- Modify: `src/components/sidebar/FileTree.tsx` (훅 배선, handleTreeKeyDown 확장, role="tree", 클릭 시 focus 동기화)
- Modify: `src/components/sidebar/FileTreeNode.tsx` (role="treeitem", aria-*, tabindex, focus ref)
- Test: `src/components/sidebar/__tests__/file-tree-a11y.test.tsx`

**Interfaces:**
- Consumes: Task 2 `useFileTreeKeyboard`, Task 1 `NavEntry`
- Produces: `FileTreeContextValue.focusedPath: null | string`

- [ ] **Step 1: 실패하는 테스트 작성**

`src/components/sidebar/__tests__/file-tree-a11y.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { FileEntry } from "../../../stores/file/file";
import type { FileTreeContextValue } from "../FileTreeContext";

import { FileTreeProvider } from "../FileTreeContext";
import { FileTreeNode } from "../FileTreeNode";

const ctx: FileTreeContextValue = {
  creatingEntry: null,
  dragOverPath: null,
  dragSourcePaths: [],
  expandedDirs: new Set<string>(["/r/docs"]),
  focusedPath: "/r/docs",
  renamingPath: null,
  selectedPaths: new Set<string>(["/r/docs"]),
};

const noop = (): void => {};

function renderNode(
  entry: FileEntry,
  ctxOverride: Partial<FileTreeContextValue> = {},
): void {
  render(
    <FileTreeProvider value={{ ...ctx, ...ctxOverride }}>
      <FileTreeNode
        depth={0}
        entry={entry}
        onCancelCreate={noop}
        onCancelRename={noop}
        onConfirmCreate={noop}
        onConfirmRename={noop}
        onContextMenu={noop}
        onDirClick={noop}
        onFileClick={noop}
        onStartRename={noop}
      />
    </FileTreeProvider>,
  );
}

describe("FileTreeNode accessibility", () => {
  it("폴더 행은 role=treeitem + aria-expanded를 가진다", () => {
    const dir: FileEntry = { name: "docs", path: "/r/docs", isDir: true, children: [] };
    renderNode(dir);
    const item = screen.getByText("docs").closest('[role="treeitem"]')!;
    expect(item).not.toBeNull();
    expect(item.getAttribute("aria-expanded")).toBe("true");
  });

  it("선택된 행은 aria-selected=true", () => {
    const file: FileEntry = { name: "a.md", path: "/r/docs", isDir: false };
    renderNode(file, { selectedPaths: new Set(["/r/docs"]) });
    const item = screen.getByText("a.md").closest('[role="treeitem"]')!;
    expect(item.getAttribute("aria-selected")).toBe("true");
  });

  it("focused 행은 tabindex=0, 나머지는 -1 (roving)", () => {
    const file: FileEntry = { name: "a.md", path: "/r/docs", isDir: false };
    renderNode(file, { focusedPath: "/r/docs" });
    const item = screen.getByText("a.md").closest('[role="treeitem"]')!;
    expect(item.getAttribute("tabindex")).toBe("0");
  });

  it("focus 안 된 행은 tabindex=-1", () => {
    const file: FileEntry = { name: "a.md", path: "/r/other.md", isDir: false };
    renderNode(file, { focusedPath: "/r/docs" });
    const item = screen.getByText("a.md").closest('[role="treeitem"]')!;
    expect(item.getAttribute("tabindex")).toBe("-1");
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

```bash
npx vitest run src/components/sidebar/__tests__/file-tree-a11y.test.tsx > /tmp/t3.log 2>&1; echo $?
```
Expected: exit 1 (`focusedPath` 컨텍스트 필드 없음 / role 없음)

- [ ] **Step 3: FileTreeContext.tsx 수정**

`FileTreeContextValue` 인터페이스에 추가(알파벳 위치 — `expandedDirs` 다음):

```ts
  focusedPath: null | string;
```

- [ ] **Step 4: FileTreeNode.tsx 수정**

컨텍스트 구독에 `focusedPath` 추가, 폴더/파일 행 div에 접근성 속성 추가.

(a) 컨텍스트 구독(기존 `selectedPaths` 옆):

```tsx
  const { focusedPath /* , ...기존 */ } = useFileTreeContext();
  const isFocused = focusedPath === entry.path;
```

(b) 폴더 행 컨테이너 div(현재 `className={isDragOver ? ...}` div)에 role/aria/tabindex. 실제 클릭 대상인 `.file-tree-item.file-tree-dir` div에 부여:

```tsx
        <div
          aria-expanded={isExpanded}
          aria-level={depth + 1}
          aria-selected={isSelected}
          className={`file-tree-item file-tree-dir ${isSelected ? "file-tree-item-active" : ""}`}
          data-tree-path={entry.path}
          onClick={(e) => onDirClick(entry, e)}
          onContextMenu={(e) => onContextMenu(e, entry.path, true)}
          role="treeitem"
          style={{ paddingLeft }}
          tabIndex={isFocused ? 0 : -1}
        >
```

(c) 파일 행 div(`.file-tree-item.file-tree-file`)에도:

```tsx
    <div
      aria-level={depth + 1}
      aria-selected={isSelected}
      className={`file-tree-item file-tree-file ${isSelected ? "file-tree-item-active" : ""} ${isDragSource ? "opacity-40" : ""}`}
      data-file-path={entry.path}
      data-tree-path={entry.path}
      onClick={(e) => !isRenaming && onFileClick(entry, e)}
      onContextMenu={(e) => onContextMenu(e, entry.path, false)}
      role="treeitem"
      style={{ paddingLeft }}
      tabIndex={isFocused ? 0 : -1}
    >
```

(주의: 기존 `data-file-path`(DnD용)는 유지. `data-tree-path`는 focus 스크롤용으로 신규 추가.)

- [ ] **Step 5: FileTree.tsx 수정 — 훅 배선 + role="tree" + keydown 통합 + focus 동기화**

(a) import 추가:

```tsx
import { useFileTreeKeyboard } from "./hooks/use-file-tree-keyboard";
```

(b) `visibleEntries`(NavEntry용)를 visiblePaths 근처에서 계산(computeVisibleEntries 재사용):

```tsx
  const visibleEntries = useMemo(
    () =>
      computeVisibleEntries(
        fileTree,
        expandedDirs,
        filteredPaths,
        entryMatchesTagFilter,
      ).map((e) => ({ path: e.path, isDir: e.isDir })),
    [fileTree, expandedDirs, filteredPaths, entryMatchesTagFilter],
  );
```
그리고 `visiblePaths`는 `visibleEntries.map((e) => e.path)`로 재작성(중복 계산 제거):

```tsx
  const visiblePaths = useMemo(() => visibleEntries.map((e) => e.path), [visibleEntries]);
```

(c) 키보드 훅 배선(actions·selection·store 콜백 조립). Enter 파일 열기는 `actions.openInNewTab` 재사용:

```tsx
  const { focusedPath, setFocusedPath, handleNavKeyDown } = useFileTreeKeyboard({
    navEntries: visibleEntries,
    visiblePaths,
    rootPath: rootPath ?? "",
    expandedDirs,
    expandDir,
    toggleExpandedDir,
    selectSingle,
    selectRange,
    onOpenFile: (path) => {
      void actions.openInNewTab(path);
    },
  });
```

(d) `handleTreeKeyDown`(158–176행)에서 F2/Delete 처리 후 화살표/Enter를 훅에 위임. 기존 함수 확장:

```tsx
  const handleTreeKeyDown = useCallback(
    (e: React.KeyboardEvent): void => {
      // 인라인 입력(검색/rename)에 포커스가 있으면 트리 내비 무시
      const tag = (e.target as HTMLElement).tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      if (e.key === "F2" && primaryPath && !renamingPath) {
        e.preventDefault();
        setRenamingPath(primaryPath);
        return;
      }
      if (
        (e.key === "Delete" || e.key === "Backspace") &&
        selectedPaths.size > 0 &&
        !renamingPath &&
        e.metaKey
      ) {
        e.preventDefault();
        handleDeleteMany([...selectedPaths]);
        return;
      }
      if (!renamingPath) handleNavKeyDown(e);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [primaryPath, renamingPath, selectedPaths, handleNavKeyDown],
  );
```

(e) 클릭 시 focus 동기화 — `handleFileClick`/`handleDirClick`의 `treeRef.current?.focus()` 다음에 `setFocusedPath(entry.path)` 추가(둘 다). 그리고 탭 동기화 useEffect(129–131행)에도 `setFocusedPath(activeFilePath)` 추가.

(f) `ctxValue`(FileTreeProvider value)에 `focusedPath` 추가.

(g) 루트 `.file-tree` div에 `role="tree"` + `aria-label`:

```tsx
      <div
        aria-label="File tree"
        className={`file-tree ${isDragging ? "file-tree-dragging" : ""}`}
        onContextMenu={handleEmptyAreaContextMenu}
        onKeyDown={handleTreeKeyDown}
        onMouseDown={handleTreeMouseDown}
        ref={treeRef}
        role="tree"
        tabIndex={0}
      >
```

(h) focusedPath 변경 시 해당 행으로 스크롤 + 포커스(roving) — useEffect 추가:

```tsx
  useEffect(() => {
    if (!focusedPath || !treeRef.current) return;
    const el = treeRef.current.querySelector<HTMLElement>(
      `[data-tree-path="${CSS.escape(focusedPath)}"]`,
    );
    el?.scrollIntoView({ block: "nearest" });
    el?.focus();
  }, [focusedPath]);
```

- [ ] **Step 6: 테스트·타입·회귀 확인**

```bash
npx vitest run src/components/sidebar/__tests__/file-tree-a11y.test.tsx > /tmp/t3.log 2>&1; echo $?
npm run typecheck > /tmp/tc3.log 2>&1; echo $?
npm test > /tmp/full3.log 2>&1; echo $?
```
Expected: 모두 exit 0. (기존 file-tree-node-clicks 테스트의 ctx 객체에 `focusedPath: null` 필수 필드 추가 필요 — 그 테스트도 함께 갱신.)

- [ ] **Step 7: 커밋**

```bash
git add src/components/sidebar/
git commit -m "feat(§4.4): wire keyboard nav + tree/treeitem a11y into FileTree"
```

---

### Task 4: 최종 검증 (PR은 사용자 GUI 테스트 후)

**Files:** 없음 (검증 전용)

- [ ] **Step 1: 전체 게이트**

```bash
cd /Users/donghoon.yoo/work/projects/baram
npm run typecheck > /tmp/final-tc.log 2>&1; echo $?
npm test > /tmp/final-test.log 2>&1; echo $?
npx knip > /tmp/final-knip.log 2>&1; echo $?
```
Expected: 모두 exit 0. (Rust 미변경이라 cargo 불필요.)

- [ ] **Step 2: 수동 GUI 검증 항목 정리(사용자에게 전달)**

1. 트리에 포커스(클릭) 후 ↑/↓ — 커서 이동 + 단일 선택 동반, 스크롤 따라감
2. → 접힌 폴더 펼침 / 펼친 폴더에서 다시 → 첫 자식으로
3. ← 펼친 폴더 접기 / 자식에서 ← 부모로
4. Enter 파일 열기(탭) / 폴더 토글
5. Shift+↑/↓ 범위 선택 확장
6. 검색 입력·rename 입력에 포커스 있을 땐 트리 내비 무시(정상 타이핑)
7. 스크린리더/접근성: role=tree/treeitem, aria-expanded/selected (VoiceOver 확인 선택)
8. 기존 클릭/DnD/컨텍스트 메뉴 회귀 없음

- [ ] **Step 3: 대기**

push/PR 생성은 사용자 GUI 테스트 완료 후. 컨트롤러가 사용자에게 GUI 검증을 요청하고, 승인 시 push + PR(본문은 **Mermaid 다이어그램** 사용 — feedback_pr_style).

---

## Self-Review 결과

- **Spec §4.4 coverage**: ↑↓ focus+선택동반(T2·T3), →펼침/첫자식(T1 firstChildPath·T2), ←접기/부모(T1 parentPath·T2), Enter 열기/토글(T2, openInNewTab 재사용), Shift+↑↓ 범위(T2 selectRange), role/aria/roving tabindex/scrollIntoView(T3), 인라인 입력 무시(T3 handleTreeKeyDown 가드), type-ahead 제외(스펙대로 미구현) → 전부 커버.
- **재사용 준수**: `computeVisibleEntries`(visible 순서), `selectRange`/anchor(PR1), `actions.openInNewTab`(PR2), `dirname`(path-utils) — 재구현 없음.
- **경계 케이스**: 경계에서 focus 유지(nextPath/prevPath), focus null 시 첫 항목, 접힌 폴더 firstChildPath=null, 루트 직속 parentPath=null, 인라인 입력 포커스 시 무시.
- **타입 일관성**: `NavEntry{isDir,path}` T1 정의=T2·T3 사용; `UseFileTreeKeyboardArgs/Return` T2 정의=T3 사용; `FileTreeContextValue.focusedPath` T3 추가=Node 소비. 기존 `data-file-path`(DnD) 유지 + `data-tree-path`(스크롤) 신규.
- **리스크**: FileTree.tsx가 이미 565줄(백로그) — 이 PR이 키보드 훅을 분리해 로직 증가를 완화하나 배선 코드는 추가됨. handleTreeKeyDown의 INPUT/TEXTAREA 가드로 검색·rename 타이핑 회귀 방지(전체 테스트로 확인).
