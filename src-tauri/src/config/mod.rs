// §3.2 설정 관리 모듈

use serde_json::Value;
use thiserror::Error;

#[derive(Error, Debug)]
pub enum ConfigError {
    #[error("설정 파일 읽기 실패: {0}")]
    ReadError(#[from] std::io::Error),
    #[error("설정 파싱 실패: {0}")]
    ParseError(#[from] serde_json::Error),
}

/// 설정값 조회
pub async fn get_config(key: Option<&str>) -> Result<Value, ConfigError> {
    // M2에서 파일 기반 설정으로 구현 예정
    // 현재는 기본값 반환
    match key {
        Some(k) => Ok(Value::String(format!("config:{}", k))),
        None => Ok(Value::Object(serde_json::Map::new())),
    }
}

/// 설정값 저장
pub async fn set_config(_key: &str, _value: Value) -> Result<(), ConfigError> {
    // M2에서 파일 기반 설정으로 구현 예정
    Ok(())
}
