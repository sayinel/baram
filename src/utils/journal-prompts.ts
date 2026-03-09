/**
 * §56i Daily Writing Prompts — deterministic daily prompt selection
 * Expanded to 120 structured prompts across 5 categories.
 */

import { readFile, listDir } from "../ipc/invoke";

export interface DailyPrompt {
  id: string;
  category: "gratitude" | "reflection" | "goals" | "creative" | "relationships";
  text: string;
}

export const DAILY_PROMPTS: DailyPrompt[] = [
  // ── 감사 / Gratitude (30) ───────────────────────────────────────────────
  {
    id: "g-001",
    category: "gratitude",
    text: "오늘 가장 감사한 일은 무엇인가요?",
  },
  { id: "g-002", category: "gratitude", text: "오늘 나를 미소 짓게 한 것은?" },
  {
    id: "g-003",
    category: "gratitude",
    text: "최근 당연하게 여겼지만 사실 감사한 것은?",
  },
  {
    id: "g-004",
    category: "gratitude",
    text: "오늘 주변 사람들 중 고마운 사람이 있나요?",
  },
  {
    id: "g-005",
    category: "gratitude",
    text: "지난 일주일 동안 가장 좋았던 순간은?",
  },
  {
    id: "g-006",
    category: "gratitude",
    text: "오늘 누군가에게 받은 작은 친절은?",
  },
  {
    id: "g-007",
    category: "gratitude",
    text: "지금 내 삶에서 가장 풍요로운 부분은?",
  },
  {
    id: "g-008",
    category: "gratitude",
    text: "오늘 감각으로 느낀 아름다운 것은? (맛, 향, 소리, 촉감, 시각)",
  },
  {
    id: "g-009",
    category: "gratitude",
    text: "내가 당연히 사용하는 것 중 정말 고마운 도구나 기술은?",
  },
  {
    id: "g-010",
    category: "gratitude",
    text: "이번 주 나를 위해 시간을 내어 준 사람은?",
  },
  {
    id: "g-011",
    category: "gratitude",
    text: "오늘 예상치 못한 좋은 일이 있었나요?",
  },
  {
    id: "g-012",
    category: "gratitude",
    text: "지금 이 순간 건강한 몸의 어떤 부분에 감사한가요?",
  },
  {
    id: "g-013",
    category: "gratitude",
    text: "내가 살고 있는 공간에서 감사한 점 세 가지는?",
  },
  {
    id: "g-014",
    category: "gratitude",
    text: "어린 시절 내게 주어졌던 것 중 지금도 감사한 것은?",
  },
  {
    id: "g-015",
    category: "gratitude",
    text: "오늘 날씨나 계절이 내게 준 선물은?",
  },
  {
    id: "g-016",
    category: "gratitude",
    text: "최근 읽거나 들은 것 중 마음을 따뜻하게 한 이야기는?",
  },
  {
    id: "g-017",
    category: "gratitude",
    text: "나를 성장하게 해준 어려운 경험에 감사할 수 있나요?",
  },
  {
    id: "g-018",
    category: "gratitude",
    text: "오늘 나 자신이 잘 해낸 일 한 가지는?",
  },
  {
    id: "g-019",
    category: "gratitude",
    text: "내 일상의 작은 루틴 중 감사하게 여기는 것은?",
  },
  {
    id: "g-020",
    category: "gratitude",
    text: "지금 함께 살고 있거나 자주 보는 사람의 어떤 점이 고마운가요?",
  },
  {
    id: "g-021",
    category: "gratitude",
    text: "내가 좋아하는 음악, 책, 영화 중 삶을 풍요롭게 해준 것은?",
  },
  {
    id: "g-022",
    category: "gratitude",
    text: "오늘 밥 한 끼를 먹으며 느낀 감사함은?",
  },
  {
    id: "g-023",
    category: "gratitude",
    text: "내가 현재 누리고 있는 자유 중 가장 소중한 것은?",
  },
  {
    id: "g-024",
    category: "gratitude",
    text: "최근 실패처럼 보였지만 결국 좋은 방향으로 흘러간 일은?",
  },
  {
    id: "g-025",
    category: "gratitude",
    text: "내 삶을 더 쉽게 만들어주는 습관이나 시스템은?",
  },
  {
    id: "g-026",
    category: "gratitude",
    text: "오늘 미처 알아채지 못했지만 사실 행운이었던 일은?",
  },
  {
    id: "g-027",
    category: "gratitude",
    text: "내가 자주 쓰는 물건 중 특별히 고마움을 느끼는 것은?",
  },
  {
    id: "g-028",
    category: "gratitude",
    text: "지난 한 달 동안 나에게 힘이 되어 준 말이나 글은?",
  },
  {
    id: "g-029",
    category: "gratitude",
    text: "내가 가진 관계 중 가장 감사한 우정 혹은 인연은?",
  },
  {
    id: "g-030",
    category: "gratitude",
    text: "오늘 하루를 마무리하며, 감사함으로 기억하고 싶은 장면은?",
  },

  // ── 성찰 / Reflection (30) ──────────────────────────────────────────────
  {
    id: "r-001",
    category: "reflection",
    text: "오늘 가장 도전적이었던 순간은?",
  },
  {
    id: "r-002",
    category: "reflection",
    text: "최근 배운 것 중 인상 깊은 것은?",
  },
  {
    id: "r-003",
    category: "reflection",
    text: "오늘의 에너지 레벨은 어땠나요? 왜 그랬을까요?",
  },
  { id: "r-004", category: "reflection", text: "이번 주 가장 잘 한 결정은?" },
  {
    id: "r-005",
    category: "reflection",
    text: "최근 어떤 실수에서 무엇을 배웠나요?",
  },
  {
    id: "r-006",
    category: "reflection",
    text: "지금의 나에게 한 가지 조언을 한다면?",
  },
  {
    id: "r-007",
    category: "reflection",
    text: "1년 전의 나와 지금의 나는 어떻게 달라졌나요?",
  },
  { id: "r-008", category: "reflection", text: "오늘 내가 가장 잘 한 일은?" },
  { id: "r-009", category: "reflection", text: "지금 나의 강점은 무엇인가요?" },
  {
    id: "r-010",
    category: "reflection",
    text: "지금 가장 신경 쓰이는 것은? 그 이유를 깊이 생각해보면?",
  },
  {
    id: "r-011",
    category: "reflection",
    text: "오늘 기분은 어떤가요? 그 감정의 원인을 추적해본다면?",
  },
  {
    id: "r-012",
    category: "reflection",
    text: "최근 스트레스의 진짜 원인은 무엇일까요?",
  },
  {
    id: "r-013",
    category: "reflection",
    text: "내가 자주 회피하는 생각이나 감정이 있나요?",
  },
  {
    id: "r-014",
    category: "reflection",
    text: "오늘 내 감정을 한 단어로 표현한다면? 그 단어를 고른 이유는?",
  },
  {
    id: "r-015",
    category: "reflection",
    text: "이번 달 나의 습관 중 바꾸고 싶은 것 하나는?",
  },
  {
    id: "r-016",
    category: "reflection",
    text: "내가 타인에게 어떤 사람으로 보이길 원하나요? 실제로는?",
  },
  {
    id: "r-017",
    category: "reflection",
    text: "최근 무언가에 두려움을 느낀 적이 있나요? 그 두려움의 실체는?",
  },
  {
    id: "r-018",
    category: "reflection",
    text: "지금 내 삶에서 가장 균형이 잘 맞는 영역과 부족한 영역은?",
  },
  {
    id: "r-019",
    category: "reflection",
    text: "오늘 나는 나의 가치관에 따라 행동했나요?",
  },
  {
    id: "r-020",
    category: "reflection",
    text: "최근 나를 가장 많이 성장시킨 경험은?",
  },
  {
    id: "r-021",
    category: "reflection",
    text: "내가 반복하는 생각 패턴 중 도움이 되지 않는 것은?",
  },
  {
    id: "r-022",
    category: "reflection",
    text: "지금 내가 가장 솔직하지 못한 부분은?",
  },
  {
    id: "r-023",
    category: "reflection",
    text: "오늘 후회가 남는 순간이 있다면, 다음엔 어떻게 할까요?",
  },
  {
    id: "r-024",
    category: "reflection",
    text: "내가 자신에게 너무 가혹한 부분이 있나요?",
  },
  {
    id: "r-025",
    category: "reflection",
    text: "지금의 나는 과거의 나에게 어떤 말을 해주고 싶나요?",
  },
  {
    id: "r-026",
    category: "reflection",
    text: "내가 진정으로 원하는 것과 주변의 기대 사이에서 갈등이 있나요?",
  },
  {
    id: "r-027",
    category: "reflection",
    text: "최근 어떤 결정을 미루고 있나요? 미루는 이유는 무엇인가요?",
  },
  {
    id: "r-028",
    category: "reflection",
    text: "이번 주 나에게 가장 큰 배움을 준 대화나 경험은?",
  },
  {
    id: "r-029",
    category: "reflection",
    text: "지금 내 삶의 어떤 부분이 '진짜 나'를 가장 잘 반영하나요?",
  },
  {
    id: "r-030",
    category: "reflection",
    text: "오늘 하루를 조용히 되돌아볼 때, 가장 선명하게 떠오르는 순간은?",
  },

  // ── 목표 / Goals (20) ───────────────────────────────────────────────────
  { id: "go-001", category: "goals", text: "내일 꼭 하고 싶은 한 가지는?" },
  { id: "go-002", category: "goals", text: "이번 주 목표는 무엇인가요?" },
  { id: "go-003", category: "goals", text: "이번 달 꼭 하고 싶은 것은?" },
  {
    id: "go-004",
    category: "goals",
    text: "올해 이루고 싶은 가장 중요한 한 가지는?",
  },
  {
    id: "go-005",
    category: "goals",
    text: "오늘 집중하고 싶은 일은 무엇인가요?",
  },
  {
    id: "go-006",
    category: "goals",
    text: "지금 가장 미루고 있는 일은? 오늘 딱 10분만 시작해볼 수 있나요?",
  },
  { id: "go-007", category: "goals", text: "5년 후 내가 꼭 해내고 싶은 것은?" },
  {
    id: "go-008",
    category: "goals",
    text: "앞으로 6개월 후 나는 어떤 모습이면 좋겠나요?",
  },
  {
    id: "go-009",
    category: "goals",
    text: "내 삶에서 더 많이 원하는 것은 무엇인가요?",
  },
  {
    id: "go-010",
    category: "goals",
    text: "내 삶에서 줄이고 싶은 것은 무엇인가요?",
  },
  {
    id: "go-011",
    category: "goals",
    text: "지금 배우고 싶은 새로운 기술이나 지식은?",
  },
  {
    id: "go-012",
    category: "goals",
    text: "오늘 가장 생산적인 순간은 언제였나요? 어떻게 그 상태를 만들었나요?",
  },
  {
    id: "go-013",
    category: "goals",
    text: "업무나 공부에서 개선하고 싶은 습관이 있나요?",
  },
  {
    id: "go-014",
    category: "goals",
    text: "오늘 집중을 방해한 것은 무엇인가요? 내일은 어떻게 다룰까요?",
  },
  {
    id: "go-015",
    category: "goals",
    text: "이번 프로젝트나 과제에서 가장 기대되는 부분은?",
  },
  {
    id: "go-016",
    category: "goals",
    text: "지금의 목표를 이루기 위해 가장 필요한 한 가지 변화는?",
  },
  {
    id: "go-017",
    category: "goals",
    text: "내가 두려워서 시작하지 못한 일이 있다면, 작은 첫 걸음은?",
  },
  {
    id: "go-018",
    category: "goals",
    text: "요즘 가장 충실하게 지키고 있는 루틴이나 약속은?",
  },
  {
    id: "go-019",
    category: "goals",
    text: "내가 정말 잘 하고 싶은 것 중 아직 충분히 투자하지 못한 것은?",
  },
  {
    id: "go-020",
    category: "goals",
    text: "올해 남은 기간 동안 딱 하나만 이룬다면 무엇이면 좋겠나요?",
  },

  // ── 창작 / Creative (20) ────────────────────────────────────────────────
  {
    id: "c-001",
    category: "creative",
    text: "지금 창밖에 보이는 풍경을 최대한 구체적으로 묘사해보세요.",
  },
  {
    id: "c-002",
    category: "creative",
    text: "최근 읽은 글이나 책에서 인상 깊었던 구절은? 왜 그 구절이 마음에 남았나요?",
  },
  {
    id: "c-003",
    category: "creative",
    text: "요즘 관심 있는 새로운 아이디어는? 자유롭게 펼쳐보세요.",
  },
  {
    id: "c-004",
    category: "creative",
    text: "만약 오늘 하루를 다시 산다면 무엇을 다르게 할까요?",
  },
  {
    id: "c-005",
    category: "creative",
    text: "지금 해보고 싶은 새로운 시도는?",
  },
  {
    id: "c-006",
    category: "creative",
    text: "최근 영감을 받은 것이 있나요? 어디서, 어떻게 받았나요?",
  },
  {
    id: "c-007",
    category: "creative",
    text: "내가 더 잘하고 싶은 기술이나 능력을 주제로 짧은 글을 써보세요.",
  },
  {
    id: "c-008",
    category: "creative",
    text: "요즘 즐기는 책, 팟캐스트, 영상 중 삶을 바꾸는 아이디어를 하나 소개해보세요.",
  },
  {
    id: "c-009",
    category: "creative",
    text: "오늘 만난 사람이나 사물 하나를 이야기의 주인공으로 삼아 짧게 써보세요.",
  },
  {
    id: "c-010",
    category: "creative",
    text: "내가 가장 행복했던 기억 하나를 장면 묘사처럼 써보세요.",
  },
  {
    id: "c-011",
    category: "creative",
    text: "10년 후 나에게 편지를 써보세요. 무엇을 전하고 싶나요?",
  },
  {
    id: "c-012",
    category: "creative",
    text: "오늘 하루의 색깔을 고른다면 무슨 색인가요? 그 이유는?",
  },
  {
    id: "c-013",
    category: "creative",
    text: "지금 마음속에 떠오르는 이미지, 은유, 비유를 자유롭게 써보세요.",
  },
  {
    id: "c-014",
    category: "creative",
    text: "내가 살고 싶은 이상적인 하루를 시간 순서대로 묘사해보세요.",
  },
  {
    id: "c-015",
    category: "creative",
    text: "지금 가장 흥미로운 질문은 무엇인가요? 스스로 답도 탐색해보세요.",
  },
  {
    id: "c-016",
    category: "creative",
    text: "내가 만들고 싶은 무언가(제품, 이야기, 공간, 관계)를 구체적으로 상상해보세요.",
  },
  {
    id: "c-017",
    category: "creative",
    text: "최근 평소와 다른 시각으로 바라본 것이 있나요?",
  },
  {
    id: "c-018",
    category: "creative",
    text: "내 삶을 소재로 단편 소설의 첫 문장을 써본다면?",
  },
  {
    id: "c-019",
    category: "creative",
    text: "오늘 마주친 문제를 완전히 다른 방식으로 풀어본다면?",
  },
  {
    id: "c-020",
    category: "creative",
    text: "지금 이 순간 주변의 소리, 냄새, 감촉을 글로 옮겨보세요.",
  },

  // ── 관계 / Relationships (20) ───────────────────────────────────────────
  {
    id: "rel-001",
    category: "relationships",
    text: "오늘 누군가에게 고마웠던 일은?",
  },
  {
    id: "rel-002",
    category: "relationships",
    text: "오늘 연락하고 싶은 사람이 있나요? 무슨 말을 전하고 싶나요?",
  },
  {
    id: "rel-003",
    category: "relationships",
    text: "최근 누군가에게 고마움을 표현했나요? 아직 못했다면 어떻게 할 수 있을까요?",
  },
  {
    id: "rel-004",
    category: "relationships",
    text: "나에게 긍정적인 영향을 주는 사람은 누구인가요? 그 이유는?",
  },
  {
    id: "rel-005",
    category: "relationships",
    text: "주변 사람들과의 관계에서 더 잘 하고 싶은 부분은?",
  },
  {
    id: "rel-006",
    category: "relationships",
    text: "오늘 누군가를 도울 수 있는 작은 방법은?",
  },
  {
    id: "rel-007",
    category: "relationships",
    text: "내가 더 깊어지고 싶은 관계가 있나요? 어떻게 시작할 수 있을까요?",
  },
  {
    id: "rel-008",
    category: "relationships",
    text: "최근 대화에서 내가 더 잘 들어줄 수 있었던 순간이 있었나요?",
  },
  {
    id: "rel-009",
    category: "relationships",
    text: "나의 삶에서 가장 오래된 소중한 관계는? 요즘 어떻게 지내고 있나요?",
  },
  {
    id: "rel-010",
    category: "relationships",
    text: "다음에 만나고 싶은 사람과 무엇을 함께 하고 싶나요?",
  },
  {
    id: "rel-011",
    category: "relationships",
    text: "내가 누군가에게 상처를 준 적이 있다면, 어떻게 회복할 수 있을까요?",
  },
  {
    id: "rel-012",
    category: "relationships",
    text: "관계에서 내가 자주 반복하는 패턴이 있나요? 도움이 되나요, 아닌가요?",
  },
  {
    id: "rel-013",
    category: "relationships",
    text: "나를 있는 그대로 받아들여 주는 사람은 누구인가요?",
  },
  {
    id: "rel-014",
    category: "relationships",
    text: "새로운 사람을 만날 때 내가 가장 먼저 알고 싶은 것은?",
  },
  {
    id: "rel-015",
    category: "relationships",
    text: "내가 갈등을 다루는 방식은 어떤가요? 더 나은 방식이 있을까요?",
  },
  {
    id: "rel-016",
    category: "relationships",
    text: "요즘 소홀히 하고 있는 관계가 있나요? 다시 가까워지려면?",
  },
  {
    id: "rel-017",
    category: "relationships",
    text: "내 삶에서 가장 큰 지지가 되어준 사람에게 전하고 싶은 말은?",
  },
  {
    id: "rel-018",
    category: "relationships",
    text: "좋은 친구나 동료가 되기 위해 내가 더 키우고 싶은 자질은?",
  },
  {
    id: "rel-019",
    category: "relationships",
    text: "나는 어떤 사람과 함께할 때 가장 나다운 모습이 되나요?",
  },
  {
    id: "rel-020",
    category: "relationships",
    text: "오늘 주변 누군가에게 진심을 담아 건넬 수 있는 한 마디는?",
  },
];

