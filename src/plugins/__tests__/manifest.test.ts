// §69 Plugin Manifest validation tests
import { describe, expect, it, test } from "vitest";

import { validateManifest } from "../manifest";
import { MAX_SETTING_FIELDS } from "../plugin-settings";

const validManifest = {
  id: "baram-word-count",
  name: "Word Count",
  description: "Counts words in the document",
  version: "1.0.0",
  author: "Test Author",
  license: "MIT",
  main: "index.mjs",
  engines: { baram: ">=0.2.0" },
  capabilities: ["editor:readonly", "statusbar"],
  trust: "sandboxed",
};

describe("validateManifest", () => {
  test("accepts valid manifest", () => {
    const result = validateManifest(validManifest);
    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.manifest.id).toBe("baram-word-count");
      expect(result.manifest.capabilities).toEqual([
        "editor:readonly",
        "statusbar",
      ]);
    }
  });

  test("accepts manifest with optional fields", () => {
    const result = validateManifest({
      ...validManifest,
      dependencies: ["baram-core-utils"],
      repository: "https://github.com/test/repo",
      homepage: "https://example.com",
      icon: "📊",
      keywords: ["word", "count", "statistics"],
      // NOTE: tiptapExtensions is deliberately NOT here — the fixture is
      // `trust: "sandboxed"`, and §260 3c-2b rejects extensions on that tier (they
      // need the main realm). The trusted-tier case is covered below.
    });
    expect(result.valid).toBe(true);
  });

  test("accepts tiptapExtensions on the trusted tier", () => {
    const result = validateManifest({
      ...validManifest,
      trust: "trusted",
      tiptapExtensions: [
        { type: "plugin", name: "wordCount", exportName: "WordCountExtension" },
      ],
    });
    expect(result.valid).toBe(true);
  });

  test("rejects non-object input", () => {
    const result = validateManifest("not an object");
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors[0].field).toBe("root");
    }
  });

  test("rejects null input", () => {
    const result = validateManifest(null);
    expect(result.valid).toBe(false);
  });

  test("rejects missing required fields", () => {
    const result = validateManifest({});
    expect(result.valid).toBe(false);
    if (!result.valid) {
      const fields = result.errors.map((e) => e.field);
      expect(fields).toContain("id");
      expect(fields).toContain("name");
      expect(fields).toContain("version");
      expect(fields).toContain("main");
      expect(fields).toContain("engines");
    }
  });

  test("rejects invalid id format (uppercase)", () => {
    const result = validateManifest({ ...validManifest, id: "MyPlugin" });
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(
        result.errors.some(
          (e) => e.field === "id" && e.message.includes("lowercase"),
        ),
      ).toBe(true);
    }
  });

  test("rejects invalid id format (underscore)", () => {
    const result = validateManifest({ ...validManifest, id: "my_plugin" });
    expect(result.valid).toBe(false);
  });

  test("accepts valid id format (lowercase + hyphens + digits)", () => {
    const result = validateManifest({ ...validManifest, id: "my-plugin-2" });
    expect(result.valid).toBe(true);
  });

  test("rejects unknown capabilities", () => {
    const result = validateManifest({
      ...validManifest,
      capabilities: ["editor", "dangerous-cap"],
    });
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(
        result.errors.some((e) => e.message.includes("dangerous-cap")),
      ).toBe(true);
    }
  });

  test("accepts all valid capabilities", () => {
    const allCaps = [
      "editor",
      "editor:readonly",
      "files",
      "files:readonly",
      "commands",
      "sidebar",
      "statusbar",
      "settings",
      "events",
      "ai",
      "network",
      "storage",
    ];
    const result = validateManifest({
      ...validManifest,
      capabilities: allCaps,
    });
    expect(result.valid).toBe(true);
  });

  test("rejects missing engines.baram", () => {
    const result = validateManifest({ ...validManifest, engines: {} });
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors.some((e) => e.field === "engines.baram")).toBe(true);
    }
  });

  test("rejects non-array capabilities", () => {
    const result = validateManifest({
      ...validManifest,
      capabilities: "editor",
    });
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors.some((e) => e.field === "capabilities")).toBe(true);
    }
  });

  test("validates tiptapExtensions entries", () => {
    const result = validateManifest({
      ...validManifest,
      tiptapExtensions: [{ type: "invalid", name: "test", exportName: "Test" }],
    });
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(
        result.errors.some(
          (e) =>
            e.field.includes("tiptapExtensions") && e.message.includes("type"),
        ),
      ).toBe(true);
    }
  });

  test("rejects tiptapExtension with missing name", () => {
    const result = validateManifest({
      ...validManifest,
      tiptapExtensions: [{ type: "node", exportName: "Test" }],
    });
    expect(result.valid).toBe(false);
  });

  test("rejects tiptapExtension with missing exportName", () => {
    const result = validateManifest({
      ...validManifest,
      tiptapExtensions: [{ type: "node", name: "test" }],
    });
    expect(result.valid).toBe(false);
  });

  test("collects multiple errors", () => {
    const result = validateManifest({
      id: "INVALID",
      capabilities: ["unknown"],
    });
    expect(result.valid).toBe(false);
    if (!result.valid) {
      // Should have errors for: id format, name, description, version, author, license, main, engines, capabilities
      expect(result.errors.length).toBeGreaterThan(3);
    }
  });
});

