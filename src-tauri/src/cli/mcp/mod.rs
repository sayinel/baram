// §389 `baram mcp` — the CLI's read-only commands as the tools of a stdio MCP server, for a
// client the user configured (Claude Code, Claude Desktop). Spec:
// dev/design/specs/0068-mcp-server-design.md.

mod args;
mod scope;
mod server;
mod tools;

use super::app_config;
use super::error::{CliError, ErrorCode};
use super::output;
use rmcp::service::{QuitReason, ServerInitializeError};
use rmcp::ServiceExt;
use server::Server;
use std::path::PathBuf;

/// Runs the server until stdin ends and returns the exit code (spec 0068 §3.1): 0 when the
/// client ended the session — before the handshake too; 1 when the session did not start
/// or ended on an error; the CLI's code when a `--vault` does not resolve, in which case
/// nothing has been written to stdout.
pub(super) fn run(runtime: tokio::runtime::Runtime, vaults: &[String]) -> i32 {
    let home = dirs::home_dir();
    let config = app_config::load_default();
    {
        let mut stderr = std::io::stderr().lock();
        for warning in &config.warnings {
            let _ = output::write_warning(&mut stderr, warning, false);
        }
    }
    let allowed = match scope::start(
        vaults,
        &config.registered,
        home.as_deref(),
        default_inputs(),
    ) {
        Ok(allowed) => allowed,
        Err(error) => {
            let _ = output::write_error(&mut std::io::stderr().lock(), &error, false);
            return error.code.exit_code();
        }
    };
    let server = Server::new(
        allowed,
        home,
        config.warnings,
        Box::new(app_config::load_default),
    );
    let code = runtime.block_on(serve(server));
    // Not dropped: dropping a runtime waits for its blocking threads, and the one
    // `tokio::io::stdin` reads on cannot be cancelled while a read is pending (tokio's
    // `stdin` docs). `main` exits the process as soon as this returns.
    runtime.shutdown_background();
    code
}

async fn serve(server: Server) -> i32 {
    match server.serve(rmcp::transport::stdio()).await {
        Ok(running) => match running.waiting().await {
            Ok(QuitReason::JoinError(error)) => {
                failed(format!("the MCP session ended with an error: {error}"))
            }
            Ok(_) => 0,
            Err(error) => failed(format!("the MCP session ended with an error: {error}")),
        },
        // stdin ended before the handshake: a client checking that the server starts.
        Err(ServerInitializeError::ConnectionClosed(_)) => 0,
        // A request it refuses before the handshake, rmcp answers and goes on waiting; what
        // ends here is a first message that is no request, or a handshake that failed.
        Err(error) => failed(format!("the MCP session did not start: {error}")),
    }
}

/// One line on stderr, in the CLI's form.
fn failed(message: String) -> i32 {
    let error = CliError::new(ErrorCode::Io, message);
    let _ = output::write_error(&mut std::io::stderr().lock(), &error, false);
    error.code.exit_code()
}

/// Where the default vault is looked for when no `--vault` is given (spec 0068 D4):
/// `CLAUDE_PROJECT_DIR`, which Claude Code sets for the servers it starts, then the
/// directory the server started in. Taken once, here; which registered vault holds them is
/// decided on each call (`scope::Scope::resolve`). A relative `CLAUDE_PROJECT_DIR` would be
/// relative to that same undocumented directory, so it is not used.
fn default_inputs() -> Vec<PathBuf> {
    let project = std::env::var_os("CLAUDE_PROJECT_DIR")
        .map(PathBuf::from)
        .filter(|path| path.is_absolute());
    project
        .into_iter()
        .chain(std::env::current_dir().ok())
        .collect()
}
