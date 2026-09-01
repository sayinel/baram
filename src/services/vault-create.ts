// §81 Home-screen "New Vault" flow — prompts for a folder, initializes it as
// a vault, registers it as a context, and switches to it.
//
// All four imports below stay dynamic on purpose (§372 DAG rule): this file
// lives in `services/`, and a static edge back into `stores/context/context`
// or `services/vault-context-loader` would risk re-creating the same kind of
// cross-module cycle `vault-context-loader.ts` documents at its own top —
// dynamic edges are what keep the static module graph acyclic.
export async function createVaultFromDialog(): Promise<void> {
  const { open } = await import("@tauri-apps/plugin-dialog");
  const selected = await open({ directory: true });
  if (!selected) return;
  const path = typeof selected === "string" ? selected : selected[0];
  if (!path) return;
  const { initVault } = await import("../ipc/context");
  const { useContextStore: ctxStore } =
    await import("../stores/context/context");
  const alias = path.split("/").pop() ?? "vault";
  await initVault(path, alias);
  await ctxStore.getState().addContext("vault", path, { alias });
  const { switchContext } = await import("./vault-context-loader");
  const activeId = ctxStore.getState().activeContextId;
  if (activeId) await switchContext(activeId);
}
