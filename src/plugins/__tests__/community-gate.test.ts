// §380 — the gate, steps 0–9 in order, and the merge decision (plan 0105 Task 9, spec 0058
// §7.2–§7.3). Every refusal is one option away from the passing world `world()` builds, so
// each test names what makes the gate refuse. Step 8 runs the real update-registry-index.mjs
// and validate-index.ts as child processes, and every world is two real git repositories —
// hence the timeout. The pending-descriptor window (gate 3, P24) is community-gate-pending.test.ts.
import { afterAll, describe, expect, it } from "vitest";

import { gateOutputs, gateReport } from "../../../scripts/community-gate";
import { label } from "../../../scripts/gha-label";
import {
  craftZip,
  pluginZip,
  sha,
  SUBMISSION,
  validManifest,
} from "./community-gate-fixtures";
import {
  cleanUpWorlds,
  gate,
  outcome,
  published,
} from "./community-gate-world";

afterAll(cleanUpWorlds);

/** The suffix every "a person must look" reason about a shown field carries. */
const SHOWN =
  "the marketplace shows it, so a person checks it for impersonation";

describe("runGate — the passing world", { timeout: 60_000 }, () => {
  it("auto-merges an update that asks for nothing new and changes no display field", async () => {
    expect(await gate()).toEqual({
      decision: "auto-merge",
      id: "hello-counter",
      kind: "passed",
      reasons: [],
      version: "1.2.0",
    });
  });
});

describe(
  "runGate — one refusal per step, each a single edit of the passing world",
  { timeout: 60_000 },
  () => {
    it("0: a second changed file", async () => {
      expect(
        await outcome({
          changed: [
            { filename: "community/hello-counter.json", status: "modified" },
            { filename: "plugins/evil.zip", status: "added" },
          ],
        }),
      ).toBe(
        "0: a submission changes exactly one file, community/<id>.json — this one changes 2",
      );
    });

    it("1: an oversized descriptor", async () => {
      expect(
        await outcome({
          descriptorText: `${JSON.stringify(SUBMISSION)}${" ".repeat(4096)}`,
        }),
      ).toMatch(/^1: the descriptor is \d+ bytes, over the 4096-byte limit$/u);
    });

    it("1: judges the descriptor the head commit holds, not what the checkout's working tree shows", async () => {
      // The commit holds the passing descriptor; the working tree, one gate 2 refuses.
      const refused = JSON.stringify({ ...SUBMISSION, version: "1.2.0" });
      expect(await outcome({ workingTree: refused })).toBe("auto-merge");
      // The twin: the same bytes committed are what the gate refuses.
      expect(
        await outcome({ descriptor: { ...SUBMISSION, version: "1.2.0" } }),
      ).toMatch(/^2: unknown field\(s\) "version"/u);
    });

    it("1: a symlink committed at the descriptor's path, pointing at a passing descriptor", async () => {
      expect(await outcome({ prSymlink: true })).toBe(
        "1: community/hello-counter.json is not a regular file",
      );
      expect(await outcome({ prSymlink: false })).toBe("auto-merge");
    });

    it("throws, rather than judging, when the head SHA is not a commit the checkout holds", async () => {
      await expect(gate({ headSha: "d".repeat(40) })).rejects.toThrow(
        `holds no commit ${"d".repeat(40)}`,
      );
      expect(await outcome()).toBe("auto-merge");
    });

    it("2: a field the descriptor may not carry", async () => {
      expect(
        await outcome({ descriptor: { ...SUBMISSION, version: "1.2.0" } }),
      ).toMatch(/^2: unknown field\(s\) "version"/u);
    });

    it("3: the same login held by a different account", async () => {
      expect(
        await outcome({ authorId: 777777, repo: { ownerId: 777777 } }),
      ).toBe(
        "3: hello-counter was published by account id 583231; this pull request comes from id 777777 — identity is the numeric id, which a reused login does not carry",
      );
    });

    it("4: an id index.json already uses — a theme's, here", async () => {
      expect(
        await outcome({
          indexPlugins: [{ id: "hello-counter", kind: "theme" }],
        }),
      ).toBe('4: id "hello-counter" is already taken in index.json');
      expect(
        await outcome({ indexPlugins: [{ id: "hello-theme", kind: "theme" }] }),
      ).toBe("auto-merge");
    });

    it("5: an asset that is not the reviewed bytes", async () => {
      expect(
        await outcome({
          descriptor: {
            ...SUBMISSION,
            release: { ...SUBMISSION.release, sha256: "b".repeat(64) },
          },
        }),
      ).toMatch(
        /^5: the release asset hashes to [0-9a-f]{64}, not the descriptor's b{64}$/u,
      );
    });

    it("6: an archive without the manifest at its root", async () => {
      expect(
        await outcome({
          served: craftZip([{ data: "x", name: "dist/index.mjs" }]),
        }),
      ).toBe(
        "6: no baram-plugin.json at the archive root — the app requires it there",
      );
    });

    it("7: a trusted plugin", async () => {
      expect(
        await outcome({ manifest: validManifest({ trust: "trusted" }) }),
      ).toBe(
        '7: trust is "trusted" — the community registry takes sandboxed plugins only (spec 0058 §378)',
      );
    });

    it("7: a manifest that names another id than the descriptor", async () => {
      expect(
        await outcome({ manifest: validManifest({ id: "other-thing" }) }),
      ).toBe(
        '7: the manifest\'s id is "other-thing", the descriptor\'s "hello-counter"',
      );
      expect(
        await outcome({ manifest: validManifest({ id: "hello-counter" }) }),
      ).toBe("auto-merge");
    });

    it("7: a release tag that names another version than the manifest", async () => {
      expect(
        await outcome({ manifest: validManifest({ version: "1.3.0" }) }),
      ).toBe("7: release.tag v1.2.0 names 1.2.0, but the manifest says 1.3.0");
      expect(
        await outcome({ manifest: validManifest({ version: "1.2.0" }) }),
      ).toBe("auto-merge");
    });

    it("8: a bidi override in the name the consent dialog shows", async () => {
      const name = `Hello${String.fromCharCode(0x202e)}Counter`;
      expect(await outcome({ manifest: validManifest({ name }) })).toMatch(
        /^8: .*name contains a control or bidi-override character/su,
      );
    });

    it("9: a version that is not newer than the published one", async () => {
      const manifest = validManifest({ version: "1.1.0" });
      const served = pluginZip(manifest);
      expect(
        await outcome({
          descriptor: {
            ...SUBMISSION,
            release: {
              asset: "hello-counter-1.1.0.zip",
              sha256: sha(served),
              tag: "v1.1.0",
            },
          },
          served,
        }),
      ).toBe("9: version 1.1.0 is not greater than the published 1.1.0");
    });
  },
);

