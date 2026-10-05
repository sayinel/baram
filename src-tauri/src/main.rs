// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    // §387 One binary, two modes. `cli::mode_for` holds the rule and why it is written
    // from the GUI's side; in CLI mode tauri is never started.
    let args: Vec<std::ffi::OsString> = std::env::args_os().collect();
    if baram_lib::cli::mode_for(&args) == baram_lib::cli::Mode::Cli {
        std::process::exit(baram_lib::cli::run(args));
    }
    baram_lib::run()
}
