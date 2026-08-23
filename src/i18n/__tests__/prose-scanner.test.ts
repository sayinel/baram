// The scanner's own guard. It decides whether two other guards can see anything at all, so its
// failure mode is silence — and silence is indistinguishable from a clean directory.
import { describe, expect, it } from "vitest";

import { scanForProse } from "./prose-scanner";

const NO_KEYS = new Set<string>();

describe("tokenizer", () => {
  it("does not desynchronise on a regex literal containing a backtick", () => {
    // ‼️ The regression that forced a tokenizer. The previous scanner stripped comments and
    // then paired backticks with one regex over the whole file, so the ` inside this character
    // class left an odd number of them — and everything after it was swallowed into one bogus
    // template chunk, including the prose. `JournalDynamicBlock.tsx` really contains this.
    const source = [
      "const a = `x`;",
      "const re = /[*_`[\\]]/g;",
      'const msg = "Delete this entry?";',
      "const b = `y`;",
    ].join("\n");
    expect(scanForProse(source, NO_KEYS).literals).toEqual([
      "Delete this entry?",
    ]);
  });

  it("finds prose after a division that looks like a regex opener", () => {
    const source = 'const half = total / 2;\nconst m = "Nothing here yet.";';
    expect(scanForProse(source, NO_KEYS).literals).toEqual([
      "Nothing here yet.",
    ]);
  });

  it("reads template chunks and drops nested interpolation", () => {
    const source = "const s = `Saved ${n > 1 ? `${n} files` : name} today`;";
    // Both chunks are read — the nested template inside `${…}` does not end the outer one —
    // but only "Saved" is REPORTED: a bare lowercase word is dismissed as an identifier or CSS
    // keyword, which is a known blind spot inherited from the original guard. It is narrow
    // (en labels in this app are capitalised) and the alternative floods the scan with every
    // `overflow`, `nearest` and `polite` in the tree.
    expect(scanForProse(source, NO_KEYS).literals).toEqual(["Saved"]);
  });

  it("treats an apostrophe in JSX prose as text, not as a string opener", () => {
    // A `'` that never closes on its line is not a literal. If it were consumed as one, the
    // rest of the line — the actual prose — would vanish from both scans.
    const source = "<span>Don't lose this line</span>\n";
    expect(scanForProse(source, NO_KEYS).children).toEqual([
      "Don't lose this line",
    ]);
  });

  it("ignores prose inside comments", () => {
    const source = "// Delete this entry?\n/* Are you sure? */\nconst a = 1;";
    expect(scanForProse(source, NO_KEYS)).toEqual({
      children: [],
      literals: [],
    });
  });
});

describe("what counts as prose", () => {
  it.each([
    ["a bare JSX child", "<button>Install</button>"],
    ["a Korean JSX child", "<span>원본 보기</span>"],
    ["a Korean attribute", '<button title="필터" />'],
    [
      "a ternary in an expression",
      '<span>{ok ? "Enabled" : "Disabled"}</span>',
    ],
    ["a template literal", "<span>{`Installed (${n})`}</span>"],
    ["a Korean template chunk", "<span>{`${y}년 ${m}월`}</span>"],
    ["prose as a prop", '<Banner message="Failed to load registry" />'],
    ["a setError argument", 'setError("This plugin is not in the registry.");'],
    ["an array of labels", 'const T = ["Browse", "Installed", "Updates"];'],
    ["a single-quoted attribute", "<b title='Install now' />"],
  ])("catches %s", (_label, source) => {
    const { children, literals } = scanForProse(source, NO_KEYS);
    expect(literals.length + children.length).toBeGreaterThan(0);
  });

  it.each([
    ["a hex colour", 'const c = "#f59e0b";'],
    ["a class list", 'className="plugin-dev-btn plugin-dev-btn--danger"'],
    ["a CSS shorthand", 'padding: "6px 16px"'],
    ["a module path", 'import x from "../../plugins/types";'],
    ["a logger prefix", 'logger.warn("[Marketplace] refresh failed:", err);'],
    ["a CSS custom property name", 'style={{ "--capability-badge-hue": c }}'],
    ["a DOM key name", 'if (e.key === "ArrowLeft" || e.key === "Escape") x();'],
    ["a keybinding chord", 'formatKeyForDisplay("Mod+Enter", true);'],
    ["an interpolation placeholder", 'label.replace("{count}", String(n));'],
    ["a file extension", 'const name = date + ".md";'],
    ["a CSS function split by interpolation", "`repeat(${n}, 10px)`"],
    ["a BCP-47 tag", 'new Intl.DateTimeFormat("ko-KR");'],
    ["an ISO time suffix", 'new Date(day + "T00:00:00");'],
    ["a bare wrapper tag", 'const html = "<p>" + text + "</p>";'],
  ])("does not flag %s", (_label, source) => {
    expect(scanForProse(source, NO_KEYS)).toEqual({
      children: [],
      literals: [],
    });
  });

  it("dismisses a literal that is a known i18n key", () => {
    const keys = new Set(["journal.gallery.title"]);
    expect(scanForProse('t("journal.gallery.title")', keys).literals).toEqual(
      [],
    );
    // …and still reports it when the key does not exist, which is the other half of the bug
    // `label-key-coverage.test.ts` was written for: a key missing from both locales renders
    // itself on screen.
    expect(
      scanForProse('t("journal.gallery.title")', NO_KEYS).literals,
    ).toEqual(["journal.gallery.title"]);
  });
});
