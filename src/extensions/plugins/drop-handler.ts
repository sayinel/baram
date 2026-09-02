// §3.3 / §297 DropHandler — drag-and-drop & paste image/video insertion
// Handles image and video files dropped or pasted into the editor.
// Images (outside a journal) become data URLs; videos never do — they are
// always copied to disk (§297, see `saveMediaToDocAssets`).
import type { Locale } from "../../i18n";
import type { EditorView } from "@tiptap/pm/view";

import { Extension } from "@tiptap/core";
import { Plugin } from "@tiptap/pm/state";

import { isExternalFileDrag } from "../../hooks/use-external-drop";
import { t } from "../../i18n";
import { useEditorStore } from "../../stores/editor/editor";
import { useFileStore } from "../../stores/file/file";
import { useSettingsStore } from "../../stores/settings/store";
import { useUIStore } from "../../stores/ui/ui";
import { registerEditorMutationTask } from "../../utils/editor/mutation-tasks";
import { savePhotoToAssets } from "../../utils/journal/journal-photo";
import { saveMediaToDocAssets } from "../../utils/media-assets";
import { MAX_INLINE_MEDIA_BYTES } from "../../utils/media-data-url";
import { classifyMediaSrc } from "../../utils/media-src";

/**
 * Extract image and video files from a DataTransfer (§297).
 *
 * Two different tests, because the two file kinds arrive differently:
 *  - Images: MIME-typed (`image/*`). Pasted clipboard images often carry a
 *    meaningless generated filename, so the MIME check stays the only one.
 *  - Videos: classified by `classifyMediaSrc` — the SAME extension list
 *    `pipeline`/NodeView use (§293) — never by MIME. A `.mkv`'s MIME is
 *    `video/x-matroska`, but no webview can play it, so a MIME-based test
 *    would silently accept a file this app can never render.
 */
export function getMediaFiles(dataTransfer: DataTransfer): File[] {
  const files: File[] = [];
  for (let i = 0; i < dataTransfer.files.length; i++) {
    const file = dataTransfer.files[i];
    if (
      file.type.startsWith("image/") ||
      classifyMediaSrc(file.name) !== "image"
    ) {
      files.push(file);
    }
  }
  return files;
}

/**
 * §297 fix (I6) 저널 컨텍스트로 드랍·붙여넣기된 이미지/동영상을 저장하고 삽입한다.
 * 사진이든 동영상이든 §56d의 `savePhotoToAssets` 하나로 저장한다 — 저널 안에서는
 * 미디어 종류가 저장 경로를 가르지 않는다.
 *
 * 실패하면 삽입하지 않고 토스트로 알린다 — 이 함수가 추출되기 전에는
 * `savePhotoToAssets(...).then(...)`에 `.catch()`가 없어 조용한 unhandled
 * rejection이었다(§297의 핵심 요구사항 위반). 사진에도 이미 있던 결함이고
 * 동영상이 새로 이 분기를 타면서 드러났다 — `insertVideoFromBytes`의 비저널
 * 실패 처리와 같은 계약이므로 사진·동영상 구분 없이 고친다.
 */
export async function insertJournalMediaFromBytes(
  view: EditorView,
  bytes: Uint8Array,
  name: string,
  ctx: { filePath: string; journalDir: string; rootPath: string },
  pos?: number,
): Promise<void> {
  try {
    const relativePath = await savePhotoToAssets(
      bytes,
      name,
      ctx.rootPath,
      ctx.journalDir,
      ctx.filePath,
    );
    insertMediaAtPos(view, relativePath, name, pos);
  } catch {
    toastMediaError("journal.mediaSaveFailed", name);
  }
}

