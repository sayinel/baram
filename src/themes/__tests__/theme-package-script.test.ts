// §371 6b-2 — `scripts/theme-package.ts`: 게시 zip 을 만드는 함수와 그 zip 을 다시 읽는 함수.
// 스펙 0063 §7.3 · §7.5. 워크플로 없이 여기서 돈다 — 워크플로의 두 단계는 이 함수를 부르는
// CLI(`run-theme-package.ts`)일 뿐이다.

import {
  Uint8ArrayReader,
  Uint8ArrayWriter,
  ZipReader,
  ZipWriter,
} from "@zip.js/zip.js";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  cpSync,
  existsSync,
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
import { MAX_THEME_TOKENS_BYTES } from "../theme-store-fs";

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

  // 무엇이 이것을 실패시키는가: `packageTheme` 의 `ZipWriter` 옵션 가운데 바이트를 고정하는 셋 —
  // `level: 0`(무압축), `lastModDate: ZIP_DATE`(고정 시각), `extendedTimestamp: false` — 중 하나가
  // 빠지거나 뒤집히면. 그러면 로컬에서 점검한 zip 과 게시된 zip 이 다른 바이트가 되고, §7.5 의
  // "레지스트리로 나갈 바로 그 파일" 이 거짓이 된다.
  // ‼️ 두 번 묶어 sha256 을 비교하는 첫 단언은 이 셋을 잡지 못한다 — 2026-09-29 에 셋을 하나씩
  // 바꿔 이 케이스를 돌렸을 때(`level: 9` · `lastModDate` 삭제 · `extendedTimestamp: true`) 그 단언만
  // 있던 케이스는 셋 다 초록이었다. 한 프로세스 안의 두 번은 같은 zlib 으로 압축하고, 같은 시간대에서
  // 적고, 시각을 빼면 대신 적히는 묶은 시각은 DOS 시각이 2초 단위라 연달아 묶은 두 번에서 대개
  // 같다. 그래서 다시 읽은 항목마다 세 옵션의 결과를 직접 본다: 압축 방식 0(stored) · 수정 시각
  // 2020-01-01 12:00 로컬 · 확장 타임스탬프 extra field(`0x5455`) 없음. 셋째는 시각을 UTC 로 따로
  // 적어서, 켜면 로컬 생성자로 만든 같은 `ZIP_DATE` 가 시간대마다 다른 바이트가 된다(2026-09-29
  // 실측: `TZ` 를 UTC · America/Los_Angeles · Asia/Seoul 로 두고 묶은 zip 의 sha256 셋이 서로
  // 달랐다 — 끄면 셋이 같았다).
  it("같은 원본은 같은 바이트가 된다", async () => {
    const a = await packageTheme(HANGUL, OK);
    const dir = copyOfHangul(); // 복사는 파일 시각을 새로 찍는다
    const b = await packageTheme(dir, OK);
    expect(a.ok && b.ok).toBe(true);
    if (!a.ok || !b.ok) return;
    expect(sha(b.bytes)).toBe(sha(a.bytes));

    const reader = new ZipReader(new Uint8ArrayReader(a.bytes));
    const entries = await reader.getEntries();
    await reader.close();
    // 아래 반복이 공허하지 않다 — 묶은 세 파일이 모두 읽힌다.
    expect(entries.map((entry) => entry.filename)).toEqual([...a.files]);
    const fixed = new Date(2020, 0, 1, 12, 0, 0).getTime();
    for (const entry of entries) {
      expect(entry.compressionMethod, entry.filename).toBe(0);
      expect(entry.lastModDate.getTime(), entry.filename).toBe(fixed);
      expect(entry.extraField?.has(0x5455) ?? false, entry.filename).toBe(
        false,
      );
    }
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

  // 무엇이 이것을 실패시키는가: 매니페스트를 관문보다 먼저 읽으면 — 링크를 따라가 밖의 파일을
  // 파싱하고, 그 파일이 JSON 이 아니면 관문 대신 JSON 오류가 난다.
  it("매니페스트가 심볼릭 링크면 파싱하기 전에 관문이 거부한다", async () => {
    const dir = copyOfHangul();
    const outside = join(
      mkdtempSync(join(tmpdir(), "baram-theme-outside-")),
      "baram-theme.json",
    );
    writeFileSync(outside, "not json");
    unlinkSync(join(dir, "baram-theme.json"));
    symlinkSync(outside, join(dir, "baram-theme.json"));
    const result = await packageTheme(dir, OK);
    expect(result).toMatchObject({ ok: false });
    if (result.ok) return;
    expect(result.error).toContain('"baram-theme.json" is not a regular file');
    expect(result.error).not.toContain("is invalid");
  });

  it("테마 폴더 자체가 심볼릭 링크면 거부한다", async () => {
    const link = join(
      mkdtempSync(join(tmpdir(), "baram-theme-link-")),
      "hangul",
    );
    symlinkSync(copyOfHangul(), link);
    const result = await packageTheme(link, OK);
    expect(result).toMatchObject({ ok: false });
    if (result.ok) return;
    expect(result.error).toContain("is a symbolic link");
  });

  // 앱의 스테이징은 매니페스트를 `read_to_string` 으로 읽어 `serde_json::from_str` 에 넘기고
  // (`src-tauri/src/plugin/install.rs`), 그 파서는 BOM 을 받지 않는다. 기본 `TextDecoder` 는 BOM 을
  // 조용히 떼므로, 그렇게 읽으면 앱이 설치하지 못하는 매니페스트가 게시된다.
  it("BOM 으로 시작하는 매니페스트는 거부한다", async () => {
    const dir = copyOfHangul();
    const path = join(dir, "baram-theme.json");
    writeFileSync(path, `\uFEFF${readFileSync(path, "utf8")}`);
    const result = await packageTheme(dir, OK);
    expect(result).toMatchObject({ ok: false });
    if (result.ok) return;
    expect(result.error).toContain("baram-theme.json is invalid");
  });

  // 무엇이 이것을 실패시키는가: 폴더를 통째로 묶으면. `SHA256SUMS` 는 게시 전 점검의 sha256 을
  // 적는 기록이고(`plugin-release.yml` 의 checksum 관문), 선언된 모드 파일이 아니다.
  it("폴더의 SHA256SUMS 는 zip 에 들어가지 않는다", async () => {
    const dir = copyOfHangul();
    writeFileSync(
      join(dir, "SHA256SUMS"),
      `${"a".repeat(64)}  baram-hangul-1.0.0.zip\n`,
    );
    const result = await packageTheme(dir, OK);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.files).not.toContain("SHA256SUMS");
    const reader = new ZipReader(new Uint8ArrayReader(result.bytes));
    const names = (await reader.getEntries()).map((entry) => entry.filename);
    await reader.close();
    expect(names).toEqual([...result.files]);
    expect(names).not.toContain("SHA256SUMS");
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

  // 무엇이 이것을 실패시키는가: 크기 상한이 빠지면. 앱은 모드마다 `tokens.json` 을
  // `MAX_THEME_TOKENS_BYTES` 까지만 읽고(`theme-install.ts` 의 `readModeColors`), 넘으면 그 모드를 색
  // 없이 설치한다. 뒤에 공백만 붙여 크기를 넘긴 이 파일은 JSON 으로도 팔레트로도 멀쩡하다.
  it("앱이 읽는 상한을 넘는 토큰 파일은 거부한다", async () => {
    const dir = copyOfHangul();
    const path = join(dir, "dark/tokens.json");
    writeFileSync(
      path,
      `${readFileSync(path, "utf8")}${" ".repeat(MAX_THEME_TOKENS_BYTES)}`,
    );
    const result = await packageTheme(dir, OK);
    expect(result).toMatchObject({ ok: false });
    if (result.ok) return;
    expect(result.error).toContain('"dark/tokens.json"');
    expect(result.error).toContain(
      `over the app's ${String(MAX_THEME_TOKENS_BYTES)}-byte cap`,
    );
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

  // 묶기와 같은 관문(`tokensProblem`)을 다시 검증도 지난다 — 상한이 한쪽에만 있으면 이것이 실패한다.
  it("앱이 읽는 상한을 넘는 토큰 파일은 거부한다", async () => {
    const bytes = await zipOf({
      "baram-theme.json": hangulFile("baram-theme.json"),
      "light/tokens.json": hangulFile("light/tokens.json"),
      "dark/tokens.json": `${hangulFile("dark/tokens.json").toString("utf8")}${" ".repeat(MAX_THEME_TOKENS_BYTES)}`,
    });
    const result = await verifyThemeArchive(bytes, expected);
    expect(result).toMatchObject({ ok: false });
    if (result.ok) return;
    expect(result.error).toContain(
      `over the app's ${String(MAX_THEME_TOKENS_BYTES)}-byte cap`,
    );
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

  it("디렉터리 항목이 끼어 있으면 거부한다", async () => {
    const writer = new ZipWriter(new Uint8ArrayWriter());
    for (const path of [
      "baram-theme.json",
      "light/tokens.json",
      "dark/tokens.json",
    ]) {
      await writer.add(path, new Uint8ArrayReader(hangulFile(path)));
    }
    await writer.add("light/", undefined, { directory: true });
    const result = await verifyThemeArchive(await writer.close(), expected);
    expect(result).toMatchObject({ ok: false });
    if (result.ok) return;
    expect(result.error).toContain('directory entry "light/"');
  });

  it("zip 이 아닌 바이트를 거부한다", async () => {
    const result = await verifyThemeArchive(
      new TextEncoder().encode("not a zip"),
      expected,
    );
    expect(result).toMatchObject({ ok: false });
  });
});

describe("run-theme-package.ts package — CLI", () => {
  // 무엇이 이것을 실패시키는가: CLI 가 `--out` 폴더를 만들지 않고 쓰면 — `writeFileSync` 가
  // ENOENT 로 던져 zip 도 출력 세 줄도 나오지 않는다.
  it("없는 --out 폴더를 만들고 그 안에 zip 을 쓴다", () => {
    const repo = resolve(__dirname, "../../..");
    // CLI 는 앱 버전을 cwd 의 `package.json` 에서 읽는다 — 하한(`>=0.7.7`)을 넘는 버전을 둔 합성
    // 루트에서 돌린다(`theme-release-workflow.test.ts` 의 `runPackageAndVerify` 와 같은 모양).
    const root = mkdtempSync(join(tmpdir(), "baram-theme-cli-"));
    for (const name of ["scripts", "src", "examples", "node_modules"]) {
      symlinkSync(join(repo, name), join(root, name));
    }
    writeFileSync(
      join(root, "package.json"),
      JSON.stringify({ version: "0.7.7" }),
    );
    const out = join(root, "not", "yet");
    const result = spawnSync(
      join(repo, "node_modules/.bin/tsx"),
      [
        "scripts/run-theme-package.ts",
        "package",
        "--dir",
        "examples/themes/hangul",
        "--version",
        "1.0.0",
        "--out",
        out,
      ],
      { cwd: root, encoding: "utf8" },
    );
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain("zip_name=baram-hangul-1.0.0.zip");
    expect(existsSync(join(out, "baram-hangul-1.0.0.zip"))).toBe(true);
    // tsx 를 한 번 띄운다 — vitest 기본 5 s 는 CI 러너에 맞춘 값이 아니다.
  }, 30_000);
});
