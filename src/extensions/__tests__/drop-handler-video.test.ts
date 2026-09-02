// §297 드랍·붙여넣기 경로의 동영상 분기.
//
// ‼️ 핵심 단정은 음성이다: 실패할 때 data URL로도, 조용한 절대경로로도 떨어지지
// 않고 — 대신 사용자에게 보이는 토스트를 띄우고 아무것도 삽입하지 않는다.
import type { Locale } from "../../i18n";
import type { NodeSpec } from "@tiptap/pm/model";
import type { EditorView } from "@tiptap/pm/view";

import { Editor } from "@tiptap/core";
import { Schema, Slice } from "@tiptap/pm/model";
import { EditorState } from "@tiptap/pm/state";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createBaramExtensions } from "..";
import { t } from "../../i18n";
import { useEditorStore } from "../../stores/editor/editor";
import { useFileStore } from "../../stores/file/file";
import { useSettingsStore } from "../../stores/settings/store";

const showToast = vi.fn();
const saveMediaToDocAssets = vi.fn(
  async (_bytes: Uint8Array, name: string, _docPath: string) =>
    `assets/${name}`,
);
const savePhotoToAssets = vi.fn(
  async (_bytes: Uint8Array, name: string) => `assets/${name}`,
);

vi.mock("../../utils/media-assets", () => ({
  saveMediaToDocAssets: (...a: unknown[]) =>
    saveMediaToDocAssets(...(a as [Uint8Array, string, string])),
}));

vi.mock("../../utils/journal/journal-photo", () => ({
  savePhotoToAssets: (...a: unknown[]) =>
    savePhotoToAssets(...(a as [Uint8Array, string])),
}));

vi.mock("../../stores/ui/ui", () => ({
  useUIStore: { getState: () => ({ showToast }) },
}));

import {
  getMediaFiles,
  insertJournalMediaFromBytes,
  insertMediaAtPos,
  insertVideoFromBytes,
} from "../plugins/drop-handler";

function makeFile(name: string, type: string): File {
  return new File(["x"], name, { type });
}

/** A minimal but real EditorState/dispatch pair — enough for insertMediaAtPos
 *  to run its actual ProseMirror transaction logic instead of a stub. */
function makeView(nodeNames: string[]): EditorView {
  const nodes: Record<string, NodeSpec> = {
    doc: { content: "block+" },
    paragraph: { content: "inline*", group: "block" },
    text: { group: "inline" },
  };
  for (const name of nodeNames) {
    nodes[name] = {
      group: "block",
      atom: true,
      attrs: {
        src: { default: null },
        alt: { default: null },
        title: { default: null },
      },
    };
  }
  const schema = new Schema({ nodes, marks: {} });
  const state = EditorState.create({ schema });
  const dispatch = vi.fn();
  return { state, dispatch } as unknown as EditorView;
}

function nodeTypesIn(view: EditorView): string[] {
  const dispatchMock = view.dispatch as unknown as ReturnType<typeof vi.fn>;
  const tr = dispatchMock.mock.calls[0][0] as { doc: { descendants: unknown } };
  const types: string[] = [];
  (
    tr.doc as unknown as {
      descendants: (cb: (node: { type: { name: string } }) => void) => void;
    }
  ).descendants((node) => types.push(node.type.name));
  return types;
}

describe("getMediaFiles (§297)", () => {
  it("includes videos by extension via classifyMediaSrc, not by MIME prefix", () => {
    const files = getMediaFiles({
      files: [
        makeFile("photo.png", "image/png"),
        makeFile("clip.mp4", "video/mp4"),
        // §293 deliberately excludes .mkv — no webview can play it, even
        // though its MIME is video/x-matroska. A MIME-based filter would
        // wrongly accept it.
        makeFile("archive.mkv", "video/x-matroska"),
      ],
    } as unknown as DataTransfer);

    expect(files.map((f) => f.name)).toEqual(["photo.png", "clip.mp4"]);
  });

  it("keeps the existing image/ MIME branch (pasted clipboard images may have no useful filename)", () => {
    const files = getMediaFiles({
      files: [makeFile("image.png", "image/png")],
    } as unknown as DataTransfer);

    expect(files).toHaveLength(1);
  });
});

describe("insertMediaAtPos (§297)", () => {
  it("creates a video node for a video src", () => {
    const view = makeView(["image", "video"]);
    insertMediaAtPos(view, "assets/clip.mp4", "clip", undefined);

    expect(view.dispatch).toHaveBeenCalledTimes(1);
    expect(nodeTypesIn(view)).toContain("video");
  });

  it("creates an image node for an image src", () => {
    const view = makeView(["image", "video"]);
    insertMediaAtPos(view, "photo.png", "photo", undefined);

    expect(nodeTypesIn(view)).toContain("image");
  });

  it("does nothing when the schema has no video node, rather than throwing", () => {
    const view = makeView(["image"]);
    expect(() =>
      insertMediaAtPos(view, "clip.mp4", "clip", undefined),
    ).not.toThrow();
    expect(view.dispatch).not.toHaveBeenCalled();
  });
});

