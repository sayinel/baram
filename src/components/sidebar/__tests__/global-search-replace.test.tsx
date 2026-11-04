// §5.11 — the search panel's Replace and Replace All, through the real component. The list
// comes from the Rust search; the replacement is made by the Rust command that matches the same
// way (`replace_search_matches`, whose matching `search/replace.rs` tests), so what these pin is
// what the panel hands it and what the panel writes back.
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

// `getConfig` · `setConfig` · `removeConfig` are the persisted stores' storage,
// read when the stores below are imported — before any `beforeEach` runs.
const ipc = vi.hoisted(() => ({
  getConfig: vi.fn().mockResolvedValue(null),
  readFile: vi.fn(),
  removeConfig: vi.fn().mockResolvedValue(undefined),
  replaceSearchMatches: vi.fn(),
  searchFiles: vi.fn(),
  setConfig: vi.fn().mockResolvedValue(undefined),
  writeFile: vi.fn(),
}));
vi.mock("../../../ipc/invoke", () => ipc);

import { useFileStore } from "../../../stores/file/file";
import { GlobalSearch } from "../GlobalSearch";

const WHOLE_WORD_REGEX = expect.objectContaining({
  caseSensitive: false,
  regex: true,
  wholeWord: true,
});

/** The panel with `가|b` searched as a whole-word regex and the replace row open. */
async function searchAndOpenReplace(snippet: string) {
  render(<GlobalSearch />);
  fireEvent.click(screen.getByRole("button", { name: "Match whole word" }));
  fireEvent.click(
    screen.getByRole("button", { name: "Use regular expression" }),
  );
  fireEvent.change(screen.getByPlaceholderText("Search across files…"), {
    target: { value: "가|b" },
  });
  await screen.findAllByText(snippet);
  expect(ipc.searchFiles).toHaveBeenLastCalledWith(
    "/r",
    "가|b",
    WHOLE_WORD_REGEX,
  );
  fireEvent.click(screen.getByRole("button", { name: "Toggle replace" }));
  fireEvent.change(screen.getByPlaceholderText("Replace with…"), {
    target: { value: "X" },
  });
}

