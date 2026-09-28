/**
 * §381 publish step 6 and §8.5 — after `reconcile` (`community-publish.ts`): what the run reports,
 * how much the registry holds, and whether GitHub Pages serves what main holds (spec 0058 §8.2,
 * §8.5).
 */
import type { PublishedItem, ReconcileReport } from "./community-publish";
import type { Verdict } from "./community-submission";

import { sha256Hex } from "./community-download";
import { git } from "./community-files";
import { label } from "./gha-label";

/** GitHub Pages' published-site limit, read as 10⁹ bytes — the smaller reading (plan 0105 P19). */
const PAGES_SITE_LIMIT_BYTES = 1_000_000_000;

export interface LiveCheck {
  attempts: number;
  baseUrl: string;
  expectedCommunity: Uint8Array;
  /** One request. A throw — a timeout the caller set, a reset connection — is a retry, like any mismatch. */
  fetchBytes(url: string): Promise<{ bytes: Uint8Array; status: number }>;
  intervalMs: number;
  published: readonly PublishedItem[];
  sleep(ms: number): Promise<void>;
}

/** The `$GITHUB_OUTPUT` lines the CLI writes — counts only, never text a descriptor chose. */
export function publishOutputs(report: ReconcileReport): string[] {
  return [
    `failed=${report.failed.length}`,
    `published=${report.published.length}`,
    // Only a stalled failure that names a pull request can be told on one.
    `stalled=${report.failed.filter((item) => item.stalled && item.pr !== null).length}`,
  ];
}

/** The lines a workflow step prints. Every untrusted fragment goes through `label`; no reason is cut. */
export function publishReportLines(report: ReconcileReport): string[] {
  return [
    ...report.published.map((item) => `✓ published ${label(item.id)} ${label(item.version)}`),
    ...report.skipped.map((item) => `· ${label(item.id)}: ${label(item.reason, Infinity)}`),
    ...report.failed.map((item) => `✗ ${label(item.id)}: ${label(item.reason, Infinity)}`),
    ...(report.aborted === null
      ? []
      : [`✗ aborted: ${label(report.aborted, Infinity)} — no descriptor after it was handled`]),
  ];
}

/** The run's registry-size line, and spec 0058 §8.5's warning once main holds 70 % of Pages' limit. */
export function registrySize(bytes: number): { line: string; percent: string; warning: null | string } {
  const percent = ((bytes / PAGES_SITE_LIMIT_BYTES) * 100).toFixed(1);
  return {
    line: `registry size ${bytes} bytes (${percent}% of GitHub Pages' ${PAGES_SITE_LIMIT_BYTES})`,
    percent,
    warning: bytes >= PAGES_SITE_LIMIT_BYTES * 0.7 ? `⚠ the registry is at ${percent}% of GitHub Pages' site limit (spec 0058 §8.5)` : null,
  };
}

/** Bytes of every blob main holds — what GitHub Pages serves from a branch build. */
export function registryBytes(dir: string): number {
  // `<mode> SP <type> SP <object> SP+ <size> TAB <path>`; a submodule's size is "-".
  return git(dir, ["ls-tree", "-r", "-l", "HEAD"])
    .split("\n")
    .map((line) => line.split(/\s+/u))
    .filter((fields) => fields[1] === "blob")
    .reduce((sum, fields) => sum + Number(fields[3]), 0);
}

/**
 * A push that succeeded is not a file being served (spec 0058 §8.2 step 6). ‼️ EVERY MISMATCH
 * IS A RETRY CONDITION — Pages lags the push, which is why this loop exists — the lesson
 * `revocation-publish.yml` paid for. Runs on every publish run, even one that published nothing,
 * so a run that timed out is verified by the next (plan 0105 P14).
 */
export async function waitForLive(check: LiveCheck): Promise<Verdict<{ attempts: number }>> {
  let last = "";
  for (let attempt = 1; attempt <= check.attempts; attempt += 1) {
    last = await liveMismatch(check);
    if (last === "") return { attempts: attempt, ok: true };
    if (attempt < check.attempts) await check.sleep(check.intervalMs);
  }
  return { error: `after ${check.attempts} attempts: ${last}`, ok: false };
}

async function fetchOrNothing(check: LiveCheck, url: string): Promise<{ bytes: Uint8Array; status: number }> {
  try {
    return await check.fetchBytes(url);
  } catch {
    return { bytes: new Uint8Array(), status: -1 };
  }
}

async function liveMismatch(check: LiveCheck): Promise<string> {
  const listUrl = `${check.baseUrl}community.json`;
  const list = await fetchOrNothing(check, listUrl);
  if (list.status !== 200) return `${listUrl} answered HTTP ${list.status}`;
  if (Buffer.compare(Buffer.from(list.bytes), Buffer.from(check.expectedCommunity)) !== 0) {
    return `${listUrl} is not yet the bytes main holds`;
  }
  for (const item of check.published) {
    const zip = await fetchOrNothing(check, item.downloadUrl);
    if (zip.status !== 200) return `${item.downloadUrl} answered HTTP ${zip.status}`;
    const actual = sha256Hex(zip.bytes);
    if (actual !== item.checksum) return `${item.downloadUrl} hashes to ${actual}, not ${item.checksum}`;
  }
  return "";
}