/**
 * §324-e 저장 전까지 디스크에 쓰지 않는 표면(캡처 창)의 삽입 경로.
 *
 * ‼️ `alt`에 `file.name`을 그대로 싣는 것이 계약이다. data URL은 이름을 담지
 * 못하므로 alt가 원본 파일명이 살아남는 유일한 자리이고, 저장 시점의 추출이
 * 그 이름으로 파일을 쓴다(`utils/media-data-url.ts`의 `preferredMediaName`).
 *
 * ‼️ 상한을 여기서 다시 검사하는 이유: 붙여넣기는 Rust를 거치지 않는다. 클립보드의
 * `File`은 이미 웹뷰 안에 있어 `FileReader`가 바로 읽으므로, 드랍 경로에서 상한을
 * 지키는 `read_media_data_url`의 거절이 이 경로에는 적용되지 않는다. 두 경로가 같은
 * 상한을 써야 같은 파일이 붙여넣기로는 들어가고 드랍으로는 거절되는 일이 없다.
 *
 * 거절은 **반드시 보인다** — 조용히 넘기면 사용자에게는 "붙여넣기가 안 되는 앱"이
 * 되고, 그것이 이 작업이 계속 고쳐 온 실패 방식이다.
 */
async function insertDeferredMedia(
  view: EditorView,
  file: File,
  task: ReturnType<typeof registerEditorMutationTask>,
  pos?: number,
): Promise<void> {
  if (file.size > MAX_INLINE_MEDIA_BYTES) {
    const { locale } = useSettingsStore.getState();
    useUIStore.getState().showToast(
      t("journal.capture.mediaTooLarge", locale as Locale, {
        limit: String(Math.floor(MAX_INLINE_MEDIA_BYTES / (1024 * 1024))),
        name: file.name,
        size: String(Math.ceil(file.size / (1024 * 1024))),
      }),
      "error",
    );
    return;
  }
  let dataUrl: string;
  try {
    dataUrl = await readFileAsDataURL(file);
  } catch {
    toastMediaError("journal.capture.mediaReadFailed", file.name);
    return;
  }
  if (!task.isLive()) return;
  insertMediaAtPos(view, dataUrl, file.name, pos);
}

/** Insert an image or video node into the editor at the given position or selection */
export function insertMediaAtPos(
  view: EditorView,
  src: string,
  alt: string,
  pos?: number,
): void {
  const typeName = classifyMediaSrc(src) === "image" ? "image" : "video";
  const nodeType = view.state.schema.nodes[typeName];
  // 스키마에 해당 노드가 없으면(예: 축소된 테스트 스키마) 아무것도 하지 않는다 —
  // throw하지 않는다. 다른 타입으로 잘못 끼워 넣는 것(예: video src를 image 노드에)은
  // 더 나쁘다.
  if (!nodeType) return;

  const { tr } = view.state;
  const mediaNode = nodeType.create({ src, alt, title: null });
  if (pos !== undefined) {
    tr.insert(pos, mediaNode);
  } else {
    tr.replaceSelectionWith(mediaNode);
  }
  view.dispatch(tr);
}

/**
 * §297 저장된 동영상 바이트를 문서 assets/에 복사하고 삽입한다.
 *
 * 실패 경로 둘 다 토스트로 알리고 삽입하지 않는다 — 조용한 실패가 아니다:
 *  - `filePath`가 없다 = 저장 안 된 문서라 `assets/`를 걸어 둘 자리가 없다.
 *  - 복사 자체가 실패한다 = 디스크/권한 문제.
 * 두 경우 모두 data URL이나 절대경로로 조용히 떨어지지 않는다 (§297 핵심 요구사항).
 */
export async function insertVideoFromBytes(
  view: EditorView,
  bytes: Uint8Array,
  name: string,
  filePath: string | undefined,
  pos?: number,
): Promise<void> {
  if (!filePath) {
    toastMediaError("video.noDocumentPath", name);
    return;
  }
  try {
    const relativePath = await saveMediaToDocAssets(bytes, name, filePath);
    insertMediaAtPos(view, relativePath, name, pos);
  } catch {
    toastMediaError("video.saveFailed", name);
  }
}

