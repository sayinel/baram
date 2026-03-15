// Pure TypeScript utilities for YAML properties panel — no React dependencies.

// ─── Types ────────────────────────────────────────────────────────────────────

export interface PropertyEntry {
  key: string;
  type: PropertyType;
  value: string | string[];
}

export type PropertyType = "array" | "enum" | "string";

// Keys that are always treated as arrays
export const ARRAY_KEYS = new Set(["requires", "tags"]);

// Keys that are treated as enums
export const ENUM_KEYS = new Set(["status"]);
export const ENUM_VALUES: Record<string, string[]> = {
  status: ["draft", "active", "deprecated"],
};

// ─── Parse / Serialize ────────────────────────────────────────────────────────

/**
 * Parse a YAML frontmatter string (without --- delimiters) into PropertyEntry[].
 */
export function parseYamlProperties(yaml: string): PropertyEntry[] {
  if (!yaml || !yaml.trim()) return [];

  const entries: PropertyEntry[] = [];
  const lines = yaml.split("\n");

  for (const line of lines) {
    const colonIdx = line.indexOf(":");
    if (colonIdx === -1) continue;

    const key = line.slice(0, colonIdx).trim();
    if (!key) continue;

    const rawValue = line.slice(colonIdx + 1).trim();

    if (ENUM_KEYS.has(key)) {
      entries.push({ key, value: rawValue, type: "enum" });
      continue;
    }

    if (ARRAY_KEYS.has(key)) {
      // bracket syntax: [a, b] or []
      const bracketMatch = rawValue.match(/^\[(.*)\]$/);
      if (bracketMatch) {
        const inner = bracketMatch[1].trim();
        const items =
          inner === ""
            ? []
            : inner
                .split(",")
                .map((s) => s.trim())
                .filter(Boolean);
        entries.push({ key, value: items, type: "array" });
      } else {
        // single value without brackets — still treat as array
        const items = rawValue ? [rawValue] : [];
        entries.push({ key, value: items, type: "array" });
      }
      continue;
    }

    // default: string
    entries.push({ key, value: rawValue, type: "string" });
  }

  return entries;
}

/**
 * Serialize PropertyEntry[] back to a YAML string (without --- delimiters).
 */
export function serializeYamlProperties(entries: PropertyEntry[]): string {
  return entries
    .map((entry) => {
      if (entry.type === "array") {
        const arr = entry.value as string[];
        const bracketList = arr.join(", ");
        return `${entry.key}: [${bracketList}]`;
      }
      return `${entry.key}: ${entry.value as string}`;
    })
    .join("\n");
}
