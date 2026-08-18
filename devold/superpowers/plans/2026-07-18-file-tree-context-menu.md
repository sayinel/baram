# File Tree Context Menu Expansion Implementation Plan (PR 2/5)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 파일 트리 우클릭 메뉴를 신규 컴포넌트로 분리하고 11개 액션(새 탭 열기 · 복제 · 이동… · 이름 변경 · 삭제 · 경로/상대경로/위키링크 복사 · Finder에서 보기 · 내보내기)으로 확장하며, 다중 선택 시 축소 메뉴를 제공한다.

**Architecture:** 현재 FileTree.tsx 안에 인라인된 4-액션 메뉴를 `file-tree-context-menu.tsx` 컴포넌트로 추출한다. 클립보드 라벨 생성은 순수 함수(`file-tree-clipboard.ts`)로, 이동 로직은 DnD와 모달이 공유하는 훅(`use-file-tree-move.ts`)으로 분리한다. "이동…"은 vault 폴더만 보여주는 신규 모달(`MoveToFolderModal.tsx`)로 처리한다.

**Tech Stack:** React 19 + TypeScript(strict, verbatimModuleSyntax), Zustand, Vitest + @testing-library/react, Tauri plugins (clipboard-manager, opener), Rust capabilities.

**Spec:** `dev/superpowers/specs/2026-07-18-file-tree-enhancements-design.md` §4.3, §5 PR2 행. **버전 히스토리 액션은 이번 PR 범위에서 제외**(별도 PR — snapshot 패널에 파일 모드 UI 신설 필요, 사용자 결정 2026-07-18).

## Global Constraints

- TypeScript strict + `verbatimModuleSyntax` — 타입 전용 import는 반드시 `import type`
- 컴포넌트에서 Zustand bare call 금지 — `useShallow((s) => ({...}))` 셀렉터 사용
- 공유 유틸리티 재구현 금지: `basename`/`dirname`/`getRelativePath`/`resolveNameConflict` → `src/utils/path-utils.ts` (이미 존재, 재사용)
- 파일명 kebab-case, 단일 파일 ~300줄 이하
- 테스트는 `npm test`(vitest run) — `npx jest` 금지. exit code는 파이프 없이 캡처: `cmd > /tmp/log 2>&1; echo $?`
- 커밋: Conventional Commits + § 참조, 영어 (예: `feat(§4.3): ...`)
- pre-push hook이 clippy+knip 실행(콜드 시 5~7분) — push는 백그라운드로
- `git commit --no-verify` 금지
- Tauri capability 권한 ID는 Tauri v2 표준(`clipboard-manager:allow-write-text`, `opener:allow-reveal-item-in-dir`) — 빌드로 검증

## 현재 상태 (조사 확인)

- 컨텍스트 메뉴는 FileTree.tsx에 인라인(handleContextMenu 241–253, handleEmptyAreaContextMenu 255–271, handleContextMenuAction 273–300, JSX 481–523). `ContextMenuState`는 `{ targetIsDir, targetPath, x, y }`(file-tree-types.ts:3–8). **`selectedPaths`를 아직 참조하지 않음.**
- `resolveNameConflict(fileName, existingNames: Set<string>): string` → `-1`, `-2` 순번 (path-utils.ts:70–88). `basename`/`dirname`/`getRelativePath`도 동일 파일에 존재.
- 클립보드: `writeText` from `@tauri-apps/plugin-clipboard-manager`. capability(`src-tauri/capabilities/default.json`)에는 `clipboard-manager:allow-write-image`만 있음 → `allow-write-text` 추가 필요.
- opener: `revealItemInDir` from `@tauri-apps/plugin-opener` (미사용). capability에 `opener:allow-reveal-item-in-dir` 추가 필요.
- Export: `openExportDialog(format?: ExportFormat)` (ui store, ui.ts:74). ExportDialog는 활성 에디터(`editor` prop)를 export → 파일을 탭으로 열고 활성화한 뒤 다이얼로그를 열면 됨.
- 복제: `copyFile(from, to)` (ipc/fs.ts) — 파일 전용, 재귀 복사 IPC 없음.
- 이동: 현재 DnD(use-file-tree-dnd.ts mouseup)가 `planMultiMove` → per-item `renameFile` + `moveFileEntry` + tab rename + `showAlert`를 수행. 이 로직을 공유 훅으로 추출.
- CSS: `.file-tree-context-menu`, `.file-tree-context-menu-item`, `-danger`, `-separator` (file-tree.css:180–). 모달은 dialogs.css 패턴 참고.

---

### Task 1: 브랜치 + 컨텍스트 메뉴 컴포넌트 분리 (동작 보존)

**Files:**
- Create: `src/components/sidebar/file-tree-context-menu.tsx`
- Modify: `src/components/sidebar/FileTree.tsx` (메뉴 JSX 481–523 제거, 컴포넌트로 교체)
- Test: `src/components/sidebar/__tests__/file-tree-context-menu.test.tsx`

**Interfaces:**
- Produces (Task 3–8이 확장):

```ts
export interface FileTreeContextMenuProps {
  menu: ContextMenuState;
  onAction: (action: string) => void;
}
export function FileTreeContextMenu(props: FileTreeContextMenuProps): React.JSX.Element;
```
현 시점 action 문자열: `"newFile" | "newFolder" | "rename" | "delete"` (기존과 동일).

- [ ] **Step 1: 브랜치 생성**

```bash
cd /Users/donghoon.yoo/work/projects/baram
git checkout main && git -c core.sshCommand="ssh -i ~/.ssh/id_ed25519_macbook" pull --ff-only && git checkout -b feature/file-tree-context-menu
```

- [ ] **Step 2: 실패하는 테스트 작성**

`src/components/sidebar/__tests__/file-tree-context-menu.test.tsx`:

```tsx
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { ContextMenuState } from "../file-tree-types";

import { FileTreeContextMenu } from "../file-tree-context-menu";

const base: ContextMenuState = { x: 10, y: 20, targetPath: null, targetIsDir: false };

describe("FileTreeContextMenu (baseline actions)", () => {
  it("빈 영역(targetPath=null)은 New File/New Folder만 보여준다", () => {
    render(<FileTreeContextMenu menu={base} onAction={vi.fn()} />);
    expect(screen.getByText("New File")).toBeInTheDocument();
    expect(screen.getByText("New Folder")).toBeInTheDocument();
    expect(screen.queryByText("Rename")).not.toBeInTheDocument();
    expect(screen.queryByText("Delete")).not.toBeInTheDocument();
  });

  it("파일 대상은 Rename/Delete를 보여주고 New File/New Folder는 숨긴다", () => {
    render(
      <FileTreeContextMenu
        menu={{ ...base, targetPath: "/r/a.md", targetIsDir: false }}
        onAction={vi.fn()}
      />,
    );
    expect(screen.getByText("Rename")).toBeInTheDocument();
    expect(screen.getByText("Delete")).toBeInTheDocument();
    expect(screen.queryByText("New File")).not.toBeInTheDocument();
  });

  it("폴더 대상은 New File/New Folder + Rename/Delete를 모두 보여준다", () => {
    render(
      <FileTreeContextMenu
        menu={{ ...base, targetPath: "/r/docs", targetIsDir: true }}
        onAction={vi.fn()}
      />,
    );
    expect(screen.getByText("New File")).toBeInTheDocument();
    expect(screen.getByText("Rename")).toBeInTheDocument();
  });

  it("항목 클릭이 onAction으로 액션 문자열을 전달한다", () => {
    const onAction = vi.fn();
    render(
      <FileTreeContextMenu
        menu={{ ...base, targetPath: "/r/a.md", targetIsDir: false }}
        onAction={onAction}
      />,
    );
    fireEvent.click(screen.getByText("Delete"));
    expect(onAction).toHaveBeenCalledWith("delete");
  });

  it("메뉴가 x/y 좌표에 위치한다", () => {
    const { container } = render(
      <FileTreeContextMenu menu={{ ...base, x: 42, y: 99 }} onAction={vi.fn()} />,
    );
    const el = container.querySelector<HTMLElement>(".file-tree-context-menu")!;
    expect(el.style.left).toBe("42px");
    expect(el.style.top).toBe("99px");
  });
});
```

