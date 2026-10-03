// §371 6b-2 — `plugin-release.yml` 의 `release-theme` 잡(스펙 0063 §7.3).
//
// 단계는 **실행해서** 본다 — 이 워크플로의 플러그인 쪽이 텍스트 스캔을 다섯 번 우회당한 뒤 굳힌
// 규칙이다(`malicious-fixture.test.ts`). 이 파일이 `run: |` 본문을 bash 로 실행하는 단계는 다섯이다:
// 태그 단계 `Parse and verify the theme tag`(`runTagStep`), 기록 단계 `Read the checksum the
// pre-publish check recorded`(`runRecordStep`), 대조 단계 `Check the archive against the recorded
// checksum`(`runCompareStep`), 묶기 `Package the theme` 와 다시 검증 `Verify the packaged theme is
// the theme that was verified`(둘 다 `runPackageAndVerify`). 그 단계가 부르는 스크립트의 경우들(묶기 ·
// 다시 검증 · 색인)은 `theme-package-script.test.ts` 와 `theme-registry-chain.test.ts` 가 본다 — 묶기 ·
// 다시 검증은 함수를 직접 부르고, 색인과 그 검증은 스크립트를 띄운다.
//
// 비밀이 닿는 자리 · push 스크립트의 단언은 키가 `publish` 잡 하나로 옮긴 뒤
// `src/plugins/__tests__/registry-publish-job.test.ts` 로 갔다(§69, 계획 0115). 두 push 본문을
// 대조하던 단언은 거기로 간 게 아니라 지웠다 — push 가 `publish` 하나로 합쳐져 비교할 둘째 본문이
// 없고, registry-publish-job.test.ts 에도 그런 대조는 없다. 이 파일에는 더 없다.
//
// 나머지는 텍스트 단언이고 "실행할 수 없는 배선" describe 에 모여 있다. 그 종류는 다섯이다 — 잡
// 조건(태그 트리거와 네 잡의 `if:`, 그리고 `needs`), meta 잡 둘이 체크아웃과 판정만 도는가, 단계
// 사이의 출력 배선(기록 단계의 자리와 세 env · theme-meta 의 두 출력, 대조 단계의 자리와 네 env),
// 테마 잡이 `examples/themes` 에 `$DIR` 로만 닿음, 색인 단계의 두 env.

import { spawnSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const WORKFLOW = readFileSync(
  resolve(__dirname, "../../../.github/workflows/plugin-release.yml"),
  "utf8",
);

/** 한 잡의 본문 — `  <name>:` 줄부터 다음 잡(두 칸 들여쓴 키) 앞까지. */
function jobText(name: string): string {
  const start = WORKFLOW.indexOf(`\n  ${name}:\n`);
  if (start < 0) throw new Error(`no job named ${name}`);
  const rest = WORKFLOW.slice(start + 1);
  const next = rest.slice(1).search(/\n {2}[\w-]+:\n/);
  return next < 0 ? rest : rest.slice(0, next + 1);
}

/** `- name: <stepName>` 단계의 `run: |` 블록(열 칸 들여쓰기) — 플러그인 쪽 테스트와 같은 추출. */
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

const git = (cwd: string, ...args: string[]) =>
  spawnSync("git", args, { cwd, encoding: "utf8" });

/**
 * 태그 단계를 합성한 저장소에서 돌린다 — 그 단계가 읽는 것은 매니페스트 하나와 git 이력뿐이다.
 * `onMain: false` 면 태그 커밋이 `origin/main` 의 조상이 아니다.
 */
function runTagStep(opts: {
  dir?: string;
  onMain?: boolean;
  tag: string;
  withManifest?: boolean;
}): { output: string; outputs: string; status: null | number } {
  const root = mkdtempSync(join(tmpdir(), "baram-theme-tag-"));
  git(root, "init", "-q");
  git(
    root,
    "-c",
    "user.email=t@t",
    "-c",
    "user.name=t",
    "commit",
    "-q",
    "--allow-empty",
    "-m",
    "main",
  );
  git(root, "update-ref", "refs/remotes/origin/main", "HEAD");
  if (opts.withManifest !== false) {
    const dir = join(root, "examples", "themes", opts.dir ?? "hangul");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "baram-theme.json"), "{}");
  }
  if (opts.onMain === false) {
    git(
      root,
      "-c",
      "user.email=t@t",
      "-c",
      "user.name=t",
      "commit",
      "-q",
      "--allow-empty",
      "-m",
      "side",
    );
  }
  const outputPath = join(root, "output");
  writeFileSync(outputPath, "");
  const result = spawnSync(
    "bash",
    ["-e", "-c", stepScript("Parse and verify the theme tag")],
    {
      cwd: root,
      encoding: "utf8",
      env: {
        ...process.env,
        GITHUB_OUTPUT: outputPath,
        GITHUB_REF_NAME: opts.tag,
        GITHUB_SHA: "HEAD",
      },
    },
  );
  return {
    output: result.stderr + result.stdout,
    outputs: readFileSync(outputPath, "utf8"),
    status: result.status,
  };
}

