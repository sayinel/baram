// §56m The vault tag list the app reads is by tag name.
import { beforeEach, describe, expect, it, vi } from "vitest";

const invoke = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", () => ({ invoke }));

import { getVaultTags } from "../tag";

describe("getVaultTags", () => {
  beforeEach(() => {
    invoke.mockReset();
  });

  // What turns this red: returning the rows as the index lists them. A front-matter item
  // spelled `"#solo"` comes back as `#solo` beside the body's `solo`, and every reader — the
  // tag panel, the editor's `#` autocomplete, Quick Capture's suggestions — showed two tags,
  // one of them `##solo`.
  it("lists names that differ only by leading # as one tag", async () => {
    invoke.mockResolvedValue([
      { count: 2, tag: "solo" },
      { count: 1, tag: "#solo" },
      { count: 1, tag: "other" },
    ]);
    expect(await getVaultTags("/v")).toEqual([
      { count: 3, tag: "solo" },
      { count: 1, tag: "other" },
    ]);
    expect(invoke).toHaveBeenCalledWith("get_vault_tags", { rootPath: "/v" });
  });
});
