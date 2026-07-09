import { beforeEach, describe, expect, it, vi } from "vitest";

import { useContextStore } from "../context/context";
import { openFolder } from "../file/file";
import { useSettingsStore } from "../settings/store";

// §82 Fix 1 regression: openFolder must not downgrade an already-open vault
// context's isVault flag when restoring the active vault on app startup
// (use-app-startup.ts calls openFolder for a path that is already registered
// as a "vault" context — the `existing` truthy branch).
//
// Mock the IPC boundaries openFolder touches so this test exercises only the
// store logic (isVault derivation + addRecentFolder), not Tauri/Rust.
vi.mock("../../ipc/invoke", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../ipc/invoke")>();
  return {
    ...actual,
    listDir: vi.fn(async () => []),
    refreshIndex: vi.fn(async () => ({ fileCount: 0, linkCount: 0 })),
    setVaultRoot: vi.fn(async () => undefined),
  };
});

const VAULT_PATH = "/vault/existing";

describe("openFolder — startup restore (Fix 1)", () => {
  beforeEach(() => {
    useSettingsStore.setState({ recentFolders: [] } as never);
    useContextStore.setState({
      activeContextId: null,
      contexts: [
        {
          id: "ctx1",
          contextType: "vault",
          path: VAULT_PATH,
          label: "existing",
          color: "#ffffff",
          addedAt: 0,
        },
      ],
    } as never);
  });

  it("preserves isVault: true for an already-open vault context (does not downgrade to false)", async () => {
    await openFolder(VAULT_PATH);

    const entry = useSettingsStore.getState().recentFolders[0];
    expect(entry.path).toBe(VAULT_PATH);
    expect(entry.isVault).toBe(true);
  });
});
