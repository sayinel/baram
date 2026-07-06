/**
 * §56l — Daily Capture types
 */

export type CaptureType = "idea" | "link" | "note" | "quote";

export const CAPTURE_TYPES: CaptureType[] = ["idea", "link", "quote", "note"];

export const CAPTURE_ICONS: Record<CaptureType, string> = {
  idea: "✦",
  link: "↗",
  quote: "❝",
  note: "☰",
};