describe("§5.11 GlobalSearch Replace and Replace All", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    ipc.writeFile.mockResolvedValue(undefined);
    useFileStore.setState({ openFiles: new Map(), rootPath: "/r" });
  });

  // What fails this: Replace All building its own pattern in JS (it rewrote text the list did
  // not show — JS `\b` knows ASCII word characters only), handing the command other options
  // than the search's, or writing anything but what the command returns.
  it("Replace All hands each listed file's text to the search's replacement and writes what comes back", async () => {
    const text = "가 x가y\nb";
    ipc.searchFiles.mockResolvedValue([
      { filePath: "/r/a.md", line: 1, column: 1, snippet: "가 x가y" },
      { filePath: "/r/a.md", line: 2, column: 1, snippet: "b" },
    ]);
    ipc.readFile.mockResolvedValue(text);
    ipc.replaceSearchMatches.mockResolvedValue("X x가y\nX");
    await searchAndOpenReplace("가 x가y");

    fireEvent.click(screen.getByRole("button", { name: "Replace All" }));

    await waitFor(() => expect(ipc.writeFile).toHaveBeenCalledTimes(1));
    expect(ipc.replaceSearchMatches).toHaveBeenCalledTimes(1);
    expect(ipc.replaceSearchMatches).toHaveBeenCalledWith(
      text,
      "가|b",
      WHOLE_WORD_REGEX,
      "X",
      { kind: "all" },
    );
    expect(ipc.writeFile).toHaveBeenCalledWith("/r/a.md", "X x가y\nX");
  });

  // What fails this: Replace rewriting the first match on the line (what it did — `x가y` would
  // lose its `가` when the user clicked the last word), i.e. not handing over the clicked
  // match's line and column, or handing them over as Replace All.
  it("Replace hands over the clicked match's line and column", async () => {
    const text = "가 x가y 가";
    ipc.searchFiles.mockResolvedValue([
      { filePath: "/r/a.md", line: 1, column: 11, snippet: text },
    ]);
    ipc.readFile.mockResolvedValue(text);
    ipc.replaceSearchMatches.mockResolvedValue("가 x가y X");
    await searchAndOpenReplace(text);

    fireEvent.click(screen.getByRole("button", { name: "Replace this match" }));

    await waitFor(() => expect(ipc.writeFile).toHaveBeenCalledTimes(1));
    expect(ipc.replaceSearchMatches).toHaveBeenCalledWith(
      text,
      "가|b",
      WHOLE_WORD_REGEX,
      "X",
      { column: 11, kind: "one", line: 1 },
    );
    expect(ipc.writeFile).toHaveBeenCalledWith("/r/a.md", "가 x가y X");
  });

  // A file the file store holds is replaced in that copy, and the copy is updated — the editor
  // reloads from it (`triggerContentReload`). What fails this: reading the disk instead, or
  // leaving the store's copy as it was, so the reload shows the text from before the replace.
  it("an open file's text is the one replaced, and its open copy is updated", async () => {
    useFileStore.setState({
      openFiles: new Map([["/r/a.md", "b unsaved"]]),
      rootPath: "/r",
    });
    ipc.searchFiles.mockResolvedValue([
      { filePath: "/r/a.md", line: 1, column: 1, snippet: "b on disk" },
    ]);
    ipc.replaceSearchMatches.mockResolvedValue("X unsaved");
    await searchAndOpenReplace("b on disk");

    fireEvent.click(screen.getByRole("button", { name: "Replace All" }));

    await waitFor(() => expect(ipc.writeFile).toHaveBeenCalledTimes(1));
    expect(ipc.readFile).not.toHaveBeenCalled();
    expect(ipc.replaceSearchMatches.mock.calls[0][0]).toBe("b unsaved");
    expect(useFileStore.getState().openFiles.get("/r/a.md")).toBe("X unsaved");
  });

  // What fails this: writing whenever the command answers — a file with no match left where
  // the list said would be written back unchanged (and, for an open file, with the store's copy
  // of it).
  it("a file the replacement leaves as it was is not written", async () => {
    ipc.searchFiles.mockResolvedValue([
      { filePath: "/r/a.md", line: 1, column: 1, snippet: "b" },
    ]);
    ipc.readFile.mockResolvedValue("b");
    ipc.replaceSearchMatches.mockResolvedValue("b");
    await searchAndOpenReplace("b");

    fireEvent.click(screen.getByRole("button", { name: "Replace this match" }));

    await waitFor(() =>
      expect(ipc.replaceSearchMatches).toHaveBeenCalledTimes(1),
    );
    await waitFor(() => expect(ipc.searchFiles).toHaveBeenCalledTimes(2));
    expect(ipc.writeFile).not.toHaveBeenCalled();
  });
  // While a replace runs, every Replace button is disabled — the per-match ones too. What fails
  // this: a second click on a per-match button before the list is searched again, which
  // replaces whatever now starts at the stale line and column (replacing `cat` with `cats`
  // twice gives `catss`).
  it("the per-match Replace buttons are disabled while a replace runs", async () => {
    ipc.searchFiles.mockResolvedValue([
      { filePath: "/r/a.md", line: 1, column: 1, snippet: "b" },
    ]);
    ipc.readFile.mockResolvedValue("b");
    ipc.replaceSearchMatches.mockReturnValue(new Promise(() => {}));
    await searchAndOpenReplace("b");
    const button = screen.getByRole("button", { name: "Replace this match" });

    fireEvent.click(button);

    await waitFor(() => expect(button).toBeDisabled());
    expect(screen.getByRole("button", { name: "Replace All" })).toBeDisabled();
  });
  // A replace the command refuses (a pattern it cannot build, or a text grown past its limit)
  // says why in the panel, the list is searched again — Replace All may have written files
  // before the one that failed — and the list stays on screen. What fails this: only logging
  // the refusal (what the panel did), which leaves the list showing matches that may be gone.
  it("a refused replace says why and searches the list again", async () => {
    const refusal =
      "The replaced text would grow by more than 64 MiB; this file was left as it was";
    ipc.searchFiles.mockResolvedValue([
      { filePath: "/r/a.md", line: 1, column: 1, snippet: "b" },
    ]);
    ipc.readFile.mockResolvedValue("b");
    ipc.replaceSearchMatches.mockRejectedValue(refusal);
    await searchAndOpenReplace("b");

    fireEvent.click(screen.getByRole("button", { name: "Replace All" }));

    await screen.findByText(refusal);
    expect(ipc.searchFiles).toHaveBeenCalledTimes(2);
    expect(ipc.writeFile).not.toHaveBeenCalled();
    expect(
      screen.getByRole("button", { name: "Replace this match" }),
    ).toBeEnabled();
  });
});
