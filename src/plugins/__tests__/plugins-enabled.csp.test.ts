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

function sandboxMetaCsp(): string {
  const html = readText("sandbox.html");
  const match = /content="([^"]*)"/.exec(html);
  expect(match, "sandbox.html must carry a meta CSP").not.toBeNull();
  return match?.[1] ?? "";
}

describe("sandbox CSP vs the global CSP (§260 3c-2b, I1)", () => {
  it("keeps every source the sandbox needs present in the global policy", () => {
    // §260 Phase 5 — INVERTED. This used to read "if something is missing globally, the
    // sandbox must be dev-gated", which was right while the gate existed but would have
    // gone green by short-circuiting the moment the gap closed, asserting nothing. The
    // positive form keeps working after the gate is gone: widening the sandbox's CSP
    // later forces the same deliberation instead of working in dev and failing in
    // release.
    const missing = directive(sandboxMetaCsp(), "script-src").filter(
      (src) => !directive(globalCsp(), "script-src").includes(src),
    );

    expect(
      missing,
      `sandbox.html's script-src needs these, and the global CSP in tauri.conf.json ` +
        `does not list them. A <meta> CSP can only TIGHTEN the policy a document is ` +
        `served with, and a packaged build serves sandbox.html with the global csp as ` +
        `a response header — so the sandbox realm cannot load its plugin bundle at ` +
        `all in release, while dev keeps working because the webview loads the Vite ` +
        `devUrl with no Tauri header. Adding a source here also grants it to the MAIN ` +
        `realm; see the decision recorded in sandbox.html.`,
    ).toEqual([]);
  });

  it("denies workers in the sandbox realm — the fallback would allow them", () => {
    // §260 Phase 5 security review. With no `worker-src`, CSP falls back to `script-src`
    // (`'self' blob:`), so the realm could spawn a SHARED worker — reachable by name from
    // every other plugin webview, since they all share this origin. That is a
    // plugin-to-plugin channel straight around the Rust broker. Asserted rather than
    // commented because the directive looks redundant next to `default-src 'none'` and is
    // exactly the kind of line someone tidies away.
    expect(directive(sandboxMetaCsp(), "worker-src")).toEqual(["'none'"]);
  });

  it("keeps the sandbox realm free of asset: — the F1 fix must not regress", () => {
    // Re-adding `asset:` here would restore an ungranted file-read capability: the
    // asset scope is app-global and covers the vault and every plugin directory.
    expect(sandboxMetaCsp()).not.toContain("asset:");
    expect(directive(sandboxMetaCsp(), "default-src")).toEqual(["'none'"]);
  });
});
