// §56m A tag's name and the vault tag list merged by name.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { yamlString } from "../../markdown/yaml-scalar";
import { lineHasTag } from "../../tasks/task-tag-token";
import {
  isBodyTagName,
  TAG_PART_CLASS,
  tagEntriesByName,
  tagName,
} from "../tag-name";

describe("tagName", () => {
  it("removes every leading #", () => {
    expect(tagName("#solo")).toBe("solo");
    expect(tagName("##solo")).toBe("solo");
  });

  // Positive partner of the two above: a bare name passes through, and a `#` that does not
  // lead is part of the name.
  it("leaves a bare name and an inner # alone", () => {
    expect(tagName("solo")).toBe("solo");
    expect(tagName("c#/notes")).toBe("c#/notes");
  });

  it("is empty for a spelling made only of #", () => {
    expect(tagName("##")).toBe("");
  });
});

describe("tagEntriesByName", () => {
  // What turns this red: listing the index rows as they come. A front-matter item spelled
  // `"#solo"` is indexed as `#solo`, beside the body's `solo` — one tag shown as two rows,
  // one of them `##solo`.
  it("merges rows whose names differ only by leading #, adding their counts", () => {
    expect(
      tagEntriesByName([
        { count: 3, tag: "solo" },
        { count: 2, tag: "#solo" },
        { count: 1, tag: "##solo" },
      ]),
    ).toEqual([{ count: 6, tag: "solo" }]);
  });

  it("keeps distinct names apart and sorts by count, then name", () => {
    expect(
      tagEntriesByName([
        { count: 1, tag: "b" },
        { count: 1, tag: "#a" },
        { count: 4, tag: "c" },
      ]),
    ).toEqual([
      { count: 4, tag: "c" },
      { count: 1, tag: "a" },
      { count: 1, tag: "b" },
    ]);
  });

  it("drops a row with no name left", () => {
    expect(
      tagEntriesByName([
        { count: 1, tag: "#" },
        { count: 2, tag: "x" },
      ]),
    ).toEqual([{ count: 2, tag: "x" }]);
  });
});

interface NameRow {
  accepted: boolean;
  bare?: string;
  name: string;
  why: string;
}

const { names } = JSON.parse(
  readFileSync(
    join(process.cwd(), "src-tauri/src/tag/fixtures/frontmatter-tags.json"),
    "utf8",
  ),
) as { names: NameRow[] };

describe("isBodyTagName", () => {
  // The fixture's `names` are the rows the backend's rule on `rename_tag` is tested on
  // (`the_new_name_rule_agrees_with_the_shared_fixture`). What turns a row red: an alphabet,
  // a `/` rule, the `-` refusal or the base-character rule other than the backend's.
  it.each(names.map((r) => [r.name, r.accepted, r.why] as const))(
    "%j is accepted: %s (%s)",
    (name, accepted) => {
      expect(isBodyTagName(name)).toBe(accepted);
    },
  );

  // An accepted name is written into a bare front-matter entry as `bare`, the spelling the
  // backend's writer gives it (`frontmatter::yaml_string`) — the frontend's `yamlString`.
  it.each(
    names.filter((r) => r.accepted).map((r) => [r.name, r.bare] as const),
  )("%j is written bare as %j", (name, bare) => {
    expect(yamlString(name)).toBe(bare);
  });

  it("has rows on both sides", () => {
    expect(names.some((r) => r.accepted)).toBe(true);
    expect(names.some((r) => !r.accepted)).toBe(true);
  });

  // The part alphabet is the one the agenda's tag toggle ends a tag at (`task-tag-token.ts`,
  // which reads the backend's `task/fixtures/tag-boundary.json`): a character that continues a
  // tag there is one a name may hold here. Checked over every code point but the surrogates:
  // `lineHasTag` reads the character after a tag as a whole code point.
  it("ends a tag where the agenda's tag toggle does", () => {
    const part = new RegExp(`^(?:${TAG_PART_CLASS}|/)$`, "u");
    const differ: string[] = [];
    for (let cp = 0; cp <= 0x10ffff; cp++) {
      if (cp >= 0xd800 && cp <= 0xdfff) continue;
      const c = String.fromCodePoint(cp);
      if (part.test(c) === lineHasTag(`#x${c}`, "x")) {
        differ.push(cp.toString(16));
      }
    }
    expect(differ).toEqual([]);
  });
});