- [ ] **Step 3: 테스트 실패 확인**

```bash
npx vitest run src/components/sidebar/__tests__/file-tree-context-menu.test.tsx > /tmp/t1.log 2>&1; echo $?
```
Expected: exit 1 (모듈 없음)

- [ ] **Step 4: 컴포넌트 구현**

`src/components/sidebar/file-tree-context-menu.tsx` — FileTree.tsx의 현재 JSX(481–523)를 그대로 옮긴다:

```tsx
// §4.3 File tree — context menu component (extracted from FileTree.tsx)
import type { ContextMenuState } from "./file-tree-types";

export interface FileTreeContextMenuProps {
  menu: ContextMenuState;
  onAction: (action: string) => void;
}

export function FileTreeContextMenu({
  menu,
  onAction,
}: FileTreeContextMenuProps): React.JSX.Element {
  const isEmptyArea = menu.targetPath === null;
  return (
    <div
      className="file-tree-context-menu"
      onClick={(e) => e.stopPropagation()}
      style={{ left: menu.x, top: menu.y }}
    >
      {(isEmptyArea || menu.targetIsDir) && (
        <>
          <div
            className="file-tree-context-menu-item"
            onClick={() => onAction("newFile")}
          >
            New File
          </div>
          <div
            className="file-tree-context-menu-item"
            onClick={() => onAction("newFolder")}
          >
            New Folder
          </div>
        </>
      )}
      {!isEmptyArea && (
        <>
          {menu.targetIsDir && (
            <div className="file-tree-context-menu-separator" />
          )}
          <div
            className="file-tree-context-menu-item"
            onClick={() => onAction("rename")}
          >
            Rename
          </div>
          <div
            className="file-tree-context-menu-item file-tree-context-menu-item-danger"
            onClick={() => onAction("delete")}
          >
            Delete
          </div>
        </>
      )}
    </div>
  );
}
```

- [ ] **Step 5: FileTree.tsx 배선 교체**

(a) import 추가: `import { FileTreeContextMenu } from "./file-tree-context-menu";`
(b) JSX 481–523의 `{contextMenu && (<div className="file-tree-context-menu" ...>...</div>)}` 전체를 교체:

```tsx
        {contextMenu && (
          <FileTreeContextMenu
            menu={contextMenu}
            onAction={handleContextMenuAction}
          />
        )}
```

- [ ] **Step 6: 테스트·타입·회귀 확인**

```bash
npx vitest run src/components/sidebar/__tests__/file-tree-context-menu.test.tsx > /tmp/t1.log 2>&1; echo $?
npm run typecheck > /tmp/tc1.log 2>&1; echo $?
npm test > /tmp/full1.log 2>&1; echo $?
```
Expected: 모두 exit 0

- [ ] **Step 7: 커밋**

```bash
git add src/components/sidebar/
git commit -m "refactor(§4.3): extract FileTreeContextMenu component"
```

---

### Task 2: 클립보드 라벨 순수 함수 + capability 권한

**Files:**
- Create: `src/components/sidebar/file-tree-clipboard.ts`
- Modify: `src-tauri/capabilities/default.json` (permissions 배열)
- Test: `src/components/sidebar/__tests__/file-tree-clipboard.test.ts`

**Interfaces:**
- Produces (Task 3이 사용):
  - `toRelativePath(absPath: string, rootPath: string): string` — vault 루트 기준 상대 경로(선행 슬래시 없음)
  - `toWikilinkLabel(absPath: string, rootPath: string, allPaths: string[]): string` — 확장자 제거한 파일명; vault 내에 같은(확장자 제거) 파일명이 2개 이상이면 확장자 제거한 vault-상대 경로

- [ ] **Step 1: 실패하는 테스트 작성**

`src/components/sidebar/__tests__/file-tree-clipboard.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { toRelativePath, toWikilinkLabel } from "../file-tree-clipboard";

describe("toRelativePath", () => {
  it("vault 루트 기준 상대 경로를 선행 슬래시 없이 반환한다", () => {
    expect(toRelativePath("/r/docs/a.md", "/r")).toBe("docs/a.md");
  });
  it("루트 바로 아래 파일은 파일명만 반환한다", () => {
    expect(toRelativePath("/r/a.md", "/r")).toBe("a.md");
  });
  it("루트 밖 경로는 절대 경로를 그대로 반환한다", () => {
    expect(toRelativePath("/other/a.md", "/r")).toBe("/other/a.md");
  });
});

describe("toWikilinkLabel", () => {
  const paths = ["/r/a.md", "/r/docs/a.md", "/r/unique.md"];
  it("파일명이 유일하면 확장자 제거한 파일명을 반환한다", () => {
    expect(toWikilinkLabel("/r/unique.md", "/r", paths)).toBe("unique");
  });
  it("동명(확장자 제거) 파일이 2개 이상이면 확장자 제거한 상대 경로를 반환한다", () => {
    expect(toWikilinkLabel("/r/docs/a.md", "/r", paths)).toBe("docs/a");
    expect(toWikilinkLabel("/r/a.md", "/r", paths)).toBe("a");
  });
  it("확장자 없는 파일은 파일명을 그대로 쓴다", () => {
    expect(toWikilinkLabel("/r/README", "/r", ["/r/README"])).toBe("README");
  });
});
```

주의: `docs/a`(동명) 케이스에서 `/r/a.md`도 base name `a`로 충돌하므로 둘 다 상대 경로를 써야 정확하다. 위 테스트의 `/r/a.md` → `a` 기대값은 **루트 바로 아래 파일은 상대 경로 == 파일명**이라 우연히 같음(루트 직속). 구현이 "충돌 시 상대 경로" 규칙을 따르면 `/r/a.md`의 상대 경로 = `a.md` → 확장자 제거 → `a`. 일관됨.

- [ ] **Step 2: 테스트 실패 확인**

```bash
npx vitest run src/components/sidebar/__tests__/file-tree-clipboard.test.ts > /tmp/t2.log 2>&1; echo $?
```
Expected: exit 1

- [ ] **Step 3: 구현**

`src/components/sidebar/file-tree-clipboard.ts`:

```ts
// §4.3 File tree — clipboard label helpers (pure functions)
import { basename } from "../../utils/path-utils";

/** vault 루트 기준 상대 경로 (선행 슬래시 없음). 루트 밖이면 절대 경로 그대로. */
export function toRelativePath(absPath: string, rootPath: string): string {
  if (absPath === rootPath) return "";
  if (absPath.startsWith(rootPath + "/")) {
    return absPath.slice(rootPath.length + 1);
  }
  return absPath;
}

/** 확장자를 제거한다. "a.md" → "a", "README" → "README". */
function stripExt(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(0, dot) : name;
}

/**
 * 위키링크 라벨: 확장자 제거한 파일명.
 * vault 내에 같은(확장자 제거) 파일명이 2개 이상이면 확장자 제거한 vault-상대 경로.
 */
export function toWikilinkLabel(
  absPath: string,
  rootPath: string,
  allPaths: string[],
): string {
  const bare = stripExt(basename(absPath));
  const collisions = allPaths.filter((p) => stripExt(basename(p)) === bare);
  if (collisions.length <= 1) return bare;
  const rel = toRelativePath(absPath, rootPath);
  return stripExt(rel);
}
```

- [ ] **Step 4: capability 권한 추가**

`src-tauri/capabilities/default.json`의 `permissions` 배열에 두 항목 추가(Task 4의 reveal도 미리 함께 추가):

