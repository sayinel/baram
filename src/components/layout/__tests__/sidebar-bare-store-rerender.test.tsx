// §340 / Fix E (M-11): `Sidebar` used to read `const { sidebarPanel } = useUIStore()` —
// a BARE call that subscribes to the whole store, so ANY unrelated write (dragging the
// right-panel splitter, opening a modal, anything touching `useUIStore`) re-rendered the
// sidebar and its active panel. Narrowed to `useUIStore((s) => s.sidebarPanel)`. This
// pins the fix as a commit COUNT, not a timing measurement (this repo's convention for
// performance regressions) via `React.Profiler.onRender`, which fires once per actual
// commit — a plain counter in the render body would also count React's discarded
// pre-commit re-invokes and could not tell "stayed at N" from "went to N then back".
import { act, Profiler } from "react";

import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { useUIStore } from "../../../stores/ui/ui";
import { Sidebar } from "../Sidebar";

function renderSidebarCountingCommits(): { commits: number } {
  const state = { commits: 0 };
  render(
    <Profiler
      id="sidebar-probe"
      onRender={() => {
        state.commits += 1;
      }}
    >
      <Sidebar />
    </Profiler>,
  );
  return state;
}

describe("Sidebar re-render scope (§340 M-11)", () => {
  it("does not commit again for a store write it does not read", () => {
    const state = renderSidebarCountingCommits();
    const before = state.commits;

    // rightPanelWidth is read by AppLayout, not Sidebar — exactly the kind of write
    // that a bare useUIStore() would have re-rendered this component for.
    act(() => {
      useUIStore.getState().setRightPanelWidth(420);
    });

    expect(state.commits).toBe(before);
  });

  it("still commits when the field it actually reads changes — non-vacuity control", () => {
    useUIStore.setState({ sidebarPanel: "files" });
    const state = renderSidebarCountingCommits();
    const before = state.commits;

    act(() => {
      useUIStore.getState().setSidebarPanel("graph");
    });

    expect(state.commits).toBeGreaterThan(before);
  });
});
