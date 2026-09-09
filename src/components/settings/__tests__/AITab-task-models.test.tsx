import type { ModelInfo } from "../../../ipc/types";

import { act, render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useAIStore } from "../../../stores/ai/ai";
import { AITab } from "../tabs/AITab";

// Selecting a provider and then entering its key is the only possible order
// for a provider being set up for the first time. The per-task model
// selectors fetched their catalogue on an effect keyed only on the provider
// identity, so the fetch that ran at selection time failed with NoApiKey and
// nothing repeated it once the key existed: those dropdowns stayed empty
// until the tab remounted.

const CATALOGUE: ModelInfo[] = [
  { id: "openrouter/auto", name: "Auto Router" },
  { id: "anthropic/claude-sonnet-4.5", name: "Anthropic: Claude Sonnet 4.5" },
];

/** Flipped by the test to model "the key is now in the keyring". */
let keyStored = false;

const listModels = vi.fn(async (): Promise<ModelInfo[]> => {
  if (!keyStored) throw new Error("API key not provided");
  return CATALOGUE;
});

vi.mock("../../../ipc/invoke", () => ({
  // The AI store persists through tauriStorage, which reaches for these three.
  getConfig: vi.fn(async () => null),
  keyringDeleteProviderKey: vi.fn(async () => {}),
  keyringProviderConfigured: vi.fn(async () => false),
  keyringSetProviderKey: vi.fn(async () => {}),
  llmListModels: (...args: unknown[]) => listModels(...(args as [])),
  removeConfig: vi.fn(async () => {}),
  setConfig: vi.fn(async () => {}),
}));

const initial = useAIStore.getState();

/** The model dropdown of every per-task selector. */
function taskModelOptionCounts(container: HTMLElement): number[] {
  return [
    ...container.querySelectorAll("select.settings-select-task-model"),
  ].map((select) => select.querySelectorAll("option").length);
}

describe("AITab per-task model selectors", () => {
  beforeEach(() => {
    keyStored = false;
    listModels.mockClear();
    useAIStore.setState(
      {
        ...initial,
        autoModelEnabled: true,
        configured: {},
        model: "openrouter/auto",
        provider: "openrouter",
      },
      true,
    );
  });

  it("fills the task model lists once the provider's key is stored", async () => {
    const { container } = await act(async () => render(<AITab />));

    // Before the key: the fetch rejected, so each selector holds nothing but
    // its own placeholder option.
    expect(taskModelOptionCounts(container)).toEqual([1, 1, 1, 1]);
    const attemptsBeforeKey = listModels.mock.calls.length;
    expect(attemptsBeforeKey).toBeGreaterThan(0);

    // Entering the key is what `setApiKey` reports: the provider becomes
    // configured. Nothing else about the selection changes.
    keyStored = true;
    await act(async () => {
      useAIStore.setState({ configured: { openrouter: true } });
    });

    expect(listModels.mock.calls.length).toBeGreaterThan(attemptsBeforeKey);
    // Placeholder plus the catalogue, for all four tasks.
    expect(taskModelOptionCounts(container)).toEqual([3, 3, 3, 3]);
  });

  it("does not refetch when an unrelated part of the store changes", async () => {
    keyStored = true;
    const { container } = await act(async () => render(<AITab />));
    expect(taskModelOptionCounts(container)).toEqual([3, 3, 3, 3]);

    const attempts = listModels.mock.calls.length;
    await act(async () => {
      useAIStore.setState({ ghostTextEnabled: true });
    });

    // Without this the refetch trigger would be "any render", which is a
    // request per keystroke in the API key field.
    expect(listModels.mock.calls.length).toBe(attempts);
  });
});
