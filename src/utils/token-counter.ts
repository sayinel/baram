// §72 Token counter — approximate token estimation for LLM preview
// Uses character-based heuristic: ~4 chars/token for English, ~1.5 chars/token for CJK

const CJK_RANGE = /[\u3000-\u9fff\uac00-\ud7af\uff00-\uffef]/g;

export function estimateTokenCount(text: string): number {
  if (!text) return 0;

  const cjkChars = (text.match(CJK_RANGE) || []).length;
  const nonCjkLength = text.length - cjkChars;

  // English/ASCII: ~4 chars per token, CJK: ~1.5 chars per token
  const englishTokens = Math.ceil(nonCjkLength / 4);
  const cjkTokens = Math.ceil(cjkChars / 1.5);

  return englishTokens + cjkTokens;
}

export function formatTokenCount(count: number): string {
  if (count < 1000) return `${count}`;
  return `${(count / 1000).toFixed(1)}k`;
}
