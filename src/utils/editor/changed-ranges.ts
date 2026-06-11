// §perf-large-file C3.1: Derive changed ranges in the new doc from a Transaction.
// Uses tr.mapping.maps (array of StepMap) to collect [newStart, newEnd] intervals,
// then merges overlapping/adjacent ranges for efficient re-decoration.

import type { Transaction } from "@tiptap/pm/state";

export interface ChangedRange {
  from: number;
  to: number;
}

/**
 * Return sorted, merged ranges (in new-doc coordinates) that were touched
 * by the transaction's steps. Returns [] when tr.docChanged is false.
 */
export function changedRanges(tr: Transaction): ChangedRange[] {
  if (!tr.docChanged) return [];

  const raw: ChangedRange[] = [];

  // Each StepMap covers one step. We collect the new-doc interval for each
  // step by passing new-doc ranges through the remaining stepmaps forward.
  const maps = tr.mapping.maps;
  for (let stepIdx = 0; stepIdx < maps.length; stepIdx++) {
    const map = maps[stepIdx];
    map.forEach((_oldStart, _oldEnd, newStart, newEnd) => {
      // Map this new-doc position through the subsequent stepmaps so it ends
      // up in final new-doc coordinates.
      let from = newStart;
      let to = newEnd;
      for (let j = stepIdx + 1; j < maps.length; j++) {
        from = maps[j].map(from, -1);
        to = maps[j].map(to, 1);
      }
      raw.push({ from, to });
    });
  }

  if (raw.length === 0) return [];

  // Sort and merge overlapping/adjacent ranges.
  raw.sort((a, b) => a.from - b.from);
  const merged: ChangedRange[] = [raw[0]];
  for (let i = 1; i < raw.length; i++) {
    const last = merged[merged.length - 1];
    const cur = raw[i];
    if (cur.from <= last.to) {
      last.to = Math.max(last.to, cur.to);
    } else {
      merged.push({ from: cur.from, to: cur.to });
    }
  }

  return merged;
}