/** Create the drop handler ProseMirror plugin */
function createDropHandlerPlugin(options: DropHandlerOptions): Plugin {
  return new Plugin({
    props: {
      handleDrop(view, event) {
        // Skip when Tauri is handling an external OS file drag
        if (isExternalFileDrag) return false;

        if (!event.dataTransfer) return false;
        const files = getMediaFiles(event.dataTransfer);
        if (files.length === 0) return false;

        event.preventDefault();

        const coords = { left: event.clientX, top: event.clientY };
        const pos = view.posAtCoords(coords);
        if (!pos) return false;
        const insertPos = pos.pos;

        // §324-e 저장을 호스트에 미루는 표면(캡처 창)은 목적지를 물을 이유가
        // 없다 — 지금 디스크에 쓰지 않으므로 `getJournalContext`를 부르지도
        // 않는다. `null`이 곧 "이 표면은 아직 파일이 아니다"이고, 아래 루프의
        // 첫 분기가 그 경우다.
        const ctx = options.deferMediaToHost ? null : getJournalContext();

        // §298 §12-9b (design §5c): file reads land after an async gap —
        // once the task dies (state install / vim mode exit), the reads
        // complete but must not dispatch into the editor. The liveness check
        // sits before every dispatching call in the sequential loop below.
        const task = registerEditorMutationTask(view);
        // §297 fix (I-3 concurrency, final-gate Important #1): each file
        // used to fire its own independent readFileAsBytes(...).then(...)
        // chain with no await between loop iterations, so N files in one
        // drop all reached copyBytesToDir's listDir before any of them
        // reached writeBinaryFile — both saw the directory without the
        // other's file, both resolved the same unsuffixed name, and the
        // later write clobbered the earlier one. use-external-drop.ts's
        // handleEditorDrop never had this bug because its own for loop
        // awaits importFile before starting the next file. Sequentializing
        // this loop the same way — one file's full read+save+insert
        // completes before the next file starts — gives it the same
        // guarantee without touching copyBytesToDir itself, which stays a
        // plain single-call function.
        void (async () => {
          for (const file of files) {
            if (!task.isLive()) break;
            if (!ctx) {
              // §324-e 캡처: 사진이든 동영상이든 data URL로 들어간다. 실제 파일
              // 쓰기는 저장이 한다(`utils/media-data-url.ts`).
              await insertDeferredMedia(view, file, task, insertPos);
            } else if (ctx.isJournal) {
              const bytes = await readFileAsBytes(file);
              if (!task.isLive()) break;
              await insertJournalMediaFromBytes(
                view,
                bytes,
                file.name,
                ctx,
                insertPos,
              );
            } else if (classifyMediaSrc(file.name) !== "image") {
              // §297 동영상은 반드시 파일로 — data URL 경로가 존재하지 않는다.
              const bytes = await readFileAsBytes(file);
              if (!task.isLive()) break;
              await insertVideoFromBytes(
                view,
                bytes,
                file.name,
                ctx.filePath || undefined,
                insertPos,
              );
            } else {
              const dataUrl = await readFileAsDataURL(file);
              if (!task.isLive()) break;
              insertMediaAtPos(view, dataUrl, file.name, insertPos);
            }
          }
          task.finish();
        })();

        return true;
      },

      handlePaste(view, event) {
        if (!event.clipboardData) return false;

        // §5.5 TSV auto-conversion — skip if cursor is inside a table
        const { $from } = view.state.selection;
        let insideTable = false;
        for (let d = $from.depth; d >= 0; d--) {
          if ($from.node(d).type.name === "table") {
            insideTable = true;
            break;
          }
        }
        if (!insideTable) {
          const plainText = event.clipboardData.getData("text/plain");
          if (plainText) {
            const tsvData = detectTabSeparatedData(plainText);
            if (tsvData) {
              event.preventDefault();
              insertTableFromTSV(view, tsvData);
              return true;
            }
          }
        }

        const files = getMediaFiles(event.clipboardData);
        if (files.length === 0) return false;

        event.preventDefault();

        // §324-e — same reasoning as handleDrop above.
        const ctx = options.deferMediaToHost ? null : getJournalContext();

        // §298 §12-9b — same contract as handleDrop above.
        const task = registerEditorMutationTask(view);
        // §297 fix (I-3 concurrency, final-gate Important #1): see the
        // matching comment in handleDrop above — same fire-and-forget loop,
        // same fix.
        void (async () => {
          for (const file of files) {
            if (!task.isLive()) break;
            if (!ctx) {
              // §324-e 캡처 — handleDrop의 같은 분기와 같은 계약.
              await insertDeferredMedia(view, file, task);
            } else if (ctx.isJournal) {
              const bytes = await readFileAsBytes(file);
              if (!task.isLive()) break;
              await insertJournalMediaFromBytes(view, bytes, file.name, ctx);
            } else if (classifyMediaSrc(file.name) !== "image") {
              const bytes = await readFileAsBytes(file);
              if (!task.isLive()) break;
              await insertVideoFromBytes(
                view,
                bytes,
                file.name,
                ctx.filePath || undefined,
              );
            } else {
              const dataUrl = await readFileAsDataURL(file);
              if (!task.isLive()) break;
              insertMediaAtPos(view, dataUrl, file.name);
            }
          }
          task.finish();
        })();

        return true;
      },
    },
  });
}

