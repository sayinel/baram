// §385 spec 0061 §5.1 — the reverse invariant. Calling executePluginCommand grants prompt
// rights, so only a USER gesture may call it. A third caller (a deep link, a timer) would grant
// rights with no gesture; whoever adds one must change this list and answer that question.
import { readdirSync, readFileSync } from "node:fs";
import { resolve, sep } from "node:path";
import { describe, expect, it } from "vitest";

const SRC = resolve(__dirname, "../..");

function callers(): string[] {
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
    if (
      /\bexecutePluginCommand\(/u.test(
        source.replaceAll("function executePluginCommand(", ""),
      )
    ) {
      found.push(relative);
    }
  }
  return found.sort();
}

describe("who may start a plugin command", () => {
  it("is the command palette and the status bar, and nothing else", () => {
    expect(callers()).toEqual([
      "components/command/CommandPalette.tsx",
      "components/layout/PluginStatusBarItems.tsx",
    ]);
  });
});
