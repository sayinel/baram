import { describe, expect, it, vi } from "vitest";

const invoke = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...a: unknown[]) => invoke(...a),
}));

import {
  pluginCall,
  pluginInstallStage,
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

  // ‼️ §69 origin pinning — the ARG KEY, which nothing else checks (code review MEDIUM-4).
  // `invoke` takes a `Record<string, unknown>`, so a typo in `registryUrl` typechecks and every
  // other plugin test passes (the marketplace suite mocks `pluginInstallStage` itself) — while
  // Tauri fails to bind `registry_url` and EVERY install and update breaks. Adding a required
  // argument is the highest-risk moment for exactly that, and the convention is right here.
  it("pluginInstallStage passes url + registryUrl under the keys Rust binds", async () => {
    invoke.mockResolvedValueOnce({ stage_id: "s1" });
    await pluginInstallStage(
      "https://r.example/reg/plugins/x-1.0.0.zip",
      "https://r.example/reg/index.json",
      "sha",
      "x",
    );
    expect(invoke).toHaveBeenCalledWith("plugin_install_stage", {
      checksum: "sha",
      expectedId: "x",
      registryUrl: "https://r.example/reg/index.json",
      url: "https://r.example/reg/plugins/x-1.0.0.zip",
    });
  });

  it("pluginInstallStage sends null rather than undefined for the optional pair", async () => {
    // Tauri drops `undefined` from the payload, which for an `Option<String>` deserialises the
    // same — but the two are not interchangeable across every arg type, and the wrapper's
    // contract is explicit nulls.
    invoke.mockResolvedValueOnce({ stage_id: "s1" });
    await pluginInstallStage(
      "https://r.example/reg/x.zip",
      "https://r.example/reg/index.json",
    );
    expect(invoke).toHaveBeenCalledWith("plugin_install_stage", {
      checksum: null,
      expectedId: null,
      registryUrl: "https://r.example/reg/index.json",
      url: "https://r.example/reg/x.zip",
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
