import { describe, expect, it, vi } from "vitest";

// Mock the Tauri asset-URL converter so tests run outside a Tauri runtime.
vi.mock("@tauri-apps/api/core", () => ({
  convertFileSrc: (p: string) => `asset://localhost/${p}`,
}));

import { resolveImageSrcs } from "../utils";

// §backlog #5 — resolveImageSrcs must resolve relative image srcs via a DOM
// parser (not a double-quote-only regex) so no relative/malicious src slips
// through unresolved.
describe("resolveImageSrcs", () => {
  it("resolves a relative src against fileDir", () => {
    const out = resolveImageSrcs('<img src="pic.png">', "/vault/journal");
    expect(out).toContain("/vault/journal/pic.png");
  });

  it("strips a leading ./", () => {
    const out = resolveImageSrcs('<img src="./a/b.png">', "/d");
    expect(out).toContain("/d/a/b.png");
  });

  it("keeps an already-rooted path", () => {
    const out = resolveImageSrcs('<img src="/abs/x.png">', "/d");
    expect(out).toContain("asset://localhost//abs/x.png");
  });

  it("skips http(s) and data URLs untouched", () => {
    expect(resolveImageSrcs('<img src="https://x/y.png">', "/d")).toContain(
      'src="https://x/y.png"',
    );
    expect(
      resolveImageSrcs('<img src="data:image/png;base64,AA">', "/d"),
    ).toContain("data:image/png;base64,AA");
  });

  it("resolves single-quoted src the old regex would have missed", () => {
    const out = resolveImageSrcs("<img src='rel.png'>", "/d");
    expect(out).toContain("/d/rel.png");
    // The relative src must not survive unresolved.
    expect(out).not.toMatch(/src=["']rel\.png["']/);
  });
});
