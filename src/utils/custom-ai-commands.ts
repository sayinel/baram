// §48 Custom AI Commands — CRUD operations + template variable substitution

export interface CustomAICommandContext {
  selection?: string;
  document?: string;
  clipboard?: string;
}

/**
 * Substitute template variables in a prompt string.
 * Supported variables: {{selection}}, {{document}}, {{input}}, {{clipboard}}
 * Note: {{input}} is handled separately via resolveInputVariable — it is NOT substituted here.
 */
export function substituteVariables(
  template: string,
  context: CustomAICommandContext,
): string {
  let result = template;
  result = result.replace(/\{\{selection\}\}/g, context.selection ?? "");
  result = result.replace(/\{\{document\}\}/g, context.document ?? "");
  result = result.replace(/\{\{clipboard\}\}/g, context.clipboard ?? "");
  return result;
}

/**
 * Detect whether the template contains {{input}} and extract a prompt hint.
 * The prompt is derived from surrounding text context.
 * Returns { hasInput: true, prompt } if {{input}} is present.
 */
export function resolveInputVariable(template: string): {
  hasInput: boolean;
  prompt: string;
} {
  const inputPattern = /\{\{input\}\}/;
  if (!inputPattern.test(template)) {
    return { hasInput: false, prompt: "" };
  }

  // Try to extract a meaningful prompt from the line containing {{input}}
  const lines = template.split("\n");
  for (const line of lines) {
    if (inputPattern.test(line)) {
      // Use text before {{input}} as prompt hint, or a default
      const before = line.replace(inputPattern, "").trim();
      if (before) {
        return { hasInput: true, prompt: before };
      }
      break;
    }
  }

  return { hasInput: true, prompt: "Enter input:" };
}

/**
 * Replace {{input}} in a template with the user-provided value.
 */
export function substituteInput(template: string, input: string): string {
  return template.replace(/\{\{input\}\}/g, input);
}

/**
 * Generate a unique ID for a custom AI command.
 */
export function generateCommandId(): string {
  return `custom_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}
