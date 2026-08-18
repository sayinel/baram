# File Tree Multi-Select + Trash Delete Implementation Plan (PR 1/5)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 파일 트리에 멀티 셀렉트(Cmd/Shift 클릭), 일괄 삭제, 다중 드래그 이동을 추가하고 삭제를 OS 휴지통으로 전환한다.

**Architecture:** 선택 상태는 신규 훅 `use-file-tree-selection.ts`(Set 기반), 범위 선택·드래그 세트 계산은 순수 함수 유틸 2개 파일로 분리해 단위 테스트한다. Rust `delete_file`/`delete_dir`는 시그니처 불변으로 내부만 `trash` crate 호출로 교체한다.

**Tech Stack:** React 19 + TypeScript(strict, verbatimModuleSyntax), Zustand, Vitest + @testing-library/react, Rust(tokio) + trash crate.

**Spec:** `dev/superpowers/specs/2026-07-18-file-tree-enhancements-design.md` §3(결정 1·2·4), §4.1, §4.2, §5 PR1 행

## Global Constraints

- TypeScript strict + `verbatimModuleSyntax` — 타입 전용 import는 반드시 `import type`
- 컴포넌트에서 Zustand bare call 금지 — `useShallow((s) => ({...}))` 셀렉터 사용
- 파일명 kebab-case, 단일 파일 ~300줄 이하
- 테스트는 `npm test`(vitest run) — `npx jest` 금지. exit code는 파이프 없이 캡처: `cmd > /tmp/log 2>&1; echo $?`
- 커밋: Conventional Commits + § 참조, 영어 (예: `feat(§4.3): ...`)
- pre-push hook이 clippy+knip 실행(콜드 시 5~7분) — push는 백그라운드로
- `git commit --no-verify` 금지
- Rust IPC 커맨드는 `Result<T, String>` 반환 유지 (fs_cmd.rs는 수정하지 않는다 — fs/mod.rs 내부만 변경)

---

### Task 1: 브랜치 생성 + visible-entry 평탄화 유틸

**Files:**
- Create: `src/components/sidebar/file-tree-visible.ts`
- Test: `src/components/sidebar/__tests__/file-tree-visible.test.ts`

**Interfaces:**
- Consumes: `FileEntry` from `src/stores/file/file.ts` (`{ children?, isDir, name, path }`)
- Produces: `computeVisibleEntries(tree: FileEntry[], expandedDirs: Set<string>, filteredPaths: null | Set<string>, matchesTagFilter: (entry: FileEntry, paths: Set<string>) => boolean): FileEntry[]` — Task 4의 범위 선택과 PR3 키보드 내비가 이 순서를 공유한다

- [ ] **Step 1: 브랜치 생성**

```bash
cd /Users/donghoon.yoo/work/projects/baram
git checkout main && git pull && git checkout -b feature/file-tree-multiselect-trash
```

- [ ] **Step 2: 실패하는 테스트 작성**

`src/components/sidebar/__tests__/file-tree-visible.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import type { FileEntry } from "../../../stores/file/file";

import { computeVisibleEntries } from "../file-tree-visible";

// FileTree.tsx의 태그 필터와 동일한 시그니처의 최소 구현
function matchesTagFilter(entry: FileEntry, paths: Set<string>): boolean {
  if (!entry.isDir) return paths.has(entry.path);
  return (entry.children ?? []).some((c) => matchesTagFilter(c, paths));
}

const tree: FileEntry[] = [
  {
    name: "docs",
    path: "/r/docs",
    isDir: true,
    children: [
      { name: "a.md", path: "/r/docs/a.md", isDir: false },
      {
        name: "sub",
        path: "/r/docs/sub",
        isDir: true,
        children: [{ name: "b.md", path: "/r/docs/sub/b.md", isDir: false }],
      },
    ],
  },
  { name: "z.md", path: "/r/z.md", isDir: false },
];

describe("computeVisibleEntries", () => {
  it("접힌 트리는 최상위 항목만 순서대로 반환한다", () => {
    const out = computeVisibleEntries(tree, new Set(), null, matchesTagFilter);
    expect(out.map((e) => e.path)).toEqual(["/r/docs", "/r/z.md"]);
  });

  it("펼친 폴더의 자식은 부모 바로 뒤에 깊이 우선으로 삽입된다", () => {
    const out = computeVisibleEntries(
      tree,
      new Set(["/r/docs"]),
      null,
      matchesTagFilter,
    );
    expect(out.map((e) => e.path)).toEqual([
      "/r/docs",
      "/r/docs/a.md",
      "/r/docs/sub",
      "/r/z.md",
    ]);
  });

  it("중첩 폴더 펼침도 렌더 순서와 일치한다", () => {
    const out = computeVisibleEntries(
      tree,
      new Set(["/r/docs", "/r/docs/sub"]),
      null,
      matchesTagFilter,
    );
    expect(out.map((e) => e.path)).toEqual([
      "/r/docs",
      "/r/docs/a.md",
      "/r/docs/sub",
      "/r/docs/sub/b.md",
      "/r/z.md",
    ]);
  });

  it("태그 필터는 최상위에만 적용되고 펼친 폴더의 자식은 필터링하지 않는다", () => {
    // FileTree.tsx:407-411 렌더 로직과 동일해야 한다 (top-level만 filter)
    const filtered = new Set(["/r/docs/a.md"]);
    const out = computeVisibleEntries(
      tree,
      new Set(["/r/docs"]),
      filtered,
      matchesTagFilter,
    );
    // /r/z.md는 최상위에서 탈락, /r/docs/sub는 자식이라 남는다
    expect(out.map((e) => e.path)).toEqual([
      "/r/docs",
      "/r/docs/a.md",
      "/r/docs/sub",
    ]);
  });
});
```

- [ ] **Step 3: 테스트 실패 확인**

```bash
npx vitest run src/components/sidebar/__tests__/file-tree-visible.test.ts > /tmp/t1.log 2>&1; echo $?
tail -20 /tmp/t1.log
```
Expected: exit 1, "Failed to resolve import" 또는 "computeVisibleEntries is not a function"

- [ ] **Step 4: 구현**

`src/components/sidebar/file-tree-visible.ts`:

```ts
// §4.3 File tree — 렌더 순서와 동일한 가시 항목 평탄화
// Shift 범위 선택(use-file-tree-selection)과 키보드 내비게이션이 이 순서를 공유한다.
import type { FileEntry } from "../../stores/file/file";

/**
 * 파일 트리를 실제 렌더되는 행 순서로 평탄화한다.
 * 최상위는 태그 필터를 적용하고, 펼쳐진 폴더만 자식을 노출하며,
 * 자식은 태그 필터를 적용하지 않는다 (FileTree.tsx 렌더 로직과 동일).
 */
export function computeVisibleEntries(
  tree: FileEntry[],
  expandedDirs: Set<string>,
  filteredPaths: null | Set<string>,
  matchesTagFilter: (entry: FileEntry, paths: Set<string>) => boolean,
): FileEntry[] {
  const roots = filteredPaths
    ? tree.filter((e) => matchesTagFilter(e, filteredPaths))
    : tree;
  const out: FileEntry[] = [];
  const walk = (entries: FileEntry[]): void => {
    for (const e of entries) {
      out.push(e);
      if (e.isDir && expandedDirs.has(e.path) && e.children) {
        walk(e.children);
      }
    }
  };
  walk(roots);
  return out;
}
```

- [ ] **Step 5: 테스트 통과 확인**

