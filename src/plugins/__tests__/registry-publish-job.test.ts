// 스펙 0065(§69) — `plugin-release.yml` 의 `publish` 잡이 빌드의 artifact 를 어떻게 묶는가, 그리고 빌드
// 잡이 무엇을 넘기는가. 워크플로의 스크립트를 그대로 꺼내 bash 로 실행한다. 네트워크를 쓰는 한 줄
// (`Clone the live registry`)은 돌리지 않고, 시험이 `$RUNNER_TEMP/registry` 를 대신 짓는다(계획 0115 P5).
//
// ‼️ 로컬 macOS 의 `bash` 는 3.2 다 — 이 파일이 실행하는 워크플로 스크립트도 그 문법 안에 머문다.
// 매니페스트는 이 파일 안에 적는다 — `examples/` 를 읽지 않는다(계획 0115 P10).
import {
  configure,
  TextReader,
  Uint8ArrayWriter,
  ZipWriter,
} from "@zip.js/zip.js";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

configure({ useWebWorkers: false });

const ROOT = resolve(__dirname, "../../..");
const WORKFLOW = readFileSync(
  resolve(ROOT, ".github/workflows/plugin-release.yml"),
  "utf8",
);
const BASE_URL = "https://sayinel.github.io/baram-plugins/";

const ARTIFACT_STEP = "Check the release artifact against what meta verified";
const COMPARE_STEP = "Check the new index against the live registry";
const PLUGIN_STAGE = "Stage the plugin release for the publish job";
const THEME_STAGE = "Stage the theme release for the publish job";

/** 한 잡의 본문 — `  <name>:` 줄부터 다음 잡(두 칸 들여쓴 키) 앞까지. */
function jobText(name: string): string {
  const start = WORKFLOW.indexOf(`\n  ${name}:\n`);
  if (start < 0) throw new Error(`no job named ${name}`);
  const rest = WORKFLOW.slice(start + 1);
  const next = rest.slice(1).search(/\n {2}[\w-]+:\n/);
  return next < 0 ? rest : rest.slice(0, next + 1);
}

/** `- name: <stepName>` 단계의 `run: |` 블록(열 칸 들여쓰기). */
function stepScript(stepName: string): string {
  const step = WORKFLOW.indexOf(`- name: ${stepName}\n`);
  if (step < 0) throw new Error(`no workflow step named "${stepName}"`);
  const runAt = WORKFLOW.indexOf("run: |", step);
  const body: string[] = [];
  for (const line of WORKFLOW.slice(runAt).split("\n").slice(1)) {
    if (line.trim() !== "" && !line.startsWith("          ")) break;
    body.push(line.slice(10));
  }
  return body.join("\n");
}

const PLUGIN_MANIFEST = {
  author: "Baram",
  capabilities: ["events", "statusbar"],
  description: "Shows the word count.",
  engines: { baram: ">=0.6.1" },
  icon: "🔢",
  id: "baram-word-count",
  keywords: ["word"],
  license: "Apache-2.0",
  main: "dist/index.mjs",
  name: "Word Count",
  trust: "sandboxed",
  version: "2.1.0",
};

const THEME_MANIFEST = {
  author: "Baram",
  description: "Made for writing in Korean.",
  engines: { baram: ">=0.7.7" },
  id: "baram-hangul",
  license: "Apache-2.0",
  modes: {
    dark: { tokens: "dark/tokens.json" },
    light: { tokens: "light/tokens.json" },
  },
  name: "Baram Hangul",
  version: "1.0.0",
};

/** 라이브 레지스트리 — 이 릴리스의 옛 판(교체된다)과, 앞뒤의 무관한 항목. */
const LIVE = {
  plugins: [
    {
      author: "a",
      capabilities: [],
      checksum: "0".repeat(64),
      description: "d",
      downloadUrl: `${BASE_URL}plugins/baram-other-1.0.0.zip`,
      engines: { baram: ">=0.6.0" },
      id: "baram-other",
      license: "MIT",
      name: "Other",
      trust: "sandboxed",
      version: "1.0.0",
    },
    {
      ...PLUGIN_MANIFEST,
      checksum: "1".repeat(64),
      downloadUrl: `${BASE_URL}plugins/baram-word-count-2.0.0.zip`,
      version: "2.0.0",
    },
    {
      author: "a",
      capabilities: [],
      checksum: "2".repeat(64),
      description: "d",
      downloadUrl: `${BASE_URL}plugins/baram-third-1.0.0.zip`,
      engines: { baram: ">=0.6.0" },
      id: "baram-third",
      license: "MIT",
      name: "Third",
      trust: "trusted",
      version: "1.0.0",
    },
  ],
  updatedAt: "2026-09-01",
};

async function zipOf(files: Record<string, string>): Promise<Buffer> {
  return zipOfEntries(Object.entries(files));
}

/**
 * N1 (ruling R18) — entries added IN ORDER, as an array rather than a `Record` so a test can add
 * a second entry under a name already present (zip.js itself refuses a literal repeat — see the
 * fix report) and so a directory entry (`null` content) can be added explicitly, the way `zip -r`
 * adds `dist/` for a real `dist` directory.
 */
async function zipOfEntries(
  entries: readonly (readonly [string, null | string])[],
): Promise<Buffer> {
  const writer = new ZipWriter(new Uint8ArrayWriter());
  for (const [name, text] of entries) {
    if (text === null) {
      await writer.add(name, undefined, { directory: true });
    } else {
      await writer.add(name, new TextReader(text));
    }
  }
  return Buffer.from(await writer.close());
}

const sha256 = (bytes: Buffer) =>
  createHash("sha256").update(bytes).digest("hex");

/** 플러그인 README 의 솔직한(honest) 내용 — `readme: true` 일 때 plugin-meta 가 태그에서 읽는 것. */
const HONEST_README = "# Word Count\n";

interface Fixture {
  env: Record<string, string>;
  release: string;
  runnerTemp: string;
}

/**
 * 빌드가 넘기는 artifact 와 라이브 레지스트리를 짓는다. artifact 의 `index.json` 은 **진짜**
 * `update-registry-index.mjs` 가 쓴다 — publish 잡의 항목 재구성이 그 스크립트와 같은 항목을 만든다는
 * 것(스펙 D7)이 통과 케이스로 묶인다.
 */