describe(
  "runGate — who decides the merge (spec 0058 §7.3)",
  { timeout: 60_000 },
  () => {
    /** The reasons a passing result carries, or the whole result when it did not pass. */
    async function reasons(o: Parameters<typeof gate>[0]) {
      const result = await gate(o);
      return result.kind === "passed" ? result.reasons : result;
    }

    it("sends a new registration to a person", async () => {
      const result = await gate({ community: [] });
      expect(result).toEqual({
        decision: "needs-review",
        id: "hello-counter",
        kind: "passed",
        reasons: [
          "a new registration — a person reviews every new id once (spec 0058 §7.3)",
        ],
        version: "1.2.0",
      });
    });

    it("sends a capability escalation to a person", async () => {
      expect(
        await reasons({
          manifest: validManifest({
            capabilities: ["editor:readonly", "events", "network", "statusbar"],
          }),
        }),
      ).toEqual([
        "escalation: it requests capabilities that were not approved: network",
      ]);
    });

    it("auto-merges a narrowing — holding editor covers editor:readonly, as in the app", async () => {
      expect(
        await outcome({
          community: [
            published({ capabilities: ["editor", "events", "statusbar"] }),
          ],
        }),
      ).toBe("auto-merge");
    });

    it.each([
      ["name", { name: "Hello Counter Pro" }],
      ["author", { author: "Baram Team" }],
      ["description", { description: "Counts words now." }],
      ["icon", { icon: "🔤" }],
      ["homepage", { homepage: "https://octocat.example" }],
    ])("sends a changed %s to a person", async (field, over) => {
      expect(await reasons({ manifest: validManifest(over) })).toEqual([
        `${field} changed — ${SHOWN}`,
      ]);
    });

    it("sends a removed display field to a person — absent is a change too", async () => {
      const community = [published({ icon: "🔢" })];
      expect(await reasons({ community })).toEqual([`icon changed — ${SHOWN}`]);
      expect(
        await outcome({ community, manifest: validManifest({ icon: "🔢" }) }),
      ).toBe("auto-merge");
    });

    it("sends a renamed publisher to a person, even with the account and repository ids unchanged", async () => {
      // The same account (583231) renamed its login; GitHub moved the repository with it (id 555).
      const renamed = {
        descriptorEdit: {
          publisher: "octo-renamed",
          repo: "octo-renamed/baram-hello-counter",
        },
      };
      expect(await reasons(renamed)).toEqual([
        `publisher changed — ${SHOWN}`,
        `repository changed — ${SHOWN}`,
      ]);
      expect(await outcome()).toBe("auto-merge");
    });

    it("sends a renamed repository to a person, even with its id unchanged", async () => {
      expect(
        await reasons({
          descriptorEdit: { repo: "octocat/hello-counter-plugin" },
        }),
      ).toEqual([`repository changed — ${SHOWN}`]);
      expect(
        await outcome({
          descriptorEdit: { repo: "octocat/baram-hello-counter" },
        }),
      ).toBe("auto-merge");
    });

    it("auto-merges a license or keywords change — neither is shown as identity", async () => {
      // A pin, not a driver: nothing compares these two, so this passes as soon as the passing
      // world does. It fails if either is ever added to what a person must look at.
      expect(
        await outcome({
          manifest: validManifest({
            keywords: ["count"],
            license: "Apache-2.0",
          }),
        }),
      ).toBe("auto-merge");
    });

    it("auto-merges a README-only change — README is not a display field (spec 0058 §7.3)", async () => {
      // A pin, not a driver: no code path reads the README when deciding the merge, so this
      // passes as soon as the passing world does. It fails if a rule that sends README changes
      // to a person is ever added.
      const served = craftZip([
        { data: JSON.stringify(validManifest()), name: "baram-plugin.json" },
        { data: "export function activate() {}\n", name: "dist/index.mjs" },
        { data: "# Hello Counter, rewritten\n", name: "README.md" },
      ]);
      expect(await outcome({ served })).toBe("auto-merge");
    });

    it("leaves a pull request outside community/ to a person, without judging it", async () => {
      expect(
        await gate({
          changed: [{ filename: "README.md", status: "modified" }],
        }),
      ).toEqual({ kind: "maintenance" });
    });
  },
);