```bash
npx vitest run src/components/sidebar/__tests__/file-tree-visible.test.ts > /tmp/t1.log 2>&1; echo $?
```
Expected: exit 0, 4 passed

- [ ] **Step 6: 커밋**

```bash
git add src/components/sidebar/file-tree-visible.ts src/components/sidebar/__tests__/file-tree-visible.test.ts
git commit -m "feat(§4.3): add visible-entry flattening util for file tree"
```

---

### Task 2: 멀티 선택 일괄 작업 헬퍼 (순수 함수)

**Files:**
- Create: `src/components/sidebar/file-tree-multi-ops.ts`
- Test: `src/components/sidebar/__tests__/file-tree-multi-ops.test.ts`

**Interfaces:**
- Produces (Task 6·7이 사용):
  - `pruneNestedPaths(paths: ReadonlySet<string>): string[]`
  - `resolveDragSet(sourcePath: string, selectedPaths: ReadonlySet<string>): string[]`
  - `planMultiMove(sourcePaths: string[], targetPath: string, rootPath: string): MultiMovePlan`
  - `interface MultiMovePlan { moves: { from: string; to: string }[]; skipped: string[] }`

- [ ] **Step 1: 실패하는 테스트 작성**

`src/components/sidebar/__tests__/file-tree-multi-ops.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import {
  planMultiMove,
  pruneNestedPaths,
  resolveDragSet,
} from "../file-tree-multi-ops";

describe("pruneNestedPaths", () => {
  it("조상이 선택에 있으면 자손을 제거한다", () => {
    const out = pruneNestedPaths(
      new Set(["/r/docs", "/r/docs/a.md", "/r/z.md"]),
    );
    expect(out.sort()).toEqual(["/r/docs", "/r/z.md"]);
  });

  it("형제 경로 접두어에는 오탐하지 않는다 (/r/doc vs /r/docs)", () => {
    const out = pruneNestedPaths(new Set(["/r/doc", "/r/docs/a.md"]));
    expect(out.sort()).toEqual(["/r/doc", "/r/docs/a.md"]);
  });
});

describe("resolveDragSet", () => {
  it("드래그 시작 노드가 선택에 포함되면 선택 전체(프룬됨)를 반환한다", () => {
    const sel = new Set(["/r/a.md", "/r/b.md"]);
    expect(resolveDragSet("/r/a.md", sel).sort()).toEqual([
      "/r/a.md",
      "/r/b.md",
    ]);
  });

  it("선택 밖 노드를 드래그하면 그 노드만 반환한다", () => {
    const sel = new Set(["/r/a.md"]);
    expect(resolveDragSet("/r/c.md", sel)).toEqual(["/r/c.md"]);
  });
});

describe("planMultiMove", () => {
  it("유효한 이동은 moves에, 무효(자기 자신/자기 하위/같은 부모)는 skipped에 담는다", () => {
    const plan = planMultiMove(
      ["/r/a.md", "/r/docs", "/r/target/already.md"],
      "/r/target",
      "/r",
    );
    expect(plan.moves).toEqual([
      { from: "/r/a.md", to: "/r/target/a.md" },
      { from: "/r/docs", to: "/r/target/docs" },
    ]);
    expect(plan.skipped).toEqual(["/r/target/already.md"]);
  });

  it("선택된 폴더의 내부로 드롭하면 그 폴더는 skipped된다", () => {
    const plan = planMultiMove(["/r/docs"], "/r/docs/sub", "/r");
    expect(plan.moves).toEqual([]);
    expect(plan.skipped).toEqual(["/r/docs"]);
  });

  it("루트로의 이동은 루트가 target일 때 startsWith 가드를 우회하지 않는다", () => {
    const plan = planMultiMove(["/r/docs/a.md"], "/r", "/r");
    expect(plan.moves).toEqual([{ from: "/r/docs/a.md", to: "/r/a.md" }]);
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

```bash
npx vitest run src/components/sidebar/__tests__/file-tree-multi-ops.test.ts > /tmp/t2.log 2>&1; echo $?
```
Expected: exit 1 (모듈 없음)

- [ ] **Step 3: 구현**

`src/components/sidebar/file-tree-multi-ops.ts`:

```ts
// §4.3 File tree — 멀티 선택 일괄 작업 헬퍼 (순수 함수)

/** 조상이 함께 선택된 자손 경로를 제거한다 (중복 이동/삭제 방지). */
export function pruneNestedPaths(paths: ReadonlySet<string>): string[] {
  const list = [...paths];
  return list.filter(
    (p) => !list.some((other) => other !== p && p.startsWith(other + "/")),
  );
}

/** 드래그 제스처가 옮길 경로 집합: 선택 내부에서 잡으면 선택 전체, 밖이면 그 행만. */
export function resolveDragSet(
  sourcePath: string,
  selectedPaths: ReadonlySet<string>,
): string[] {
  if (selectedPaths.has(sourcePath)) return pruneNestedPaths(selectedPaths);
  return [sourcePath];
}

export interface MultiMovePlan {
  moves: { from: string; to: string }[];
  skipped: string[];
}

/** 항목별 이동 유효성 검사 — use-file-tree-dnd의 단일 이동 규칙과 동일. */
export function planMultiMove(
  sourcePaths: string[],
  targetPath: string,
  rootPath: string,
): MultiMovePlan {
  const moves: { from: string; to: string }[] = [];
  const skipped: string[] = [];
  for (const source of sourcePaths) {
    const parent = source.substring(0, source.lastIndexOf("/"));
    const invalid =
      source === targetPath ||
      (targetPath !== rootPath && targetPath.startsWith(source + "/")) ||
      parent === targetPath;
    if (invalid) {
      skipped.push(source);
      continue;
    }
    const name = source.split("/").pop() ?? "";
    moves.push({ from: source, to: targetPath + "/" + name });
  }
  return { moves, skipped };
}
```

- [ ] **Step 4: 테스트 통과 확인**

```bash
npx vitest run src/components/sidebar/__tests__/file-tree-multi-ops.test.ts > /tmp/t2.log 2>&1; echo $?
```
Expected: exit 0, 6 passed

- [ ] **Step 5: 커밋**

```bash
git add src/components/sidebar/file-tree-multi-ops.ts src/components/sidebar/__tests__/file-tree-multi-ops.test.ts
git commit -m "feat(§4.3): add multi-selection batch-op helpers"
```

---

### Task 3: use-file-tree-selection 훅

**Files:**
- Create: `src/components/sidebar/hooks/use-file-tree-selection.ts`
- Test: `src/components/sidebar/__tests__/use-file-tree-selection.test.ts`

**Interfaces:**
- Produces (Task 4가 사용):

```ts
export interface UseFileTreeSelectionReturn {
  clearSelection: () => void;
  selectRange: (targetPath: string, visiblePaths: string[]) => void;
  selectSingle: (path: string) => void;
  selectedPaths: Set<string>;
  toggleSelect: (path: string) => void;
}
export function useFileTreeSelection(): UseFileTreeSelectionReturn;
```

- anchor는 훅 내부 ref — selectSingle/toggleSelect가 갱신하고 selectRange는 갱신하지 않는다(연속 Shift 클릭이 같은 앵커에서 재계산되는 표준 동작).

- [ ] **Step 1: 실패하는 테스트 작성**

`src/components/sidebar/__tests__/use-file-tree-selection.test.ts`:

```ts
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { useFileTreeSelection } from "../hooks/use-file-tree-selection";

const visible = ["/r/a.md", "/r/b.md", "/r/c.md", "/r/d.md"];

