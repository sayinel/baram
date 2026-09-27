/**
 * §380 — the community submission gate (spec 0058 §7.2–§7.3), in the order the spec numbers it.
 * The pull request is judged at ONE commit: the changed paths are GitHub's comparison at
 * `baseSha...headSha`, and the descriptor is read from `headSha`'s own objects in `prRoot` —
 * never from the working tree — so what was validated is the commit the merge job may merge
 * (`--match-head-commit`).
 *
 * What it does NOT do, on purpose: scan the bundle. The sandboxed tier's boundary is the Rust
 * authorizer, and a static scan of JavaScript is easy to evade (spec 0058 §7.2).
 */
import type { PluginManifest } from "../src/plugins/types";
import type { AssetFetch } from "./community-download";
import type { PublishedCommunityEntry } from "./community-files";
import type { GithubGet } from "./community-github";
import type { Submission, Verdict } from "./community-submission";
import type { PluginArchiveLimits } from "./rust-constants";

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { parseBaramFloor } from "../src/plugins/engines";
import { validateManifest } from "../src/plugins/manifest";
import { consentGaps } from "../src/plugins/plugin-consent";
import { downloadReleaseAsset, releaseAssetUrl, sha256Hex } from "./community-download";
import {
  firstDescriptorCommit,
  readDescriptorAt,
  readRegistryState,
  upsertCommunityEntry,
  validateRegistryDocument,
} from "./community-files";
import { classifyChange, ownership, pendingDescriptorConflict, repoFacts } from "./community-github";
import {
  assetNames,
  idConflict,
  parseSubmission,
  repositoryUrl,
  tagVersion,
  versionAdvances,
} from "./community-submission";
import { readPluginArchive } from "./community-zip";
import { label } from "./gha-label";

export interface GateDeps {
  api: GithubGet;
  archiveCap: number;
  fetch: AssetFetch;
  limits: PluginArchiveLimits;
  /** The app's `readmeByteCap` — gate 6 refuses a root README the registry fetch would not read. */
  readmeCap: number;
  registryCap: number;
}

export interface GateInput {
  authorId: number;
  baseSha: string;
  baseUrl: string;
  headSha: string;
  prRoot: string;
  publishedRoot: string;
  registryRepo: string;
  root: string;
}

export type GateResult =
  | { decision: "auto-merge" | "needs-review"; id: string; kind: "passed"; reasons: string[]; version: string }
  | { kind: "maintenance" }
  | { kind: "refused"; reason: string; step: GateStep };

export type GateStep = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;

interface Staging {
  checksum: string;
  communityText: string;
  hasReadme: boolean;
  manifest: unknown;
  owner: { publisherId: number; repoId: number };
  submission: Submission;
  version: string;
}

/**
 * Spec 0058 §7.3's display fields: the manifest fields a person reads for impersonation, so
 * changing any of them is never automatic. `reviewReasons` compares two more shown fields that
 * do not come from the manifest — `publisher` and `repository`.
 */
export const DISPLAY_FIELDS = ["name", "author", "description", "icon", "homepage"] as const;

/** How every reason about a changed shown field ends. */
const SHOWN = "the marketplace shows it, so a person checks it for impersonation";

