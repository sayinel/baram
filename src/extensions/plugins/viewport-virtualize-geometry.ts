// §perf-large-file C4 — PURE geometry for windowing. No DOM access; fully
// unit-tested. The controller (viewport-virtualize.ts) feeds it measured
// heights and reads back offsets/band/spacers.

export interface Band {
  first: number;
  last: number;
}

interface Entry {
  height: number;
  key: string;
  measured: boolean;
}

/** Node-keyed ordered height map with cumulative offsets + binary search. */
export class HeightMap {
  get length(): number {
    return this.entries.length;
  }
  get totalHeight(): number {
    this.rebuild();
    return this.total;
  }
  private dirty = true;
  private entries: Entry[] = [];

  private offsets: number[] = [];

  private total = 0;

  heightAt(index: number): number {
    return this.entries[index]?.height ?? 0;
  }

  /** First index whose [offset, offset+height) contains `y`; clamps to ends. */
  indexAtOffset(y: number): number {
    this.rebuild();
    const n = this.entries.length;
    if (n === 0) return 0;
    if (y <= 0) return 0;
    let lo = 0;
    let hi = n - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (this.offsets[mid] <= y) lo = mid;
      else hi = mid - 1;
    }
    return lo;
  }

  offsetAt(index: number): number {
    this.rebuild();
    return this.offsets[index] ?? this.total;
  }

  reset(keys: string[], estimate: number): void {
    this.entries = keys.map((key) => ({
      height: estimate,
      key,
      measured: false,
    }));
    this.dirty = true;
  }

  setHeight(index: number, height: number): void {
    const e = this.entries[index];
    if (!e) return;
    if (!e.measured || e.height !== height) {
      e.height = height;
      e.measured = true;
      this.dirty = true;
    }
  }

  /** Re-key after a structural edit, preserving measured heights by key. */
  syncKeys(keys: string[], estimate: number): void {
    const prev = new Map<string, Entry>();
    for (const e of this.entries) if (e.measured) prev.set(e.key, e);
    this.entries = keys.map((key) => {
      const old = prev.get(key);
      return old
        ? { height: old.height, key, measured: true }
        : { height: estimate, key, measured: false };
    });
    this.dirty = true;
  }

  private rebuild(): void {
    if (!this.dirty) return;
    const n = this.entries.length;
    this.offsets = new Array(n);
    let acc = 0;
    for (let i = 0; i < n; i++) {
      this.offsets[i] = acc;
      acc += this.entries[i].height;
    }
    this.total = acc;
    this.dirty = false;
  }
}

/** Block index range intersecting the buffered viewport. last = -1 when empty. */
export function computeBand(
  scrollTop: number,
  viewportHeight: number,
  buffer: number,
  hm: HeightMap,
): Band {
  const n = hm.length;
  if (n === 0) return { first: 0, last: -1 };
  const top = scrollTop - buffer;
  const bottom = scrollTop + viewportHeight + buffer;
  const first = hm.indexAtOffset(Math.max(0, top));
  // last = last block whose top offset is < bottom
  let last = first;
  while (last + 1 < n && hm.offsetAt(last + 1) < bottom) last++;
  return { first, last };
}

/** Indices entering (show) and leaving (hide) the band since `prev`. */
export function computeDelta(
  prev: Band | null,
  next: Band,
): { hide: number[]; show: number[] } {
  const inNext = (i: number) => i >= next.first && i <= next.last;
  const show: number[] = [];
  const hide: number[] = [];
  for (let i = next.first; i <= next.last; i++) {
    if (!prev || i < prev.first || i > prev.last) show.push(i);
  }
  if (prev) {
    for (let i = prev.first; i <= prev.last; i++) {
      if (!inNext(i)) hide.push(i);
    }
  }
  return { hide, show };
}

export function computeSpacers(
  band: Band,
  hm: HeightMap,
): { vbot: number; vtop: number } {
  if (band.last < band.first) return { vbot: 0, vtop: 0 };
  const vtop = hm.offsetAt(band.first);
  const lastBottom = hm.offsetAt(band.last) + hm.heightAt(band.last);
  const vbot = Math.max(0, hm.totalHeight - lastBottom);
  return { vbot, vtop };
}
