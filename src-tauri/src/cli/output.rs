// §387 CLI output — tab-separated text for people and grep, one JSON envelope for agents.

use super::error::CliError;
use serde::Serialize;
use std::io::{self, Write};

/// The vault a command read, as the envelope names it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub(crate) struct VaultInfo {
    pub name: String,
    pub path: String,
}

/// What every command prints in `--json` mode. `vault` is `None` only for `vaults` run
/// where no vault resolves (spec 0066 §3.3-4).
#[derive(Debug, Serialize)]
pub(crate) struct Envelope<T> {
    pub vault: Option<VaultInfo>,
    pub truncated: bool,
    pub items: Vec<T>,
}

/// One item as a text-mode line: its fields in order, unescaped.
pub(crate) trait Row {
    fn fields(&self) -> Vec<String>;
}

/// Escapes what would break "one line per item, fields split by tabs". A backslash is
/// doubled, so an escape written here can be told from one that was in the source.
pub(crate) fn escape(field: &str) -> String {
    let mut out = String::with_capacity(field.len());
    for c in field.chars() {
        match c {
            '\\' => out.push_str("\\\\"),
            '\t' => out.push_str("\\t"),
            '\n' => out.push_str("\\n"),
            '\r' => out.push_str("\\r"),
            other => out.push(other),
        }
    }
    out
}

/// Every writer here returns the `io::Error` instead of panicking on it: `println!`
/// panics on a closed pipe, and the release profile aborts on panic. `cli::run` turns a
/// broken pipe into exit 0.
pub(crate) fn write_json<T: Serialize>(out: &mut dyn Write, value: &T) -> io::Result<()> {
    serde_json::to_writer(&mut *out, value).map_err(io::Error::from)?;
    writeln!(out)
}

pub(crate) fn write_rows<T: Row>(out: &mut dyn Write, items: &[T]) -> io::Result<()> {
    for item in items {
        let line: Vec<String> = item.fields().iter().map(|field| escape(field)).collect();
        writeln!(out, "{}", line.join("\t"))?;
    }
    Ok(())
}

pub(crate) fn write_envelope<T: Serialize + Row>(
    out: &mut dyn Write,
    envelope: &Envelope<T>,
    json: bool,
) -> io::Result<()> {
    if json {
        write_json(out, envelope)
    } else {
        write_rows(out, &envelope.items)
    }
}

/// In text mode the message is escaped like a field, so one error is one line: some
/// messages carry a third party's text that spans several (the regex crate's does). The
/// JSON form carries the message unchanged.
pub(crate) fn write_error(out: &mut dyn Write, error: &CliError, json: bool) -> io::Result<()> {
    if json {
        return write_json(out, &serde_json::json!({ "error": error }));
    }
    writeln!(
        out,
        "error[{}]: {}",
        error.code.as_str(),
        escape(&error.message)
    )?;
    for candidate in &error.candidates {
        writeln!(
            out,
            "  {}\t{}",
            escape(&candidate.name),
            escape(&candidate.path)
        )?;
    }
    Ok(())
}

/// A warning does not change the exit code: the command goes on with what it could read.
pub(crate) fn write_warning(out: &mut dyn Write, message: &str, json: bool) -> io::Result<()> {
    if json {
        return write_json(
            out,
            &serde_json::json!({ "warning": { "message": message } }),
        );
    }
    writeln!(out, "warning: {message}")
}

#[cfg(test)]
mod tests {
    use super::super::error::{Candidate, ErrorCode};
    use super::*;

    #[derive(Serialize)]
    struct Pair {
        a: String,
        b: u32,
    }
    impl Row for Pair {
        fn fields(&self) -> Vec<String> {
            vec![self.a.clone(), self.b.to_string()]
        }
    }

    fn text(run: impl Fn(&mut dyn Write) -> io::Result<()>) -> String {
        let mut buffer: Vec<u8> = Vec::new();
        run(&mut buffer).unwrap();
        String::from_utf8(buffer).unwrap()
    }

    #[test]
    fn escape_keeps_one_item_on_one_line() {
        assert_eq!(escape("a\tb\nc\rd\\e"), "a\\tb\\nc\\rd\\\\e");
        assert_eq!(escape("plain 한글"), "plain 한글");
    }

    #[test]
    fn a_backslash_in_the_source_is_not_read_as_an_escape() {
        // `\` then `t` in the source is two characters, not a tab: it comes out as a
        // doubled backslash followed by `t`, which a real tab never does.
        assert_eq!(escape("\\t"), "\\\\t");
        assert_ne!(escape("\\t"), escape("\t"));
    }

    #[test]
    fn rows_are_tab_separated_and_newline_terminated() {
        let envelope = Envelope {
            vault: None,
            truncated: false,
            items: vec![
                Pair {
                    a: "x\ty".into(),
                    b: 1,
                },
                Pair {
                    a: "z".into(),
                    b: 2,
                },
            ],
        };
        assert_eq!(
            text(|out| write_envelope(out, &envelope, false)),
            "x\\ty\t1\nz\t2\n"
        );
    }

    #[test]
    fn the_json_envelope_keeps_a_null_vault_and_ends_with_a_newline() {
        let envelope = Envelope {
            vault: None,
            truncated: true,
            items: vec![Pair {
                a: "x".into(),
                b: 1,
            }],
        };
        let written = text(|out| write_envelope(out, &envelope, true));
        assert!(written.ends_with('\n'));
        assert_eq!(
            serde_json::from_str::<serde_json::Value>(&written).unwrap(),
            serde_json::json!({ "vault": null, "truncated": true, "items": [{ "a": "x", "b": 1 }] })
        );
    }

    #[test]
    fn an_error_is_one_json_object_or_a_coded_line_with_its_candidates() {
        let error = CliError::new(ErrorCode::VaultAmbiguous, "two vaults are named `notes`")
            .with_candidates(vec![Candidate {
                name: "Notes".into(),
                path: "/a/notes".into(),
            }]);
        assert_eq!(
            serde_json::from_str::<serde_json::Value>(&text(|out| write_error(out, &error, true)))
                .unwrap(),
            serde_json::json!({ "error": {
                "code": "VAULT_AMBIGUOUS",
                "message": "two vaults are named `notes`",
                "candidates": [{ "name": "Notes", "path": "/a/notes" }]
            }})
        );
        assert_eq!(
            text(|out| write_error(out, &error, false)),
            "error[VAULT_AMBIGUOUS]: two vaults are named `notes`\n  Notes\t/a/notes\n"
        );
    }

    #[test]
    fn an_error_message_that_spans_lines_is_one_line_in_text_mode_only() {
        let error = CliError::new(ErrorCode::InvalidArgument, "bad:\n  (\nerror: unclosed");
        assert_eq!(
            text(|out| write_error(out, &error, false)),
            "error[INVALID_ARGUMENT]: bad:\\n  (\\nerror: unclosed\n"
        );
        assert_eq!(
            serde_json::from_str::<serde_json::Value>(&text(|out| write_error(out, &error, true)))
                .unwrap()["error"]["message"],
            "bad:\n  (\nerror: unclosed"
        );
    }

    #[test]
    fn a_warning_is_a_line_or_one_json_object() {
        assert_eq!(
            text(|out| write_warning(out, "x: y", false)),
            "warning: x: y\n"
        );
        assert_eq!(
            serde_json::from_str::<serde_json::Value>(&text(|out| write_warning(
                out, "x: y", true
            )))
            .unwrap(),
            serde_json::json!({ "warning": { "message": "x: y" } })
        );
    }
}
