// §30.3a Graph View — search highlight (highlight-over-filter)
import type { Core } from "cytoscape";

import { matchesFilter } from "./graph-utils";

export const SEARCH_MATCH_CLASS = "search-match";
export const SEARCH_DIM_CLASS = "search-dim";

/**
 * Highlight nodes whose label matches the query and dim everything else,
 * WITHOUT changing element visibility. Users prefer highlight-over-filter
 * for exploration (Logseq-style); it also keeps the simulation's visible
 * set stable, so typing never re-layouts the graph. Hidden elements are
 * left untouched; an empty query clears all search classes.
 */
export function applySearchHighlight(cy: Core, query: string): void {
  cy.batch(() => {
    cy.elements().removeClass(`${SEARCH_MATCH_CLASS} ${SEARCH_DIM_CLASS}`);
    if (!query) return;

    const matched = new Set<string>();
    cy.nodes().forEach((node) => {
      if (node.style("display") === "none") return;
      if (matchesFilter(node.data("label") as string, query)) {
        matched.add(node.id());
        node.addClass(SEARCH_MATCH_CLASS);
      } else {
        node.addClass(SEARCH_DIM_CLASS);
      }
    });
    cy.edges().forEach((edge) => {
      if (edge.style("display") === "none") return;
      if (
        !matched.has(edge.source().id()) ||
        !matched.has(edge.target().id())
      ) {
        edge.addClass(SEARCH_DIM_CLASS);
      }
    });
  });
}
