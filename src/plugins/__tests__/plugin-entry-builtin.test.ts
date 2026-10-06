// §391 spec 0070 §5 — a built-in's entry points go up after its activate, and come down with it.
import { beforeEach, describe, expect, it, vi } from "vitest";

// `vi.hoisted` — the factory below runs before plain top-level consts initialise
// (`builtin-lifecycle.test.ts` explains the TDZ this avoids).
const h = vi.hoisted(() => {
  const activate = vi.fn();
  return {
    activate,
    FIXTURES: [
      {
        manifest: {
          author: "Baram",
          capabilities: ["commands"],
          contributions: {
            commands: [{ id: "go", title: "Go" }],
            slash: [{ command: "go", id: "go" }],
          },
          description: "fixture",
          engines: { baram: ">=0.5.0" },
          id: "fix-entry",
          license: "Apache-2.0",
          main: "(builtin)",
          name: "Fixture",
          trust: "trusted",
          version: "1.0.0",
        },
        module: { activate },
      },
    ],
  };
});
vi.mock("../builtin", () => ({ BUILTIN_PLUGINS: h.FIXTURES }));

import {
  activateBuiltin,
  deactivateBuiltin,
  shutdownBuiltinPlugins,
} from "../plugin-lifecycle";
import { usePluginUIStore } from "../plugin-ui-store";

beforeEach(async () => {
  await shutdownBuiltinPlugins();
  h.activate.mockReset();
  usePluginUIStore.setState({ contributions: {} });
});

describe("built-in entry points (§391 §5)", () => {
  it("go up after activate and come down on deactivate", async () => {
    await activateBuiltin("fix-entry");
    expect(
      usePluginUIStore.getState().contributions["fix-entry"]?.slash,
    ).toEqual([{ command: "go", id: "go" }]);
    await deactivateBuiltin("fix-entry");
    expect(
      usePluginUIStore.getState().contributions["fix-entry"],
    ).toBeUndefined();
  });

  it("do not go up when activate throws", async () => {
    h.activate.mockRejectedValue(new Error("boom"));
    await expect(activateBuiltin("fix-entry")).rejects.toThrow("boom");
    // `activateOne` does not unwind a failed activate, so an entry put up before it would stay.
    expect(
      usePluginUIStore.getState().contributions["fix-entry"],
    ).toBeUndefined();
  });
});
