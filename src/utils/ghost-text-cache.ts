// §11.2.2 Ghost Text Cache — TTL-based prefix cache with file invalidation

interface CacheEntry {
  filePath?: string;
  hitCount: number;
  prefix: string;
  suggestion: string;
  timestamp: number;
}

interface CacheOptions {
  maxSize?: number;
  ttlMs?: number;
}

export class GhostTextCache {
  private entries = new Map<string, CacheEntry>();
  private maxSize: number;
  private totalHits = 0;
  private ttlMs: number;

  constructor(options: CacheOptions = {}) {
    this.maxSize = options.maxSize ?? 50;
    this.ttlMs = options.ttlMs ?? 5 * 60 * 1000;
  }

  clear(): void {
    this.entries.clear();
    this.totalHits = 0;
  }

  get(prefix: string): string | undefined {
    const key = this.toKey(prefix);
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    if (Date.now() - entry.timestamp > this.ttlMs) {
      this.entries.delete(key);
      return undefined;
    }
    entry.hitCount++;
    this.totalHits++;
    return entry.suggestion;
  }

  getStats(): { hits: number; size: number } {
    return { size: this.entries.size, hits: this.totalHits };
  }

  invalidateFile(filePath: string): void {
    for (const [key, entry] of this.entries) {
      if (entry.filePath === filePath) {
        this.entries.delete(key);
      }
    }
  }

  set(prefix: string, suggestion: string, filePath?: string): void {
    const key = this.toKey(prefix);
    if (this.entries.size >= this.maxSize && !this.entries.has(key)) {
      const oldest = this.entries.keys().next().value;
      if (oldest !== undefined) this.entries.delete(oldest);
    }
    this.entries.set(key, {
      prefix,
      suggestion,
      filePath,
      timestamp: Date.now(),
      hitCount: 0,
    });
  }

  private toKey(prefix: string): string {
    return prefix.slice(-200);
  }
}
