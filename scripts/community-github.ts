/**
 * §380 gates 0 and 3, §381 publish step 1 — what GitHub says, by number (spec 0058 §7.2, §11).
 *
 * ‼️ ACROSS TIME, IDENTITY IS A NUMBER, NEVER A NAME. `user.id`, `owner.id`, `repo.id` and the
 * author id `mergedPullRequest` resolves cannot be reassigned; a login or a repository full name
 * can (renamed, or deleted and picked up by someone else). Every comparison against an identity
 * RECORDED EARLIER — `ownership`'s owner/repo id checks, `pendingDescriptorConflict`'s author id
 * — uses a number for that reason. A name is used only to look up a repository as it stands RIGHT
 * NOW (`repoFacts(repo)`, `GET repos/{repo}`) or to check the descriptor spells it canonically
 * (`ownership`'s `fullName` equality — not an identity check; it guards the DISPLAYED publisher
 * name, plan 0105 P5. An owner who renamed their own login still resolves by number with every id
 * check below still matching (same `ownerId`), and so does the first registration of a
 * repository that was transferred before anyone published under its old identity (no `recorded`
 * to compare against yet) — but the descriptor's own text would then show a name GitHub no
 * longer calls it by, which this is the only check that catches) — never to decide who owned
 * something in the past.
 */
import type { Submission, Verdict } from "./community-submission";

import { descriptorIdFromPath } from "./community-submission";

export type ChangeClass =
  | { error: string; kind: "refused" }
  | { id: string; kind: "submission" }
  | { kind: "maintenance" };

export type GithubGet = (path: string) => Promise<GithubReply>;

export interface GithubReply {
  body: unknown;
  status: number;
}

export interface RecordedIdentity {
  publisherId: number;
  repoId: number;
}

export interface RepoFacts {
  fullName: string;
  isPrivate: boolean;
  ownerId: number;
  ownerType: string;
  repoId: number;
}

