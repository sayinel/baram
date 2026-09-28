// §381 — publish refuses an unpublished id whose first add it cannot name (plan 0105 P24),
// rather than skip the owner check the way "no earlier add" would. `firstDescriptorCommit`
// passes `--root` and `--no-follow`, and no git configuration found so far makes it answer null
// while HEAD holds the descriptor — so this file mocks it to answer null.
import { afterAll, describe, expect, it, vi } from "vitest";

import { reconcile } from "../../../scripts/community-publish";
import { cleanUpWorlds } from "./community-gate-world";
import { options, registry } from "./community-publish-world";

vi.mock("../../../scripts/community-files", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("../../../scripts/community-files")
  >()),
  firstDescriptorCommit: () => null,
}));

afterAll(cleanUpWorlds);

describe(
  "reconcile — a first add git does not name",
  { timeout: 120_000 },
  () => {
    it("fails the id instead of publishing it", async () => {
      expect((await reconcile(options(registry()))).failed).toEqual([
        {
          id: "hello-counter",
          pr: 7,
          reason:
            "community/hello-counter.json is on main, but git shows no commit that added it since its last deletion — its first owner cannot be established, so it is not published",
          stalled: false,
        },
      ]);
    });
  },
);