describe("theme-meta — 태그 단계를 실행한다", () => {
  it("허용된 디렉터리를 통과시키고, 그 디렉터리의 id 를 함께 내보낸다", () => {
    const { outputs, status } = runTagStep({ tag: "theme-hangul-v1.0.0" });
    expect(status).toBe(0);
    expect(outputs).toBe(
      "dir=hangul\nversion=1.0.0\nexpected_id=baram-hangul\n",
    );
  });

  it.each([
    [
      "theme-other-v1.0.0",
      "not in this workflow's publishable theme allowlist",
    ],
    ["theme-hangul-1.0.0", "does not match theme-<dir>-v<semver>"],
    ["plugin-word-count-v1.0.0", "does not match theme-<dir>-v<semver>"],
    ["theme-hangul-v1.0", "does not match theme-<dir>-v<semver>"],
  ])("%s 를 거부한다", (tag, message) => {
    const { output, status } = runTagStep({
      tag,
      dir: tag.startsWith("theme-other") ? "other" : "hangul",
    });
    expect(status).not.toBe(0);
    expect(output).toContain(`::error::`);
    expect(output).toContain(message);
  });

  it("매니페스트가 없으면 거부한다", () => {
    const { output, status } = runTagStep({
      tag: "theme-hangul-v1.0.0",
      withManifest: false,
    });
    expect(status).not.toBe(0);
    expect(output).toContain(
      "no manifest at examples/themes/hangul/baram-theme.json",
    );
  });

  it("main 에 없는 커밋의 태그를 거부한다", () => {
    const { output, status } = runTagStep({
      onMain: false,
      tag: "theme-hangul-v1.0.0",
    });
    expect(status).not.toBe(0);
    expect(output).toContain("is not on main");
  });
});

const RECORD_STEP = "Read the checksum the pre-publish check recorded";
const COMPARE_STEP = "Check the archive against the recorded checksum";
const SUM = "a".repeat(64);
const ZIP = "baram-hangul-1.0.0.zip";

/** theme-meta 의 기록 단계를 합성 폴더에서 돌린다 — 그 단계가 읽는 것은 `SHA256SUMS` 하나뿐이다. */
function runRecordStep(opts: {
  env?: Record<string, string>;
  link?: boolean;
  sums?: string;
}): { output: string; outputs: string; status: null | number } {
  const root = mkdtempSync(join(tmpdir(), "baram-theme-sums-"));
  const dir = join(root, "examples", "themes", "hangul");
  mkdirSync(dir, { recursive: true });
  if (opts.sums !== undefined) {
    const target = opts.link
      ? join(root, "elsewhere")
      : join(dir, "SHA256SUMS");
    writeFileSync(target, opts.sums);
    if (opts.link) symlinkSync(target, join(dir, "SHA256SUMS"));
  }
  const outputPath = join(root, "output");
  writeFileSync(outputPath, "");
  const result = spawnSync("bash", ["-e", "-c", stepScript(RECORD_STEP)], {
    cwd: root,
    encoding: "utf8",
    env: {
      ...process.env,
      DIR: "hangul",
      EXPECTED_ID: "baram-hangul",
      VERSION: "1.0.0",
      ...opts.env,
      GITHUB_OUTPUT: outputPath,
    },
  });
  return {
    output: result.stderr + result.stdout,
    outputs: readFileSync(outputPath, "utf8"),
    status: result.status,
  };
}

