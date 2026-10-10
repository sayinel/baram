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
    doc: "The vault to read: a name or alias list_vaults shows, or the vault's absolute \
          path (a path may start with ~). Default: the default vault.",
};

/// The input schema for a tool with these arguments: an object, nothing else allowed.
pub(super) fn schema(specs: &[Spec]) -> Arc<JsonObject> {
    let mut properties = JsonObject::new();
    for spec in specs {
        let mut property = match spec.kind {
            Kind::Text => json!({ "type": "string" }),
        };
        property["description"] = json!(spec.doc);
        properties.insert(spec.name.to_string(), property);
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
}
