/**
 * §56i Daily Writing Prompts — deterministic daily prompt selection
 */

export const DAILY_PROMPTS: string[] = [
  // 감사 / Gratitude
  "오늘 가장 감사한 일은 무엇인가요?",
  "오늘 나를 미소 짓게 한 것은?",
  "최근 당연하게 여겼지만 사실 감사한 것은?",
  "오늘 주변 사람들 중 고마운 사람이 있나요?",
  "지난 일주일 동안 가장 좋았던 순간은?",

  // 목표 / Goals
  "이번 주 목표는 무엇인가요?",
  "이번 달 꼭 하고 싶은 것은?",
  "올해 이루고 싶은 가장 중요한 한 가지는?",
  "오늘 집중하고 싶은 일은 무엇인가요?",
  "지금 가장 미루고 있는 일은 무엇인가요?",

  // 성찰 / Reflection
  "최근 배운 것 중 인상 깊은 것은?",
  "오늘의 에너지 레벨은 어땠나요?",
  "이번 주 가장 잘 한 결정은?",
  "최근 어떤 실수에서 무엇을 배웠나요?",
  "지금의 나에게 한 가지 조언을 한다면?",
  "1년 전의 나와 지금의 나는 어떻게 달라졌나요?",
  "오늘 내가 가장 잘 한 일은?",
  "지금 나의 강점은 무엇인가요?",

  // 창의성 / Creativity
  "최근 읽은 글이나 책에서 인상 깊은 구절은?",
  "요즘 관심 있는 새로운 아이디어는?",
  "만약 오늘 하루를 다시 산다면 무엇을 다르게 할까요?",
  "지금 해보고 싶은 새로운 시도는?",
  "최근 영감을 받은 것이 있나요?",
  "내가 더 잘하고 싶은 기술이나 능력은?",

  // 관계 / Relationships
  "오늘 연락하고 싶은 사람이 있나요?",
  "최근 누군가에게 고마움을 표현했나요?",
  "나에게 긍정적인 영향을 주는 사람은 누구인가요?",
  "주변 사람들과의 관계에서 더 잘 하고 싶은 부분은?",
  "오늘 누군가를 도울 수 있는 작은 방법은?",

  // 감정 / Emotions
  "지금 가장 신경 쓰이는 것은?",
  "오늘 기분은 어떤가요? 그 이유는?",
  "최근 스트레스를 주는 것은 무엇인가요?",
  "요즘 가장 설레는 것은?",
  "지금 마음을 편하게 해주는 것은?",
  "최근 무언가에 두려움을 느낀 적이 있나요?",
  "오늘 나의 감정을 한 단어로 표현한다면?",

  // 건강 / Health & Wellbeing
  "오늘 몸을 위해 한 좋은 일은?",
  "요즘 충분히 쉬고 있나요?",
  "최근 운동이나 신체 활동은 어떤가요?",
  "오늘 먹은 것 중 가장 맛있었던 것은?",
  "잘 자고 있나요? 수면 루틴을 개선할 방법은?",

  // 성장 / Growth
  "요즘 어떤 책, 팟캐스트, 영상을 즐기고 있나요?",
  "최근 도전한 것 중 뿌듯한 것은?",
  "앞으로 6개월 후 나는 어떤 모습이면 좋겠나요?",
  "지금 배우고 싶은 새로운 기술이나 지식은?",
  "내 삶에서 더 많이 원하는 것은 무엇인가요?",
  "내 삶에서 줄이고 싶은 것은 무엇인가요?",

  // 일 / Work
  "오늘 가장 생산적인 순간은 언제였나요?",
  "지금 하는 일에서 의미를 느끼는 부분은?",
  "업무에서 개선하고 싶은 습관이 있나요?",
  "오늘 집중을 방해한 것은 무엇인가요?",
  "이번 프로젝트에서 가장 기대되는 부분은?",

  // 환경 / Environment
  "오늘 날씨나 자연에서 인상 깊었던 것은?",
  "요즘 나만의 공간을 어떻게 꾸미고 싶나요?",
  "주변 환경에서 바꾸고 싶은 것이 있나요?",

  // 미래 / Future
  "5년 후 내가 꼭 해내고 싶은 것은?",
  "내가 가장 두려워하는 미래의 시나리오는? 어떻게 대비할 수 있을까요?",
  "미래의 나에게 전하고 싶은 메시지는?",
  "오늘 내가 만들어가는 내일은 어떤 모습인가요?",

  // 현재 / Present Moment
  "지금 이 순간, 주변에서 아름다운 것은?",
  "오늘 하루를 한 문장으로 요약한다면?",
  "지금 이 순간 가장 중요한 것은?",
];

/**
 * Get a deterministic daily prompt for a given date.
 * Same date always returns same prompt, even across sessions.
 */
export function getDailyPrompt(date: Date): string {
  const start = new Date(date.getFullYear(), 0, 0);
  const diff = date.getTime() - start.getTime();
  const oneDay = 1000 * 60 * 60 * 24;
  const dayOfYear = Math.floor(diff / oneDay);
  const index = dayOfYear % DAILY_PROMPTS.length;
  return DAILY_PROMPTS[index];
}

/**
 * Get a truly random prompt (for refresh button).
 */
export function getRandomPrompt(): string {
  const index = Math.floor(Math.random() * DAILY_PROMPTS.length);
  return DAILY_PROMPTS[index];
}
