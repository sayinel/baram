/**
 * §381 — `publish-community.yml`'s two commands (spec 0058 §8.2).
 *
 *   npx tsx scripts/run-community-publish.ts reconcile --registry <dir> --base-url <url> --report <file>
 *   npx tsx scripts/run-community-publish.ts live      --registry <dir> --base-url <url> --report <file>
 *
 * `--registry` is the registry checkout — main, full history (`fetch-depth: 0`), a clean working
 * tree. The workflow checks it out to `registry-live`, since the baram workspace tracks its own
 * `registry/`; nothing here assumes either name.
 *
 * `reconcile` env: GITHUB_TOKEN, REGISTRY_REPO. Once it has read those two, it writes the report
 * JSON and then, to $GITHUB_OUTPUT, `published` `stalled` `failed` counts, whatever it exits with:
 * everything before those writes is inside a catch. So the steps that request a Pages build and
 * comment on stalled pull requests still know what happened, and a release an earlier descriptor
 * already delivered stays in the record when a later one aborts the run.
 * `live` reads that report and the checkout's community.json, and waits until Pages serves both.
 *
 * Exit 1 is a verdict: at least one descriptor failed to publish, or Pages never served what main
 * holds. Exit 2 is a workflow or infrastructure error. For `reconcile` that includes a run that
 * ABORTED (the report's `aborted`): handling a descriptor threw — a GitHub API request that got
 * no answer at all, a push the remote refused for a reason other than a lost race, a git or file
 * error — and the descriptors after it were not handled. A GitHub answer that is not 200 and a
 * release download that fails are verdicts on that one descriptor (exit 1), not aborts. Otherwise
 * exit 2 is an unknown command, a missing argument or variable, or anything else either command
 * threw (for `live`, an unreadable report).
 *
 * ‼️ RESIDUAL (plan 0105 P12): the token reaches git as an extra header through GIT_CONFIG_*
 * environment variables of the push child only — not argv, not disk, never printed — but this
 * process runs tsx, esbuild and zip.js with the token in its own environment. Isolating it would
 * not help: the same code produces the commit being pushed.
 */
import type { ReconcileReport } from "./community-publish";

import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { flag, need } from "./community-cli";
import { githubGet } from "./community-github";
import { PAGES_SITE_LIMIT_BYTES, registryBytes, waitForLive } from "./community-live";
import { deliverByPush, publishOutputs, publishReportLines, reconcile } from "./community-publish";
import { label } from "./gha-label";
import { pluginArchiveByteCap, pluginArchiveLimits, readmeByteCap, registryByteCap } from "./rust-constants";

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
  const token = need(TOOL, "GITHUB_TOKEN");
  const registryRepo = need(TOOL, "REGISTRY_REPO");
  let report: ReconcileReport;
  try {
    const limitsSource = readFileSync(resolve(ROOT, "src-tauri/src/plugin/limits.rs"), "utf8");
    const fetchSource = readFileSync(resolve(ROOT, "src-tauri/src/plugin/fetch.rs"), "utf8");
    const pushEnv = {
      ...process.env,
      GIT_CONFIG_COUNT: "1",
      GIT_CONFIG_KEY_0: "http.https://github.com/.extraheader",
      GIT_CONFIG_VALUE_0: `AUTHORIZATION: basic ${Buffer.from(`x-access-token:${token}`).toString("base64")}`,
    };
    // `reconcile` itself does not throw — a throw while handling a descriptor ends the run as
    // `aborted`. This catch is for the setup above it.
    report = await reconcile({
      api: githubGet(token, (url, init) => fetch(url, init)),
      archiveCap: pluginArchiveByteCap(limitsSource),
      baseUrl,
      deliver: deliverByPush(pushEnv),
      fetch: (url, init) => fetch(url, init),
      limits: pluginArchiveLimits(limitsSource),
      readmeCap: readmeByteCap(fetchSource),
      registryCap: registryByteCap(fetchSource),
      registryDir,
      registryRepo,
      root: ROOT,
    });
  } catch (error) {
    report = { aborted: error instanceof Error ? error.message : String(error), failed: [], published: [], skipped: [] };
  }
  writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  for (const line of publishReportLines(report)) console.log(line);
  const file = process.env.GITHUB_OUTPUT;
  if (file !== undefined && file !== "") appendFileSync(file, publishOutputs(report).map((line) => `${line}\n`).join(""));
  const bytes = registryBytes(registryDir);
  const percent = ((bytes / PAGES_SITE_LIMIT_BYTES) * 100).toFixed(1);
  console.log(`registry size ${bytes} bytes (${percent}% of GitHub Pages' ${PAGES_SITE_LIMIT_BYTES})`);
  if (bytes >= PAGES_SITE_LIMIT_BYTES * 0.7) {
    console.warn(`⚠ the registry is at ${percent}% of GitHub Pages' site limit (spec 0058 §8.5)`);
  }
  summary(
    `### Community publish\n\n- published: ${report.published.length}\n- skipped: ${report.skipped.length}\n` +
      `- failed: ${report.failed.length}\n- aborted: ${report.aborted === null ? "no" : "yes — see the log"}\n` +
      `- registry size: ${bytes} bytes (${percent}% of the Pages limit)\n`,
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