describe("validateManifest — trust tier (§260)", () => {
  const base = {
    id: "x",
    name: "X",
    description: "d",
    version: "1.0.0",
    author: "a",
    license: "MIT",
    main: "index.mjs",
    engines: { baram: "*" },
    capabilities: [],
  };

  it("rejects a manifest with no trust field", () => {
    const r = validateManifest(base);
    expect(r.valid).toBe(false);
    if (!r.valid) {
      expect(r.errors.some((e) => e.field === "trust")).toBe(true);
    }
  });

  it("rejects an invalid trust value", () => {
    const r = validateManifest({ ...base, trust: "full" });
    expect(r.valid).toBe(false);
  });

  it("accepts trust=sandboxed and trust=trusted", () => {
    expect(validateManifest({ ...base, trust: "sandboxed" }).valid).toBe(true);
    expect(validateManifest({ ...base, trust: "trusted" }).valid).toBe(true);
  });

  // §260 3c-2b — a sandboxed plugin is imported from a blob URL, which has no base
  // URL, so sibling/relative specifiers inside the bundle cannot resolve. Catch that
  // at install time instead of as a puzzling runtime failure inside the sandbox.
  it("rejects tiptapExtensions on a sandboxed manifest", () => {
    const r = validateManifest({
      ...base,
      trust: "sandboxed",
      tiptapExtensions: [{ type: "node", name: "x", exportName: "X" }],
    });
    expect(r.valid).toBe(false);
    if (!r.valid) {
      expect(r.errors.some((e) => e.field === "tiptapExtensions")).toBe(true);
    }
    // …and the trusted tier, which does run in the main realm, still allows them.
    expect(
      validateManifest({
        ...base,
        trust: "trusted",
        tiptapExtensions: [{ type: "node", name: "x", exportName: "X" }],
      }).valid,
    ).toBe(true);
  });

  it("requires a sandboxed main to be a single relative bundle file", () => {
    for (const main of ["../outside.mjs", "/abs/index.mjs", "./a/../b.mjs"]) {
      const r = validateManifest({ ...base, trust: "sandboxed", main });
      expect(r.valid, `main "${main}" must be rejected`).toBe(false);
      if (!r.valid) {
        expect(r.errors.some((e) => e.field === "main")).toBe(true);
      }
    }
    // A plain entry, and one in a subdirectory, are both fine.
    expect(validateManifest({ ...base, trust: "sandboxed" }).valid).toBe(true);
    expect(
      validateManifest({ ...base, trust: "sandboxed", main: "dist/index.mjs" })
        .valid,
    ).toBe(true);
  });

  it("rejects a non-object contributions field", () => {
    const r = validateManifest({
      ...base,
      trust: "sandboxed",
      contributions: [],
    });
    expect(r.valid).toBe(false);
    if (!r.valid) {
      expect(r.errors.some((e) => e.field === "contributions")).toBe(true);
    }
  });

  // §260 Phase 4a security review (HIGH-2) — the entries, not just the container.
  // `"statusBar": [{}]` used to pass validation and then throw inside the LOADER, after
  // the sandbox had started: no rollback ran, `this.loaded` never got the plugin, and
  // disabling it became a no-op while it kept its capabilities. The loader now rolls
  // back structurally; this stops it at install time, where the author can see it.
  describe("contribution entries (§260 Phase 4a)", () => {
    const sandboxed = (contributions: unknown) =>
      validateManifest({ ...base, contributions, trust: "sandboxed" });
    const fieldsOf = (r: ReturnType<typeof validateManifest>) =>
      r.valid ? [] : r.errors.map((e) => e.field);

    it("accepts a well-formed declaration", () => {
      const r = sandboxed({
        commands: [{ id: "run", palette: false, title: "Run" }],
        statusBar: [
          { command: "run", id: "count", text: "0", tooltip: "recount" },
        ],
      });
      expect(fieldsOf(r)).toEqual([]);
      expect(r.valid).toBe(true);
    });

    it("rejects an entry that is not an object", () => {
      expect(fieldsOf(sandboxed({ statusBar: [{}] }))).toContain(
        "contributions.statusBar[0].id",
      );
      expect(fieldsOf(sandboxed({ statusBar: ["nope"] }))).toContain(
        "contributions.statusBar[0]",
      );
      expect(fieldsOf(sandboxed({ commands: "run" }))).toContain(
        "contributions.commands",
      );
    });

    it("requires the fields the loader dereferences", () => {
      // `text` is the one that threw: `sanitizeStatusBarText(undefined)`.
      expect(fieldsOf(sandboxed({ statusBar: [{ id: "a" }] }))).toContain(
        "contributions.statusBar[0].text",
      );
      expect(
        fieldsOf(sandboxed({ statusBar: [{ id: "a", text: 42 }] })),
      ).toContain("contributions.statusBar[0].text");
      expect(fieldsOf(sandboxed({ commands: [{ id: "a" }] }))).toContain(
        "contributions.commands[0].title",
      );
      expect(
        fieldsOf(
          sandboxed({ commands: [{ id: "a", palette: "yes", title: "A" }] }),
        ),
      ).toContain("contributions.commands[0].palette");
    });

    it("keeps namespaced ids unambiguous", () => {
      // The host builds `${pluginId}.${command}` and `${pluginId}:sb:${item}`; keeping
      // the separators out of the trailing part is what makes those unforgeable.
      for (const id of ["a.b", "a:b", "", "a b", "../x"]) {
        expect(
          fieldsOf(sandboxed({ statusBar: [{ id, text: "t" }] })),
          `id ${JSON.stringify(id)} must be refused`,
        ).toContain("contributions.statusBar[0].id");
      }
      expect(
        fieldsOf(
          sandboxed({ statusBar: [{ command: "a.b", id: "x", text: "t" }] }),
        ),
      ).toContain("contributions.statusBar[0].command");
    });

    it("rejects duplicate ids within a section", () => {
      // Two items with one id become two store entries with the same `itemId`: a
      // duplicate React key, and one `setStatusBarText` driving both.
      expect(
        fieldsOf(
          sandboxed({
            statusBar: [
              { id: "x", text: "a" },
              { id: "x", text: "b" },
            ],
          }),
        ),
      ).toContain("contributions.statusBar[1].id");
      expect(
        fieldsOf(
          sandboxed({
            commands: [
              { id: "run", title: "A" },
              { id: "run", title: "B" },
            ],
          }),
        ),
      ).toContain("contributions.commands[1].id");
      // The same id in DIFFERENT sections is fine — they namespace apart.
      expect(
        sandboxed({
          commands: [{ id: "run", title: "Run" }],
          statusBar: [{ id: "run", text: "x" }],
        }).valid,
      ).toBe(true);
    });

    it("refuses a status-bar item pointing at a command that is not declared", () => {
      // Such an item renders as a button whose handler never exists — a permanently dead
      // control with nothing to explain it (code review NIT-2).
      expect(
        fieldsOf(
          sandboxed({
            commands: [{ id: "run", title: "Run" }],
            statusBar: [{ command: "nope", id: "x", text: "t" }],
          }),
        ),
      ).toContain("contributions.statusBar[0].command");
      // …and accepts one that does.
      expect(
        sandboxed({
          commands: [{ id: "run", title: "Run" }],
          statusBar: [{ command: "run", id: "x", text: "t" }],
        }).valid,
      ).toBe(true);
      // A command-less item is unaffected.
      expect(sandboxed({ statusBar: [{ id: "x", text: "t" }] }).valid).toBe(
        true,
      );
    });

    it("caps how many status-bar items one plugin may declare", () => {
      // Unbounded, a manifest alone could fill the app chrome — no code, and (before
      // MEDIUM-3) no capability either.
      const many = Array.from({ length: 6 }, (_, i) => ({
        id: `i${i}`,
        text: "x",
      }));
      expect(fieldsOf(sandboxed({ statusBar: many }))).toContain(
        "contributions.statusBar",
      );
    });

    it("checks menu as an array of objects without freezing its shape", () => {
      // Still nothing consumes `menu` (4c defers the mapping). Asserting a shape the
      // loader does not read would freeze an unsettled design; leaving it unchecked would
      // repeat the very mistake above the moment something reads it.
      expect(fieldsOf(sandboxed({ menu: "nope" }))).toContain(
        "contributions.menu",
      );
      expect(sandboxed({ menu: [{ anything: true }] }).valid).toBe(true);
    });
  });

  // §260 Phase 4c — `settings` is read now (the form renders it, the resolver keys off
  // it), so this is where its shape is owed. The 4a carry-over, discharged.
  describe("settings fields (§260 Phase 4c)", () => {
    const sandboxed = (contributions: unknown) =>
      validateManifest({ ...base, contributions, trust: "sandboxed" });
    const fieldsOf = (r: ReturnType<typeof validateManifest>) =>
      r.valid ? [] : r.errors.map((e) => e.field);

    it("accepts one field of each type, with and without a default", () => {
      const r = sandboxed({
        settings: [
          { default: true, key: "compact", label: "Compact", type: "boolean" },
          { default: 3, key: "depth", label: "Depth", type: "number" },
          { key: "prefix", label: "Prefix", type: "string" },
        ],
      });
      expect(fieldsOf(r)).toEqual([]);
      expect(r.valid).toBe(true);
    });

    it("requires key, label and a known type", () => {
      expect(fieldsOf(sandboxed({ settings: [{}] }))).toContain(
        "contributions.settings[0].key",
      );
      expect(
        fieldsOf(sandboxed({ settings: [{ key: "a", type: "string" }] })),
      ).toContain("contributions.settings[0].label");
      for (const type of [undefined, "object", "int", 42]) {
        expect(
          fieldsOf(sandboxed({ settings: [{ key: "a", label: "A", type }] })),
          `type ${JSON.stringify(type)} must be refused`,
        ).toContain("contributions.settings[0].type");
      }
    });

    it("keeps a key unambiguous, like every other namespaced id", () => {
      for (const key of ["a.b", "a:b", "", "a b"]) {
        expect(
          fieldsOf(
            sandboxed({ settings: [{ key, label: "A", type: "string" }] }),
          ),
          `key ${JSON.stringify(key)} must be refused`,
        ).toContain("contributions.settings[0].key");
      }
    });

    it("rejects a default whose type contradicts the field", () => {
      // Not merely ignored at read time: the resolver falls back to the type's zero when
      // a default does not match, so `"default": "10"` on a number field would leave the
      // author's stated default nowhere in the running app and no error anywhere.
      expect(
        fieldsOf(
          sandboxed({
            settings: [
              { default: "10", key: "depth", label: "Depth", type: "number" },
            ],
          }),
        ),
      ).toContain("contributions.settings[0].default");
      expect(
        fieldsOf(
          sandboxed({
            settings: [{ default: 1, key: "on", label: "On", type: "boolean" }],
          }),
        ),
      ).toContain("contributions.settings[0].default");
    });

    it("rejects duplicate keys, reported as `key` rather than `id`", () => {
      // One store slot per key: two fields with the same key would render two controls
      // that drive the same value, and the second would silently win on save.
      expect(
        fieldsOf(
          sandboxed({
            settings: [
              { key: "x", label: "A", type: "string" },
              { key: "x", label: "B", type: "number" },
            ],
          }),
        ),
      ).toContain("contributions.settings[1].key");
    });

    it("caps how many fields one plugin may declare", () => {
      // The cap is half of the payload argument: MAX_SETTING_FIELDS × the per-string cap
      // is what decides whether the values can ride a response frame (they cannot).
      const many = Array.from({ length: MAX_SETTING_FIELDS + 1 }, (_, i) => ({
        key: `k${i}`,
        label: "L",
        type: "string",
      }));
      expect(fieldsOf(sandboxed({ settings: many }))).toContain(
        "contributions.settings",
      );
      expect(sandboxed({ settings: many.slice(1) }).valid).toBe(true);
    });
  });
});
