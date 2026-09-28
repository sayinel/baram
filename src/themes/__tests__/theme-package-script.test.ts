// §371 6b-2 — `scripts/theme-package.ts`: 게시 zip 을 만드는 함수와 그 zip 을 다시 읽는 함수.
// 스펙 0063 §7.3 · §7.5. 워크플로 없이 여기서 돈다 — 워크플로의 두 단계는 이 함수를 부르는
// CLI(`run-theme-package.ts`)일 뿐이다.

import { Uint8ArrayReader, Uint8ArrayWriter, ZipWriter } from "@zip.js/zip.js";
import { createHash } from "node:crypto";
import {
  cpSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

import {
  packageTheme,
  releaseFloorProblem,
  verifyThemeArchive,
} from "../../../scripts/theme-package";
import { PREVIEW_COLOR_KEYS } from "../theme-preview-palette";

const HANGUL = resolve(__dirname, "../../../examples/themes/hangul");
const OK = { appVersion: "0.7.7", version: "1.0.0" };

/** 원본 폴더를 임시 폴더로 복사해, 테스트마다 한 가지만 망가뜨린다. */
function copyOfHangul(): string {
  const dir = mkdtempSync(join(tmpdir(), "baram-theme-pkg-"));
  cpSync(HANGUL, dir, { recursive: true });
  return dir;
}

function editManifest(dir: string, edit: (m: Record<string, unknown>) => void) {
  const path = join(dir, "baram-theme.json");
  const manifest = JSON.parse(readFileSync(path, "utf8")) as Record<
    string,
    unknown
  >;
  edit(manifest);
  writeFileSync(path, JSON.stringify(manifest));
}

const sha = (bytes: Uint8Array) =>
  createHash("sha256").update(bytes).digest("hex");

describe("packageTheme (스펙 0063 §7.3)", () => {
  it("매니페스트와 매니페스트가 선언한 토큰 둘만 묶는다 — README 는 들어가지 않는다", async () => {
    const result = await packageTheme(HANGUL, OK);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.files).toEqual([
      "baram-theme.json",
      "light/tokens.json",
      "dark/tokens.json",
    ]);
    expect(result.zipName).toBe("baram-hangul-1.0.0.zip");
  });

  // 무엇이 이것을 실패시키는가: zip 에 파일 시각이나 압축 수준이 스며들면. 그러면 로컬에서
  // 점검한 zip 과 게시된 zip 이 다른 바이트가 되고, §7.5 의 "레지스트리로 나갈 바로 그 파일" 이
  // 거짓이 된다.
  it("같은 원본은 같은 바이트가 된다", async () => {
    const a = await packageTheme(HANGUL, OK);
    const dir = copyOfHangul(); // 복사는 파일 시각을 새로 찍는다
    const b = await packageTheme(dir, OK);
    expect(a.ok && b.ok).toBe(true);
    if (!a.ok || !b.ok) return;
    expect(sha(b.bytes)).toBe(sha(a.bytes));
  });

  it("태그 버전이 매니페스트 버전과 다르면 거부한다", async () => {
    const result = await packageTheme(HANGUL, { ...OK, version: "1.0.1" });
    expect(result).toMatchObject({ ok: false });
    if (result.ok) return;
    expect(result.error).toContain(
      "tag version 1.0.1 != manifest version 1.0.0",
    );
  });

  it("앱이 하한보다 낮으면 거부한다 — 먼저 릴리스할 것", async () => {
    const result = await packageTheme(HANGUL, { ...OK, appVersion: "0.7.6" });
    expect(result).toMatchObject({ ok: false });
    if (result.ok) return;
    expect(result.error).toContain("release the app first");
  });

  it("CSS 를 선언한 테마는 거부한다", async () => {
    const dir = copyOfHangul();
    writeFileSync(join(dir, "light/theme.css"), ":root{}");
    editManifest(dir, (m) => {
      (m.modes as Record<string, Record<string, string>>).light.css =
        "light/theme.css";
    });
    const result = await packageTheme(dir, OK);
    expect(result).toMatchObject({ ok: false });
    if (result.ok) return;
    expect(result.error).toContain("modes.light.css is declared");
  });

  it.each([
    ["../../package.json"],
    ["/etc/hosts"],
    ["light/./tokens.json"],
    ["light\\tokens.json"],
  ])("폴더 밖이나 모호한 경로 %s 를 거부한다", async (path) => {
    const dir = copyOfHangul();
    editManifest(dir, (m) => {
      (m.modes as Record<string, Record<string, string>>).light.tokens = path;
    });
    const result = await packageTheme(dir, OK);
    expect(result).toMatchObject({ ok: false });
    if (result.ok) return;
    expect(result.error).toContain("modes.light.tokens");
  });

  it("심볼릭 링크를 따라가지 않는다", async () => {
    const dir = copyOfHangul();
    unlinkSync(join(dir, "light/tokens.json"));
    symlinkSync(
      join(HANGUL, "light/tokens.json"),
      join(dir, "light/tokens.json"),
    );
    const result = await packageTheme(dir, OK);
    expect(result).toMatchObject({ ok: false });
    if (result.ok) return;
    expect(result.error).toContain("not a regular file");
  });

  it("링크된 디렉터리 너머의 파일도 읽지 않는다", async () => {
    const dir = copyOfHangul();
    const outside = mkdtempSync(join(tmpdir(), "baram-theme-outside-"));
    cpSync(join(dir, "light"), outside, { recursive: true });
    rmSync(join(dir, "light"), { recursive: true });
    symlinkSync(outside, join(dir, "light"));
    const result = await packageTheme(dir, OK);
    expect(result).toMatchObject({ ok: false });
    if (result.ok) return;
    expect(result.error).toContain("through a linked directory");
  });

  it("시드 키가 빠진 토큰은 거부한다 — 앱은 그 모드를 색 없이 설치한다", async () => {
    const dir = copyOfHangul();
    const path = join(dir, "dark/tokens.json");
    const tokens = JSON.parse(readFileSync(path, "utf8")) as Record<
      string,
      string
    >;
    delete tokens["--color-accent-default"];
    writeFileSync(path, JSON.stringify(tokens));
    const result = await packageTheme(dir, OK);
    expect(result).toMatchObject({ ok: false });
    if (result.ok) return;
    expect(result.error).toContain("--color-accent-default");
  });

  it("내장 테마의 id 는 거부한다", async () => {
    const dir = copyOfHangul();
    editManifest(dir, (m) => {
      m.id = "nord";
    });
    const result = await packageTheme(dir, OK);
    expect(result).toMatchObject({ ok: false });
    if (result.ok) return;
    expect(result.error).toContain("reserved");
  });
});

