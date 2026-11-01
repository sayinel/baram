// §395 spec 0074 D8 · D9 · D10 · D14 · §5.1 · §7 "합치기" — the store the tree's leaves read: one merged
// decoration per key, in plugin id order, equal results kept as the same object, writes refused whole.
import type { FileDecoration } from "../../types";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  __resetFileDecorations,
  applyDecorations,
  clearDecorations,
  decorationKey,
  dropDecorations,
  moveDecorations,
  releaseDecorations,
  useFileDecorationStore,
} from "../file-decoration-store";
import { __resetFileIcons, defineIcon, iconClassOf } from "../icons";
import { MAX_DECORATED_PATHS } from "../limits";
import { TOO_MANY_PATHS_MESSAGE, undefinedIconMessage } from "../validate";

/** Updates for `applyDecorations`, from (absolute path, decoration) pairs. */
function at(
  ...pairs: [string, FileDecoration | null][]
): { decoration: FileDecoration | null; where: { absolute: string } }[] {
  return pairs.map(([absolute, decoration]) => ({
    decoration,
    where: { absolute },
  }));
}

const merged = (key: string) =>
  useFileDecorationStore.getState().merged.get(key);

afterEach(() => {
  __resetFileDecorations();
  __resetFileIcons();
});

describe("merging (D8)", () => {
  /** What fails this: load order instead of id order (the three writes below run c, a, b), more than
   *  one icon, more than two badges, or a title that drops the plugin whose badge is not drawn. */
  it("merges by plugin id: one icon, two badges, a title line per plugin", () => {
    applyDecorations(
      "c-plug",
      "C",
      at(["/v/a.md", { badge: "3", tooltip: "third" }]),
    );
    applyDecorations(
      "a-plug",
      "A",
      at(["/v/a.md", { badge: "1", icon: { glyph: "★" } }]),
    );
    applyDecorations(
      "b-plug",
      "B",
      at(["/v/a.md", { badge: "2", color: "red", icon: { glyph: "●" } }]),
    );
    expect(merged("/v/a.md")).toEqual({
      badges: [
        { label: "A: 1", text: "1" },
        { color: "var(--color-status-danger)", label: "B: 2", text: "2" },
      ],
      icon: { glyph: "★" },
      title: "A: 1\nB: 2\nC: third",
    });
  });

  it("gives the same result whatever order the plugins wrote in", () => {
    const writes: [string, string, FileDecoration][] = [
      ["a-plug", "A", { badge: "1" }],
      ["b-plug", "B", { icon: { glyph: "●" } }],
      ["c-plug", "C", { tooltip: "c" }],
    ];
    for (const [id, label, decoration] of writes) {
      applyDecorations(id, label, at(["/v/a.md", decoration]));
    }
    const forward = merged("/v/a.md");
    __resetFileDecorations();
    for (const [id, label, decoration] of [...writes].reverse()) {
      applyDecorations(id, label, at(["/v/a.md", decoration]));
    }
    expect(merged("/v/a.md")).toEqual(forward);
  });

  it("titles a plugin by name alone when it set neither tooltip nor badge (P29)", () => {
    applyDecorations("p", "P", at(["/v/a.md", { icon: { glyph: "★" } }]));
    expect(merged("/v/a.md")?.title).toBe("P");
  });

  it("draws a defined svg icon by its class, in the decoration's colour", () => {
    defineIcon("p", "star", "<svg><path d='M0 0'/></svg>");
    applyDecorations(
      "p",
      "P",
      at(["/v/a.md", { color: "#a1b2c3", icon: { svg: "star" } }]),
    );
    expect(merged("/v/a.md")?.icon).toEqual({
      className: iconClassOf("p", "star"),
      color: "#a1b2c3",
    });
  });
});