describe("theme-meta — 게시 전 점검이 기록한 checksum 을 읽는다", () => {
  it("이 zip 의 줄 하나를 읽어 낸다 — 다른 버전의 줄과 섞여 있어도", () => {
    const { output, outputs, status } = runRecordStep({
      sums: `${"b".repeat(64)}  baram-hangul-0.9.0.zip\n${SUM}  ${ZIP}\n`,
    });
    expect(status, output).toBe(0);
    expect(outputs).toContain(`zip_name=${ZIP}\n`);
    expect(outputs).toContain(`recorded_sha256=${SUM}\n`);
  });

  it("끝 줄바꿈이 없는 마지막 줄도 읽는다", () => {
    const { output, outputs, status } = runRecordStep({
      sums: `${SUM}  ${ZIP}`,
    });
    expect(status, output).toBe(0);
    expect(outputs).toContain(`recorded_sha256=${SUM}\n`);
  });

  it("SHA256SUMS 가 없으면 무엇을 할지 말하며 거부한다", () => {
    const { output, status } = runRecordStep({});
    expect(status).not.toBe(0);
    expect(output).toContain("::error::");
    expect(output).toContain("examples/themes/hangul/SHA256SUMS");
    expect(output).toContain("record the pre-publish check's sha256");
  });

  // 무엇이 이것을 실패시키는가: 줄을 부분 문자열이나 정규식으로 대조하면 — 맞는 줄을 품은 줄(이름이
  // 더 긴 줄, 주석으로 막은 줄)이나, 버전의 점이 다른 글자인 이름이 통과한다(계획 0115 P4).
  it.each([
    ["다른 버전의 줄뿐", `${SUM}  baram-hangul-0.9.0.zip\n`],
    ["공백 하나로 적은 줄", `${SUM} ${ZIP}\n`],
    ["이 zip 의 이름에 덧붙은 줄뿐", `${SUM}  ${ZIP}.old\n`],
    ["주석으로 막은 줄뿐", `# ${SUM}  ${ZIP}\n`],
    ["대문자 해시", `${"A".repeat(64)}  ${ZIP}\n`],
    ["63자 해시", `${"a".repeat(63)}  ${ZIP}\n`],
    ["점이 다른 글자인 이름", `${SUM}  baram-hangul-1x0x0.zip\n`],
  ])("%s 이면 거부한다", (_, sums) => {
    const { output, status } = runRecordStep({ sums });
    expect(status).not.toBe(0);
    expect(output).toContain("::error::");
    expect(output).toContain(`has no line "<sha256>  ${ZIP}"`);
  });

  it("이 zip 의 줄이 둘이면 거부한다 — 해시가 같아도, 어느 것이 점검한 기록인지 모른다", () => {
    const { output, status } = runRecordStep({
      sums: `${SUM}  ${ZIP}\n${SUM}  ${ZIP}\n`,
    });
    expect(status).not.toBe(0);
    expect(output).toContain(`has 2 lines for ${ZIP}`);
  });

  it("SHA256SUMS 가 심볼릭 링크면 맞는 줄을 가리켜도 거부한다", () => {
    const { output, status } = runRecordStep({
      link: true,
      sums: `${SUM}  ${ZIP}\n`,
    });
    expect(status).not.toBe(0);
    expect(output).toContain("is not a regular file");
  });

  it("앞 단계의 값이 비어 닿으면 워크플로의 버그라고 말한다", () => {
    const { output, status } = runRecordStep({
      env: { EXPECTED_ID: "" },
      sums: `${SUM}  -1.0.0.zip\n`,
    });
    expect(status).not.toBe(0);
    expect(output).toContain("this is a bug in this workflow");
  });
});