async function fixture(
  kind: "plugin" | "theme",
  opts: {
    /** N1 (ruling R18) — extra entries appended to the plugin archive VERBATIM, after the
     * honest manifest/README/dist entries: a `null` content makes a directory entry. For the
     * entry-list refusal tests only; plugin archives only (themes carry no such check). */
    extraZipEntries?: readonly (readonly [string, null | string])[];
    manifest?: Record<string, unknown>;
    manifestPath?: string;
    manifestText?: string;
    /** meta 가 기록했다고 치는 값(R13) — 생략 시 `readme` 를 따른다. `readme: true, metaReadme:
     * false` 로 "meta 는 기록하지 않았는데 아카이브에 있다" 를 짓는다. */
    metaReadme?: boolean;
    readme?: boolean;
    /** 아카이브(zip) 안의 README.md 내용 — 생략 시 솔직한 내용. */
    readmeText?: string;
    /** 스테이지된 `readme/<id>-<version>.md` 의 내용 — 생략 시 솔직한 내용. */
    stagedReadmeText?: string;
  } = {},
): Promise<Fixture> {
  const runnerTemp = mkdtempSync(join(tmpdir(), "baram-publish-"));
  const registry = join(runnerTemp, "registry");
  const release = join(runnerTemp, "release");
  mkdirSync(join(registry, "plugins"), { recursive: true });
  mkdirSync(join(release, "plugins"), { recursive: true });
  writeFileSync(
    join(registry, "index.json"),
    `${JSON.stringify(LIVE, null, 2)}\n`,
  );

  const manifest = kind === "plugin" ? PLUGIN_MANIFEST : THEME_MANIFEST;
  const manifestText = `${JSON.stringify(manifest, null, 2)}\n`;
  const zipName = `${manifest.id}-${manifest.version}.zip`;
  const readmeName = `${manifest.id}-${manifest.version}.md`;
  // The archive may say something other than what was indexed (the refusal cases); the index is
  // always written from the honest manifest. `manifestPath` moves it off the archive root and
  // `manifestText` writes raw bytes in its place — both for crafted-artifact refusal tests that
  // `JSON.stringify` cannot produce (M6).
  const zipManifest = opts.manifest ?? manifest;
  const manifestZipName =
    kind === "plugin" ? "baram-plugin.json" : "baram-theme.json";
  const manifestZipPath = opts.manifestPath ?? manifestZipName;
  // N1 (ruling R18) — a real `Package ZIP` ships `dist/` (the directory entry `zip -r` adds for a
  // real `dist` directory) and `dist/index.mjs` alongside the two named members; the honest
  // fixture now does too, so the accept-path cases below also prove the archive's entry-list
  // check admits a real plugin archive, not just a two-file stub.
  const entries: Array<readonly [string, null | string]> = [
    [
      manifestZipPath,
      opts.manifestText ?? `${JSON.stringify(zipManifest, null, 2)}\n`,
    ],
  ];
  if (opts.readme)
    entries.push(["README.md", opts.readmeText ?? HONEST_README]);
  if (kind === "plugin") {
    entries.push(
      ["dist/", null],
      ["dist/index.mjs", "export async function activate() {}\n"],
    );
  }
  if (opts.extraZipEntries) entries.push(...opts.extraZipEntries);
  const zip = await zipOfEntries(entries);
  writeFileSync(join(release, "plugins", zipName), zip);
  const checksum = sha256(zip);

  const newIndex = join(release, "index.json");
  cpSync(join(registry, "index.json"), newIndex);
  const manifestFile = join(runnerTemp, "manifest.json");
  writeFileSync(manifestFile, manifestText);
  const args = [
    "scripts/update-registry-index.mjs",
    "--index",
    newIndex,
    "--manifest",
    manifestFile,
    "--zip-name",
    zipName,
    "--checksum",
    checksum,
    "--base-url",
    BASE_URL,
  ];
  if (opts.readme) {
    mkdirSync(join(release, "readme"));
    writeFileSync(
      join(release, "readme", readmeName),
      opts.stagedReadmeText ?? HONEST_README,
    );
    args.push("--readme-name", readmeName);
  }
  if (kind === "theme") {
    const preview = join(runnerTemp, "preview.json");
    writeFileSync(
      preview,
      JSON.stringify({
        dark: { "--color-bg-default": "#1c1a17" },
        light: { "--color-bg-default": "#fbf9f4" },
      }),
    );
    args.push("--kind", "theme", "--preview", preview);
  }
  const indexed = spawnSync("node", args, { cwd: ROOT, encoding: "utf8" });
  if (indexed.status !== 0) throw new Error(indexed.stderr);

  // Plan 0115 F1 (R13) — the HONEST hashes plugin-meta would have read from the tagged checkout:
  // of `manifestText` (the real manifest object, independent of whatever `opts.manifest` /
  // `opts.manifestText` puts INSIDE the zip for a refusal case) and of the honest README. Empty
  // for a theme, which plugin-meta never records.
  const metaHasReadme =
    kind === "plugin" && (opts.metaReadme ?? opts.readme ?? false);
  const manifestSha256 =
    kind === "plugin" ? sha256(Buffer.from(manifestText)) : "";
  const readmeSha256 = metaHasReadme ? sha256(Buffer.from(HONEST_README)) : "";

  return {
    env: {
      BASE_URL,
      CHECKSUM: checksum,
      EXPECTED_TRUST: kind === "plugin" ? PLUGIN_MANIFEST.trust : "",
      ID: manifest.id,
      KIND: kind,
      MANIFEST_SHA256: manifestSha256,
      README_SHA256: readmeSha256,
      RECORDED_SHA256: kind === "theme" ? checksum : "",
      VERSION: manifest.version,
      ZIP_NAME: zipName,
    },
    release,
    runnerTemp,
  };
}

/**
 * I1(R8) 시험 전용 — 실제 `scripts/update-registry-index.mjs` 는 이런 매니페스트(문자열이 아닌
 * `keywords` 원소 등)를 검증에서 거부하므로, 그 스크립트를 부르지 않고 스크립트가 쓰는 그대로 항목을
 * JS 로 직접 짓는다. 값은 JSON 으로 표현 가능해야 한다 — 그래야 canonical-bytes 검사가 아니라 R8 의
 * 새 검사(크기·타입)에 닿는다.
 */
async function craftedFixture(
  kind: "plugin" | "theme",
  zipManifest: Record<string, unknown>,
  opts: {
    /** N6 — write the staged index.json as COMPACT JSON (no indent) instead of jq's canonical
     * 2-space pretty form, so the size cap is exercised on bytes the canonical-form check would
     * also refuse — proving the size cap, not the canonical check, is what catches it. */
    compact?: boolean;
  } = {},
): Promise<Fixture> {
  const runnerTemp = mkdtempSync(join(tmpdir(), "baram-publish-crafted-"));
  const registry = join(runnerTemp, "registry");
  const release = join(runnerTemp, "release");
  mkdirSync(join(registry, "plugins"), { recursive: true });
  mkdirSync(join(release, "plugins"), { recursive: true });
  writeFileSync(
    join(registry, "index.json"),
    `${JSON.stringify(LIVE, null, 2)}\n`,
  );

  const manifest = kind === "plugin" ? PLUGIN_MANIFEST : THEME_MANIFEST;
  const zipName = `${manifest.id}-${manifest.version}.zip`;
  const manifestZipName =
    kind === "plugin" ? "baram-plugin.json" : "baram-theme.json";
  const zip = await zipOf({
    [manifestZipName]: `${JSON.stringify(zipManifest, null, 2)}\n`,
  });
  writeFileSync(join(release, "plugins", zipName), zip);
  const checksum = sha256(zip);

  // 이 릴리스의 항목 — `update-registry-index.mjs` 가 짓는 순서·규칙 그대로, 손으로.
  const copy = (k: string): Record<string, unknown> =>
    Object.prototype.hasOwnProperty.call(zipManifest, k)
      ? { [k]: zipManifest[k] }
      : {};
  const entry: Record<string, unknown> = {
    ...copy("id"),
    ...copy("name"),
    ...copy("description"),
    ...copy("version"),
    ...copy("author"),
    ...copy("license"),
    downloadUrl: `${BASE_URL}plugins/${zipName}`,
    checksum,
    ...(kind === "theme"
      ? { capabilities: [] }
      : { ...copy("capabilities"), ...copy("trust") }),
    ...copy("engines"),
    ...(kind === "theme" ? { kind: "theme" } : {}),
    ...copy("icon"),
    ...copy("keywords"),
    ...(kind === "theme"
      ? {
          preview: {
            dark: { "--color-bg-default": "#1c1a17" },
            light: { "--color-bg-default": "#fbf9f4" },
          },
        }
      : {}),
  };

  const index = {
    plugins: [...LIVE.plugins.filter((p) => p.id !== manifest.id), entry],
    updatedAt: "2026-10-03",
  };
  writeFileSync(
    join(release, "index.json"),
    opts.compact
      ? JSON.stringify(index)
      : `${JSON.stringify(index, null, 2)}\n`,
  );

  return {
    env: {
      BASE_URL,
      CHECKSUM: checksum,
      EXPECTED_TRUST:
        kind === "plugin" ? ((zipManifest.trust as string) ?? "") : "",
      ID: manifest.id,
      KIND: kind,
      RECORDED_SHA256: kind === "theme" ? checksum : "",
      VERSION: manifest.version,
      ZIP_NAME: zipName,
    },
    release,
    runnerTemp,
  };
}

function runStep(
  name: string,
  f: Fixture,
  env: Record<string, string> = {},
): { output: string; outputs: string; status: null | number } {
  const out = join(f.runnerTemp, "github-output");
  writeFileSync(out, "");
  const result = spawnSync("bash", ["-e", "-c", stepScript(name)], {
    cwd: f.runnerTemp,
    encoding: "utf8",
    env: {
      ...process.env,
      ...f.env,
      ...env,
      GITHUB_OUTPUT: out,
      RUNNER_TEMP: f.runnerTemp,
    },
  });
  return {
    output: result.stderr + result.stdout,
    outputs: readFileSync(out, "utf8"),
    status: result.status,
  };
}

/** artifact 의 `index.json` 을 고친다 — 빌드가 오염된 경우. */
function editIndex(
  f: Fixture,
  edit: (index: {
    [k: string]: unknown;
    plugins: Record<string, unknown>[];
  }) => void,
): void {
  const path = join(f.release, "index.json");
  const index = JSON.parse(readFileSync(path, "utf8"));
  edit(index);
  writeFileSync(path, `${JSON.stringify(index, null, 2)}\n`);
}

function entryOf(
  index: { plugins: Record<string, unknown>[] },
  id: string,
): Record<string, unknown> {
  const entry = index.plugins.find((p) => p.id === id);
  if (entry === undefined) throw new Error(`no entry ${id}`);
  return entry;
}

/**
 * artifact 의 `index.json` 을 날 텍스트로 통째로 바꾼다 — 중복 키·BOM 처럼 `JSON.stringify` 로는
 * 만들 수 없는 바이트 모양을 짓기 위해(I1).
 */
function writeRawIndex(f: Fixture, raw: string): void {
  writeFileSync(join(f.release, "index.json"), raw);
}

