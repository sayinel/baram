// §3.2 설정 관리 모듈 — app_data_dir/config.json 파일 기반 영속화

use serde_json::Value;
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::Manager;
use thiserror::Error;

#[derive(Error, Debug)]
pub enum ConfigError {
    #[error("설정 파일 읽기 실패: {0}")]
    ReadError(#[from] std::io::Error),
    #[error("설정 파싱 실패: {0}")]
    ParseError(#[from] serde_json::Error),
    #[error("앱 데이터 디렉토리를 찾을 수 없습니다")]
    NoAppDataDir,
    #[error("잠금 획득 실패")]
    LockError,
}

/// Global mutex to protect concurrent read-modify-write on config.json
static CONFIG_MUTEX: Mutex<()> = Mutex::new(());

/// Resolve config.json path: {app_data_dir}/config.json
fn config_path(app_handle: &tauri::AppHandle) -> Result<PathBuf, ConfigError> {
    let dir = app_handle
        .path()
        .app_data_dir()
        .map_err(|_| ConfigError::NoAppDataDir)?;
    Ok(dir.join("config.json"))
}

/// Read entire config file as HashMap. Returns empty map if file doesn't exist.
fn read_config_map(path: &PathBuf) -> Result<HashMap<String, Value>, ConfigError> {
    match std::fs::read_to_string(path) {
        Ok(content) => {
            let map: HashMap<String, Value> = serde_json::from_str(&content)?;
            Ok(map)
        }
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(HashMap::new()),
        Err(e) => Err(ConfigError::ReadError(e)),
    }
}

/// Write config map to file atomically (write to .tmp, then rename).
fn write_config_map(path: &PathBuf, map: &HashMap<String, Value>) -> Result<(), ConfigError> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let tmp_path = path.with_extension("json.tmp");
    let content = serde_json::to_string_pretty(map)?;
    std::fs::write(&tmp_path, content)?;
    std::fs::rename(&tmp_path, path)?;
    Ok(())
}

/// Get a config value by key. Returns None if key doesn't exist.
pub fn get_config(app_handle: &tauri::AppHandle, key: &str) -> Result<Option<String>, ConfigError> {
    let _guard = CONFIG_MUTEX.lock().map_err(|_| ConfigError::LockError)?;
    let path = config_path(app_handle)?;
    let map = read_config_map(&path)?;
    match map.get(key) {
        Some(Value::String(s)) => Ok(Some(s.clone())),
        Some(v) => Ok(Some(v.to_string())),
        None => Ok(None),
    }
}

/// Set a config value (read-modify-write under mutex).
pub fn set_config(app_handle: &tauri::AppHandle, key: &str, value: &str) -> Result<(), ConfigError> {
    let _guard = CONFIG_MUTEX.lock().map_err(|_| ConfigError::LockError)?;
    let path = config_path(app_handle)?;
    let mut map = read_config_map(&path)?;
    map.insert(key.to_string(), Value::String(value.to_string()));
    write_config_map(&path, &map)?;
    Ok(())
}

/// Remove a config key (read-modify-write under mutex).
pub fn remove_config(app_handle: &tauri::AppHandle, key: &str) -> Result<(), ConfigError> {
    let _guard = CONFIG_MUTEX.lock().map_err(|_| ConfigError::LockError)?;
    let path = config_path(app_handle)?;
    let mut map = read_config_map(&path)?;
    map.remove(key);
    write_config_map(&path, &map)?;
    Ok(())
}
