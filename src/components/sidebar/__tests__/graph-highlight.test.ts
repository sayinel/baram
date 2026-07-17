// §30.3a Search highlight — headless cytoscape tests
import cytoscape from "cytoscape";
import { describe, expect, it } from "vitest";

import {
  applySearchHighlight,
  SEARCH_DIM_CLASS,
  SEARCH_MATCH_CLASS,
} from "../graph-highlight";

function makeCy() {
  return cytoscape({
    headless: true,
    styleEnabled: true,
    elements: [
      { data: { id: "/v/alpha.md", label: "alpha" } },
      { data: { id: "/v/beta.md", label: "beta" } },
      { data: { id: "/v/alphabet.md", label: "alphabet" } },
      {
        data: { id: "e0", source: "/v/alpha.md", target: "/v/beta.md" },
      },
      {
        data: { id: "e1", source: "/v/alpha.md", target: "/v/alphabet.md" },
      },
    ],
  });
}

describe("applySearchHighlight", () => {
  it("marks matching nodes and dims the rest", () => {
    const cy = makeCy();
    applySearchHighlight(cy, "alpha");
    expect(cy.getElementById("/v/alpha.md").hasClass(SEARCH_MATCH_CLASS)).toBe(
      true,
    );
    expect(
      cy.getElementById("/v/alphabet.md").hasClass(SEARCH_MATCH_CLASS),
    ).toBe(true);
    expect(cy.getElementById("/v/beta.md").hasClass(SEARCH_DIM_CLASS)).toBe(
      true,
    );
    expect(cy.getElementById("/v/beta.md").hasClass(SEARCH_MATCH_CLASS)).toBe(
      false,
    );
    cy.destroy();
  });

  it("does not hide any node (highlight-over-filter)", () => {
    const cy = makeCy();
    applySearchHighlight(cy, "alpha");
    cy.nodes().forEach((node) => {
      expect(node.style("display")).not.toBe("none");
    });
    cy.destroy();
  });

  it("dims edges unless both endpoints match", () => {
    const cy = makeCy();
    applySearchHighlight(cy, "alpha");
    // alpha—beta: beta doesn't match → dim
    expect(cy.getElementById("e0").hasClass(SEARCH_DIM_CLASS)).toBe(true);
    // alpha—alphabet: both match → not dimmed
    expect(cy.getElementById("e1").hasClass(SEARCH_DIM_CLASS)).toBe(false);
    cy.destroy();
  });

  it("clears all classes on empty query", () => {
    const cy = makeCy();
    applySearchHighlight(cy, "alpha");
    applySearchHighlight(cy, "");
    cy.elements().forEach((el) => {
      expect(el.hasClass(SEARCH_MATCH_CLASS)).toBe(false);
      expect(el.hasClass(SEARCH_DIM_CLASS)).toBe(false);
    });
    cy.destroy();
  });

  it("leaves hidden elements untouched", () => {
    const cy = makeCy();
    cy.getElementById("/v/beta.md").style("display", "none");
    applySearchHighlight(cy, "alpha");
    expect(cy.getElementById("/v/beta.md").hasClass(SEARCH_DIM_CLASS)).toBe(
      false,
    );
    cy.destroy();
  });

  it("matches case-insensitively", () => {
    const cy = makeCy();
    applySearchHighlight(cy, "ALPHA");
    expect(cy.getElementById("/v/alpha.md").hasClass(SEARCH_MATCH_CLASS)).toBe(
      true,
    );
    cy.destroy();
  });
});