describe("releaseFloorProblem — 닫힌 방향으로 실패한다", () => {
  it.each([
    ["0.7.7", ">=0.7.7", null],
    ["0.8.0", ">=0.7.7", null],
    ["0.7.6", ">=0.7.7", "release the app first"],
    ["0.7.7-beta.1", ">=0.7.7", "not a plain release version"],
    ["0.7.7", "^0.7.7", 'must be of the form ">=X.Y.Z"'],
  ])("앱 %s · 하한 %s", (app, range, expected) => {
    const problem = releaseFloorProblem(app, range);
    if (expected === null) expect(problem).toBeNull();
    else expect(problem).toContain(expected);
  });
});

async function zipOf(
  files: Record<string, string | Uint8Array>,
): Promise<Uint8Array> {
  const writer = new ZipWriter(new Uint8ArrayWriter());
  for (const [name, body] of Object.entries(files)) {
    await writer.add(
      name,
      new Uint8ArrayReader(
        typeof body === "string" ? new TextEncoder().encode(body) : body,
      ),
    );
  }
  return writer.close();
}

const hangulFile = (path: string) => readFileSync(join(HANGUL, path));

describe("verifyThemeArchive (스펙 0063 §7.3 — 묶인 zip 을 다시 검증)", () => {
  const expected = { id: "baram-hangul", version: "1.0.0" };

  it("만든 zip 을 통과시키고, 두 모드의 미리보기를 계약의 16키로 꺼낸다", async () => {
    const packaged = await packageTheme(HANGUL, OK);
    expect(packaged.ok).toBe(true);
    if (!packaged.ok) return;
    const result = await verifyThemeArchive(packaged.bytes, expected);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(Object.keys(result.preview).sort()).toEqual(["dark", "light"]);
    expect(Object.keys(result.preview.light ?? {}).sort()).toEqual(
      [...PREVIEW_COLOR_KEYS].sort(),
    );
    expect(result.preview.light?.["--color-accent-default"]).toBe("#2f4f86");
    expect(result.preview.dark?.["--color-accent-default"]).toBe("#8ea8dc");
  });

  it("매니페스트가 선언하지 않은 파일이 끼어 있으면 거부한다", async () => {
    const bytes = await zipOf({
      "baram-theme.json": hangulFile("baram-theme.json"),
      "light/tokens.json": hangulFile("light/tokens.json"),
      "dark/tokens.json": hangulFile("dark/tokens.json"),
      "README.md": "# extra",
    });
    const result = await verifyThemeArchive(bytes, expected);
    expect(result).toMatchObject({ ok: false });
    if (result.ok) return;
    expect(result.error).toContain("but the manifest declares");
  });

  it("선언한 토큰이 빠져 있으면 거부한다", async () => {
    const bytes = await zipOf({
      "baram-theme.json": hangulFile("baram-theme.json"),
      "light/tokens.json": hangulFile("light/tokens.json"),
    });
    const result = await verifyThemeArchive(bytes, expected);
    expect(result).toMatchObject({ ok: false });
  });

  it("검증한 것과 다른 id · 버전이면 거부한다", async () => {
    const packaged = await packageTheme(HANGUL, OK);
    if (!packaged.ok) throw new Error(packaged.error);
    const otherId = await verifyThemeArchive(packaged.bytes, {
      ...expected,
      id: "baram-other",
    });
    expect(otherId).toMatchObject({ ok: false });
    const otherVersion = await verifyThemeArchive(packaged.bytes, {
      ...expected,
      version: "1.0.1",
    });
    expect(otherVersion).toMatchObject({ ok: false });
  });

  it("zip 이 아닌 바이트를 거부한다", async () => {
    const result = await verifyThemeArchive(
      new TextEncoder().encode("not a zip"),
      expected,
    );
    expect(result).toMatchObject({ ok: false });
  });
});
