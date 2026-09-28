/**
 * §381 — `publish-community.yml`'s two commands (spec 0058 §8.2).
 *
 *   npx tsx scripts/run-community-publish.ts reconcile --registry <dir> --base-url <url> --report <file>
 *                                                      [--delivery push|pull-request]
 *   npx tsx scripts/run-community-publish.ts live      --registry <dir> --base-url <url> --report <file>
 *
 * `--registry` is the registry checkout — main, full history (`fetch-depth: 0`), a clean working
 * tree. The workflow checks it out to `registry-live`, since the baram workspace tracks its own
 * `registry/`; nothing here assumes either name.
 *
 * `--delivery` says how a release reaches main: `push` (the default) pushes the commit;
 * `pull-request` merges it through a pull request (`community-pull-request.ts`), needs `gh` on
 * PATH, and first closes the pull requests earlier runs left open (`sweepAbandonedPullRequests`).
 * ‼️ ONE RUN AT A TIME: that sweep takes every open pull request from a `community-publish/`
 * branch of the registry for a leftover, so the branch prefix is reserved for this job, and the
 * workflow must run it in one concurrency group with `cancel-in-progress: false` (plan 0105
 * Task 13) — a second run mid-delivery would have its pull request closed under it.
 *
 * `reconcile` env: GITHUB_TOKEN, REGISTRY_REPO, and for `pull-request` GITHUB_RUN_ID and
 * GITHUB_RUN_ATTEMPT (positive integers; together they name its branches). Once it has read
 * `--delivery` and those, it appends `published` `stalled` `failed` counts to $GITHUB_OUTPUT and
 * then writes the report JSON, whatever it exits with: everything before those writes is inside a
 * catch, and the counts go first, so a report that cannot be written (exit 2) still leaves them.
 * So the steps that request a Pages build and comment on stalled pull requests still know what
 * happened, and a release an earlier descriptor already delivered stays in the record when a
 * later one aborts the run.
 * `live` reads that report and the checkout's community.json, and waits until Pages serves both.
 *
 * Exit 1 is a verdict: at least one descriptor failed to publish, or Pages never served what main
 * holds. Exit 2 is a workflow or infrastructure error. For `reconcile` that includes a run that
 * ABORTED (the report's `aborted`): handling a descriptor threw — a GitHub API request that got
 * no answer at all, a push or a pull request merge refused for a reason other than a lost race,
 * a squash that landed another tree than the one validated or was never compared with it, a git,
 * gh or file error — and the descriptors after it were not handled; or the sweep before the run
 * threw, and no descriptor was handled. A GitHub answer that is not 200 and a release download
 * that fails are verdicts on that one descriptor (exit 1), not aborts. Otherwise exit 2 is an
 * unknown command or `--delivery`, a missing argument or variable, or anything else either
 * command threw (for `live`, an unreadable report).
 *
 * ‼️ RESIDUAL (plan 0105 P12): the token reaches git as an extra header through GIT_CONFIG_*
 * environment variables of the delivery's and the sweep's git children only, and gh as GH_TOKEN —
 * not argv, not disk, never printed — but this process runs tsx, esbuild and zip.js with the token
 * in its own environment. Isolating it would not help: the same code produces the commit pushed.
 */
import type { ReconcileReport } from "./community-publish";
import type { GhRunner } from "./community-pull-request";

import { spawnSync } from "node:child_process";
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { flag, need, needId } from "./community-cli";
import { readAppBounds } from "./community-files";
import { githubGet } from "./community-github";
import { publishOutputs, publishReportLines, registryBytes, registrySize, waitForLive } from "./community-live";
import { deliverByPush, reconcile } from "./community-publish";
import { deliverViaPullRequest, sweepAbandonedPullRequests } from "./community-pull-request";
import { label } from "./gha-label";

const TOOL = "community publish";
const ROOT = resolve(import.meta.dirname, "..");

