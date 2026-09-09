import type { KeyringProvider } from "../../ipc/keyring";

// §6.3 AI provider catalogue — the one place the provider list is written down.
//
// Before this table the list existed five times over: a union type, a label
// map, an if-chain deciding which providers appear in the task selectors, a
// `<option>` list, and a switch picking each provider's default model. None of
// those five was checked against the others, so a new provider could be
// configured and still be missing from a selector with nothing failing.
//
// `AIProvider` is now derived from these keys, which makes every
// `Record<AIProvider, …>` consumer a compile-time guard: adding an entry here
// breaks the surfaces that have not handled it yet.

/** What each surface needs to know about a provider. */
interface AIProviderMeta {
  /** Model preselected when the user switches to this provider. */
  readonly defaultModel: string;
  /**
   * Local providers need no API key, and are the only ones privacy mode
   * allows. The Rust `Provider` keyring enum holds exactly the keyed ones.
   */
  readonly keyless: boolean;
  /** Product name, shown where a translated string would be wrong. */
  readonly label: string;
  /** i18n key for the settings select. */
  readonly labelKey: string;
}

/**
 * Every provider Baram can talk to. Key insertion order is the display order
 * in Settings → AI, so this list is deliberately not alphabetical — the
 * OpenAI-compatible pair sits together and the local provider comes last.
 */
export const AI_PROVIDERS = {
  claude: {
    defaultModel: "claude-sonnet-4-5-20250929",
    keyless: false,
    label: "Claude",
    labelKey: "settings.ai.provider.claude",
  },
  openai: {
    defaultModel: "gpt-4o",
    keyless: false,
    label: "OpenAI",
    labelKey: "settings.ai.provider.openai",
  },
  openrouter: {
    // The auto router is the one model id that cannot go stale: OpenRouter
    // picks the upstream model, so a hardcoded default here never names a
    // model that has since been retired.
    defaultModel: "openrouter/auto",
    keyless: false,
    label: "OpenRouter",
    labelKey: "settings.ai.provider.openrouter",
  },
  gemini: {
    defaultModel: "gemini-2.0-flash",
    keyless: false,
    label: "Gemini",
    labelKey: "settings.ai.provider.gemini",
  },
  ollama: {
    defaultModel: "llama3",
    keyless: true,
    label: "Ollama",
    labelKey: "settings.ai.provider.ollama",
  },
} as const satisfies Record<string, AIProviderMeta>;

/** The provider identifiers, derived so no surface can enumerate a stale set. */
export type AIProvider = keyof typeof AI_PROVIDERS;

/** All providers, in display order. */
export const AI_PROVIDER_IDS = Object.keys(AI_PROVIDERS) as AIProvider[];

/**
 * Providers whose API key lives in the OS keyring (§259). Derived from
 * `keyless`, so a new keyed provider is queried at startup without anyone
 * remembering to add it here.
 *
 * The narrowing predicate asserts that every keyed provider is also a member
 * of the IPC `KeyringProvider` union — `providers.test.ts` proves that both
 * ways at the type level, since a false assertion here would send a provider
 * name the Rust enum rejects.
 */
export const KEYRING_PROVIDERS: readonly KeyringProvider[] =
  AI_PROVIDER_IDS.filter(
    (id): id is KeyringProvider => !AI_PROVIDERS[id].keyless,
  );
