// §3.6 Phase 4: unit tests for shouldDeferSave mtime guard
import { afterEach, describe, expect, it, vi } from "vitest";

import * as ipcInvoke from "../../ipc/invoke";
import { shouldDeferSave } from "../use-auto-save";

describe("shouldDeferSave", () => {
  // ── no entry ──────────────────────────────────────────────────────────────

  it("returns false when mtimeEntry is undefined (file not tracked)", () => {
    expect(shouldDeferSave(undefined)).toBe(false);
  });

  // ── canReloadMtime = 0 (no external change seen yet) ─────────────────────

  it("returns false when canReloadMtime is 0 (watcher not yet fired)", () => {
    expect(shouldDeferSave({ canReloadMtime: 0, lastSaveMtime: 0 })).toBe(
      false,
    );
  });

  it("returns false when canReloadMtime is 0 even if lastSaveMtime is non-zero", () => {
    expect(shouldDeferSave({ canReloadMtime: 0, lastSaveMtime: 1000 })).toBe(
      false,
    );
  });

  // ── canReloadMtime <= lastSaveMtime (external change already handled) ─────

  it("returns false when canReloadMtime equals lastSaveMtime (change already saved)", () => {
    expect(shouldDeferSave({ canReloadMtime: 1000, lastSaveMtime: 1000 })).toBe(
      false,
    );
  });

  it("returns false when canReloadMtime is older than lastSaveMtime", () => {
    // External event was older than the last local save — no pending conflict
    expect(shouldDeferSave({ canReloadMtime: 500, lastSaveMtime: 1000 })).toBe(
      false,
    );
  });

  // ── canReloadMtime > lastSaveMtime (pending external change) ──────────────

  it("returns true when canReloadMtime > lastSaveMtime (external change pending)", () => {
    expect(shouldDeferSave({ canReloadMtime: 2000, lastSaveMtime: 1000 })).toBe(
      true,
    );
  });

  it("returns true when lastSaveMtime is 0 and canReloadMtime > 0 (first external change before any save)", () => {
    expect(shouldDeferSave({ canReloadMtime: 1000, lastSaveMtime: 0 })).toBe(
      true,
    );
  });

  it("returns true for a large mtime difference", () => {
    expect(
      shouldDeferSave({
        canReloadMtime: 1_700_000_000_000,
        lastSaveMtime: 1_699_999_990_000,
      }),
    ).toBe(true);
  });
});

// ── Integration: auto-save deferred while conflict pending ────────────────────
//
// The full save() function lives inside the React hook (not independently
// callable without a renderer). The integration contract is therefore verified
// by asserting the guard's behaviour at the boundaries that save() uses:
//
//   1. getFileMtime() returns an entry where canReloadMtime > lastSaveMtime
//      → shouldDeferSave returns true → save() returns early (no writeFile)
//
//   2. After a successful save, updateLastSaveMtime is called with Date.now(),
//      so the next call to shouldDeferSave with that updated entry returns false.
//
// These contracts are validated via shouldDeferSave unit tests above.
// End-to-end coverage of the full save() flow (writeFile mock, markDirty, etc.)
// is deferred to E2E/Playwright where the hook runs inside a real React tree.

describe("shouldDeferSave — post-save baseline contract", () => {
  it("returns false immediately after save resets lastSaveMtime to >= canReloadMtime", () => {
    const canReloadMtime = 1000;
    // Simulate what updateLastSaveMtime(path, Date.now()) produces right after save
    const lastSaveMtime = canReloadMtime + 1; // save happened after external change
    expect(shouldDeferSave({ canReloadMtime, lastSaveMtime })).toBe(false);
  });

  it("returns false when lastSaveMtime exactly matches canReloadMtime (reload resolved)", () => {
    // After conflict resolution (reload), lastSaveMtime is set to externalMtime
    const mtime = 5000;
    expect(
      shouldDeferSave({ canReloadMtime: mtime, lastSaveMtime: mtime }),
    ).toBe(false);
  });
});

