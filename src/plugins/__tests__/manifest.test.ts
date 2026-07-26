// §69 Plugin Manifest validation tests
import { describe, expect, it, test } from "vitest";

import { validateManifest } from "../manifest";

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
});
