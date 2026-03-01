// §56h Journal visual themes — calendar and journal component theming

export interface JournalTheme {
  id: string;
  name: string;
  calendarBg: string;
  headerColor: string;
  accentColor: string;
  dotColor: string;
  streakIcon: string;
}

export const JOURNAL_THEMES: JournalTheme[] = [
  {
    id: "default",
    name: "Default",
    calendarBg: "",
    headerColor: "",
    accentColor: "",
    dotColor: "",
    streakIcon: "🔥",
  },
  {
    id: "nature",
    name: "Nature",
    calendarBg: "#F0F7EA",
    headerColor: "#2D5016",
    accentColor: "#4A7C2E",
    dotColor: "#6B9F45",
    streakIcon: "🌿",
  },
  {
    id: "ocean",
    name: "Ocean",
    calendarBg: "#EBF4FF",
    headerColor: "#1E3A5F",
    accentColor: "#2B6CB0",
    dotColor: "#4299E1",
    streakIcon: "🌊",
  },
  {
    id: "sunset",
    name: "Sunset",
    calendarBg: "#FFF5ED",
    headerColor: "#9C4221",
    accentColor: "#DD6B20",
    dotColor: "#ED8936",
    streakIcon: "🌅",
  },
  {
    id: "minimal",
    name: "Minimal",
    calendarBg: "#F9FAFB",
    headerColor: "#374151",
    accentColor: "#6B7280",
    dotColor: "#9CA3AF",
    streakIcon: "✦",
  },
];

export function getJournalTheme(id: string): JournalTheme {
  return JOURNAL_THEMES.find((t) => t.id === id) ?? JOURNAL_THEMES[0];
}

export function getStreakIcon(themeId: string): string {
  return getJournalTheme(themeId).streakIcon;
}
