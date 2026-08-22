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
import { savePhotoToAssets } from "../../utils/journal/journal-photo";
import { saveMediaToDocAssets } from "../../utils/media-assets";
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
function createDropHandlerPlugin(): Plugin {
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

        const ctx = getJournalContext();

        for (const file of files) {
          if (ctx.isJournal) {
            readFileAsBytes(file).then((bytes) =>
              insertJournalMediaFromBytes(
                view,
                bytes,
                file.name,
                ctx,
                insertPos,
              ),
            );
          } else if (classifyMediaSrc(file.name) !== "image") {
            // §297 동영상은 반드시 파일로 — data URL 경로가 존재하지 않는다.
            readFileAsBytes(file).then((bytes) =>
              insertVideoFromBytes(
                view,
                bytes,
                file.name,
                ctx.filePath || undefined,
                insertPos,
              ),
            );
          } else {
            readFileAsDataURL(file).then((dataUrl) => {
              insertMediaAtPos(view, dataUrl, file.name, insertPos);
            });
          }
        }

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

        const ctx = getJournalContext();

        for (const file of files) {
          if (ctx.isJournal) {
            readFileAsBytes(file).then((bytes) =>
              insertJournalMediaFromBytes(view, bytes, file.name, ctx),
            );
          } else if (classifyMediaSrc(file.name) !== "image") {
            readFileAsBytes(file).then((bytes) =>
              insertVideoFromBytes(
                view,
                bytes,
                file.name,
                ctx.filePath || undefined,
              ),
            );
          } else {
            readFileAsDataURL(file).then((dataUrl) => {
              insertMediaAtPos(view, dataUrl, file.name);
            });
          }
        }

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

/** Check if the active file is inside a journal directory */
function getJournalContext(): {
  filePath: string;
  isJournal: boolean;
  journalDir: string;
  rootPath: string;
} {
  const activeTabId = useEditorStore.getState().activeTabId;
  const tabs = useEditorStore.getState().tabs;
  const activeTab = tabs.find((tab) => tab.id === activeTabId);
  const filePath = activeTab?.filePath ?? "";
  const rootPath = useFileStore.getState().rootPath ?? "";
  const journalDir = useSettingsStore.getState().journalDirectory ?? "";

  if (!rootPath || !journalDir || !filePath)
    return { isJournal: false, rootPath: "", journalDir: "", filePath: "" };

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

/** Tiptap Extension wrapper */
export const DropHandler = Extension.create({
  name: "dropHandler",

  addProseMirrorPlugins() {
    return [createDropHandlerPlugin()];
  },
});
