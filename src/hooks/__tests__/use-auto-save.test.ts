// §3.6 Phase 4: unit tests for shouldDeferSave mtime guard
import { describe, expect, it } from "vitest";

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
