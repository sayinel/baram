// §11.7 AuthorshipTracker — tracks AI vs human authorship per document segment

export interface AuthorshipMeta {
  action: string;
  model: string;
  provider: string;
}

export interface AuthorshipSegment {
  from: number;
  meta?: AuthorshipMeta;
  origin: "ai-generated" | "ai-modified" | "human";
  timestamp: number;
  to: number;
}

export interface AuthorshipStats {
  aiGeneratedPercent: number;
  aiModifiedPercent: number;
  humanPercent: number;
}

/**
 * Tracks authorship segments for a single document.
 * Segments are non-overlapping ranges tagged with their origin (human / ai-generated / ai-modified).
 */
export class AuthorshipTracker {
  private segments: AuthorshipSegment[] = [];

  /** Clear all segments. */
  clear(): void {
    this.segments = [];
  }

  /** Returns all tracked segments sorted by position. */
  getSegments(): AuthorshipSegment[] {
    return [...this.segments].sort((a, b) => a.from - b.from);
  }

  /** Calculate authorship statistics relative to total document length. */
  getStats(totalLength: number): AuthorshipStats {
    if (totalLength === 0) {
      return { humanPercent: 100, aiGeneratedPercent: 0, aiModifiedPercent: 0 };
    }

    let aiGenLen = 0;
    let aiModLen = 0;
    let humanLen = 0;

    for (const seg of this.segments) {
      const len = seg.to - seg.from;
      switch (seg.origin) {
        case "ai-generated":
          aiGenLen += len;
          break;
        case "ai-modified":
          aiModLen += len;
          break;
        case "human":
          humanLen += len;
          break;
      }
    }

    // Untracked regions count as human
    const trackedTotal = aiGenLen + aiModLen + humanLen;
    const untrackedLen = Math.max(0, totalLength - trackedTotal);
    humanLen += untrackedLen;

    return {
      aiGeneratedPercent: Math.round((aiGenLen / totalLength) * 100),
      aiModifiedPercent: Math.round((aiModLen / totalLength) * 100),
      humanPercent: Math.round((humanLen / totalLength) * 100),
    };
  }

  /** Record a range as AI-generated (e.g. ghost text acceptance). */
  recordAIGenerated(from: number, to: number, meta: AuthorshipMeta): void {
    this.addSegment(from, to, "ai-generated", meta);
  }

  /** Record a range as AI-modified (e.g. inline edit acceptance). */
  recordAIModified(from: number, to: number, meta: AuthorshipMeta): void {
    this.addSegment(from, to, "ai-modified", meta);
  }

  /**
   * Record human editing in a range.
   * AI segments overlapping the range are split; the overlapping portion becomes human.
   */
  recordHumanEdit(from: number, to: number): void {
    const result: AuthorshipSegment[] = [];
    const now = Date.now();

    for (const seg of this.segments) {
      // No overlap — keep segment as-is
      if (seg.to <= from || seg.from >= to) {
        result.push(seg);
        continue;
      }

      // Segment is fully covered by human edit — convert to human
      if (seg.from >= from && seg.to <= to) {
        result.push({
          ...seg,
          origin: "human",
          timestamp: now,
          meta: undefined,
        });
        continue;
      }

      // Partial overlap — split
      if (seg.from < from) {
        // Left portion keeps original origin
        result.push({ ...seg, to: from });
      }

      // Middle portion becomes human
      const humanFrom = Math.max(seg.from, from);
      const humanTo = Math.min(seg.to, to);
      result.push({
        from: humanFrom,
        origin: "human",
        timestamp: now,
        to: humanTo,
      });

      if (seg.to > to) {
        // Right portion keeps original origin
        result.push({ ...seg, from: to });
      }
    }

    this.segments = result;
  }

  private addSegment(
    from: number,
    to: number,
    origin: AuthorshipSegment["origin"],
    meta: AuthorshipMeta,
  ): void {
    this.segments.push({
      from,
      meta,
      origin,
      timestamp: Date.now(),
      to,
    });
  }
}
