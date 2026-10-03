// §387 CLI errors — a caller branches on `code`, never on the wording of `message`.

use serde::Serialize;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub(crate) enum ErrorCode {
    VaultNotFound,
    VaultAmbiguous,
    InvalidArgument,
    Io,
}

impl ErrorCode {
    /// The name printed in text mode — the same string serde writes in JSON mode
    /// (`as_str_is_what_serde_writes` holds the two together). No `_` arm: a new code
    /// must be named here before the crate compiles.
    pub(crate) fn as_str(self) -> &'static str {
        match self {
            ErrorCode::VaultNotFound => "VAULT_NOT_FOUND",
            ErrorCode::VaultAmbiguous => "VAULT_AMBIGUOUS",
            ErrorCode::InvalidArgument => "INVALID_ARGUMENT",
            ErrorCode::Io => "IO",
        }
    }

    /// A bad argument is a usage error like clap's own (2); everything else failed while
    /// running (1). An empty result is not an error at all.
    pub(crate) fn exit_code(self) -> i32 {
        match self {
            ErrorCode::InvalidArgument => 2,
            ErrorCode::VaultNotFound | ErrorCode::VaultAmbiguous | ErrorCode::Io => 1,
        }
    }
}

/// A vault the caller could have meant, listed with the two vault errors.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub(crate) struct Candidate {
    pub name: String,
    pub path: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub(crate) struct CliError {
    pub code: ErrorCode,
    pub message: String,
    pub candidates: Vec<Candidate>,
}

impl CliError {
    pub(crate) fn new(code: ErrorCode, message: impl Into<String>) -> Self {
        Self {
            code,
            message: message.into(),
            candidates: Vec::new(),
        }
    }

    pub(crate) fn with_candidates(mut self, candidates: Vec<Candidate>) -> Self {
        self.candidates = candidates;
        self
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Hand-listed: the compiler holds `as_str` and `exit_code` to every variant (no `_`
    /// arm), but not this list. A variant missing here is only untested, not wrong.
    const ALL: &[ErrorCode] = &[
        ErrorCode::VaultNotFound,
        ErrorCode::VaultAmbiguous,
        ErrorCode::InvalidArgument,
        ErrorCode::Io,
    ];

    #[test]
    fn as_str_is_what_serde_writes() {
        for code in ALL {
            assert_eq!(
                serde_json::to_value(code).unwrap(),
                serde_json::Value::String(code.as_str().to_string())
            );
        }
    }

    #[test]
    fn only_a_bad_argument_is_a_usage_error() {
        for code in ALL {
            let expected = if *code == ErrorCode::InvalidArgument {
                2
            } else {
                1
            };
            assert_eq!(code.exit_code(), expected, "{}", code.as_str());
        }
    }

    #[test]
    fn candidates_are_always_in_the_json_even_when_there_are_none() {
        let error = CliError::new(ErrorCode::Io, "cannot read a.md");
        assert_eq!(
            serde_json::to_value(&error).unwrap(),
            serde_json::json!({ "code": "IO", "message": "cannot read a.md", "candidates": [] })
        );
    }
}
