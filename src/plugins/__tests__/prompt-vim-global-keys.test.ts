// §385 spec 0061 §8 (vim) — Esc in a plugin prompt reaches the prompt. The prompt's input sits
// in an overlay appended to `<body>` (`show-plugin-prompt.tsx`), outside the editor, so vim's
// editor keymap never sees the key; vim could still take it first only from a `keydown`
// listener on an ancestor of that overlay. Spec §8 claims vim has none on `window` or
// `document`; this pins that, and `<body>`/`<html>` reached as `document.body`/
// `document.documentElement` with it.
//
// Corpus: production `.ts`/`.tsx` files under `src/` (recursive, any `__tests__/` directory
// excluded) that are either under `src/extensions/plugins/vim` or have `vim` in their basename,
// case-insensitive. That is the discovery rule `scripts/check-wiki.mjs` uses for vim-owned
// files (its tiers A and B), except that `src/spike/` is not excluded here — so a new
// `vim-*.ts` anywhere joins without an edit to this file.
//
// The match is on source TEXT: `.addEventListener(` called directly on `window`, `document`,
// `document.body` or `document.documentElement`, whose first argument is the string literal
// `"keydown"` or `'keydown'`, whitespace and newlines allowed inside the parentheses. It does
// not see: optional chaining (`window?.addEventListener`); `document.defaultView`; a line break
// before `.addEventListener`; a template-literal or variable event name; a listener added
// through a variable holding one of those targets (`view.dom.ownerDocument` included) or
// through `globalThis`; or an `onkeydown` property.
import { readdirSync, readFileSync } from "node:fs";
import { resolve, sep } from "node:path";
import { describe, expect, it } from "vitest";

const SRC = resolve(__dirname, "../..");
const VIM_DIR = "extensions/plugins/vim/";
const GLOBAL_KEYDOWN =
  /\b(?:window|document(?:\.body|\.documentElement)?)\.addEventListener\(\s*["']keydown["']/u;

/** Every production file vim owns — its directory, or `vim` in the basename — relative to `src/`, sorted. */
function vimProductionFiles(): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(SRC, {
    recursive: true,
    withFileTypes: true,
  })) {
    if (!entry.isFile() || !/\.tsx?$/u.test(entry.name)) continue;
    const relative = resolve(entry.parentPath, entry.name)
      .slice(SRC.length + 1)
      .split(sep)
      .join("/");
    if (relative.includes("__tests__/")) continue;
    if (relative.startsWith(VIM_DIR) || /vim/iu.test(entry.name)) {
      found.push(relative);
    }
  }
  return found.sort();
}

describe("vim's global keys", () => {
  it("registers no keydown listener on window, document, <body> or <html>", () => {
    const files = vimProductionFiles();
    // Both halves of the corpus are non-empty: the directory is where this file thinks it is,
    // and the basename rule reaches past it.
    expect(files.some((f) => f.startsWith(VIM_DIR))).toBe(true);
    expect(files.some((f) => !f.startsWith(VIM_DIR))).toBe(true);
    const offenders = files.filter((relative) =>
      GLOBAL_KEYDOWN.test(readFileSync(resolve(SRC, relative), "utf8")),
    );
    expect(offenders).toEqual([]);
  });

  it("matches the shapes it claims to, across a line break", () => {
    // The positive twin: an empty result above means something only if this pattern can match.
    for (const shape of [
      'window.addEventListener("keydown", f, true)',
      "document.addEventListener(\n  'keydown',\n  f,\n)",
      'document.body.addEventListener("keydown", f)',
      'document.documentElement.addEventListener("keydown", f)',
    ]) {
      expect(GLOBAL_KEYDOWN.test(shape)).toBe(true);
    }
    expect(GLOBAL_KEYDOWN.test('window.addEventListener("keyup", f)')).toBe(
      false,
    );
  });
});
