import { describe, expect, it, vi } from "vitest";

const invoke = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...a: unknown[]) => invoke(...a),
}));

import {
  pluginCall,
  pluginSandboxDeregister,
  pluginSandboxRegister,
} from "../plugin-invoke";

describe("sandbox IPC wrappers", () => {
  it("pluginCall forwards the op under the `op` arg key", async () => {
    invoke.mockResolvedValueOnce("v");
    const op = { kind: "storage_read", key: "k" } as const;
    await expect(pluginCall(op)).resolves.toBe("v");
    expect(invoke).toHaveBeenCalledWith("plugin_call", { op });
  });

  // §260 3c-2b — the install path travels with the grants so Rust reads the bundle
  // the host actually resolved (a dev folder can shadow an installed copy).
  it("pluginSandboxRegister passes pluginId + capabilities + installPath", async () => {
    invoke.mockResolvedValueOnce(undefined);
    await pluginSandboxRegister("p1", ["storage", "network"], "/p/p1");
    expect(invoke).toHaveBeenCalledWith("plugin_sandbox_register", {
      pluginId: "p1",
      capabilities: ["storage", "network"],
      installPath: "/p/p1",
    });
  });

  it("pluginSandboxDeregister passes pluginId", async () => {
    invoke.mockResolvedValueOnce(undefined);
    await pluginSandboxDeregister("p1");
    expect(invoke).toHaveBeenCalledWith("plugin_sandbox_deregister", {
      pluginId: "p1",
    });
  });
});
