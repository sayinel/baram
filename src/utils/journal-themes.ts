// §56h Journal visual themes — calendar and journal component theming

export interface JournalTypography {
  fontFamily: string;
  lineHeight: number;
  maxWidth: string;
}

export interface JournalTheme {
  id: string;
  name: string;
  calendarBg: string;
  headerColor: string;
  accentColor: string;
  dotColor: string;
  streakIcon: string;
  typography: JournalTypography;
  headerBg: string;
  promptBg: string;
  promptBorder: string;
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
    typography: { fontFamily: "inherit", lineHeight: 1.6, maxWidth: "720px" },
    headerBg: "transparent",
    promptBg: "var(--color-bg-secondary, #f5f5f5)",
    promptBorder: "var(--color-border, #e0e0e0)",
  },
  {
    id: "nature",
    name: "Nature",
    calendarBg: "#F0F7EA",
    headerColor: "#2D5016",
    accentColor: "#4A7C2E",
    dotColor: "#6B9F45",
    streakIcon: "🌿",
    typography: { fontFamily: '"Noto Serif KR", serif', lineHeight: 1.8, maxWidth: "640px" },
    headerBg: "#E8F5E0",
    promptBg: "#F0F7EA",
    promptBorder: "#6B9F45",
  },
  {
    id: "ocean",
    name: "Ocean",
    calendarBg: "#EBF4FF",
    headerColor: "#1E3A5F",
    accentColor: "#2B6CB0",
    dotColor: "#4299E1",
    streakIcon: "🌊",
    typography: { fontFamily: '"Pretendard", sans-serif', lineHeight: 1.7, maxWidth: "680px" },
    headerBg: "#DBEAFE",
    promptBg: "#EBF4FF",
    promptBorder: "#4299E1",
  },
  {
    id: "sunset",
    name: "Sunset",
    calendarBg: "#FFF5ED",
    headerColor: "#9C4221",
    accentColor: "#DD6B20",
    dotColor: "#ED8936",
    streakIcon: "🌅",
    typography: { fontFamily: '"Pretendard", sans-serif', lineHeight: 1.8, maxWidth: "600px" },
    headerBg: "#FFEDD5",
    promptBg: "#FFF5ED",
    promptBorder: "#ED8936",
  },
  {
    id: "minimal",
    name: "Minimal",
    calendarBg: "#F9FAFB",
    headerColor: "#374151",
    accentColor: "#6B7280",
    dotColor: "#9CA3AF",
    streakIcon: "✦",
    typography: { fontFamily: "monospace", lineHeight: 1.6, maxWidth: "620px" },
    headerBg: "#F3F4F6",
    promptBg: "#F9FAFB",
    promptBorder: "#D1D5DB",
  },
];

export function getJournalTheme(id: string): JournalTheme {
  return JOURNAL_THEMES.find((t) => t.id === id) ?? JOURNAL_THEMES[0];
}

export function getStreakIcon(themeId: string): string {
  return getJournalTheme(themeId).streakIcon;
}
