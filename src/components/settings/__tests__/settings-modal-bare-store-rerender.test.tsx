// issue 267: `SettingsModal` used to read `const { settingsOpen, toggleSettings } = useUIStore()`
// — a BARE call subscribing to the whole ui store, so any unrelated write (the right-panel
// splitter drag, a vim mode change, any modal toggle) re-rendered the modal and every tab
// under it. Narrowed to a `useShallow` pair. Pinned as a commit COUNT via
// `React.Profiler.onRender`, this repo's convention for re-render regressions — see
// `sidebar-bare-store-rerender.test.tsx` for why a render-body counter would not do.
import { act, Profiler } from "react";

import { render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { usePluginUIStore } from "../../../plugins/plugin-ui-store";
import { useUIStore } from "../../../stores/ui/ui";
import { SettingsModal } from "../SettingsModal";

// The open modal mounts `UpdatesSection`, whose `getVersion()` promise sets local state —
// a commit of its own. Resolve it deterministically and let it land before the baseline.
vi.mock("@tauri-apps/api/app", () => ({
  getVersion: vi.fn(async () => "0.0.0-test"),
}));

const initialUI = useUIStore.getState();

/** Render under a Profiler and flush the mounted subtree's asynchronous commits until the
 *  count stops moving, so `before` is a quiescent baseline rather than a mid-flight one. */
async function renderModalCountingCommits(): Promise<{ commits: number }> {
  const state = { commits: 0 };
  render(
    <Profiler
      id="settings-modal-probe"
      onRender={() => {
        state.commits += 1;
      }}
    >
      <SettingsModal />
    </Profiler>,
  );
  let seen = -1;
  for (let round = 0; round < 10 && seen !== state.commits; round += 1) {
    seen = state.commits;
    await act(async () => {});
  }
  return state;
}

describe("SettingsModal re-render scope (issue 267)", () => {
  beforeEach(() => {
    useUIStore.setState({ settingsOpen: true });
    usePluginUIStore.setState({ settingsTabs: [] });
  });
  afterEach(() => {
    useUIStore.setState(initialUI);
  });

  it("does not commit again for a ui-store write it does not read (the splitter drag)", async () => {
    const state = await renderModalCountingCommits();
    const before = state.commits;

    act(() => {
      const { rightPanelWidth, setRightPanelWidth } = useUIStore.getState();
      setRightPanelWidth(rightPanelWidth + 40);
    });

    expect(state.commits).toBe(before);
  });

  it("still commits when settingsOpen changes — non-vacuity control", async () => {
    const state = await renderModalCountingCommits();
    const before = state.commits;

    act(() => {
      useUIStore.getState().toggleSettings();
    });

    expect(state.commits).toBeGreaterThan(before);
  });
});
