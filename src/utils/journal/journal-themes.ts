// §56h Journal visual themes — calendar and journal component theming

import { bundledFamily } from "../font/bundled-fonts";

export interface JournalTheme {
  accentColor: string;
  calendarBg: string;
  dotColor: string;
  headerBg: string;
  headerColor: string;
  id: string;
  name: string;
  promptBg: string;
  promptBorder: string;
  streakIcon: string;
  typography: JournalTypography;
}

export interface JournalTypography {
  fontFamily: string;
  lineHeight: number;
  maxWidth: string;
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
    typography: {
      // §353 — 한글 세리프 손편지 인상. 번들엔 세리프가 없어(§347) 시스템
      // 한글 세리프 → 한글 산세리프(Apple SD Gothic Neo) → 제네릭으로 떨어진다.
      fontFamily: '"Noto Serif KR", "Apple SD Gothic Neo", serif',
      lineHeight: 1.8,
      maxWidth: "640px",
    },
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
    typography: {
      // §353 — 번들 직행. 정적 Pretendard 가 설치돼 있으면 그것도 잡는다.
      fontFamily: `${bundledFamily("body")}, Pretendard, sans-serif`,
      lineHeight: 1.7,
      maxWidth: "680px",
    },
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
    typography: {
      // §353 — Pretendard Variable 은 45–920 굵기를 한 패밀리로 커버한다
      // (§347) — "Pretendard Light" 는 별도 패밀리명이 아니라 font-weight 로
      // 얻는 값이라 체인에서 뺐다.
      fontFamily: `${bundledFamily("body")}, Pretendard, sans-serif`,
      lineHeight: 1.6,
      maxWidth: "600px",
    },
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
    typography: {
      // §353 — 한글 산세리프. Noto Sans KR 이 없는 머신에서도 번들
      // 산세리프로 떨어진다.
      fontFamily: `"Noto Sans KR", ${bundledFamily("body")}, sans-serif`,
      lineHeight: 1.7,
      maxWidth: "680px",
    },
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
    typography: {
      // §353 — 고정폭. D2Coding 이 없는 머신에서도 번들 고정폭으로 떨어진다.
      fontFamily: `"D2Coding", ${bundledFamily("code")}, monospace`,
      lineHeight: 1.8,
      maxWidth: "620px",
    },
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
    typography: {
      // §353 — 손글씨. 번들엔 손글씨 서체가 없어(§347) 두 대안 모두 설치
      // 의존적이다: Nanum Pen Script → Gaegu → cursive. 알려진 한계: 어느
      // 쪽도 설치되지 않은 머신에서는 cursive 가 한글에서 사실상 sans 로
      // 렌더돼 이 테마의 손글씨 인상이 사라진다 — 그 머신에서만 스펙대로
      // 보인다는 뜻이고, 그 자체는 이번 범위 밖(서체 대신 배경·자간·색으로
      // 개성을 옮기는 재설계가 필요하다)이라 문서화만 해 둔다.
      fontFamily: '"Nanum Pen Script", "Gaegu", cursive',
      lineHeight: 1.9,
      maxWidth: "640px",
    },
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
