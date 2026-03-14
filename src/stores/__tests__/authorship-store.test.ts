import type { AuthorshipSegment } from "../../utils/authorship-tracker";

// §11.7 AuthorshipStore + AuthorshipSync — per-file tracker management and sidecar serialization
import { beforeEach, describe, expect, it } from "vitest";

import {
  deserializeAuthorship,
  serializeAuthorship,
} from "../../utils/authorship-sync";
import { useAuthorshipStore } from "../authorship-store";

describe("AuthorshipStore", () => {
  beforeEach(() => {
    useAuthorshipStore.getState().reset();
  });

  it("stores tracker per file path", () => {
    useAuthorshipStore.getState().getOrCreateTracker("test.md");
    expect(useAuthorshipStore.getState().hasTracker("test.md")).toBe(true);
  });

  it("isEnabled defaults to false", () => {
    expect(useAuthorshipStore.getState().isEnabled).toBe(false);
  });
});

describe("AuthorshipSync", () => {
  it("serializes segments to JSON", () => {
    const segments: AuthorshipSegment[] = [
      { from: 0, origin: "human", timestamp: Date.now(), to: 50 },
    ];
    const json = serializeAuthorship("test.md", segments);
    const parsed = JSON.parse(json);
    expect(parsed.filePath).toBe("test.md");
    expect(parsed.segments).toHaveLength(1);
  });

  it("deserializes JSON back to segments", () => {
    const json =
      '{"filePath":"test.md","version":1,"segments":[{"from":0,"to":50,"origin":"human","timestamp":1000}]}';
    const data = deserializeAuthorship(json);
    expect(data.segments[0].origin).toBe("human");
  });
});
