// §29 #824 `indexVersion` is bumped by Rust's `index:changed` (services/index-changes.ts)
// and by nothing a writer does itself: every write command announces its own index
// change once, and a second, unnamed bump from the caller would both refetch Graph and
// Backlinks again and discard the one path #791 needs to recognise a self-save.
//
// Corpus: every production `.ts`/`.tsx` under `src/` (tests excluded) that names the link
// store (`useLinkStore` or its module `stores/editor/link`), scanned for a call of
// `invalidate(`. Files that never name the store are left out because other APIs have an
// `invalidate` of their own (the plugin code-block API's `invalidate(lang)`, §394) that
// bumps nothing. The one other caller is a full rebuild the frontend itself requested
// (`refresh_index` emits no event).
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, posix, relative } from "node:path";
import { describe, expect, it } from "vitest";

const SRC = join(__dirname, "..");

/** Files allowed to bump `indexVersion`, and why. */
const ALLOWED = new Map<string, string>([
  ["services/index-changes.ts", "Rust's index:changed"],
  ["services/vault-context-loader.ts", "after a refresh_index it awaited"],
  ["stores/editor/link.ts", "the store's own definition"],
]);

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      return name === "__tests__" ? [] : files(path);
    }
    return /\.(ts|tsx)$/.test(name) && !/\.test\./.test(name) ? [path] : [];
  });
}

describe("who bumps indexVersion", () => {
  // 이것을 실패시키는 것: 쓰기 경로 하나(예: use-file-tree-crud.ts 의 삭제)에 `invalidate()` 를 되살린다.
  it("is Rust's index:changed, not the writers", () => {
    const callers = files(SRC)
      .filter((f) => {
        const text = readFileSync(f, "utf8");
        return (
          /\buseLinkStore\b|stores\/editor\/link\b/.test(text) &&
          /\binvalidate\(/.test(text)
        );
      })
      .map((f) => relative(SRC, f).split("\\").join(posix.sep))
      .sort();
    // Not vacuous: the listener itself is found.
    expect(callers).toContain("services/index-changes.ts");
    expect(callers.filter((f) => !ALLOWED.has(f))).toEqual([]);
  });
});
