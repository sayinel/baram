// issue 267: `AITab` used to read thirty-one fields with a BARE `useAIStore()` — a subscription
// to the whole ai store, which also carries `ghostText` and `isStreaming`, rewritten on every
// streamed token. While the tab was open, each token re-rendered the whole tab. Narrowed to a
// `useShallow` selection of exactly those fields. Pinned as a commit COUNT via
// `React.Profiler.onRender` (see `sidebar-bare-store-rerender.test.tsx`).
import { act, Profiler } from "react";

import { render, waitFor } from "@testing-library/react";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import { useAIStore } from "../../../stores/ai/ai";
import { AITab } from "../tabs/AITab";

vi.mock("../../../ipc/invoke", () => ({
  // The ai store persists through tauriStorage and probes the keyring after rehydration;
  // the tab lists the provider's models on mount. All of it resolves before a baseline.
  getConfig: vi.fn(async () => null),
  keyringDeleteProviderKey: vi.fn(async () => {}),
  keyringProviderConfigured: vi.fn(async () => false),
  keyringSetProviderKey: vi.fn(async () => {}),
  llmListModels: vi.fn(async () => []),
  removeConfig: vi.fn(async () => {}),
  setConfig: vi.fn(async () => {}),
}));

/** The store after rehydration finished — `refreshConfiguredProviders` runs un-awaited from
 *  the rehydrate callback and writes `configured` and `keychainReady` only after its keyring
 *  probes, so a snapshot taken at import time would restore a half-hydrated store. */
let hydrated: ReturnType<typeof useAIStore.getState>;

async function renderTabCountingCommits(): Promise<{ commits: number }> {
  const state = { commits: 0 };
  render(
    <Profiler
      id="ai-tab-probe"
      onRender={() => {
        state.commits += 1;
      }}
    >
      <AITab />
    </Profiler>,
  );
  // The model list effect resolves through the mocked invoke; let the count go quiet.
  let seen = -1;
  for (let round = 0; round < 10 && seen !== state.commits; round += 1) {
    seen = state.commits;
    await act(async () => {});
  }
  return state;
}

describe("AITab re-render scope (issue 267)", () => {
  beforeAll(async () => {
    await waitFor(() => expect(useAIStore.getState().keychainReady).toBe(true));
    hydrated = useAIStore.getState();
  });
  beforeEach(() => {
    // No per-task model selectors: their mount effects would add asynchronous commits.
    useAIStore.setState({ ...hydrated, autoModelEnabled: false });
  });
  afterEach(() => {
    useAIStore.setState(hydrated);
  });

  it("does not commit again for an ai-store write it does not read (a streamed token)", async () => {
    const state = await renderTabCountingCommits();
    const before = state.commits;

    act(() => {
      useAIStore.setState({
        ghostText: "partial completion",
        isStreaming: true,
      });
    });

    expect(state.commits).toBe(before);
  });

  it("still commits when a field it reads changes — non-vacuity control", async () => {
    const state = await renderTabCountingCommits();
    const before = state.commits;

    act(() => {
      useAIStore.getState().setAIEnabled(!useAIStore.getState().aiEnabled);
    });

    expect(state.commits).toBeGreaterThan(before);
  });
});