describe("the equality gate (D9)", () => {
  /** §7 — the same decoration again wakes no subscriber; a different one wakes it once. What fails
   *  this: a `set` on every write. */
  it("does not set when the merged result is unchanged", () => {
    applyDecorations("p", "P", at(["/v/a.md", { badge: "1" }]));
    const listener = vi.fn();
    const stop = useFileDecorationStore.subscribe(listener);
    applyDecorations("p", "P", at(["/v/a.md", { badge: "1" }]));
    expect(listener).toHaveBeenCalledTimes(0);
    applyDecorations("p", "P", at(["/v/a.md", { badge: "2" }]));
    expect(listener).toHaveBeenCalledTimes(1);
    stop();
  });

  /** What fails this: a merge that rebuilds every key — the untouched key's object changes and its
   *  leaf re-renders. */
  it("keeps an untouched key's object identical", () => {
    applyDecorations(
      "p",
      "P",
      at(["/v/a.md", { badge: "1" }], ["/v/b.md", { badge: "1" }]),
    );
    const before = merged("/v/b.md");
    applyDecorations("p", "P", at(["/v/a.md", { badge: "2" }]));
    expect(merged("/v/b.md")).toBe(before);
  });
});

describe("limits and atomicity (D6 · D14 · §6)", () => {
  /** 20,000 paths, then one more refused; removing a path frees its place. What fails this: counting
   *  updates instead of distinct kept paths, or a `null` for an absent path counted as a removal. */
  it("holds 20,000 paths a plugin and refuses the 20,001st", () => {
    const many = Array.from(
      { length: MAX_DECORATED_PATHS },
      (_, i) => [`/v/n${i}.md`, { badge: "1" }] as [string, FileDecoration],
    );
    for (let i = 0; i < many.length; i += 1000) {
      expect(
        applyDecorations("p", "P", at(...many.slice(i, i + 1000))),
      ).toBeNull();
    }
    expect(
      applyDecorations("p", "P", at(["/v/extra.md", { badge: "1" }])),
    ).toBe(TOO_MANY_PATHS_MESSAGE);
    expect(
      applyDecorations(
        "p",
        "P",
        at(["/v/absent.md", null], ["/v/extra.md", { badge: "1" }]),
      ),
    ).toBe(TOO_MANY_PATHS_MESSAGE);
    // Force a re-merge of the refused key through another plugin: a half-applied refusal shows here.
    applyDecorations("q", "Q", at(["/v/extra.md", { tooltip: "q" }]));
    expect(merged("/v/extra.md")?.title).toBe("Q: q");
    expect(
      applyDecorations(
        "p",
        "P",
        at(["/v/n0.md", null], ["/v/extra.md", { badge: "1" }]),
      ),
    ).toBeNull();
  });

  /** What fails this: the first update of a path winning, or `/v/a` and `/v/a/` counted as two paths. */
  it("lets a later update of the same path win, and counts `/v/a` and `/v/a/` once", () => {
    applyDecorations(
      "p",
      "P",
      at(["/v/a", { badge: "1" }], ["/v/a/", { badge: "2" }]),
    );
    expect(useFileDecorationStore.getState().merged.size).toBe(1);
    expect(merged("/v/a")?.badges[0]?.text).toBe("2");
  });

  /** §7 "원자성" — a refused call leaves the store exactly as it was. */
  it("applies nothing from a refused call", () => {
    applyDecorations("p", "P", at(["/v/a.md", { badge: "1" }]));
    const before = useFileDecorationStore.getState().merged;
    expect(
      applyDecorations(
        "p",
        "P",
        at(["/v/a.md", { badge: "2" }], ["/v/b.md", { icon: { svg: "nope" } }]),
      ),
    ).toBe(undefinedIconMessage("nope"));
    expect(useFileDecorationStore.getState().merged).toBe(before);
    // Force a re-merge through another plugin: p's own map must be untouched by the refused call.
    applyDecorations("q", "Q", at(["/v/a.md", { tooltip: "q" }]));
    expect(merged("/v/a.md")?.title).toBe("P: 1\nQ: q");
    expect(merged("/v/b.md")).toBeUndefined();
  });
});