describe("insertVideoFromBytes (§297)", () => {
  beforeEach(() => {
    showToast.mockClear();
    saveMediaToDocAssets.mockClear();
  });

  it("toasts the noDocumentPath message and inserts nothing when there is no document path (unsaved doc)", async () => {
    const view = makeView(["video"]);

    await insertVideoFromBytes(
      view,
      new Uint8Array([0]),
      "clip.mp4",
      undefined,
      undefined,
    );

    expect(saveMediaToDocAssets).not.toHaveBeenCalled();
    expect(view.dispatch).not.toHaveBeenCalled();
    expect(showToast).toHaveBeenCalledTimes(1);
    // Pinned against the SAME t(key, locale, params) call the source makes —
    // this fails if the wrong i18n key is chosen for this branch (e.g. the
    // two toastVideoError call sites get swapped), but keeps passing if the
    // copy is ever reworded.
    const { locale } = useSettingsStore.getState();
    expect(showToast).toHaveBeenCalledWith(
      t("video.noDocumentPath", locale as Locale, { name: "clip.mp4" }),
      "error",
    );
  });

  it("toasts the saveFailed message and inserts nothing when the copy fails", async () => {
    saveMediaToDocAssets.mockRejectedValueOnce(new Error("disk full"));
    const view = makeView(["video"]);

    await insertVideoFromBytes(
      view,
      new Uint8Array([0]),
      "clip.mp4",
      "/vault/a.md",
      undefined,
    );

    expect(view.dispatch).not.toHaveBeenCalled();
    expect(showToast).toHaveBeenCalledTimes(1);
    const { locale } = useSettingsStore.getState();
    expect(showToast).toHaveBeenCalledWith(
      t("video.saveFailed", locale as Locale, { name: "clip.mp4" }),
      "error",
    );
  });

  it("inserts a video node when the copy succeeds, without toasting", async () => {
    const view = makeView(["video"]);

    await insertVideoFromBytes(
      view,
      new Uint8Array([0]),
      "clip.mp4",
      "/vault/a.md",
      undefined,
    );

    expect(saveMediaToDocAssets).toHaveBeenCalledWith(
      expect.any(Uint8Array),
      "clip.mp4",
      "/vault/a.md",
    );
    expect(view.dispatch).toHaveBeenCalledTimes(1);
    expect(nodeTypesIn(view)).toContain("video");
    expect(showToast).not.toHaveBeenCalled();
  });
});

// §297 fix (I6): the journal-context drop/paste branch used to be
// `savePhotoToAssets(...).then(...)` with no `.catch()` — a write failure was
// an unhandled rejection, nothing inserted and nothing said, contradicting
// §297's core requirement. Fixed for both photos and videos, since the
// contract isn't media-kind specific (see insertJournalMediaFromBytes).
describe("insertJournalMediaFromBytes (§297 I6)", () => {
  const ctx = {
    rootPath: "/vault",
    journalDir: "daily",
    filePath: "/vault/daily/2026-08-22.md",
  };

  beforeEach(() => {
    showToast.mockClear();
    savePhotoToAssets.mockClear();
  });

  it("inserts a media node when the save succeeds, without toasting", async () => {
    const view = makeView(["image", "video"]);

    await insertJournalMediaFromBytes(
      view,
      new Uint8Array([0]),
      "clip.mp4",
      ctx,
      undefined,
    );

    expect(savePhotoToAssets).toHaveBeenCalledWith(
      expect.any(Uint8Array),
      "clip.mp4",
      ctx.rootPath,
      ctx.journalDir,
      ctx.filePath,
    );
    expect(view.dispatch).toHaveBeenCalledTimes(1);
    expect(nodeTypesIn(view)).toContain("video");
    expect(showToast).not.toHaveBeenCalled();
  });

  it("toasts and inserts nothing when the save fails, instead of an unhandled rejection", async () => {
    savePhotoToAssets.mockRejectedValueOnce(new Error("disk full"));
    const view = makeView(["image", "video"]);

    await insertJournalMediaFromBytes(
      view,
      new Uint8Array([0]),
      "clip.mp4",
      ctx,
      undefined,
    );

    expect(view.dispatch).not.toHaveBeenCalled();
    expect(showToast).toHaveBeenCalledTimes(1);
    const { locale } = useSettingsStore.getState();
    expect(showToast).toHaveBeenCalledWith(
      t("journal.mediaSaveFailed", locale as Locale, { name: "clip.mp4" }),
      "error",
    );
  });

  it("applies the same failure handling to a photo, not just a video", async () => {
    // The defect predates video: photos went through this same unguarded
    // .then() before this branch ever routed videos. Pin that the fix covers
    // both media kinds, not just the one that surfaced it.
    savePhotoToAssets.mockRejectedValueOnce(new Error("disk full"));
    const view = makeView(["image", "video"]);

    await insertJournalMediaFromBytes(
      view,
      new Uint8Array([0]),
      "photo.png",
      ctx,
      undefined,
    );

    expect(view.dispatch).not.toHaveBeenCalled();
    expect(showToast).toHaveBeenCalledTimes(1);
  });
});

