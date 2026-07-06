/**
 * §56l — Daily Capture types, parsing, and serialization
 */

export interface CaptureItem {
  body?: string;
  source?: string;
  tags?: string[];
  title?: string;
  type: CaptureType;
  url?: string;
}

export type CaptureType = "idea" | "link" | "note" | "quote";

export const CAPTURE_TYPES: CaptureType[] = ["idea", "link", "quote", "note"];

export const CAPTURE_ICONS: Record<CaptureType, string> = {
  idea: "✦",
  link: "↗",
  quote: "❝",
  note: "☰",
};

/** Serialize a CaptureItem to a markdown bullet string */
export function serializeCaptureToMarkdown(item: CaptureItem): string {
  const icon = CAPTURE_ICONS[item.type];
  const tagSuffix = item.tags?.length
    ? " " + item.tags.map((t) => `#${t}`).join(" ")
    : "";

  switch (item.type) {
    case "idea": {
      if (item.title) {
        return `- ${icon} **${item.title}**: ${item.body ?? ""}${tagSuffix}`.trimEnd();
      }
      return `- ${icon} ${item.body ?? ""}${tagSuffix}`.trimEnd();
    }
    case "link": {
      const link = item.url
        ? `[${item.title ?? ""}](${item.url})`
        : (item.title ?? "");
      const bodyPart = item.body ? ` — ${item.body}` : "";
      return `- ${icon} ${link}${bodyPart}${tagSuffix}`.trimEnd();
    }
    case "note": {
      return `- ${icon} ${item.body ?? ""}${tagSuffix}`.trimEnd();
    }
    case "quote": {
      const sourcePart = item.source ? ` — ${item.source}` : "";
      return `- ${icon} "${item.body ?? ""}"${sourcePart}${tagSuffix}`.trimEnd();
    }
  }
}