describe("publish — artifact 를 meta 가 검증한 것에 묶는다", () => {
  it.each([
    ["플러그인, README 있음", "plugin", true],
    ["플러그인, README 없음", "plugin", false],
    ["테마", "theme", false],
  ] as const)(
    "%s 를 통과시키고 zip 의 checksum 을 낸다",
    async (_, kind, readme) => {
      const f = await fixture(kind, { readme });
      const { output, outputs, status } = runStep(ARTIFACT_STEP, f);
      expect(status, output).toBe(0);
      expect(outputs).toContain(`checksum=${f.env.CHECKSUM}\n`);
    },
  );

  // 무엇이 이것을 실패시키는가: 파일 목록을 보지 않으면 — 오염된 빌드가 다른 zip 이나 파일을 실어
  // 보낸다. push 단계는 이름을 대고 복사하지만(Task 3), 이 검사는 그것과 무관하게 멈춘다.
  it.each([
    ["다른 zip", "plugins/baram-other-9.9.9.zip"],
    ["맨 위의 다른 파일", "notes.txt"],
    ["다른 이름의 README", "readme/baram-other-1.0.0.md"],
  ])("%s 이 하나 더 있으면 거부한다", async (_, extra) => {
    const f = await fixture("plugin", { readme: true });
    mkdirSync(join(f.release, extra, ".."), { recursive: true });
    writeFileSync(join(f.release, extra), "x");
    const { output, status } = runStep(ARTIFACT_STEP, f);
    expect(status).not.toBe(0);
    expect(output).toContain(`the artifact carries ${extra}`);
  });

  it("테마 릴리스에 README 가 실려 오면 거부한다", async () => {
    const f = await fixture("theme");
    mkdirSync(join(f.release, "readme"));
    writeFileSync(join(f.release, "readme", "baram-hangul-1.0.0.md"), "x");
    const { output, status } = runStep(ARTIFACT_STEP, f);
    expect(status).not.toBe(0);
    expect(output).toContain("which a theme release does not publish");
  });

  it("심볼릭 링크가 있으면 거부한다", async () => {
    const f = await fixture("plugin");
    symlinkSync(
      join(f.release, "index.json"),
      join(f.release, "plugins", "link.json"),
    );
    const { output, status } = runStep(ARTIFACT_STEP, f);
    expect(status).not.toBe(0);
    expect(output).toContain("symbolic link");
  });

  it("index.json 이 없으면 거부한다", async () => {
    const f = await fixture("plugin");
    rmSync(join(f.release, "index.json"));
    const { output, status } = runStep(ARTIFACT_STEP, f);
    expect(status).not.toBe(0);
    expect(output).toContain("the artifact has no index.json");
  });

  it.each([
    [
      "다른 id",
      { ...PLUGIN_MANIFEST, id: "baram-evil" },
      "contains plugin 'baram-evil'",
    ],
    [
      "다른 버전",
      { ...PLUGIN_MANIFEST, version: "9.9.9" },
      "contains version '9.9.9'",
    ],
    [
      "다른 등급",
      { ...PLUGIN_MANIFEST, trust: "trusted" },
      "declares trust 'trusted'",
    ],
  ])(
    "zip 의 매니페스트가 %s 를 말하면 거부한다",
    async (_, manifest, message) => {
      const f = await fixture("plugin", { manifest });
      const { output, status } = runStep(ARTIFACT_STEP, f);
      expect(status).not.toBe(0);
      expect(output).toContain(message);
    },
  );

  // 스펙 D6 ③ — 테마 zip 은 빌드와 무관한 기준점(태그 커밋의 기록)에 묶인다.
  it("테마 zip 이 기록과 다르면 거부한다", async () => {
    const f = await fixture("theme");
    const { output, status } = runStep(ARTIFACT_STEP, f, {
      RECORDED_SHA256: "b".repeat(64),
    });
    expect(status).not.toBe(0);
    expect(output).toContain("SHA256SUMS records");
  });

  // 계획 0115 F1(R13) — 플러그인의 NON-BUILT 파일(매니페스트 · README)은 plugin-meta 가 태그에서
  // 읽은 바이트에 묶인다. 무엇이 이것을 실패시키는가: id·버전·등급은 그대로 두고 용량만 넓히거나
  // 하한만 낮추면(위 ②는 통과) — 그 변화를 ②는 보지 못한다.
  it("아카이브의 매니페스트가 plugin-meta 가 읽은 것과 다르면 거부한다 — 용량이 넓어지고 하한이 낮아져도", async () => {
    const f = await fixture("plugin", {
      manifest: {
        ...PLUGIN_MANIFEST,
        capabilities: [...PLUGIN_MANIFEST.capabilities, "network", "settings"],
        engines: { baram: ">=0.1.0" },
      },
    });
    const { output, status } = runStep(ARTIFACT_STEP, f);
    expect(status).not.toBe(0);
    expect(output).toContain(
      "the archive's baram-plugin.json is not the manifest plugin-meta read at the tag",
    );
  });

  it("아카이브의 README 가 plugin-meta 가 읽은 것과 다르면 거부한다", async () => {
    const f = await fixture("plugin", {
      readme: true,
      readmeText: "# Something else\n",
    });
    const { output, status } = runStep(ARTIFACT_STEP, f);
    expect(status).not.toBe(0);
    expect(output).toContain(
      "the archive's README.md is not the README plugin-meta read at the tag",
    );
  });

  it("스테이지된 readme/ 파일이 아카이브의 README 와 다르면 거부한다", async () => {
    const f = await fixture("plugin", {
      readme: true,
      stagedReadmeText: "# Something else\n",
    });
    const { output, status } = runStep(ARTIFACT_STEP, f);
    expect(status).not.toBe(0);
    expect(output).toContain(
      "the staged readme/baram-word-count-2.1.0.md is not the README plugin-meta read at the tag",
    );
  });

  it("plugin-meta 가 README 를 기록하지 않았는데 아카이브에 있으면 거부한다", async () => {
    const f = await fixture("plugin", { readme: true, metaReadme: false });
    const { output, status } = runStep(ARTIFACT_STEP, f);
    expect(status).not.toBe(0);
    expect(output).toContain(
      "the archive carries a README.md but plugin-meta recorded none",
    );
  });

  it("plugin-meta 가 README 를 기록하지 않았는데 artifact 에 readme/ 파일이 있으면 거부한다", async () => {
    const f = await fixture("plugin", { readme: false });
    mkdirSync(join(f.release, "readme"), { recursive: true });
    writeFileSync(
      join(f.release, "readme", "baram-word-count-2.1.0.md"),
      "# stray\n",
    );
    const { output, status } = runStep(ARTIFACT_STEP, f);
    expect(status).not.toBe(0);
    expect(output).toContain(
      "the artifact carries readme/baram-word-count-2.1.0.md but plugin-meta recorded no README",
    );
  });

  // 계획 0115 N1(ruling R18) — publish 는 `unzip -p` 가 이름으로 읽는 두 멤버만 해시와 대조했고,
  // 아카이브의 "항목 목록 자체"는 한 번도 보지 않았다. 앱의 압축 해제기(`enclosed_name`,
  // src-tauri/src/fs/archive.rs `extract_zip_bounded`)는 `./baram-plugin.json` ·
  // `dist/../baram-plugin.json` · `Baram-Plugin.json` 같은 별칭을 솔직한 이름과 같은 설치 경로로
  // 정규화하고 archive 안에서 더 나중 항목이 이긴다(대소문자 구분 없는 APFS 에서는 대소문자가
  // 다른 쪽이 이긴다) — 그래서 솔직한 멤버 옆에 별칭 하나만 실어도 위의 해시 대조는 솔직한 이름을
  // 그대로 읽어 통과하면서, 설치되는 바이트는 다른 파일이 된다.
  describe("N1 — 아카이브의 항목 목록 자체를 검사한다", () => {
    it.each([
      ["매니페스트의 ./별칭", ["./baram-plugin.json", "{}"] as const],
      [
        "매니페스트의 dist/../ 별칭",
        ["dist/../baram-plugin.json", "{}"] as const,
      ],
      [
        "매니페스트의 백슬래시 별칭",
        ["dist\\..\\baram-plugin.json", "{}"] as const,
      ],
      ["매니페스트의 대소문자 별칭", ["Baram-Plugin.json", "{}"] as const],
    ])("%s 이 솔직한 매니페스트 옆에 더 있으면 거부한다", async (_, extra) => {
      const f = await fixture("plugin", { extraZipEntries: [extra] });
      const { output, status } = runStep(ARTIFACT_STEP, f);
      expect(status).not.toBe(0);
      expect(output).toContain(extra[0]);
    });

    it("README 의 ./ 별칭이 솔직한 README 옆에 있으면 거부한다", async () => {
      const f = await fixture("plugin", {
        extraZipEntries: [["./README.md", "x"]],
        readme: true,
      });
      const { output, status } = runStep(ARTIFACT_STEP, f);
      expect(status).not.toBe(0);
      expect(output).toContain("./README.md");
    });

    it("readme.md(대소문자 별칭)가 솔직한 README 옆에 있으면 거부한다", async () => {
      const f = await fixture("plugin", {
        extraZipEntries: [["readme.md", "x"]],
        readme: true,
      });
      const { output, status } = runStep(ARTIFACT_STEP, f);
      expect(status).not.toBe(0);
      expect(output).toContain("readme.md");
    });

    it("plugin-meta 가 README 를 기록하지 않았는데 ./README.md 만 있어도 거부한다", async () => {
      const f = await fixture("plugin", {
        extraZipEntries: [["./README.md", "x"]],
      });
      const { output, status } = runStep(ARTIFACT_STEP, f);
      expect(status).not.toBe(0);
      expect(output).toContain("./README.md");
    });

    it("최상위에 이름이 다른 파일이 있으면 거부한다", async () => {
      const f = await fixture("plugin", {
        extraZipEntries: [["notes.txt", "x"]],
      });
      const { output, status } = runStep(ARTIFACT_STEP, f);
      expect(status).not.toBe(0);
      expect(output).toContain("notes.txt");
    });

    // zip.js 는 같은 이름의 두 번째 항목을 거부한다(`ZipWriter.add` 가 내부 `filenames` Set 으로
    // 지키며, 우회 옵션이 없다 — 실측). 그래서 "baram-plugin.json 이 정말 두 번" 인 아카이브는 이
    // 시험 도구로 지을 수 없다: 생략한다(ruling 이 "zip.js 가 그 이름을 지을 수 없으면 생략해도
    // 된다" 고 허용한 경우와 같은 결의 제약 — 중복은 단순 정규화가 아니라 하드 리젝트다).
    //
    // 실측(2026-10-03, /tmp 스크립트): `writer.add("baram-plugin.json", …)` 를 두 번 부르면
    // `Error: File already exists` 를 던진다 — 이 하드 리젝트가 실은 또 하나의 방어선이다: 시스템
    // `python3 zipfile` 로 억지로 두 번 넣은 아카이브에서는 `unzip -p` 가 두 항목의 바이트를
    // 이어 붙여 내놓고, 그 결과가 jq 의 `length == 1` 스트림 검사(M2, 이 단계 ② 의 기존 관문)에
    // 걸려 거부된다 — N1 의 카운트 검사가 아니라 그보다 앞선 기존 관문이 이미 잡는다는 뜻이다.

    // N1 (ruling R18) — 솔직한 아카이브가 `dist/` 디렉터리 항목과 `dist/index.mjs` 를 실어도
    // 통과한다: 이미 있는 "플러그인, README 있음/없음" 통과 케이스가 `fixture()` 에 더한 그 두
    // 항목으로 다시 돈다 — 새 시험을 더하지 않는다.
  });

  // 무엇이 이것을 실패시키는가: 빈 값 관문이 없으면 — 빈 등급은 등급 없는 매니페스트와, 빈 기록은
  // 아무 대조도 하지 않는 것과 같아진다.
  //
  // `ID: ""` 케이스는 `ZIP_NAME`도 `-2.1.0.zip`으로 함께 비워 둔다(M6) — 그러지 않으면 `-n` 관문을
  // 지워도 다음 줄의 `$ZIP_NAME == $ID-$VERSION.zip` 비교가 대신 "meta named the archive"로
  // 실패해, 공유된 "this is a bug in this workflow" 부분문자열이 두 메시지 모두에 있어 시험이
  // `-n` 관문 자체를 지운 것을 못 잡는다. 정확한 문구로 단언해 그 관문만 짚는다.
  it.each([
    ["plugin", { KIND: "" }, "unknown release kind"],
    [
      "plugin",
      { ID: "", ZIP_NAME: "-2.1.0.zip" },
      "a verified value did not reach this job",
    ],
    [
      "plugin",
      { EXPECTED_TRUST: "" },
      "the verified tier did not reach this job",
    ],
    [
      "theme",
      { RECORDED_SHA256: "" },
      "the recorded checksum did not reach this job",
    ],
    // Plan 0115 F1 (R13) — the same empty-value bug guard for the manifest hash, and its
    // mirror image: a theme job must never receive a plugin-only value at all.
    [
      "plugin",
      { MANIFEST_SHA256: "" },
      "the manifest hash did not reach this job",
    ],
    [
      "plugin",
      { MANIFEST_SHA256: "not-a-hash" },
      "the manifest hash did not reach this job",
    ],
    [
      "theme",
      { MANIFEST_SHA256: "a".repeat(64) },
      "a plugin-only value reached this theme job",
    ],
    // N8 — the same two wiring-bug branches, untested on the README side: a malformed (not
    // empty, not 64 lowercase hex) README_SHA256 on a plugin, and a non-empty README_SHA256
    // reaching a theme job (MANIFEST_SHA256 stays empty here, so this is the README half alone).
    [
      "plugin",
      { README_SHA256: "not-a-hash" },
      "the README hash did not reach this job",
    ],
    [
      "theme",
      { README_SHA256: "a".repeat(64) },
      "a plugin-only value reached this theme job",
    ],
  ] as const)(
    "%s 에 %j 가 닿으면 워크플로의 버그라고 말한다",
    async (kind, env, message) => {
      const f = await fixture(kind);
      const { output, status } = runStep(ARTIFACT_STEP, f, env);
      expect(status).not.toBe(0);
      expect(output).toContain(message);
    },
  );

  // M1 — `find`가 process substitution 안에 있으면 그 exit status가 `-e`에 보이지 않는다. 읽을 수
  // 없는 디렉터리(mode 000)가 있으면 `find`가 "Permission denied"로 실패하지만, 고치기 전에는
  // 그 실패가 숨겨져 이 단계가 조용히 통과했다.
  it("읽을 수 없는 디렉터리가 있으면 거부한다", async () => {
    const f = await fixture("plugin", { readme: true });
    const dir = join(f.release, "readme");
    chmodSync(dir, 0o000);
    try {
      const { status } = runStep(ARTIFACT_STEP, f);
      expect(status).not.toBe(0);
    } finally {
      chmodSync(dir, 0o755);
    }
  });

  // M2 — `jq -e 'type == "object"'`는 마지막 값만 본다; `$(...)`가 줄바꿈을 지워 멤버가 JSON 값의
  // 스트림(두 값)이어도 "객체 하나"처럼 보였다.
  it("매니페스트가 JSON 값의 스트림이면 거부한다", async () => {
    const f = await fixture("plugin", {
      manifestText: `${JSON.stringify(PLUGIN_MANIFEST, null, 2)}\n{}\n`,
    });
    const { output, status } = runStep(ARTIFACT_STEP, f);
    expect(status).not.toBe(0);
    expect(output).toContain("is not a single JSON object");
  });

  // M6 — 매니페스트가 archive 루트에 없으면(서브디렉터리 안) 거부한다.
  it("매니페스트가 archive 루트에 없으면 거부한다", async () => {
    const f = await fixture("plugin", {
      manifestPath: "sub/baram-plugin.json",
    });
    const { output, status } = runStep(ARTIFACT_STEP, f);
    expect(status).not.toBe(0);
    expect(output).toContain(
      "the archive has no baram-plugin.json at its root",
    );
  });

  // M6 — 매니페스트가 객체가 아니면(배열) 거부한다.
  it("매니페스트가 객체가 아니면 거부한다", async () => {
    const f = await fixture("plugin", { manifestText: "[]\n" });
    const { output, status } = runStep(ARTIFACT_STEP, f);
    expect(status).not.toBe(0);
    expect(output).toContain("is not a single JSON object");
  });

  // M6 — ZIP_NAME이 meta가 낸 ID·VERSION과 안 맞으면 워크플로의 버그라고 말한다.
  it("ZIP_NAME 이 ID·VERSION 과 안 맞으면 워크플로의 버그라고 말한다", async () => {
    const f = await fixture("plugin");
    const { output, status } = runStep(ARTIFACT_STEP, f, {
      ZIP_NAME: "baram-word-count-9.9.9.zip",
    });
    expect(status).not.toBe(0);
    expect(output).toContain("meta named the archive");
  });

  // M6 — ②의 id·버전 불일치를 테마에서도 짚는다.
  it.each([
    [
      "다른 id",
      { ...THEME_MANIFEST, id: "baram-evil" },
      "contains theme 'baram-evil'",
    ],
    [
      "다른 버전",
      { ...THEME_MANIFEST, version: "9.9.9" },
      "contains version '9.9.9'",
    ],
  ])(
    "테마 zip 의 매니페스트가 %s 를 말하면 거부한다",
    async (_, manifest, message) => {
      const f = await fixture("theme", { manifest });
      const { output, status } = runStep(ARTIFACT_STEP, f);
      expect(status).not.toBe(0);
      expect(output).toContain(message);
    },
  );
});

