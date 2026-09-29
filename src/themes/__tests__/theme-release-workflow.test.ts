// §371 6b-2 — `plugin-release.yml` 의 `release-theme` 잡(스펙 0063 §7.3).
//
// 단계는 **실행해서** 본다 — 이 워크플로의 플러그인 쪽이 텍스트 스캔을 다섯 번 우회당한 뒤 굳힌
// 규칙이다(`malicious-fixture.test.ts`). 이 파일이 `run: |` 본문을 bash 로 실행하는 단계는 넷이다:
// 태그 단계 `Parse and verify the theme tag`(`runTagStep`), checksum 관문 `Check the checksum the
// pre-publish check recorded`(`runChecksumStep`), 묶기 `Package the theme` 와 다시 검증 `Verify the
// packaged theme is the theme that was verified`(둘 다 `runPackageAndVerify`). 그 단계가 부르는
// 스크립트의 경우들(묶기 · 다시 검증 · 색인)은 `theme-package-script.test.ts` 와
// `theme-registry-chain.test.ts` 가 본다 — 묶기 · 다시 검증은 함수를 직접 부르고, 색인과 그 검증은
// 스크립트를 띄운다.
//
// 나머지는 텍스트 단언이고 "실행할 수 없는 배선" describe 에 모여 있다. 그 종류는 여섯이다 — 잡
// 조건(태그 트리거와 두 잡의 `if:`), 비밀이 닿는 자리(배포 키 줄과, 그 단계가 잡의 마지막인가),
// 두 push 본문의 대조, push 스크립트가 node 계열 도구와 `${{` 를 싣지 않음, 테마 잡이
// `examples/themes` 에 `$DIR` 로만 닿음, 단계 사이의 출력 배선(checksum 관문의 자리와 세 env, 색인
// 단계의 두 env).

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