```json
    "clipboard-manager:allow-write-image",
    "clipboard-manager:allow-write-text",
    "opener:allow-reveal-item-in-dir"
```

- [ ] **Step 5: 테스트 통과 확인**

```bash
npx vitest run src/components/sidebar/__tests__/file-tree-clipboard.test.ts > /tmp/t2.log 2>&1; echo $?
```
Expected: exit 0, 6 passed

- [ ] **Step 6: 커밋**

```bash
git add src/components/sidebar/file-tree-clipboard.ts src/components/sidebar/__tests__/file-tree-clipboard.test.ts src-tauri/capabilities/default.json
git commit -m "feat(§4.3): clipboard label helpers + capability grants"
```

---

### Task 3: 액션 훅 + 복사 액션 3개 배선

**Files:**
- Create: `src/components/sidebar/hooks/use-file-tree-actions.ts`
- Modify: `src/components/sidebar/file-tree-context-menu.tsx` (복사 3항목 추가)
- Modify: `src/components/sidebar/FileTree.tsx` (액션 디스패치에 case 추가)
- Test: `src/components/sidebar/__tests__/use-file-tree-actions.test.ts`

**Interfaces:**
- Consumes: Task 2 `toRelativePath`, `toWikilinkLabel`
- Produces (Task 4–7이 확장):

```ts
export interface UseFileTreeActionsReturn {
  copyPath: (path: string) => Promise<void>;
  copyRelativePath: (path: string) => Promise<void>;
  copyWikilink: (path: string) => Promise<void>;
}
export function useFileTreeActions(): UseFileTreeActionsReturn;
```

- [ ] **Step 1: 실패하는 테스트 작성**

`src/components/sidebar/__tests__/use-file-tree-actions.test.ts`:

```ts
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const writeText = vi.fn().mockResolvedValue(undefined);
vi.mock("@tauri-apps/plugin-clipboard-manager", () => ({ writeText }));

import { useFileStore } from "../../../stores/file/file";
import { useFileTreeActions } from "../hooks/use-file-tree-actions";

beforeEach(() => {
  writeText.mockClear();
  useFileStore.setState({
    rootPath: "/r",
    fileTree: [
      { name: "a.md", path: "/r/a.md", isDir: false },
      {
        name: "docs",
        path: "/r/docs",
        isDir: true,
        children: [{ name: "a.md", path: "/r/docs/a.md", isDir: false }],
      },
    ],
  });
});

describe("useFileTreeActions copy", () => {
  it("copyPath는 절대 경로를 클립보드에 쓴다", async () => {
    const { result } = renderHook(() => useFileTreeActions());
    await act(() => result.current.copyPath("/r/docs/a.md"));
    expect(writeText).toHaveBeenCalledWith("/r/docs/a.md");
  });
  it("copyRelativePath는 vault 상대 경로를 쓴다", async () => {
    const { result } = renderHook(() => useFileTreeActions());
    await act(() => result.current.copyRelativePath("/r/docs/a.md"));
    expect(writeText).toHaveBeenCalledWith("docs/a.md");
  });
  it("copyWikilink는 동명 충돌 시 상대 경로 라벨을 [[...]]로 쓴다", async () => {
    const { result } = renderHook(() => useFileTreeActions());
    await act(() => result.current.copyWikilink("/r/docs/a.md"));
    expect(writeText).toHaveBeenCalledWith("[[docs/a]]");
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

```bash
npx vitest run src/components/sidebar/__tests__/use-file-tree-actions.test.ts > /tmp/t3.log 2>&1; echo $?
```
Expected: exit 1

- [ ] **Step 3: 구현 — 액션 훅**

`src/components/sidebar/hooks/use-file-tree-actions.ts`:

```ts
// §4.3 File tree — context-menu action handlers
import { useCallback } from "react";

import { writeText } from "@tauri-apps/plugin-clipboard-manager";

import { useFileStore } from "../../../stores/file/file";
import { flattenFileTree } from "../../../utils/file-search";
import { toRelativePath, toWikilinkLabel } from "../file-tree-clipboard";

export interface UseFileTreeActionsReturn {
  copyPath: (path: string) => Promise<void>;
  copyRelativePath: (path: string) => Promise<void>;
  copyWikilink: (path: string) => Promise<void>;
}

export function useFileTreeActions(): UseFileTreeActionsReturn {
  const copyPath = useCallback(async (path: string): Promise<void> => {
    await writeText(path);
  }, []);

  const copyRelativePath = useCallback(async (path: string): Promise<void> => {
    const root = useFileStore.getState().rootPath;
    if (!root) return;
    await writeText(toRelativePath(path, root));
  }, []);

  const copyWikilink = useCallback(async (path: string): Promise<void> => {
    const { rootPath: root, fileTree } = useFileStore.getState();
    if (!root) return;
    const allPaths = flattenFileTree(fileTree, root).map((f) => f.path);
    await writeText(`[[${toWikilinkLabel(path, root, allPaths)}]]`);
  }, []);

  return { copyPath, copyRelativePath, copyWikilink };
}
```

주의: `flattenFileTree(fileTree, rootPath)`는 `src/utils/file-search.ts`에 존재(use-file-tree-search.ts에서 사용 중). 반환 항목에 `.path` 필드가 있는지 확인하고, 없으면 `computeVisibleEntries`가 아니라 fileTree를 재귀 순회하는 로컬 헬퍼로 대체(모든 파일 경로 수집).

- [ ] **Step 4: 메뉴에 복사 3항목 추가**

`file-tree-context-menu.tsx`의 파일/폴더 대상 블록(`!isEmptyArea`) 안, Rename 위에 구분선 + 3항목 추가. 파일만 위키링크 복사 노출(폴더는 위키링크 대상 아님):

```tsx
      {!isEmptyArea && (
        <>
          {menu.targetIsDir && (
            <div className="file-tree-context-menu-separator" />
          )}
          <div className="file-tree-context-menu-item" onClick={() => onAction("rename")}>
            Rename
          </div>
          <div
            className="file-tree-context-menu-item file-tree-context-menu-item-danger"
            onClick={() => onAction("delete")}
          >
            Delete
          </div>
          <div className="file-tree-context-menu-separator" />
          <div className="file-tree-context-menu-item" onClick={() => onAction("copyPath")}>
            Copy Path
          </div>
          <div
            className="file-tree-context-menu-item"
            onClick={() => onAction("copyRelativePath")}
          >
            Copy Relative Path
          </div>
          {!menu.targetIsDir && (
            <div
              className="file-tree-context-menu-item"
              onClick={() => onAction("copyWikilink")}
            >
              Copy as Wikilink
            </div>
          )}
        </>
      )}
```

- [ ] **Step 5: FileTree.tsx 디스패치 배선**

(a) `const actions = useFileTreeActions();` 훅 호출 추가(다른 훅들 근처).
(b) `handleContextMenuAction`의 switch에 case 추가:

```tsx
        case "copyPath":
          if (target.targetPath) actions.copyPath(target.targetPath);
          break;
        case "copyRelativePath":
          if (target.targetPath) actions.copyRelativePath(target.targetPath);
          break;
        case "copyWikilink":
          if (target.targetPath) actions.copyWikilink(target.targetPath);
          break;
