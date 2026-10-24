// §394 spec 0073 D11 · D14 · plan 0126 P7 · P13 — where a judged click in a sandboxed panel goes: a note
// against the context active at the click, an action under prompt rights through the delivery the
// plugin's session sets, and nothing before that delivery exists or after the release.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const pluginNoteLink = vi.fn();
const openFileByPath = vi.fn();
vi.mock("../../../ipc/plugin-invoke", () => ({
  pluginNoteLink: (...a: unknown[]) => pluginNoteLink(...a),
}));
vi.mock("../../../utils/open-file", () => ({
  openFileByPath: (...a: unknown[]) => openFileByPath(...a),
}));

import { useContextStore } from "../../../stores/context/context";
import { useUIStore } from "../../../stores/ui/ui";
import { promptRefusal, resetPromptGate } from "../../prompt-gate";
import {
  __resetPanelContents,
  releasePanels,
  setPanelActions,
} from "../panel-contents";
import { dispatchPanelAction, panelClickHandlers } from "../panels-host";

const handlers = () =>
  panelClickHandlers(
    { panelId: "sb:live", pluginId: "sb" },
    () => "Plugin · SB",
  );

beforeEach(() => {
  __resetPanelContents();
  pluginNoteLink
    .mockReset()
    .mockImplementation(async (_context: string, path: string) => `/v/${path}`);
  openFileByPath.mockReset().mockResolvedValue("opened");
  useUIStore.setState({ toast: null });
});
afterEach(() => {
  resetPromptGate();
  useContextStore.setState({ activeContextId: null });
});

describe("a data-note in a panel (P7)", () => {
  /** A panel belongs to no note, so its links read against the context active when the user clicks.
   *  What fails this: a context fixed at registration or at the draw — the second click must ask with
   *  the context active then. */
  it("is read against the context active at the click", async () => {
    useContextStore.setState({ activeContextId: "ctx-a" });
    handlers().note("notes/a.md");
    await vi.waitFor(() =>
      expect(openFileByPath).toHaveBeenCalledWith("/v/notes/a.md"),
    );
    expect(pluginNoteLink).toHaveBeenCalledWith("ctx-a", "notes/a.md");
    useContextStore.setState({ activeContextId: "ctx-b" });
    handlers().note("notes/a.md");
    await vi.waitFor(() =>
      expect(pluginNoteLink).toHaveBeenLastCalledWith("ctx-b", "notes/a.md"),
    );
  });

  /** §6 — no active context: nothing to read the path against. Refused with the panel's badge on the
   *  fixed toast, and Rust is not asked. The pair is the row above. */
  it("is refused with no active context", async () => {
    handlers().note("notes/a.md");
    await vi.waitFor(() =>
      expect(useUIStore.getState().toast?.source).toBe("Plugin · SB"),
    );
    expect(pluginNoteLink).not.toHaveBeenCalled();
  });
});

describe("a data-action in a panel (D11 ③ · P13)", () => {
  /** The second entrance for a panel: rights from the click until the delivery settles, and the
   *  plugin hears its declared id, not the key. What fails this: a delivery outside `runPluginAction`
   *  (no rights while it runs), rights ended before it settles (the pending check before `release`), or
   *  the key passed as the id. */
  it("crosses with the declared id under prompt rights until it settles", async () => {
    let release!: () => void;
    const seen: Array<[string, string, null | string]> = [];
    setPanelActions(
      "sb",
      (id, action) =>
        new Promise<void>((resolve) => {
          seen.push([id, action, promptRefusal("sb")]);
          release = resolve;
        }),
    );
    handlers().action("go");
    await vi.waitFor(() => expect(seen).toHaveLength(1));
    expect(seen[0]).toEqual(["live", "go", null]);
    // Still pending: the rights are held until the delivery settles, not only while it is called.
    expect(promptRefusal("sb")).toBeNull();
    release();
    await vi.waitFor(() =>
      expect(promptRefusal("sb")).toMatch(/commands is running/),
    );
  });

  /** P13 — before the session sets its delivery, and after the release takes it, a click does nothing
   *  and grants nothing. "Grants nothing" is read right after the call, while rights a dispatch began
   *  would still be held (`beginPluginInvocation` runs synchronously), and again once it settles. What
   *  fails this: a dispatch that begins and ends rights with no delivery. The pair is the row above. */
  it("does nothing without a delivery", async () => {
    const unset = dispatchPanelAction("sb", "sb:live", "go");
    expect(promptRefusal("sb")).toMatch(/commands is running/);
    await unset;
    expect(promptRefusal("sb")).toMatch(/commands is running/);
    const deliver = vi.fn(async () => {});
    setPanelActions("sb", deliver);
    releasePanels("sb");
    const released = dispatchPanelAction("sb", "sb:live", "go");
    expect(promptRefusal("sb")).toMatch(/commands is running/);
    await released;
    expect(promptRefusal("sb")).toMatch(/commands is running/);
    expect(deliver).not.toHaveBeenCalled();
  });

  /** A key is the plugin's own only under its `${pluginId}:` prefix, and a foreign key grants nothing —
   *  read right after the call and once it settles, as in the row above. What fails this: slicing any
   *  key, which would hand plugin `sb` an id made from another plugin's key, or rights begun for a
   *  click that delivers nothing. */
  it("ignores a key outside the plugin's prefix", async () => {
    const deliver = vi.fn(async () => {});
    setPanelActions("sb", deliver);
    const foreign = dispatchPanelAction("sb", "other:live", "go");
    expect(promptRefusal("sb")).toMatch(/commands is running/);
    await foreign;
    expect(promptRefusal("sb")).toMatch(/commands is running/);
    expect(deliver).not.toHaveBeenCalled();
  });
});
