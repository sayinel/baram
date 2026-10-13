// §389 A tool's arguments. One table per tool (`Spec`s) gives both the input schema
// `tools/list` shows and the checks a call's arguments pass, so the two cannot disagree
// (spec 0068 D12). The arguments are read here and not by rmcp's `Parameters<T>`: serde's
// errors do not name the field, and every bad argument is INVALID_ARGUMENT naming it.

use crate::cli::error::{CliError, ErrorCode};
use rmcp::model::JsonObject;
use serde_json::{json, Value};
use std::sync::Arc;

/// What an argument holds.
#[derive(Debug, Clone, Copy)]
pub(super) enum Kind {
    Text,
    /// `true` or `false`; `false` when the call leaves it out.
    Flag,
    /// An integer from `min`, up to `max` when there is one.
    Count {
        min: u64,
        max: Option<u64>,
        default: u64,
    },
    /// One of `values`.
    Choice {
        values: &'static [&'static str],
        default: &'static str,
    },
}

#[derive(Debug, Clone, Copy)]
pub(super) struct Spec {
    pub name: &'static str,
    pub kind: Kind,
    pub required: bool,
    /// The schema's `description`: what the argument is, not what to do with it.
    pub doc: &'static str,
}

/// Every tool's optional `vault` (spec 0068 §3.2).
pub(super) const VAULT: Spec = Spec {
    name: "vault",
    kind: Kind::Text,
    required: false,
    doc: "The vault to read: a name or alias list_vaults shows, or the vault's path — \
          absolute, ~ alone, or starting with ~/ (or ~\\ on Windows). Default: the default \
          vault.",
};

/// A list tool's `offset` (spec 0068 §3.4). No maximum: past the end is an empty page.
pub(super) const OFFSET: Spec = Spec {
    name: "offset",
    kind: Kind::Count {
        min: 0,
        max: None,
        default: 0,
    },
    required: false,
    doc: "How many items to skip: the nextOffset of the page before. Default 0.",
};

/// A tool's `limit`: its page size, from 1 up to `max` (spec 0068 §3.3).
pub(super) const fn limit(default: u64, max: u64) -> Spec {
    Spec {
        name: "limit",
        kind: Kind::Count {
            min: 1,
            max: Some(max),
            default,
        },
        required: false,
        doc: "The most items a page holds.",
    }
}

/// The input schema for a tool with these arguments: an object, nothing else allowed.
pub(super) fn schema(specs: &[Spec]) -> Arc<JsonObject> {
    let mut properties = JsonObject::new();
    for spec in specs {
        // Built by `insert`, not by indexing a `Value`: serde_json's `IndexMut` panics on a
        // value that is neither an object nor null, and `tools/list` runs this — a handler
        // path, where the release build aborts on a panic.
        let mut property = JsonObject::new();
        match spec.kind {
            Kind::Text => {
                property.insert("type".into(), json!("string"));
            }
            Kind::Flag => {
                property.insert("type".into(), json!("boolean"));
                property.insert("default".into(), json!(false));
            }
            Kind::Count { min, max, default } => {
                property.insert("type".into(), json!("integer"));
                property.insert("minimum".into(), json!(min));
                property.insert("default".into(), json!(default));
                if let Some(max) = max {
                    property.insert("maximum".into(), json!(max));
                }
            }
            Kind::Choice { values, default } => {
                property.insert("type".into(), json!("string"));
                property.insert("enum".into(), json!(values));
                property.insert("default".into(), json!(default));
            }
        }
        property.insert("description".into(), json!(spec.doc));
        properties.insert(spec.name.to_string(), Value::Object(property));
    }
    let required: Vec<&str> = specs
        .iter()
        .filter(|spec| spec.required)
        .map(|spec| spec.name)
        .collect();
    let mut schema = JsonObject::new();
    schema.insert("type".into(), json!("object"));
    schema.insert("properties".into(), Value::Object(properties));
    if !required.is_empty() {
        schema.insert("required".into(), json!(required));
    }
    schema.insert("additionalProperties".into(), json!(false));
    Arc::new(schema)
}

/// A call's arguments, once `read` has checked every one of them.
pub(super) struct Args {
    values: JsonObject,
    specs: &'static [Spec],
}

/// Checks a call's arguments against its tool's table (spec 0068 §3.5): no name outside the
/// table, every required one present, every value of its kind. A `null` value reads as
/// absent, the way rmcp reads `arguments: null`.
pub(super) fn read(
    arguments: Option<JsonObject>,
    specs: &'static [Spec],
) -> Result<Args, CliError> {
    let mut values = arguments.unwrap_or_default();
    values.retain(|_, value| !value.is_null());
    if let Some(name) = values
        .keys()
        .find(|name| !specs.iter().any(|spec| spec.name == name.as_str()))
    {
        return Err(invalid(format!("`{name}` is not an argument of this tool")));
    }
    for spec in specs {
        match values.get(spec.name) {
            Some(value) => check(spec, value)?,
            None if spec.required => return Err(invalid(format!("`{}` is required", spec.name))),
            None => {}
        }
    }
    Ok(Args { values, specs })
}

