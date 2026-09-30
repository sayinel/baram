// §371 6b-2 — `update-registry-index.mjs` 의 테마 모드(스펙 0063 §7.4). 플러그인 모드의 계약은
// `registry-index-script.test.ts` 가 그대로 지킨다 — 이 파일은 `--kind theme` 만 본다.

import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { PREVIEW_COLOR_KEYS } from "../../themes/theme-preview-palette";

const SCRIPT = resolve(__dirname, "../../../scripts/update-registry-index.mjs");
const BASE_URL = "https://sayinel.github.io/baram-plugins/";
const CHECKSUM = "b".repeat(64);

const THEME_MANIFEST = JSON.parse(
  readFileSync(
    resolve(__dirname, "../../../examples/themes/hangul/baram-theme.json"),
    "utf8",
  ),
) as Record<string, unknown>;

const palette = Object.fromEntries(
  PREVIEW_COLOR_KEYS.map((key) => [key, "#123456"]),
);
const PREVIEW = { dark: palette, light: palette };

function run(opts: {
  extra?: string[];
  index?: { plugins: unknown[] };
  manifest?: Record<string, unknown>;
  preview?: unknown;
}): {
  index?: { plugins: Record<string, unknown>[] };
  indexText: string;
  status: null | number;
  stderr: string;
} {
  const dir = mkdtempSync(join(tmpdir(), "baram-registry-theme-"));
  const manifestPath = join(dir, "baram-theme.json");
  const indexPath = join(dir, "index.json");
  const previewPath = join(dir, "preview.json");
  writeFileSync(manifestPath, JSON.stringify(opts.manifest ?? THEME_MANIFEST));
  writeFileSync(indexPath, JSON.stringify(opts.index ?? { plugins: [] }));
  writeFileSync(previewPath, JSON.stringify(opts.preview ?? PREVIEW));
  const result = spawnSync(
    process.execPath,
    [
      SCRIPT,
      "--index",
      indexPath,
      "--manifest",
      manifestPath,
      "--zip-name",
      "baram-hangul-1.0.0.zip",
      "--checksum",
      CHECKSUM,
      "--base-url",
      BASE_URL,
      ...(opts.extra ?? ["--kind", "theme", "--preview", previewPath]),
    ],
    { encoding: "utf8" },
  );
  const indexText = readFileSync(indexPath, "utf8");
  return {
    index:
      result.status === 0
        ? (JSON.parse(indexText) as { plugins: Record<string, unknown>[] })
        : undefined,
    indexText,
    status: result.status,
    stderr: result.stderr,
  };
}

describe("update-registry-index — theme mode (스펙 0063 §7.4)", () => {
  it("kind · 빈 capabilities · 미리보기를 싣고, 등급(trust)은 싣지 않는다", () => {
    const { index, status, stderr } = run({});
    expect(stderr).toBe("");
    expect(status).toBe(0);
    expect(index?.plugins).toEqual([
      {
        author: "Baram",
        capabilities: [],
        checksum: CHECKSUM,
        description: THEME_MANIFEST.description,
        downloadUrl: `${BASE_URL}plugins/baram-hangul-1.0.0.zip`,
        engines: { baram: ">=0.7.7" },
        id: "baram-hangul",
        kind: "theme",
        license: "Apache-2.0",
        name: "Baram Hangul",
        preview: PREVIEW,
        version: "1.0.0",
      },
    ]);
  });

  it("미리보기 없이는 쓰지 않는다", () => {
    const { indexText, status, stderr } = run({ extra: ["--kind", "theme"] });
    expect(status).toBe(1);
    expect(stderr).toContain("--preview");
    expect(indexText).toBe(JSON.stringify({ plugins: [] }));
  });

  it("플러그인 모드의 미리보기는 거부한다 — 앱은 플러그인 항목에서 그것을 버린다", () => {
    const { status, stderr } = run({ extra: ["--preview", "x.json"] });
    expect(status).toBe(1);
    expect(stderr).toContain("--preview is a theme field");
  });

  it("모르는 kind 를 거부한다", () => {
    const { status, stderr } = run({ extra: ["--kind", "themes"] });
    expect(status).toBe(1);
    expect(stderr).toContain("--kind must be one of");
  });

  it("같은 id 의 플러그인 항목을 덮지 않는다 — 반대 방향도", () => {
    const overPlugin = run({
      index: { plugins: [{ id: "baram-hangul", version: "0.1.0" }] },
    });
    expect(overPlugin.status).toBe(1);
    expect(overPlugin.stderr).toContain('listed as kind "plugin"');

    const overTheme = run({
      extra: [],
      index: {
        plugins: [{ id: "baram-hangul", kind: "theme", version: "1.0.0" }],
      },
      manifest: {
        ...THEME_MANIFEST,
        capabilities: ["events"],
        trust: "sandboxed",
      },
    });
    expect(overTheme.status).toBe(1);
    expect(overTheme.stderr).toContain('listed as kind "theme"');
  });

  it("매니페스트에 trust 가 있으면 거부한다 — 플러그인 필드다", () => {
    const { status, stderr } = run({
      manifest: { ...THEME_MANIFEST, trust: "sandboxed" },
    });
    expect(status).toBe(1);
    expect(stderr).toContain("carries no 'trust'");
  });

  it.each([[{}], [{ sepia: palette }], [{ light: "#fff" }], [[palette]]])(
    "미리보기 모양 %j 를 거부한다",
    (preview) => {
      const { status, stderr } = run({ preview });
      expect(status).toBe(1);
      expect(stderr).toContain("--preview must be");
    },
  );

  it("커뮤니티 목록에는 테마를 쓰지 않는다", () => {
    const dir = mkdtempSync(join(tmpdir(), "baram-registry-theme-"));
    const previewPath = join(dir, "preview.json");
    writeFileSync(previewPath, JSON.stringify(PREVIEW));
    const { status, stderr } = run({
      extra: [
        "--kind",
        "theme",
        "--preview",
        previewPath,
        "--publisher",
        "someone",
        "--publisher-id",
        "1",
        "--repo-id",
        "2",
        "--repository",
        "https://github.com/someone/theme",
      ],
    });
    expect(status).toBe(1);
    expect(stderr).toContain("community.json carries plugins only");
  });
});
