// §360 테마 매니페스트 검증 테스트 (스펙 0049 §4)
import { describe, expect, test } from "vitest";

import { validateThemeManifest } from "../theme-manifest";

const validManifest = {
  id: "dracula",
  name: "Dracula",
  description: "A dark theme with vivid accents",
  version: "1.2.0",
  author: "Test Author",
  license: "MIT",
  engines: { baram: ">=0.8.0" },
  modes: {
    light: { tokens: "light/tokens.json", css: "light/theme.css" },
    dark: { tokens: "dark/tokens.json", css: "dark/theme.css" },
  },
};

describe("validateThemeManifest", () => {
  test("accepts a valid manifest with both modes", () => {
    const result = validateThemeManifest(validManifest);
    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.manifest.id).toBe("dracula");
      expect(result.manifest.modes.light?.tokens).toBe("light/tokens.json");
    }
  });

  test("accepts a manifest with only one mode declared", () => {
    const result = validateThemeManifest({
      ...validManifest,
      modes: { dark: { css: "dark/theme.css" } },
    });
    expect(result.valid).toBe(true);
  });

  test("accepts a mode with only tokens (no css)", () => {
    const result = validateThemeManifest({
      ...validManifest,
      modes: { light: { tokens: "light/tokens.json" } },
    });
    expect(result.valid).toBe(true);
  });

  test("accepts a mode with only css (no tokens)", () => {
    const result = validateThemeManifest({
      ...validManifest,
      modes: { light: { css: "light/theme.css" } },
    });
    expect(result.valid).toBe(true);
  });

  test("rejects non-object input", () => {
    const result = validateThemeManifest("not an object");
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors).toEqual([
        { field: "root", message: "manifest must be a JSON object" },
      ]);
    }
  });

  test("rejects null input", () => {
    const result = validateThemeManifest(null);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors[0].field).toBe("root");
    }
  });

  test("rejects array input (typeof array is object)", () => {
    const result = validateThemeManifest([validManifest]);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors[0].field).toBe("root");
    }
  });

  test("rejects a manifest whose serialized size exceeds the 64KB cap", () => {
    const result = validateThemeManifest({
      ...validManifest,
      // license은 필수 문자열 필드일 뿐 별도 상한이 없다 — 전체 직렬화 크기
      // 상한만 걸리도록 여기에 크기를 몰아넣는다.
      license: "x".repeat(70_000),
    });
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors).toEqual([
        { field: "root", message: "manifest exceeds 65536 characters" },
      ]);
    }
  });

  test("rejects missing required fields", () => {
    const result = validateThemeManifest({});
    expect(result.valid).toBe(false);
    if (!result.valid) {
      const fields = result.errors.map((e) => e.field);
      expect(fields).toContain("id");
      expect(fields).toContain("name");
      expect(fields).toContain("description");
      expect(fields).toContain("version");
      expect(fields).toContain("author");
      expect(fields).toContain("license");
      expect(fields).toContain("engines");
      expect(fields).toContain("modes");
    }
  });

  test("rejects invalid id format (uppercase)", () => {
    const result = validateThemeManifest({ ...validManifest, id: "Dracula" });
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(
        result.errors.some(
          (e) => e.field === "id" && e.message.includes("lowercase"),
        ),
      ).toBe(true);
    }
  });

  test("rejects invalid id format (underscore, the contribution-id charset)", () => {
    // §360 트랩: manifest.ts에는 id 정규식이 둘 있고(:48 CONTRIBUTION_ID는 대문자·
    // 언더스코어 허용, :87 플러그인 id는 아니다) 테마는 :87 규칙을 따른다 — 언더스코어는
    // 여기서도 거부되어야 한다.
    const result = validateThemeManifest({
      ...validManifest,
      id: "my_theme",
    });
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(
        result.errors.some(
          (e) => e.field === "id" && e.message.includes("lowercase"),
        ),
      ).toBe(true);
    }
  });

  test("accepts valid id format (lowercase + hyphens + digits)", () => {
    const result = validateThemeManifest({
      ...validManifest,
      id: "my-theme-2",
    });
    expect(result.valid).toBe(true);
  });

  test("rejects a name over the 100-character cap", () => {
    const result = validateThemeManifest({
      ...validManifest,
      name: "x".repeat(101),
    });
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(
        result.errors.some(
          (e) => e.field === "name" && e.message.includes("100"),
        ),
      ).toBe(true);
    }
  });

  test("accepts a name at exactly the 100-character cap", () => {
    const result = validateThemeManifest({
      ...validManifest,
      name: "x".repeat(100),
    });
    expect(result.valid).toBe(true);
  });

  test("rejects a name containing a control character", () => {
    const result = validateThemeManifest({
      ...validManifest,
      name: "Dracula\u0000",
    });
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(
        result.errors.some(
          (e) => e.field === "name" && e.message.includes("control"),
        ),
      ).toBe(true);
    }
  });

  test("rejects a name containing a bidi override character", () => {
    const result = validateThemeManifest({
      ...validManifest,
      // U+202E RIGHT-TO-LEFT OVERRIDE — the exact card-label-spoofing case
      // use-theme-import.ts's regex exists to stop.
      name: "Dracula\u202E",
    });
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(
        result.errors.some(
          (e) => e.field === "name" && e.message.includes("bidi"),
        ),
      ).toBe(true);
    }
  });

  test("rejects a description over the 100-character cap", () => {
    const result = validateThemeManifest({
      ...validManifest,
      description: "x".repeat(101),
    });
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(
        result.errors.some(
          (e) => e.field === "description" && e.message.includes("100"),
        ),
      ).toBe(true);
    }
  });

  test("rejects a description containing a bidi override character", () => {
    const result = validateThemeManifest({
      ...validManifest,
      description: "A theme\u202E",
    });
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(
        result.errors.some(
          (e) => e.field === "description" && e.message.includes("bidi"),
        ),
      ).toBe(true);
    }
  });

  test("rejects missing engines.baram", () => {
    const result = validateThemeManifest({
      ...validManifest,
      engines: {},
    });
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors.some((e) => e.field === "engines.baram")).toBe(true);
    }
  });

  test("rejects a manifest carrying capabilities (plugin-shaped)", () => {
    const result = validateThemeManifest({
      ...validManifest,
      capabilities: ["editor:readonly"],
    });
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(
        result.errors.some(
          (e) => e.field === "capabilities" && e.message.includes("plugin"),
        ),
      ).toBe(true);
    }
  });

  test("rejects a manifest carrying an empty capabilities array (still a plugin shape)", () => {
    const result = validateThemeManifest({
      ...validManifest,
      capabilities: [],
    });
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors.some((e) => e.field === "capabilities")).toBe(true);
    }
  });

  test("rejects a manifest carrying a JS entry point (main)", () => {
    const result = validateThemeManifest({
      ...validManifest,
      main: "index.mjs",
    });
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(
        result.errors.some(
          (e) => e.field === "main" && e.message.includes("plugin"),
        ),
      ).toBe(true);
    }
  });

  test("rejects a manifest with both capabilities and main, as separate errors", () => {
    const result = validateThemeManifest({
      ...validManifest,
      capabilities: ["editor:readonly"],
      main: "index.mjs",
    });
    expect(result.valid).toBe(false);
    if (!result.valid) {
      const fields = result.errors.map((e) => e.field);
      expect(fields).toContain("capabilities");
      expect(fields).toContain("main");
    }
  });

  test("rejects modes that is missing entirely", () => {
    const withoutModes: Record<string, unknown> = { ...validManifest };
    delete withoutModes.modes;
    const result = validateThemeManifest(withoutModes);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(
        result.errors.some(
          (e) => e.field === "modes" && e.message.includes("object"),
        ),
      ).toBe(true);
    }
  });

  test("rejects an empty modes object", () => {
    const result = validateThemeManifest({ ...validManifest, modes: {} });
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(
        result.errors.some(
          (e) =>
            e.field === "modes" &&
            e.message === "modes must declare at least one of light or dark",
        ),
      ).toBe(true);
    }
  });

  test("rejects modes as an array", () => {
    const result = validateThemeManifest({ ...validManifest, modes: [] });
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(
        result.errors.some(
          (e) => e.field === "modes" && e.message.includes("object"),
        ),
      ).toBe(true);
    }
  });

  test("rejects a mode with neither tokens nor css", () => {
    const result = validateThemeManifest({
      ...validManifest,
      modes: { light: {} },
    });
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(
        result.errors.some(
          (e) =>
            e.field === "modes.light" &&
            e.message.includes("at least one of tokens or css"),
        ),
      ).toBe(true);
    }
  });

  test("rejects a mode entry that is not an object", () => {
    const result = validateThemeManifest({
      ...validManifest,
      modes: { light: "light/theme.css" },
    });
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(
        result.errors.some(
          (e) => e.field === "modes.light" && e.message.includes("object"),
        ),
      ).toBe(true);
    }
  });

  test("rejects a mode's tokens field when it is not a string", () => {
    const result = validateThemeManifest({
      ...validManifest,
      modes: { light: { tokens: 42 } },
    });
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors.some((e) => e.field === "modes.light.tokens")).toBe(
        true,
      );
    }
  });

  test("rejects a mode's css field when it is not a string", () => {
    const result = validateThemeManifest({
      ...validManifest,
      modes: { light: { css: 42, tokens: "light/tokens.json" } },
    });
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors.some((e) => e.field === "modes.light.css")).toBe(
        true,
      );
    }
  });

  test("treats an empty-string tokens path as absent (still requires css)", () => {
    const result = validateThemeManifest({
      ...validManifest,
      modes: { light: { tokens: "" } },
    });
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(
        result.errors.some(
          (e) =>
            e.field === "modes.light" &&
            e.message.includes("at least one of tokens or css"),
        ),
      ).toBe(true);
    }
  });

  test("ignores unrecognized keys under modes (not light or dark)", () => {
    // `ThemeManifest.modes` only indexes by `ThemeMode`, so a stray key is inert —
    // it is neither read downstream nor validated here. The manifest must still
    // declare a real light or dark mode to pass.
    const result = validateThemeManifest({
      ...validManifest,
      modes: {
        neon: { tokens: "neon/tokens.json" },
        light: { css: "light/theme.css" },
      },
    });
    expect(result.valid).toBe(true);
  });
});

