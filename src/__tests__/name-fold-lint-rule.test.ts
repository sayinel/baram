// §390 spec 0069 D6 — ESLint refuses a bare lowercase in the files that
// compare link names, and points to foldName (src/utils/name-fold.ts). This
// pins the rule's reach: on in each glob, off outside them and in `__tests__`
// directories.
import { ESLint } from "eslint";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = path.resolve(__dirname, "../..");
const PROBE =
  "export function same(a: string, b: string): boolean {\n  return a.toLowerCase() === b.toLocaleLowerCase();\n}\n";

describe("§390 the bare-lowercase rule", () => {
  it("refuses both calls in each glob, leaves the rest alone, and names foldName", async () => {
    const eslint = new ESLint({ cwd: ROOT });
    const lint = async (file: string) => {
      const [result] = await eslint.lintText(PROBE, {
        filePath: path.join(ROOT, file),
      });
      return result.messages.filter(
        (m) => m.ruleId === "no-restricted-properties",
      );
    };

    // What fails this: a glob dropped from eslint.config.js, or one of the
    // two properties.
    for (const file of [
      "src/utils/editor/__probe__.ts",
      "src/utils/editor/nested/__probe__.tsx",
      "src/extensions/plugins/wikilink-__probe__.ts",
      "src/utils/file-search.ts",
    ]) {
      expect(await lint(file), file).toHaveLength(2);
    }

    // The partner: the rule reaches its globs only, and not their `__tests__`
    // directories.
    for (const file of [
      "src/utils/__probe__.ts",
      "src/components/command/__probe__.tsx",
      "src/utils/editor/__tests__/__probe__.test.ts",
    ]) {
      expect(await lint(file), file).toHaveLength(0);
    }

    const [first] = await lint("src/utils/editor/__probe__.ts");
    expect(first.message).toContain("foldName");
  }, 60_000);
});
