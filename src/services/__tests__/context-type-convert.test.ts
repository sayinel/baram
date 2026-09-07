// §82 Converting an open context between Folder and Vault.
//
// issue 263 — `remove_context` now FORGETS the link index for that path
// (`context_cmd.rs`), and the only thing that builds one is
// `_loadContextFileTree`, which runs on a switch. The active context is
// therefore rebuilt for free and an inactive one is not: it came back with an
// empty index slot nobody fills, so backlinks read empty and every rename
// inside it was refused as INDEX_NOT_READY until the user happened to switch
// into it.
import type { ContextInfo } from "../../ipc/types";

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../ipc/context", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../ipc/context")>()),
  addContext: vi.fn(async (info: ContextInfo) => info),
  initVault: vi.fn(async () => ({})),
  removeContext: vi.fn(async () => undefined),
  setVaultConfigByPath: vi.fn(async () => undefined),
}));

vi.mock("../../ipc/invoke", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../ipc/invoke")>()),
  refreshIndex: vi.fn(async () => ({
    duration: 0,
    filesIndexed: 0,
    linksFound: 0,
  })),
}));

// The loader's whole vault-load path (IPC, Rust registration, §334 approval).
// Stubbed so these tests answer only for what the conversion itself triggers.
vi.mock("../vault-context-loader", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../vault-context-loader")>()),
  switchContext: vi.fn(async () => undefined),
}));

import { refreshIndex } from "../../ipc/invoke";
import { useContextStore } from "../../stores/context/context";
import { useEditorStore } from "../../stores/editor/editor";
import { useLinkStore } from "../../stores/editor/link";
import { logger } from "../../utils/logger";
import { convertContextType } from "../context-type-convert";
import { switchContext } from "../vault-context-loader";

function folder(id: string): ContextInfo {
  return {
    id,
    addedAt: 0,
    color: "#3b82f6",
    contextType: "folder",
    label: `label-${id}`,
    path: `/vault/${id}`,
  };
}

const rekeyTabsContext = vi.fn();
const invalidate = vi.fn();

/** `target` present but NOT active; `other` holds the active slot. */
function inactiveTarget(): ContextInfo {
  const target = folder("target");
  useContextStore.setState({
    activeContextId: "other",
    contexts: [target, folder("other")],
  } as never);
  return target;
}

beforeEach(async () => {
  // Flush the persist middleware's microtasks before reseeding.
  await new Promise((r) => setTimeout(r, 0));
  vi.mocked(refreshIndex).mockReset();
  vi.mocked(refreshIndex).mockResolvedValue({
    duration: 0,
    filesIndexed: 0,
    linksFound: 0,
  });
  vi.mocked(switchContext).mockClear();
  rekeyTabsContext.mockReset();
  invalidate.mockReset();
  useEditorStore.setState({ rekeyTabsContext } as never);
  useLinkStore.setState({ invalidate });
});

describe("convertContextType — the converted context keeps a live link index", () => {
  it("rebuilds the index for an INACTIVE context, which nothing else would", async () => {
    const target = inactiveTarget();

    await convertContextType(target);
    await new Promise((r) => setTimeout(r, 0));

    expect(refreshIndex).toHaveBeenCalledTimes(1);
    expect(refreshIndex).toHaveBeenCalledWith("/vault/target");
    // Discriminating: nothing switched, so `_loadContextFileTree` never ran.
    expect(switchContext).not.toHaveBeenCalled();
    expect(invalidate).toHaveBeenCalledTimes(1);
  });

  it("leaves the ACTIVE context to switchContext instead of asking twice", async () => {
    const target = folder("target");
    useContextStore.setState({
      activeContextId: "target",
      contexts: [target],
    } as never);

    await convertContextType(target);
    await new Promise((r) => setTimeout(r, 0));

    expect(switchContext).toHaveBeenCalledTimes(1);
    // `switchContext` is stubbed here, so this counts only the direct call —
    // the point is that the conversion does not add a second refresh request.
    expect(refreshIndex).not.toHaveBeenCalled();
  });

  it("resolves and logs when the rebuild fails, rather than rejecting", async () => {
    const errors = vi.spyOn(logger, "error").mockImplementation(() => {});
    vi.mocked(refreshIndex).mockRejectedValue("index build failed");
    const target = inactiveTarget();

    // The refresh is fire-and-forget: the conversion itself is already done
    // and must not be reported as failed because the index build was not.
    await expect(convertContextType(target)).resolves.toBeUndefined();
    await new Promise((r) => setTimeout(r, 0));

    expect(errors).toHaveBeenCalledWith(
      "§82 convertContextType: refreshIndex failed",
      "index build failed",
    );
    expect(invalidate).not.toHaveBeenCalled();
    errors.mockRestore();
  });

  it("CONTROL: still re-keys every open tab from the old id to the new one", async () => {
    const target = inactiveTarget();

    await convertContextType(target);

    // §82's original reason for existing — `addContext` mints a NEW id, and
    // tabs carry the id of the context they belong to.
    const added = useContextStore
      .getState()
      .contexts.find((c) => c.path === "/vault/target")!;
    expect(added.id).not.toBe("target");
    expect(added.contextType).toBe("vault");
    expect(rekeyTabsContext).toHaveBeenCalledWith("target", added.id);
  });
});