fn check(spec: &Spec, value: &Value) -> Result<(), CliError> {
    let name = spec.name;
    match spec.kind {
        Kind::Text if value.is_string() => Ok(()),
        Kind::Text => Err(invalid(format!("`{name}` must be a string"))),
        Kind::Flag if value.is_boolean() => Ok(()),
        Kind::Flag => Err(invalid(format!("`{name}` must be true or false"))),
        Kind::Count { min, max, .. } => {
            let fits = value.as_u64().is_some_and(|n| {
                n >= min
                    && match max {
                        Some(max) => n <= max,
                        None => true,
                    }
            });
            if fits {
                Ok(())
            } else {
                Err(invalid(match max {
                    Some(max) => format!("`{name}` must be an integer from {min} to {max}"),
                    None => format!("`{name}` must be an integer, {min} or more"),
                }))
            }
        }
        Kind::Choice { values, .. } => {
            if value.as_str().is_some_and(|given| values.contains(&given)) {
                Ok(())
            } else {
                Err(invalid(format!(
                    "`{name}` must be one of: {}",
                    values.join(", ")
                )))
            }
        }
    }
}

fn invalid(message: String) -> CliError {
    CliError::new(ErrorCode::InvalidArgument, message)
}

impl Args {
    /// A text argument, or `None` when the call left it out.
    pub(super) fn text(&self, name: &str) -> Option<&str> {
        self.known(name)?;
        self.values.get(name).and_then(Value::as_str)
    }

    /// A true-or-false argument; `false` when the call left it out.
    pub(super) fn flag(&self, name: &str) -> bool {
        self.known(name).is_some()
            && self
                .values
                .get(name)
                .and_then(Value::as_bool)
                .unwrap_or(false)
    }

    /// A count argument, or its default when the call left it out. Past `usize` — only on a
    /// 32-bit target — it saturates.
    pub(super) fn count(&self, name: &str) -> usize {
        let Some(Kind::Count { default, .. }) = self.known(name).map(|spec| spec.kind) else {
            return 0;
        };
        let given = self
            .values
            .get(name)
            .and_then(Value::as_u64)
            .unwrap_or(default);
        usize::try_from(given).unwrap_or(usize::MAX)
    }

    /// A choice argument, or its default when the call left it out.
    pub(super) fn choice(&self, name: &str) -> &str {
        let Some(Kind::Choice { default, .. }) = self.known(name).map(|spec| spec.kind) else {
            return "";
        };
        self.values
            .get(name)
            .and_then(Value::as_str)
            .unwrap_or(default)
    }

