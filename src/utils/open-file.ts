// §89 Open a file by absolute path — shared by the file-op hook, the "+" menu,
// and recent-item reopening. Throws on failure so callers can self-heal.
import { readFile } from "../ipc/fs";
import { notifyFileOpen } from "../plugins/plugin-lifecycle";
import { useContextStore } from "../stores/context/context";
import { useEditorStore } from "../stores/editor/editor";
import { useFileStore } from "../stores/file/file";
import { useSettingsStore } from "../stores/settings/store";
import { basename } from "./path-utils";

export async function openFileByPath(filePath: string): Promise<void> {
  const { tabs } = useEditorStore.getState();
  const existing = tabs.find((t) => t.filePath === filePath);
  if (existing) {
    useEditorStore.getState().setActiveTab(existing.id);
    return;
  }

  // §89 Ensure a context exists (vault/folder for internal, FileContext for
  // external) BEFORE readFile so the Rust check_vault guard passes.
  const context = await useContextStore.getState().ensureFileContext(filePath);
  const content = await readFile(filePath);
  const fileName = basename(filePath);

  useFileStore.getState().setFileContent(filePath, content);
  useEditorStore.getState().openTab({
    contextId: context.id,
    id: crypto.randomUUID(),
    filePath,
    title: fileName,
    isDirty: false,
    isPinned: false,
  });
  notifyFileOpen(filePath);
  useSettingsStore.getState().addRecentFile(filePath);
  useSettingsStore.getState().setLastOpenedFile(filePath);
}
