// §387 `baram <command>` — the argument grammar.

use clap::{Parser, Subcommand};

#[derive(Debug, Parser)]
#[command(
    name = "baram",
    version,
    about = "Read a Baram vault from the terminal. Nothing here writes to the vault."
)]
pub(crate) struct Cli {
    /// The vault to read: a registered name, or a path (has a separator, or starts with
    /// `.` or `~`). Default: the registered vault that contains the current directory.
    #[arg(long, global = true, value_name = "NAME|PATH")]
    pub vault: Option<String>,

    /// Print one JSON object instead of tab-separated text.
    #[arg(long, global = true)]
    pub json: bool,

    #[command(subcommand)]
    pub command: Command,
}

#[derive(Debug, Subcommand)]
pub(crate) enum Command {
    /// List the vaults and folders registered in the app.
    Vaults,
    /// Print a file. PATH is relative to the vault root.
    Read { path: String },
}
