// §11.3.2 SessionContextTracker — circular buffer of EditEvents with 5-min sliding window analysis

export interface EditEvent {
  nodeType: string;
  textLength: number;
  timestamp: number;
  type: "delete" | "insert" | "replace";
}

export type EditPattern =
  | "code-writing"
  | "list-writing"
  | "paragraph-writing"
  | "reviewing"
  | "structure-editing";

export interface SessionAnalysis {
  dominantPattern: EditPattern;
  eventCount: number;
  wordsPerMinute: number;
}

const BUFFER_LIMIT = 100;
const WINDOW_MS = 5 * 60 * 1000; // 5 minutes
const AVG_WORD_LENGTH = 5; // approximate chars per word

export class SessionContextTracker {
  private events: EditEvent[] = [];

  analyze(): SessionAnalysis {
    const now = Date.now();
    const windowEvents = this.events.filter(
      (e) => now - e.timestamp < WINDOW_MS,
    );

    if (windowEvents.length === 0) {
      return {
        dominantPattern: "paragraph-writing",
        eventCount: 0,
        wordsPerMinute: 0,
      };
    }

    const dominantPattern = this.detectPattern(windowEvents);
    const wordsPerMinute = this.calculateWPM(windowEvents);

    return {
      dominantPattern,
      eventCount: windowEvents.length,
      wordsPerMinute,
    };
  }

  getEvents(): EditEvent[] {
    return this.events;
  }

  record(event: EditEvent): void {
    this.events.push(event);
    if (this.events.length > BUFFER_LIMIT) {
      this.events = this.events.slice(this.events.length - BUFFER_LIMIT);
    }
  }

  toPromptContext(): string {
    const analysis = this.analyze();
    if (analysis.eventCount === 0) return "";

    const parts: string[] = [];
    parts.push(`Current editing pattern: ${analysis.dominantPattern}`);
    if (analysis.wordsPerMinute > 0) {
      parts.push(`Typing speed: ~${Math.round(analysis.wordsPerMinute)} WPM`);
    }
    return parts.join(". ") + ".";
  }

  private calculateWPM(events: EditEvent[]): number {
    if (events.length < 2) return 0;

    const timestamps = events.map((e) => e.timestamp);
    const minTime = Math.min(...timestamps);
    const maxTime = Math.max(...timestamps);
    const durationMinutes = (maxTime - minTime) / 60000;
    if (durationMinutes < 0.01) return 0;

    const totalChars = events
      .filter((e) => e.type === "insert")
      .reduce((sum, e) => sum + e.textLength, 0);
    const totalWords = totalChars / AVG_WORD_LENGTH;

    return totalWords / durationMinutes;
  }

  private detectPattern(events: EditEvent[]): EditPattern {
    const deleteCount = events.filter((e) => e.type === "delete").length;
    const insertCount = events.filter((e) => e.type === "insert").length;
    const totalCount = events.length;

    // High delete ratio → reviewing
    if (deleteCount / totalCount > 0.5) {
      return "reviewing";
    }

    // Count node types among inserts
    const insertEvents = events.filter((e) => e.type === "insert");
    const nodeTypeCounts: Record<string, number> = {};
    for (const e of insertEvents) {
      nodeTypeCounts[e.nodeType] = (nodeTypeCounts[e.nodeType] ?? 0) + 1;
    }

    const listCount = nodeTypeCounts.listItem ?? 0;
    const codeCount = nodeTypeCounts.codeBlock ?? 0;
    const headingCount = nodeTypeCounts.heading ?? 0;

    if (insertCount > 0 && listCount / insertCount > 0.5) {
      return "list-writing";
    }
    if (insertCount > 0 && codeCount / insertCount > 0.3) {
      return "code-writing";
    }
    if (
      insertCount > 0 &&
      headingCount / insertCount > 0.3 &&
      insertCount < 10
    ) {
      return "structure-editing";
    }

    return "paragraph-writing";
  }
}
