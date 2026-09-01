import { open } from "@tauri-apps/plugin-dialog";

import type { SlashMenuItem } from "../../components/command/SlashMenu";
import type { Editor } from "@tiptap/core";

import { createDir, importFile } from "../../ipc/invoke";
import { useEditorStore } from "../../stores/editor/editor";
import { useFileStore } from "../../stores/file/file";
import { useSettingsStore } from "../../stores/settings/store";
import { useUIStore } from "../../stores/ui/ui";
import { registerEditorMutationTask } from "../../utils/editor/mutation-tasks";
import {
  generatePhotoFilename,
  getAssetsDir,
} from "../../utils/journal/journal-photo";
import { chainWithVimExternalEdit } from "./vim/vim-keys";

export function buildJournalItems(editor: Editor): SlashMenuItem[] {
  // §99 Quick Capture — fleeting note into the Zettelkasten inbox
  return [
    {
      id: "quick-capture",
      label: "Quick Capture",
      category: "Journal",
      description: "Capture a fleeting note to the Zettel inbox",
      mdHint: "/capture",
      action: () => useUIStore.getState().openQuickCapture(),
    },
    {
      id: "photo",
      label: "Insert Photo",
      category: "Journal",
      description: "Insert photo from file picker",
      mdHint: "📷",
      action: async () => {
        // §12-9c (design §5c): bind BEFORE the dialog. Reading the store
        // afterwards would re-bind the photo to whichever tab is active when
        // the picker closes — and with no task registered during the dialog,
        // a state install in that window has nothing to invalidate, so the
        // insert would land in the wrong document (and resolve the journal
        // assets dir from the wrong file).
        const task = registerEditorMutationTask(editor.view);
        const activeTabId = useEditorStore.getState().activeTabId;
        const tabs = useEditorStore.getState().tabs;
        const activeTab = tabs.find(
          (t: { id: string }) => t.id === activeTabId,
        );
        const filePath = activeTab?.filePath ?? "";
        const rootPath = useFileStore.getState().rootPath ?? "";
        const journalDir = useSettingsStore.getState().journalDirectory ?? "";
        const journalAbsPath =
          rootPath && journalDir ? `${rootPath}/${journalDir}` : "";
        const isJournal = journalAbsPath && filePath.startsWith(journalAbsPath);

        try {
          const selected = await open({
            multiple: true,
            filters: [
              {
                name: "Images",
                extensions: ["jpg", "jpeg", "png", "gif", "webp", "bmp", "svg"],
              },
            ],
          });
          if (!selected || !task.isLive()) return;

          const paths = Array.isArray(selected) ? selected : [selected];

          {
            for (const p of paths) {
              if (!task.isLive()) return;
              if (isJournal && rootPath && journalDir) {
                // Copy file to assets directory using helpers + copyFile IPC
                const now = new Date();
                const fileName = p.split("/").pop() ?? "photo.jpg";
                const assetsRelDir = getAssetsDir(journalDir, now);
                const absoluteAssetsDir = `${rootPath}/${assetsRelDir}`;

                try {
                  await createDir(absoluteAssetsDir);
                } catch {
                  /* already exists */
                }
                // createDir is an async gap of its own: without this check a
                // task that died here would still copy the photo into the
                // PREVIOUS document's journal assets dir, leaving a file
                // nothing references.
                if (!task.isLive()) return;

                const destName = generatePhotoFilename(fileName, now);
                const absoluteDest = `${absoluteAssetsDir}/${destName}`;
                const relativePath = `${assetsRelDir}/${destName}`;

                await importFile(p, absoluteDest);
                if (!task.isLive()) return;

                chainWithVimExternalEdit(editor)
                  .focus()
                  .insertContent({
                    type: "image",
                    attrs: {
                      src: relativePath,
                      alt: fileName.replace(/\.[^.]+$/, ""),
                      title: "",
                    },
                  })
                  .run();
              } else {
                // Non-journal: insert with absolute path
                chainWithVimExternalEdit(editor)
                  .focus()
                  .insertContent({
                    type: "image",
                    attrs: { src: p, alt: p.split("/").pop() ?? "", title: "" },
                  })
                  .run();
              }
            }
          }
        } catch {
          // Dialog cancelled or error
        } finally {
          // Covers the cancelled-dialog and thrown-dialog paths too — the
          // task is registered before open(), so every exit must close it.
          task.finish();
        }
      },
    },
  ];
}
