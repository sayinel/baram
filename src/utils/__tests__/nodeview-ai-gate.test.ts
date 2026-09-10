// §339 completeness — every production file that CALLS `showNodeViewAIMenu`
// must gate that call on the AI kill switch (`aiEnabled`).
//
// The story this guards against: `showNodeViewAIMenu` reached 7 production
// call sites (6 NodeViews + TableToolbar), and 6 of the 7 were ungated —
// `aiEnabled === false` still reached `llmComplete`, and the ✨ button still
// rendered. The fix enumerated those 6 call sites BY HAND from a whole-branch
// review; a hand-written list is exactly what the next NodeView escapes
// (§ this repo's own history: "입구 열거가 다섯 번 틀렸다" — five prior
// incidents, every one caught by an EFFECT-based or DERIVED check instead).
//
// So this file does not list the 7 call sites. It finds them by scanning for
// the CALL (`showNodeViewAIMenu(`, with the paren — the plain `import {
// showNodeViewAIMenu }` line has no paren right after the identifier, so it
// is not counted), the same derivation `nodeview-ai-menu-i18n.test.ts` uses
// for the same function's OTHER completeness property (i18n-wrapped labels).
// A new NodeView that adds a ✨ button and forgets to gate it makes THIS
// test fail on its own, without anyone updating a list.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const DEFINITION_FILE = join("src", "utils", "nodeview-ai-menu.ts");

function sources(dir: string, found: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      if (name === "__tests__" || name === "spike") continue;
      sources(path, found);
    } else if (
      (name.endsWith(".ts") || name.endsWith(".tsx")) &&
      !name.endsWith(".test.ts") &&
      !name.endsWith(".test.tsx")
    ) {
      found.push(path);
    }
  }
  return found;
}

/** Production files that CALL `showNodeViewAIMenu` — derived, not listed. */
const consumers = sources("src").filter(
  (path) =>
    path !== DEFINITION_FILE &&
    /\bshowNodeViewAIMenu\s*\(/.test(readFileSync(path, "utf8")),
);

describe("showNodeViewAIMenu call sites gate on aiEnabled", () => {
  it("found the call sites, so the check below is not vacuous", () => {
    // 7 at the time of writing (6 NodeViews + TableToolbar). A floor, not an
    // equality: a new call site should make the NEXT assertion fail on its
    // own merits, not this one.
    expect(consumers.length).toBeGreaterThanOrEqual(7);
    expect(consumers).toContain(
      join("src", "extensions", "nodes", "callout-view.tsx"),
    );
    expect(consumers).toContain(
      join("src", "extensions", "nodes", "mermaid-block-view.tsx"),
    );
    expect(consumers).toContain(
      join("src", "extensions", "nodes", "math-block-view.tsx"),
    );
    expect(consumers).toContain(
      join("src", "extensions", "nodes", "image-view.tsx"),
    );
    expect(consumers).toContain(
      join("src", "extensions", "nodes", "svg-block-view.tsx"),
    );
    expect(consumers).toContain(
      join("src", "extensions", "nodes", "views", "code-block-node-view.ts"),
    );
    expect(consumers).toContain(
      join("src", "components", "toolbar", "TableToolbar.tsx"),
    );
  });

  // ‼️ "mentions aiEnabled" is weaker than "correctly gates the button" — a
  // stray comment would pass this too. That is why it runs ALONGSIDE real
  // render tests (callout-view-ai-gate.test.tsx for a functional NodeView,
  // code-block-node-view-ai-gate.test.ts for the one class-based NodeView),
  // not instead of them: the scan catches an ADDITION (a new call site with
  // no gate at all), the render tests catch a BROKEN gate (present but
  // wired wrong). Neither alone is the guard; together they are.
  it.each(consumers)("%s mentions aiEnabled", (path) => {
    expect(readFileSync(path, "utf8")).toMatch(/\baiEnabled\b/);
  });
});
