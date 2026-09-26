// §340 / Fix E (M-11): `useSettingsRegistry` used to read `const ai = useAIStore()` — a
// BARE call subscribing to the whole ai store, which also holds `ghostText`/`isStreaming`
// (rewritten on every streamed token). Narrowed to the ai-store fields this file
// actually reads/writes. Commit COUNT, not timing, via `React.Profiler.onRender` — see
// `sidebar-bare-store-rerender.test.tsx` for why a plain render-body counter would not do
// (it would also count React's discarded pre-commit re-invokes).
import { Profiler } from "react";

import { act, render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { readEditorTypography } from "../../../hooks/use-editor-typography";
import { useAIStore } from "../../../stores/ai/ai";
import { useSettingsStore } from "../../../stores/settings/store";
import { useSettingsRegistry } from "../settings-registry";

/** `useSettingsRegistry` is a hook, not a component — this is the minimal render surface
 *  that calls it, so the test exercises the real hook rather than a re-implementation of
 *  its selector shape. */
function RegistryProbe() {
  useSettingsRegistry();
  return null;
}

function renderRegistryCountingCommits(): { commits: number } {
  const state = { commits: 0 };
  render(
    <Profiler
      id="settings-registry-probe"
      onRender={() => {
        state.commits += 1;
      }}
    >
      <RegistryProbe />
    </Profiler>,
  );
  return state;
}

describe("useSettingsRegistry re-render scope (§340 M-11)", () => {
  it("does not commit again for an ai-store write it does not read (a streamed token)", () => {
    const state = renderRegistryCountingCommits();
    const before = state.commits;

    // ghostText/isStreaming change on every streamed token — exactly the write this
    // branch made costly by also reading aiEnabled from the same bare-subscribed store.
    act(() => {
      useAIStore.setState({
        ghostText: "partial completion",
        isStreaming: true,
      });
    });

    expect(state.commits).toBe(before);
  });

  it("still commits when a field it actually reads changes — non-vacuity control", () => {
    useAIStore.setState({ aiEnabled: true });
    const state = renderRegistryCountingCommits();
    const before = state.commits;

    act(() => {
      useAIStore.getState().setAIEnabled(false);
    });

    expect(state.commits).toBeGreaterThan(before);

    useAIStore.setState({ aiEnabled: true });
  });

  it("does not commit again for a settings-store write it does not read (a keybinding override) — issue 267", () => {
    const state = renderRegistryCountingCommits();
    const before = state.commits;

    act(() => {
      useSettingsStore
        .getState()
        .setKeybindingOverride("probe.command", "Mod-Shift-9");
    });

    expect(state.commits).toBe(before);
    useSettingsStore.getState().removeKeybindingOverride("probe.command");
  });

  it("still commits when a settings field it reads changes — non-vacuity control", () => {
    const state = renderRegistryCountingCommits();
    const before = state.commits;
    const size = readEditorTypography().fontSize;
    // 사용자 층을 통째로 되돌린다 — `setDial(…, size)` 로 되돌리면 원래 없던 키가 남는다.
    const priorOverrides = useSettingsStore.getState().appearanceOverrides;

    act(() => {
      useSettingsStore.getState().setDial("editorFontSize", size + 1);
    });

    expect(state.commits).toBeGreaterThan(before);
    useSettingsStore.setState({ appearanceOverrides: priorOverrides });
  });
});