    /// The table's entry for `name`. Every name a tool reads is in its table: a debug build
    /// (the tests) stops on one that is not, and a release build reads it as absent.
    fn known(&self, name: &str) -> Option<&Spec> {
        let spec = self.specs.iter().find(|spec| spec.name == name);
        debug_assert!(spec.is_some(), "`{name}` is not in this tool's table");
        spec
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const ONLY_VAULT: &[Spec] = &[VAULT];

    const PAGED: &[Spec] = &[
        VAULT,
        OFFSET,
        limit(200, 1000),
        Spec {
            name: "status",
            kind: Kind::Choice {
                values: &["open", "all"],
                default: "open",
            },
            required: false,
            doc: "",
        },
        Spec {
            name: "tag",
            kind: Kind::Text,
            required: true,
            doc: "",
        },
    ];

    fn object(value: Value) -> Option<JsonObject> {
        match value {
            Value::Object(object) => Some(object),
            _ => None,
        }
    }

    fn message(result: Result<Args, CliError>) -> String {
        match result {
            Ok(_) => panic!("expected an error"),
            Err(error) => {
                assert_eq!(error.code, ErrorCode::InvalidArgument);
                error.message
            }
        }
    }

    /// What fails this: the unknown-name check dropped; `null` kept and then refused as the
    /// wrong kind.
    #[test]
    fn a_name_outside_the_table_is_refused_and_null_reads_as_absent() {
        assert_eq!(
            message(read(object(json!({ "vault": "v", "x": 1 })), ONLY_VAULT)),
            "`x` is not an argument of this tool"
        );
        let args = read(object(json!({ "vault": null })), ONLY_VAULT).unwrap();
        assert_eq!(args.text("vault"), None);
        let args = read(None, ONLY_VAULT).unwrap();
        assert_eq!(args.text("vault"), None);
        let args = read(object(json!({ "vault": "v" })), ONLY_VAULT).unwrap();
        assert_eq!(args.text("vault"), Some("v"));
    }

    /// What fails this: `check` accepting any JSON for a text argument.
    #[test]
    fn a_value_of_another_kind_is_refused_naming_the_argument() {
        for value in [json!(7), json!(true), json!(["v"]), json!({ "v": 1 })] {
            assert_eq!(
                message(read(object(json!({ "vault": value })), ONLY_VAULT)),
                "`vault` must be a string"
            );
        }
    }

    /// What fails this: `additionalProperties` left out (a client would offer names the call
    /// then refuses); a `required` written for a table with nothing required.
    #[test]
    fn the_schema_is_an_object_of_the_table_s_arguments_and_nothing_else() {
        let schema = Value::Object(schema(ONLY_VAULT).as_ref().clone());
        assert_eq!(schema["type"], json!("object"));
        assert_eq!(schema["additionalProperties"], json!(false));
        assert_eq!(schema["properties"]["vault"]["type"], json!("string"));
        assert!(schema["properties"]["vault"]["description"].is_string());
        assert!(schema.get("required").is_none(), "{schema}");
    }

    /// What fails this: a range check that lets 0 or 1001 through, or reads `1.5` and `-1` as
    /// whole numbers.
    #[test]
    fn a_count_outside_its_range_is_refused_naming_the_range() {
        for (value, expected) in [
            (json!(-1), "`offset` must be an integer, 0 or more"),
            (json!(1.5), "`offset` must be an integer, 0 or more"),
            (json!("3"), "`offset` must be an integer, 0 or more"),
        ] {
            assert_eq!(
                message(read(object(json!({ "tag": "t", "offset": value })), PAGED)),
                expected
            );
        }
        for value in [0, 1001] {
            assert_eq!(
                message(read(object(json!({ "tag": "t", "limit": value })), PAGED)),
                "`limit` must be an integer from 1 to 1000"
            );
        }
        let args = read(
            object(json!({ "tag": "t", "limit": 1000, "offset": u64::MAX })),
            PAGED,
        )
        .unwrap();
        assert_eq!(args.count("limit"), 1000);
        assert_eq!(
            args.count("offset"),
            usize::try_from(u64::MAX).unwrap_or(usize::MAX)
        );
    }

    /// What fails this: defaults not applied (a left-out `limit` read as 0 — an empty page).
    #[test]
    fn defaults_fill_what_the_call_left_out() {
        let args = read(object(json!({ "tag": "t" })), PAGED).unwrap();
        assert_eq!(args.count("offset"), 0);
        assert_eq!(args.count("limit"), 200);
        assert_eq!(args.choice("status"), "open");
        let args = read(object(json!({ "tag": "t", "status": "all" })), PAGED).unwrap();
        assert_eq!(args.choice("status"), "all");
    }

    /// What fails this: a choice check that accepts any string; `required` not checked, or
    /// checked before `null` is dropped.
    #[test]
    fn a_choice_outside_its_values_and_a_required_argument_left_out_are_refused() {
        assert_eq!(
            message(read(object(json!({ "tag": "t", "status": "late" })), PAGED)),
            "`status` must be one of: open, all"
        );
        assert_eq!(message(read(object(json!({})), PAGED)), "`tag` is required");
        assert_eq!(
            message(read(object(json!({ "tag": null })), PAGED)),
            "`tag` is required"
        );
    }

    /// The schema says what `read` checks, so a model knows the range from `tools/list`.
    ///
    /// What fails this: `minimum` · `maximum` · `enum` · `required` left out of the schema.
    #[test]
    fn the_schema_carries_the_ranges_choices_and_required_names() {
        let schema = Value::Object(schema(PAGED).as_ref().clone());
        let properties = &schema["properties"];
        assert_eq!(properties["limit"]["minimum"], json!(1));
        assert_eq!(properties["limit"]["maximum"], json!(1000));
        assert_eq!(properties["limit"]["default"], json!(200));
        assert_eq!(properties["offset"]["minimum"], json!(0));
        assert!(properties["offset"].get("maximum").is_none());
        assert_eq!(properties["status"]["enum"], json!(["open", "all"]));
        assert_eq!(schema["required"], json!(["tag"]));
    }

    /// What fails this: `check` accepting `"true"` or `1` for a flag; `flag` defaulting to true.
    #[test]
    fn a_flag_is_true_or_false_and_false_when_left_out() {
        const FLAGGED: &[Spec] = &[Spec {
            name: "regex",
            kind: Kind::Flag,
            required: false,
            doc: "",
        }];
        for value in [json!("true"), json!(1)] {
            assert_eq!(
                message(read(object(json!({ "regex": value })), FLAGGED)),
                "`regex` must be true or false"
            );
        }
        assert!(!read(None, FLAGGED).unwrap().flag("regex"));
        assert!(read(object(json!({ "regex": true })), FLAGGED)
            .unwrap()
            .flag("regex"));
    }
}
