// §80 Context module — vault/folder/file context management

pub mod manager;
pub mod types;
pub mod vault_config;

pub use manager::ContextManager;
pub use types::*;
pub use vault_config::VaultConfig;
