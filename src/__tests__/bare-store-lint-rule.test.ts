// issue 267: the lint rule that refuses a bare `useXStore()` call is name-based — it fires on
// a zero-argument call to an identifier matching `use[A-Z]…Store`. That is only a complete
// guard while every Zustand hook in the repo is named that way, so this test pins both
// halves: the rule rejects the bare shapes and accepts the sanctioned ones, and every hook
// created with zustand's `create` carries a name the rule sees.
import { ESLint } from "eslint";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = path.resolve(__dirname, "../..");
const CONFIG = readFileSync(path.join(ROOT, "eslint.config.js"), "utf8");

/** The name pattern as it lands in the config — read from the file so a change to the
 *  selector changes what this test enforces. */
const NAME_PATTERN = ((): RegExp => {
  const m = /callee\.name=\/([^/]+)\//.exec(CONFIG);
  if (!m) throw new Error("bare-store selector not found in eslint.config.js");
  // The config is JavaScript source: `\\w` there is `\w` once the string is cooked.
  return new RegExp(m[1].replace(/\\\\/g, "\\"));
})();

async function bareStoreViolations(code: string): Promise<number> {
  const eslint = new ESLint({ cwd: ROOT });
  const [result] = await eslint.lintText(code, {
    filePath: path.join(ROOT, "src/__bare-store-probe__.tsx"),
  });
  return result.messages.filter((m) => m.ruleId === "no-restricted-syntax")
    .length;
}

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry !== "__tests__" && entry !== "node_modules") walk(full, out);
    } else if (/\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

const HOOK_FACTORIES = new Set(["create", "createWithEqualityFn"]);

/** The bindings a module makes with zustand's hook factories — found by the FACTORY, not by
 *  the binding's name, so a hook named anything at all is reported. Reads every import from
 *  `zustand` or a `zustand/…` subpath (aliases included), then every `const`/`let`/`var`
 *  binding, exported or not, initialised by a call to one of those local names. */
function zustandHookBindings(source: string): string[] {
  const factories = new Set<string>();
  for (const imp of source.matchAll(
    /import\s*\{([^}]*)\}\s*from\s*["']zustand(?:\/[^"']*)?["']/g,
  )) {
    for (const spec of imp[1].split(",")) {
      const m = /^\s*(\w+)(?:\s+as\s+(\w+))?\s*$/.exec(spec);
      if (m && HOOK_FACTORIES.has(m[1])) factories.add(m[2] ?? m[1]);
    }
  }
  if (factories.size === 0) return [];
  const alternation = [...factories].join("|");
  const declaration = new RegExp(
    String.raw`(?:^|[^\w$.])(?:const|let|var)\s+([\w$]+)\s*(?::[^=]+?)?=\s*(?:${alternation})\s*(?:<[^;]*?>\s*)?\(`,
    "g",
  );
  return [...source.matchAll(declaration)].map((m) => m[1]);
}

describe("the bare-store lint rule (issue 267)", () => {
  it("rejects a zero-argument use*Store() call and accepts the sanctioned shapes", async () => {
    expect(
      await bareStoreViolations("const { a } = useUIStore();\nexport { a };\n"),
    ).toBe(1);
    expect(
      await bareStoreViolations(
        "const s = useCaptureShortcutStatusStore();\nexport { s };\n",
      ),
    ).toBe(1);
    expect(
      await bareStoreViolations(
        [
          "const a = useUIStore((s) => s.a);",
          "const b = useUIStore(useShallow((s) => ({ b: s.b })));",
          "const c = useUIStore.getState().c;",
          "export { a, b, c };",
          "",
        ].join("\n"),
      ),
    ).toBe(0);
  }, 30_000);

  it("finds a hook by its factory, whatever the binding is called", () => {
    expect(
      zustandHookBindings(
        [
          'import { create } from "zustand";',
          "export const captureStatus = create<State>()((set) => ({ set }));",
          "const local = create(() => ({}));",
          "",
        ].join("\n"),
      ),
    ).toEqual(["captureStatus", "local"]);
    expect(
      zustandHookBindings(
        [
          'import { createWithEqualityFn as make } from "zustand/traditional";',
          "export const useThingStore = make<State>()(() => ({}), Object.is);",
          "",
        ].join("\n"),
      ),
    ).toEqual(["useThingStore"]);
    // A module that only re-exports a hook, or calls something else named create, adds nothing.
    expect(
      zustandHookBindings(
        'import { create } from "./factory";\nexport const x = create();\n',
      ),
    ).toEqual([]);
  });

  it("sees every Zustand hook: each factory-made binding in src is named use…Store", () => {
    const hooks: string[] = [];
    for (const file of walk(path.join(ROOT, "src"))) {
      hooks.push(...zustandHookBindings(readFileSync(file, "utf8")));
    }
    expect(hooks.length).toBeGreaterThanOrEqual(28);
    expect(hooks.filter((name) => !NAME_PATTERN.test(name))).toEqual([]);
  });
});