```
(c) deps 배열에 `actions` 추가.

- [ ] **Step 6: 테스트·타입·회귀 확인**

```bash
npx vitest run src/components/sidebar/__tests__/use-file-tree-actions.test.ts > /tmp/t3.log 2>&1; echo $?
npm run typecheck > /tmp/tc3.log 2>&1; echo $?
npm test > /tmp/full3.log 2>&1; echo $?
```
Expected: 모두 exit 0. (훅 테스트에서 store import 체인이 다른 IPC export를 요구하면 `vi.mock`에 추가 — use-llm-stream.test.ts 관례.)

- [ ] **Step 7: 커밋**

```bash
git add src/components/sidebar/
git commit -m "feat(§4.3): copy path / relative path / wikilink actions"
```

---

### Task 4: 복제 (Duplicate) 액션

**Files:**
- Modify: `src/components/sidebar/hooks/use-file-tree-actions.ts` (`duplicateFile` 추가)
- Modify: `src/components/sidebar/file-tree-context-menu.tsx` (파일 대상에 Duplicate 항목)
- Modify: `src/components/sidebar/FileTree.tsx` (case 추가)
- Test: `src/components/sidebar/__tests__/use-file-tree-actions.test.ts` (describe 추가)

**Interfaces:**
- Consumes: `copyFile` (ipc), `resolveNameConflict`/`basename`/`dirname` (path-utils), `addFileEntry` (file store)
- Produces: `UseFileTreeActionsReturn.duplicateFile: (path: string) => Promise<void>` — 파일 전용. `name-1.ext` 형태로 복제.

- [ ] **Step 1: 실패하는 테스트 작성**

기존 `use-file-tree-actions.test.ts`에 `copyFile` mock을 추가하고 describe 추가:

```ts
// vi.mock 팩토리에 추가(파일 상단):
const copyFile = vi.fn().mockResolvedValue(undefined);
vi.mock("../../../ipc/invoke", () => ({
  copyFile,
  // + store import 체인이 요구하는 다른 export들을 vi.fn()으로 (에러 메시지 참고)
}));
import { copyFile as copyFileMock } from "../../../ipc/invoke";