// ── Backward-compat flat string array ──────────────────────────────────────
// Existing callers that reference DAILY_PROMPTS as string[] (tests, etc.)
// are covered by getDailyPrompt / getRandomPrompt which return strings.

/**
 * Get a deterministic daily prompt text for a given date.
 * Same date always returns same prompt, even across sessions.
 * Backward-compatible: returns a plain string.
 */
export function getDailyPrompt(date: Date): string {
  const start = new Date(date.getFullYear(), 0, 0);
  const diff = date.getTime() - start.getTime();
  const oneDay = 1000 * 60 * 60 * 24;
  const dayOfYear = Math.floor(diff / oneDay);
  const index = dayOfYear % DAILY_PROMPTS.length;
  return DAILY_PROMPTS[index].text;
}

/**
 * Get a truly random prompt text (for refresh button).
 * Backward-compatible: returns a plain string.
 */
export function getRandomPrompt(): string {
  const index = Math.floor(Math.random() * DAILY_PROMPTS.length);
  return DAILY_PROMPTS[index].text;
}

// ── History-aware selection ─────────────────────────────────────────────────

/** Number of recently-used prompt IDs to remember when avoiding repeats. */
export const HISTORY_SIZE = 30;

/**
 * Pick a prompt not in `usedIds`. When all prompts have been used, resets
 * and falls back to the deterministic daily prompt for `date`.
 */