describe("useFileTreeSelection", () => {
  it("selectSingle은 선택을 1개로 교체한다", () => {
    const { result } = renderHook(() => useFileTreeSelection());
    act(() => result.current.selectSingle("/r/a.md"));
    act(() => result.current.selectSingle("/r/b.md"));
    expect([...result.current.selectedPaths]).toEqual(["/r/b.md"]);
  });

  it("toggleSelect는 추가/제거를 토글한다", () => {
    const { result } = renderHook(() => useFileTreeSelection());
    act(() => result.current.selectSingle("/r/a.md"));
    act(() => result.current.toggleSelect("/r/c.md"));
    expect([...result.current.selectedPaths].sort()).toEqual([
      "/r/a.md",
      "/r/c.md",
    ]);
    act(() => result.current.toggleSelect("/r/a.md"));
    expect([...result.current.selectedPaths]).toEqual(["/r/c.md"]);
  });

  it("selectRange는 앵커부터 대상까지 visible 순서로 선택한다 (역방향 포함)", () => {
    const { result } = renderHook(() => useFileTreeSelection());
    act(() => result.current.selectSingle("/r/c.md"));
    act(() => result.current.selectRange("/r/a.md", visible));
    expect([...result.current.selectedPaths].sort()).toEqual([
      "/r/a.md",
      "/r/b.md",
      "/r/c.md",
    ]);
  });

  it("연속 Shift 클릭은 같은 앵커에서 범위를 재계산한다", () => {
    const { result } = renderHook(() => useFileTreeSelection());
    act(() => result.current.selectSingle("/r/b.md"));
    act(() => result.current.selectRange("/r/d.md", visible));
    act(() => result.current.selectRange("/r/a.md", visible));
    expect([...result.current.selectedPaths].sort()).toEqual([
      "/r/a.md",
      "/r/b.md",
    ]);
  });

  it("앵커가 visible에 없으면 대상 단일 선택으로 폴백한다", () => {
    const { result } = renderHook(() => useFileTreeSelection());
    act(() => result.current.selectSingle("/gone.md"));
    act(() => result.current.selectRange("/r/b.md", visible));
    expect([...result.current.selectedPaths]).toEqual(["/r/b.md"]);
  });

  it("clearSelection은 선택을 비운다", () => {
    const { result } = renderHook(() => useFileTreeSelection());
    act(() => result.current.selectSingle("/r/a.md"));
    act(() => result.current.clearSelection());
    expect(result.current.selectedPaths.size).toBe(0);
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

```bash
npx vitest run src/components/sidebar/__tests__/use-file-tree-selection.test.ts > /tmp/t3.log 2>&1; echo $?
```
Expected: exit 1 (모듈 없음)

- [ ] **Step 3: 구현**

`src/components/sidebar/hooks/use-file-tree-selection.ts`:

```ts
// §4.3 File tree — 멀티 셀렉트 상태 훅 (단일/토글/범위 선택)
import { useCallback, useRef, useState } from "react";

export interface UseFileTreeSelectionReturn {
  clearSelection: () => void;
  selectRange: (targetPath: string, visiblePaths: string[]) => void;
  selectSingle: (path: string) => void;
  selectedPaths: Set<string>;
  toggleSelect: (path: string) => void;
}

export function useFileTreeSelection(): UseFileTreeSelectionReturn {
  const [selectedPaths, setSelectedPaths] = useState<Set<string>>(new Set());
  // Shift 범위 선택의 기준점 — selectRange는 갱신하지 않는다
  const anchorRef = useRef<null | string>(null);

  const selectSingle = useCallback((path: string): void => {
    anchorRef.current = path;
    setSelectedPaths(new Set([path]));
  }, []);

  const toggleSelect = useCallback((path: string): void => {
    anchorRef.current = path;
    setSelectedPaths((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }, []);

  const selectRange = useCallback(
    (targetPath: string, visiblePaths: string[]): void => {
      const anchor = anchorRef.current;
      const anchorIdx = anchor ? visiblePaths.indexOf(anchor) : -1;
      const targetIdx = visiblePaths.indexOf(targetPath);
      if (anchorIdx === -1 || targetIdx === -1) {
        anchorRef.current = targetPath;
        setSelectedPaths(new Set([targetPath]));
        return;
      }
      const [lo, hi] =
        anchorIdx <= targetIdx
          ? [anchorIdx, targetIdx]
          : [targetIdx, anchorIdx];
      setSelectedPaths(new Set(visiblePaths.slice(lo, hi + 1)));
    },
    [],
  );

  const clearSelection = useCallback((): void => {
    anchorRef.current = null;
    setSelectedPaths(new Set());
  }, []);

  return {
    selectedPaths,
    selectSingle,
    toggleSelect,
    selectRange,
    clearSelection,
  };
}
```

- [ ] **Step 4: 테스트 통과 확인**

```bash
npx vitest run src/components/sidebar/__tests__/use-file-tree-selection.test.ts > /tmp/t3.log 2>&1; echo $?
```
Expected: exit 0, 6 passed

- [ ] **Step 5: 커밋**

```bash
git add src/components/sidebar/hooks/use-file-tree-selection.ts src/components/sidebar/__tests__/use-file-tree-selection.test.ts
git commit -m "feat(§4.3): add use-file-tree-selection hook"
```

---

### Task 4: FileTree/FileTreeNode/Context 멀티 셀렉트 배선

**Files:**
- Modify: `src/components/sidebar/FileTree.tsx` (58, 96–146, 160–186, 342, 407–426행 부근)
- Modify: `src/components/sidebar/FileTreeNode.tsx` (14–51, 66–77, 137–144행 부근)
- Modify: `src/components/sidebar/FileTreeContext.tsx`
- Test: `src/components/sidebar/__tests__/file-tree-node-clicks.test.tsx`

**Interfaces:**
- Consumes: Task 1 `computeVisibleEntries`, Task 3 `useFileTreeSelection`
- Produces:
  - `FileTreeContextValue.selectedPaths: Set<string>` (기존 `selectedPath: null | string` 대체)
  - `FileTreeNode` props: `onFileClick: (entry: FileEntry, e: React.MouseEvent) => void`, `onDirClick: (entry: FileEntry, e: React.MouseEvent) => void` (기존 `onToggleDir: (path: string) => void` 대체)

- [ ] **Step 1: 실패하는 테스트 작성**

`src/components/sidebar/__tests__/file-tree-node-clicks.test.tsx`:

```tsx
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { FileEntry } from "../../../stores/file/file";
import type { FileTreeContextValue } from "../FileTreeContext";

import { FileTreeProvider } from "../FileTreeContext";
import { FileTreeNode } from "../FileTreeNode";

const ctx: FileTreeContextValue = {
  creatingEntry: null,
  dragOverPath: null,
  dragSourcePath: null,
  expandedDirs: new Set<string>(),
  renamingPath: null,
  selectedPaths: new Set<string>(),
};

const noop = (): void => {};

function renderNode(
  entry: FileEntry,
  handlers: {
    onDirClick?: (entry: FileEntry, e: React.MouseEvent) => void;
    onFileClick?: (entry: FileEntry, e: React.MouseEvent) => void;
  },
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
        onDirClick={handlers.onDirClick ?? noop}
        onFileClick={handlers.onFileClick ?? noop}
        onStartRename={noop}
      />
    </FileTreeProvider>,
  );
}

describe("FileTreeNode click wiring", () => {
  it("파일 클릭은 entry와 modifier가 담긴 이벤트를 전달한다", () => {
    const onFileClick = vi.fn();
    const entry: FileEntry = { name: "a.md", path: "/r/a.md", isDir: false };
    renderNode(entry, { onFileClick });
    fireEvent.click(screen.getByText("a.md"), { metaKey: true });
    expect(onFileClick).toHaveBeenCalledTimes(1);
    expect(onFileClick.mock.calls[0][0]).toEqual(entry);
    expect(onFileClick.mock.calls[0][1].metaKey).toBe(true);
  });

  it("폴더 클릭은 onDirClick으로 entry와 이벤트를 전달한다", () => {
    const onDirClick = vi.fn();
    const entry: FileEntry = {
      name: "docs",
      path: "/r/docs",
      isDir: true,
      children: [],
    };
    renderNode(entry, { onDirClick });
    fireEvent.click(screen.getByText("docs"), { shiftKey: true });
    expect(onDirClick).toHaveBeenCalledTimes(1);
    expect(onDirClick.mock.calls[0][1].shiftKey).toBe(true);
  });

  it("selectedPaths에 있는 파일·폴더 행은 active 클래스를 가진다", () => {
    const file: FileEntry = { name: "a.md", path: "/r/a.md", isDir: false };
    renderNode(file, {}, { selectedPaths: new Set(["/r/a.md"]) });
    expect(
      screen.getByText("a.md").closest(".file-tree-item")!.className,
    ).toContain("file-tree-item-active");
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

```bash
npx vitest run src/components/sidebar/__tests__/file-tree-node-clicks.test.tsx > /tmp/t4.log 2>&1; echo $?
```
Expected: exit 1 (`onDirClick` prop 없음 / `selectedPaths` 컨텍스트 필드 없음 — TS 에러)

- [ ] **Step 3: FileTreeContext.tsx 수정**

`FileTreeContextValue`에서 `selectedPath: null | string;` 한 줄을 다음으로 교체:

```ts
  selectedPaths: Set<string>;
```

- [ ] **Step 4: FileTreeNode.tsx 수정**

(a) props 교체 — `onToggleDir` 제거, `onDirClick` 추가. 컴포넌트 시그니처:

```tsx
export function FileTreeNode({
  entry,
  depth,
  onDirClick,
  onFileClick,
  onContextMenu,
  onStartRename,
  onConfirmRename,
  onCancelRename,
  onConfirmCreate,
  onCancelCreate,
}: {
  depth: number;
  entry: FileEntry;
  onCancelCreate: () => void;
  onCancelRename: () => void;
  onConfirmCreate: (name: string) => void;
  onConfirmRename: (oldPath: string, newName: string) => void;
  onContextMenu: (e: React.MouseEvent, path: string, isDir: boolean) => void;
  onDirClick: (entry: FileEntry, e: React.MouseEvent) => void;
  onFileClick: (entry: FileEntry, e: React.MouseEvent) => void;
  onStartRename: (path: string) => void;
}): React.JSX.Element {
```

(b) 컨텍스트 구독과 selected 계산 교체 (37–49행):

```tsx
  const {
    selectedPaths,
    renamingPath,
    creatingEntry,
    expandedDirs,
    dragOverPath,
    dragSourcePath,
  } = useFileTreeContext();
  // ...
  const isSelected = selectedPaths.has(entry.path);
```

(c) 폴더 행(72–77행): onClick과 className 교체:

```tsx
        <div
          className={`file-tree-item file-tree-dir ${isSelected ? "file-tree-item-active" : ""}`}
          onClick={(e) => onDirClick(entry, e)}
          onContextMenu={(e) => onContextMenu(e, entry.path, true)}
          style={{ paddingLeft }}
        >
```

(d) 파일 행 onClick(141행): `onClick={(e) => !isRenaming && onFileClick(entry, e)}`

(e) 재귀 렌더(116–128행)의 `onToggleDir={onToggleDir}` → `onDirClick={onDirClick}`

- [ ] **Step 5: FileTree.tsx 수정**

(a) import 추가/정리:

```tsx
import { computeVisibleEntries } from "./file-tree-visible";
import { useFileTreeSelection } from "./hooks/use-file-tree-selection";
```

(b) 58행 `const [selectedPath, setSelectedPath] = useState<null | string>(null);` 삭제, 훅으로 교체:

```tsx
  const { selectedPaths, selectSingle, toggleSelect, selectRange } =
    useFileTreeSelection();
```

(c) visible list와 primaryPath 계산 추가 (search 훅 아래):

```tsx
  const visiblePaths = useMemo(
    () =>
      computeVisibleEntries(
        fileTree,
        expandedDirs,
        filteredPaths,
        entryMatchesTagFilter,
      ).map((e) => e.path),
    [fileTree, expandedDirs, filteredPaths, entryMatchesTagFilter],
  );
  // 단일 선택일 때만 유효한 대상 (F2 rename 등 단일 작업용)
  const primaryPath = selectedPaths.size === 1 ? [...selectedPaths][0] : null;
```

(d) 탭 동기화(99–101행):

```tsx
  useEffect(() => {
    if (activeFilePath) selectSingle(activeFilePath);
  }, [activeFilePath, selectSingle]);
```

(e) 키보드(128–146행) — `selectedPath` → `primaryPath` (일괄 삭제는 Task 6에서 확장):

```tsx
  const handleTreeKeyDown = useCallback(
    (e: React.KeyboardEvent): void => {
      if (e.key === "F2" && primaryPath && !renamingPath) {
        e.preventDefault();
        setRenamingPath(primaryPath);
      }
      if (
        (e.key === "Delete" || e.key === "Backspace") &&
        primaryPath &&
        !renamingPath &&
        e.metaKey
      ) {
        e.preventDefault();
        handleDelete(primaryPath);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [primaryPath, renamingPath],
  );
```

(f) `handleToggleDir`(153–158행)를 `handleDirClick`으로 교체:

```tsx
  const handleDirClick = useCallback(
    (entry: FileEntry, e: React.MouseEvent): void => {
      if (suppressClickRef.current) return;
      treeRef.current?.focus();
      if (e.shiftKey) {
        selectRange(entry.path, visiblePaths);
        return;
      }
      if (e.metaKey || e.ctrlKey) {
        toggleSelect(entry.path);
        return;
      }
      selectSingle(entry.path);
      toggleExpandedDir(entry.path);
    },
    [
      toggleExpandedDir,
      selectRange,
      selectSingle,
      toggleSelect,
      visiblePaths,
      suppressClickRef,
    ],
  );
```

(g) `handleFileClick`(160–186행) — 이벤트 파라미터 추가, modifier 분기:

```tsx
  const handleFileClick = useCallback(
    async (entry: FileEntry, e: React.MouseEvent): Promise<void> => {
      if (suppressClickRef.current) return;
      treeRef.current?.focus();
      if (e.shiftKey) {
        selectRange(entry.path, visiblePaths);
        return;
      }
      if (e.metaKey || e.ctrlKey) {
        toggleSelect(entry.path);
        return;
      }
      selectSingle(entry.path);
      const existing = tabs.find((t) => t.filePath === entry.path);
      if (existing) {
        useEditorStore.getState().setActiveTab(existing.id);
        return;
      }
      try {
        const content = await readFile(entry.path);
        setFileContent(entry.path, content);
        openTab({
          contextId: "",
          id: crypto.randomUUID(),
          filePath: entry.path,
          title: entry.name,
          isDirty: false,
          isPinned: false,
        });
      } catch (err) {
        logger.error("[FileTree] Failed to read file:", err);
      }
    },
    [
      tabs,
      setFileContent,
      openTab,
      suppressClickRef,
      selectRange,
      selectSingle,
      toggleSelect,
      visiblePaths,
    ],
  );
```

(h) ctxValue(251–268행): `selectedPath` → `selectedPaths` (변수·deps 모두)

(i) 검색 결과 행(342, 344–351행): className 조건 `selectedPaths.has(file.path)`, onClick에 이벤트 전달:

```tsx
                onClick={(e) => {
                  handleFileClick(
                    { name: file.name, path: file.path, isDir: false },
                    e,
                  );
                  setSearchQuery("");
                }}
```

(j) FileTreeNode 렌더(413–425행): `onToggleDir={handleToggleDir}` → `onDirClick={handleDirClick}`

- [ ] **Step 6: 테스트·타입 통과 확인**

```bash
npx vitest run src/components/sidebar/__tests__/file-tree-node-clicks.test.tsx > /tmp/t4.log 2>&1; echo $?
npm run typecheck > /tmp/tc4.log 2>&1; echo $?
```
Expected: 둘 다 exit 0

- [ ] **Step 7: 전체 테스트 회귀 확인**

```bash
npm test > /tmp/full4.log 2>&1; echo $?
tail -5 /tmp/full4.log
```
Expected: exit 0 (기존 2,700+ 테스트 통과)

- [ ] **Step 8: 커밋**

```bash
git add src/components/sidebar/
git commit -m "feat(§4.3): wire multi-select clicks into FileTree"
```

---

### Task 5: Rust 휴지통 삭제 전환

**Files:**
- Modify: `src-tauri/Cargo.toml` (44행 뒤 dependencies에 추가)
- Modify: `src-tauri/src/fs/mod.rs` (FsError 12–19행, delete_dir 183–190행, delete_file 204–211행, 테스트 mod 387행~)
- Modify: `src/components/sidebar/hooks/use-file-tree-crud.ts` (44–48행 문구)

**Interfaces:**
- 시그니처 불변: `pub async fn delete_file(path: &str) -> Result<(), FsError>`, `pub async fn delete_dir(path: &str) -> Result<(), FsError>` — fs_cmd.rs와 프론트 IPC 래퍼는 수정하지 않는다.

- [ ] **Step 1: 실패하는 테스트 작성**

`src-tauri/src/fs/mod.rs`의 기존 `#[cfg(test)] mod` 안에 추가:

```rust
    /// delete_file은 영구 삭제가 아니라 휴지통 이동이어야 한다.
    /// CI 컨테이너 등 휴지통 백엔드가 없는 환경에서는 TrashError로 조기 반환(스킵).
    #[tokio::test]
    async fn delete_file_moves_entry_out_of_place() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("trash-me.md");
        std::fs::write(&file, "bye").unwrap();
        let res = delete_file(file.to_str().unwrap()).await;
        if let Err(FsError::TrashError(_)) = res {
            return; // trash 백엔드 없는 환경 — 스킵
        }
        res.unwrap();
        assert!(!file.exists());
    }

    #[tokio::test]
    async fn delete_dir_moves_entry_out_of_place() {
        let dir = tempfile::tempdir().unwrap();
        let sub = dir.path().join("subdir");
        std::fs::create_dir(&sub).unwrap();
        std::fs::write(sub.join("inner.md"), "x").unwrap();
        let res = delete_dir(sub.to_str().unwrap()).await;
        if let Err(FsError::TrashError(_)) = res {
            return;
        }
        res.unwrap();
        assert!(!sub.exists());
    }
```

- [ ] **Step 2: 테스트 실패 확인 (컴파일 에러)**

```bash
cd /Users/donghoon.yoo/work/projects/baram/src-tauri && cargo test delete_file_moves delete_dir_moves > /tmp/rust5.log 2>&1; echo $?
```
Expected: exit 101 — `TrashError` variant 없음 컴파일 에러 (콜드 빌드면 5분+ 소요 가능)

- [ ] **Step 3: 구현**

(a) `src-tauri/Cargo.toml` — `tauri-plugin-clipboard-manager = "2"` 아래에 추가:

```toml
trash = "5"
```

(b) `fs/mod.rs` FsError에 variant 추가:

```rust
    #[error("휴지통 이동 실패: {0}")]
    TrashError(String),
```

(c) delete_dir/delete_file 본문 교체 + 공용 헬퍼:

```rust
/// 디렉토리를 OS 휴지통으로 이동 (영구 삭제 아님)
pub async fn delete_dir(path: &str) -> Result<(), FsError> {
    if !Path::new(path).exists() {
        return Err(FsError::NotFound(path.to_string()));
    }
    move_to_trash(path).await
}
```

```rust
/// 파일을 OS 휴지통으로 이동 (영구 삭제 아님)
pub async fn delete_file(path: &str) -> Result<(), FsError> {
    if !Path::new(path).exists() {
        return Err(FsError::NotFound(path.to_string()));
    }
    move_to_trash(path).await
}

/// trash crate는 blocking API이므로 spawn_blocking으로 감싼다.
/// 실패 시 영구 삭제로 폴백하지 않는다 (안전 우선 — spec §4.2).
async fn move_to_trash(path: &str) -> Result<(), FsError> {
    let owned = path.to_string();
    tokio::task::spawn_blocking(move || trash::delete(&owned))
        .await
        .map_err(|e| FsError::TrashError(e.to_string()))?
        .map_err(|e| FsError::TrashError(e.to_string()))
}
```

(d) `use-file-tree-crud.ts` 44–48행 확인 문구 교체:

```ts
      const confirmed = await showConfirm(
        entry.isDir
          ? `Move folder "${entry.name}" and all its contents to Trash?`
          : `Move file "${entry.name}" to Trash?`,
      );
```

- [ ] **Step 4: 호출자 의미 변경 영향 확인**

```bash
grep -rn "deleteFile\|deleteDir" /Users/donghoon.yoo/work/projects/baram/src --include="*.ts" --include="*.tsx" | grep -v __tests__ | grep -v "ipc/"
```
각 호출처를 열어 "영구 삭제"를 전제하는 곳이 없는지 확인. 휴지통 이동은 순안전 방향이므로 원칙적으로 모두 OK — 발견 사항은 PR 본문에 기록.

- [ ] **Step 5: 테스트 통과 확인**

```bash
cd /Users/donghoon.yoo/work/projects/baram/src-tauri && cargo test delete_ > /tmp/rust5.log 2>&1; echo $?
tail -10 /tmp/rust5.log
```
Expected: exit 0. macOS 로컬에서는 실제 휴지통 이동 검증, 이후 GUI에서 복구 확인.

- [ ] **Step 6: 커밋**

```bash
cd /Users/donghoon.yoo/work/projects/baram
git add src-tauri/Cargo.toml src-tauri/Cargo.lock src-tauri/src/fs/mod.rs src/components/sidebar/hooks/use-file-tree-crud.ts
git commit -m "feat(§4.3): move file/dir deletion to OS trash"
```

---

### Task 6: showAlert 유틸 + 일괄 삭제

**Files:**
- Modify: `src/utils/confirm-dialog.ts` (showAlert 추가)
- Modify: `src/components/sidebar/hooks/use-file-tree-crud.ts` (handleDeleteMany 추가)
- Modify: `src/components/sidebar/FileTree.tsx` (키보드 Delete 확장)
- Test: `src/components/sidebar/__tests__/use-file-tree-crud-batch.test.ts`

**Interfaces:**
- Consumes: Task 2 `pruneNestedPaths`
- Produces:
  - `showAlert(message: string): Promise<void>` (`src/utils/confirm-dialog.ts`) — Task 7도 사용
  - `UseFileTreeCrudReturn.handleDeleteMany: (paths: string[]) => Promise<void>`

- [ ] **Step 1: 실패하는 테스트 작성**

`src/components/sidebar/__tests__/use-file-tree-crud-batch.test.ts`:

```ts
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useFileStore } from "../../../stores/file/file";
import { useFileTreeCrud } from "../hooks/use-file-tree-crud";

vi.mock("../../../ipc/invoke", () => ({
  createDir: vi.fn().mockResolvedValue(undefined),
  deleteDir: vi.fn().mockResolvedValue(undefined),
  deleteFile: vi.fn().mockResolvedValue(undefined),
  writeFile: vi.fn().mockResolvedValue(undefined),
  listDir: vi.fn().mockResolvedValue([]),
  refreshIndex: vi.fn().mockResolvedValue(undefined),
  setVaultRoot: vi.fn().mockResolvedValue(undefined),
  getFilesByTag: vi.fn().mockResolvedValue([]),
  getLinkIndex: vi.fn().mockResolvedValue({ links: [], backlinks: [] }),
}));

vi.mock("../../../utils/confirm-dialog", () => ({
  showConfirm: vi.fn().mockResolvedValue(true),
  showAlert: vi.fn().mockResolvedValue(undefined),
}));

import { deleteDir, deleteFile } from "../../../ipc/invoke";
import { showAlert, showConfirm } from "../../../utils/confirm-dialog";

beforeEach(() => {
  vi.clearAllMocks();
  useFileStore.setState({
    rootPath: "/r",
    fileTree: [
      {
        name: "docs",
        path: "/r/docs",
        isDir: true,
        children: [{ name: "a.md", path: "/r/docs/a.md", isDir: false }],
      },
      { name: "b.md", path: "/r/b.md", isDir: false },
      { name: "c.md", path: "/r/c.md", isDir: false },
    ],
  });
});

describe("handleDeleteMany", () => {
  it("확인 1회 후 각 항목을 타입별 IPC로 삭제한다", async () => {
    const { result } = renderHook(() => useFileTreeCrud());
    await act(() => result.current.handleDeleteMany(["/r/b.md", "/r/docs"]));
    expect(showConfirm).toHaveBeenCalledTimes(1);
    expect(vi.mocked(showConfirm).mock.calls[0][0]).toContain("2 items");
    expect(deleteFile).toHaveBeenCalledWith("/r/b.md");
    expect(deleteDir).toHaveBeenCalledWith("/r/docs");
  });

  it("조상이 선택되면 자손은 삭제 호출에서 제외된다", async () => {
    const { result } = renderHook(() =>useFileTreeCrud());
    await act(() =>
      result.current.handleDeleteMany(["/r/docs", "/r/docs/a.md"]),
    );
    expect(deleteFile).not.toHaveBeenCalled();
    expect(deleteDir).toHaveBeenCalledTimes(1);
  });

  it("일부 실패 시 나머지는 계속 진행하고 showAlert로 보고한다", async () => {
    vi.mocked(deleteFile).mockRejectedValueOnce(new Error("locked"));
    const { result } = renderHook(() => useFileTreeCrud());
    await act(() => result.current.handleDeleteMany(["/r/b.md", "/r/c.md"]));
    expect(deleteFile).toHaveBeenCalledTimes(2);
    expect(showAlert).toHaveBeenCalledTimes(1);
    expect(vi.mocked(showAlert).mock.calls[0][0]).toContain("b.md");
  });

  it("1개 경로는 단일 삭제 플로우(파일명 포함 문구)로 위임한다", async () => {
    const { result } = renderHook(() => useFileTreeCrud());
    await act(() => result.current.handleDeleteMany(["/r/b.md"]));
    expect(vi.mocked(showConfirm).mock.calls[0][0]).toContain('"b.md"');
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

```bash
npx vitest run src/components/sidebar/__tests__/use-file-tree-crud-batch.test.ts > /tmp/t6.log 2>&1; echo $?
```
Expected: exit 1 (`handleDeleteMany` 없음 — TS 에러)

- [ ] **Step 3: showAlert 구현**

`src/utils/confirm-dialog.ts` 끝에 추가 (showConfirm과 같은 DOM 패턴):

```ts
/** 단일 확인 버튼 알림 — 일괄 작업 실패 보고용 (§4.3) */
export function showAlert(message: string): Promise<void> {
  return new Promise((resolve) => {
    const overlay = document.createElement("div");
    overlay.className = "ai-prompt-overlay";

    const dialog = document.createElement("div");
    dialog.className = "ai-prompt-dialog";

    const label = document.createElement("p");
    label.className = "ai-prompt-label";
    label.textContent = message;

    const btnRow = document.createElement("div");
    btnRow.className = "ai-prompt-buttons";

    const okBtn = document.createElement("button");
    okBtn.className = "ai-prompt-btn";
    okBtn.textContent = "OK";

    btnRow.appendChild(okBtn);
    dialog.appendChild(label);
    dialog.appendChild(btnRow);
    overlay.appendChild(dialog);
    document.body.appendChild(overlay);

    const handleKeydown = (e: KeyboardEvent): void => {
      if (e.key === "Enter" || e.key === "Escape") {
        e.preventDefault();
        cleanup();
      }
    };

    const cleanup = (): void => {
      document.removeEventListener("keydown", handleKeydown);
      overlay.remove();
      resolve();
    };

    okBtn.addEventListener("click", cleanup);
    overlay.addEventListener("mousedown", (e) => {
      if (e.target === overlay) cleanup();
    });
    document.addEventListener("keydown", handleKeydown);

    requestAnimationFrame(() => okBtn.focus());
  });
}
```

- [ ] **Step 4: handleDeleteMany 구현**

`use-file-tree-crud.ts`:

(a) import 추가:

```ts
import { pruneNestedPaths } from "../file-tree-multi-ops";
import { showAlert, showConfirm } from "../../../utils/confirm-dialog";
```
(기존 `showConfirm` 단독 import 줄은 위 줄로 대체)

(b) 인터페이스에 추가:

```ts
  handleDeleteMany: (paths: string[]) => Promise<void>;
```

(c) `handleDelete` 아래에 구현 (탭 정리·트리 제거는 handleDelete와 동일 패턴):

```ts
  const handleDeleteMany = useCallback(
    async (paths: string[]): Promise<void> => {
      if (!rootPath || paths.length === 0) return;
      const targets = pruneNestedPaths(new Set(paths));
      if (targets.length === 1) {
        await handleDelete(targets[0]);
        return;
      }
      const entries = targets
        .map((p) => findEntryByPath(useFileStore.getState().fileTree, p))
        .filter((e): e is FileEntry => e !== null);
      if (entries.length === 0) return;
      const hasDir = entries.some((e) => e.isDir);
      const confirmed = await showConfirm(
        hasDir
          ? `Move ${entries.length} items (including folders) to Trash?`
          : `Move ${entries.length} items to Trash?`,
      );
      if (!confirmed) return;
      const failed: string[] = [];
      for (const entry of entries) {
        try {
          if (entry.isDir) await deleteDir(entry.path);
          else await deleteFile(entry.path);
          const { tabs: currentTabs } = useEditorStore.getState();
          for (const tab of currentTabs) {
            if (
              tab.filePath === entry.path ||
              tab.filePath?.startsWith(entry.path + "/")
            )
              closeTab(tab.id);
          }
          removeFileEntry(entry.path);
        } catch (err) {
          logger.error("[FileTree] Delete failed:", entry.path, err);
          failed.push(entry.name);
        }
      }
      useLinkStore.getState().invalidate();
      if (failed.length > 0) {
        await showAlert(`Failed to move to Trash: ${failed.join(", ")}`);
      }
    },
    [rootPath, closeTab, removeFileEntry, handleDelete],
  );
```

(d) return 객체에 `handleDeleteMany` 추가.

- [ ] **Step 5: FileTree.tsx 키보드 Delete를 일괄 삭제로 확장**

Task 4에서 만든 handleTreeKeyDown의 Delete 분기 교체:

```tsx
      if (
        (e.key === "Delete" || e.key === "Backspace") &&
        selectedPaths.size > 0 &&
        !renamingPath &&
        e.metaKey
      ) {
        e.preventDefault();
        handleDeleteMany([...selectedPaths]);
      }
```
deps를 `[primaryPath, renamingPath, selectedPaths]`로 갱신하고, crud 훅 구조분해에 `handleDeleteMany` 추가.

- [ ] **Step 6: 테스트·타입·회귀 확인**

```bash
npx vitest run src/components/sidebar/__tests__/use-file-tree-crud-batch.test.ts > /tmp/t6.log 2>&1; echo $?
npm run typecheck > /tmp/tc6.log 2>&1; echo $?
npm test > /tmp/full6.log 2>&1; echo $?
```
Expected: 모두 exit 0. (훅 테스트에서 스토어 import 체인이 다른 IPC 함수를 요구해 mock이 부족하면, 에러 메시지에 나온 export를 `vi.mock("../../../ipc/invoke")` 팩토리에 `vi.fn()`으로 추가한다 — 기존 테스트들(`src/hooks/__tests__/`)과 동일한 관례.)

- [ ] **Step 7: 커밋**

```bash
git add src/utils/confirm-dialog.ts src/components/sidebar/
git commit -m "feat(§4.3): batch delete to trash for multi-selection"
```

---

### Task 7: DnD 다중 이동

**Files:**
- Modify: `src/components/sidebar/file-tree-types.ts` (DragState)
- Modify: `src/components/sidebar/hooks/use-file-tree-dnd.ts`
- Modify: `src/components/sidebar/FileTree.tsx` (훅 인자·컨텍스트)
- Modify: `src/components/sidebar/FileTreeContext.tsx` (dragSourcePaths)
- Modify: `src/components/sidebar/FileTreeNode.tsx` (isDragSource)
- Modify: `src/stores/file/file.ts` (moveFileEntry openFiles prefix 갱신 — 423–449행)
- Modify: `src/components/sidebar/__tests__/file-tree-node-clicks.test.tsx` (ctx 필드명)
- Test: `src/stores/__tests__/file-move-openfiles.test.ts`

**Interfaces:**
- Consumes: Task 2 `resolveDragSet`, `planMultiMove`; Task 6 `showAlert`
- Produces:
  - `DragState.sourcePaths: string[]` (기존 `sourcePath: string` 대체)
  - `useFileTreeDnD(editor, selectedPaths: Set<string>)` — 두 번째 파라미터 추가
  - `UseFileTreeDnDReturn.dragSourcePaths: string[]` + `FileTreeContextValue.dragSourcePaths: string[]` (기존 `dragSourcePath: null | string` 대체)

- [ ] **Step 1: 실패하는 테스트 작성 (moveFileEntry 폴더 이동 시 openFiles 키 갱신)**

배경: 기존 `moveFileEntry`는 openFiles에서 정확히 일치하는 키만 옮긴다(파일만 드래그 가능했으므로 잠재적이었음). 멀티 드래그로 폴더 이동이 가능해지면 폴더 내 열린 파일의 콘텐츠 캐시 키가 낡아 저장이 옛 경로로 가는 실버그가 표면화된다 — prefix 갱신으로 수정한다.

`src/stores/__tests__/file-move-openfiles.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../ipc/invoke", () => ({
  listDir: vi.fn().mockResolvedValue([]),
  refreshIndex: vi.fn().mockResolvedValue(undefined),
  setVaultRoot: vi.fn().mockResolvedValue(undefined),
}));

import { useFileStore } from "../file/file";

beforeEach(() => {
  useFileStore.setState({
    rootPath: "/r",
    fileTree: [
      {
        name: "docs",
        path: "/r/docs",
        isDir: true,
        children: [{ name: "a.md", path: "/r/docs/a.md", isDir: false }],
      },
      { name: "dest", path: "/r/dest", isDir: true, children: [] },
    ],
    openFiles: new Map([
      ["/r/docs/a.md", "content-a"],
      ["/r/unrelated.md", "keep"],
    ]),
  });
});

describe("moveFileEntry openFiles key migration", () => {
  it("폴더 이동 시 하위 파일의 openFiles 키가 새 경로로 이동한다", () => {
    useFileStore.getState().moveFileEntry("/r/docs", "/r/dest");
    const files = useFileStore.getState().openFiles;
    expect(files.get("/r/dest/docs/a.md")).toBe("content-a");
    expect(files.has("/r/docs/a.md")).toBe(false);
    expect(files.get("/r/unrelated.md")).toBe("keep");
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

```bash
npx vitest run src/stores/__tests__/file-move-openfiles.test.ts > /tmp/t7.log 2>&1; echo $?
```
Expected: exit 1 — `files.get("/r/dest/docs/a.md")`가 undefined

- [ ] **Step 3: moveFileEntry 수정**

`src/stores/file/file.ts` moveFileEntry 내부(443–449행)의 openFiles 단일 키 이동을 prefix 루프로 교체 (renameFileEntry 321–329행과 동일 패턴):

```ts
      // Update openFiles keys (dir move includes children keys)
      const openFiles = new Map(state.openFiles);
      for (const [key, value] of state.openFiles) {
        if (key === oldPath || key.startsWith(oldPath + "/")) {
          openFiles.delete(key);
          openFiles.set(newPath + key.slice(oldPath.length), value);
        }
      }
```

- [ ] **Step 4: 테스트 통과 확인**

```bash
npx vitest run src/stores/__tests__/file-move-openfiles.test.ts > /tmp/t7.log 2>&1; echo $?
```
Expected: exit 0

- [ ] **Step 5: DragState·컨텍스트·DnD 훅 다중화**

(a) `file-tree-types.ts` DragState 교체:

```ts
export interface DragState {
  active: boolean;
  /** 단일 드래그 시 고스트에 표시할 파일명 */
  sourceName: string;
  sourcePaths: string[];
  startX: number;
  startY: number;
}
```

(b) `FileTreeContext.tsx`: `dragSourcePath: null | string;` → `dragSourcePaths: string[];`

(c) `use-file-tree-dnd.ts` 수정:

- import 추가:

```ts
import { planMultiMove, resolveDragSet } from "../file-tree-multi-ops";
import { showAlert } from "../../../utils/confirm-dialog";
```

- 시그니처·반환 타입:

```ts
interface UseFileTreeDnDReturn {
  dragOverPath: null | string;
  dragSourcePaths: string[];
  handleTreeMouseDown: (e: React.MouseEvent) => void;
  isDragging: boolean;
  suppressClickRef: React.RefObject<boolean>;
}

export function useFileTreeDnD(
  editor: Editor | null | undefined,
  selectedPaths: Set<string>,
): UseFileTreeDnDReturn {
```

- 상태: `const [dragSourcePaths, setDragSourcePaths] = useState<string[]>([]);` (기존 dragSourcePath state 대체; setDragSourcePath(...) 호출부는 `setDragSourcePaths(state.sourcePaths)` / `setDragSourcePaths([])`로)

- 고스트 생성(85행): 다중이면 개수 라벨:

```ts
        createDragGhost(
          state.sourcePaths.length > 1
            ? `${state.sourcePaths.length} items`
            : state.sourceName,
          e.clientX,
          e.clientY,
        );
```

- 에디터 이미지 삽입 분기(101, 157행): `state.sourcePath` → 단일일 때만:

```ts
      const singleSource =
        state.sourcePaths.length === 1 ? state.sourcePaths[0] : null;
```
mousemove 쪽 조건은 `if (editor && singleSource && isImageFile(singleSource))`, mouseup 쪽도 동일하게 `singleSource` 기반으로 치환 (내부의 `sourcePath` 사용처는 모두 `singleSource`).

- mouseup 이동 로직(182–208행) 교체:

```ts
      const folderEl = el?.closest<HTMLElement>("[data-drop-path]");
      const targetPath = folderEl?.dataset.dropPath || currentRootPath;

      const { moves } = planMultiMove(
        state.sourcePaths,
        targetPath,
        currentRootPath,
      );
      if (moves.length === 0) return;

      const failed: string[] = [];
      for (const { from, to } of moves) {
        try {
          await renameFile(from, to);
          moveFileEntry(from, targetPath);
          const { tabs: currentTabs } = useEditorStore.getState();
          for (const tab of currentTabs) {
            if (tab.filePath === from) {
              renameTab(from, to, to.split("/").pop() ?? "");
            } else if (tab.filePath?.startsWith(from + "/")) {
              // 폴더 이동: 내부 파일 탭 경로 갱신 (제목 불변)
              renameTab(tab.filePath, to + tab.filePath.slice(from.length), tab.title);
            }
          }
        } catch (err) {
          logger.error("[FileTree] Move failed:", from, err);
          failed.push(from.split("/").pop() ?? from);
        }
      }
      useLinkStore.getState().invalidate();
      if (failed.length > 0) {
        await showAlert(`Failed to move: ${failed.join(", ")}`);
      }
```

- `handleTreeMouseDown`(222–239행): 드래그 세트 계산 + deps:

```ts
  const handleTreeMouseDown = useCallback(
    (e: React.MouseEvent): void => {
      if (e.button !== 0) return;
      const tag = (e.target as HTMLElement).tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      const fileEl = (e.target as HTMLElement).closest<HTMLElement>(
        "[data-file-path]",
      );
      if (!fileEl?.dataset.filePath) return;
      const parts = fileEl.dataset.filePath.split("/");
      dragRef.current = {
        sourcePaths: resolveDragSet(fileEl.dataset.filePath, selectedPaths),
        sourceName: parts[parts.length - 1],
        startX: e.clientX,
        startY: e.clientY,
        active: false,
      };
    },
    [selectedPaths],
  );
```

- 반환 객체의 `dragSourcePath` → `dragSourcePaths`.

(d) `FileTree.tsx`: `useFileTreeDnD(editor)` → `useFileTreeDnD(editor, selectedPaths)` (선택 훅 호출을 DnD 훅 호출보다 위로 이동), 구조분해·ctxValue의 `dragSourcePath` → `dragSourcePaths`.

(e) `FileTreeNode.tsx`: `dragSourcePath` 구독 → `dragSourcePaths`, `const isDragSource = dragSourcePaths.includes(entry.path);`

(f) `__tests__/file-tree-node-clicks.test.tsx` ctx의 `dragSourcePath: null` → `dragSourcePaths: []`

- [ ] **Step 6: 타입·전체 테스트 확인**

```bash
npm run typecheck > /tmp/tc7.log 2>&1; echo $?
npm test > /tmp/full7.log 2>&1; echo $?
```
Expected: 둘 다 exit 0

- [ ] **Step 7: 커밋**

```bash
git add src/components/sidebar/ src/stores/
git commit -m "feat(§4.3): multi-item drag-and-drop move"
```

---

### Task 8: 최종 검증 + PR

**Files:** 없음 (검증 전용)

- [ ] **Step 1: 전체 게이트 실행**

```bash
cd /Users/donghoon.yoo/work/projects/baram
npm run typecheck > /tmp/final-tc.log 2>&1; echo $?
npm test > /tmp/final-test.log 2>&1; echo $?
npx knip > /tmp/final-knip.log 2>&1; echo $?
cd src-tauri && cargo test > /tmp/final-cargo.log 2>&1; echo $?
```
Expected: 모두 exit 0. 실패 시 원인을 수정하고 재실행 (미해결 상태로 다음 단계 금지).

- [ ] **Step 2: 수동 GUI 검증 (npm run tauri dev)**

체크리스트 — 각 항목을 실제 조작으로 확인:
1. Cmd+클릭으로 파일 2개 토글 선택/해제 (탭 안 열림)
2. Shift+클릭 범위 선택 — 펼친 폴더 자식 포함 순서
3. 폴더 Cmd+클릭 선택 (펼침 안 됨), 일반 클릭 (선택+펼침)
4. 선택 3개 드래그 → 고스트 "3 items" → 폴더 드롭 → 전부 이동
5. 폴더 포함 선택 Cmd+Delete → "(including folders)" 확인 문구 → 삭제 → **macOS 휴지통에서 복구 가능 확인**
6. 열린 탭이 있는 폴더를 이동 → 탭 유지 + 저장이 새 경로로 동작
7. 탭 전환 시 트리 선택이 활성 파일 1개로 리셋
8. 검색 결과 클릭·태그 필터 동작 회귀 없음

- [ ] **Step 3: push (백그라운드) + PR 생성**

```bash
git push -u origin feature/file-tree-multiselect-trash
```
(pre-push clippy+knip 콜드 5~7분 — 백그라운드 실행)

PR 제목: `feat(§4.3): file tree multi-select, batch operations, and trash delete`
PR 본문(영어): PR 스타일 규칙에 따라 Motivation / Design decisions (spec §3 결정 인용) / Architecture diagram (selection hook ↔ visible list ↔ DnD/CRUD 관계) / Implementation details / Test results (typecheck·vitest·cargo 로그 요약 + GUI 체크리스트 결과) / Checklist 포함. 스펙 경로와 "PR 1/5" 표기.

---

## Self-Review 결과

- **Spec coverage (PR1 범위)**: §4.1 클릭 규칙·혼합 선택·prune·탭 리셋·DnD 세트·고스트·순차 이동·실패 보고·일괄 삭제 확인 문구 → Task 2/3/4/6/7. §4.2 trash crate·폴백 없음·문구 → Task 5. §3 결정 1(훅 분리)·2(visible list)·4(커맨드 의미 변경) → Task 1/3/5. 컨텍스트 메뉴 축소 세트(§4.3 다중)는 PR2 범위로 이월 — 스펙 §5 표와 일치.
- **경계 케이스 반영**: 형제 접두어 오탐(`/r/doc` vs `/r/docs`), 루트 드롭 시 startsWith 가드 우회, 앵커 소실 폴백, 폴더 이동 시 열린 탭·openFiles 키 마이그레이션.
- **타입 일관성**: `selectedPaths: Set<string>`(훅→컨텍스트→노드), `dragSourcePaths: string[]`(훅 반환→컨텍스트→노드→테스트 ctx), `MultiMovePlan` 필드명 Task 2 정의 = Task 7 사용처 일치 확인.