describe("useFileTreeActions duplicate", () => {
  it("파일을 name-1.ext로 복제하고 트리에 추가한다", async () => {
    const { result } = renderHook(() => useFileTreeActions());
    await act(() => result.current.duplicateFile("/r/a.md"));
    expect(copyFileMock).toHaveBeenCalledWith("/r/a.md", "/r/a-1.md");
    const tree = useFileStore.getState().fileTree;
    expect(tree.some((e) => e.path === "/r/a-1.md")).toBe(true);
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

```bash
npx vitest run src/components/sidebar/__tests__/use-file-tree-actions.test.ts > /tmp/t4.log 2>&1; echo $?
```
Expected: exit 1 (`duplicateFile` 없음)

- [ ] **Step 3: 구현**

`use-file-tree-actions.ts`에 추가:

```ts
import { copyFile } from "../../../ipc/invoke";
import { basename, dirname, resolveNameConflict } from "../../../utils/path-utils";
import { logger } from "../../../utils/logger";
```

```ts
  const duplicateFile = useCallback(async (path: string): Promise<void> => {
    const { fileTree, rootPath: root, addFileEntry } = useFileStore.getState();
    if (!root) return;
    const parent = dirname(path);
    const name = basename(path);
    // 같은 폴더의 기존 이름 수집
    const siblings = collectSiblingNames(fileTree, parent, root);
    const newName = resolveNameConflict(name, siblings);
    const newPath = parent + "/" + newName;
    try {
      await copyFile(path, newPath);
      addFileEntry(parent, { name: newName, path: newPath, isDir: false });
    } catch (err) {
      logger.error("[FileTree] Duplicate failed:", err);
    }
  }, []);
```

파일 하단에 헬퍼(파일 트리에서 특정 부모의 자식 이름 Set 수집) — 루트면 최상위 이름, 아니면 부모 엔트리를 찾아 그 children 이름:

```ts
import type { FileEntry } from "../../../stores/file/file";

function findEntry(tree: FileEntry[], path: string): FileEntry | null {
  for (const e of tree) {
    if (e.path === path) return e;
    if (e.isDir && e.children) {
      const found = findEntry(e.children, path);
      if (found) return found;
    }
  }
  return null;
}

function collectSiblingNames(
  tree: FileEntry[],
  parentPath: string,
  rootPath: string,
): Set<string> {
  if (parentPath === rootPath) {
    return new Set(tree.map((e) => e.name));
  }
  const parent = findEntry(tree, parentPath);
  return new Set((parent?.children ?? []).map((c) => c.name));
}
```

(`FileEntry`는 `import type`로 가져올 것. `findEntry`는 `use-file-tree-crud.ts:133`의 `findEntryByPath`와 동일 패턴이지만 그 함수는 export되어 있지 않으므로 여기 로컬로 둔다.)

`duplicateFile`을 return 객체와 인터페이스에 추가.

- [ ] **Step 4: 메뉴 항목 추가**

`file-tree-context-menu.tsx`에서 파일 대상(`!menu.targetIsDir`)일 때만 Duplicate 노출 — Rename 위, "새 탭에서 열기"는 Task 6에서 추가하므로 지금은 Rename 근처에 배치:

```tsx
          {!menu.targetIsDir && (
            <div
              className="file-tree-context-menu-item"
              onClick={() => onAction("duplicate")}
            >
              Duplicate
            </div>
          )}
```

- [ ] **Step 5: FileTree.tsx case 추가**

```tsx
        case "duplicate":
          if (target.targetPath && !target.targetIsDir)
            actions.duplicateFile(target.targetPath);
          break;
```

- [ ] **Step 6: 테스트·타입·회귀 확인**

```bash
npx vitest run src/components/sidebar/__tests__/use-file-tree-actions.test.ts > /tmp/t4.log 2>&1; echo $?
npm run typecheck > /tmp/tc4.log 2>&1; echo $?
npm test > /tmp/full4.log 2>&1; echo $?
```
Expected: 모두 exit 0

- [ ] **Step 7: 커밋**

```bash
git add src/components/sidebar/
git commit -m "feat(§4.3): duplicate file action"
```

---

### Task 5: Finder에서 보기 (Reveal in File Manager)

**Files:**
- Modify: `src/components/sidebar/hooks/use-file-tree-actions.ts` (`revealInFileManager` 추가)
- Modify: `src/components/sidebar/file-tree-context-menu.tsx` (항목 추가 + 플랫폼 라벨)
- Modify: `src/components/sidebar/FileTree.tsx` (case 추가)
- Test: `src/components/sidebar/__tests__/use-file-tree-actions.test.ts` (describe 추가)

**Interfaces:**
- Consumes: `revealItemInDir` from `@tauri-apps/plugin-opener`
- Produces: `UseFileTreeActionsReturn.revealInFileManager: (path: string) => Promise<void>`

- [ ] **Step 1: 실패하는 테스트 작성**

`use-file-tree-actions.test.ts`의 상단 mock에 opener 추가:

```ts
const revealItemInDir = vi.fn().mockResolvedValue(undefined);
vi.mock("@tauri-apps/plugin-opener", () => ({ revealItemInDir }));
```

describe 추가:

```ts
import { revealItemInDir as revealMock } from "@tauri-apps/plugin-opener";

describe("useFileTreeActions reveal", () => {
  it("revealInFileManager는 경로로 revealItemInDir를 호출한다", async () => {
    const { result } = renderHook(() => useFileTreeActions());
    await act(() => result.current.revealInFileManager("/r/docs/a.md"));
    expect(revealMock).toHaveBeenCalledWith("/r/docs/a.md");
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

```bash
npx vitest run src/components/sidebar/__tests__/use-file-tree-actions.test.ts > /tmp/t5.log 2>&1; echo $?
```
Expected: exit 1

- [ ] **Step 3: 구현**

`use-file-tree-actions.ts`:

```ts
import { revealItemInDir } from "@tauri-apps/plugin-opener";
```

```ts
  const revealInFileManager = useCallback(
    async (path: string): Promise<void> => {
      try {
        await revealItemInDir(path);
      } catch (err) {
        logger.error("[FileTree] Reveal failed:", err);
      }
    },
    [],
  );
```
인터페이스·return에 추가.

- [ ] **Step 4: 메뉴 항목 + 플랫폼 라벨**

`file-tree-context-menu.tsx` 상단에 플랫폼 감지 라벨:

```tsx
const REVEAL_LABEL =
  typeof navigator !== "undefined" && navigator.platform.startsWith("Mac")
    ? "Reveal in Finder"
    : "Show in File Manager";
```

파일/폴더 대상 블록 하단(복사 항목 뒤)에 구분선 + 항목:

```tsx
          <div className="file-tree-context-menu-separator" />
          <div
            className="file-tree-context-menu-item"
            onClick={() => onAction("reveal")}
          >
            {REVEAL_LABEL}
          </div>
```

- [ ] **Step 5: FileTree.tsx case 추가**

```tsx
        case "reveal":
          if (target.targetPath) actions.revealInFileManager(target.targetPath);
          break;
```

- [ ] **Step 6: 테스트·타입·회귀 확인**

```bash
npx vitest run src/components/sidebar/__tests__/use-file-tree-actions.test.ts > /tmp/t5.log 2>&1; echo $?
npm run typecheck > /tmp/tc5.log 2>&1; echo $?
npm test > /tmp/full5.log 2>&1; echo $?
```
Expected: 모두 exit 0

- [ ] **Step 7: 커밋**

```bash
git add src/components/sidebar/
git commit -m "feat(§4.3): reveal in file manager action"
```

---

### Task 6: 새 탭에서 열기 + 내보내기 액션

**Files:**
- Modify: `src/components/sidebar/hooks/use-file-tree-actions.ts` (`openInNewTab`, `exportFile` 추가)
- Modify: `src/components/sidebar/file-tree-context-menu.tsx` (파일 대상 상단 "Open in New Tab", 하단 "Export…")
- Modify: `src/components/sidebar/FileTree.tsx` (case 추가)
- Test: `src/components/sidebar/__tests__/use-file-tree-actions.test.ts` (describe 추가)

**Interfaces:**
- Consumes: `readFile` (ipc), `useEditorStore.openTab`/`setActiveTab`, `useFileStore.setFileContent`, `useUIStore.openExportDialog`, `basename`
- Produces:
  - `openInNewTab: (path: string) => Promise<void>` — 이미 열린 탭이면 활성화, 아니면 read+openTab
  - `exportFile: (path: string) => Promise<void>` — openInNewTab 후 `openExportDialog("pdf")`

- [ ] **Step 1: 실패하는 테스트 작성**

`use-file-tree-actions.test.ts` mock에 readFile/ui store 관련 추가. describe:

```ts
import { useEditorStore } from "../../../stores/editor/editor";
import { useUIStore } from "../../../stores/ui/ui";

describe("useFileTreeActions open/export", () => {
  it("openInNewTab은 파일을 읽어 탭을 연다", async () => {
    const { result } = renderHook(() => useFileTreeActions());
    await act(() => result.current.openInNewTab("/r/a.md"));
    const tabs = useEditorStore.getState().tabs;
    expect(tabs.some((t) => t.filePath === "/r/a.md")).toBe(true);
  });
  it("exportFile은 탭을 열고 export 다이얼로그를 연다", async () => {
    const spy = vi.spyOn(useUIStore.getState(), "openExportDialog");
    const { result } = renderHook(() => useFileTreeActions());
    await act(() => result.current.exportFile("/r/a.md"));
    expect(spy).toHaveBeenCalledWith("pdf");
  });
});
```

주의: editor store `openTab`이 `readFile` 없이도 동작하도록 `readFile` mock이 콘텐츠를 반환해야 함. mock 팩토리에 `readFile: vi.fn().mockResolvedValue("")` 추가. `openExportDialog` spy 방식은 store 구현에 따라 조정(구현자가 실제 store API에 맞춰 테스트를 확정 — 핵심은 "탭 열림 + export 다이얼로그 호출" 검증).

- [ ] **Step 2: 테스트 실패 확인**

```bash
npx vitest run src/components/sidebar/__tests__/use-file-tree-actions.test.ts > /tmp/t6.log 2>&1; echo $?
```
Expected: exit 1

- [ ] **Step 3: 구현**

`use-file-tree-actions.ts`:

```ts
import { readFile } from "../../../ipc/invoke";
import { useEditorStore } from "../../../stores/editor/editor";
import { useUIStore } from "../../../stores/ui/ui";
import { useContextStore } from "../../../stores/context/context";
import { basename } from "../../../utils/path-utils";
```

```ts
  const openInNewTab = useCallback(async (path: string): Promise<void> => {
    const editorState = useEditorStore.getState();
    const existing = editorState.tabs.find((t) => t.filePath === path);
    if (existing) {
      editorState.setActiveTab(existing.id);
      return;
    }
    try {
      const content = await readFile(path);
      useFileStore.getState().setFileContent(path, content);
      editorState.openTab({
        contextId: useContextStore.getState().activeContextId ?? "",
        id: crypto.randomUUID(),
        filePath: path,
        title: basename(path),
        isDirty: false,
        isPinned: false,
      });
    } catch (err) {
      logger.error("[FileTree] Open in new tab failed:", err);
    }
  }, []);

  const exportFile = useCallback(
    async (path: string): Promise<void> => {
      await openInNewTab(path);
      useUIStore.getState().openExportDialog("pdf");
    },
    [openInNewTab],
  );
```
인터페이스·return에 추가. `openTab`의 정확한 필드는 FileTree.tsx handleFileClick(216–223)과 동일하게 맞출 것. `activeContextId`가 ui/context store의 실제 필드명인지 확인(context store).

- [ ] **Step 4: 메뉴 항목 추가**

`file-tree-context-menu.tsx`:
- 파일 대상 최상단에 "Open in New Tab" + 구분선:

```tsx
      {!isEmptyArea && !menu.targetIsDir && (
        <>
          <div
            className="file-tree-context-menu-item"
            onClick={() => onAction("openInNewTab")}
          >
            Open in New Tab
          </div>
          <div className="file-tree-context-menu-separator" />
        </>
      )}
```
이 블록은 기존 `!isEmptyArea` 블록보다 **앞**에 위치해야 최상단에 온다. reveal 항목 뒤(파일 대상만)에 "Export…" 추가:

```tsx
          {!menu.targetIsDir && (
            <div
              className="file-tree-context-menu-item"
              onClick={() => onAction("export")}
            >
              Export…
            </div>
          )}
```

- [ ] **Step 5: FileTree.tsx case 추가**

```tsx
        case "openInNewTab":
          if (target.targetPath && !target.targetIsDir)
            actions.openInNewTab(target.targetPath);
          break;
        case "export":
          if (target.targetPath && !target.targetIsDir)
            actions.exportFile(target.targetPath);
          break;
```

- [ ] **Step 6: 테스트·타입·회귀 확인**

```bash
npx vitest run src/components/sidebar/__tests__/use-file-tree-actions.test.ts > /tmp/t6.log 2>&1; echo $?
npm run typecheck > /tmp/tc6.log 2>&1; echo $?
npm test > /tmp/full6.log 2>&1; echo $?
```
Expected: 모두 exit 0

- [ ] **Step 7: 커밋**

```bash
git add src/components/sidebar/
git commit -m "feat(§4.3): open in new tab + export actions"
```

---

### Task 7: 이동 로직 공유 훅 + Move to Folder 모달

**Files:**
- Create: `src/components/sidebar/hooks/use-file-tree-move.ts`
- Create: `src/components/sidebar/MoveToFolderModal.tsx`
- Modify: `src/components/sidebar/hooks/use-file-tree-dnd.ts` (이동 루프를 공유 훅 호출로 교체)
- Modify: `src/components/sidebar/file-tree-context-menu.tsx` (Move… 항목)
- Modify: `src/components/sidebar/FileTree.tsx` (모달 상태 + 렌더 + case)
- Modify: `src/styles/file-tree.css` (모달 스타일) 또는 dialogs.css 재사용
- Test: `src/components/sidebar/__tests__/use-file-tree-move.test.ts`

**Interfaces:**
- Consumes: Task(PR1) `planMultiMove`, `showAlert`, `renameFile` ipc, `moveFileEntry`/`renameTab`, `useLinkStore.invalidate`
- Produces:
  - `useFileTreeMove(): { moveEntries: (sourcePaths: string[], targetPath: string) => Promise<void> }`
  - `MoveToFolderModal` (props: `sources: string[]`, `onClose: () => void`)

- [ ] **Step 1: 실패하는 테스트 작성**

`src/components/sidebar/__tests__/use-file-tree-move.test.ts`:

```ts
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const renameFile = vi.fn().mockResolvedValue(undefined);
vi.mock("../../../ipc/invoke", () => ({
  renameFile,
  listDir: vi.fn().mockResolvedValue([]),
  refreshIndex: vi.fn().mockResolvedValue(undefined),
  setVaultRoot: vi.fn().mockResolvedValue(undefined),
  getLinkIndex: vi.fn().mockResolvedValue({ links: [], backlinks: [] }),
}));
const showAlert = vi.fn().mockResolvedValue(undefined);
vi.mock("../../../utils/confirm-dialog", () => ({ showAlert }));

import { useFileStore } from "../../../stores/file/file";
import { useFileTreeMove } from "../hooks/use-file-tree-move";

beforeEach(() => {
  renameFile.mockClear();
  showAlert.mockClear();
  useFileStore.setState({
    rootPath: "/r",
    fileTree: [
      { name: "a.md", path: "/r/a.md", isDir: false },
      { name: "b.md", path: "/r/b.md", isDir: false },
      { name: "dest", path: "/r/dest", isDir: true, children: [] },
    ],
  });
});

describe("useFileTreeMove", () => {
  it("유효한 이동은 renameFile을 항목별로 호출하고 트리를 갱신한다", async () => {
    const { result } = renderHook(() => useFileTreeMove());
    await act(() => result.current.moveEntries(["/r/a.md", "/r/b.md"], "/r/dest"));
    expect(renameFile).toHaveBeenCalledWith("/r/a.md", "/r/dest/a.md");
    expect(renameFile).toHaveBeenCalledWith("/r/b.md", "/r/dest/b.md");
    const dest = useFileStore.getState().fileTree.find((e) => e.path === "/r/dest");
    expect(dest?.children?.map((c) => c.path).sort()).toEqual([
      "/r/dest/a.md",
      "/r/dest/b.md",
    ]);
  });

  it("일부 실패 시 나머지는 계속하고 showAlert로 보고한다", async () => {
    renameFile.mockRejectedValueOnce(new Error("locked"));
    const { result } = renderHook(() => useFileTreeMove());
    await act(() => result.current.moveEntries(["/r/a.md", "/r/b.md"], "/r/dest"));
    expect(renameFile).toHaveBeenCalledTimes(2);
    expect(showAlert).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

```bash
npx vitest run src/components/sidebar/__tests__/use-file-tree-move.test.ts > /tmp/t7.log 2>&1; echo $?
```
Expected: exit 1

- [ ] **Step 3: 구현 — 공유 이동 훅**

`src/components/sidebar/hooks/use-file-tree-move.ts` — use-file-tree-dnd.ts mouseup 이동 루프(planMultiMove → per-item renameFile + moveFileEntry + tab rename + showAlert)를 그대로 옮긴다:

```ts
// §4.3 File tree — shared move logic (used by DnD and Move-to-folder modal)
import { useCallback } from "react";

import { renameFile } from "../../../ipc/invoke";
import { useEditorStore } from "../../../stores/editor/editor";
import { useLinkStore } from "../../../stores/editor/link";
import { useFileStore } from "../../../stores/file/file";
import { showAlert } from "../../../utils/confirm-dialog";
import { logger } from "../../../utils/logger";
import { planMultiMove } from "../file-tree-multi-ops";

export interface UseFileTreeMoveReturn {
  moveEntries: (sourcePaths: string[], targetPath: string) => Promise<void>;
}

export function useFileTreeMove(): UseFileTreeMoveReturn {
  const moveEntries = useCallback(
    async (sourcePaths: string[], targetPath: string): Promise<void> => {
      const root = useFileStore.getState().rootPath;
      if (!root) return;
      const { moves } = planMultiMove(sourcePaths, targetPath, root);
      if (moves.length === 0) return;
      const { moveFileEntry } = useFileStore.getState();
      const { renameTab } = useEditorStore.getState();
      const failed: string[] = [];
      for (const { from, to } of moves) {
        try {
          await renameFile(from, to);
          moveFileEntry(from, targetPath);
          const { tabs } = useEditorStore.getState();
          for (const tab of tabs) {
            if (tab.filePath === from) {
              renameTab(from, to, to.split("/").pop() ?? "");
            } else if (tab.filePath?.startsWith(from + "/")) {
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
    },
    [],
  );
  return { moveEntries };
}
```

- [ ] **Step 4: DnD를 공유 훅으로 리팩토링**

`use-file-tree-dnd.ts` mouseup의 이동 루프(planMultiMove부터 showAlert까지) 전체를 `moveEntries(state.sourcePaths, targetPath)` 한 줄 호출로 교체. 훅 상단에서 `const { moveEntries } = useFileTreeMove();`를 받고, mouseup effect deps에 `moveEntries` 추가. `renameTab`/`moveFileEntry` 직접 사용이 사라지면 해당 import·변수 정리(사용처가 이미지 삽입 분기에만 남는지 확인). **이미지-into-editor 분기와 editor-drop 다중 no-op 가드는 그대로 유지.**

주의: 이 리팩토링은 PR1에서 검증된 DnD 코드를 건드린다. 전체 `npm test`(특히 DnD 관련 테스트)로 회귀 없음을 확인할 것.

- [ ] **Step 5: MoveToFolderModal 구현**

`src/components/sidebar/MoveToFolderModal.tsx` — vault의 폴더만(재귀) 나열하는 경량 피커. fileTree에서 `isDir`인 노드만 추출, 루트도 선택 가능. 선택 시 `moveEntries(sources, target)` 후 `onClose()`:

```tsx
// §4.3 File tree — Move-to-folder picker modal
import { useMemo, useState } from "react";

import { useShallow } from "zustand/shallow";

import { type FileEntry, useFileStore } from "../../stores/file/file";
import { useFileTreeMove } from "./hooks/use-file-tree-move";

interface FolderOption {
  depth: number;
  name: string;
  path: string;
}

function collectFolders(tree: FileEntry[], depth: number): FolderOption[] {
  const out: FolderOption[] = [];
  for (const e of tree) {
    if (e.isDir) {
      out.push({ path: e.path, name: e.name, depth });
      if (e.children) out.push(...collectFolders(e.children, depth + 1));
    }
  }
  return out;
}

export function MoveToFolderModal({
  sources,
  onClose,
}: {
  onClose: () => void;
  sources: string[];
}): React.JSX.Element | null {
  const { fileTree, rootPath } = useFileStore(
    useShallow((s) => ({ fileTree: s.fileTree, rootPath: s.rootPath })),
  );
  const { moveEntries } = useFileTreeMove();
  const [query, setQuery] = useState("");

  const folders = useMemo((): FolderOption[] => {
    if (!rootPath) return [];
    const all: FolderOption[] = [
      { path: rootPath, name: "/ (vault root)", depth: 0 },
      ...collectFolders(fileTree, 0),
    ];
    const q = query.trim().toLowerCase();
    return q ? all.filter((f) => f.path.toLowerCase().includes(q)) : all;
  }, [fileTree, rootPath, query]);

  if (!rootPath) return null;

  const handlePick = async (target: string): Promise<void> => {
    await moveEntries(sources, target);
    onClose();
  };

  return (
    <div className="move-modal-overlay" onClick={onClose}>
      <div className="move-modal" onClick={(e) => e.stopPropagation()}>
        <div className="move-modal-title">
          Move {sources.length} item{sources.length !== 1 ? "s" : ""} to…
        </div>
        <input
          autoFocus
          className="move-modal-search"
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") onClose();
          }}
          placeholder="Filter folders…"
          value={query}
        />
        <div className="move-modal-list">
          {folders.map((f) => (
            <div
              className="move-modal-item"
              key={f.path}
              onClick={() => handlePick(f.path)}
              style={{ paddingLeft: `${8 + f.depth * 12}px` }}
            >
              {f.name}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
```

`src/styles/file-tree.css`에 모달 스타일 추가(기존 `.file-tree-context-menu` 토큰 재사용):

```css
.move-modal-overlay {
  position: fixed;
  inset: 0;
  background: var(--color-overlay, rgba(0, 0, 0, 0.4));
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
}
.move-modal {
  background: var(--color-bg-default);
  border: 1px solid var(--color-border-default);
  border-radius: 8px;
  box-shadow: var(--shadow-lg);
  width: 360px;
  max-height: 70vh;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
.move-modal-title {
  padding: 12px;
  font-weight: 600;
  border-bottom: 1px solid var(--color-border-muted);
}
.move-modal-search {
  margin: 8px 12px;
  padding: 6px 8px;
  background: var(--color-bg-muted);
  border: 1px solid var(--color-border-default);
  border-radius: 4px;
  color: var(--color-text-default);
}
.move-modal-list {
  overflow-y: auto;
  padding-bottom: 8px;
}
.move-modal-item {
  padding: 6px 8px;
  cursor: pointer;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.move-modal-item:hover {
  background: var(--color-bg-hover);
}
```
(CSS 변수명은 프로젝트 컨벤션에 맞춰 조정 — `npm run audit:css-vars`로 미정의 변수 검출.)

- [ ] **Step 6: FileTree.tsx 모달 배선 + 메뉴 항목**

(a) `const [moveModalSources, setMoveModalSources] = useState<string[] | null>(null);` 상태 추가.
(b) `handleContextMenuAction`에 case 추가 — 단일 대상 이동(다중은 Task 8):

```tsx
        case "move":
          if (target.targetPath) setMoveModalSources([target.targetPath]);
          break;
```
(c) FileTreeProvider 안, 컨텍스트 메뉴 렌더 근처에 모달 렌더:

```tsx
        {moveModalSources && (
          <MoveToFolderModal
            onClose={() => setMoveModalSources(null)}
            sources={moveModalSources}
          />
        )}
```
(d) `file-tree-context-menu.tsx`에 Move 항목(파일·폴더 모두, Duplicate/Rename 근처):

```tsx
          <div className="file-tree-context-menu-item" onClick={() => onAction("move")}>
            Move to…
          </div>
```

- [ ] **Step 7: 테스트·타입·회귀 확인**

```bash
npx vitest run src/components/sidebar/__tests__/use-file-tree-move.test.ts > /tmp/t7.log 2>&1; echo $?
npm run typecheck > /tmp/tc7.log 2>&1; echo $?
npm test > /tmp/full7.log 2>&1; echo $?
```
Expected: 모두 exit 0 (DnD 회귀 포함)

- [ ] **Step 8: 커밋**

```bash
git add src/components/sidebar/ src/styles/file-tree.css
git commit -m "feat(§4.3): move-to-folder modal + shared move hook"
```

---

### Task 8: 다중 선택 축소 메뉴

**Files:**
- Modify: `src/components/sidebar/file-tree-types.ts` (ContextMenuState에 `selectionCount` 추가)
- Modify: `src/components/sidebar/file-tree-context-menu.tsx` (다중 모드 분기)
- Modify: `src/components/sidebar/FileTree.tsx` (우클릭 시 selectedPaths 반영, 다중 액션 디스패치)
- Test: `src/components/sidebar/__tests__/file-tree-context-menu.test.tsx` (다중 모드 describe 추가)

**Interfaces:**
- Consumes: Task 7 `moveEntries`, PR1 `handleDeleteMany`, `selectedPaths`
- Produces: `ContextMenuState.selectionCount: number` (우클릭 대상이 다중 선택에 포함될 때 선택 개수, 아니면 1)

- [ ] **Step 1: 실패하는 테스트 작성**

`file-tree-context-menu.test.tsx`에 추가:

```tsx
describe("FileTreeContextMenu (multi-selection)", () => {
  it("selectionCount>1이면 축소 세트(Duplicate/Move/Delete/Copy Path)만 보여주고 Rename은 숨긴다", () => {
    render(
      <FileTreeContextMenu
        menu={{ x: 0, y: 0, targetPath: "/r/a.md", targetIsDir: false, selectionCount: 3 }}
        onAction={vi.fn()}
      />,
    );
    expect(screen.getByText("Move to…")).toBeInTheDocument();
    expect(screen.getByText("Delete")).toBeInTheDocument();
    expect(screen.getByText("Copy Path")).toBeInTheDocument();
    expect(screen.queryByText("Rename")).not.toBeInTheDocument();
    expect(screen.queryByText("Open in New Tab")).not.toBeInTheDocument();
  });

  it("selectionCount>1이고 폴더 포함이면 Duplicate를 비활성(disabled)으로 표시한다", () => {
    render(
      <FileTreeContextMenu
        menu={{
          x: 0, y: 0, targetPath: "/r/docs", targetIsDir: true,
          selectionCount: 2, selectionHasDir: true,
        }}
        onAction={vi.fn()}
      />,
    );
    const dup = screen.getByText("Duplicate");
    expect(dup.className).toContain("file-tree-context-menu-item-disabled");
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

```bash
npx vitest run src/components/sidebar/__tests__/file-tree-context-menu.test.tsx > /tmp/t8.log 2>&1; echo $?
```
Expected: exit 1 (selectionCount 타입 없음)

- [ ] **Step 3: 타입 확장**

`file-tree-types.ts` `ContextMenuState`:

```ts
export interface ContextMenuState {
  selectionCount: number;
  selectionHasDir: boolean;
  targetIsDir: boolean;
  targetPath: null | string;
  x: number;
  y: number;
}
```

- [ ] **Step 4: 메뉴 다중 모드 분기**

`file-tree-context-menu.tsx` — `menu.selectionCount > 1`이면 축소 세트 렌더:

```tsx
  const isMulti = menu.selectionCount > 1;
  // ...
  if (isMulti) {
    return (
      <div
        className="file-tree-context-menu"
        onClick={(e) => e.stopPropagation()}
        style={{ left: menu.x, top: menu.y }}
      >
        <div
          className={`file-tree-context-menu-item ${menu.selectionHasDir ? "file-tree-context-menu-item-disabled" : ""}`}
          onClick={() => !menu.selectionHasDir && onAction("duplicate")}
        >
          Duplicate
        </div>
        <div className="file-tree-context-menu-item" onClick={() => onAction("move")}>
          Move to…
        </div>
        <div
          className="file-tree-context-menu-item file-tree-context-menu-item-danger"
          onClick={() => onAction("delete")}
        >
          Delete
        </div>
        <div className="file-tree-context-menu-separator" />
        <div className="file-tree-context-menu-item" onClick={() => onAction("copyPath")}>
          Copy Path
        </div>
      </div>
    );
  }
  // ... 기존 단일 메뉴 렌더
```

`.file-tree-context-menu-item-disabled` CSS(file-tree.css): `opacity: 0.4; cursor: default;` 추가.

- [ ] **Step 5: FileTree.tsx — 우클릭 시 selectedPaths 반영 + 다중 디스패치**

(a) `handleContextMenu`가 우클릭 대상이 selectedPaths에 있으면 selectionCount = selectedPaths.size, 아니면 단일 선택으로 전환(selectSingle) 후 count=1:

```tsx
  const handleContextMenu = useCallback(
    (e: React.MouseEvent, path: string, isDir: boolean): void => {
      e.preventDefault();
      e.stopPropagation();
      let count = 1;
      let hasDir = isDir;
      if (selectedPaths.has(path) && selectedPaths.size > 1) {
        count = selectedPaths.size;
        hasDir = someSelectedIsDir(fileTree, selectedPaths);
      } else {
        selectSingle(path);
      }
      setContextMenu({ x: e.clientX, y: e.clientY, targetPath: path, targetIsDir: isDir, selectionCount: count, selectionHasDir: hasDir });
    },
    [selectedPaths, selectSingle, fileTree],
  );
```
`handleEmptyAreaContextMenu`는 `selectionCount: 1, selectionHasDir: false`로 설정.

`someSelectedIsDir(fileTree, selectedPaths)`: 선택 경로 중 하나라도 폴더면 true — file-tree-multi-ops.ts에 순수 헬퍼로 추가 + 단위 테스트, 또는 로컬 헬퍼. (fileTree를 순회해 selectedPaths에 든 경로의 isDir 확인.)

(b) `handleContextMenuAction`의 delete/duplicate/move/copyPath를 다중 대응:

```tsx
        case "delete":
          if (target.selectionCount > 1) handleDeleteMany([...selectedPaths]);
          else if (target.targetPath) handleDelete(target.targetPath);
          break;
        case "move":
          if (target.selectionCount > 1) setMoveModalSources([...selectedPaths]);
          else if (target.targetPath) setMoveModalSources([target.targetPath]);
          break;
        case "duplicate":
          if (target.selectionCount > 1) {
            // 파일만 복제 (selectionHasDir면 메뉴에서 이미 비활성)
            for (const p of selectedPaths) actions.duplicateFile(p);
          } else if (target.targetPath && !target.targetIsDir) {
            actions.duplicateFile(target.targetPath);
          }
          break;
        case "copyPath":
          if (target.selectionCount > 1)
            actions.copyPath([...selectedPaths].join("\n"));
          else if (target.targetPath) actions.copyPath(target.targetPath);
          break;
```
deps에 `selectedPaths`, `handleDeleteMany` 추가.

- [ ] **Step 6: 테스트·타입·회귀 확인**

```bash
npx vitest run src/components/sidebar/__tests__/file-tree-context-menu.test.tsx > /tmp/t8.log 2>&1; echo $?
npm run typecheck > /tmp/tc8.log 2>&1; echo $?
npm test > /tmp/full8.log 2>&1; echo $?
```
Expected: 모두 exit 0. (ContextMenuState에 새 필수 필드가 생겼으므로 Task 1 테스트의 `base` 객체에 `selectionCount: 1, selectionHasDir: false`를 추가해야 컴파일된다 — 그 테스트도 함께 갱신.)

- [ ] **Step 7: 커밋**

```bash
git add src/components/sidebar/
git commit -m "feat(§4.3): multi-selection reduced context menu"
```

---

### Task 9: 최종 검증 + PR

**Files:** 없음 (검증 전용)

- [ ] **Step 1: 전체 게이트 실행**

```bash
cd /Users/donghoon.yoo/work/projects/baram
npm run typecheck > /tmp/final-tc.log 2>&1; echo $?
npm test > /tmp/final-test.log 2>&1; echo $?
npx knip > /tmp/final-knip.log 2>&1; echo $?
cd src-tauri && cargo test > /tmp/final-cargo.log 2>&1; echo $?
```
Expected: 모두 exit 0. cargo는 capability JSON 변경만이므로 빌드 통과가 핵심.

- [ ] **Step 2: 수동 GUI 검증 (npm run tauri dev)**

체크리스트:
1. 파일 우클릭 → 전체 메뉴(새 탭 열기 / 복제 / 이동… / 이름 변경 / 삭제 / 경로·상대경로·위키링크 복사 / Reveal / Export)
2. 폴더 우클릭 → 새 파일/새 폴더 + 이동/이름변경/삭제/경로 복사 + Reveal (위키링크·Export·Duplicate 없음)
3. 빈 영역 우클릭 → 새 파일/새 폴더만
4. 경로 복사 3종 → 클립보드 실제 내용 확인 (붙여넣기)
5. 위키링크 복사 → 동명 파일 있을 때 상대경로 라벨
6. 복제 → `name-1.ext` 생성, 연속 복제 시 `-2`
7. Reveal in Finder → OS 파일 매니저에서 파일 선택되어 열림
8. Export… → 파일이 탭으로 열리고 export 다이얼로그 표시
9. 이동… → 폴더 피커에서 대상 선택 → 파일 이동, 열린 탭 경로 갱신
10. 다중 선택(Cmd+클릭 2개) 후 우클릭 → 축소 메뉴(Duplicate/Move/Delete/Copy Path); 폴더 포함 시 Duplicate 비활성
11. DnD 이동 회귀 없음(PR1 기능) — 공유 훅 리팩토링 후에도 드래그 이동 정상

- [ ] **Step 3: push (백그라운드) + PR 생성**

```bash
git -c core.sshCommand="ssh -i ~/.ssh/id_ed25519_macbook" push -u origin feature/file-tree-context-menu
```

PR 제목: `feat(§4.3): file tree context menu expansion (11 actions + move modal)`
PR 본문(영어): Motivation / Design decisions (컴포넌트 분리, 순수 라벨 함수, 공유 이동 훅, capability 권한) / Architecture diagram (menu ↔ actions hook ↔ move hook ↔ modal) / Implementation details / Test results (typecheck·vitest·knip·cargo + GUI 체크리스트) / Known limitations (버전 히스토리는 별도 PR, 폴더 복제 미지원) / Checklist. "PR 2/5" 표기.

---

## Self-Review 결과

- **Spec §4.3 coverage**: 새 탭 열기(T6)·복제(T4)·이동(T7)·이름변경/삭제(기존, T1 유지)·경로/상대경로/위키링크 복사(T2·T3)·Reveal(T5)·Export(T6)·다중 축소 세트(T8) → 11개 액션 전부. 버전 히스토리는 사용자 결정으로 제외(별도 PR). 폴더/빈영역/다중 조건부 노출 = T1·T3·T8.
- **아키텍처 결정 반영**: 메뉴 컴포넌트 분리(T1, spec §3 결정 3), 이동 로직 공유 훅으로 DnD와 모달 통합(T7), 내보내기 "열고 나서 export"(T6, spec §3 결정 5), 클립보드 순수 함수 + capability(T2).
- **재사용 준수**: `resolveNameConflict`/`basename`/`dirname`/`getRelativePath`(path-utils), `planMultiMove`/`showAlert`(PR1), `flattenFileTree`(file-search) 재사용 — 로컬 재구현 없음.
- **경계 케이스**: 위키링크 동명 충돌 → 상대경로 라벨; 복제 순번; 이동 실패 부분 보고; 다중 폴더 포함 시 복제 비활성; ContextMenuState 필수 필드 추가로 기존 테스트 갱신 필요(T8 Step 6 명시).
- **타입 일관성**: `UseFileTreeActionsReturn`(copyPath/copyRelativePath/copyWikilink/duplicateFile/revealInFileManager/openInNewTab/exportFile) T3–T6 누적; `useFileTreeMove().moveEntries` T7 정의 = T8 사용; `ContextMenuState.selectionCount/selectionHasDir` T8 정의 = 메뉴·디스패치 사용 일치.
- **리스크**: T7의 DnD 리팩토링이 PR1 검증 코드를 수정 → 전체 `npm test` + GUI DnD 체크로 회귀 방지. capability 권한 ID 오타 시 런타임 실패 → cargo 빌드 + GUI Reveal/Copy 실검증.
