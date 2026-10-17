// §5.11 — the search panel's Replace and Replace All, through the real component.
// The list comes from the Rust search; the replace builds its own JS pattern from
// the same query and toggles, and must wrap it as the search did. The two regex
// dialects still differ elsewhere — JS `\b` knows ASCII word characters only — so
// these tests use ASCII text.
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

// `getConfig` · `setConfig` · `removeConfig` are the persisted stores' storage,
// read when the stores below are imported — before any `beforeEach` runs.
const ipc = vi.hoisted(() => ({
  getConfig: vi.fn().mockResolvedValue(null),
  readFile: vi.fn(),
  removeConfig: vi.fn().mockResolvedValue(undefined),
  searchFiles: vi.fn(),
  setConfig: vi.fn().mockResolvedValue(undefined),
  writeFile: vi.fn(),
}));
vi.mock("../../../ipc/invoke", () => ipc);

import { useFileStore } from "../../../stores/file/file";
import { GlobalSearch } from "../GlobalSearch";

/** The panel with `a|b` searched as a whole-word regex and the replace row open. */
async function searchWholeWordAlternatives(snippet: string) {
  render(<GlobalSearch />);
  fireEvent.click(screen.getByRole("button", { name: "Match whole word" }));
  fireEvent.click(
    screen.getByRole("button", { name: "Use regular expression" }),
  );
  fireEvent.change(screen.getByPlaceholderText("Search across files…"), {
    target: { value: "a|b" },
  });
  await screen.findAllByText(snippet);
  // The toggles reached the search the list came from.
  expect(ipc.searchFiles).toHaveBeenLastCalledWith(
    "/r",
    "a|b",
    expect.objectContaining({ regex: true, wholeWord: true }),
  );
  fireEvent.click(screen.getByRole("button", { name: "Toggle replace" }));
  fireEvent.change(screen.getByPlaceholderText("Replace with…"), {
    target: { value: "X" },
  });
}

describe("§5.11 GlobalSearch replace with a whole-word regex", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    ipc.writeFile.mockResolvedValue(undefined);
    useFileStore.setState({ rootPath: "/r" });
  });

  // The Rust search reads `a|b` with whole words as `\b(?:a|b)\b` and lists the
  // two words. What fails this: the replace wrapping the query without the
  // group, `\ba|b\b`, which also rewrites the `a` of `apple` and the `b` of
  // `web` — text the panel never listed.
  it("Replace All rewrites only the whole words the panel listed", async () => {
    const line = "a b apple web";
    ipc.searchFiles.mockResolvedValue([
      { filePath: "/r/a.md", line: 1, column: 0, snippet: line },
      { filePath: "/r/a.md", line: 1, column: 2, snippet: line },
    ]);
    ipc.readFile.mockResolvedValue(line);
    await searchWholeWordAlternatives(line);

    fireEvent.click(screen.getByRole("button", { name: "Replace All" }));

    await waitFor(() => expect(ipc.writeFile).toHaveBeenCalledTimes(1));
    expect(ipc.writeFile).toHaveBeenCalledWith("/r/a.md", "X X apple web");
  });

  // Replace on one match rewrites the first match on that line. What fails
  // this: the ungrouped `\ba|b\b`, whose first match on `ab a` is the `a` that
  // starts `ab`.
  it("Replace rewrites the first whole word on the line", async () => {
    const line = "ab a";
    ipc.searchFiles.mockResolvedValue([
      { filePath: "/r/a.md", line: 1, column: 3, snippet: line },
    ]);
    ipc.readFile.mockResolvedValue(`${line}\nnext`);
    await searchWholeWordAlternatives(line);

    fireEvent.click(screen.getByRole("button", { name: "Replace this match" }));

    await waitFor(() => expect(ipc.writeFile).toHaveBeenCalledTimes(1));
    expect(ipc.writeFile).toHaveBeenCalledWith("/r/a.md", "ab X\nnext");
  });
});
