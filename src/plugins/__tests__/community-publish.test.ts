// §381 — the publish reconcile against a real git remote (plan 0105 Task 10, spec 0058 §8.2,
// §12 "로컬 bare repo 로 재현"). Each case builds origin.git with a seed commit and a descriptor
// commit (`community-publish-world.ts`), clones it, and runs `reconcile` with the real
// update/validate CLIs. Only GitHub's API and the release download are faked.
import { execFileSync } from "node:child_process";
import { afterAll, describe, expect, it } from "vitest";

import { deliverByPush, reconcile } from "../../../scripts/community-publish";
import { communityEntry } from "./community-fixture";
import { pluginZip, sha, validManifest } from "./community-gate-fixtures";
import { BASE, cleanUpWorlds, gitIn } from "./community-gate-world";
import {
  options,
  originFile,
  originLog,
  registry,
  ZIP_SHA,
} from "./community-publish-world";

afterAll(cleanUpWorlds);

describe("reconcile — publish, no-op, refusals", { timeout: 120_000 }, () => {
  it("publishes a new registration: ZIP, README and the C1 entry, in one commit", async () => {
    const r = registry();
    const report = await reconcile(options(r));
    expect(report).toEqual({
      aborted: null,
      failed: [],
      published: [
        {
          checksum: ZIP_SHA,
          downloadUrl: `${BASE}plugins/hello-counter-1.2.0.zip`,
          id: "hello-counter",
          version: "1.2.0",
        },
      ],
      skipped: [],
    });
    expect(originLog(r)).toEqual([
      "community: hello-counter 1.2.0",
      "Add hello-counter (#7)",
      "seed",
    ]);
    const community = JSON.parse(originFile(r, "community.json")) as {
      communityPlugins: unknown[];
    };
    expect(community.communityPlugins).toEqual([
      {
        author: "Octo Cat",
        capabilities: ["editor:readonly", "events", "statusbar"],
        checksum: ZIP_SHA,
        description: "Counts characters in the status bar.",
        downloadUrl:
          "https://sayinel.github.io/baram-plugins/plugins/hello-counter-1.2.0.zip",
        engines: { baram: ">=0.6.1" },
        id: "hello-counter",
        license: "MIT",
        name: "Hello Counter",
        publisher: "octocat",
        publisherId: 583231,
        readme:
          "https://sayinel.github.io/baram-plugins/readme/hello-counter-1.2.0.md",
        repoId: 555,
        repository: "https://github.com/octocat/baram-hello-counter",
        trust: "sandboxed",
        version: "1.2.0",
      },
    ]);
    expect(
      sha(
        new Uint8Array(
          execFileSync("git", [
            "-C",
            r.origin,
            "show",
            "main:plugins/hello-counter-1.2.0.zip",
          ]),
        ),
      ),
    ).toBe(ZIP_SHA);
    expect(originFile(r, "readme/hello-counter-1.2.0.md")).toBe(
      "# Hello Counter\n",
    );
  });

  it("names what under community/ is not a descriptor, and publishes the descriptor beside it", async () => {
    const r = registry({ preexisting: { "community/Hello.json": "{}" } });
    const report = await reconcile(options(r));
    expect(report.skipped).toEqual([
      {
        id: "community/Hello.json",
        reason:
          "not a descriptor (community/<id>.json, with a lowercase id) — nothing publishes it",
      },
    ]);
    expect(report.published.map((item) => item.id)).toEqual(["hello-counter"]);
  });

  it("does nothing on a second run — the version is already published with the same sha256", async () => {
    const r = registry();
    await reconcile(options(r));
    const head = gitIn(r.origin)("rev-parse", "main");
    expect(await reconcile(options(r))).toEqual({
      aborted: null,
      failed: [],
      published: [],
      skipped: [
        {
          id: "hello-counter",
          reason: "already published: hello-counter 1.2.0",
        },
      ],
    });
    expect(gitIn(r.origin)("rev-parse", "main")).toBe(head);
  });

  it("refuses to overwrite a published archive with different bytes, and leaves the clone clean", async () => {
    const r = registry({
      preexisting: {
        "plugins/hello-counter-1.2.0.zip": new Uint8Array([1, 2, 3]),
      },
    });
    const head = gitIn(r.origin)("rev-parse", "main");
    const report = await reconcile(options(r));
    expect(report.failed).toEqual([
      {
        id: "hello-counter",
        pr: 7,
        reason:
          "plugins/hello-counter-1.2.0.zip already exists with different bytes — a published archive never changes",
        stalled: false,
      },
    ]);
    expect(gitIn(r.origin)("rev-parse", "main")).toBe(head);
    expect(gitIn(r.work)("status", "--porcelain")).toBe("");
  });

  it("rolls back what it wrote when a validator refuses — a community.json it created included", async () => {
    // No seed, and an index.json validate-index refuses: writeRelease creates community.json,
    // writes the ZIP and README, upserts, then fails at the index validation and must undo all of it.
    const r = registry({
      omitCommunity: true,
      preexisting: { "index.json": '{\n  "plugins": [{ "id": "x" }]\n}\n' },
    });
    const report = await reconcile(options(r));
    expect(report.failed[0].reason).toContain("author is missing");
    expect(gitIn(r.work)("status", "--porcelain")).toBe("");
  });

  it("re-validates every archive the registry lists before it commits — a first-party archive missing from plugins/", async () => {
    // index.json passes validate-index.ts: the entry is well-formed. Only the asset validator
    // looks for the file its downloadUrl names.
    const archive = pluginZip(
      validManifest({ id: "baram-word-count", version: "2.1.0" }),
    );
    const index = `${JSON.stringify(
      {
        plugins: [
          {
            author: "Baram",
            capabilities: ["editor:readonly", "events", "statusbar"],
            checksum: sha(archive),
            description: "Shows the word count in the status bar.",
            downloadUrl: `${BASE}plugins/baram-word-count-2.1.0.zip`,
            engines: { baram: ">=0.6.1" },
            id: "baram-word-count",
            license: "Apache-2.0",
            name: "Word Count",
            trust: "sandboxed",
            version: "2.1.0",
          },
        ],
      },
      null,
      2,
    )}\n`;
    const r = registry({ preexisting: { "index.json": index } });
    const head = gitIn(r.origin)("rev-parse", "main");
    const report = await reconcile(options(r));
    expect(report.failed).toHaveLength(1);
    expect(report.failed[0].reason).toContain(
      "baram-word-count (index.json): plugins/baram-word-count-2.1.0.zip is not a regular file in the registry — the app would 404 on every install of this entry, after the marketplace has already offered it",
    );
    expect(gitIn(r.origin)("rev-parse", "main")).toBe(head);
    expect(gitIn(r.work)("status", "--porcelain")).toBe("");
    // The twin: the same registry with the archive in place publishes.
    const twin = registry({
      preexisting: {
        "index.json": index,
        "plugins/baram-word-count-2.1.0.zip": archive,
      },
    });
    expect(
      (await reconcile(options(twin))).published.map((item) => item.id),
    ).toEqual(["hello-counter"]);
  });

  it("stops when the release asset changed after review, and marks the pull request to tell", async () => {
    const r = registry();
    const report = await reconcile(
      options(
        r,
        deliverByPush(process.env),
        pluginZip(undefined, [{ data: "new", name: "extra.txt" }]),
      ),
    );
    expect(report.failed).toHaveLength(1);
    expect(report.failed[0]).toMatchObject({
      id: "hello-counter",
      pr: 7,
      stalled: true,
    });
    expect(report.failed[0].reason).toMatch(
      /^the release asset changed after review: it hashes to [0-9a-f]{64}, the reviewed descriptor says [0-9a-f]{64}$/u,
    );
  });

  it("refuses a README over the cap it is given — the first case publishes the same 16-byte README", async () => {
    const r = registry();
    expect((await reconcile({ ...options(r), readmeCap: 15 })).failed).toEqual([
      {
        id: "hello-counter",
        pr: 7,
        reason:
          "README.md is over the 15-byte limit the app's registry fetch enforces — a larger README would publish beside the archive and never render",
        stalled: false,
      },
    ]);
  });

  it("refuses a descriptor commit that changed anything else — the twin of the first case", async () => {
    const r = registry({
      extraInDescriptorCommit: {
        "index.json": '{\n  "plugins": [],\n  "updatedAt": "x"\n}\n',
      },
    });
    const report = await reconcile(options(r));
    expect(report.failed[0].reason).toContain(
      "also changed index.json — a descriptor must arrive alone",
    );
  });

  it("refuses a descriptor no merged pull request brought", async () => {
    const r = registry({ pulls: { body: [], status: 200 } });
    const report = await reconcile(options(r));
    expect(report.failed[0].reason).toContain(
      "no single merged pull request introduced",
    );
  });

  it("reports GitHub not answering as GitHub's failure — no pull request named, nothing stalled", async () => {
    const r = registry({
      pulls: { body: { message: "Server Error" }, status: 502 },
    });
    expect((await reconcile(options(r))).failed).toEqual([
      {
        id: "hello-counter",
        pr: null,
        reason: `GitHub answered HTTP 502 listing pull requests for commit ${r.descriptorSha}`,
        stalled: false,
      },
    ]);
  });

  it("refuses a pull request whose author does not own the repository", async () => {
    const report = await reconcile(options(registry({ authorId: 999 })));
    expect(report.failed[0].reason).toBe(
      "the pull request author (id 999) does not own octocat/baram-hello-counter (owner id 583231)",
    );
  });

  it("refuses a version already published with other bytes, before downloading anything", async () => {
    const r = registry({
      published: [
        communityEntry({
          checksum: "e".repeat(64),
          publisherId: 583231,
          repoId: 555,
          version: "1.2.0",
        }),
      ],
    });
    const head = gitIn(r.origin)("rev-parse", "main");
    expect((await reconcile(options(r))).failed).toEqual([
      {
        id: "hello-counter",
        pr: null,
        reason:
          "hello-counter 1.2.0 is already published with checksum eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee — a published version's bytes never change",
        stalled: false,
      },
    ]);
    expect(gitIn(r.origin)("rev-parse", "main")).toBe(head);
  });

  it("does not publish over a published version it cannot read as X.Y.Z", async () => {
    const r = registry({
      published: [
        communityEntry({
          checksum: "e".repeat(64),
          publisherId: 583231,
          repoId: 555,
          version: "banana",
        }),
      ],
    });
    expect((await reconcile(options(r))).skipped).toEqual([
      {
        id: "hello-counter",
        reason:
          "the descriptor asks for 1.2.0, not newer than the published banana",
      },
    ]);
  });
});