// ‼️ External review #6 — the validator CHECKED fields and then stored the whole object.
//
// `obj as unknown as ThemeManifest` carried every unnamed key into the record, which
// `partialize` includes and `tauriStorage.setItem` re-serializes and IPCs to `config.json`
// on every settings write, with no debounce and no diff — bounded only by the 64 KiB
// manifest cap. `readModeColors` had already been forced to rebuild rather than cast, by an
// audit BLOCKER its own doc comment names; this is the same rule in the other file.
describe("validateThemeManifest rebuilds rather than casting (external review #6)", () => {
  const valid = () => ({
    author: "a",
    description: "d",
    engines: { baram: ">=0.7.0" },
    id: "dracula",
    license: "MIT",
    modes: { light: { tokens: "light/tokens.json" } },
    name: "Dracula",
    version: "1.0.0",
  });

  it("drops keys nothing validated", () => {
    const result = validateThemeManifest({
      ...valid(),
      author_note: "x".repeat(1000),
      __proto__polluter: { a: 1 },
      nested: { deep: { deeper: [1, 2, 3] } },
    });

    expect(result.valid).toBe(true);
    if (!result.valid) return;
    expect(Object.keys(result.manifest).sort()).toEqual([
      "author",
      "description",
      "engines",
      "id",
      "license",
      "modes",
      "name",
      "version",
    ]);
  });

  it("drops an unknown key from engines, keeping only baram", () => {
    // `engines` is an object the checker only reaches into for one field, so a spread would
    // have carried the rest — the same shape as the top level, one nesting deeper.
    const result = validateThemeManifest({
      ...valid(),
      engines: { baram: ">=0.7.0", node: "22", rider: "x".repeat(500) },
    });
    expect(result.valid).toBe(true);
    if (!result.valid) return;
    expect(Object.keys(result.manifest.engines)).toEqual(["baram"]);
  });

  it("drops an unknown key from a mode", () => {
    const result = validateThemeManifest({
      ...valid(),
      modes: { light: { extra: "x".repeat(500), tokens: "light/tokens.json" } },
    });
    expect(result.valid).toBe(true);
    if (!result.valid) return;
    expect(Object.keys(result.manifest.modes.light ?? {})).toEqual(["tokens"]);
  });

  it("keeps every field that WAS validated, at both modes", () => {
    // The anchor. Without it the rebuild could drop everything and every case above would
    // still pass — and dropping `modes.dark` is the shape that silently turns a paired
    // theme into a single-mode one.
    const result = validateThemeManifest({
      ...valid(),
      modes: {
        dark: { css: "dark/theme.css" },
        light: { css: "light/theme.css", tokens: "light/tokens.json" },
      },
    });
    expect(result.valid).toBe(true);
    if (!result.valid) return;
    expect(result.manifest).toEqual({
      author: "a",
      description: "d",
      engines: { baram: ">=0.7.0" },
      id: "dracula",
      license: "MIT",
      modes: {
        dark: { css: "dark/theme.css" },
        light: { css: "light/theme.css", tokens: "light/tokens.json" },
      },
      name: "Dracula",
      version: "1.0.0",
    });
  });

  it("returns an object that survives a JSON round trip unchanged", () => {
    // What the record is actually subjected to: `partialize` → `JSON.stringify` → IPC. An
    // absent optional must stay absent rather than become `undefined`-valued, or the two
    // spellings would differ across a restart.
    const result = validateThemeManifest(valid());
    expect(result.valid).toBe(true);
    if (!result.valid) return;
    expect(JSON.parse(JSON.stringify(result.manifest))).toEqual(
      result.manifest,
    );
  });
});

