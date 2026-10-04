// §387 `baram <command>` — the argument grammar.

use clap::{Parser, Subcommand, ValueEnum};

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
    /// List the markdown files in the vault.
    Files {
        /// Only this folder (relative to the vault root).
        #[arg(long)]
        folder: Option<String>,
    },
    /// Search the text of the vault's `.md` files.
    Search {
        query: String,
        /// Treat QUERY as a regular expression.
        #[arg(long)]
        regex: bool,
        /// Match case exactly.
        #[arg(long)]
        case_sensitive: bool,
        /// Match whole words only.
        #[arg(long)]
        word: bool,
        /// Only this folder (relative to the vault root).
        #[arg(long)]
        folder: Option<String>,
        /// Stop after this many matches.
        #[arg(long, default_value_t = 100, value_parser = clap::value_parser!(u32).range(1..))]
        limit: u32,
    },
    /// List the vault's tags with how often each occurs.
    Tags,
    /// List the files that carry a tag.
    Tag { name: String },
    /// List tasks.
    Tasks {
        /// Which tasks: open (todo and doing), done, cancelled, or all.
        #[arg(long, value_enum, default_value_t = TaskStatus::Open)]
        status: TaskStatus,
        /// Only this file (relative to the vault root).
        #[arg(long)]
        file: Option<String>,
    },
    /// List the links that point at a note.
    Backlinks { path: String },
    /// List the links a note holds and where each one leads.
    Links { path: String },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, ValueEnum)]
pub(crate) enum TaskStatus {
    Open,
    Done,
    Cancelled,
    All,
}
