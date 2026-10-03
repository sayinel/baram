import { getVaultConfig } from "../ipc/context";
// §85 Work Log — per-vault daily work log utility
import {
  createDir,
  isFileNotFoundError,
  listDir,
  readFile,
  writeFile,
} from "../ipc/fs";
import { useContextStore } from "../stores/context/context";
import { useEditorStore } from "../stores/editor/editor";
import { buildFileTree, useFileStore } from "../stores/file/file";
import { logger } from "./logger";

/**
 * Create today's Work Log file in the active vault.
 * Returns the file path if created/found, null if work log is not enabled.
 */
export async function createWorkLogForToday(): Promise<null | string> {
  const ctx = useContextStore.getState().activeContext();
  if (!ctx || ctx.contextType !== "vault") return null;

  // Check if work log is enabled for this vault
  const config = await getVaultConfig(ctx.id);
  if (!config?.workLog?.enabled) return null;

  const folder = config.workLog.folder ?? "daily";
  const format = config.workLog.fileNameFormat ?? "YYYY-MM-DD";

  const now = new Date();
  const fileName = formatDate(now, format);
  const filePath = `${ctx.path}/${folder}/${fileName}.md`;

  // Check if file already exists
  try {
    const content = await readFile(filePath);
    // File exists — open it
    openWorkLogTab(filePath, content, ctx.id);
    return filePath;
  } catch (err) {
    // Only "no such file" means create. A log that exists but could not be read
    // (invalid UTF-8, a permission the OS refused) used to fall through to the
    // template write below and be replaced by it. Raise it and leave the disk alone;
    // the rejection may name an OS error but not the file, so the log names the path.
    if (!isFileNotFoundError(err)) {
      logger.error(
        `[work-log] reading today's log failed other than "not found"; nothing was written: ${filePath}`,
        err,
      );
      throw err;
    }
  }

  // Ensure directory exists
  const dirPath = `${ctx.path}/${folder}`;
  await createDir(dirPath).catch(() => {}); // ignore if exists

  // Create from template or default
  let content: string;
  if (config.workLog.template) {
    const templatePath = `${ctx.path}/${config.workLog.template}`;
    try {
      const tmpl = await readFile(templatePath);
      content = applyWorkLogTemplate(tmpl, now);
    } catch {
      content = defaultWorkLogContent(now);
    }
  } else {
    content = defaultWorkLogContent(now);
  }

  await writeFile(filePath, content);
  openWorkLogTab(filePath, content, ctx.id);

  // Refresh file tree
  const entries = await listDir(ctx.path, true);
  const tree = buildFileTree(entries, ctx.path);
  useFileStore.getState().setFileTree(tree);

  return filePath;
}

function applyWorkLogTemplate(template: string, date: Date): string {
  const y = date.getFullYear().toString();
  const m = (date.getMonth() + 1).toString().padStart(2, "0");
  const d = date.getDate().toString().padStart(2, "0");
  return template
    .replace(/\{\{date\}\}/g, `${y}-${m}-${d}`)
    .replace(/\{\{year\}\}/g, y)
    .replace(/\{\{month\}\}/g, m)
    .replace(/\{\{day\}\}/g, d);
}

function defaultWorkLogContent(date: Date): string {
  const y = date.getFullYear();
  const m = (date.getMonth() + 1).toString().padStart(2, "0");
  const d = date.getDate().toString().padStart(2, "0");
  return `---
date: ${y}-${m}-${d}
type: work-log
---

# ${y}-${m}-${d} Work Log

## Tasks

-

## Notes

`;
}

function formatDate(date: Date, format: string): string {
  const y = date.getFullYear().toString();
  const m = (date.getMonth() + 1).toString().padStart(2, "0");
  const d = date.getDate().toString().padStart(2, "0");
  return format.replace("YYYY", y).replace("MM", m).replace("DD", d);
}

function openWorkLogTab(
  filePath: string,
  content: string,
  contextId: string,
): void {
  useFileStore.getState().setFileContent(filePath, content);
  const fileName = filePath.split("/").pop() ?? "Work Log";
  useEditorStore.getState().openTab({
    id: crypto.randomUUID(),
    filePath,
    title: fileName,
    isDirty: false,
    isPinned: false,
    contextId,
  });
}
