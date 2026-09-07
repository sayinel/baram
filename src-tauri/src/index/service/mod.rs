// §29 인덱스 IPC 커맨드 — 백링크 조회, 인덱스 빌드/갱신
// §33 파일 이름 변경 시 wikilink 자동 갱신
//
// issue 263 — one key, derived one way. The per-context link indexes live in a
// map keyed by the context's REGISTERED PATH (`ContextInfo.path`). Not the
// context id: `legacy-xxx` and `ctx-xxx` ids can name the same vault, and
// `search_knowledge` used to look this map up by id — a guaranteed miss that
// `unwrap_or_default()` turned into an empty graph, so hybrid ranking's graph
// term was 0 for every query with no error and no log. And not the raw string
// the frontend happens to hold either: its `rootPath` can carry a trailing
// slash, or a spelling Rust deduplicated away at registration. So a path —
// a vault root in any spelling, or a file inside one — is mapped to the
// contexts that CONTAIN it (canonically, in ContextManager) and the key is a
// context's registered path. `owning_contexts`, `owning_index_key` and
// `active_index_key` are the only derivations, used by every command here and
// by embedding_cmd.
//
// File-scoped commands (backlinks of a file, re-indexing a saved file, the
// renames) key by the contexts CONTAINING the file, not the active one: a
// non-active tab is saved and re-indexed too, and a backlinks query can land
// while a context switch is still in flight. Nested vault roots each hold an
// index that scans the file, so a save reaches every containing index and a
// rename asks every one of them — a reference from outside a nested root
// lives only in the enclosing index. A path no context knows: a query answers
// empty and a save is a no-op (the panel would render an error as one), a
// rename refuses (nothing is known about its references). A standalone File
// context (§89) has no directory index and no other file to update: its file
// is renamed, nothing else. Only the whole-graph query without an explicit
// root and knowledge search are inherently about the active context, and
// knowledge search degrades to an empty graph term when nothing is active.
//
// The lock is never held across an await — by construction, not by review: the
// map is private and reachable only through this type's own async methods,
// each of which does only synchronous work under the guard (a read takes a
// synchronous closure). Every command derives its key BEFORE touching the map,
// so the ContextManager's own locks are never awaited while this one is held.
//
// A rebuild reads the vault's files over time, outside the map lock, and a
// save or rename can land on the live index meanwhile. Those mutations are
// journaled while a build is reading and REPLAYED onto its snapshot before it
// is published, so the published index is "what the build read, plus what
// changed since" — never older than the live one. Without this a background
// refresh that began before a rename would overwrite the rename-corrected
// index with its pre-rename snapshot, and the next rename would trust it and
// miss the references. Builds are serialised per key, and a refresh that
// queued behind a build that published meanwhile returns that build's stats
// instead of scanning the vault again. A mutation is recorded by the file's
// CANONICAL path and projected into a spelling only when it meets an index:
// the live index's root spelling when applied, the pending build's root
// spelling when replayed — so a save that lands during the first build of a
// slot registered under another spelling still lands in the right place.
//
// An index is built only from a REGISTERED directory context's root.
// `refresh_index` and `rename_namespace` take the frontend's root, which must
// be a registration itself (`context_registered_at`) — never "the deepest
// context containing it", which right after a removal is the parent, whose
// index a subtree scan would replace. The rename gate (`ensure_indexes`)
// builds a missing index from the context's registered path before a file is
// touched: that spelling was supplied by the frontend at registration, so it
// is not the guess this file refuses to make — a root derived from a FILE
// path, which with a symlink inside a vault would scan and rewrite outside
// it. The gate reaches the contexts nothing else builds (a journal or zettel
// space registered without being opened, a nested folder restored from the
// last session); the first rename there waits for one scan. Renaming before
// an index existed used to rename the file and rewrite none of its
// references, silently. The renames confine what they write: the destination
// stays inside the file's contexts (a file opened on its own may only be
// renamed within its directory), a namespace move stays inside the root that
// authorised it, and a referring file the index names is rewritten only if it
// still resolves inside those contexts. A namespace move refuses a directory
// that is, or holds, a registered context (its registration would dangle), and
// drops the indexes of the other contexts whose scan covered the moved files —
// the gate rebuilds each when next needed (issue 591).
//
// An index holds paths in the spelling of the root it was built from. A nested
// root can be registered — and built — under another spelling of the same
// directory (a symlink); a canonical path that cannot be placed under a slot's
// root is skipped for that slot. Removing a context forgets its slot by
// leaving a tombstone with a new GENERATION and the removal's sequence number:
// an index from a previous registration must not satisfy the next one's
// readiness, a build started under the old registration cannot publish into
// the new one, a refresh that resolved the key just before the removal refuses
// instead of adopting the tombstone's generation, and the next registration's
// refresh cannot coalesce onto an old publication. Each build records its
// registration's INCARNATION, so a removal that arrives after the same path
// was re-registered and rebuilt (the command removes from the ContextManager
// first and forgets here after an await) is stale and ignored — and an index
// counts for a registration only if it was published for that registration's
// incarnation, so one left by an earlier registration of the same path does
// not satisfy the gate. A build re-checks, after taking the build lock and
// again before publishing, that the root's spelling still names the directory
// it was approved as: a symlink retargeted meanwhile cannot publish an
// unrelated tree under a vault's key.

mod build;
mod keys;
mod query;
mod rename;
mod state;

#[cfg(test)]
mod tests;

pub use rename::{NamespaceRenameResult, RenameResult};
pub use state::LinkIndexState;

pub(crate) use build::refresh_index_inner;
pub(crate) use keys::{active_registration, outgoing_links_for};
pub(crate) use query::{get_backlinks_inner, get_link_index_inner, update_file_index_inner};
pub(crate) use rename::{
    rename_block_id_inner, rename_file_with_links_inner, rename_namespace_inner,
};