describe("publish — 새 색인을 라이브 색인에 묶는다", () => {
  // 스펙 D7 — 진짜 색인 스크립트가 쓴 항목을 publish 잡의 재구성이 그대로 다시 만든다.
  it.each([
    ["플러그인, README 있음", "plugin", true],
    ["플러그인, README 없음", "plugin", false],
    ["테마", "theme", false],
  ] as const)("%s 의 색인을 통과시킨다", async (_, kind, readme) => {
    const f = await fixture(kind, { readme });
    const { output, status } = runStep(COMPARE_STEP, f);
    expect(status, output).toBe(0);
  });

  // 계획 0115 F4(채택한 권고) — 게시된 아카이브는 바꾸지 않는다, 그런데 그걸 거부하는 관문이 없었다.
  // 레지스트리의 `validate.yml` 은 pull request 에서 돌고 이 push 에서는 안 돈다 — 그래서 성공한
  // 릴리스를 그대로 다시 돌리면(재현되지 않는 zip 을 다시 빌드하거나 테마를 다시 패키징해) 이미
  // 게시된 아카이브를 조용히 덮어썼다.
  it("이 릴리스의 zip 이 레지스트리에 이미 다른 바이트로 있으면 거부한다", async () => {
    const f = await fixture("plugin");
    writeFileSync(
      join(f.runnerTemp, "registry", "plugins", f.env.ZIP_NAME),
      "different bytes",
    );
    const { output, status } = runStep(COMPARE_STEP, f);
    expect(status).not.toBe(0);
    expect(output).toContain("is already published with different bytes");
  });

  it("이 릴리스의 zip 이 레지스트리에 이미 같은 바이트로 있으면 통과한다", async () => {
    const f = await fixture("plugin");
    cpSync(
      join(f.release, "plugins", f.env.ZIP_NAME),
      join(f.runnerTemp, "registry", "plugins", f.env.ZIP_NAME),
    );
    const { output, status } = runStep(COMPARE_STEP, f);
    expect(status, output).toBe(0);
  });

  it("이 릴리스의 README 가 레지스트리에 이미 다른 바이트로 있으면 거부한다", async () => {
    const f = await fixture("plugin", { readme: true });
    mkdirSync(join(f.runnerTemp, "registry", "readme"), { recursive: true });
    writeFileSync(
      join(f.runnerTemp, "registry", "readme", "baram-word-count-2.1.0.md"),
      "different\n",
    );
    const { output, status } = runStep(COMPARE_STEP, f);
    expect(status).not.toBe(0);
    expect(output).toContain("is already published with different bytes");
  });

  it("다른 항목을 바꾸면 거부한다", async () => {
    const f = await fixture("plugin");
    editIndex(f, (index) => {
      entryOf(index, "baram-other").checksum = "f".repeat(64);
    });
    const { output, status } = runStep(COMPARE_STEP, f);
    expect(status).not.toBe(0);
    expect(output).toContain("changes more than the baram-word-count entry");
  });

  it("맨 위에 키를 더하면 거부한다", async () => {
    const f = await fixture("plugin");
    editIndex(f, (index) => {
      index.extra = true;
    });
    const { output, status } = runStep(COMPARE_STEP, f);
    expect(status).not.toBe(0);
    expect(output).toContain("changes more than the baram-word-count entry");
  });

  // 빌드가 클론한 뒤 라이브 레지스트리가 움직였으면 — 안전한 쪽으로 멈춘다. `publish` 만 다시
  // 돌려서는 복구되지 않는다: artifact 의 `index.json` 은 빌드 잡의 clone 에서 나온 것이라 이
  // 단계가 다시 돌아도 바뀌지 않는다 — 워크플로 전체를 다시 돌려야 빌드가 라이브 레지스트리를
  // 새로 clone 한다(R7).
  it("라이브 색인이 그사이 바뀌었으면 거부한다", async () => {
    const f = await fixture("plugin");
    const live = join(f.runnerTemp, "registry", "index.json");
    const index = JSON.parse(readFileSync(live, "utf8"));
    index.plugins.push({ ...index.plugins[0], id: "baram-new" });
    writeFileSync(live, JSON.stringify(index));
    const { output, status } = runStep(COMPARE_STEP, f);
    expect(status).not.toBe(0);
    expect(output).toContain("changes more than the baram-word-count entry");
  });

  // M3 — ④는 "이 id 말고는 안 바뀐다"만 보고, 라이브에 이미 있는 그 id의 kind 가 바뀌는 것은
  // 보지 않았다. `update-registry-index.mjs`는 플러그인이 테마 자리를(또는 반대로) 덮어쓰는 것을
  // 거부하므로, 이 검사도 같은 규칙을 진다.
  it("라이브 레지스트리가 이 id 를 다른 kind 로 실어 놓았으면 거부한다", async () => {
    const f = await fixture("plugin");
    const live = join(f.runnerTemp, "registry", "index.json");
    const index = JSON.parse(readFileSync(live, "utf8"));
    entryOf(index, "baram-word-count").kind = "theme";
    writeFileSync(live, JSON.stringify(index));
    const { output, status } = runStep(COMPARE_STEP, f);
    expect(status).not.toBe(0);
    expect(output).toContain(
      "the live registry lists baram-word-count as a theme; a plugin release does not replace it",
    );
  });

  // I1 — ④·⑤는 jq가 파싱한 "뜻"만 보고, 그 bytes 가 index 스크립트가 쓰는 모양인지는 보지 않았다.
  // jq 는 중복 키에서 마지막 값을 쓰고 BOM 을 벗기지만, 앱은 `serde_json::from_slice` 로 그 bytes
  // 를 그대로 구조체에 꽂는다 — 중복 `plugins`·`updatedAt` 필드나 BOM 은 거기서 깨진다. 세 crafted
  // index 는 `JSON.stringify` 로 만들 수 없는 모양이라 날 텍스트로 직접 쓴다.
  // 라운드 2 수정 — compact 로 직접 지으면 jq 의 2-space pretty 형태와 다르다는 사실 자체가 이미
  // 거부를 만들어, 시험이 중복 키를 전혀 짚지 않아도 통과했다(findings-r2 "Duplicate-key tests are
  // confounded"). honest 파일(이미 jq 의 canonical 형태)을 그대로 쓰고, 그 앞에 bogus 한 줄만 더해
  // 차이가 중복 키 자체뿐이게 한다.
  it("맨 위 plugins 키가 두 번(둘째가 honest) 있으면 거부한다", async () => {
    const f = await fixture("plugin");
    const honest = readFileSync(join(f.release, "index.json"), "utf8");
    expect(honest.startsWith('{\n  "plugins": [\n')).toBe(true);
    const raw = honest.replace(
      '{\n  "plugins": [\n',
      '{\n  "plugins": [],\n  "plugins": [\n',
    );
    writeRawIndex(f, raw);
    const { output, status } = runStep(COMPARE_STEP, f);
    expect(status).not.toBe(0);
    expect(output).toContain("is not in the form the index script writes");
  });

  it("맨 앞에 UTF-8 BOM 이 있으면 거부한다", async () => {
    const f = await fixture("plugin");
    const path = join(f.release, "index.json");
    const honest = readFileSync(path, "utf8");
    writeRawIndex(f, `\uFEFF${honest}`);
    const { output, status } = runStep(COMPARE_STEP, f);
    expect(status).not.toBe(0);
    expect(output).toContain("is not in the form the index script writes");
  });

  // 라운드 2 수정 — 위와 같은 이유. honest 텍스트에서 이 릴리스 항목의 `"trust"` 줄 바로 앞에 bogus
  // 줄 하나만 같은 들여쓰기로 끼워, 차이가 중복 키 자체뿐이게 한다.
  it("이 릴리스 항목 안에 trust 키가 두 번(둘째가 honest) 있으면 거부한다", async () => {
    const f = await fixture("plugin");
    const honest = readFileSync(join(f.release, "index.json"), "utf8");
    const idAt = honest.indexOf('"id": "baram-word-count"');
    expect(idAt).toBeGreaterThan(-1);
    const trustAt = honest.indexOf('"trust": "sandboxed"', idAt);
    expect(trustAt).toBeGreaterThan(-1);
    const indent = honest.slice(honest.lastIndexOf("\n", trustAt) + 1, trustAt);
    const raw =
      honest.slice(0, trustAt) +
      `"trust": "trusted",\n${indent}` +
      honest.slice(trustAt);
    writeRawIndex(f, raw);
    const { output, status } = runStep(COMPARE_STEP, f);
    expect(status).not.toBe(0);
    expect(output).toContain("is not in the form the index script writes");
  });

  it.each([
    [
      "checksum 이 zip 과 다름",
      (e: Record<string, unknown>) => {
        e.checksum = "e".repeat(64);
      },
    ],
    [
      "등급이 바뀜",
      (e: Record<string, unknown>) => {
        e.trust = "trusted";
      },
    ],
    [
      "downloadUrl 이 다른 곳",
      (e: Record<string, unknown>) => {
        e.downloadUrl = "https://example.com/x.zip";
      },
    ],
  ])("이 릴리스의 항목에 %s 이면 거부한다", async (_, edit) => {
    const f = await fixture("plugin");
    editIndex(f, (index) => edit(entryOf(index, "baram-word-count")));
    const { output, status } = runStep(COMPARE_STEP, f);
    expect(status).not.toBe(0);
    expect(output).toContain(
      "the baram-word-count entry is not the one its archive's manifest makes",
    );
  });

  // R8 — 이 둘은 전에는 ⑤(재구성 불일치)가 잡았지만, 이제는 그보다 앞선 타입·키 검사가 "이 스크립트가
  // 안 쓰는 키" 로 먼저 잡는다(둘 다 허용 키 목록 밖이다 — `homepage` 는 플러그인·테마 어느 쪽에도
  // 없고, `preview` 는 테마에만 있다). 같은 거부를 다른 단계가 짚게 됐으니 메시지를 그에 맞춰 둔다.
  it.each([
    [
      "색인 스크립트가 쓰지 않는 필드",
      (e: Record<string, unknown>) => {
        e.homepage = "https://example.com";
      },
    ],
    [
      "플러그인 항목에 미리보기",
      (e: Record<string, unknown>) => {
        e.preview = { light: {} };
      },
    ],
  ])("이 릴리스의 항목에 %s 이면 거부한다", async (_, edit) => {
    const f = await fixture("plugin");
    editIndex(f, (index) => edit(entryOf(index, "baram-word-count")));
    const { output, status } = runStep(COMPARE_STEP, f);
    expect(status).not.toBe(0);
    expect(output).toContain(
      "the baram-word-count entry has a field the index script would not write",
    );
  });

  it("README 가 artifact 에 없는데 항목이 가리키면 거부한다", async () => {
    const f = await fixture("plugin", { readme: true });
    rmSync(join(f.release, "readme"), { recursive: true });
    const { output, status } = runStep(COMPARE_STEP, f);
    expect(status).not.toBe(0);
    expect(output).toContain("is not the one its archive's manifest makes");
  });

  it("테마 항목의 미리보기가 light/dark 팔레트가 아니면 거부한다", async () => {
    const f = await fixture("theme");
    editIndex(f, (index) => {
      entryOf(index, "baram-hangul").preview = { sepia: { a: "#000" } };
    });
    const { output, status } = runStep(COMPARE_STEP, f);
    expect(status).not.toBe(0);
    expect(output).toContain("preview is not a light/dark palette");
  });

  it("이 id 가 두 번 실려 있으면 거부한다", async () => {
    const f = await fixture("plugin");
    editIndex(f, (index) => {
      index.plugins.push({ ...entryOf(index, "baram-word-count") });
    });
    const { output, status } = runStep(COMPARE_STEP, f);
    expect(status).not.toBe(0);
    expect(output).toContain("lists baram-word-count other than exactly once");
  });

  // R9.3 — COUNT 검사가 타입 검사보다 앞에 있어야 하는 이유: 이 id 의 항목이 통째로 없으면, 타입
  // 검사의 `jq -e '(.plugins[] | select(.id == $id)) as $e | …'` 는 빈 generator 위에서 실행되어
  // "필드가 있다" 는 오진으로 거부한다. COUNT 검사가 앞서면 count 0 을 "exactly once 가 아님" 으로
  // 정확히 짚는다. ④는 이 id 의 항목을 라이브·새 색인 양쪽에서 지우고 비교하므로, 새 색인에서만
  // 이 항목을 지우면 ④는 그 차이를 보지 못하고 COUNT 검사가 먼저 닿는다.
  it("이 id 의 항목이 새 색인에 없으면 COUNT 검사가 거부한다", async () => {
    const f = await fixture("plugin");
    editIndex(f, (index) => {
      index.plugins = index.plugins.filter((p) => p.id !== "baram-word-count");
    });
    const { output, status } = runStep(COMPARE_STEP, f);
    expect(status).not.toBe(0);
    expect(output).toContain("lists baram-word-count other than exactly once");
  });

  it("updatedAt 이 날짜가 아니면 거부한다", async () => {
    const f = await fixture("plugin");
    editIndex(f, (index) => {
      index.updatedAt = "yesterday";
    });
    const { output, status } = runStep(COMPARE_STEP, f);
    expect(status).not.toBe(0);
    expect(output).toContain("updatedAt is not a date");
  });

  // M5 — jq 의 `$` 는 문자열 끝 개행 앞에서도 맞는다. `length == 10` 이 없으면
  // `"2026-10-03\n"` 도 날짜로 통과한다.
  it("updatedAt 뒤에 개행이 있으면 거부한다", async () => {
    const f = await fixture("plugin");
    editIndex(f, (index) => {
      index.updatedAt = `${index.updatedAt as string}\n`;
    });
    const { output, status } = runStep(COMPARE_STEP, f);
    expect(status).not.toBe(0);
    expect(output).toContain("updatedAt is not a date");
  });

  // M6 — ⑤의 재구성 불일치를 테마 항목에서도 짚는다.
  it("테마 항목의 이름이 바뀌면 거부한다", async () => {
    const f = await fixture("theme");
    editIndex(f, (index) => {
      entryOf(index, "baram-hangul").name = "Something Else";
    });
    const { output, status } = runStep(COMPARE_STEP, f);
    expect(status).not.toBe(0);
    expect(output).toContain("is not the one its archive's manifest makes");
  });

  // I1(R8) — ④·⑤는 jq 가 파싱한 "뜻"만 보고 bytes 모양만 짚었다; 숫자 범위나 중첩 깊이처럼 jq 는
  // 받고 앱의 `serde_json::from_slice` 는 거부하는 값은 canonical-bytes 검사를 그대로 통과했다.
  // `keywords: [1E+1000]` 은 전체 문서를 "number out of range" 로, 130 단 중첩은
  // "recursion limit exceeded" 로 깨뜨린다 — 값을 JSON 으로 표현 가능하게 유지해(지수 없이) 시험이
  // canonical-bytes 검사가 아니라 이 새 타입 검사에 닿게 한다.
  it.each([
    ["keywords 원소가 문자열이 아님", { keywords: [1] }],
    ["keywords 가 중첩됨", { keywords: [["word"]] }],
    ["name 이 문자열이 아님", { name: 5 }],
    ["capabilities 원소 하나가 문자열이 아님", { capabilities: ["events", 3] }],
  ] as const)("이 릴리스의 항목에 %s 이면 거부한다", async (_, override) => {
    const f = await craftedFixture("plugin", {
      ...PLUGIN_MANIFEST,
      ...override,
    });
    const { output, status } = runStep(COMPARE_STEP, f);
    expect(status).not.toBe(0);
    expect(output).toContain(
      "the baram-word-count entry has a field the index script would not write",
    );
  });

  // I1(R8) — 클라이언트는 index 를 `MAX_REGISTRY_BYTES`(4 MiB)로 자르는데, publish 잡에는 크기
  // 관문이 없었다. zip 매니페스트와 항목 둘 다에 1.1 MB `description` 을 실어, 모든 릴리스를 위해
  // 매번 가져오는 그 문서 하나를 너무 크게 만든다 — 아직 타입은 문자열이라 엔트리 타입 검사(R8)는
  // 통과하고, 이 크기 관문만 짚는다.
  it("새 index.json 이 1 MiB 를 넘으면 거부한다", async () => {
    const f = await craftedFixture("plugin", {
      ...PLUGIN_MANIFEST,
      description: "x".repeat(1_100_000),
    });
    const { output, status } = runStep(COMPARE_STEP, f);
    expect(status).not.toBe(0);
    expect(output).toContain("the new index.json is over 1 MiB");
  });

  // 계획 0115 N6 — F3 가 크기 관문을 두 jq 파싱보다 앞에 옮겼지만, 그 순서를 직접 짚는 시험이
  // 없었다. index 를 COMPACT(들여쓰기 없음) 로 지어 jq 의 canonical 2-space 형태와도 다르게
  // 만든다 — 크기 관문이 canonical 검사보다 뒤에서 돌면 이 케이스는 "is not in the form the
  // index script writes" 로 거부되어 이 시험이 그 순서 결함을 못 잡는다.
  it("새 index.json 이 1 MiB 를 넘고 canonical 형태도 아니면 — 크기 메시지로 거부한다", async () => {
    const f = await craftedFixture(
      "plugin",
      { ...PLUGIN_MANIFEST, description: "x".repeat(1_100_000) },
      { compact: true },
    );
    const { output, status } = runStep(COMPARE_STEP, f);
    expect(status).not.toBe(0);
    expect(output).toContain("the new index.json is over 1 MiB");
  });
});

