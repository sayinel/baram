//! A `plugins.baram-logging` key in `tauri.conf.json` must not stop the app starting.
//!
//! `TauriPlugin::initialize` deserializes `plugins[<plugin name>]` into the plugin's
//! config type and returns `Err` if that fails — **before** the setup hook runs, so the
//! "our setup always returns `Ok`" guarantee does not help. With the default config type
//! `()`, `deserialize_unit` rejects everything but `null`, so adding as little as
//! `"baram-logging": {}` to the config would propagate `Error::PluginInitialization` out
//! of `Builder::build()` and panic in `run()`.
//!
//! That is exactly the failure class the logger's whole shape exists to eliminate — a
//! logging problem costing the user their editor — arriving through the config file
//! instead of the filesystem. `logging::plugin()` therefore declares
//! `serde_json::Value`, which accepts anything.
//!
//! Its own binary because it needs a mutated `Context`, and because the mutation-test
//! that proves this file earns its place (reverting the config type to `()`) must fail
//! here and nowhere else.

use std::collections::HashMap;

#[test]
fn a_config_key_for_the_logging_plugin_does_not_abort_startup() {
    let mut context = tauri::test::mock_context(tauri::test::noop_assets());

    // The shape a user or a future feature would actually write. `{}` is the minimal
    // non-null value and is already enough to break a `()`-typed plugin.
    let mut plugins = HashMap::new();
    plugins.insert(
        "baram-logging".to_string(),
        serde_json::json!({ "level": "debug" }),
    );
    context.config_mut().plugins = tauri::utils::config::PluginConfig(plugins);

    let built = tauri::test::mock_builder()
        .plugin(baram_lib::logging::plugin())
        .build(context);

    assert!(
        built.is_ok(),
        "a plugins.baram-logging config key must not stop the app from building: {:?}",
        built.err().map(|e| e.to_string())
    );
}
