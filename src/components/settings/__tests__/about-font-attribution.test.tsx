// §347 — the bundled OFL faces are attributed in the app, and their license
// text ships with the build.
//
// Why this file exists: §347 required both halves and only one was done. The
// two `.txt` copies landed in `src/assets/fonts/`, but `src/assets/` is a Vite
// source directory — nothing referenced them, so the built `dist/` carried
// neither the license nor a notice while both `.woff2` files were present. The
// distributed app was redistributing two OFL-1.1 typefaces with neither, and
// OFL 1.1 §2 conditions redistribution on each copy carrying both (final
// review I2).
//
// ‼️ Every assertion here is DERIVED from `BUNDLED_FONTS`, never from a list
// typed into this file. A third bundled face must not be able to ship without
// its attribution just because nobody remembered to extend a literal here —
// that is the same "enumerated guard misses its next member" shape this branch
// has already been bitten by.
import { fireEvent, render, screen } from "@testing-library/react";
import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/app", () => ({
  getVersion: vi.fn().mockResolvedValue("0.7.1"),
}));

import en from "../../../i18n/en.json";
import ko from "../../../i18n/ko.json";
import { useUIStore } from "../../../stores/ui/ui";
import { BUNDLED_FONTS } from "../../../utils/font/bundled-fonts";
import { BUNDLED_FONT_LICENSES } from "../../../utils/font/font-licenses";
import { AboutModal } from "../AboutModal";

/** The line every OFL 1.1 copy carries — a signature for "this is the license,
 *  not just a copyright line". */
const OFL_HEADING = "SIL OPEN FONT LICENSE Version 1.1";

const FONT_DIR = path.join(process.cwd(), "src/assets/fonts");

beforeEach(() => {
  useUIStore.setState({ aboutOpen: true });
});

afterEach(() => {
  useUIStore.setState({ aboutOpen: false });
});

describe("About modal — bundled font attribution (§347)", () => {
  it("names every bundled family", () => {
    render(<AboutModal />);
    // Non-vacuity: the derivation has to have produced something to look for.
    expect(BUNDLED_FONTS.length).toBeGreaterThan(1);
    for (const { family } of BUNDLED_FONTS) {
      expect(
        screen.getByText(new RegExp(family, "u")),
        `About modal does not name ${family}`,
      ).toBeTruthy();
    }
  });

  it("names the license the bundled faces are under", () => {
    render(<AboutModal />);
    expect(screen.getByText(/SIL Open Font License 1\.1/u)).toBeTruthy();
  });

  // The notice alone does not satisfy OFL 1.1 §2 — the license itself has to
  // travel with the copy. It is reachable, and it is the real text.
  it("reveals the full license text for every bundled family on request", () => {
    render(<AboutModal />);
    expect(screen.queryByText(new RegExp(OFL_HEADING, "u"))).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "View font licenses" }));

    const shown = screen.getAllByText(new RegExp(OFL_HEADING, "u"));
    expect(shown).toHaveLength(BUNDLED_FONTS.length);
  });
});

describe("the license text reaching the bundle is the shipped file (§347)", () => {
  // `?raw` inlines these bytes into the About chunk, and that chunk IS the
  // distributed artifact — so comparing the imported value against the file on
  // disk is what "the license ships" means here. Retyping the text into a
  // constant would have lost the byte-identity with upstream that the vendoring
  // was careful to establish.
  it.each(BUNDLED_FONTS.map((f) => [f.family, f.licenseFile] as const))(
    "%s carries the exact bytes of %s",
    (family, licenseFile) => {
      const onDisk = readFileSync(path.join(FONT_DIR, licenseFile), "utf8");
      const bundled = BUNDLED_FONT_LICENSES.find((l) => l.family === family);
      expect(bundled?.text).toBe(onDisk);
      expect(onDisk).toContain(OFL_HEADING);
    },
  );

  // The `?raw` import paths are the one duplication Vite forces (it requires a
  // static string literal), exactly as `export-font-embed.ts` has for `?url`.
  // Scan the import statements themselves rather than the runtime dictionary's
  // keys: matching keys would still pass if a value pointed at the wrong file.
  it("imports exactly the license files BUNDLED_FONTS names, no more, no fewer", () => {
    const source = readFileSync(
      path.join(process.cwd(), "src/utils/font/font-licenses.ts"),
      "utf8",
    );
    const imported = [...source.matchAll(/from\s+"([^"]+)\?raw"/gu)]
      .map((m) => path.posix.basename(m[1]))
      .sort();
    expect(imported).toEqual(BUNDLED_FONTS.map((f) => f.licenseFile).sort());
  });
});

// `AboutModal.tsx` is in no prose-scan FILES list, so nothing checks that the
// keys it asks for exist — `t()` returns the key itself for one that does not,
// and a typo would render `about.fontLicenses.shwo` on screen with every gate
// green. This is the same gap `font-ui-i18n.test.tsx` closes for the font
// settings UI, applied to the file this change touches.
describe("every about.* key AboutModal asks for resolves", () => {
  const asked = [
    ...readFileSync(
      path.join(process.cwd(), "src/components/settings/AboutModal.tsx"),
      "utf8",
    ).matchAll(/"(about\.[^"]+)"/gu),
  ].map((m) => m[1]);

  it("found the calls, so the checks below are not vacuous", () => {
    expect(asked.length).toBeGreaterThan(5);
  });

  it.each([
    ["en", en as Record<string, string>],
    ["ko", ko as Record<string, string>],
  ])("in %s", (_name, locale) => {
    expect(asked.filter((key) => !(key in locale))).toEqual([]);
  });
});
