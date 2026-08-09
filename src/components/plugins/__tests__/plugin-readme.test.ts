// §69 — reading a plugin's README.
//
// ‼️ Why not `readFile` (the IPC the marketplace used): that command is vault-constrained.
// `fs_cmd.rs:152` calls `check_vault`, which defers to `validate_path_any` — a path outside
// every registered vault/folder/file context is denied. Plugins install under
// `~/.baram/plugins/`, which is outside all of them, so the read was rejected and the
// caller's `.catch` turned the denial into "this plugin has no README". Both branches of
// `check_vault` deny it: with contexts registered `validate_path_any` refuses, and with none
// `vault_fallback_decision` refuses.
//
// The asset protocol is the path that is already permitted: `plugin_prepare_scopes` calls
// `allow_directory(plugin_dir, true)` (and forbids `.staging`), and `plugin-loader.ts:548`
// already loads plugin code through `convertFileSrc`. The app CSP allows it too —
// `connect-src` lists `asset:` and `http://asset.localhost`.
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({
  convertFileSrc: (p: string) => `asset://localhost/${encodeURIComponent(p)}`,
}));

import { MAX_README_BYTES, readPluginReadme } from "../plugin-readme";

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

function ok(body: string) {
  return { ok: true, status: 200, text: () => Promise.resolve(body) };
}

describe("readPluginReadme (§69)", () => {
  it("reads README.md from under the install directory", async () => {
    fetchMock.mockResolvedValue(ok("# Word Count\n\nCounts words."));

    const readme = await readPluginReadme("/p/baram-word-count");

    expect(readme).toBe("# Word Count\n\nCounts words.");
    const url = fetchMock.mock.calls[0]?.[0] as string;
    expect(decodeURIComponent(url)).toContain("/p/baram-word-count/README.md");
  });

  it("returns null for a built-in without touching the filesystem", async () => {
    // A built-in is compiled in, so `installPath` is "". Joining onto it would have asked
    // for `/README.md` — the filesystem ROOT — which is both wrong and outside the scope
    // the asset protocol grants.
    const readme = await readPluginReadme("");

    expect(readme).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns null when the plugin ships no README", async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 404 });

    expect(await readPluginReadme("/p/x")).toBeNull();
  });

  it("truncates an oversized README instead of handing it to the renderer", async () => {
    // The README is author-controlled. Parsing an unbounded string into mdast and then into
    // React elements happens on the main thread, so the cap is about not freezing the UI.
    fetchMock.mockResolvedValue(ok("x".repeat(MAX_README_BYTES + 5000)));

    const readme = await readPluginReadme("/p/x");

    expect(readme).toHaveLength(MAX_README_BYTES);
  });

  it("does not truncate a README at exactly the cap", async () => {
    // Boundary — an off-by-one in the comparison shows up here and nowhere else.
    fetchMock.mockResolvedValue(ok("y".repeat(MAX_README_BYTES)));

    expect(await readPluginReadme("/p/x")).toHaveLength(MAX_README_BYTES);
  });
});
