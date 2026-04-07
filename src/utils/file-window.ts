// §89 Open standalone files in a separate WebviewWindow (file mode)

import { WebviewWindow } from "@tauri-apps/api/webviewWindow";

/**
 * Open a standalone .md file in a dedicated file-mode window.
 * The new window loads the same SPA with `?mode=file&path=...` URL params,
 * which App.tsx detects to render a minimal file editor layout.
 */
export async function openFileWindow(filePath: string): Promise<void> {
  const fileName = filePath.split("/").pop() ?? "Untitled";
  const label = `file-${Date.now()}`;

  new WebviewWindow(label, {
    url: `/?mode=file&path=${encodeURIComponent(filePath)}`,
    title: `${fileName} — Baram`,
    width: 820,
    height: 640,
    center: true,
  });
}
