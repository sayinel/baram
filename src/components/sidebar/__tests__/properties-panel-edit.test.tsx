// §72 The Properties panel's edits, through the real component: what reaches the file.
import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

// The persisted stores read and write their storage through `invoke`.
const invoke = vi.hoisted(() => vi.fn().mockResolvedValue(null));
vi.mock("@tauri-apps/api/core", () => ({ invoke }));
const showPrompt = vi.hoisted(() => vi.fn());
vi.mock("../../../utils/ai-commands", () => ({ showPrompt }));

import { useEditorStore } from "../../../stores/editor/editor";
import { useFileStore } from "../../../stores/file/file";
import { useUIStore } from "../../../stores/ui/ui";
import { PropertiesPanel } from "../PropertiesPanel";

const PATH = "/vault/note.md";
const NOTE = [
  "---",
  "title: old",
  "tags:",
  "  - a # kept",
  "meta:",
  "  nested: 1",
  "---",
  "body",
].join("\r\n");

const OTHER = "/vault/other.md";

function fileContent(): string {
  return useFileStore.getState().openFiles.get(PATH)!;
}

/** Makes a second tab, on `path`, the active one — the panel stays mounted. */
function switchTo(path: string): void {
  act(() => {
    useEditorStore.setState({
      activeTabId: "t2",
      tabs: [
        ...useEditorStore.getState().tabs,
        {
          contextId: "",
          filePath: path,
          id: "t2",
          isDirty: false,
          isPinned: false,
          title: "other.md",
        },
      ],
    });
  });
}

