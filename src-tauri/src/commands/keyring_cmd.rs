// §6.3 / §259 Keyring IPC commands — OS Keychain storage for provider API keys.
//
// §259 hardening: these commands are constrained to a fixed `Provider` enum (no
// arbitrary key names), and NONE of them return a stored secret to the
// frontend. The UI only ever learns *whether* a provider is configured. The raw
// key is read back only inside the backend (`get_provider_api_key`) for LLM /
// embedding calls, so the secret never crosses the IPC boundary.

use keyring::Entry;
use serde::Deserialize;

const SERVICE: &str = "com.inel.baram";

/// Providers whose API keys live in the OS keyring. Ollama is keyless and is
/// intentionally absent — it never has a secret to store.
#[derive(Clone, Copy, Debug, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Provider {
    Claude,
    Gemini,
    Openai,
}

impl Provider {
    fn key_name(self) -> &'static str {
        match self {
            Provider::Claude => "baram-claude-api-key",
            Provider::Gemini => "baram-gemini-api-key",
            Provider::Openai => "baram-openai-api-key",
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

    #[test]
    fn provider_deserializes_from_lowercase_and_maps_key_name() {
        let claude: Provider = serde_json::from_str("\"claude\"").unwrap();
        let gemini: Provider = serde_json::from_str("\"gemini\"").unwrap();
        let openai: Provider = serde_json::from_str("\"openai\"").unwrap();
        assert_eq!(claude.key_name(), "baram-claude-api-key");
        assert_eq!(gemini.key_name(), "baram-gemini-api-key");
        assert_eq!(openai.key_name(), "baram-openai-api-key");
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
