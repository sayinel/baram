// §395 spec 0074 D16 · §7 "계획 B" (매니페스트) — `contributions.fileMenu` and the `filetree` capability it
// needs. Every refused row has the accepted row it differs from beside it, so a validator that refuses
// everything fails here as surely as one that refuses nothing.
import { describe, expect, it } from "vitest";

import { validateManifest } from "../manifest";

const base = {
  author: "a",
  capabilities: ["commands", "filetree"],
  description: "d",
  engines: { baram: ">=0.5.0" },
  id: "pins",
  license: "MIT",
  main: "index.mjs",
  name: "Pins",
  trust: "sandboxed",
  version: "1.0.0",
};
const commands = [
  { id: "pin", title: "Pin" },
  { id: "unpin", title: "Unpin" },
];
const item = (id: string, extra: Record<string, unknown> = {}) => ({
  command: "pin",
  id,
  ...extra,
});
const check = (fileMenu: unknown, overrides: Record<string, unknown> = {}) =>
  validateManifest({
    ...base,
    contributions: { commands, fileMenu },
    ...overrides,
  });
const errors = (r: ReturnType<typeof validateManifest>) =>
  r.valid ? [] : r.errors.map((e) => `${e.field}: ${e.message}`);

describe("contributions.fileMenu (§395 D16)", () => {
  /** What fails this: a cap off by one, or a `fileMenu` the validator never reads (six would pass). */
  it("takes five items and refuses six", () => {
    const five = ["a", "b", "c", "d", "e"].map((id) => item(id));
    expect(errors(check(five))).toEqual([]);
    expect(errors(check([...five, item("f")]))).toEqual([
      "contributions.fileMenu: at most 5 fileMenu items may be declared",
    ]);
  });

  /** What fails this: the editor menu's `when` rule reused as it is — `"selection"` would pass, `"file"` fail. */
  it('takes `when` left out, "file" or "folder", and refuses "selection"', () => {
    expect(
      errors(
        check([
          item("a"),
          item("b", { when: "file" }),
          item("c", { when: "folder" }),
        ]),
      ),
    ).toEqual([]);
    expect(errors(check([item("a", { when: "selection" })]))).toEqual([
      'contributions.fileMenu[0].when: when must be left out or be "file" or "folder"',
    ]);
  });

  it("names a declared command, and refuses one the manifest does not declare", () => {
    expect(errors(check([item("a", { command: "unpin" })]))).toEqual([]);
    expect(errors(check([item("a", { command: "missing" })]))).toEqual([
      'contributions.fileMenu[0].command: no command "missing" is declared in contributions.commands',
    ]);
  });

  /** What fails this: the tie missing (an item the install dialog never announced), or tied to one tier only. */
  it.each(["sandboxed", "trusted"])(
    "%s — needs filetree; filetree without fileMenu stays valid",
    (trust) => {
      expect(errors(check([item("a")], { trust }))).toEqual([]);
      expect(
        errors(check([item("a")], { capabilities: ["commands"], trust })),
      ).toEqual([
        'capabilities: contributions.fileMenu needs the "filetree" capability — the install dialog has to be able to say so',
      ]);
      expect(
        errors(
          validateManifest({ ...base, capabilities: ["filetree"], trust }),
        ),
      ).toEqual([]);
    },
  );

  it("shares the editor menu's id, title and duplicate rules", () => {
    expect(errors(check([item("a"), item("a")]))).toEqual([
      'contributions.fileMenu[1].id: duplicate id "a"',
    ]);
    expect(errors(check([item("a b")]))).toEqual([
      'contributions.fileMenu[0].id: contributions.fileMenu[0].id may contain only letters, digits, "_" and "-"',
    ]);
    expect(errors(check([item("a", { title: "x".repeat(64) })]))).toEqual([]);
    expect(errors(check([item("a", { title: "x".repeat(65) })]))).toEqual([
      "contributions.fileMenu[0].title: contributions.fileMenu[0].title must be a string of 1 to 64 characters",
    ]);
  });
});