/** release-theme 의 대조 단계 — 만든 zip 의 이름 · 해시를 theme-meta 가 읽은 기록과 비교한다. */
function runCompareStep(env: Record<string, string>): {
  output: string;
  status: null | number;
} {
  const result = spawnSync("bash", ["-e", "-c", stepScript(COMPARE_STEP)], {
    encoding: "utf8",
    env: {
      ...process.env,
      CHECKSUM: SUM,
      RECORDED_SHA256: SUM,
      RECORDED_ZIP_NAME: ZIP,
      ZIP_NAME: ZIP,
      ...env,
    },
  });
  return { output: result.stderr + result.stdout, status: result.status };
}

describe("release-theme — 만든 zip 을 기록과 대조한다", () => {
  it("이름과 해시가 기록과 같으면 통과한다", () => {
    const { output, status } = runCompareStep({});
    expect(status, output).toBe(0);
  });

  it("해시가 다르면 점검한 zip 이 아니라며 거부한다", () => {
    const { output, status } = runCompareStep({ CHECKSUM: "c".repeat(64) });
    expect(status).not.toBe(0);
    expect(output).toContain(
      "the archive built here is not the one the pre-publish check installed",
    );
  });

  it("이름이 다르면 거부한다", () => {
    const { output, status } = runCompareStep({
      RECORDED_ZIP_NAME: "baram-hangul-0.9.0.zip",
    });
    expect(status).not.toBe(0);
    expect(output).toContain("the recorded line is for");
  });

  // 무엇이 이것을 실패시키는가: 빈 값 관문이 없으면 — 빈 해시 둘은 같다고 판정된다.
  it("값이 비어 닿으면 워크플로의 버그라고 말한다", () => {
    const { output, status } = runCompareStep({
      CHECKSUM: "",
      RECORDED_SHA256: "",
    });
    expect(status).not.toBe(0);
    expect(output).toContain("this is a bug in this workflow");
  });
});