// §297 fix (I-2): `getJournalContext()` used to zero `filePath` whenever
// `journalDirectory` was empty — its default on a fresh install, set only by
// hand in Settings — so pasting a video into ANY saved document on a default
// install was refused as "unsaved", even though the document plainly had a
// path. The tests above never caught this: they call the extracted leaf
// functions directly with a hand-built `ctx` that already has `filePath`
// filled in, so `getJournalContext` itself is never exercised. This one goes
// through the REAL plugin — a full `Editor` with `createBaramExtensions()`
// (which includes `DropHandler`) and real Zustand store state, invoking the
// registered `handlePaste` prop the way ProseMirror itself would.
describe("handlePaste through the real plugin, journalDirectory unset (§297 I-2)", () => {
  const DOC_PATH = "/vault/notes/today.md";

  function createTestEditor(): Editor {
    return new Editor({ extensions: createBaramExtensions(), content: "" });
  }

  function makePasteEvent(file: File): ClipboardEvent {
    return {
      clipboardData: {
        files: [file],
        getData: () => "",
      },
      preventDefault: vi.fn(),
    } as unknown as ClipboardEvent;
  }

  beforeEach(() => {
    showToast.mockClear();
    saveMediaToDocAssets.mockClear();
    useEditorStore.setState({
      activeTabId: "t1",
      tabs: [{ id: "t1", filePath: DOC_PATH }],
    } as never);
    useFileStore.setState({ rootPath: "/vault" } as never);
    // The default a fresh install ships with (src/stores/settings/journal-settings.ts) —
    // never configured, not "" because the user cleared it.
    useSettingsStore.setState({ journalDirectory: "" } as never);
  });

  it("saves the pasted video next to the document instead of refusing it as unsaved", async () => {
    const editor = createTestEditor();
    const event = makePasteEvent(
      new File(["x"], "clip.mp4", { type: "video/mp4" }),
    );

    const handled = editor.view.someProp("handlePaste", (f) =>
      f(editor.view, event, Slice.empty),
    );
    expect(handled).toBe(true);

    // readFileAsBytes goes through a real jsdom FileReader — poll rather than
    // a single setTimeout(0), since jsdom's FileReader can take more than one
    // macrotask to fire onload.
    await vi.waitFor(() => {
      expect(saveMediaToDocAssets).toHaveBeenCalled();
    });

    expect(saveMediaToDocAssets).toHaveBeenCalledWith(
      expect.any(Uint8Array),
      "clip.mp4",
      DOC_PATH,
    );
    expect(showToast).not.toHaveBeenCalled();
    editor.destroy();
  });
});

// §324-e added a `resolveDestinationPath` option so a host without a tab of
// its own (Quick Capture) can hand DropHandler its real destination instead
// of the active-tab lookup below silently attributing media to whatever
// unrelated document happens to be open. The document editor never passes
// that option (`createBaramExtensions()` with no args), so this pins that
// the untouched, default path — active tab decides, exactly as before the
// option existed — still works.
describe("§324-e default resolution is unchanged when no resolver is configured", () => {
  const DOC_PATH = "/vault/daily/2026-08-22.md";

  function createTestEditor(): Editor {
    return new Editor({ extensions: createBaramExtensions(), content: "" });
  }

  function makePasteEvent(file: File): ClipboardEvent {
    return {
      clipboardData: { files: [file], getData: () => "" },
      preventDefault: vi.fn(),
    } as unknown as ClipboardEvent;
  }

  beforeEach(() => {
    showToast.mockClear();
    savePhotoToAssets.mockClear();
    useEditorStore.setState({
      activeTabId: "t1",
      tabs: [{ id: "t1", filePath: DOC_PATH }],
    } as never);
    useFileStore.setState({ rootPath: "/vault" } as never);
    useSettingsStore.setState({ journalDirectory: "/vault/daily" } as never);
  });

  it("saves a journal image next to the active tab — the default document editor supplies no override", async () => {
    const editor = createTestEditor();
    const event = makePasteEvent(
      new File(["x"], "shot.png", { type: "image/png" }),
    );

    const handled = editor.view.someProp("handlePaste", (f) =>
      f(editor.view, event, Slice.empty),
    );
    expect(handled).toBe(true);

    await vi.waitFor(() => {
      expect(savePhotoToAssets).toHaveBeenCalled();
    });

    expect(savePhotoToAssets).toHaveBeenCalledWith(
      expect.any(Uint8Array),
      "shot.png",
      "/vault",
      "/vault/daily",
      DOC_PATH,
    );
    editor.destroy();
  });
});
