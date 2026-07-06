import type { SpaceDefinition } from "../types";

import { beforeEach, describe, expect, it } from "vitest";

import { journalSpace } from "../journal-space";
import {
  __resetSpacesForTest,
  getSpace,
  listSpaces,
  registerSpace,
} from "../registry";

const fake: SpaceDefinition = {
  type: "journal",
  label: "Journal",
  maxInstances: 1,
  configFolders: ["daily"],
  layout: {
    sidebarOpen: true,
    sidebarPanel: "calendar",
    rightPanelOpen: true,
    rightPanelMode: "memories",
  },
};

describe("space registry", () => {
  beforeEach(() => __resetSpacesForTest());

  it("registers and retrieves a space by type", () => {
    registerSpace(fake);
    expect(getSpace("journal")).toBe(fake);
  });

  it("returns undefined for unregistered or nullish types", () => {
    expect(getSpace("zettelkasten")).toBeUndefined();
    expect(getSpace(undefined)).toBeUndefined();
    expect(getSpace(null)).toBeUndefined();
  });

  it("lists all registered spaces", () => {
    registerSpace(fake);
    expect(listSpaces()).toEqual([fake]);
  });
});

describe("journal space definition", () => {
  beforeEach(() => __resetSpacesForTest());

  it("matches the existing journal preset layout (behavior-preserving)", () => {
    expect(journalSpace.type).toBe("journal");
    expect(journalSpace.maxInstances).toBe(1);
    expect(journalSpace.configFolders).toEqual(["daily"]);
    expect(journalSpace.layout).toEqual({
      sidebarOpen: true,
      sidebarPanel: "calendar",
      rightPanelOpen: true,
      rightPanelMode: "memories",
    });
  });
});