/**
 * Detect tab-separated data in clipboard text.
 * Returns a 2D string array if valid TSV (min 2 rows × 2 cols), or null.
 */
function detectTabSeparatedData(text: string): null | string[][] {
  if (!text.includes("\t") || !text.includes("\n")) return null;

  const lines = text.split("\n").filter((line) => line.length > 0);
  if (lines.length < 2) return null;

  const rows = lines.map((line) => line.split("\t"));

  // Determine expected column count from majority of rows
  const colCount = rows[0].length;
  if (colCount < 2) return null;

  for (let i = 0; i < rows.length; i++) {
    const diff = Math.abs(rows[i].length - colCount);
    if (diff > 1) return null;
    // Pad short rows with empty strings
    while (rows[i].length < colCount) {
      rows[i].push("");
    }
    // Trim extra columns
    if (rows[i].length > colCount) {
      rows[i] = rows[i].slice(0, colCount);
    }
  }

  return rows;
}

/**
 * Check if the active file is inside a journal directory.
 *
 * §297 fix (I-2): the early return used to zero `filePath` along with
 * `rootPath`/`journalDir` whenever ANY of the three was missing — but
 * `journalDirectory` defaults to `""` (only ever set by hand in Settings),
 * so on a fresh install this fired for every non-journal document. The
 * non-journal video branch (`ctx.filePath || undefined` in
 * `handleDrop`/`handlePaste`) then saw an empty path and refused to save
 * the video at all, blaming "the document isn't saved" when it was. Only
 * `isJournal` should be forced false here — `filePath` is already known
 * and correct, and `rootPath`/`journalDir` being empty/missing is exactly
 * why `isJournal` is false, not a reason to also hide the file path from
 * callers that don't care about journal status.
 *
 * ‼️ §324-e: this function answers "where does the ACTIVE TAB's media go", and
 * only a surface that IS one of those tabs may ask it. `activeTabId`/`tabs` is
 * the MAIN document editor's global state; a second, independent editor
 * instance (the Quick Capture dialog) is never one of those tabs, so asking on
 * its behalf attributes media to whatever unrelated document happens to be
 * open in the main window. That is why the callers above skip this function
 * entirely when `deferMediaToHost` is set — see that option's doc comment.
 */
