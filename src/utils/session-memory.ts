// §11.3.3 SessionMemory — track AI suggestion rejections and user preferences per file

const MAX_REJECTIONS = 10;

export interface SessionPreferences {
  avoidPatterns: string[];
  preferPatterns: string[];
}

export class SessionMemory {
  private avoidPatterns: string[] = [];
  private preferPatterns: string[] = [];
  private rejections: string[] = [];

  constructor(public readonly fileId: string) {}

  addAvoidPattern(pattern: string): void {
    if (!this.avoidPatterns.includes(pattern)) {
      this.avoidPatterns.push(pattern);
    }
  }

  addPreferPattern(pattern: string): void {
    if (!this.preferPatterns.includes(pattern)) {
      this.preferPatterns.push(pattern);
    }
  }

  getPreferences(): SessionPreferences {
    return {
      avoidPatterns: [...this.avoidPatterns],
      preferPatterns: [...this.preferPatterns],
    };
  }

  getRejections(): string[] {
    return [...this.rejections];
  }

  recordRejection(rejectedText: string): void {
    this.rejections.push(rejectedText);
    if (this.rejections.length > MAX_REJECTIONS) {
      this.rejections = this.rejections.slice(
        this.rejections.length - MAX_REJECTIONS,
      );
    }
  }

  toPromptContext(): string {
    const parts: string[] = [];

    if (this.rejections.length > 0) {
      const samples = this.rejections.slice(-3);
      parts.push(
        `DO NOT suggest text similar to these rejected suggestions:\n${samples.map((r) => `- "${r}"`).join("\n")}`,
      );
    }

    if (this.avoidPatterns.length > 0) {
      parts.push(`Avoid: ${this.avoidPatterns.join(", ")}`);
    }

    if (this.preferPatterns.length > 0) {
      parts.push(`Prefer: ${this.preferPatterns.join(", ")}`);
    }

    return parts.join("\n\n");
  }
}
