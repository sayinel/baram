use super::*;
use serde_json::json;
use std::path::PathBuf;

/// What `check_paths` made of one read: the arguments the gate was asked about, whether the
/// task exclusions were read, and the checked read.
async fn checked(read: serde_json::Value) -> (Vec<String>, bool, Result<Checked, String>) {
    let read: IndexRead = serde_json::from_value(read).unwrap();
    let mut gated = Vec::new();
    let mut excluded = false;
    let checked = check_paths(
        read,
        |given: String| {
            gated.push(given.clone());
            std::future::ready(if given == "refused.md" {
                Err("the gate said no".to_string())
            } else {
                Ok(PathArg {
                    canonical: PathBuf::from("/gated").join(&given),
                    given,
                })
            })
        },
        || {
            excluded = true;
            vec!["archive".to_string()]
        },
    )
    .await;
    (gated, excluded, checked)
}

/// P13 · spec §5.1: from the JSON a caller sends (tagged on `read`, camelCase), exactly the
/// path arguments — `path` of `backlinks` and `links`, a search's `options.folder`, a task
/// `file` — go through the tier's gate, and the task exclusions are read for `tasks` alone.
/// What fails this: an arm that hands a path on without the gate, or reads the exclusions for
/// another read. The pair: the reads with no path argument never call the gate.
#[tokio::test]
async fn each_path_argument_goes_through_the_gate() {
    for (read, paths, excluded) in [
        (
            json!({ "read": "backlinks", "path": "b.md" }),
            &["b.md"][..],
            false,
        ),
        (
            json!({ "read": "links", "path": "a.md" }),
            &["a.md"][..],
            false,
        ),
        (
            json!({ "read": "notesWithTag", "tag": "t" }),
            &[][..],
            false,
        ),
        (
            json!({ "read": "search", "query": "q", "options": { "folder": "docs" } }),
            &["docs"][..],
            false,
        ),
        (json!({ "read": "search", "query": "q" }), &[][..], false),
        (json!({ "read": "tags" }), &[][..], false),
        (
            json!({ "read": "tasks", "file": "t.md" }),
            &["t.md"][..],
            true,
        ),
        (json!({ "read": "tasks" }), &[][..], true),
    ] {
        let (gated, read_exclusions, checked) = checked(read.clone()).await;
        assert_eq!(gated, paths, "{read}");
        assert_eq!(read_exclusions, excluded, "{read}");
        assert!(checked.is_ok(), "{read}");
    }
}

/// A search folder is MOVED out of `options` (the read looks only at `Checked::Search::folder`),
/// a `tasks` read without `status` asks for open tasks, and the gate's refusal is the read's.
/// What fails this: the folder copied rather than taken, another default status, or a gate
/// refusal swallowed.
#[tokio::test]
async fn check_paths_moves_the_folder_defaults_the_status_and_keeps_the_gates_refusal() {
    let (_, _, search) = checked(
        json!({ "read": "search", "query": "q", "options": { "folder": "docs", "limit": 5 } }),
    )
    .await;
    let Ok(Checked::Search {
        folder,
        options,
        query,
    }) = search
    else {
        panic!("a search: {search:?}");
    };
    assert_eq!(
        folder.map(|f| f.canonical),
        Some(PathBuf::from("/gated/docs"))
    );
    assert_eq!(
        (options.folder, options.limit, query.as_str()),
        (None, Some(5), "q")
    );

    let (_, _, tasks) = checked(json!({ "read": "tasks" })).await;
    let Ok(Checked::Tasks {
        exclude,
        file,
        status,
    }) = tasks
    else {
        panic!("a tasks read: {tasks:?}");
    };
    assert_eq!(
        (exclude, file.is_none(), status),
        (vec!["archive".to_string()], true, TaskStatus::Open)
    );
    let (_, _, done) = checked(json!({ "read": "tasks", "status": "done" })).await;
    assert!(matches!(
        done,
        Ok(Checked::Tasks {
            status: TaskStatus::Done,
            ..
        })
    ));

    let (_, _, refused) = checked(json!({ "read": "links", "path": "refused.md" })).await;
    assert_eq!(refused.unwrap_err(), "the gate said no");
}
