/**
 * §380 — the gate as the registry's `validate.yml` runs it on a pull request (spec 0058 §7.2).
 *
 *   npx tsx scripts/run-community-gate.ts --pr-root <dir> --published-root <dir> --base-url <url>
 *
 * Env: GITHUB_TOKEN (read-only is enough — the gate only sends GET requests), BASE_SHA and
 * HEAD_SHA (the event's), PR_AUTHOR_ID (`github.event.pull_request.user.id`), REGISTRY_REPO.
 * `--pr-root` must be a git checkout holding the HEAD_SHA commit: the descriptor is read from
 * that commit's objects, not from the checkout's files.
 * Writes `decision` and `head_sha` to $GITHUB_OUTPUT — the only outputs it gives the merge job,
 * and never on exit 1 or 2. Exit 1 is a refusal; exit 2 is a workflow or infrastructure error —
 * a missing or malformed argument, a setup that threw (the app's `limits.rs` or `fetch.rs`
 * unreadable, or a scrape of them refused), or anything the gate threw (a network failure, a git
 * failure, a head commit the checkout does not hold).
 *
 * ‼️ Runs the gate when imported. A helper another CLI needs belongs in `community-cli.ts`.
 */
import type { GateDeps, GateInput, GateResult } from "./community-gate";

import { appendFileSync } from "node:fs";
import { resolve } from "node:path";

import { flag, need, needId } from "./community-cli";
import { readAppBounds } from "./community-files";
import { gateOutputs, gateReport, runGate } from "./community-gate";
import { githubGet } from "./community-github";
import { label } from "./gha-label";

const TOOL = "community gate";
const ROOT = resolve(import.meta.dirname, "..");

const headSha = need(TOOL, "HEAD_SHA");
const baseSha = need(TOOL, "BASE_SHA");
const authorId = needId(TOOL, "PR_AUTHOR_ID");
if (!/^[0-9a-f]{40}$/u.test(headSha) || !/^[0-9a-f]{40}$/u.test(baseSha)) {
  console.error(`✗ ${TOOL}: BASE_SHA and HEAD_SHA must be 40 hex characters`);
  process.exit(2);
}

const input: GateInput = {
  authorId,
  baseSha,
  baseUrl: flag(TOOL, "--base-url").replace(/\/*$/u, "/"),
  headSha,
  prRoot: resolve(flag(TOOL, "--pr-root")),
  publishedRoot: resolve(flag(TOOL, "--published-root")),
  registryRepo: need(TOOL, "REGISTRY_REPO"),
  root: ROOT,
};
const token = need(TOOL, "GITHUB_TOKEN");

let result: GateResult;
try {
  const deps: GateDeps = {
    ...readAppBounds(ROOT),
    api: githubGet(token, (url, init) => fetch(url, init)),
    fetch: (url, init) => fetch(url, init),
  };
  result = await runGate(input, deps);
} catch (error) {
  const said = error instanceof Error ? error.message : String(error);
  console.error(`✗ ${TOOL}: ${label(said, Infinity)} — a workflow or infrastructure error, not a verdict`);
  process.exit(2);
}

const lines = gateReport(result);
for (const line of lines) {
  if (result.kind === "refused") console.error(line);
  else console.log(line);
}

const output = process.env.GITHUB_OUTPUT;
const outputs = gateOutputs(result, headSha);
if (output !== undefined && output !== "" && outputs.length > 0) {
  appendFileSync(output, outputs.map((line) => `${line}\n`).join(""));
}
const summary = process.env.GITHUB_STEP_SUMMARY;
if (summary !== undefined && summary !== "") {
  // Inside a fence, with backticks neutralised, so no line of it renders as markup.
  appendFileSync(summary, `### Community gate\n\n\`\`\`\n${lines.join("\n").replaceAll("`", "ˋ")}\n\`\`\`\n`);
}
process.exit(result.kind === "refused" ? 1 : 0);
