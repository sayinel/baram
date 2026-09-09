// §6.3 / §259 Keyring IPC commands — OS Keychain storage for provider API keys.
//
// §259 hardening: these commands are constrained to a fixed `Provider` enum (no
// arbitrary key names), and NONE of them return a stored secret to the
// frontend. The UI only ever learns *whether* a provider is configured. The raw
// key is read back only inside the backend (`get_provider_api_key`) for LLM /
// embedding calls, so the secret never crosses the IPC boundary.

use keyring::Entry;
use serde::{Deserialize, Serialize};

const SERVICE: &str = "com.inel.baram";

/// Providers whose API keys live in the OS keyring. Ollama is keyless and is
/// intentionally absent — it never has a secret to store.
#[derive(Clone, Copy, Debug, Deserialize, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Provider {
    Claude,
    Gemini,
    Openai,
    Openrouter,
}

impl Provider {
    /// Every variant, for the tests that check this enum against the string
    /// path `get_provider_api_key` builds. `variant_count` below makes a stale
    /// list fail rather than quietly skip a provider.
    #[cfg(test)]
    const ALL: &'static [Provider] = &[
        Provider::Claude,
        Provider::Gemini,
        Provider::Openai,
        Provider::Openrouter,
    ];

    fn key_name(self) -> &'static str {
        match self {
            Provider::Claude => "baram-claude-api-key",
            Provider::Gemini => "baram-gemini-api-key",
            Provider::Openai => "baram-openai-api-key",
            Provider::Openrouter => "baram-openrouter-api-key",
        }
    }
}

/// Store (or overwrite) a provider's API key in the OS keyring.
#[tauri::command]
pub fn keyring_set_provider_key(provider: Provider, value: String) -> Result<(), String> {
    let entry = Entry::new(SERVICE, provider.key_name()).map_err(|e| e.to_string())?;
    entry.set_password(&value).map_err(|e| e.to_string())
}

/// Delete a provider's API key. A missing entry is treated as success.
#[tauri::command]
pub fn keyring_delete_provider_key(provider: Provider) -> Result<(), String> {
    let entry = Entry::new(SERVICE, provider.key_name()).map_err(|e| e.to_string())?;
    match entry.delete_credential() {
        Ok(()) => Ok(()),
        Err(keyring::Error::NoEntry) => Ok(()), // Already absent
        Err(e) => Err(e.to_string()),
    }
}

/// Report whether a provider has a non-empty API key configured. Returns only a
/// boolean — the secret itself never leaves the backend.
#[tauri::command]
pub fn keyring_provider_configured(provider: Provider) -> Result<bool, String> {
    let entry = Entry::new(SERVICE, provider.key_name()).map_err(|e| e.to_string())?;
    match entry.get_password() {
        Ok(pw) => Ok(!pw.trim().is_empty()),
        Err(keyring::Error::NoEntry) => Ok(false),
        Err(e) => Err(e.to_string()),
    }
}

/// Read a provider's API key from the OS keyring for backend LLM/embedding
/// calls, so the key never has to cross the IPC boundary. Ollama is keyless
/// (returns empty). NOT a `#[tauri::command]` — backend-internal only.
///
/// The key name MUST match the frontend `Provider` mapping above:
/// `baram-{provider}-api-key`, stored under the same `SERVICE`.
pub fn get_provider_api_key(provider: &str) -> Result<String, String> {
    if provider == "ollama" {
        return Ok(String::new());
    }
    let key_name = format!("baram-{provider}-api-key");
    let entry = Entry::new(SERVICE, &key_name).map_err(|e| e.to_string())?;
    match entry.get_password() {
        Ok(pw) => Ok(pw),
        Err(keyring::Error::NoEntry) => Err(format!(
            "No API key configured for '{provider}'. Add it in Settings → AI."
        )),
        Err(e) => Err(e.to_string()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The number of `Provider` variants. The exhaustive match forces this
    /// function to be edited when a variant is added, which is the moment to
    /// bump the count — and a stale `Provider::ALL` then fails the test below.
    fn variant_count() -> usize {
        fn _exhaustive(p: Provider) {
            match p {
                Provider::Claude | Provider::Gemini | Provider::Openai | Provider::Openrouter => (),
            }
        }
        4
    }

    #[test]
    fn all_lists_every_provider_variant() {
        assert_eq!(Provider::ALL.len(), variant_count());
    }

    #[test]
    fn key_name_matches_the_string_path_used_by_the_backend() {
        // `get_provider_api_key` takes a provider NAME and rebuilds the entry
        // as `baram-{provider}-api-key`. The doc comment there says the two
        // MUST agree; this derives that agreement instead of restating it, so
        // a variant whose key_name is typed by hand cannot drift.
        for provider in Provider::ALL {
            let name = serde_json::to_value(provider).unwrap();
            let name = name.as_str().unwrap();
            assert_eq!(
                provider.key_name(),
                format!("baram-{name}-api-key"),
                "key_name for {name} does not match the backend string path"
            );
        }
    }

    #[test]
    fn provider_deserializes_from_lowercase_and_maps_key_name() {
        for provider in Provider::ALL {
            let name = serde_json::to_value(provider).unwrap();
            let lowercase = format!("\"{}\"", name.as_str().unwrap());
            let parsed: Provider = serde_json::from_str(&lowercase).unwrap();
            assert_eq!(parsed.key_name(), provider.key_name());
        }
    }

    #[test]
    fn provider_rejects_arbitrary_key_names() {
        // §259 — the enum is the whole point: an attacker can no longer name an
        // arbitrary keyring entry (e.g. another app's credential) over IPC.
        assert!(serde_json::from_str::<Provider>("\"ollama\"").is_err());
        assert!(serde_json::from_str::<Provider>("\"../../other-app\"").is_err());
        assert!(serde_json::from_str::<Provider>("\"AWS_SECRET\"").is_err());
    }

    // §backlog #1 — Ollama is keyless; this branch needs no OS keyring.
    #[test]
    fn get_provider_api_key_ollama_is_empty() {
        assert_eq!(get_provider_api_key("ollama").unwrap(), "");
    }

    #[test]
    #[ignore] // CI에서 OS keyring 접근 불가
    fn set_configured_delete_roundtrip() {
        keyring_set_provider_key(Provider::Claude, "sk-test-12345".to_string()).unwrap();
        assert!(keyring_provider_configured(Provider::Claude).unwrap());
        keyring_delete_provider_key(Provider::Claude).unwrap();
        assert!(!keyring_provider_configured(Provider::Claude).unwrap());
    }

    #[test]
    #[ignore]
    fn configured_is_false_for_empty_value() {
        keyring_set_provider_key(Provider::Gemini, "   ".to_string()).unwrap();
        assert!(!keyring_provider_configured(Provider::Gemini).unwrap());
        keyring_delete_provider_key(Provider::Gemini).unwrap();
    }
}