describe("§278.1 a binary viewer tab must never be marked dirty", () => {
  // 실앱 증상: 위키링크로 PDF를 열면 아무 편집도 안 했는데 dirty 표시가 뜨고,
  // 닫을 때 저장하겠냐고 묻는다.
  //
  // ‼️ 표시만의 문제가 아니다. App.tsx의 비-마크다운 자동 저장 효과는
  // `isCodeFile`(= "마크다운이 아님", 그래서 PDF도 통과)로 걸려 있고 탭이 dirty일 때
  // 발화해 `sourceContentRef.current`를 그 경로에 쓴다. autoSave 기본값이 true이므로
  // **dirty가 된 PDF는 곧 텍스트로 덮어써질 PDF다.**
  //
  // handleUpdate는 이벤트 시점의 activeTabId를 읽는다. 그래서 마크다운 문서에서
  // 발생한 트랜잭션이 그 시점에 활성인 탭(= 방금 연 PDF)에 dirty를 찍는다.
  //
  // 순수 술어를 따로 만들어 단정하지 않는다 — 그러면 배선이 아니라 래퍼를 시험하게
  // 되고, 가드가 실제로 그 경로에 꽂혔는지는 증명되지 않는다.
  it("PDF 탭이 활성인 동안 발생한 트랜잭션은 dirty를 만들지 않는다", async () => {
    const { Editor } = await import("@tiptap/core");
    const { renderHook } = await import("@testing-library/react");
    const { createBaramExtensions } = await import("../../extensions");
    const { useEditorStore } = await import("../../stores/editor/editor");
    const { useAutoSave } = await import("../use-auto-save");

    const editor = new Editor({
      extensions: createBaramExtensions(),
      content: "<p>hello</p>",
    });
    renderHook(() => useAutoSave(editor));

    const store = useEditorStore.getState();
    const pdfTab = {
      filePath: "/vault/papers/attention.pdf",
      id: "pdf-tab",
      isDirty: false,
      isPinned: false,
      title: "attention.pdf",
    };
    useEditorStore.setState({
      activeTabId: pdfTab.id,
      tabs: [pdfTab],
    } as never);

    // 마크다운 문서 쪽에서 온 편집 — 활성 탭은 PDF다.
    editor.commands.insertContent(" edited");

    const after = useEditorStore
      .getState()
      .tabs.find((t) => t.id === pdfTab.id);
    expect(after?.isDirty).toBe(false);

    editor.destroy();
    useEditorStore.setState({
      activeTabId: store.activeTabId,
      tabs: store.tabs,
    });
  });
});

