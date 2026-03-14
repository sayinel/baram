// §11.3.1 Writing Mode System Prompts — common preamble + mode-specific appendix

import type { WritingMode } from "./writing-mode-detector";

const COMMON_PREAMBLE = `Continue the user's text naturally. Output ONLY the continuation — no explanations, no meta-commentary. Match the user's tone, vocabulary, and formatting style.`;

const MODE_APPENDIX: Record<WritingMode, string> = {
  academic: `Use formal academic tone. Prefer precise language, hedging phrases ("may suggest", "it appears"), and citation-ready prose. Maintain LaTeX math notation when appropriate.`,
  creative: `Prioritize voice, rhythm, and imagery. Vary sentence length. Use vivid language and sensory details. Do not flatten the prose into generic statements.`,
  general: `Adapt to the document's existing style. Keep suggestions neutral and versatile.`,
  journal: `Write in a reflective, personal tone. Use first-person perspective. Keep entries conversational and introspective.`,
  notes: `Continue with concise bullet points or short phrases. Prefer brevity. Use wikilink syntax [[like this]] when referencing other notes.`,
  skills: `Continue with valid prompt/skill file syntax. Preserve XML tag structure, variable placeholders, and instruction formatting. Respect <system>, <user>, and template variable conventions.`,
  technical: `Use precise technical terminology. Prefer concrete examples and code references. Maintain consistent heading hierarchy and structured formatting.`,
};

export function getSystemPromptForMode(mode: WritingMode): string {
  return `${COMMON_PREAMBLE}\n\n${MODE_APPENDIX[mode]}`;
}
