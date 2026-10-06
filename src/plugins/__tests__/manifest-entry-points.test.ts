// §391 spec 0070 §4 · §10 (매니페스트) — `menu`, `slash` and the `commands` cap. Every rule has a
// refused row and an accepted row beside it, so a validator that refuses everything fails here
// as surely as one that refuses nothing.
import { describe, expect, it } from "vitest";

import { validateManifest } from "../manifest";

const base = {
  author: "a",
  capabilities: ["commands"],
  description: "d",
  engines: { baram: ">=0.5.0" },
  id: "cite",
  license: "MIT",
  main: "index.mjs",
  name: "Cite",
  trust: "sandboxed",
  version: "1.0.0",
};
const commands = [
  { id: "insert", title: "Insert citation" },
  { id: "pick", title: "Pick a source" },
];
const withContributions = (contributions: Record<string, unknown>) =>
  validateManifest({ ...base, contributions: { commands, ...contributions } });
const fieldsOf = (r: ReturnType<typeof validateManifest>) =>
  r.valid ? [] : r.errors.map((e) => e.field);
const chars = (n: number) => "x".repeat(n);

describe("contributions.menu and contributions.slash (§391)", () => {
  it("accepts well-formed menu and slash entries", () => {
    const r = withContributions({
      menu: [
        { command: "insert", id: "insert" },
        {
          command: "pick",
          id: "pick-sel",
          title: "Pick for the selection",
          when: "selection",
        },
      ],
      slash: [
        {
          command: "insert",
          description: "Insert a citation",
          id: "cite",
          title: "cite",
        },
      ],
    });
    expect(fieldsOf(r)).toEqual([]);
    expect(r.valid).toBe(true);
  });

  it.each(["menu", "slash"])(
    "%s: id and command are required, as ids",
    (section) => {
      const empty = fieldsOf(withContributions({ [section]: [{}] }));
      expect(empty).toContain(`contributions.${section}[0].id`);
      expect(empty).toContain(`contributions.${section}[0].command`);
      for (const id of ["a.b", "a:b", "a b", "", chars(65)]) {
        expect(
          fieldsOf(
            withContributions({ [section]: [{ command: "insert", id }] }),
          ),
          `id ${JSON.stringify(id)} must be refused`,
        ).toContain(`contributions.${section}[0].id`);
      }
      // A dotted command could not be told apart from a namespaced one.
      expect(
        fieldsOf(
          withContributions({ [section]: [{ command: "insert.x", id: "ok" }] }),
        ),
      ).toContain(`contributions.${section}[0].command`);
      // The positive half: the charset's own members pass.
      expect(
        withContributions({ [section]: [{ command: "insert", id: "A_b-9" }] })
          .valid,
      ).toBe(true);
    },
  );

  it.each(["menu", "slash"])(
    "%s: the command must be one this manifest declares",
    (section) => {
      const r = withContributions({
        [section]: [{ command: "nope", id: "x" }],
      });
      expect(r.valid ? [] : r.errors).toContainEqual({
        field: `contributions.${section}[0].command`,
        message: 'no command "nope" is declared in contributions.commands',
      });
      expect(
        withContributions({ [section]: [{ command: "pick", id: "x" }] }).valid,
      ).toBe(true);
    },
  );

  it.each(["menu", "slash"])("%s: an id may appear once", (section) => {
    expect(
      fieldsOf(
        withContributions({
          [section]: [
            { command: "insert", id: "x" },
            { command: "pick", id: "x" },
          ],
        }),
      ),
    ).toContain(`contributions.${section}[1].id`);
    // Two entries may name the same command — only the ids must differ.
    expect(
      withContributions({
        [section]: [
          { command: "insert", id: "x" },
          { command: "insert", id: "y" },
        ],
      }).valid,
    ).toBe(true);
  });

  it.each([
    ["menu", 5],
    ["slash", 10],
  ] as const)("%s: at most %i entries", (section, max) => {
    const list = (n: number) =>
      Array.from({ length: n }, (_, i) => ({ command: "insert", id: `e${i}` }));
    expect(withContributions({ [section]: list(max) }).valid).toBe(true);
    expect(fieldsOf(withContributions({ [section]: list(max + 1) }))).toContain(
      `contributions.${section}`,
    );
  });

  it.each(["menu", "slash"])("%s: a title is 1 to 64 characters", (section) => {
    const entry = (title: unknown) => ({
      [section]: [{ command: "insert", id: "x", title }],
    });
    expect(withContributions(entry(chars(64))).valid).toBe(true);
    for (const title of [chars(65), "", 7]) {
      expect(
        fieldsOf(withContributions(entry(title))),
        `title ${JSON.stringify(title)} must be refused`,
      ).toContain(`contributions.${section}[0].title`);
    }
  });

  it("slash: a description is 1 to 120 characters", () => {
    const entry = (description: unknown) => ({
      slash: [{ command: "insert", description, id: "x" }],
    });
    expect(withContributions(entry(chars(120))).valid).toBe(true);
    for (const description of [chars(121), "", null]) {
      expect(fieldsOf(withContributions(entry(description)))).toContain(
        "contributions.slash[0].description",
      );
    }
  });

  it('menu: `when` is left out or "selection" — nothing else, the empty string included', () => {
    expect(
      withContributions({
        menu: [{ command: "insert", id: "x", when: "selection" }],
      }).valid,
    ).toBe(true);
    expect(
      withContributions({ menu: [{ command: "insert", id: "x" }] }).valid,
    ).toBe(true);
    for (const when of ["", "always", "Selection", true]) {
      expect(
        fieldsOf(
          withContributions({ menu: [{ command: "insert", id: "x", when }] }),
        ),
        `when ${JSON.stringify(when)} must be refused`,
      ).toContain("contributions.menu[0].when");
    }
  });

  it("menu and slash are arrays of objects", () => {
    expect(fieldsOf(withContributions({ menu: "nope" }))).toContain(
      "contributions.menu",
    );
    expect(fieldsOf(withContributions({ slash: [42] }))).toContain(
      "contributions.slash[0]",
    );
  });
});

describe("contributions.commands cap (§391 D11)", () => {
  const many = (n: number) =>
    Array.from({ length: n }, (_, i) => ({ id: `c${i}`, title: `C${i}` }));
  it.each(["sandboxed", "trusted"])(
    "%s: 50 commands pass, 51 are refused",
    (trust) => {
      const at = (n: number) =>
        validateManifest({
          ...base,
          contributions: { commands: many(n) },
          trust,
        });
      expect(at(50).valid).toBe(true);
      expect(fieldsOf(at(51))).toContain("contributions.commands");
    },
  );
});

describe("the status bar keeps the declared-command rule it now shares", () => {
  it("refuses an undeclared status-bar command with the same message", () => {
    const r = withContributions({
      statusBar: [{ command: "nope", id: "s", text: "t" }],
    });
    expect(r.valid ? [] : r.errors).toContainEqual({
      field: "contributions.statusBar[0].command",
      message: 'no command "nope" is declared in contributions.commands',
    });
    expect(
      withContributions({
        statusBar: [{ command: "pick", id: "s", text: "t" }],
      }).valid,
    ).toBe(true);
  });
});
