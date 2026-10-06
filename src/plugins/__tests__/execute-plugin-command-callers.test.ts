// §385 spec 0061 §5.1 — the reverse invariant. Calling executePluginCommand grants prompt
// rights, so only a USER gesture may call it. Another caller (a deep link, a timer) would grant
// rights with no gesture; whoever adds one must change this list and answer that question.
//
// Corpus for every scan below: production `.ts`/`.tsx` files under `src/`, with any
// `__tests__/` directory excluded. A regex over file TEXT cannot see value-passing — a
// `{ run: executePluginCommand }` handed to something else, or `beginPluginInvocation` reached
// through a re-exported alias — so a caller hidden that way is outside what these scans see.
import { readdirSync, readFileSync } from "node:fs";
import { resolve, sep } from "node:path";
import { describe, expect, it } from "vitest";

const SRC = resolve(__dirname, "../..");

function aliasedExecuteImports(): string[] {
  return scanProductionFiles((source) =>
    /executePluginCommand as /u.test(source),
  );
}

function beginInvocationCallSites(): string[] {
  return scanProductionFiles((source) =>
    /\bbeginPluginInvocation\(/u.test(
      source.replaceAll("function beginPluginInvocation(", ""),
    ),
  );
}

function callers(): string[] {
  return scanProductionFiles((source) =>
    /\bexecutePluginCommand\(/u.test(
      source.replaceAll("function executePluginCommand(", ""),
    ),
  );
}

/**
 * §385 — `showPluginPrompt` draws the window WITHOUT checking the gate itself (that is
 * `prompts-api.ts`'s job, before it ever calls this). A second caller could draw a prompt with
 * none of the refusal order, the limits or the sanitising in front of it.
 */
function showPluginPromptCallers(): string[] {
  return scanProductionFiles((source) =>
    /\bshowPluginPrompt\(/u.test(
      source.replaceAll("function showPluginPrompt(", ""),
    ),
  );
}

/** Every production file under `SRC` whose source text satisfies `matches`, relative and sorted. */
function scanProductionFiles(matches: (source: string) => boolean): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(SRC, {
    recursive: true,
    withFileTypes: true,
  })) {
    if (!entry.isFile() || !/\.tsx?$/u.test(entry.name)) continue;
    const path = resolve(entry.parentPath, entry.name);
    const relative = path
      .slice(SRC.length + 1)
      .split(sep)
      .join("/");
    if (relative.includes("__tests__/")) continue;
    const source = readFileSync(path, "utf8");
    if (matches(source)) found.push(relative);
  }
  return found.sort();
}

describe("who may start a plugin command", () => {
  it("is the command palette, the status bar and the §391 entry points, and nothing else", () => {
    expect(callers()).toEqual([
      "components/command/CommandPalette.tsx",
      "components/layout/PluginStatusBarItems.tsx",
      "components/toolbar/context-menu-plugins.ts",
    ]);
  });

  it("grants rights only through the primitive in plugin-host-registry.ts", () => {
    // `beginPluginInvocation` is what actually grants prompt rights; `executePluginCommand`
    // is the one gesture-gated caller of it today, but this is the invariant that matters —
    // a new direct call site anywhere else grants rights outside a user gesture.
    expect(beginInvocationCallSites()).toEqual([
      "plugins/plugin-host-registry.ts",
    ]);
  });

  it("has no aliased import that would hide a caller from the scan", () => {
    expect(aliasedExecuteImports()).toEqual([]);
  });

  it("draws a plugin prompt only through prompts-api.ts", () => {
    expect(showPluginPromptCallers()).toEqual(["plugins/prompts-api.ts"]);
  });
});
