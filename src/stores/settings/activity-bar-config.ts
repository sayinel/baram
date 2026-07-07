// Activity bar item configuration types and defaults.

export interface ActivityBarItemConfig {
  id: string;
  section: "bottom" | "top";
  visible: boolean;
}

export const DEFAULT_ACTIVITY_BAR_CONFIG: ActivityBarItemConfig[] = [
  // Top section — sidebar panels
  { id: "files", visible: true, section: "top" },
  { id: "search", visible: true, section: "top" },
  { id: "outline", visible: true, section: "top" },
  { id: "backlinks", visible: true, section: "top" },
  { id: "bookmarks", visible: true, section: "top" },
  { id: "graph", visible: true, section: "top" },
  { id: "git", visible: true, section: "top" },
  { id: "calendar", visible: true, section: "top" },
  { id: "tags", visible: true, section: "top" },
  { id: "zettel", visible: true, section: "top" },
  { id: "skills-gallery", visible: true, section: "top" },
  { id: "plugins", visible: true, section: "top" },
  // Bottom section — right panels + utilities
  { id: "chat", visible: true, section: "bottom" },
  { id: "memories", visible: true, section: "bottom" },
  { id: "photo-gallery", visible: true, section: "bottom" },
  { id: "snapshots", visible: true, section: "bottom" },
  { id: "help", visible: true, section: "bottom" },
];