describe("PropertiesPanel edits (§72)", () => {
  beforeEach(() => {
    showPrompt.mockReset();
    useFileStore.setState({ openFiles: new Map([[PATH, NOTE]]) });
    useEditorStore.setState({
      activeTabId: "t1",
      tabs: [
        {
          contextId: "",
          filePath: PATH,
          id: "t1",
          isDirty: false,
          isPinned: false,
          title: "note.md",
        },
      ],
    });
    useUIStore.setState({ rightPanelMode: "properties", rightPanelOpen: true });
  });

  // What turns this red: rebuilding the note from the panel's entries — the block list's
  // comment, the nested map, the CRLF breaks and the line break after the closing `---` were
  // lost (`---body`).
  it("rewrites the edited property's line and nothing else", () => {
    render(<PropertiesPanel />);
    fireEvent.change(screen.getByDisplayValue("old"), {
      target: { value: "Plan: v2" },
    });
    expect(fileContent()).toBe(NOTE.replace("title: old", 'title: "Plan: v2"'));
  });

  // What turns this red: writing a flow map's text as a string — main wrote it as typed, and
  // YAML read it as the map; quoted, it would become the string `{a: 2}`.
  it("writes a value in YAML's own syntax as typed", () => {
    useFileStore.setState({
      openFiles: new Map([[PATH, "---\nm: {a: 1}\n---\nbody"]]),
    });
    render(<PropertiesPanel />);
    fireEvent.change(screen.getByDisplayValue("{a: 1}"), {
      target: { value: "{a: 2}" },
    });
    expect(fileContent()).toBe("---\nm: {a: 2}\n---\nbody");
  });

  // F50 What turns this red: recording a write that changed nothing — a refused edit pushed
  // an undo step and marked the tab dirty although the file stayed as it was.
  it("records nothing and says why when the list cannot be edited", async () => {
    const scalarTags = "---\ntags: solo\ntitle: t\n---\nbody";
    useFileStore.setState({ openFiles: new Map([[PATH, scalarTags]]) });
    useUIStore.setState({ toast: null });
    render(<PropertiesPanel />);
    showPrompt.mockResolvedValueOnce("x");
    await act(async () => {
      fireEvent.click(screen.getByLabelText("Add item"));
    });
    expect(fileContent()).toBe(scalarTags);
    expect(useEditorStore.getState().tabs[0].isDirty).toBe(false);
    expect((screen.getByLabelText("Undo") as HTMLButtonElement).disabled).toBe(
      true,
    );
    expect(useUIStore.getState().toast?.message).toBe(
      "This list can't be changed here. Edit it in the source YAML.",
    );
  });

  // F50 The panel's own guard: adding a property the front matter has writes nothing, so it
  // must record nothing either.
  it("records no undo step for an edit that changes nothing", () => {
    render(<PropertiesPanel />);
    fireEvent.click(screen.getByText("Add property"));
    const keyInput = screen.getByPlaceholderText("key 이름 입력 후 Enter");
    fireEvent.change(keyInput, { target: { value: "title" } });
    fireEvent.keyDown(keyInput, { key: "Enter" });
    expect(fileContent()).toBe(NOTE);
    expect(useEditorStore.getState().tabs[0].isDirty).toBe(false);
    expect((screen.getByLabelText("Undo") as HTMLButtonElement).disabled).toBe(
      true,
    );
  });

  // N1 What turns this red: writing each keystroke without the value's type at the start —
  // typing `-12` and back to `-1` left the string `"-1"`.
  it("writes back the original when a typed value is typed back", () => {
    useFileStore.setState({
      openFiles: new Map([[PATH, "---\nenergy: -1\n---\nbody"]]),
    });
    render(<PropertiesPanel />);
    const input = screen.getByDisplayValue("-1");
    fireEvent.change(input, { target: { value: "-" } });
    expect(fileContent()).toBe('---\nenergy: "-"\n---\nbody');
    fireEvent.change(input, { target: { value: "-1" } });
    expect(fileContent()).toBe("---\nenergy: -1\n---\nbody");
  });

  // M1 What turns this red: writing `yaml` text on every keystroke — `{a: ` mid-typing left a
  // front matter YAML cannot parse.
  it("keeps YAML text in the input, unwritten, until it is valid", () => {
    useFileStore.setState({
      openFiles: new Map([[PATH, "---\nm: {a: 1}\n---\nbody"]]),
    });
    render(<PropertiesPanel />);
    const input = screen.getByDisplayValue("{a: 1}") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "{a: " } });
    expect(fileContent()).toBe("---\nm: {a: 1}\n---\nbody");
    expect(input.value).toBe("{a: ");
    expect(input.getAttribute("aria-invalid")).toBe("true");
    fireEvent.change(input, { target: { value: "{a: 3}" } });
    expect(fileContent()).toBe("---\nm: {a: 3}\n---\nbody");
    expect(input.getAttribute("aria-invalid")).toBeNull();
  });

  // What turns this red: keeping the unwritten text once the input loses focus — the input
  // went on showing `{a: ` over a file that holds `{a: 1}`.
  it("drops the unwritten YAML text when the input loses focus", () => {
    useFileStore.setState({
      openFiles: new Map([[PATH, "---\nm: {a: 1}\n---\nbody"]]),
    });
    render(<PropertiesPanel />);
    const input = screen.getByDisplayValue("{a: 1}") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "{a: " } });
    expect(input.value).toBe("{a: ");
    fireEvent.blur(input);
    expect(input.value).toBe("{a: 1}");
    expect(input.getAttribute("aria-invalid")).toBeNull();
    expect(fileContent()).toBe("---\nm: {a: 1}\n---\nbody");
  });

  // M1 What turns this red: reading the field's type from what the last keystroke wrote —
  // emptied, `m:` reads as a string, and `{a: 3}` typed next was written as the string
  // `"{a: 3}"`; or reading `m:` as an empty list, which put a chip list in the input's place.
  it("keeps a YAML field YAML through an edit that empties it", () => {
    useFileStore.setState({
      openFiles: new Map([[PATH, "---\nm: {a: 1}\n---\nbody"]]),
    });
    render(<PropertiesPanel />);
    const input = screen.getByDisplayValue("{a: 1}") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "" } });
    expect(fileContent()).toBe("---\nm:\n---\nbody");
    expect(screen.queryByLabelText("Add item")).toBeNull();
    expect(input.isConnected).toBe(true);
    fireEvent.change(input, { target: { value: "{a: 3}" } });
    expect(fileContent()).toBe("---\nm: {a: 3}\n---\nbody");
  });

  // What turns this red: keeping an edit's start, or a draft, by key alone — switched to
  // another note mid-edit, its `energy: hello` was written as the number `3` (the first note's
  // `-1` was the start), and the first note's unfinished `{a: ` showed over `{b: 2}`.
  it("starts a new edit on another note", () => {
    useFileStore.setState({
      openFiles: new Map([
        [OTHER, "---\nenergy: hello\nm: {b: 2}\n---\nbody"],
        [PATH, "---\nenergy: -1\nm: {a: 1}\n---\nbody"],
      ]),
    });
    render(<PropertiesPanel />);
    const energy = screen.getByDisplayValue("-1") as HTMLInputElement;
    const map = screen.getByDisplayValue("{a: 1}") as HTMLInputElement;
    fireEvent.change(energy, { target: { value: "-" } });
    fireEvent.change(map, { target: { value: "{a: " } });
    switchTo(OTHER);
    expect(energy.isConnected).toBe(true);
    expect(energy.value).toBe("hello");
    expect(map.value).toBe("{b: 2}");
    expect(map.getAttribute("aria-invalid")).toBeNull();
    fireEvent.change(energy, { target: { value: "3" } });
    expect(useFileStore.getState().openFiles.get(OTHER)).toBe(
      '---\nenergy: "3"\nm: {b: 2}\n---\nbody',
    );
  });

  // The case the front matter alone cannot tell apart: the other note holds what this edit
  // left. Its string `"-"` typed to `-1` stays a string, rather than take this edit's `-1`.
  it("starts a new edit on another note whose front matter this edit left", () => {
    useFileStore.setState({
      openFiles: new Map([
        [OTHER, '---\nenergy: "-"\n---\nbody'],
        [PATH, "---\nenergy: -1\n---\nbody"],
      ]),
    });
    render(<PropertiesPanel />);
    const energy = screen.getByDisplayValue("-1") as HTMLInputElement;
    fireEvent.change(energy, { target: { value: "-" } });
    expect(fileContent()).toBe('---\nenergy: "-"\n---\nbody');
    switchTo(OTHER);
    fireEvent.change(energy, { target: { value: "-1" } });
    expect(useFileStore.getState().openFiles.get(OTHER)).toBe(
      '---\nenergy: "-1"\n---\nbody',
    );
  });

  // What turns this red: keeping an edit through a change made elsewhere — the value became
  // the number `5` in the editor, and `6` typed next was quoted after the edit's `hello`.
  it("starts a new edit when the front matter changed elsewhere", () => {
    useFileStore.setState({
      openFiles: new Map([[PATH, "---\nv: hello\n---\nbody"]]),
    });
    render(<PropertiesPanel />);
    const input = screen.getByDisplayValue("hello") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "hell" } });
    act(() => {
      useFileStore.setState({
        openFiles: new Map([[PATH, "---\nv: 5\n---\nbody"]]),
      });
    });
    fireEvent.change(input, { target: { value: "6" } });
    expect(fileContent()).toBe("---\nv: 6\n---\nbody");
  });

  // What turns this red: handing a value the list shows to the list writer — it writes
  // nothing for it, and the panel took that for a refusal and said the list could not be
  // changed.
  it("adds nothing, and says nothing, for a value the list has", async () => {
    const list = "---\naliases: [p]\n---\nbody";
    useFileStore.setState({ openFiles: new Map([[PATH, list]]) });
    useUIStore.setState({ toast: null });
    render(<PropertiesPanel />);
    showPrompt.mockResolvedValueOnce("p");
    await act(async () => {
      fireEvent.click(screen.getByLabelText("Add item"));
    });
    expect(fileContent()).toBe(list);
    expect((screen.getByLabelText("Undo") as HTMLButtonElement).disabled).toBe(
      true,
    );
    expect(useUIStore.getState().toast).toBeNull();
  });

  // What turns this red: adding the typed text as it is — `my tag` is a tag only in front
  // matter, which the body's `#` cannot reach.
  it("adds a tags chip only for a name a body tag can spell", async () => {
    render(<PropertiesPanel />);
    useUIStore.setState({ toast: null });
    showPrompt.mockResolvedValueOnce("my tag");
    await act(async () => {
      fireEvent.click(screen.getByLabelText("Add item"));
    });
    expect(fileContent()).toBe(NOTE);
    expect(useUIStore.getState().toast?.message).toBe(
      "#my tag cannot be a tag: a tag holds only letters, digits, _, - and /.",
    );

    showPrompt.mockResolvedValueOnce("#new");
    await act(async () => {
      fireEvent.click(screen.getByLabelText("Add item"));
    });
    expect(fileContent()).toBe(
      NOTE.replace("  - a # kept", "  - a # kept\r\n  - new"),
    );
  });
});
