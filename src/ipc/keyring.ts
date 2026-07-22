// §6.3 / §259 Keyring IPC commands — OS Keychain storage for provider API keys.
//
// §259: constrained to a fixed provider set (no arbitrary key names), and no
// command returns a stored secret. The UI only learns whether a provider is
// configured; the raw key is read back only inside the Rust backend for LLM /
// embedding calls, so it never crosses the IPC boundary.
import { invoke } from "@tauri-apps/api/core";

/** Providers whose API keys live in the OS keyring. Ollama is keyless. */
export type KeyringProvider = "claude" | "gemini" | "openai";

/** Delete a provider's API key. Missing entry is a no-op. */
export async function keyringDeleteProviderKey(
  provider: KeyringProvider,
): Promise<void> {
  return invoke<void>("keyring_delete_provider_key", { provider });
}

/** Whether a provider has a non-empty API key configured (boolean only). */
export async function keyringProviderConfigured(
  provider: KeyringProvider,
): Promise<boolean> {
  return invoke<boolean>("keyring_provider_configured", { provider });
}

/** Store (or overwrite) a provider's API key in the OS keyring. */
export async function keyringSetProviderKey(
  provider: KeyringProvider,
  value: string,
): Promise<void> {
  return invoke<void>("keyring_set_provider_key", { provider, value });
}
