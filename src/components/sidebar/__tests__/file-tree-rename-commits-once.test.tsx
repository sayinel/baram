// §33 — one rename gesture in the file tree sends one rename to the backend. Enter used to send two:
// `handleConfirmRename` returns focus to the tree while the input is still mounted, the input's blur
// confirmed the same name again, and the second IPC found the file already moved ("Rename failed:
// … os error 2"). The same blur turned Escape into a rename of whatever had been typed.
//
// Wired the way `FileTree.tsx` wires it: the real `FileTreeNode` (its rename input and the effect that
// focuses it) and the real `useFileTreeRename`, whose `treeRef` is the focusable tree container. The
// IPC is mocked — its call count is what the person's gesture costs on disk — and so are the store
// actions the hook calls after it (`renameFileEntry`, `renameTab`, `showToast`) and the row's click and
// menu handlers, none of which runs before the second call went out.
import { useRef } from "react";

import type { FileEntry } from "../../../stores/file/file";

import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../ipc/invoke", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../ipc/invoke")>()),
  readFile: vi.fn(async () => ""),
  renameFileWithLinks: vi.fn(),
  renameNamespace: vi.fn(),
}));

import { renameFileWithLinks } from "../../../ipc/invoke";
import { useEditorStore } from "../../../stores/editor/editor";
import { useFileStore } from "../../../stores/file/file";
import { EMPTY_GIT_BADGE_INDEX } from "../../../stores/system/git-badges";
import { useUIStore } from "../../../stores/ui/ui";
import { RenameInput } from "../file-tree-row-body";
import { FileTreeContext } from "../FileTreeContext";
import { FileTreeNode } from "../FileTreeNode";
import { useFileTreeRename } from "../hooks/use-file-tree-rename";

const ENTRY: FileEntry = { isDir: false, name: "b.md", path: "/vault/b.md" };
const RENAMED = { moved: [], skippedFiles: [], updatedFiles: [] };
const noop = (): void => {};
const showToast = vi.fn();

function Harness(): React.JSX.Element {
  const treeRef = useRef<HTMLDivElement>(null);
  const {
    handleCancelRename,
    handleConfirmRename,
    handleStartRename,
    renamingPath,
  } = useFileTreeRename(treeRef);
  return (
    <>
      <FileTreeContext
        value={{
          creatingEntry: null,
          dragOverPath: null,
          dragSourcePaths: [],
          expandedDirs: new Set<string>(),
          focusedPath: null,
          gitBadges: EMPTY_GIT_BADGE_INDEX,
          renamingPath,
          selectedPaths: new Set<string>(),
        }}
      >
        <div data-testid="tree" ref={treeRef} tabIndex={0}>
          <FileTreeNode
            depth={0}
            entry={ENTRY}
            onCancelCreate={noop}
            onCancelRename={handleCancelRename}
            onConfirmCreate={noop}
            onConfirmRename={(oldPath, newName) => {
              void handleConfirmRename(oldPath, newName);
            }}
            onContextMenu={noop}
            onDirClick={noop}
            onFileClick={noop}
            onStartRename={handleStartRename}
          />
        </div>
      </FileTreeContext>
      <button type="button">elsewhere</button>
    </>
  );
}

beforeEach(() => {
  vi.mocked(renameFileWithLinks).mockReset();
  vi.mocked(renameFileWithLinks).mockResolvedValue(RENAMED);
  showToast.mockReset();
  useFileStore.setState({
    fileTree: [ENTRY],
    renameFileEntry: vi.fn(),
    rootPath: "/vault",
  });
  useEditorStore.setState({ renameTab: vi.fn() });
  useUIStore.setState({ showToast });
});

/** Opens the rename input by double-clicking the name, as a person does, and types `name` into it. */
async function startRenameTyping(
  name: string,
): Promise<ReturnType<typeof userEvent.setup>> {
  const user = userEvent.setup();
  render(<Harness />);
  await user.dblClick(screen.getByText("b.md"));
  const input = screen.getByDisplayValue("b.md");
  expect(document.activeElement).toBe(input);
  await user.clear(input);
  await user.type(input, name);
  return user;
}

/** Lets the hook's awaited IPC settle, so a second call queued behind the first is counted too. */
async function settle(): Promise<void> {
  await act(async () => {});
}