describe("§371.1 매니페스트의 dials", () => {
  it("앱이 아는 다이얼의 유효한 값을 남긴다", () => {
    const result = validateThemeManifest({
      ...validManifest,
      dials: { editorLineBreak: "keepAll", editorMaxWidth: 720 },
    });
    expect(result.valid).toBe(true);
    if (!result.valid) return;
    expect(result.manifest.dials).toEqual({
      editorLineBreak: "keepAll",
      editorMaxWidth: 720,
    });
  });

  it("모르는 다이얼 id 를 저장하지 않는다", () => {
    const result = validateThemeManifest({
      ...validManifest,
      dials: { editorMaxWidth: 720, notADial: 1 },
    });
    expect(result.valid).toBe(true);
    if (!result.valid) return;
    expect(result.manifest.dials).toEqual({ editorMaxWidth: 720 });
  });

  it("아는 다이얼이라도 범위 밖·타입 불일치 값을 저장하지 않는다", () => {
    const result = validateThemeManifest({
      ...validManifest,
      dials: {
        editorLineBreak: "nope",
        editorMaxWidth: 999999,
        editorPadding: "4rem",
      },
    });
    expect(result.valid).toBe(true);
    if (!result.valid) return;
    expect(result.manifest.dials).toBeUndefined();
  });

  it("dials 가 객체가 아니면 필드 오류를 낸다", () => {
    const result = validateThemeManifest({ ...validManifest, dials: [] });
    expect(result.valid).toBe(false);
    if (result.valid) return;
    expect(result.errors.map((e) => e.field)).toContain("dials");
  });

  it("dials 가 없는 매니페스트는 그대로 유효하다 (선택 필드)", () => {
    const result = validateThemeManifest(validManifest);
    expect(result.valid).toBe(true);
    if (!result.valid) return;
    expect(result.manifest.dials).toBeUndefined();
  });
});