describe("gateReport — the document being judged does not write the verdict", () => {
  it("defangs a reason that tries to start a workflow command, without truncating it", () => {
    const lines = gateReport({
      kind: "refused",
      reason: `x\n::error title=SPOOFED::forged ${"y".repeat(200)}`,
      step: 7,
    });
    for (const line of lines) expect(line.trimStart()).not.toMatch(/^::/u);
    expect(lines.join("\n")).toContain("∷error");
    expect(lines.join("\n")).toContain("y".repeat(200));
  });

  it("label keeps its 80-character default for ids", () => {
    expect(label("z".repeat(100))).toBe(`${"z".repeat(80)}…`);
    expect(label("z".repeat(100), Infinity)).toBe("z".repeat(100));
  });
});

describe("gateOutputs — what the merge job may read", () => {
  const head = "c".repeat(40);

  it("writes nothing for a refusal, so no decision exists to act on", () => {
    expect(
      gateOutputs({ kind: "refused", reason: "x", step: 5 }, head),
    ).toEqual([]);
  });

  it("writes the decision and the SHA it was made about", () => {
    expect(
      gateOutputs(
        {
          decision: "auto-merge",
          id: "hello-counter",
          kind: "passed",
          reasons: [],
          version: "1.2.0",
        },
        head,
      ),
    ).toEqual(["decision=auto-merge", `head_sha=${head}`]);
    expect(gateOutputs({ kind: "maintenance" }, head)).toEqual([
      "decision=maintenance",
      `head_sha=${head}`,
    ]);
  });
});
