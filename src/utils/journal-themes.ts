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
    id: "classic-diary",
    name: "Classic Diary",
    calendarBg: "#FDF6E3",
    headerColor: "#5C4B37",
    accentColor: "#8B6914",
    dotColor: "#A0845C",
    streakIcon: "🔥",
    typography: { fontFamily: '"Noto Serif KR", serif', lineHeight: 1.8, maxWidth: "640px" },
    headerBg: "#F5ECD7",
    promptBg: "#FDF6E3",
    promptBorder: "#D4C5A0",
  },
  {
    id: "moleskine",
    name: "Moleskine",
    calendarBg: "#F5F1EB",
    headerColor: "#3D3229",
    accentColor: "#6B5B4F",
    dotColor: "#8B7D6B",
    streakIcon: "✦",
    typography: { fontFamily: '"Pretendard", sans-serif', lineHeight: 1.7, maxWidth: "680px" },
    headerBg: "#EDE8E0",
    promptBg: "#F5F1EB",
    promptBorder: "#C4B8A8",
  },
  {
    id: "muji",
    name: "Muji",
    calendarBg: "#FFFFFF",
    headerColor: "#374151",
    accentColor: "#6B7280",
    dotColor: "#9CA3AF",
    streakIcon: "·",
    typography: { fontFamily: '"Pretendard", "Pretendard Light", sans-serif', lineHeight: 1.6, maxWidth: "600px" },
    headerBg: "#F9FAFB",
    promptBg: "#FFFFFF",
    promptBorder: "#E5E7EB",
  },
  {
    id: "night-owl",
    name: "Night Owl",
    calendarBg: "#1B2838",
    headerColor: "#D6DEEB",
    accentColor: "#4299E1",
    dotColor: "#63B3ED",
    streakIcon: "🌙",
    typography: { fontFamily: '"Noto Sans KR", sans-serif', lineHeight: 1.7, maxWidth: "680px" },
    headerBg: "#1E3A5F",
    promptBg: "#1B2838",
    promptBorder: "#2D4A6F",
  },
  {
    id: "vintage",
    name: "Vintage",
    calendarBg: "#F0E6D3",
    headerColor: "#5C4B3A",
    accentColor: "#8B6F47",
    dotColor: "#A89F91",
    streakIcon: "🖋️",
    typography: { fontFamily: '"D2Coding", monospace', lineHeight: 1.8, maxWidth: "620px" },
    headerBg: "#E8DCCB",
    promptBg: "#F0E6D3",
    promptBorder: "#C4B8A0",
  },
  {
    id: "watercolor",
    name: "Watercolor",
    calendarBg: "#F8F4F0",
    headerColor: "#5B6ABF",
    accentColor: "#7EB5A6",
    dotColor: "#A8D8C8",
    streakIcon: "🎨",
    typography: { fontFamily: '"Nanum Pen Script", cursive', lineHeight: 1.9, maxWidth: "640px" },
    headerBg: "#F0EBE5",
    promptBg: "#F8F4F0",
    promptBorder: "#C8BFB5",
  },
];

export function getJournalTheme(id: string): JournalTheme {
  return JOURNAL_THEMES.find((t) => t.id === id) ?? JOURNAL_THEMES[0];
}

export function getStreakIcon(themeId: string): string {
  return getJournalTheme(themeId).streakIcon;
}
