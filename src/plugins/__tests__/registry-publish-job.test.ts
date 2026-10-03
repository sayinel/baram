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
  const writer = new ZipWriter(new Uint8ArrayWriter());
  for (const [name, text] of Object.entries(files)) {
    await writer.add(name, new TextReader(text));
  }
  return Buffer.from(await writer.close());
}

const sha256 = (bytes: Buffer) =>
  createHash("sha256").update(bytes).digest("hex");

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
    manifest?: Record<string, unknown>;
    manifestPath?: string;
    manifestText?: string;
    readme?: boolean;
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
  const files: Record<string, string> = {
    [manifestZipPath]:
      opts.manifestText ?? `${JSON.stringify(zipManifest, null, 2)}\n`,
  };
  if (opts.readme) files["README.md"] = "# Word Count\n";
  const zip = await zipOf(files);
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
    writeFileSync(join(release, "readme", readmeName), "# Word Count\n");
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

  return {
    env: {
      BASE_URL,
      CHECKSUM: checksum,
      EXPECTED_TRUST: kind === "plugin" ? PLUGIN_MANIFEST.trust : "",
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
  it("맨 위 plugins 키가 두 번(둘째가 honest) 있으면 거부한다", async () => {
    const f = await fixture("plugin");
    const index = JSON.parse(
      readFileSync(join(f.release, "index.json"), "utf8"),
    );
    const honestPlugins = JSON.stringify(index.plugins);
    const raw = `{"plugins":[],"plugins":${honestPlugins},"updatedAt":${JSON.stringify(index.updatedAt)}}\n`;
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

  it("이 릴리스 항목 안에 trust 키가 두 번(둘째가 honest) 있으면 거부한다", async () => {
    const f = await fixture("plugin");
    const index = JSON.parse(
      readFileSync(join(f.release, "index.json"), "utf8"),
    );
    const entryTexts = (index.plugins as Record<string, unknown>[]).map((p) => {
      if (p.id !== "baram-word-count") return JSON.stringify(p);
      const { trust, ...rest } = p;
      const withoutTrust = JSON.stringify(rest);
      return `${withoutTrust.slice(0, -1)},"trust":"trusted","trust":${JSON.stringify(trust)}}`;
    });
    const raw = `{"plugins":[${entryTexts.join(",")}],"updatedAt":${JSON.stringify(index.updatedAt)}}\n`;
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
      "색인 스크립트가 쓰지 않는 필드",
      (e: Record<string, unknown>) => {
        e.homepage = "https://example.com";
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
      "the baram-word-count entry is not the one its archive's manifest makes",
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
