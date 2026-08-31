// §317 findAliasContext — which context an `alias::` prefix names.
//
// A space context's alias comes from its DIRECTORY NAME (`ensureSpaceContext`
// passes none, so `addContext` falls back to `labelFromPath`). §317 makes
// `[[Journal::…]]` the official route to the journal, so the lookup has to
// answer to the canonical space name too — WITHOUT losing the folder-derived
// one, which is what users have been linking with until now.
import type { ContextInfo } from "../../ipc/types";

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../stores/context/context", () => ({
  useContextStore: { getState: vi.fn(), subscribe: vi.fn() },
}));

vi.mock("../../stores/file/file", () => ({
  isActiveContextJournal: vi.fn(() => false),
  useFileStore: { getState: vi.fn(() => ({ fileTree: [], rootPath: null })) },
}));

vi.mock("../../stores/editor/editor", () => ({
  useEditorStore: { getState: vi.fn() },
}));

vi.mock("../../stores/settings/store", () => ({
  useSettingsStore: { getState: vi.fn(() => ({ journalDirectory: "" })) },
}));

import { useContextStore } from "../../stores/context/context";
import { findAliasContext } from "../editor/wikilink-nav";

function ctx(over: Partial<ContextInfo>): ContextInfo {
  return {
    addedAt: 0,
    color: "#000",
    contextType: "vault",
    id: over.path ?? "id",
    label: "L",
    path: "/p",
    ...over,
  } as ContextInfo;
}

function setContexts(contexts: ContextInfo[]): void {
  vi.mocked(useContextStore.getState).mockReturnValue({
    contexts,
  } as unknown as ReturnType<typeof useContextStore.getState>);
}

describe("§317 findAliasContext", () => {
  beforeEach(() => vi.clearAllMocks());

  it("finds a journal kept in a non-English folder by its canonical name", () => {
    // The whole point: alias is "일기" (the folder), but §317 documents
    // [[Journal::…]] as the way across.
    const journal = ctx({
      alias: "일기",
      path: "/v/일기",
      vaultType: "journal",
    });
    setContexts([journal]);

    expect(findAliasContext("Journal")).toBe(journal);
  });

  it("still finds it by the folder-derived alias", () => {
    // Additive, not a replacement — links people already wrote keep working.
    const journal = ctx({
      alias: "일기",
      path: "/v/일기",
      vaultType: "journal",
    });
    setContexts([journal]);

    expect(findAliasContext("일기")).toBe(journal);
  });

  it("matches the canonical name case-insensitively", () => {
    const journal = ctx({ alias: "diary", path: "/v/d", vaultType: "journal" });
    setContexts([journal]);

    expect(findAliasContext("journal")).toBe(journal);
    expect(findAliasContext("JOURNAL")).toBe(journal);
  });

  it("gives zettelkasten its own canonical name", () => {
    const zettel = ctx({
      alias: "slipbox",
      path: "/v/s",
      vaultType: "zettelkasten",
    });
    setContexts([zettel]);

    expect(findAliasContext("Zettel")).toBe(zettel);
    expect(findAliasContext("Journal")).toBeNull();
  });

  it("does not let a plain vault answer to an empty alias", () => {
    // `general` deliberately has NO canonical name. A "" entry in the table
    // would make every ordinary vault match `[[::target]]`.
    const plain = ctx({ alias: "work", path: "/v/work", vaultType: "general" });
    setContexts([plain]);

    expect(findAliasContext("")).toBeNull();
  });

  it("does not match a context that has no vaultType at all", () => {
    const folder = ctx({
      alias: undefined,
      contextType: "folder",
      path: "/v/f",
    });
    setContexts([folder]);

    expect(findAliasContext("Journal")).toBeNull();
    expect(findAliasContext("undefined")).toBeNull();
  });

  it("returns null when no context matches", () => {
    setContexts([ctx({ alias: "work", path: "/v/w", vaultType: "general" })]);

    expect(findAliasContext("Journal")).toBeNull();
  });

  // A vault the user literally named "Journal" should win [[Journal::…]] over
  // the journal space's canonical name. Both orders are asserted on purpose:
  // with a single `find` over one predicate this passes only by array position,
  // so testing one order would let a positional accident look like a rule.
  it.each([
    ["explicit first", 0],
    ["canonical first", 1],
  ])("prefers an explicit alias over a canonical one (%s)", (_label, first) => {
    const named = ctx({
      alias: "Journal",
      path: "/v/Journal",
      vaultType: "general",
    });
    const space = ctx({ alias: "일기", path: "/v/일기", vaultType: "journal" });
    setContexts(first === 0 ? [named, space] : [space, named]);

    expect(findAliasContext("Journal")).toBe(named);
  });
});
