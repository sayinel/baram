// §390 spec 0069 §3.3 — Quick Switcher over names some tool stored
// decomposed (NFD), queried with the composed (NFC) text a keyboard types.
import type { FileEntry } from "../../../stores/file/file";

import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import { useFileStore } from "../../../stores/file/file";
import { useSettingsStore } from "../../../stores/settings/store";
import { useUIStore } from "../../../stores/ui/ui";
import { QuickSwitcher } from "../QuickSwitcher";

const NOTE = "새 노트";
const NOTE_NFD = NOTE.normalize("NFD");
const PROJECT = "프로젝트";
const PROJECT_NFD = PROJECT.normalize("NFD");

function folder(path: string, children: FileEntry[]): FileEntry {
  return {
    children,
    isDir: true,
    name: path.slice(path.lastIndexOf("/") + 1),
    path,
  } as FileEntry;
}

function leaf(path: string): FileEntry {
  return {
    isDir: false,
    name: path.slice(path.lastIndexOf("/") + 1),
    path,
  } as FileEntry;
}

beforeEach(() => {
  useUIStore.setState({ quickSwitcherOpen: true });
  useSettingsStore.setState({ locale: "ko" });
  useFileStore.setState({
    fileTree: [
      leaf(`/v/${NOTE_NFD}.md`),
      folder(`/v/${PROJECT_NFD}`, [leaf(`/v/${PROJECT_NFD}/a.md`)]),
      folder("/v/other", [leaf("/v/other/b.md")]),
    ],
    rootPath: "/v",
  });
});

function type(value: string) {
  fireEvent.change(screen.getByRole("textbox"), { target: { value } });
}

describe("§390 QuickSwitcher across normalization", () => {
  it("the spellings differ", () => {
    expect(NOTE_NFD).not.toBe(NOTE);
    expect(PROJECT_NFD).not.toBe(PROJECT);
  });

  it("lists the stored name for the name typed, and offers no create for it", () => {
    // What fails this: the create check comparing by toLowerCase — the row is
    // found (fuzzy matching folds), yet "create" is offered beside it.
    render(<QuickSwitcher editor={null} onNewFile={() => {}} />);
    type(`${NOTE}.md`);
    expect(screen.getByText(`${NOTE_NFD}.md`)).toBeTruthy();
    expect(screen.queryByText(`"${NOTE}.md" 만들기`)).toBeNull();
  });

  it("still offers create for a name nothing has", () => {
    // The partner: the create row still appears where nothing matches.
    // What fails this: the create check never offering a row — the `some(…)`
    // replaced by `false`.
    render(<QuickSwitcher editor={null} onNewFile={() => {}} />);
    type("없는 노트");
    expect(screen.getByText('"없는 노트" 만들기')).toBeTruthy();
  });

  it("filters by a namespace typed composed", () => {
    // What fails this: the ns: filter comparing by toLowerCase.
    render(<QuickSwitcher editor={null} onNewFile={() => {}} />);
    type(`ns:${PROJECT}`);
    expect(screen.getByText("a.md")).toBeTruthy();
    expect(screen.queryByText("b.md")).toBeNull();
  });

  // The create and namespace tests above type composed text over decomposed
  // names, so a fold kept on the stored side alone passes them. Each test
  // below turns that around — text typed decomposed over names kept composed —
  // to pin the query's side of its comparison.
  it("lists the composed name for the name typed decomposed, and offers no create for it", () => {
    // What fails this: the create check folding the stored name but not the
    // name typed (`q`) — the row is found, yet "create" is offered beside it.
    useFileStore.setState({ fileTree: [leaf(`/v/${NOTE}.md`)] });
    render(<QuickSwitcher editor={null} onNewFile={() => {}} />);
    type(`${NOTE_NFD}.md`);
    expect(screen.getByText(`${NOTE}.md`)).toBeTruthy();
    expect(screen.queryByText(`"${NOTE_NFD}.md" 만들기`)).toBeNull();
  });

  it("filters by a namespace typed decomposed", () => {
    // What fails this: the ns: filter folding the folder but not the name
    // typed (`nsKey`).
    useFileStore.setState({
      fileTree: [
        folder(`/v/${PROJECT}`, [leaf(`/v/${PROJECT}/a.md`)]),
        folder("/v/other", [leaf("/v/other/b.md")]),
      ],
    });
    render(<QuickSwitcher editor={null} onNewFile={() => {}} />);
    type(`ns:${PROJECT_NFD}`);
    expect(screen.getByText("a.md")).toBeTruthy();
    expect(screen.queryByText("b.md")).toBeNull();
  });
});