const command = process.argv[2];
if (command !== "reconcile" && command !== "live") {
  console.error("usage: run-community-publish.ts reconcile|live --registry <dir> --base-url <url> --report <file>");
  process.exit(2);
}
const registryDir = resolve(flag(TOOL, "--registry"));
const baseUrl = flag(TOOL, "--base-url").replace(/\/*$/u, "/");
const reportPath = flag(TOOL, "--report");

async function runLive(): Promise<number> {
  const report = JSON.parse(readFileSync(reportPath, "utf8")) as ReconcileReport;
  const verdict = await waitForLive({
    attempts: 20,
    baseUrl,
    expectedCommunity: new Uint8Array(readFileSync(join(registryDir, "community.json"))),
    // 30 s per request is a choice: the app's per-read timeout for plugin downloads
    // (`read_timeout(Duration::from_secs(30))` in `src-tauri/src/plugin/install.rs`), used here
    // as a bound on the whole request. A timeout throws, and `waitForLive` retries it.
    fetchBytes: async (url) => {
      const response = await fetch(url, { signal: AbortSignal.timeout(30_000) });
      return { bytes: new Uint8Array(await response.arrayBuffer()), status: response.status };
    },
    intervalMs: 15_000,
    published: report.published,
    sleep: (ms) => new Promise((done) => setTimeout(done, ms)),
  });
  if (!verdict.ok) {
    console.error(`✗ Pages does not serve what main holds — ${label(verdict.error, Infinity)}`);
    return 1;
  }
  console.log(`✓ Pages serves community.json and this run's archives (attempt ${verdict.attempts})`);
  return 0;
}

async function runReconcile(): Promise<number> {
  const delivery = process.argv.includes("--delivery") ? flag(TOOL, "--delivery") : "push";
  if (delivery !== "push" && delivery !== "pull-request") {
    console.error(`✗ ${TOOL}: --delivery must be push or pull-request — a bug in the workflow that runs this, not a verdict`);
    process.exit(2);
  }
  const token = need(TOOL, "GITHUB_TOKEN");
  const registryRepo = need(TOOL, "REGISTRY_REPO");
  const runId =
    delivery === "pull-request" ? `${needId(TOOL, "GITHUB_RUN_ID")}-${needId(TOOL, "GITHUB_RUN_ATTEMPT")}` : "";
  let report: ReconcileReport;
  try {
    const bounds = readAppBounds(ROOT);
    const pushEnv = {
      ...process.env,
      GIT_CONFIG_COUNT: "1",
      GIT_CONFIG_KEY_0: "http.https://github.com/.extraheader",
      GIT_CONFIG_VALUE_0: `AUTHORIZATION: basic ${Buffer.from(`x-access-token:${token}`).toString("base64")}`,
    };
    const gh: GhRunner = (args) => {
      // LC_ALL=C as for the push: `community-pull-request.ts` matches gh's stderr against English.
      const run = spawnSync("gh", args, { encoding: "utf8", env: { ...process.env, GH_TOKEN: token, LC_ALL: "C" } });
      if (run.error !== undefined) return { status: 1, stderr: run.error.message, stdout: "" };
      return { status: run.status ?? 1, stderr: run.stderr, stdout: run.stdout };
    };
    if (delivery === "pull-request") {
      const swept = sweepAbandonedPullRequests({ gh, gitEnv: pushEnv, registryDir, registryRepo });
      for (const line of swept) console.log(`↺ ${label(line, Infinity)}`);
    }
    // `reconcile` itself does not throw — a throw while handling a descriptor ends the run as
    // `aborted`. This catch is for the setup and the sweep above it.
    report = await reconcile({
      ...bounds,
      api: githubGet(token, (url, init) => fetch(url, init)),
      baseUrl,
      deliver:
        delivery === "pull-request"
          ? deliverViaPullRequest({ gh, gitEnv: pushEnv, registryRepo, runId })
          : deliverByPush(pushEnv),
      fetch: (url, init) => fetch(url, init),
      registryDir,
      registryRepo,
      root: ROOT,
    });
  } catch (error) {
    report = { aborted: error instanceof Error ? error.message : String(error), failed: [], published: [], skipped: [] };
  }
  // The counts first: the steps after this one read them, and a report that cannot be written
  // must not cost them.
  const file = process.env.GITHUB_OUTPUT;
  if (file !== undefined && file !== "") appendFileSync(file, publishOutputs(report).map((line) => `${line}\n`).join(""));
  for (const line of publishReportLines(report)) console.log(line);
  writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  const bytes = registryBytes(registryDir);
  const size = registrySize(bytes);
  console.log(size.line);
  if (size.warning !== null) console.warn(size.warning);
  summary(
    `### Community publish\n\n- published: ${report.published.length}\n- skipped: ${report.skipped.length}\n` +
      `- failed: ${report.failed.length}\n- aborted: ${report.aborted === null ? "no" : "yes — see the log"}\n` +
      `- registry size: ${bytes} bytes (${size.percent}% of the Pages limit)\n`,
  );
  if (report.aborted !== null) return 2;
  return report.failed.length > 0 ? 1 : 0;
}

function summary(text: string): void {
  const file = process.env.GITHUB_STEP_SUMMARY;
  if (file !== undefined && file !== "") appendFileSync(file, text);
}

let code: number;
try {
  code = command === "reconcile" ? await runReconcile() : await runLive();
} catch (error) {
  const said = error instanceof Error ? error.message : String(error);
  console.error(`✗ ${TOOL}: ${label(said, Infinity)} — a workflow or infrastructure error, not a verdict`);
  process.exit(2);
}
process.exit(code);