describe("빌드 잡이 publish 에 넘기는 것", () => {
  // 계획 0115 P8 — 두 잡의 스테이지 본문은 같다. 무엇이 이것을 실패시키는가: 한쪽만 고치면.
  it("두 빌드 잡의 스테이지 스크립트는 글자 그대로 같다", () => {
    expect(stepScript(PLUGIN_STAGE)).toContain('STAGE="$RUNNER_TEMP/release"');
    expect(stepScript(THEME_STAGE)).toBe(stepScript(PLUGIN_STAGE));
  });

  it.each([
    [
      "README 있음",
      true,
      [
        "index.json",
        "plugins/baram-word-count-2.1.0.zip",
        "readme/baram-word-count-2.1.0.md",
      ],
    ],
    [
      "README 없음",
      false,
      ["index.json", "plugins/baram-word-count-2.1.0.zip"],
    ],
  ] as const)(
    "스테이지는 클론에서 이 릴리스의 파일만 옮긴다 — %s",
    (_, readme, expected) => {
      const runnerTemp = mkdtempSync(join(tmpdir(), "baram-stage-"));
      const registry = join(runnerTemp, "registry");
      mkdirSync(join(registry, "plugins"), { recursive: true });
      mkdirSync(join(registry, "readme"), { recursive: true });
      writeFileSync(join(registry, "index.json"), "{}");
      writeFileSync(
        join(registry, "plugins", "baram-word-count-2.1.0.zip"),
        "zip",
      );
      writeFileSync(
        join(registry, "plugins", "baram-other-1.0.0.zip"),
        "other",
      );
      writeFileSync(join(registry, "readme", "baram-other-1.0.0.md"), "other");
      if (readme) {
        writeFileSync(
          join(registry, "readme", "baram-word-count-2.1.0.md"),
          "r",
        );
      }
      const result = spawnSync("bash", ["-e", "-c", stepScript(PLUGIN_STAGE)], {
        encoding: "utf8",
        env: {
          ...process.env,
          ID: "baram-word-count",
          RUNNER_TEMP: runnerTemp,
          VERSION: "2.1.0",
          ZIP_NAME: "baram-word-count-2.1.0.zip",
        },
      });
      expect(result.status, result.stderr).toBe(0);
      const staged = readdirSync(join(runnerTemp, "release"), {
        recursive: true,
        withFileTypes: true,
      })
        .filter((d) => d.isFile())
        .map((d) =>
          join(d.parentPath, d.name).slice(
            join(runnerTemp, "release").length + 1,
          ),
        )
        .sort();
      expect(staged).toEqual([...expected].sort());
    },
  );

  it("artifact 액션은 SHA 로 핀하고, 빌드 둘은 올리고 publish 하나는 받는다", () => {
    const UPLOAD =
      "uses: actions/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a # v7.0.1";
    const DOWNLOAD =
      "uses: actions/download-artifact@3e5f45b2cfb9172054b4087a40e8e0b5a5461e7c # v8.0.1";
    expect(jobText("release")).toContain(UPLOAD);
    expect(jobText("release-theme")).toContain(UPLOAD);
    expect(jobText("publish")).toContain(DOWNLOAD);
    expect(WORKFLOW.match(/actions\/upload-artifact@/g)).toHaveLength(2);
    expect(WORKFLOW.match(/actions\/download-artifact@/g)).toHaveLength(1);
  });
});