function getJournalContext(): {
  filePath: string;
  isJournal: boolean;
  journalDir: string;
  rootPath: string;
} {
  const rootPath = useFileStore.getState().rootPath ?? "";
  const journalDir = useSettingsStore.getState().journalDirectory ?? "";

  const activeTabId = useEditorStore.getState().activeTabId;
  const tabs = useEditorStore.getState().tabs;
  const activeTab = tabs.find((tab) => tab.id === activeTabId);
  const filePath = activeTab?.filePath ?? "";

  if (!rootPath || !journalDir || !filePath)
    return { isJournal: false, rootPath, journalDir, filePath };

  // journalDir is always absolute after migration
  const journalAbsPath =
    journalDir.startsWith("/") || /^[A-Z]:\\/i.test(journalDir)
      ? journalDir
      : `${rootPath}/${journalDir}`;
  const isJournal = filePath.startsWith(journalAbsPath);
  return { isJournal, rootPath, journalDir, filePath };
}

/**
 * Insert a table from parsed TSV data.
 * First row → tableHeader cells, remaining rows → tableCell cells.
 */
function insertTableFromTSV(view: EditorView, data: string[][]): boolean {
  const { schema } = view.state;
  const tableType = schema.nodes.table;
  const tableRowType = schema.nodes.tableRow;
  const tableHeaderType = schema.nodes.tableHeader;
  const tableCellType = schema.nodes.tableCell;

  if (!tableType || !tableRowType || !tableHeaderType || !tableCellType)
    return false;

  const rows = data.map((rowData, rowIndex) => {
    const cellType = rowIndex === 0 ? tableHeaderType : tableCellType;
    const cells = rowData.map((cellText) =>
      cellType.create(
        null,
        schema.nodes.paragraph.create(
          null,
          cellText ? schema.text(cellText) : null,
        ),
      ),
    );
    return tableRowType.create(null, cells);
  });

  const tableNode = tableType.create(null, rows);
  const { tr } = view.state;
  tr.replaceSelectionWith(tableNode);
  view.dispatch(tr);
  return true;
}

/** Read a File as Uint8Array */
function readFileAsBytes(file: File): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(new Uint8Array(reader.result as ArrayBuffer));
    reader.onerror = () => reject(reader.error);
    reader.readAsArrayBuffer(file);
  });
}

/** Read a File as a data URL */
function readFileAsDataURL(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

/** §297 복사/저장 실패를 사용자에게 보이는 토스트로 알린다 — 조용한 실패 금지. */
function toastMediaError(key: string, name: string): void {
  const { locale } = useSettingsStore.getState();
  useUIStore.getState().showToast(t(key, locale as Locale, { name }), "error");
}

/** §324-e Which surface this handler is installed on — see the field. */
export interface DropHandlerOptions {
  /**
   * §324-e `false` (the default): this host is a document tab — it has a path
   * and an `assets/` folder to hang a relative reference on, so a dropped or
   * pasted file is copied to disk immediately. That is correct there and does
   * not change.
   *
   * `true`: **this host is not a file yet.** It has no path, no base
   * directory, and the user may never save it. Media therefore goes in as a
   * data URL and nothing touches the disk until the host's own save extracts
   * it (`utils/media-data-url.ts`). One rule explains all of it: what has not
   * been saved is not on disk.
   *
   * Set by the Quick Capture dialog. Three defects came from the earlier
   * design that wrote at insert time — cancelling the dialog still left the
   * image in `assets/`, the image often painted as bare alt text (a relative
   * reference has no base directory to resolve against on a surface that is
   * not a tab), and both were true of paste as well as drop.
   *
   * ‼️ The destination is NOT discarded, it moves: the host decides where
   * extraction writes, at save time, from the same resolver it always owned.
   * Recomputing that decision anywhere else is what previously made this path
   * blind to task mode.
   */
  deferMediaToHost: boolean;
}

/** Tiptap Extension wrapper */
export const DropHandler = Extension.create<DropHandlerOptions>({
  name: "dropHandler",

  addOptions() {
    return {
      deferMediaToHost: false,
    };
  },

  addProseMirrorPlugins() {
    return [createDropHandlerPlugin(this.options)];
  },
});
