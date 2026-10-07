// §317 · §390 The [[ menu's `alias::` lookup is `findAliasContext`, the ruler a
// click uses: it answers to a space's canonical name (`Journal::`) and folds the
// alias, so the menu lists the vault the link would open.
import type { ContextInfo, FileEntry } from "../../ipc/types";
import type { WikilinkSuggestionItem } from "../plugins/wikilink-suggest-utils";

import { beforeEach, describe, expect, it, vi } from "vitest";

type MenuItems = (args: { query: string }) => Promise<WikilinkSuggestionItem[]>;

// The Suggestion plugin is replaced by a recorder of its options: `items` is
// reachable only through them.
const captured = vi.hoisted(() => ({ items: null as MenuItems | null }));
vi.mock("@tiptap/suggestion", () => ({
  Suggestion: (options: { items: MenuItems }) => {
    captured.items = options.items;
    return {};
  },
}));

import { useContextStore } from "../../stores/context/context";
import { useFileStore } from "../../stores/file/file";
import { WikilinkSuggest } from "../plugins/wikilink-suggest";

const DIARY = "일기";
const DIARY_NFD = DIARY.normalize("NFD");
const MEETING = "회의록";
const MEETING_NFD = MEETING.normalize("NFD");

function journalContext(alias: string): ContextInfo {
  return {
    addedAt: 0,
    alias,
    color: "#000",
    contextType: "vault",
    id: "journal",
    label: "Journal",
    path: "/j",
    vaultType: "journal",
  };
}

function menuItems(): MenuItems {
  WikilinkSuggest.config.addProseMirrorPlugins!.call({ editor: {} } as never);
  return captured.items!;
}

function note(name: string): FileEntry {
  return { isDir: false, modifiedAt: 0, name, path: `/j/${name}`, size: 0 };
}

beforeEach(() => {
  useContextStore.setState({
    contexts: [journalContext(DIARY_NFD)],
  });
  useFileStore.setState({
    fileTree: [note(`${MEETING_NFD}.md`)],
    rootPath: "/j",
  });
});

describe("§390 the [[ menu's alias:: lookup", () => {
  it("the spellings differ", () => {
    expect(DIARY_NFD).not.toBe(DIARY);
    expect(MEETING_NFD).not.toBe(MEETING);
  });

  it("lists a journal's notes for the space name, whatever its folder is called", async () => {
    // What fails this: the lookup comparing `alias` alone. A vault's alias
    // defaults to its folder's name (`addContext`), so for a journal kept in
    // `일기` the name `Journal` matched no alias, and the menu listed nothing
    // for the link §317 documents.
    const rows = await menuItems()({ query: "Journal::" });
    expect(
      rows.filter((r) => r.kind !== "folder-header").map((r) => r.label),
    ).toEqual([MEETING]);
  });

  it("finds a vault whose alias is stored decomposed by the alias typed composed", async () => {
    // What fails this: the lookup comparing the alias by lowercase alone.
    const rows = await menuItems()({ query: `${DIARY}::${MEETING}` });
    expect(rows.map((r) => r.label)).toEqual([MEETING]);
  });

  it("and lists nothing for a name no vault answers to", async () => {
    // The partner: the two cases above find the vault by name, not by
    // answering every `alias::`.
    expect(await menuItems()({ query: "Nobody::" })).toEqual([]);
  });
});