export async function runGate(input: GateInput, deps: GateDeps): Promise<GateResult> {
  const refused = (step: GateStep, reason: string): GateResult => ({ kind: "refused", reason, step });

  const change = await classifyChange(deps.api, input.registryRepo, input.baseSha, input.headSha);
  if (change.kind === "maintenance") return change;
  if (change.kind === "refused") return refused(0, change.error);

  const read = readDescriptorAt(input.prRoot, input.headSha, change.id);
  if (!read.ok) return refused(1, read.error);
  const registry = readRegistryState(input.publishedRoot, deps.registryCap);
  if (!registry.ok) return refused(1, registry.error);
  const parsed = parseSubmission(read.bytes, change.id);
  if (!parsed.ok) return refused(parsed.step, parsed.error);
  const submission = parsed.submission;
  const current = registry.state.community.find((entry) => entry.id === submission.id);

  const facts = await repoFacts(deps.api, submission.repo);
  if (!facts.ok) return refused(3, facts.error);
  const owner = ownership(
    submission,
    facts.facts,
    input.authorId,
    current === undefined ? undefined : { publisherId: current.publisherId, repoId: current.repoId },
  );
  if (!owner.ok) return refused(3, owner.error);
  // P24 — merged but not yet published: nobody holds a publisherId for this id yet, so the
  // numeric author of the pull request that merged the descriptor's first add since its last
  // deletion decides whose it is.
  if (current === undefined) {
    const firstAddSha = firstDescriptorCommit(input.publishedRoot, submission.id);
    if (firstAddSha !== null) {
      const takeover = await pendingDescriptorConflict(
        deps.api,
        input.registryRepo,
        firstAddSha,
        submission.id,
        input.authorId,
      );
      if (takeover !== null) return refused(3, takeover);
    }
  }

  const conflict = idConflict(
    submission.id,
    registry.state.firstPartyIds,
    registry.state.community.map((entry) => entry.id),
  );
  if (conflict !== null) return refused(4, conflict);

  const download = await downloadReleaseAsset(releaseAssetUrl(submission), deps.archiveCap, deps.fetch);
  if (!download.ok) return refused(5, download.error);
  const checksum = sha256Hex(download.bytes);
  if (checksum !== submission.release.sha256) {
    return refused(5, `the release asset hashes to ${checksum}, not the descriptor's ${submission.release.sha256}`);
  }

  const archive = await readPluginArchive(download.bytes, deps.limits, deps.readmeCap);
  if (!archive.ok) return refused(6, archive.error);

  const judged = judgeManifest(archive.archive.manifest, submission);
  if (!judged.ok) return refused(7, judged.error);
  const manifest = judged.manifest;

  const staged = stageEntry(input, {
    checksum,
    communityText: registry.state.communityText,
    hasReadme: archive.archive.readme !== null,
    manifest: archive.archive.manifest,
    owner,
    submission,
    version: manifest.version,
  });
  if (!staged.ok) return refused(8, staged.error);

  if (current !== undefined && !versionAdvances(manifest.version, current.version)) {
    return refused(9, `version ${manifest.version} is not greater than the published ${current.version}`);
  }

  const reasons = reviewReasons(current, manifest, submission);
  return {
    decision: reasons.length === 0 ? "auto-merge" : "needs-review",
    id: submission.id,
    kind: "passed",
    reasons,
    version: manifest.version,
  };
}

/** Gate 7 — the app's own validator, then the community tier and the tag's agreement. */
export function judgeManifest(raw: unknown, submission: Submission): Verdict<{ manifest: PluginManifest }> {
  const validated = validateManifest(raw);
  if (!validated.valid) {
    return {
      error: `the manifest is invalid: ${validated.errors.map((e) => `${e.field}: ${e.message}`).join("; ")}`,
      ok: false,
    };
  }
  const manifest = validated.manifest;
  if (manifest.id !== submission.id) {
    return { error: `the manifest's id is ${JSON.stringify(manifest.id)}, the descriptor's ${JSON.stringify(submission.id)}`, ok: false };
  }
  if (manifest.trust !== "sandboxed") {
    return { error: `trust is ${JSON.stringify(manifest.trust)} — the community registry takes sandboxed plugins only (spec 0058 §378)`, ok: false };
  }
  if (parseBaramFloor(manifest.engines.baram) === null) {
    return { error: `engines.baram ${JSON.stringify(manifest.engines.baram)} must be ">=X.Y.Z"`, ok: false };
  }
  if (!/^\d+\.\d+\.\d+$/u.test(manifest.version)) {
    return { error: `version ${JSON.stringify(manifest.version)} must be X.Y.Z`, ok: false };
  }
  const tagged = tagVersion(submission.release.tag);
  if (tagged !== manifest.version) {
    return { error: `release.tag ${submission.release.tag} names ${tagged}, but the manifest says ${manifest.version}`, ok: false };
  }
  return { manifest, ok: true };
}