// ── §384 (C): ephemeral syntax-reveal transactions must not mark dirty ─────
//
// Wiring-level, not a pure-predicate test — same reasoning as the PDF guard
// above: asserting isEphemeralOnlyUpdate() in isolation would prove the
// classifier is correct without proving handleUpdate actually consults it.
describe("§384 (C) syntax-reveal expand/collapse vs. dirty/auto-save", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("moving the caret into a link leaves the tab clean and schedules no auto-save (red before the ephemeral gate)", async () => {
    const { Editor } = await import("@tiptap/core");
    const { renderHook } = await import("@testing-library/react");
    const { createBaramExtensions } = await import("../../extensions");
    const { markdownToProsemirror } = await import("../../pipeline/md-to-pm");
    const { useEditorStore } = await import("../../stores/editor/editor");
    const { useSettingsStore } = await import("../../stores/settings/store");
    const { useAutoSave } = await import("../use-auto-save");

    const writeFileSpy = vi
      .spyOn(ipcInvoke, "writeFile")
      .mockResolvedValue(undefined);
    vi.spyOn(ipcInvoke, "updateFileIndex").mockResolvedValue(undefined);

    const editorStoreBaseline = useEditorStore.getState();
    const settingsBaseline = useSettingsStore.getState();
    useSettingsStore.setState({ autoSave: true, autoSaveDelay: 2000 });

    vi.useFakeTimers();

    const editor = new Editor({
      extensions: createBaramExtensions(),
      content: "",
    });
    const doc = markdownToProsemirror(
      "Hello [world](https://example.com) end\n",
      editor.schema,
    );
    editor.commands.setContent(doc.toJSON());

    renderHook(() => useAutoSave(editor));

    const tab = {
      filePath: "/vault/note.md",
      id: "link-ephemeral-tab",
      isDirty: false,
      isPinned: false,
      title: "note.md",
    };
    useEditorStore.setState({ activeTabId: tab.id, tabs: [tab] } as never);

    // Two-step move clears the plugin's cursorAtDocChange guard so the
    // expansion check actually runs (see syntax-reveal.test.ts's moveCursorTo).
    editor.commands.setTextSelection(2);
    editor.commands.setTextSelection(9);

    expect(editor.state.doc.textContent).toContain(
      "[world](https://example.com)",
    );

    const afterExpand = useEditorStore
      .getState()
      .tabs.find((t) => t.id === tab.id);
    expect(afterExpand?.isDirty).toBe(false);

    await vi.advanceTimersByTimeAsync(2500);
    expect(writeFileSpy).not.toHaveBeenCalled();

    editor.destroy();
    useEditorStore.setState({
      activeTabId: editorStoreBaseline.activeTabId,
      tabs: editorStoreBaseline.tabs,
    });
    useSettingsStore.setState(settingsBaseline);
  });

  it("Backspace on the opening delimiter of an expanded link marks the tab dirty and schedules an auto-save", async () => {
    const { Editor } = await import("@tiptap/core");
    const { renderHook } = await import("@testing-library/react");
    const { createBaramExtensions } = await import("../../extensions");
    const { markdownToProsemirror } = await import("../../pipeline/md-to-pm");
    const { useEditorStore } = await import("../../stores/editor/editor");
    const { useSettingsStore } = await import("../../stores/settings/store");
    const { useAutoSave } = await import("../use-auto-save");

    const writeFileSpy = vi
      .spyOn(ipcInvoke, "writeFile")
      .mockResolvedValue(undefined);
    vi.spyOn(ipcInvoke, "updateFileIndex").mockResolvedValue(undefined);

    const editorStoreBaseline = useEditorStore.getState();
    const settingsBaseline = useSettingsStore.getState();
    useSettingsStore.setState({ autoSave: true, autoSaveDelay: 2000 });

    vi.useFakeTimers();

    const editor = new Editor({
      extensions: createBaramExtensions(),
      content: "",
    });
    const doc = markdownToProsemirror(
      "Hello [world](https://example.com) end\n",
      editor.schema,
    );
    editor.commands.setContent(doc.toJSON());

    renderHook(() => useAutoSave(editor));

    const tab = {
      filePath: "/vault/backspace-tab.md",
      id: "backspace-delim-tab",
      isDirty: false,
      isPinned: false,
      title: "backspace-tab.md",
    };
    useEditorStore.setState({ activeTabId: tab.id, tabs: [tab] } as never);

    // Expand the link, then place the caret right after the opening "[" —
    // the exact position handleKeyDown's Backspace branch checks for.
    editor.commands.setTextSelection(2);
    editor.commands.setTextSelection(9);
    expect(editor.state.doc.textContent).toContain(
      "[world](https://example.com)",
    );
    const openBracketPos = editor.state.doc.textContent.indexOf("[world");
    // textContent index 0 → doc pos 1 (paragraph start); +1 more to land
    // right after the "[" itself.
    editor.commands.setTextSelection(openBracketPos + 1 + 1);

    editor.view.dom.dispatchEvent(
      new KeyboardEvent("keydown", {
        bubbles: true,
        cancelable: true,
        key: "Backspace",
      }),
    );

    // The whole expanded range was deleted — a real edit, not a reveal.
    expect(editor.state.doc.textContent).not.toContain("world");

    const afterBackspace = useEditorStore
      .getState()
      .tabs.find((t) => t.id === tab.id);
    expect(afterBackspace?.isDirty).toBe(true);

    await vi.advanceTimersByTimeAsync(2500);
    expect(writeFileSpy).toHaveBeenCalledTimes(1);

    editor.destroy();
    useEditorStore.setState({
      activeTabId: editorStoreBaseline.activeTabId,
      tabs: editorStoreBaseline.tabs,
    });
    useSettingsStore.setState(settingsBaseline);
  });

  it("a real edit that also pushes the caret out of an expansion (real + appended collapse) marks the tab dirty", async () => {
    const { Editor } = await import("@tiptap/core");
    const { renderHook } = await import("@testing-library/react");
    const { createBaramExtensions } = await import("../../extensions");
    const { markdownToProsemirror } = await import("../../pipeline/md-to-pm");
    const { useEditorStore } = await import("../../stores/editor/editor");
    const { useSettingsStore } = await import("../../stores/settings/store");
    const { useAutoSave } = await import("../use-auto-save");

    const writeFileSpy = vi
      .spyOn(ipcInvoke, "writeFile")
      .mockResolvedValue(undefined);
    vi.spyOn(ipcInvoke, "updateFileIndex").mockResolvedValue(undefined);

    const editorStoreBaseline = useEditorStore.getState();
    const settingsBaseline = useSettingsStore.getState();
    useSettingsStore.setState({ autoSave: true, autoSaveDelay: 2000 });

    vi.useFakeTimers();

    const editor = new Editor({
      extensions: createBaramExtensions(),
      content: "",
    });
    const doc = markdownToProsemirror("Hello **world** end\n", editor.schema);
    editor.commands.setContent(doc.toJSON());

    renderHook(() => useAutoSave(editor));

    const tab = {
      filePath: "/vault/real-plus-appended.md",
      id: "real-plus-appended-tab",
      isDirty: false,
      isPinned: false,
      title: "real-plus-appended.md",
    };
    useEditorStore.setState({ activeTabId: tab.id, tabs: [tab] } as never);

    // "Hello " = 1-7, "world" bold = 7-12, " end" = 12-16.
    editor.commands.setTextSelection(2);
    editor.commands.setTextSelection(9);
    expect(editor.state.doc.textContent).toContain("**world**");

    // A single real transaction that both edits content elsewhere (position
    // 1, well outside the bold range) AND moves the caret outside the
    // expanded range as part of that SAME dispatch: syntax-reveal's
    // appendTransaction sees the post-edit selection and appends its own
    // (ephemeral) collapse transaction on top. The batch this produces is
    // [real, ephemeral-appended] — the "real-root + appended-collapse"
    // combination — and must not be swallowed as ephemeral-only.
    const { TextSelection } = await import("@tiptap/pm/state");
    const combinedTr = editor.state.tr.insertText("X", 1);
    combinedTr.setSelection(
      TextSelection.create(combinedTr.doc, combinedTr.doc.content.size),
    );
    editor.view.dispatch(combinedTr);

    const afterCombo = useEditorStore
      .getState()
      .tabs.find((t) => t.id === tab.id);
    expect(afterCombo?.isDirty).toBe(true);

    await vi.advanceTimersByTimeAsync(2500);
    expect(writeFileSpy).toHaveBeenCalledTimes(1);

    editor.destroy();
    useEditorStore.setState({
      activeTabId: editorStoreBaseline.activeTabId,
      tabs: editorStoreBaseline.tabs,
    });
    useSettingsStore.setState(settingsBaseline);
  });
});
