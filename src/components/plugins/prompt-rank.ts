// §385 Filtering and ranking for the quick pick (spec 0061 §4, §7).
//
// Items are lowercased ONCE, when the prompt opens (`prepareItems`); each keystroke then
// lowercases only the query. Measured (spec 0061 §7, Node, 5,000 items × two 200-character
// fields): p99 3.5 ms this way against 4.2 ms lowercasing per call.
import { fuzzyScoreLower } from "../../utils/file-search";

export interface PreparedItem {
  description: string;
  item: RankedItem;
  label: string;
}

export interface RankedItem {
  description?: string;
  id: string;
  label: string;
}

export function prepareItems(items: readonly RankedItem[]): PreparedItem[] {
  return items.map((item) => ({
    description: (item.description ?? "").toLowerCase(),
    item,
    label: item.label.toLowerCase(),
  }));
}

/**
 * The rows to show for `query`: items whose label matches, best score first, then items only
 * their description matches, best first — at most `limit`. An empty query keeps the plugin's
 * order. `fuzzyScoreLower` returns Infinity for no match, so one score is also the filter.
 */
export function rankItems(
  query: string,
  prepared: readonly PreparedItem[],
  limit: number,
): RankedItem[] {
  if (query === "") return prepared.slice(0, limit).map((p) => p.item);
  const q = query.toLowerCase();
  const byLabel: [number, RankedItem][] = [];
  const byDescription: [number, RankedItem][] = [];
  for (const p of prepared) {
    const label = fuzzyScoreLower(q, p.label);
    if (label !== Infinity) {
      byLabel.push([label, p.item]);
      continue;
    }
    const description = fuzzyScoreLower(q, p.description);
    if (description !== Infinity) byDescription.push([description, p.item]);
  }
  byLabel.sort((a, b) => a[0] - b[0]);
  byDescription.sort((a, b) => a[0] - b[0]);
  return [...byLabel, ...byDescription].slice(0, limit).map(([, item]) => item);
}
