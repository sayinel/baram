// §11.4 KnowledgeStore — Zustand store for vault indexing and knowledge Q&A
import { beforeEach, describe, expect, it } from "vitest";

import { useKnowledgeStore } from "../knowledge-store";

describe("KnowledgeStore", () => {
  beforeEach(() => {
    useKnowledgeStore.getState().reset();
  });

  it("initializes with idle indexing status", () => {
    expect(useKnowledgeStore.getState().indexingStatus).toBe("idle");
  });

  it("initializes with zero counts", () => {
    const state = useKnowledgeStore.getState();
    expect(state.indexedFiles).toBe(0);
    expect(state.totalFiles).toBe(0);
    expect(state.totalChunks).toBe(0);
  });

  it("updates indexing progress", () => {
    useKnowledgeStore.getState().setIndexingProgress(45, 100);
    expect(useKnowledgeStore.getState().indexedFiles).toBe(45);
    expect(useKnowledgeStore.getState().totalFiles).toBe(100);
    expect(useKnowledgeStore.getState().indexingStatus).toBe("indexing");
  });

  it("sets status to ready when indexing completes", () => {
    useKnowledgeStore.getState().setIndexingProgress(100, 100);
    expect(useKnowledgeStore.getState().indexingStatus).toBe("ready");
  });

  it("sets status to ready when indexed equals total (non-zero)", () => {
    useKnowledgeStore.getState().setIndexingProgress(50, 50);
    expect(useKnowledgeStore.getState().indexingStatus).toBe("ready");
  });

  it("sets error status", () => {
    useKnowledgeStore.getState().setError("Embedding provider unavailable");
    expect(useKnowledgeStore.getState().indexingStatus).toBe("error");
    expect(useKnowledgeStore.getState().error).toBe(
      "Embedding provider unavailable",
    );
  });

  it("sets total chunks", () => {
    useKnowledgeStore.getState().setTotalChunks(256);
    expect(useKnowledgeStore.getState().totalChunks).toBe(256);
  });

  it("resets all state", () => {
    useKnowledgeStore.getState().setIndexingProgress(50, 100);
    useKnowledgeStore.getState().setTotalChunks(200);
    useKnowledgeStore.getState().reset();

    const state = useKnowledgeStore.getState();
    expect(state.indexingStatus).toBe("idle");
    expect(state.indexedFiles).toBe(0);
    expect(state.totalFiles).toBe(0);
    expect(state.totalChunks).toBe(0);
    expect(state.error).toBeNull();
  });
});
