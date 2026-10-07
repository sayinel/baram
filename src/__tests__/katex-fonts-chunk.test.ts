// §5.12 issue 799 — the export's KaTeX font copies stay out of `vendor-katex`.
//
// A codeSplitting group claims every module its `test` matches, whoever imports
// it. `vendor-katex` matched `katex/dist/fonts/*.woff2?inline` too, so the 20
// data URIs `export-katex-fonts.ts` inlines rode in that chunk — which
// `math-inline-edit.ts` loads right after startup — instead of in the export
// chunk App.tsx loads lazily. A font no group claims stays with its importer.
// This reads the real config and the real import list, so a font the export
// adds later is checked too.
import type { ConfigEnv, UserConfig } from "vite";

import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

import viteConfig from "../../vite.config";

// Only the config object is read. Under jsdom the plugins fail to load and the
// bare `path` the config imports resolves to a browser polyfill.
vi.mock("@tailwindcss/vite", () => ({ default: () => ({}) }));
vi.mock("@vitejs/plugin-react", () => ({ default: () => ({}) }));
vi.mock("path", async () => await import("node:path"));

interface Group {
  name: string;
  test?: RegExp;
}

async function groups(): Promise<Group[]> {
  const config = await (
    viteConfig as unknown as (env: ConfigEnv) => Promise<UserConfig>
  )({ command: "build", mode: "production" });
  const output = config.build?.rolldownOptions?.output as {
    codeSplitting: { groups: Group[] };
  };
  return output.codeSplitting.groups;
}

/** The module ids the export imports its fonts as, from the file itself. */
function exportFontIds(): string[] {
  const source = readFileSync(
    path.resolve(import.meta.dirname, "../utils/export/export-katex-fonts.ts"),
    "utf8",
  );
  return [...source.matchAll(/from "(katex\/dist\/fonts\/[^"]+)"/g)].map(
    (m) => `/repo/node_modules/${m[1]}`,
  );
}

describe("vite codeSplitting and the export's KaTeX fonts", () => {
  it("reads the export's 20 font imports — the check below is not vacuous", () => {
    expect(exportFontIds()).toHaveLength(20);
  });

  // 이것을 실패시키는 것: `vendor-katex` 의 `test` 를
  // `/[\\/]node_modules[\\/]katex[\\/]/` 로 되돌린다(폰트까지 잡는다).
  it("lets no group claim a font the export inlines", async () => {
    const all = await groups();
    const ids = exportFontIds();
    const windows = ids.map((id) => id.replaceAll("/", "\\"));
    for (const id of [...ids, ...windows]) {
      const claimedBy = all.filter((g) => g.test?.test(id)).map((g) => g.name);
      expect(claimedBy, id).toEqual([]);
    }
  });

  // 위의 빈 결과가 그룹 규칙이 아무것도 못 잡아서가 아님을 보인다.
  it("still puts KaTeX itself in vendor-katex", async () => {
    const katex = (await groups()).find((g) => g.name === "vendor-katex");
    expect(katex?.test?.test("/repo/node_modules/katex/dist/katex.mjs")).toBe(
      true,
    );
    expect(
      katex?.test?.test("C:\\repo\\node_modules\\katex\\dist\\katex.mjs"),
    ).toBe(true);
  });
});
