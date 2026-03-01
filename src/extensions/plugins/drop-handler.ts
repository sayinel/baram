// §3.3 DropHandler — drag-and-drop & paste image insertion
// Handles image files dropped or pasted into the editor,
// converting them to data URLs and inserting as image blocks.
import { Extension } from "@tiptap/core";
import { Plugin } from "@tiptap/pm/state";
import { isExternalFileDrag } from "../../hooks/use-external-drop";
import { useEditorStore } from "../../stores/editor-store";
import { useFileStore } from "../../stores/file-store";
import { useSettingsStore } from "../../stores/settings-store";
import { savePhotoToAssets } from "../../utils/journal-photo";

/**
 * Detect tab-separated data in clipboard text.
 * Returns a 2D string array if valid TSV (min 2 rows × 2 cols), or null.
 */
function detectTabSeparatedData(text: string): string[][] | null {
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
 * Insert a table from parsed TSV data.
 * First row → tableHeader cells, remaining rows → tableCell cells.
 */
function insertTableFromTSV(
  view: import("@tiptap/pm/view").EditorView,
  data: string[][],
): boolean {
  const { schema } = view.state;
  const tableType = schema.nodes.table;
  const tableRowType = schema.nodes.tableRow;
  const tableHeaderType = schema.nodes.tableHeader;
  const tableCellType = schema.nodes.tableCell;

  if (!tableType || !tableRowType || !tableHeaderType || !tableCellType) return false;

  const rows = data.map((rowData, rowIndex) => {
    const cellType = rowIndex === 0 ? tableHeaderType : tableCellType;
    const cells = rowData.map((cellText) =>
      cellType.create(
        null,
        schema.nodes.paragraph.create(null, cellText ? schema.text(cellText) : null),
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

/** Read a File as a data URL */
function readFileAsDataURL(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

/** Check if the active file is inside a journal directory */
function getJournalContext(): { isJournal: boolean; rootPath: string; journalDir: string } {
  const activeTabId = useEditorStore.getState().activeTabId;
  const tabs = useEditorStore.getState().tabs;
  const activeTab = tabs.find((t) => t.id === activeTabId);
  const filePath = activeTab?.filePath ?? "";
  const rootPath = useFileStore.getState().rootPath ?? "";
  const journalDir = useSettingsStore.getState().journalDirectory ?? "";

  if (!rootPath || !journalDir || !filePath) return { isJournal: false, rootPath: "", journalDir: "" };

  const journalAbsPath = `${rootPath}/${journalDir}`;
  const isJournal = filePath.startsWith(journalAbsPath);
  return { isJournal, rootPath, journalDir };
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

/** Insert an image node into the editor at the given position or selection */
function insertImageAtPos(
  view: import("@tiptap/pm/view").EditorView,
  src: string,
  alt: string,
  pos?: number,
) {
  const { tr } = view.state;
  const imageNode = view.state.schema.nodes.image.create({
    src,
    alt,
    title: null,
  });
  if (pos !== undefined) {
    tr.insert(pos, imageNode);
  } else {
    tr.replaceSelectionWith(imageNode);
  }
  view.dispatch(tr);
}

/** Extract image files from a DataTransfer */
function getImageFiles(dataTransfer: DataTransfer): File[] {
  const files: File[] = [];
  for (let i = 0; i < dataTransfer.files.length; i++) {
    const file = dataTransfer.files[i];
    if (file.type.startsWith("image/")) {
      files.push(file);
    }
  }
  return files;
}

/** Create the drop handler ProseMirror plugin */
function createDropHandlerPlugin(): Plugin {
  return new Plugin({
    props: {
      handleDrop(view, event) {
        // Skip when Tauri is handling an external OS file drag
        if (isExternalFileDrag) return false;

        if (!event.dataTransfer) return false;
        const files = getImageFiles(event.dataTransfer);
        if (files.length === 0) return false;

        event.preventDefault();

        const coords = { left: event.clientX, top: event.clientY };
        const pos = view.posAtCoords(coords);
        if (!pos) return false;
        const insertPos = pos.pos;

        const ctx = getJournalContext();

        for (const file of files) {
          if (ctx.isJournal) {
            readFileAsBytes(file).then((bytes) => {
              savePhotoToAssets(bytes, file.name, ctx.rootPath, ctx.journalDir).then((relativePath) => {
                insertImageAtPos(view, relativePath, file.name, insertPos);
              });
            });
          } else {
            readFileAsDataURL(file).then((dataUrl) => {
              insertImageAtPos(view, dataUrl, file.name, insertPos);
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

        const files = getImageFiles(event.clipboardData);
        if (files.length === 0) return false;

        event.preventDefault();

        const ctx = getJournalContext();

        for (const file of files) {
          if (ctx.isJournal) {
            readFileAsBytes(file).then((bytes) => {
              savePhotoToAssets(bytes, file.name, ctx.rootPath, ctx.journalDir).then((relativePath) => {
                insertImageAtPos(view, relativePath, file.name);
              });
            });
          } else {
            readFileAsDataURL(file).then((dataUrl) => {
              insertImageAtPos(view, dataUrl, file.name);
            });
          }
        }

        return true;
      },
    },
  });
}

/** Tiptap Extension wrapper */
export const DropHandler = Extension.create({
  name: "dropHandler",

  addProseMirrorPlugins() {
    return [createDropHandlerPlugin()];
  },
});
