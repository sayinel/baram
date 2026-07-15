import { beforeEach, describe, expect, it, vi } from "vitest";

import { openFileByPath } from "../../utils/open-file";
import { useContextStore } from "../context/context";
import { useEditorStore } from "../editor/editor";
import { switchContext, useFileStore } from "../file/file";
import { useSettingsStore } from "../settings/store";

// §89 Regression: opening a standalone external file while one or more vaults
// are open must make the file's FileContext the ACTIVE context so the sidebar
// (which follows the active context's rootPath) hides for the single-file focus
// view. Clicking a Vault Tab (switchContext) must then restore that vault's
// rootPath so the file tree reappears — previously the sidebar stayed stuck
// hidden because visibility was keyed off the active editor tab, which
// switchContext never reset.
//
// Mock only the IPC boundaries the open flow touches, so the test exercises the
// store logic (context activation + rootPath transitions), not Tauri/Rust.
vi.mock("../../ipc/fs", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../ipc/fs")>()),
  readFile: vi.fn(async () => "# external note"),
}));

vi.mock("../../ipc/context", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../ipc/context")>()),
  // Echo the context back as if the Rust backend persisted it.
  addContext: vi.fn(async (info) => info),
}));

vi.mock("../../ipc/invoke", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../ipc/invoke")>()),
  listDir: vi.fn(async () => []),
  refreshIndex: vi.fn(async () => ({ fileCount: 0, linkCount: 0 })),
  setVaultRoot: vi.fn(async () => undefined),
}));

vi.mock("../../plugins/plugin-lifecycle", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../plugins/plugin-lifecycle")>()),
  notifyFileOpen: vi.fn(),
}));

const VAULT_A = "/vault/a";
const EXTERNAL_FILE = "/somewhere/else/external.md";

describe("§89 external file open — sidebar visibility follows active context", () => {
  beforeEach(() => {
    useSettingsStore.setState({ recentFiles: [] } as never);
    useEditorStore.setState({ tabs: [], activeTabId: null, mruOrder: [] });
    useFileStore.setState({ rootPath: VAULT_A, fileTree: [] } as never);
    useContextStore.setState({
      activeContextId: "ctx-a",
      contexts: [
        {
          id: "ctx-a",
          contextType: "vault",
          path: VAULT_A,
          label: "a",
          color: "#fff",
          addedAt: 0,
        },
      ],
    } as never);
  });

  it("activates the FileContext (clearing rootPath) when opening an external file", async () => {
    await openFileByPath(EXTERNAL_FILE);

    const ctxStore = useContextStore.getState();
    const active = ctxStore.contexts.find(
      (c) => c.id === ctxStore.activeContextId,
    );
    // The newly created FileContext must be the active context…
    expect(active?.contextType).toBe("file");
    expect(active?.path).toBe(EXTERNAL_FILE);
    // …and rootPath must be cleared so showSidebar (= !!rootPath && sidebarOpen)
    // hides the sidebar for the single-file focus view.
    expect(useFileStore.getState().rootPath).toBeNull();
  });

  it("restores the vault rootPath when its Vault Tab is clicked (sidebar reappears)", async () => {
    await openFileByPath(EXTERNAL_FILE);
    expect(useFileStore.getState().rootPath).toBeNull();

    // Simulate clicking the Vault A context tab.
    await switchContext("ctx-a");

    expect(useFileStore.getState().rootPath).toBe(VAULT_A);
    // The external file tab is still the active editor tab (editor unchanged),
    // yet the sidebar now shows Vault A because visibility follows the context.
    const editor = useEditorStore.getState();
    const activeTab = editor.tabs.find((t) => t.id === editor.activeTabId);
    expect(activeTab?.filePath).toBe(EXTERNAL_FILE);
  });
});
