// §6.3 Keyring IPC commands — OS Keychain storage for API keys

use keyring::Entry;

const SERVICE: &str = "com.inel.baram";

#[tauri::command]
pub fn keyring_store(key: String, value: String) -> Result<(), String> {
    let entry = Entry::new(SERVICE, &key).map_err(|e| e.to_string())?;
    entry.set_password(&value).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn keyring_get(key: String) -> Result<Option<String>, String> {
    let entry = Entry::new(SERVICE, &key).map_err(|e| e.to_string())?;
    match entry.get_password() {
        Ok(password) => Ok(Some(password)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}

#[tauri::command]
pub fn keyring_delete(key: String) -> Result<(), String> {
    let entry = Entry::new(SERVICE, &key).map_err(|e| e.to_string())?;
    match entry.delete_credential() {
        Ok(()) => Ok(()),
        Err(keyring::Error::NoEntry) => Ok(()), // Already deleted
        Err(e) => Err(e.to_string()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    #[ignore] // CI에서 OS keyring 접근 불가
    fn test_store_and_get_roundtrip() {
        let key = "test-baram-roundtrip".to_string();
        let value = "sk-test-12345".to_string();

        keyring_store(key.clone(), value.clone()).unwrap();
        let result = keyring_get(key.clone()).unwrap();
        assert_eq!(result, Some(value));

        // Cleanup
        keyring_delete(key).unwrap();
    }

    #[test]
    #[ignore]
    fn test_delete_then_get_returns_none() {
        let key = "test-baram-delete".to_string();
        keyring_store(key.clone(), "temp".to_string()).unwrap();
        keyring_delete(key.clone()).unwrap();
        let result = keyring_get(key).unwrap();
        assert_eq!(result, None);
    }

    #[test]
    #[ignore]
    fn test_get_nonexistent_returns_none() {
        let key = "test-baram-nonexistent-key-xyz".to_string();
        let result = keyring_get(key).unwrap();
        assert_eq!(result, None);
    }
}
