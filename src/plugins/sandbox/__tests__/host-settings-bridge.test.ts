// §260 Phase 4c — the host side of `settings`: what a plugin may read, and what never rides
// a frame.
//
// WHEN it is told moved to `plugins/__tests__/settings-change-notifier.test.ts` with the
// watcher itself (§0054) — both tiers share it now.
import type { PluginCapability, PluginSettingField } from "../../types";

import { describe, expect, it } from "vitest";

import { createSettingsRequestHandler } from "../host-settings-bridge";

const DECLARED: PluginSettingField[] = [
  { default: true, key: "compact", label: "Compact", type: "boolean" },
  { default: 3, key: "depth", label: "Depth", type: "number" },
];

function handler(
  capabilities: PluginCapability[],
  persisted: Record<string, unknown> | undefined = undefined,
  declaredSettings: PluginSettingField[] = DECLARED,
) {
  const staged: string[] = [];
  const call = createSettingsRequestHandler({
    capabilities,
    declaredSettings,
    persisted: () => persisted,
    pluginId: "p",
    stage: async (_pluginId, payload) => void staged.push(payload),
  });
  return { call, staged };
}

describe("createSettingsRequestHandler", () => {
  it("stages the resolved values and answers with nothing", async () => {
    // The answer does NOT ride the response: `MAX_SETTING_FIELDS` × the per-string cap is
    // already over tauri's 8 KiB channel-data threshold.
    const { call, staged } = handler(["settings"], { depth: 9 });

    const answer = await call({ kind: "settings_read" });

    expect(answer).toBeUndefined();
    expect(staged).toEqual([JSON.stringify({ compact: true, depth: 9 })]);
  });

  it("refuses without the settings capability, naming it", async () => {
    const { call, staged } = handler(["storage"]);
    await expect(call({ kind: "settings_read" })).rejects.toThrow(
      /requires the "settings" capability/,
    );
    // Refused BEFORE the work: nothing staged, so a denied plugin cannot leave a payload
    // sitting in its slot for its next legitimate pull to collect.
    expect(staged).toEqual([]);
  });

  it("stages only DECLARED keys, whatever the persisted record holds", async () => {
    // The manifest is the payload's bound. A key the plugin no longer declares — after an
    // update that renamed it — must not come back under the old name.
    const { call, staged } = handler(["settings"], {
      compact: false,
      removedInV2: "secret",
    });

    await call({ kind: "settings_read" });

    expect(JSON.parse(staged[0])).toEqual({ compact: false, depth: 3 });
  });

  it("re-resolves on every call, so a value changed mid-session is seen", async () => {
    let persisted: Record<string, unknown> = { depth: 1 };
    const staged: string[] = [];
    const call = createSettingsRequestHandler({
      capabilities: ["settings"],
      declaredSettings: DECLARED,
      persisted: () => persisted,
      pluginId: "p",
      stage: async (_pluginId, payload) => void staged.push(payload),
    });

    await call({ kind: "settings_read" });
    persisted = { depth: 2 };
    await call({ kind: "settings_read" });

    expect(
      staged.map((s) => (JSON.parse(s) as { depth: number }).depth),
    ).toEqual([1, 2]);
  });

  it("stages an empty object for a plugin that declares no fields", async () => {
    // No special case: the same one path, so there is no threshold or emptiness branch to
    // get wrong, and the client's parse always has something to parse.
    const { call, staged } = handler(["settings"], undefined, []);
    await call({ kind: "settings_read" });
    expect(staged).toEqual(["{}"]);
  });
});