export function githubGet(
  token: string,
  fetchImpl: (
    url: string,
    init: { headers: Record<string, string> },
  ) => Promise<{ status: number; text(): Promise<string> }>,
): GithubGet {
  return async (path) => {
    const response = await fetchImpl(`https://api.github.com/${path}`, {
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${token}`,
        "X-GitHub-Api-Version": "2022-11-28",
      },
    });
    const text = await response.text();
    let body: unknown;
    try {
      body = text === "" ? null : (JSON.parse(text) as unknown);
    } catch {
      body = null;
    }
    return { body, status: response.status };
  };
}

/**
 * The compare API's own cap, under "Working with large comparisons … When using pagination:"
 * (GitHub REST docs, "Compare two commits" —
 * https://docs.github.com/en/rest/commits/commits#compare-two-commits, read 2026-09-28): "The
 * list of changed files is only shown on the first page of results, and it includes up to 300
 * changed files for the entire comparison." `classifyChange` never paginates (no `page` or
 * `per_page`), which IS that first page. A separate sentence, earlier on the same page in the
 * endpoint's own description (not under "Working with large comparisons"), bounds `commits`
 * instead: "When calling this endpoint without any paging parameter (per_page or page), the
 * returned list is limited to 250 commits" — `files` and `commits` are two different lists with
 * two different limits. Measured directly against an unpaged, real large comparison (`gh api
 * repos/cli/cli/compare/v2.0.0...v2.60.0`, 2026-09-28): `files.length` is exactly 300,
 * `total_commits` 4076 — nothing in the response marks the file list as cut off, no total-file
 * count beside it to compare against.
 *
 * So an at-cap comparison with no VISIBLE non-removal touch under `community/` falls to
 * maintenance rather than trusting that silence — the same side plan 0105 P3/P27 falls to for an
 * all-deletions change: a refusal here would fail the required check, and even a maintainer's own
 * ≥300-file PR could not merge without switching the ruleset off. A VISIBLE non-removal touch, by
 * contrast, is judged normally — with ≥300 total files that can only ever fail "exactly one
 * file", so it is refused, not silently folded into maintenance where a hidden second touch could
 * slip past a person who merges it without knowing. This narrows the risk for
 * `pendingDescriptorConflict` below, but does not eliminate it: that function's single-file check
 * reads the SQUASH COMMIT on main, not this pull request's own diff, so a hidden first-add cannot
 * establish an owner unless the rest of that pull request's changes had already reached main
 * through other merges — at least one of which a person must merge.
 */
const COMPARE_FILES_CAP = 300;

/**
 * Gate 0 — what the pull request changes, AT the two SHAs the event named (plan 0105 P2): the
 * three-dot compare is the diff from their merge base, fixed by the SHAs, where
 * `pulls/{n}/files` would answer for whatever the head is when asked.
 *
 * A pull request that never touches `community/` is not a submission (plan 0105 P3): it is
 * judged by the ordinary validators and merged only by a person. Neither is one that only
 * DELETES descriptors (P27): that is how a maintainer releases an unpublished id (P24), and a
 * refusal here would fail the required check, and nobody could merge it without switching the
 * ruleset off.
 */
export async function classifyChange(
  api: GithubGet,
  registryRepo: string,
  baseSha: string,
  headSha: string,
): Promise<ChangeClass> {
  const reply = await api(`repos/${registryRepo}/compare/${baseSha}...${headSha}`);
  if (reply.status !== 200) {
    return { error: `GitHub answered HTTP ${reply.status} comparing ${baseSha}...${headSha}`, kind: "refused" };
  }
  const files = (reply.body as null | { files?: unknown })?.files;
  if (!Array.isArray(files)) return { error: "GitHub's comparison carries no file list", kind: "refused" };
  const inCommunity = (path: unknown) => typeof path === "string" && path.startsWith("community/");
  if (files.length >= COMPARE_FILES_CAP) {
    const visibleTouch = files.some((raw) => {
      const file = raw as null | { filename?: unknown; previous_filename?: unknown; status?: unknown };
      return file?.status !== "removed" && (inCommunity(file?.filename) || inCommunity(file?.previous_filename));
    });
    if (!visibleTouch) return { kind: "maintenance" };
  }
  for (const raw of files) {
    const file = raw as null | { filename?: unknown; status?: unknown };
    if (typeof file?.filename !== "string" || typeof file.status !== "string") {
      return {
        error: "GitHub's comparison includes a file entry with no filename or status — refusing to guess what it changed",
        kind: "refused",
      };
    }
  }
  const changes = files.map((raw) => {
    const file = raw as { filename: string; previous_filename?: unknown; status: string };
    return {
      filename: file.filename,
      previous: typeof file.previous_filename === "string" ? file.previous_filename : "",
      status: file.status,
    };
  });
  const touching = changes.filter((change) => inCommunity(change.filename) || inCommunity(change.previous));
  if (touching.length === 0) return { kind: "maintenance" };
  if (touching.every((change) => change.status === "removed")) return { kind: "maintenance" };
  if (changes.length !== 1) {
    return {
      error: `a submission changes exactly one file, community/<id>.json — this one changes ${changes.length}`,
      kind: "refused",
    };
  }
  const only = changes[0];
  if (only.status !== "added" && only.status !== "modified") {
    return {
      error: `${only.filename} is ${only.status || "changed"} — a submission may only add or modify its descriptor`,
      kind: "refused",
    };
  }
  const id = descriptorIdFromPath(only.filename);
  if (id === null) return { error: `${only.filename} is not community/<id>.json`, kind: "refused" };
  return { id, kind: "submission" };
}

export async function repoFacts(api: GithubGet, repo: string): Promise<Verdict<{ facts: RepoFacts }>> {
  const reply = await api(`repos/${repo}`);
  if (reply.status === 404) return { error: `${repo} is not a public repository GitHub can see`, ok: false };
  if (reply.status !== 200) return { error: `GitHub answered HTTP ${reply.status} for ${repo}`, ok: false };
  const body = reply.body as null | {
    full_name?: unknown;
    id?: unknown;
    owner?: { id?: unknown; type?: unknown };
    private?: unknown;
  };
  const fullName = body?.full_name;
  const repoId = body?.id;
  const ownerId = body?.owner?.id;
  const ownerType = body?.owner?.type;
  const isPrivate = body?.private;
  if (
    typeof fullName !== "string" ||
    !isPositiveInteger(repoId) ||
    !isPositiveInteger(ownerId) ||
    typeof ownerType !== "string" ||
    typeof isPrivate !== "boolean"
  ) {
    return { error: `GitHub's answer for ${repo} is missing its ids`, ok: false };
  }
  return { facts: { fullName, isPrivate, ownerId, ownerType, repoId }, ok: true };
}

/**
 * Gate 3 (spec 0058 §7.2) plus the three conditions plan 0105 P5 adds: the canonical name, a
 * personal account, a public repository. `recorded` is the published entry's identity when this
 * is an update.
 */
export function ownership(
  submission: Submission,
  facts: RepoFacts,
  authorId: number,
  recorded: RecordedIdentity | undefined,
): Verdict<{ publisherId: number; repoId: number }> {
  if (facts.fullName !== submission.repo) {
    return {
      error: `the descriptor says ${JSON.stringify(submission.repo)} but GitHub calls it ${JSON.stringify(facts.fullName)} — write the canonical name, so the publisher users see is current`,
      ok: false,
    };
  }
  if (facts.ownerType !== "User") {
    return { error: "the repository must belong to a personal account — organization-owned repositories are not accepted yet", ok: false };
  }
  if (facts.isPrivate) return { error: "the repository must be public", ok: false };
  if (facts.ownerId !== authorId) {
    return {
      error: `the pull request author (id ${authorId}) does not own ${submission.repo} (owner id ${facts.ownerId})`,
      ok: false,
    };
  }
  if (recorded !== undefined && recorded.publisherId !== authorId) {
    return {
      error: `${submission.id} was published by account id ${recorded.publisherId}; this pull request comes from id ${authorId} — identity is the numeric id, which a reused login does not carry`,
      ok: false,
    };
  }
  if (recorded !== undefined && recorded.repoId !== facts.repoId) {
    return {
      error: `${submission.id} was published from repository id ${recorded.repoId}; ${submission.repo} is id ${facts.repoId} — a recreated repository is a new repository`,
      ok: false,
    };
  }
  return { ok: true, publisherId: facts.ownerId, repoId: facts.repoId };
}

/**
 * Gate 3, the window before publishing (plan 0105 P24; spec 0058 §11). `firstAddSha` is the
 * commit that first added `community/<id>.json` SINCE ITS LAST DELETION (`community-files.ts`'s
 * `firstDescriptorCommit` finds it — the first version, not the one just before, so an ownership
 * that changed hands once cannot hand itself on).
 *
 * Until a descriptor is published nobody has a `publisherId`, so identity for it is the numeric
 * author id of the pull request that MERGED that first-add commit (`mergedPullRequest`) — but
 * only once this confirms the commit itself changed nothing but `community/${id}.json`, added,
 * with exactly one parent (`GET repos/{registryRepo}/commits/{firstAddSha}`; the ruleset takes
 * only squash merges into main, which always have one parent). Without that check the premise
 * would break under the cap above: in a ≥300-file pull request, a descriptor addition beyond the
 * (up to 300) files the comparison shows falls to maintenance rather than being refused as a
 * submission — a VISIBLE one is refused instead, per the cap rule above — so that opener never
 * passed gate 3 as the repository's owner, and trusting their pull request as the pending
 * identity would let anyone attach a real submission where the gate cannot see it and a reviewer
 * must find it among 300+ files, and claim the id once a maintainer merges it. Comparing the
 * merged pull request's numeric author id — never the repository NAME the descriptor names — is
 * what spec 0058 §11 separately requires: a repository name can be recreated by anyone once its
 * original owner's login is freed, but neither that author id nor the single-file shape can be
 * reconstructed after the fact. Published ids are not judged here: their identity is the recorded
 * `publisherId`, which a maintainer can transfer (spec 0058 §8.5).
 *
 * Every DEFINITIVE refusal names the one lever there is (P27): a maintainer merges a pull request
 * that deletes the descriptor, and adds older than that deletion stop counting
 * (`firstDescriptorCommit`). Neither GitHub simply not answering 200 — for either lookup — nor a 200
 * whose body cannot even be read as the expected shape carries a lever: both name what went wrong
 * and ask the caller to re-run the check, since the answer may change. `mergedPullRequest`'s
 * optional `status` field marks that distinction for the pull request lookup — set whenever ITS
 * answer wasn't a 200 whose body is an array, not only when the HTTP status itself was wrong; the
 * commit lookup's own status and shape are checked directly, below.
 */
export async function pendingDescriptorConflict(
  api: GithubGet,
  registryRepo: string,
  firstAddSha: string,
  id: string,
  authorId: number,
): Promise<null | string> {
  const commitReply = await api(`repos/${registryRepo}/commits/${firstAddSha}`);
  if (commitReply.status !== 200) {
    return `${id} is already submitted and not yet published; GitHub answered HTTP ${commitReply.status} reading how its descriptor first arrived — re-run this check`;
  }
  const commitBody = commitReply.body as null | { files?: unknown; parents?: unknown };
  const parents = commitBody?.parents;
  const files = commitBody?.files;
  const unreadable = `${id} is already submitted and not yet published; GitHub's answer about commit ${firstAddSha}, where its descriptor first arrived, could not be read — re-run this check`;
  if (!Array.isArray(parents) || !Array.isArray(files)) return unreadable;
  for (const raw of files) {
    const file = raw as null | { filename?: unknown; status?: unknown };
    if (typeof file?.filename !== "string" || typeof file.status !== "string") return unreadable;
  }
  const typedFiles = files as { filename: string; status: string }[];
  const hasOneParent = parents.length === 1;
  const hasOneFile = typedFiles.length === 1;
  const onlyFile: undefined | { filename: string; status: string } = typedFiles[0];
  const fileIsSoleAdd = onlyFile !== undefined && onlyFile.filename === `community/${id}.json` && onlyFile.status === "added";
  if (!hasOneParent || !hasOneFile || !fileIsSoleAdd) {
    return `${id} is already submitted and not yet published; the first version of its descriptor did not arrive as a single-file submission, so its owner cannot be established${howToRelease(id)}`;
  }
  const merged = await mergedPullRequest(api, registryRepo, firstAddSha);
  if (!merged.ok) {
    return merged.status !== undefined
      ? `${id} is already submitted and not yet published; ${merged.error} — re-run this check`
      : `${id} is already submitted and not yet published, and the pull request that first added its descriptor cannot be identified (${merged.error})${howToRelease(id)}`;
  }
  if (merged.authorId !== authorId) {
    return `${id} is already submitted and not yet published, first added by account id ${merged.authorId}; a pull request from id ${authorId} may not replace it${howToRelease(id)}`;
  }
  return null;
}

/** The tail of every P24 refusal: who can undo it, and how. */
function howToRelease(id: string): string {
  return ` — only a maintainer can release ${id}, by merging a pull request that deletes community/${id}.json`;
}

/**
 * A failed lookup's `status` is set in exactly two cases: the HTTP status was not 200 (`status`
 * is that status), or it was 200 but the body was not an array (`status` is 200 — an unreadable
 * 200 is not a definite answer either). It stays `undefined` when GitHub answered 200 with an
 * array holding no single matching merged pull request, which is not transient. The array's
 * entries are not validated one by one: an entry that is not a pull request object is simply not
 * a match, so `[null]` counts as no match. Both arms remain assignable to
 * `Verdict<{ authorId: number; number: number }>` (Task 10 reads this as that), the optional
 * field being the only addition.
 */
export type MergedPullRequestResult = { authorId: number; number: number; ok: true } | { error: string; ok: false; status?: number };

/**
 * §381 publish step 1 — the merged pull request that brought `commitSha` to main, and its
 * author (plan 0105 P18: only a merged one whose merge commit IS this commit).
 */
export async function mergedPullRequest(api: GithubGet, registryRepo: string, commitSha: string): Promise<MergedPullRequestResult> {
  const reply = await api(`repos/${registryRepo}/commits/${commitSha}/pulls`);
  if (reply.status !== 200) {
    return { error: `GitHub answered HTTP ${reply.status} listing pull requests for commit ${commitSha}`, ok: false, status: reply.status };
  }
  if (!Array.isArray(reply.body)) {
    return { error: `GitHub's answer listing pull requests for commit ${commitSha} could not be read`, ok: false, status: 200 };
  }
  const refusal = `no single merged pull request introduced ${commitSha} — a descriptor reaches main only through a reviewed pull request`;
  const merged = reply.body.flatMap((raw: unknown) => {
    const pr = raw as null | { merge_commit_sha?: unknown; merged_at?: unknown; number?: unknown; user?: { id?: unknown } };
    const authorId = pr?.user?.id;
    const number = pr?.number;
    return pr?.merge_commit_sha === commitSha &&
      typeof pr.merged_at === "string" &&
      isPositiveInteger(authorId) &&
      isPositiveInteger(number)
      ? [{ authorId, number }]
      : [];
  });
  if (merged.length !== 1) return { error: refusal, ok: false };
  return { ...merged[0], ok: true };
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}