export function getPromptAvoidingHistory(
  date: Date,
  usedIds: string[],
): DailyPrompt {
  const unused = DAILY_PROMPTS.filter((p) => !usedIds.includes(p.id));
  if (unused.length === 0) {
    // Full cycle — fall back to deterministic daily selection (reset)
    const start = new Date(date.getFullYear(), 0, 0);
    const diff = date.getTime() - start.getTime();
    const oneDay = 1000 * 60 * 60 * 24;
    const dayOfYear = Math.floor(diff / oneDay);
    return DAILY_PROMPTS[dayOfYear % DAILY_PROMPTS.length];
  }
  // Deterministic pick from unused pool based on date so same date is stable
  const start = new Date(date.getFullYear(), 0, 0);
  const diff = date.getTime() - start.getTime();
  const oneDay = 1000 * 60 * 60 * 24;
  const dayOfYear = Math.floor(diff / oneDay);
  return unused[dayOfYear % unused.length];
}

/**
 * Return a DailyPrompt avoiding recently-used IDs.
 * @param date       Used as the deterministic seed when the pool resets.
 * @param history    Array of recently-used prompt IDs (most-recent last).
 * @param category   Optional category filter.
 */
export function getDailyPromptWithHistory(
  date: Date,
  history: string[],
  category?: DailyPrompt["category"],
): DailyPrompt {
  const available = category
    ? DAILY_PROMPTS.filter((p) => p.category === category)
    : DAILY_PROMPTS;

  const unused = available.filter((p) => !history.includes(p.id));
  const pool = unused.length > 0 ? unused : available; // reset when all used

  const start = new Date(date.getFullYear(), 0, 0);
  const diff = date.getTime() - start.getTime();
  const oneDay = 1000 * 60 * 60 * 24;
  const dayOfYear = Math.floor(diff / oneDay);

  return pool[dayOfYear % pool.length];
}

// ── Custom prompts folder ───────────────────────────────────────────────────

/**
 * Load custom prompts from `<journalDir>/prompts/*.md`.
 * Each markdown file's bullet lines (`- text`) become prompts.
 * The filename (without .md) is used as the category string.
 * Returns an empty array if the folder does not exist or is empty.
 */
export async function loadCustomPrompts(
  journalDir: string,
): Promise<DailyPrompt[]> {
  try {
    const promptsDir = `${journalDir}/prompts`;
    const entries = await listDir(promptsDir);
    const prompts: DailyPrompt[] = [];

    for (const entry of entries) {
      if (!entry.name || !entry.name.endsWith(".md")) continue;
      const category = entry.name.replace(".md", "");
      const content = await readFile(`${promptsDir}/${entry.name}`);
      const lines = content.split("\n");
      for (const line of lines) {
        const m = line.match(/^-\s+(.+)/);
        if (m) {
          prompts.push({
            id: `custom-${category}-${prompts.length}`,
            category: category as DailyPrompt["category"],
            text: m[1].trim(),
          });
        }
      }
    }

    return prompts;
  } catch {
    // prompts/ folder doesn't exist yet — that's fine
    return [];
  }
}