describe("release-theme — 태그 단계를 실행한다", () => {
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

const CHECKSUM_STEP = "Check the checksum the pre-publish check recorded";
const SUM = "a".repeat(64);
const ZIP = "baram-hangul-1.0.0.zip";

/**
 * checksum 관문을 합성한 cwd 에서 돌린다 — 그 단계가 저장소에서 읽는 것은
 * `examples/themes/$DIR/SHA256SUMS` 하나다. `sums` 가 `undefined` 면 파일이 없고, `link: true` 면
 * 그 이름이 같은 내용의 파일을 가리키는 심볼릭 링크다.
 */
function runChecksumStep(opts: {
  checksum?: string;
  link?: boolean;
  sums?: string;
}): { output: string; status: null | number } {
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
  const result = spawnSync("bash", ["-e", "-c", stepScript(CHECKSUM_STEP)], {
    cwd: root,
    encoding: "utf8",
    env: {
      ...process.env,
      CHECKSUM: opts.checksum ?? SUM,
      DIR: "hangul",
      ZIP_NAME: ZIP,
    },
  });
  return { output: result.stderr + result.stdout, status: result.status };
}

describe("release-theme — 기록된 checksum 관문을 실행한다", () => {
  it("이 zip 의 줄이 있으면 통과한다 — 다른 버전의 줄과 섞여 있어도", () => {
    const { output, status } = runChecksumStep({
      sums: `${"b".repeat(64)}  baram-hangul-0.9.0.zip\n${SUM}  ${ZIP}\n`,
    });
    expect(status, output).toBe(0);
  });

  it("SHA256SUMS 가 없으면 무엇을 할지 말하며 거부한다", () => {
    const { output, status } = runChecksumStep({});
    expect(status).not.toBe(0);
    expect(output).toContain("::error::");
    expect(output).toContain("examples/themes/hangul/SHA256SUMS");
    expect(output).toContain("record the pre-publish check's sha256");
  });

  it.each([
    ["다른 해시", `${"c".repeat(64)}  ${ZIP}\n`],
    ["다른 버전의 줄뿐", `${SUM}  baram-hangul-0.9.0.zip\n`],
    ["공백 하나로 적은 줄", `${SUM} ${ZIP}\n`],
  ])(
    "%s 이면 거부한다 — 여기서 만든 zip 이 점검한 zip 이 아니다",
    (_, sums) => {
      const { output, status } = runChecksumStep({ sums });
      expect(status).not.toBe(0);
      expect(output).toContain("::error::");
      expect(output).toContain(
        "the archive built here is not the one the pre-publish check installed",
      );
    },
  );

  it("SHA256SUMS 가 심볼릭 링크면 맞는 줄을 가리켜도 거부한다", () => {
    const { output, status } = runChecksumStep({
      link: true,
      sums: `${SUM}  ${ZIP}\n`,
    });
    expect(status).not.toBe(0);
    expect(output).toContain("is not a regular file");
  });

  // 파일의 줄은 빈 해시와 짝지으면 맞는 줄이다 — 빈 값 관문이 없으면 이 케이스가 통과해 버린다.
  it("CHECKSUM 이 비어 닿으면 워크플로의 버그라고 말한다", () => {
    const { output, status } = runChecksumStep({
      checksum: "",
      sums: `  ${ZIP}\n`,
    });
    expect(status).not.toBe(0);
    expect(output).toContain("this is a bug in this workflow");
  });
});

describe("release-theme — 실행할 수 없는 배선", () => {
  it("태그 모양마다 잡 하나만 돈다", () => {
    expect(WORKFLOW).toMatch(/tags: \['plugin-\*', 'theme-\*'\]/);
    expect(jobText("release")).toContain(
      "if: startsWith(github.ref_name, 'plugin-')",
    );
    expect(jobText("release-theme")).toContain(
      "if: startsWith(github.ref_name, 'theme-')",
    );
  });

  // 무엇이 이것을 실패시키는가: 셋째 자리가 키(나 다른 비밀)를 쓰거나, 키를 받는 단계 뒤에 단계가
  // 생기거나, 키가 env 가 아닌 모양(action 입력 · `run` 안의 식)으로 닿으면.
  it("배포 키는 두 잡의 마지막 단계에만, env 한 줄로 닿는다", () => {
    const KEY_LINE = "DEPLOY_KEY: ${{ secrets.PLUGINS_DEPLOY_KEY }}";
    // `secrets` 를 읽는 **모든** 줄 — 키 이름 한 철자만 찾으면 `secrets['…']` · 대소문자 변형 ·
    // `toJSON(secrets)` 가 빠진다(`revocation-publish-gate.test.ts` 의 같은 허용 목록과 같은 정규식).
    const lines = WORKFLOW.split("\n").filter((line) =>
      /secrets\s*[.[]|toJSON\s*\(\s*secrets/iu.test(line),
    );
    expect(lines.map((line) => line.trim())).toEqual([KEY_LINE, KEY_LINE]);
    for (const job of ["release", "release-theme"]) {
      const text = jobText(job);
      const key = text.indexOf(KEY_LINE);
      expect(key, job).toBeGreaterThan(0);
      expect(text.indexOf(KEY_LINE, key + 1), job).toBe(-1);
      // 키 뒤에 새 단계가 시작하지 않는다 — 키를 받는 단계가 그 잡의 마지막이다.
      expect(text.slice(key).match(/\n {6}- /g), job).toBeNull();
    }
  });

  const PLUGIN_PUSH = "Push ZIP + updated index to registry repo";
  const THEME_PUSH = "Push the theme archive + updated index to registry repo";

  // 무엇이 이것을 실패시키는가: 두 push 본문이 한 글자라도 갈라지면 — 드물게 도는 테마 잡의
  // 사본이 아무도 모르게 갈라지는 것이 공용 action 을 두었던 이유였고, 이제 이 대조가 그 자리다.
  it("테마 잡의 push 본문은 플러그인 잡의 것과 `$THEME_ID` 한 낱말만 다르다", () => {
    const theme = stepScript(THEME_PUSH);
    // 치환이 공허하지 않다 — 테마 본문이 그 낱말을 실제로 쓴다.
    expect(theme).toContain("$THEME_ID");
    expect(theme).not.toContain("$PLUGIN_ID");
    expect(theme.replaceAll("$THEME_ID", "$PLUGIN_ID")).toBe(
      stepScript(PLUGIN_PUSH),
    );
  });

  it.each([PLUGIN_PUSH, THEME_PUSH])(
    "%s 의 스크립트는 node 계열 도구를 부르지 않고, `${{` 를 싣지 않는다",
    (name) => {
      const code = stepScript(name)
        .split("\n")
        .filter((line) => !line.trim().startsWith("#"))
        .join("\n");
      expect(code).toContain("git push origin main");
      expect(code).not.toMatch(/\b(node|npx|npm|tsx|yarn|pnpm|bun)\b/);
      // 입력은 env 로만 들어간다 — `run` 안의 `${{ }}` 는 스크립트 주입 자리다.
      expect(code).not.toContain("${{");
    },
  );

  // 무엇이 이것을 실패시키는가: 관문이 checksum 을 계산하는 단계 앞이나 색인을 쓰는 단계 뒤로
  // 옮겨지거나, 세 값을 다른 출력에 묶으면. 위의 실행 케이스는 env 를 직접 넣으므로 이 배선을 보지
  // 못한다.
  it("checksum 관문은 checksum 을 계산한 뒤, 색인을 쓰기 전에 서고, 세 값을 앞 단계에서 받는다", () => {
    const text = jobText("release-theme");
    const at = (name: string) => text.indexOf(`- name: ${name}\n`);
    expect(at("Compute the theme checksum")).toBeGreaterThan(0);
    expect(at(CHECKSUM_STEP)).toBeGreaterThan(at("Compute the theme checksum"));
    expect(at(CHECKSUM_STEP)).toBeLessThan(
      at("Update and validate the registry index for the theme"),
    );
    const gate = text.slice(
      at(CHECKSUM_STEP),
      at("Update and validate the registry index for the theme"),
    );
    expect(gate).toContain("DIR: ${{ steps.theme_meta.outputs.dir }}");
    expect(gate).toContain(
      "ZIP_NAME: ${{ steps.theme_package.outputs.zip_name }}",
    );
    expect(gate).toContain("CHECKSUM: ${{ steps.theme_sum.outputs.checksum }}");
  });

  it("테마 잡은 examples/themes/ 에 태그 단계가 검증한 디렉터리로만 닿는다", () => {
    const text = jobText("release-theme");
    const afterTag = text.slice(
      text.indexOf("- uses: ./.github/actions/setup-node"),
    );
    const refs = [...afterTag.matchAll(/examples\/themes\/(\S+?)["/\s]/g)].map(
      (m) => m[1],
    );
    expect(refs.length).toBeGreaterThan(0);
    for (const ref of refs) expect(ref).toBe("$DIR");
    expect(afterTag).toContain("DIR: ${{ steps.theme_meta.outputs.dir }}");
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