const PUSH_STEP = "Push the release to the registry repo";
const KEY_LINE = "DEPLOY_KEY: ${{ secrets.PLUGINS_DEPLOY_KEY }}";

/**
 * GitHub 이 공개한 SSH 호스트 키(`gh api meta --jq '.ssh_keys[]'`, 2026-10-03)와 그 지문
 * (`.ssh_key_fingerprints`). 워크플로가 이 셋을 `UserKnownHostsFile` 로 고정한다(스펙 D8).
 */
const GITHUB_SSH_KEYS: readonly (readonly [string, string])[] = [
  [
    "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIOMqqnkVzrm0SdG6UOoqKLsabgH5C9okWi0dh2l9GKJl",
    "+DiY3wvvV6TuJJhbpZisF/zLDA0zPMSvHdkr4UvCOqU",
  ],
  [
    "ecdsa-sha2-nistp256 AAAAE2VjZHNhLXNoYTItbmlzdHAyNTYAAAAIbmlzdHAyNTYAAABBBEmKSENjQEezOmxkZMy7opKgwFB9nkt5YRrYMjNuG5N87uRgg6CLrbo5wAdT/y6v0mKV0U2w0WZ2YB/++Tpockg=",
    "p2QAMXNIC1TJYWeIOttrVc98/R1BUFWu3/LiyKgUfQM",
  ],
  [
    "ssh-rsa AAAAB3NzaC1yc2EAAAADAQABAAABgQCj7ndNxQowgcQnjshcLrqPEiiphnt+VTTvDP6mHBL9j1aNUkY4Ue1gvwnGLVlOhGeYrnZaMgRK6+PKCUXaDbC7qtbW8gIkhL7aGCsOr/C56SJMy/BCZfxd1nWzAOxSDPgVsmerOBYfNqltV9/hWCqBywINIR+5dIg6JTJ72pcEpEjcYgXkE2YEFXV1JHnsKgbLWNlhScqb2UmyRkQyytRLtL+38TGxkxCflmO+5Z8CSSNY7GidjMIZ7Q4zMjA2n1nGrlTDkzwDCsw+wqFPGQA179cnfGWOWRVruj16z6XyvxvjJwbz0wQZ75XK5tKSb7FNyeIEs4TT4jk+S4dhPeAUC5y+bDYirYgM4GC7uEnztnZyaVWQ7B381AK4Qdrwt51ZqExKbQpTUNn+EjqoTwvqNj4kqx5QUCI0ThS/YkOxJCXmPUWZbhjpCg56i+2aB6CmK2JGhn57K5mj0MNdBXA4/WnwH6XoPWJzK5Nyu2zB3nAZp+S5hpQs+p1vN1/wsjk=",
    "uNiVztksCsDhcc0u9e8BujQXVUpKZIDTMczCvj3tD2s",
  ],
];

