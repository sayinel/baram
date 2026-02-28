// §56i Daily Writing Prompt — compact display with refresh
import { useState } from "react";
import { DAILY_PROMPTS, getDailyPrompt, getRandomPrompt } from "../../utils/journal-prompts";

interface Props {
  date?: Date;
}

export function DailyPrompt({ date }: Props) {
  const basePrompt = getDailyPrompt(date ?? new Date());
  const [prompt, setPrompt] = useState(basePrompt);

  const handleRefresh = () => {
    let next = getRandomPrompt();
    // Avoid showing the same prompt twice in a row
    if (next === prompt) {
      const idx = DAILY_PROMPTS.indexOf(prompt);
      next = DAILY_PROMPTS[(idx + 1) % DAILY_PROMPTS.length];
    }
    setPrompt(next);
  };

  return (
    <div className="daily-prompt">
      <span className="daily-prompt-icon">💡</span>
      <span className="daily-prompt-text">{prompt}</span>
      <button
        className="daily-prompt-refresh"
        onClick={handleRefresh}
        title="다른 글감 보기"
        type="button"
      >
        🔄
      </button>
    </div>
  );
}
