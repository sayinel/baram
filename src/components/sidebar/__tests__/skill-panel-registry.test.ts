// §72c skill-panel-registry tests
import { describe, it, expect, beforeEach } from "vitest";

// We need to isolate the module state between tests, so we use dynamic import with cache busting
// Instead, we'll directly test the exported functions and reset state via re-registration

describe("skill-panel-registry", () => {
  // Reset module between tests to clear the sections array
  let registerSkillSection: typeof import("../skill-panel-registry").registerSkillSection;
  let getSkillSections: typeof import("../skill-panel-registry").getSkillSections;

  beforeEach(async () => {
    // Clear module cache to reset the sections array
    const modulePath = "../skill-panel-registry";
    // vitest supports module invalidation via vi.resetModules
    const { vi } = await import("vitest");
    vi.resetModules();
    const mod = await import(modulePath);
    registerSkillSection = mod.registerSkillSection;
    getSkillSections = mod.getSkillSections;
  });

  it("registers a new section", () => {
    const DummyComponent = () => null;
    registerSkillSection({ id: "test", title: "Test", order: 10, component: DummyComponent });

    const sections = getSkillSections();
    expect(sections).toHaveLength(1);
    expect(sections[0]).toEqual({ id: "test", title: "Test", order: 10, component: DummyComponent });
  });

  it("replaces section with same id (no duplicates)", () => {
    const A = () => null;
    const B = () => null;

    registerSkillSection({ id: "dup", title: "First", order: 1, component: A });
    registerSkillSection({ id: "dup", title: "Second", order: 2, component: B });

    const sections = getSkillSections();
    expect(sections).toHaveLength(1);
    expect(sections[0].title).toBe("Second");
    expect(sections[0].component).toBe(B);
  });

  it("returns sections sorted by order", () => {
    const C1 = () => null;
    const C2 = () => null;
    const C3 = () => null;

    registerSkillSection({ id: "z", title: "Last", order: 99, component: C1 });
    registerSkillSection({ id: "a", title: "First", order: 1, component: C2 });
    registerSkillSection({ id: "m", title: "Mid", order: 50, component: C3 });

    const sections = getSkillSections();
    expect(sections.map((s) => s.id)).toEqual(["a", "m", "z"]);
  });

  it("returns a copy (mutation-safe)", () => {
    const D = () => null;
    registerSkillSection({ id: "safe", title: "Safe", order: 1, component: D });

    const first = getSkillSections();
    first.push({ id: "injected", title: "Injected", order: 999, component: D });

    const second = getSkillSections();
    expect(second).toHaveLength(1);
    expect(second[0].id).toBe("safe");
  });
});