const FAKE_KEY =
  "-----BEGIN OPENSSH PRIVATE KEY-----\nfake\n-----END OPENSSH PRIVATE KEY-----";

/**
 * push 단계를 가짜 `git` 으로 실행한다 — PATH 앞에 둔 셸 스크립트가 인자를 적고, push 때 키 파일의
 * 권한 · 내용과 `GIT_SSH_COMMAND` 를 남긴다. `diff --cached --quiet` 는 `nothing` 이면 0(바뀐 것 없음).
 */
function runPush(f: Fixture, opts: { nothing?: boolean } = {}) {
  const bin = join(f.runnerTemp, "bin");
  mkdirSync(bin, { recursive: true });
  const log = join(f.runnerTemp, "git.log");
  writeFileSync(
    join(bin, "git"),
    [
      "#!/bin/bash",
      `echo "git $*" >> "${log}"`,
      'if [[ "$1" == "push" ]]; then',
      `  ls -ln "$RUNNER_TEMP/registry_deploy_key" | cut -c1-10 >> "${log}"`,
      '  cp "$RUNNER_TEMP/registry_deploy_key" "$RUNNER_TEMP/key-at-push"',
      `  echo "ssh: $GIT_SSH_COMMAND" >> "${log}"`,
      "fi",
      `if [[ "$1" == "diff" ]]; then exit ${opts.nothing ? 0 : 1}; fi`,
      "exit 0",
    ].join("\n"),
    { mode: 0o755 },
  );
  const result = spawnSync("bash", ["-e", "-c", stepScript(PUSH_STEP)], {
    cwd: f.runnerTemp,
    encoding: "utf8",
    env: {
      ...process.env,
      ...f.env,
      DEPLOY_KEY: FAKE_KEY,
      PATH: `${bin}:${process.env.PATH ?? ""}`,
      REGISTRY_REPO: "sayinel/baram-plugins",
      RUNNER_TEMP: f.runnerTemp,
    },
  });
  return {
    log: existsSync(log) ? readFileSync(log, "utf8") : "",
    output: result.stderr + result.stdout,
    status: result.status,
  };
}

