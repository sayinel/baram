// §260 3c-2b review (I1) — a guardrail for a coupling that is invisible at runtime
// until it breaks in a packaged build, and which a deleted comment had previously
// been the only record of.
//
// A `<meta>` CSP can only TIGHTEN the policy a document is served with. In a packaged
// build Tauri injects the global `csp` from tauri.conf.json as a response header for
// every `.html` asset (`manager/mod.rs` `set_csp` → `protocol/tauri.rs`), and a
// resource must pass BOTH policies. So every source the sandbox realm needs must be
// present in the GLOBAL policy too — the sandbox's own meta CSP cannot add it.
//
// Today `sandbox.html` needs `blob:` (it imports the plugin bundle from a blob URL)
// while the global `script-src` does not list it. That is survivable ONLY because
// sandbox-webview creation is dev-gated (`isSandboxRuntimeAllowed` requires
// `import.meta.env.DEV`), and in dev the webview loads the Vite dev server directly,
// so no Tauri header is attached. Lifting that gate in Phase 5 without adding `blob:`
// globally would silently break every sandboxed plugin in release — and 3c-3's smoke
// runs in dev, so it cannot catch it.
//
// This test fails the moment the dev gate is removed while the global CSP still lacks
// what the sandbox needs, forcing the Phase-5 decision instead of trusting memory.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(__dirname, "../../..");

/** Sources a directive lists, e.g. `script-src 'self' blob:` → ["'self'", "blob:"]. */
function directive(csp: string, name: string): string[] {
  const found = csp
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${name} `));
  return found ? found.slice(name.length).trim().split(/\s+/) : [];
}

function globalCsp(): string {
  const conf = JSON.parse(readText("src-tauri/tauri.conf.json")) as {
    app: { security: { csp: string } };
  };
  return conf.app.security.csp;
}

function readText(rel: string): string {
  return readFileSync(resolve(root, rel), "utf8");
}

/** Does sandbox-webview creation still require a dev build? */
function sandboxIsDevGated(): boolean {
  return /isSandboxRuntimeAllowed[\s\S]{0,200}?import\.meta\.env\.DEV/.test(
    readText("src/plugins/plugins-enabled.ts"),
  );
}

function sandboxMetaCsp(): string {
  const html = readText("sandbox.html");
  const match = /content="([^"]*)"/.exec(html);
  expect(match, "sandbox.html must carry a meta CSP").not.toBeNull();
  return match?.[1] ?? "";
}

describe("sandbox CSP vs the global CSP (§260 3c-2b, I1)", () => {
  it("documents the packaged-build gap while the sandbox stays dev-gated", () => {
    const sandboxScriptSrc = directive(sandboxMetaCsp(), "script-src");
    const globalScriptSrc = directive(globalCsp(), "script-src");
    const missing = sandboxScriptSrc.filter(
      (src) => !globalScriptSrc.includes(src),
    );

    if (missing.length === 0) return; // global covers everything — nothing to gate

    // Something the sandbox needs is absent globally, so it can only work in dev.
    expect(
      sandboxIsDevGated(),
      `sandbox.html's script-src needs ${missing.join(", ")}, which the global CSP ` +
        `in tauri.conf.json does not allow. A meta CSP cannot widen the served ` +
        `policy, so in a packaged build the sandbox realm cannot load its plugin ` +
        `bundle at all. Either add ${missing.join(", ")} to the global script-src ` +
        `(note: that also lets the MAIN realm execute those sources) or keep ` +
        `sandbox creation dev-gated. See the comment in sandbox.html.`,
    ).toBe(true);
  });

  it("keeps the sandbox realm free of asset: — the F1 fix must not regress", () => {
    // Re-adding `asset:` here would restore an ungranted file-read capability: the
    // asset scope is app-global and covers the vault and every plugin directory.
    expect(sandboxMetaCsp()).not.toContain("asset:");
    expect(directive(sandboxMetaCsp(), "default-src")).toEqual(["'none'"]);
  });
});
