// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    let args: Vec<std::ffi::OsString> = std::env::args_os().collect();
    // §397 The app runs each tile pyramid build in a short-lived child of this binary
    // (`tile_child`). Checked before `cli::mode_for`, which would send the child's flag
    // to the CLI as an unknown argument.
    if let Some(code) = baram_lib::tile_child::run_if_requested(&args) {
        std::process::exit(code);
    }
    // §387 GUI or CLI. `cli::mode_for` holds the rule and why it is written from the
    // GUI's side; in CLI mode tauri is never started.
    if baram_lib::cli::mode_for(&args) == baram_lib::cli::Mode::Cli {
        std::process::exit(baram_lib::cli::run(args));
    }
    baram_lib::run()
}
