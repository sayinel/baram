// §371 6b-2 — `plugin-release.yml` 의 `release-theme` 잡(스펙 0063 §7.3).
//
// 태그 단계는 **실행해서** 본다 — 이 워크플로의 플러그인 쪽이 텍스트 스캔을 다섯 번 우회당한 뒤
// 굳힌 규칙이다(`malicious-fixture.test.ts`). 스크립트가 하는 일(묶기 · 다시 검증 · 색인)은
// `theme-package-script.test.ts` · `theme-registry-chain.test.ts` 가 실행으로 본다. 여기 남는 텍스트
// 단언은 실행할 수 없는 배선 — 잡 조건, 비밀이 닿는 자리, 단계 사이의 출력 — 뿐이다.

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
const PUSH_ACTION = readFileSync(
  resolve(__dirname, "../../../.github/actions/registry-push/action.yml"),
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

  // 무엇이 이것을 실패시키는가: 어느 단계가 배포 키를 직접 env 로 받거나, 셋째 자리가 키를 쓰면.
  it("배포 키는 두 잡의 push 에만, 둘 다 공용 action 의 입력으로 닿는다", () => {
    const uses = [...WORKFLOW.matchAll(/secrets\.PLUGINS_DEPLOY_KEY/g)];
    expect(uses).toHaveLength(2);
    const lines = WORKFLOW.split("\n").filter((line) =>
      line.includes("secrets.PLUGINS_DEPLOY_KEY"),
    );
    for (const line of lines) {
      expect(line.trim()).toBe("deploy-key: ${{ secrets.PLUGINS_DEPLOY_KEY }}");
    }
    for (const job of ["release", "release-theme"]) {
      const text = jobText(job);
      const push = text.lastIndexOf("uses: ./.github/actions/registry-push");
      expect(push, job).toBeGreaterThan(0);
      // push 가 그 잡의 마지막 단계다 — 키가 생긴 뒤 도는 단계가 없다.
      expect(text.slice(push).match(/\n {6}- /g), job).toBeNull();
    }
  });

  it("push action 의 스크립트는 git 과 ssh 말고 아무것도 실행하지 않는다", () => {
    const run = PUSH_ACTION.slice(PUSH_ACTION.indexOf("run: |"));
    const code = run
      .split("\n")
      .filter((line) => !line.trim().startsWith("#"))
      .join("\n");
    expect(code).not.toMatch(/\b(node|npx|npm|tsx|yarn|pnpm|bun)\b/);
    // 입력은 env 로만 들어간다 — `run` 안의 `${{ }}` 는 스크립트 주입 자리다.
    expect(code).not.toContain("${{");
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