/**
 * Why a person must look (spec 0058 §7.3). Empty — the update may merge itself — takes all of:
 * - no capability or tier beyond the published one, by the app's own `consentGaps`, so "editor
 *   covers editor:readonly" is decided exactly as the install dialog decides it;
 * - each of `DISPLAY_FIELDS` equal to the published entry's, an absent field counting as a value
 *   (removing one is a change);
 * - the published `publisher` equal to `submission.publisher`, and the published `repository`
 *   equal to the URL this submission would publish. The app shows both — `@publisher` in
 *   `PluginCard.tsx` and in `PluginDetail.tsx`'s publisher row, the repository as
 *   `PluginDetail.tsx`'s repository link — and a renamed login or repository keeps every numeric
 *   id gate 3 compares, so nothing else stops one.
 *
 * Every other field `update-registry-index.mjs` writes into a community entry is not compared
 * here: `id` is how `current` was found; `publisherId` and `repoId` are identity gate 3 already
 * holds equal; `version` must advance (gate 9); `downloadUrl`, `checksum` and `readme` follow
 * from the release; and a change to `license`, `keywords` or `engines` merges itself — none of
 * the three says who publishes.
 */
export function reviewReasons(
  current: PublishedCommunityEntry | undefined,
  next: PluginManifest,
  submission: Submission,
): string[] {
  if (current === undefined) return ["a new registration — a person reviews every new id once (spec 0058 §7.3)"];
  const reasons: string[] = [];
  if (current.trust === "sandboxed") {
    reasons.push(
      ...consentGaps(
        { capabilities: current.capabilities, trust: current.trust },
        { capabilities: next.capabilities, trust: next.trust },
      ).map((gap) => `escalation: ${gap}`),
    );
  } else {
    reasons.push("the published entry is not sandboxed — nothing to compare an update against");
  }
  for (const field of DISPLAY_FIELDS) {
    if ((current[field] ?? null) !== (next[field] ?? null)) reasons.push(`${field} changed — ${SHOWN}`);
  }
  if (current.publisher !== submission.publisher) reasons.push(`publisher changed — ${SHOWN}`);
  if (current.repository !== repositoryUrl(submission)) reasons.push(`repository changed — ${SHOWN}`);
  return reasons;
}

/**
 * The `$GITHUB_OUTPUT` lines the CLI writes: none for a refusal, so a job that reads them has no
 * decision to act on, and otherwise the decision and the SHA it was made about.
 */
export function gateOutputs(result: GateResult, headSha: string): string[] {
  if (result.kind === "refused") return [];
  return [`decision=${result.kind === "passed" ? result.decision : "maintenance"}`, `head_sha=${headSha}`];
}

/** The lines a workflow step prints. Every untrusted fragment is defanged; none is truncated. */
export function gateReport(result: GateResult): string[] {
  if (result.kind === "maintenance") {
    return ["✓ community gate: this pull request touches nothing under community/ — a person merges it"];
  }
  if (result.kind === "refused") return [`✗ community gate step ${result.step}: ${label(result.reason, Infinity)}`];
  return [
    `✓ community gate: ${label(result.id)} ${label(result.version)} → ${result.decision}`,
    ...result.reasons.map((reason) => `    ${label(reason, Infinity)}`),
  ];
}

/**
 * Gate 8 (plan 0105 P4) — write the community.json this submission would produce with
 * `upsertCommunityEntry` (`update-registry-index.mjs`, the upsert `community-files.ts` gives the
 * publish job as well) and judge it with `validateRegistryDocument` (`validate-index.ts`). The
 * display-string checks are validate-index.ts's; so is everything else it refuses.
 */
function stageEntry(input: GateInput, s: Staging): Verdict {
  const dir = mkdtempSync(join(tmpdir(), "baram-gate-"));
  try {
    const communityPath = join(dir, "community.json");
    const manifestPath = join(dir, "baram-plugin.json");
    writeFileSync(communityPath, s.communityText);
    writeFileSync(manifestPath, JSON.stringify(s.manifest));
    const names = assetNames(s.submission.id, s.version);
    const upsert = upsertCommunityEntry(input.root, {
      baseUrl: input.baseUrl,
      checksum: s.checksum,
      communityPath,
      manifestPath,
      publisher: s.submission.publisher,
      publisherId: s.owner.publisherId,
      readmeName: s.hasReadme ? names.readme : null,
      repoId: s.owner.repoId,
      repository: repositoryUrl(s.submission),
      zipName: names.zip,
    });
    if (!upsert.ok) return upsert;
    return validateRegistryDocument(input.root, communityPath);
  } finally {
    rmSync(dir, { force: true, recursive: true });
  }
}