describe("keys (D7)", () => {
  it("folds backslashes and drops a trailing separator", () => {
    expect(decorationKey("C:\\v\\a.md")).toBe("C:/v/a.md");
    expect(decorationKey("/v/dir/")).toBe("/v/dir");
  });
});

describe("following the app (D10)", () => {
  /** What fails this: a move of the exact key only (the folder's children stay behind), or a prefix
   *  without the separator (`/v/ab.md` moves with `/v/a`). */
  it("moves a folder's keys and leaves a sibling with the same prefix", () => {
    applyDecorations(
      "p",
      "P",
      at(
        ["/v/a", { badge: "F" }],
        ["/v/a/x.md", { badge: "1" }],
        ["/v/ab.md", { badge: "2" }],
      ),
    );
    moveDecorations("/v/a", "/v/b", true);
    expect(merged("/v/b")?.badges[0]?.text).toBe("F");
    expect(merged("/v/b/x.md")?.badges[0]?.text).toBe("1");
    expect(merged("/v/a/x.md")).toBeUndefined();
    expect(merged("/v/a")).toBeUndefined();
    expect(merged("/v/ab.md")?.badges[0]?.text).toBe("2");
  });

  it("leaves a sibling with the same prefix when a file moves, and keeps a self-move", () => {
    applyDecorations(
      "p",
      "P",
      at(["/v/a.md", { badge: "1" }], ["/v/a.md2", { badge: "2" }]),
    );
    moveDecorations("/v/a.md", "/v/b.md", false);
    expect(merged("/v/b.md")?.badges[0]?.text).toBe("1");
    expect(merged("/v/a.md2")?.badges[0]?.text).toBe("2");
    moveDecorations("C:\\v\\b.md", "C:/v/b.md", false);
    applyDecorations("p", "P", at(["C:/v/b.md", { badge: "3" }]));
    moveDecorations("C:\\v\\b.md", "C:/v/b.md", false);
    expect(merged("C:/v/b.md")?.badges[0]?.text).toBe("3");
  });

  /** D10 — a key left at the destination by a change outside the app is cleared first. What fails
   *  this: the stale decoration of plugin q would sit on the moved file. */
  it("clears the destination before moving (P30)", () => {
    applyDecorations(
      "q",
      "Q",
      at(
        ["/v/new.md", { badge: "x" }],
        ["/v/new.md/stale", { badge: "y" }],
        ["/v/new.md2", { badge: "z" }],
      ),
    );
    applyDecorations("p", "P", at(["/v/old.md", { badge: "1" }]));
    moveDecorations("/v/old.md", "/v/new.md", false);
    expect(merged("/v/new.md")?.title).toBe("P: 1");
    expect(merged("/v/new.md/stale")).toBeUndefined();
    expect(merged("/v/new.md2")?.title).toBe("Q: z");
    expect(merged("/v/old.md")).toBeUndefined();
  });

  it("drops a file's key, or a folder's keys", () => {
    applyDecorations(
      "p",
      "P",
      at(
        ["/v/a", { badge: "F" }],
        ["/v/a/x.md", { badge: "1" }],
        ["/v/b.md", { badge: "2" }],
      ),
    );
    dropDecorations("/v/b.md", false);
    expect(merged("/v/b.md")).toBeUndefined();
    dropDecorations("/v/a", false);
    expect(merged("/v/a")).toBeUndefined();
    expect(merged("/v/a/x.md")?.badges[0]?.text).toBe("1");
    dropDecorations("/v/a", true);
    expect(useFileDecorationStore.getState().merged.size).toBe(0);
  });

  it("clears a plugin's decorations, and releases them", () => {
    applyDecorations("p", "P", at(["/v/a.md", { badge: "1" }]));
    applyDecorations("q", "Q", at(["/v/a.md", { badge: "2" }]));
    clearDecorations("p");
    expect(merged("/v/a.md")?.title).toBe("Q: 2");
    releaseDecorations("q");
    expect(merged("/v/a.md")).toBeUndefined();
  });
});