describe("a rename gesture sends one rename (§33)", () => {
  it("Enter renames once and shows no error", async () => {
    // A second call would meet the file the first one moved — the refusal the app showed. With it in
    // place, the toast assertion below fails if two calls go out, whichever of them is first.
    vi.mocked(renameFileWithLinks)
      .mockResolvedValueOnce(RENAMED)
      .mockRejectedValueOnce(
        "파일 읽기 실패: No such file or directory (os error 2)",
      );
    const user = await startRenameTyping("c.md");
    await user.keyboard("{Enter}");
    await settle();

    expect(vi.mocked(renameFileWithLinks).mock.calls).toEqual([
      ["/vault/b.md", "/vault/c.md"],
    ]);
    expect(showToast).not.toHaveBeenCalled();
  });

  it("clicking elsewhere renames once", async () => {
    const user = await startRenameTyping("c.md");
    await user.click(screen.getByRole("button", { name: "elsewhere" }));
    await settle();

    expect(vi.mocked(renameFileWithLinks).mock.calls).toEqual([
      ["/vault/b.md", "/vault/c.md"],
    ]);
  });

  /** Its positive sibling is the Enter case: the same typing, confirmed, reaches the IPC — so this
   *  passes because Escape decides, not because the harness never reaches the backend. */
  it("Escape after typing a new name renames nothing and closes the input", async () => {
    const user = await startRenameTyping("c.md");
    await user.keyboard("{Escape}");
    await settle();

    expect(renameFileWithLinks).not.toHaveBeenCalled();
    expect(screen.queryByDisplayValue("c.md")).toBeNull();
  });
});

// The input's own contract, apart from its parent: these parents keep it mounted, so a blur after the
// outcome reaches it. In the tree that blur arrives DURING the outcome call — the handler moves focus
// before it returns — and the first two cases raise it that way. The next two raise it by clicking
// elsewhere after the call has returned.
describe("RenameInput reports one outcome", () => {
  /** `moveFocus`: the parent focuses another element inside `onConfirm` / `onCancel`, as
   *  `handleConfirmRename` and `handleCancelRename` focus the tree. */
  function input(defaultValue?: string, moveFocus = false) {
    const elsewhere = () => screen.getByRole("button", { name: "elsewhere" });
    const onConfirm = vi.fn(() => {
      if (moveFocus) elsewhere().focus();
    });
    const onCancel = vi.fn(() => {
      if (moveFocus) elsewhere().focus();
    });
    const user = userEvent.setup();
    render(
      <>
        <RenameInput
          defaultValue={defaultValue}
          onCancel={onCancel}
          onConfirm={onConfirm}
          placeholder="name"
        />
        <button type="button">elsewhere</button>
      </>,
    );
    const field = screen.getByPlaceholderText("name");
    field.focus();
    const away = () => user.click(elsewhere());
    return { away, elsewhere, field, onCancel, onConfirm, user };
  }

  it("Enter confirms once when the parent moves focus during the confirm", async () => {
    const { elsewhere, field, onCancel, onConfirm, user } = input("b.md", true);
    await user.clear(field);
    await user.type(field, "c.md{Enter}");
    // The blur did happen, inside the confirm: focus is on the element the parent focused.
    expect(document.activeElement).toBe(elsewhere());
    expect(onConfirm.mock.calls).toEqual([["c.md"]]);
    expect(onCancel).not.toHaveBeenCalled();
  });

  it("Escape cancels without confirming when the parent moves focus during the cancel", async () => {
    const { elsewhere, field, onCancel, onConfirm, user } = input("b.md", true);
    await user.clear(field);
    await user.type(field, "c.md{Escape}");
    expect(document.activeElement).toBe(elsewhere());
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("Enter confirms once, and the blur that follows adds nothing", async () => {
    const { away, field, onCancel, onConfirm, user } = input("b.md");
    await user.clear(field);
    await user.type(field, "c.md{Enter}");
    expect(onConfirm.mock.calls).toEqual([["c.md"]]);
    await away();
    expect(onConfirm.mock.calls).toEqual([["c.md"]]);
    expect(onCancel).not.toHaveBeenCalled();
  });

  it("Escape cancels once, and the blur that follows confirms nothing", async () => {
    const { away, field, onCancel, onConfirm, user } = input("b.md");
    await user.clear(field);
    await user.type(field, "c.md{Escape}");
    await away();
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("leaving the input confirms once", async () => {
    const { away, field, onCancel, onConfirm, user } = input("b.md");
    await user.clear(field);
    await user.type(field, "c.md");
    await away();
    expect(onConfirm.mock.calls).toEqual([["c.md"]]);
    expect(onCancel).not.toHaveBeenCalled();
  });

  it("CONTROL: a new entry's empty input cancels on blur, as before", async () => {
    const { away, onCancel, onConfirm } = input();
    await away();
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();
  });
});
