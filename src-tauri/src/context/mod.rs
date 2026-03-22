// §80 Context module — vault/folder/file context management

pub mod manager;
pub mod types;
pub mod vault_config;

pub use manager::ContextManager;
pub use types::*;
// VaultConfig is re-exported for use by context_cmd and future consumers
#[allow(unused_imports)]
pub use vault_config::VaultConfig;
