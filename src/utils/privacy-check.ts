// §49 Privacy Mode — restrict LLM to local-only providers
export function isLLMAllowed(privacyMode: boolean, provider: string): boolean {
  if (!privacyMode) return true;
  // Only local providers are allowed in privacy mode
  return provider === "ollama";
}