describe("release-theme — 실행할 수 없는 배선", () => {
  it("태그 모양마다 meta 잡과 빌드 잡 한 쌍만 돌고, 빌드는 meta 를 기다린다", () => {
    expect(WORKFLOW).toMatch(/tags: \['plugin-\*', 'theme-\*'\]/);
    for (const job of ["plugin-meta", "release"]) {
      expect(jobText(job), job).toContain(
        "if: startsWith(github.ref_name, 'plugin-')",
      );
    }
    for (const job of ["theme-meta", "release-theme"]) {
      expect(jobText(job), job).toContain(
        "if: startsWith(github.ref_name, 'theme-')",
      );
    }
    expect(jobText("release")).toContain("\n    needs: plugin-meta\n");
    expect(jobText("release-theme")).toContain("\n    needs: theme-meta\n");
  });

  // 스펙 0065 D2 — 무엇이 이것을 실패시키는가: meta 잡에 설치나 node 계열 도구가 들어오면. 그 잡의
  // 출력은 publish 잡이 artifact 를 묶는 기준이라, 서드파티 코드가 돌면 기준이 오염된다.
  it.each([
    ["plugin-meta", "Parse and verify tag"],
    ["theme-meta", "Parse and verify the theme tag"],
  ])("%s 는 체크아웃과 판정만 돈다", (job, step) => {
    const text = jobText(job);
    expect(text).toContain(`- name: ${step}\n`);
    const code = text
      .split("\n")
      .filter((line) => !line.trim().startsWith("#"))
      .join("\n");
    expect(code).not.toMatch(/setup-node|\b(npm|npx|tsx|yarn|pnpm|bun)\b/);
    const uses = [...code.matchAll(/uses: (\S+)/g)].map((m) => m[1]);
    expect(uses).toEqual([
      "actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1",
    ]);
  });

  // 계획 0115 F6 — 위는 거부 목록(설치 도구가 없다)이라 세 번째 단계가 더해져도 통과한다. 여기는
  // 각 meta 잡의 단계 목록을 이름과 순서까지 통째로 고정한다 — `publish` 잡에 쓴 것과 같은 장치
  // (`registry-publish-job.test.ts` 의 "publish 잡의 단계는 이 다섯뿐이다"). 단계를 더하거나 빼는
  // 것은 이 시험을 고쳐서 받아들이는 결정이다.
  it.each([
    [
      "plugin-meta",
      [
        "actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1",
        "Parse and verify tag",
        "Record the plugin's tagged files",
      ],
    ],
    [
      "theme-meta",
      [
        "actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1",
        "Parse and verify the theme tag",
        RECORD_STEP,
      ],
    ],
  ] as const)("%s 의 단계는 이 셋뿐이다 — 이름과 순서까지", (job, expected) => {
    const steps = [
      ...jobText(job).matchAll(/\n {6}- (?:uses|name): (.+)/g),
    ].map((m) => m[1]);
    expect(steps).toEqual(expected);
  });

  // 무엇이 이것을 실패시키는가: 기록을 태그 단계 앞에서 읽거나, 대조를 checksum 계산 앞이나 색인
  // 쓰기 뒤로 옮기거나, 값을 다른 출력에 묶으면. 위의 실행 케이스는 env 를 직접 넣으므로 이 배선을
  // 보지 못한다.
  it("기록은 theme-meta 의 태그 단계 뒤에서 읽고, 대조는 checksum 계산 뒤 · 색인 쓰기 전에 선다", () => {
    const meta = jobText("theme-meta");
    const metaAt = (name: string) => meta.indexOf(`- name: ${name}\n`);
    expect(metaAt("Parse and verify the theme tag")).toBeGreaterThan(0);
    expect(metaAt(RECORD_STEP)).toBeGreaterThan(
      metaAt("Parse and verify the theme tag"),
    );
    const record = meta.slice(metaAt(RECORD_STEP));
    expect(record).toContain("DIR: ${{ steps.theme_meta.outputs.dir }}");
    expect(record).toContain(
      "EXPECTED_ID: ${{ steps.theme_meta.outputs.expected_id }}",
    );
    expect(record).toContain(
      "VERSION: ${{ steps.theme_meta.outputs.version }}",
    );
    expect(meta).toContain(
      "recorded_sha256: ${{ steps.theme_sums.outputs.recorded_sha256 }}",
    );
    expect(meta).toContain(
      "zip_name: ${{ steps.theme_sums.outputs.zip_name }}",
    );

    const text = jobText("release-theme");
    const at = (name: string) => text.indexOf(`- name: ${name}\n`);
    expect(at("Compute the theme checksum")).toBeGreaterThan(0);
    expect(at(COMPARE_STEP)).toBeGreaterThan(at("Compute the theme checksum"));
    expect(at(COMPARE_STEP)).toBeLessThan(
      at("Update and validate the registry index for the theme"),
    );
    const gate = text.slice(
      at(COMPARE_STEP),
      at("Update and validate the registry index for the theme"),
    );
    expect(gate).toContain(
      "ZIP_NAME: ${{ steps.theme_package.outputs.zip_name }}",
    );
    expect(gate).toContain("CHECKSUM: ${{ steps.theme_sum.outputs.checksum }}");
    expect(gate).toContain(
      "RECORDED_ZIP_NAME: ${{ needs.theme-meta.outputs.zip_name }}",
    );
    expect(gate).toContain(
      "RECORDED_SHA256: ${{ needs.theme-meta.outputs.recorded_sha256 }}",
    );
  });

  it("테마 잡은 examples/themes/ 에 theme-meta 가 검증한 디렉터리로만 닿는다", () => {
    const text = jobText("release-theme");
    const afterTag = text.slice(
      text.indexOf("- uses: ./.github/actions/setup-node"),
    );
    const refs = [...afterTag.matchAll(/examples\/themes\/(\S+?)["/\s]/g)].map(
      (m) => m[1],
    );
    expect(refs.length).toBeGreaterThan(0);
    for (const ref of refs) expect(ref).toBe("$DIR");
    expect(afterTag).toContain("DIR: ${{ needs.theme-meta.outputs.dir }}");
  });

  it("색인은 다시 검증한 아카이브에서 꺼낸 매니페스트와 미리보기로 쓴다", () => {
    const text = jobText("release-theme");
    expect(text).toContain(
      "PACKAGED_MANIFEST: ${{ steps.theme_artifact.outputs.manifest }}",
    );
    expect(text).toContain(
      "PACKAGED_PREVIEW: ${{ steps.theme_artifact.outputs.preview }}",
    );
    expect(text).toContain('--manifest "$PACKAGED_MANIFEST"');
    expect(text).toContain('--preview "$PACKAGED_PREVIEW"');
  });
});

/**
 * 묶기 · 다시 검증 두 단계를 **워크플로의 스크립트 그대로**, 앞 단계가 `GITHUB_OUTPUT` 에 쓴 값을
 * 다음 단계의 env 로 넘기며 돌린다. 합성 루트는 저장소의 `scripts` · `src` · `examples` ·
 * `node_modules` 를 링크하고 `package.json` 만 제 것을 둔다 — CLI 가 앱 버전을 cwd 의
 * `package.json` 에서 읽기 때문이다.
 */
function runPackageAndVerify(appVersion: string) {
  const repo = resolve(__dirname, "../../..");
  const root = mkdtempSync(join(tmpdir(), "baram-theme-steps-"));
  for (const name of ["scripts", "src", "examples", "node_modules"]) {
    symlinkSync(join(repo, name), join(root, name));
  }
  writeFileSync(
    join(root, "package.json"),
    JSON.stringify({ version: appVersion }),
  );
  const runnerTemp = mkdtempSync(join(tmpdir(), "baram-theme-runner-"));
  const outputs = (path: string) =>
    Object.fromEntries(
      readFileSync(path, "utf8")
        .split("\n")
        .filter((line) => line.includes("="))
        .map((line) => [
          line.slice(0, line.indexOf("=")),
          line.slice(line.indexOf("=") + 1),
        ]),
    );
  const step = (name: string, id: string, env: Record<string, string>) => {
    const out = join(runnerTemp, `${id}.out`);
    writeFileSync(out, "");
    const result = spawnSync("bash", ["-e", "-c", stepScript(name)], {
      cwd: root,
      encoding: "utf8",
      env: {
        ...process.env,
        ...env,
        GITHUB_OUTPUT: out,
        RUNNER_TEMP: runnerTemp,
      },
    });
    return {
      output: result.stderr + result.stdout,
      outputs: outputs(out),
      status: result.status,
    };
  };
  const packaged = step("Package the theme", "theme_package", {
    DIR: "hangul",
    VERSION: "1.0.0",
  });
  if (packaged.status !== 0) return { packaged };
  const verified = step(
    "Verify the packaged theme is the theme that was verified",
    "theme_artifact",
    {
      EXPECTED_ID: "baram-hangul",
      VERSION: "1.0.0",
      ZIP_NAME: packaged.outputs.zip_name,
    },
  );
  return { packaged, verified };
}

describe("release-theme — 묶기와 다시 검증을 실행한다", () => {
  it("앞 단계의 출력이 다음 단계에 닿고, 색인이 읽을 두 파일이 나온다", () => {
    const { packaged, verified } = runPackageAndVerify("0.7.7");
    expect(packaged.status, packaged.output).toBe(0);
    expect(packaged.outputs.zip_name).toBe("baram-hangul-1.0.0.zip");
    expect(verified?.status, verified?.output).toBe(0);
    const preview = JSON.parse(
      readFileSync(verified?.outputs.preview ?? "", "utf8"),
    ) as Record<string, unknown>;
    expect(Object.keys(preview).sort()).toEqual(["dark", "light"]);
    const manifest = JSON.parse(
      readFileSync(verified?.outputs.manifest ?? "", "utf8"),
    ) as { id: string };
    expect(manifest.id).toBe("baram-hangul");
    // tsx 를 두 번 띄운다 — vitest 기본 5 s 는 CI 러너에 맞춘 값이 아니다.
  }, 30_000);

  it("앱이 하한보다 낮으면 묶기 단계가 주석을 달고 멈춘다", () => {
    const { packaged, verified } = runPackageAndVerify("0.7.6");
    expect(packaged.status).not.toBe(0);
    expect(packaged.output).toContain("::error::");
    expect(packaged.output).toContain("release the app first");
    expect(verified).toBeUndefined();
  }, 30_000);
});