describe("publish — 키를 쥐는 단계를 실행한다", () => {
  it("이 릴리스의 파일만 클론에 옮기고, 고정한 호스트 키로 push 한 뒤 키 파일을 지운다", async () => {
    const f = await fixture("plugin", { readme: true });
    // 검사를 지난 뒤에 무엇이 끼어들어도 push 는 이름을 대고 옮긴다 — 방어의 두 번째 겹.
    writeFileSync(join(f.release, "plugins", "stray.zip"), "x");
    const { log, output, status } = runPush(f);
    expect(status, output).toBe(0);
    expect(log).toContain(
      "git remote set-url origin git@github.com:sayinel/baram-plugins.git",
    );
    expect(log).toContain(
      "git add plugins/baram-word-count-2.1.0.zip index.json",
    );
    expect(log).toContain("git add readme/baram-word-count-2.1.0.md");
    expect(log).toContain("git commit -m release: baram-word-count 2.1.0");
    expect(log).toContain("git push origin main");
    expect(log).toContain("-rw-------");
    expect(log).toContain("StrictHostKeyChecking=yes");
    expect(log).toContain("IdentitiesOnly=yes");
    // I1(R11) — `UserKnownHostsFile` alone replaces only the user file; ssh still reads
    // `GlobalKnownHostsFile` (typically pre-seeded with `ssh-keyscan` on the runner image), and
    // with StrictHostKeyChecking=yes accepts a key found in EITHER file. Pointing the global file
    // at /dev/null makes the pinned set in `$KNOWN_HOSTS` the only one ssh can match against.
    expect(log).toContain(`-i '${join(f.runnerTemp, "registry_deploy_key")}'`);
    expect(log).toContain(
      `UserKnownHostsFile='${join(f.runnerTemp, "github_known_hosts")}'`,
    );
    expect(log).toContain("GlobalKnownHostsFile=/dev/null");
    // OpenSSH 는 끝 줄바꿈 없는 키 파일을 거부한다(revocation-publish.yml, 2026-09-26 실측).
    expect(readFileSync(join(f.runnerTemp, "key-at-push"), "utf8")).toBe(
      `${FAKE_KEY}\n`,
    );
    expect(existsSync(join(f.runnerTemp, "registry_deploy_key"))).toBe(false);
    const known = readFileSync(
      join(f.runnerTemp, "github_known_hosts"),
      "utf8",
    );
    expect(known).toBe(
      `${GITHUB_SSH_KEYS.map(([key]) => `github.com ${key}`).join("\n")}\n`,
    );
    const registry = join(f.runnerTemp, "registry");
    expect(readFileSync(join(registry, "index.json"), "utf8")).toBe(
      readFileSync(join(f.release, "index.json"), "utf8"),
    );
    expect(existsSync(join(registry, "plugins", "stray.zip"))).toBe(false);
    expect(
      existsSync(join(registry, "readme", "baram-word-count-2.1.0.md")),
    ).toBe(true);
  });

  it("레지스트리에 이미 같은 릴리스가 있으면 커밋 없이 끝나고, 키 파일은 그래도 지운다", async () => {
    const f = await fixture("theme");
    const { log, output, status } = runPush(f, { nothing: true });
    expect(status, output).toBe(0);
    expect(output).toContain("nothing to publish");
    expect(log).not.toContain("git commit");
    expect(log).not.toContain("git push");
    expect(existsSync(join(f.runnerTemp, "registry_deploy_key"))).toBe(false);
    expect(existsSync(join(f.runnerTemp, "registry", "readme"))).toBe(false);
  });
});

describe("publish — 키가 닿는 자리", () => {
  // 무엇이 이것을 실패시키는가: 키를 다른 잡이나 다른 단계가 읽으면, 또는 키 뒤에 단계가 생기면.
  // `secrets` 를 읽는 모든 줄을 센다 — 키 이름 한 철자만 찾으면 `secrets['…']` · 대소문자 변형 ·
  // `toJSON(secrets)` 가 빠진다(`revocation-publish-gate.test.ts` 와 같은 정규식).
  it("배포 키를 읽는 줄은 publish 잡의 마지막 단계 하나뿐이다", () => {
    const lines = WORKFLOW.split("\n").filter((line) =>
      /secrets\s*[.[]|toJSON\s*\(\s*secrets/iu.test(line),
    );
    expect(lines.map((line) => line.trim())).toEqual([KEY_LINE]);
    const publish = jobText("publish");
    const key = publish.indexOf(KEY_LINE);
    expect(key).toBeGreaterThan(0);
    expect(publish.slice(key).match(/\n {6}- /g)).toBeNull();
  });

  // 키는 환경 `registry-publish` 의 비밀이다(저장소 설정). 무엇이 이것을 실패시키는가: 빌드 잡이
  // 환경을 다시 선언하면 — 그 잡이 키를 받을 수 있게 된다.
  it("registry-publish 환경을 선언하는 잡은 publish 하나다", () => {
    expect(WORKFLOW.split("environment: registry-publish").length - 1).toBe(1);
    expect(jobText("publish")).toContain(
      "\n    environment: registry-publish\n",
    );
  });

  it("publish 잡은 체크아웃도 설치도 node 계열 도구도 쓰지 않는다", () => {
    const code = jobText("publish")
      .split("\n")
      .filter((line) => !line.trim().startsWith("#"))
      .join("\n");
    expect(code).toContain("git push origin main");
    expect(code).not.toMatch(/actions\/checkout|setup-node/);
    expect(code).not.toMatch(/\b(node|npx|npm|tsx|yarn|pnpm|bun)\b/);
    const uses = [...code.matchAll(/uses: (\S+)/g)].map((m) => m[1]);
    expect(uses).toEqual([
      "actions/download-artifact@3e5f45b2cfb9172054b4087a40e8e0b5a5461e7c",
    ]);
  });

  // M3 — "체크아웃도 설치도 node 계열 도구도 쓰지 않는다" 는 거부 목록이라, `publish` 에 새 단계가
  // (`pip install …`, `curl … | sh` 처럼 그 목록 밖의 도구로) 더해져도 통과한다. 단계 목록 자체를
  // 이름과 순서까지 통째로 고정한다 — `publish` 에 단계를 더하거나 빼는 것은 이 시험을 고쳐서
  // 받아들이는 결정이고, 이 시험을 피해서 돌아가는 결정이 아니다.
  it("publish 잡의 단계는 이 다섯뿐이다 — 이름과 순서까지", () => {
    const publish = jobText("publish");
    const names = [...publish.matchAll(/\n {6}- name: (.+)/g)].map((m) => m[1]);
    expect(names).toEqual([
      "Download the release",
      ARTIFACT_STEP,
      "Clone the live registry",
      COMPARE_STEP,
      PUSH_STEP,
    ]);
    // 계획 0115 N4 — `- name:` 만 센 위의 배열은, 이름이 첫 키가 아닌 단계(이름 없는 `- run:`,
    // 또는 `- id:`/`- env:` 가 먼저 오는 단계)를 보지 못한다 — 그런 단계는 "name:" 이라는 부분
    // 문자열을 그 위치에 전혀 남기지 않으므로 names 배열은 여전히 다섯 그대로다. 단계 경계
    // 자체(`\n      - `)를 세어, 더해진 단계가 있으면 이 카운트가 다섯을 넘는 것으로 잡는다.
    const stepCount = [...publish.matchAll(/\n {6}- /g)].length;
    expect(stepCount).toBe(names.length);
  });

  it("publish 는 두 meta · 두 빌드를 기다리고, 빌드 하나가 성공했을 때만 돈다", () => {
    const text = jobText("publish");
    expect(text).toContain(
      "\n    needs: [plugin-meta, release, theme-meta, release-theme]\n",
    );
    expect(text).toContain(
      "if: ${{ !cancelled() && !failure() && (needs.release.result == 'success' || needs.release-theme.result == 'success') }}",
    );
  });

  it("push 단계는 호스트 키를 고정하고, 키 파일을 새로 만들어 끝에 지우며, `${{` 를 싣지 않는다", () => {
    const push = stepScript(PUSH_STEP);
    expect(push).not.toContain("ssh-keyscan");
    expect(push).not.toContain("${{");
    expect(push).toContain("StrictHostKeyChecking=yes");
    expect(push).toContain('install -m 600 /dev/null "$KEY"');
    expect(push).toContain(`trap 'rm -f "$KEY"' EXIT`);
    for (const [key] of GITHUB_SSH_KEYS) {
      expect(push).toContain(`"github.com ${key}"`);
    }
  });

  // 무엇이 이것을 실패시키는가: 고정한 키에 한 글자 오타가 나면 — push 는 호스트 검증에서 멈출 뿐
  // 이 파일의 다른 시험은 모른다. GitHub 이 공개한 지문과 맞춰 본다.
  it.each(GITHUB_SSH_KEYS)(
    "고정한 %s 는 GitHub 이 공개한 지문과 맞다",
    (key, fingerprint) => {
      const blob = Buffer.from(key.split(" ")[1], "base64");
      const actual = createHash("sha256")
        .update(blob)
        .digest("base64")
        .replace(/=+$/, "");
      expect(actual).toBe(fingerprint);
    },
  );

  it("빌드 잡은 환경 없이 돈다", () => {
    for (const job of [
      "plugin-meta",
      "release",
      "theme-meta",
      "release-theme",
    ]) {
      expect(jobText(job), job).not.toContain("environment:");
    }
  });
});
