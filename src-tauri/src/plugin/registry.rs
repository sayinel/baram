// §69 Plugin Marketplace — manifest and registry data models.
//
// `PluginManifest` (what a plugin ships) and `RegistryIndex`/`RegistryEntry` (what the
// marketplace lists) plus the tolerant custom `Deserialize` that keeps one bad listing from
// emptying the whole index. Moved out of `plugin/mod.rs` as a pure data-model split — no
// behaviour here reaches the filesystem or the network.
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum PluginTrust {
    Sandboxed,
    Trusted,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PluginManifest {
    pub id: String,
    pub name: String,
    pub description: String,
    pub version: String,
    pub author: String,
    pub license: String,
    pub main: String,
    pub engines: EngineRequirement,
    pub capabilities: Vec<String>,
    #[serde(default)]
    pub dependencies: Vec<String>,
    #[serde(default, rename = "tiptapExtensions")]
    pub tiptap_extensions: Vec<TiptapExtensionDef>,
    #[serde(default)]
    pub repository: Option<String>,
    #[serde(default)]
    pub homepage: Option<String>,
    #[serde(default)]
    pub icon: Option<String>,
    #[serde(default)]
    pub keywords: Vec<String>,
    #[serde(default)]
    pub trust: Option<PluginTrust>,
    #[serde(default)]
    pub contributions: Option<serde_json::Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EngineRequirement {
    pub baram: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TiptapExtensionDef {
    #[serde(rename = "type")]
    pub ext_type: String, // "node" | "mark" | "plugin"
    pub name: String,
    #[serde(rename = "exportName")]
    pub export_name: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InstalledPluginInfo {
    pub manifest: PluginManifest,
    pub install_path: String,
    pub checksum: String,
    #[serde(default)]
    pub is_dev: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RegistryEntry {
    pub id: String,
    pub name: String,
    pub description: String,
    pub version: String,
    pub author: String,
    pub license: String,
    #[serde(rename = "downloadUrl")]
    pub download_url: String,
    pub checksum: String,
    pub capabilities: Vec<String>,
    /// §260 Phase 6 — the trust tier, carried THROUGH to the frontend.
    ///
    /// Rust decides nothing with it: consent is collected in the frontend against this
    /// entry, and `plugin_call`'s authorizer is keyed on the window label, not on anything
    /// the registry claims. But the field must exist here, because `fetch_registry`
    /// deserializes the live index into this struct and Tauri re-serializes it on the way
    /// back — so a tier that is not a field is a tier the frontend never sees. Publishing
    /// `trust` in `index.json` without this makes every entry look legacy and disables
    /// Install (§260 Phase 5), which is exactly the state Phase 6 found shipped.
    ///
    /// `Option<String>` rather than an enum: this layer is a pipe, and refusing an unknown
    /// tier here would turn a future registry addition into a hard fetch failure for the
    /// whole index. The frontend normalizes it (`fetchRegistryIndex`) and fails closed.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub trust: Option<String>,
    #[serde(default)]
    pub keywords: Vec<String>,
    #[serde(default)]
    pub downloads: u64,
    #[serde(default)]
    pub repository: Option<String>,
    #[serde(default)]
    pub homepage: Option<String>,
    #[serde(default)]
    pub icon: Option<String>,
    /// The declared minimum app version — ABSENT is a legal state here, meaning "no floor".
    ///
    /// Authors are still required to declare it (`docs/plugin-development.md`, and
    /// `scripts/validate-index.ts` fails the publish without it). This is the reader being
    /// liberal, not the spec going soft: `unmetBaramFloor` already treats an unparseable or
    /// missing floor as "no opinion" and installs anyway, so an entry without `engines` is
    /// one the app is perfectly willing to serve. Refusing to *deserialize* it would have
    /// been the only place that disagreed — and, before the tolerant `plugins` below, it
    /// took the whole index down with it.
    ///
    /// ‼️ WHY THIS IS NOT A FAIL-OPEN (§69 security review, question (a)). Omitting the
    /// field DEFERS the floor check, it does not remove it: `handleInstall` re-checks
    /// against `result.manifest.engines` after the download, and `PluginManifest.engines` is
    /// still REQUIRED here and in `validateManifest`. So the cost of an omission is a wasted
    /// download and a rollback, not an unprotected install. The listing's floor was never a
    /// security control anyway — it is self-declared by the party being gated, and
    /// `"baram": "*"` already bypassed it at zero cost before this change.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub engines: Option<EngineRequirement>,
}

/// Entries this build cannot read are DROPPED; the rest of the index stands.
///
/// `fetch_revocations`, thirty lines below `fetch_registry`, already carries this argument
/// in its docstring — it returns raw text precisely so that "a serde struct here would
/// reject the whole document on one bad entry". That reasoning was never applied to the
/// index, which is the list where the blast radius is larger: the revocation list failing
/// open costs one protection, but the index failing to parse empties the marketplace for
/// every user at once. A single community entry missing `license` did that.
///
/// Not the text-and-validate-in-TS shape of its sibling, deliberately. `RegistryEntry` is a
/// typed IPC contract the frontend consumes field-by-field, and moving parsing across the
/// boundary would mean writing a second full validator in TS to replace the one serde gives
/// us here. Per-entry tolerance buys the same property — one bad entry costs one entry —
/// without that.
///
/// ‼️ TOLERANCE IS FOR PARTIAL DAMAGE ONLY. A non-empty array from which NOTHING survives
/// is still a hard error, and that distinction is the whole safety of this design.
///
/// Turning a parse failure into `Ok` with fewer entries turns it into `Ok` with ZERO entries
/// when the cause is systemic rather than per-entry — a renamed field, a script emitting
/// `version` as a number, a schema change on either side. `fetchRegistryIndex` would then
/// cache that empty index for 24 hours, and its stale-cache fallback only runs on a throw,
/// so the user's previously-working listing would be replaced by a silent empty Browse tab.
/// That trades an observable outage for an unobservable one — worse than the bug this
/// tolerance fixes. Erroring on total loss keeps the old behaviour for exactly the case the
/// old behaviour was right about.
///
/// How many were dropped reaches the frontend in `dropped_count`. That field predates the
/// backend logger (`src/logging`), which installed an implementation behind the `log::warn!`
/// in the impl below — so the warning is now live as well. The field is still the signal the
/// frontend reports; the log is where the offending ids are named, up to
/// [`MAX_NAMED_DROPS`] of them.
#[derive(Debug, Clone, Serialize)]
pub struct RegistryIndex {
    pub plugins: Vec<RegistryEntry>,
    #[serde(rename = "updatedAt")]
    pub updated_at: Option<String>,
    /// How many entries the deserializer discarded, for the frontend to report.
    ///
    /// Never read off the wire — see the `Deserialize` impl. Same argument `normalizeIndex`
    /// makes for stripping a registry-supplied `demotedBecause`: a remote document must not
    /// be able to claim a diagnostic the app produces.
    #[serde(rename = "droppedCount")]
    pub dropped_count: usize,
}

/// How many individual bad entries get named in the log before it stops repeating itself.
///
/// Unbounded, one warning per dropped entry is a log-eviction primitive. `RegistryEntry`
/// needs nine fields, so `{"id":"a"}` — 11 bytes on the wire — fails on the second one and
/// produces a ~114-byte line: roughly 10x amplification, and `MAX_REGISTRY_BYTES` allows a
/// 4 MiB index, so one fetch would write ~43 MiB through a 2 MiB file that keeps two
/// archives. Every genuine diagnostic in the log and both archives would be gone, from a
/// single request. The total still reaches the user through `dropped_count`; the log only
/// needs enough examples to identify the offender.
const MAX_NAMED_DROPS: usize = 10;

/// The shape actually on the wire. `plugins` lands as raw `Value`s so each can be tried
/// independently; `dropped_count` has no counterpart here, which is what makes it un-forgeable.
#[derive(Deserialize)]
struct RawRegistryIndex {
    /// No `#[serde(default)]`: a document with no `plugins` array is not a partly-broken
    /// index, it is not an index. That stays a hard error.
    plugins: Vec<serde_json::Value>,
    #[serde(default, rename = "updatedAt")]
    updated_at: Option<String>,
}

impl<'de> Deserialize<'de> for RegistryIndex {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        let raw = RawRegistryIndex::deserialize(deserializer)?;
        let total = raw.plugins.len();
        // NOT `with_capacity(total)`: `RegistryEntry` is ~368 bytes, so a 4 MiB document of
        // millions of junk elements would reserve hundreds of MiB for entries that will
        // never be kept. Growing on demand costs a few reallocations for a real index.
        let mut kept: Vec<RegistryEntry> = Vec::new();
        let mut named = 0usize;
        for value in raw.plugins {
            // Captured before the move, so the warning can name the offender.
            let label = value
                .get("id")
                .and_then(serde_json::Value::as_str)
                .map(str::to_owned);
            match serde_json::from_value::<RegistryEntry>(value) {
                Ok(entry) => kept.push(entry),
                Err(err) => {
                    if named < MAX_NAMED_DROPS {
                        named += 1;
                        log::warn!(
                            "[registry] dropping unreadable index entry {}: {err}",
                            label.as_deref().unwrap_or("<no id>")
                        );
                    }
                }
            }
        }
        let dropped = total - kept.len();
        if dropped > named {
            log::warn!(
                "[registry] {} further unreadable entries were not named",
                dropped - named
            );
        }
        if total > 0 && kept.is_empty() {
            return Err(serde::de::Error::custom(format!(
                "every one of the {total} entries in this index was unreadable — treating \
                 it as a broken document rather than an empty registry"
            )));
        }
        Ok(RegistryIndex {
            dropped_count: total - kept.len(),
            plugins: kept,
            updated_at: raw.updated_at,
        })
    }
}

#[cfg(test)]
mod tests {
    use std::sync::Mutex;

    use super::*;

    #[test]
    fn test_registry_index_deserializes_camelcase() {
        const JSON: &str = r#"{
        "plugins": [
            {
                "id": "test-plugin",
                "name": "Test Plugin",
                "description": "A test plugin",
                "version": "1.0.0",
                "author": "Test Author",
                "license": "MIT",
                "downloadUrl": "https://x/p.zip",
                "checksum": "abc123",
                "capabilities": ["editor:readonly"],
                "engines": { "baram": ">=0.2.0" }
            }
        ],
        "updatedAt": "2026-01-01"
    }"#;
        let idx: RegistryIndex = serde_json::from_str(JSON).unwrap();
        assert_eq!(idx.plugins[0].download_url, "https://x/p.zip");
        assert_eq!(idx.updated_at, Some("2026-01-01".to_string()));
    }

    #[test]
    fn manifest_parses_trust_sandboxed() {
        let json = r#"{"id":"x","name":"X","description":"d","version":"1.0.0","author":"a","license":"MIT","main":"index.mjs","engines":{"baram":"*"},"capabilities":[],"trust":"sandboxed"}"#;
        let m: PluginManifest = serde_json::from_str(json).unwrap();
        assert_eq!(m.trust, Some(PluginTrust::Sandboxed));
    }

    #[test]
    fn manifest_without_trust_is_none_for_legacy() {
        let json = r#"{"id":"x","name":"X","description":"d","version":"1.0.0","author":"a","license":"MIT","main":"index.mjs","engines":{"baram":"*"},"capabilities":[]}"#;
        let m: PluginManifest = serde_json::from_str(json).unwrap();
        assert_eq!(m.trust, None);
    }

    #[test]
    fn test_committed_registry_seed_deserializes() {
        const SEED: &str = include_str!("../../../registry/index.json");
        let idx: RegistryIndex = serde_json::from_str(SEED).unwrap();
        // §260 Phase 6 — one entry: `baram-ai-summary` was withdrawn from the index because
        // it needs a declarative `sidebar` contribution that does not exist yet, so it
        // cannot be a sandboxed plugin and must not be published as a trusted one.
        let ids: Vec<&str> = idx.plugins.iter().map(|p| p.id.as_str()).collect();
        assert_eq!(ids, vec!["baram-word-count"]);
        for entry in &idx.plugins {
            assert!(
                entry
                    .download_url
                    .starts_with("https://sayinel.github.io/baram-plugins/plugins/"),
                "downloadUrl should point at the live registry: {}",
                entry.download_url
            );
            // ‼️ SHAPE ONLY — 64 zeros satisfy this, deliberately, because a seed may name a
            // release whose ZIP does not exist yet (§260 Phase 6 code review, M4).
            //
            // The hazard this comment used to describe as uncatchable — the placeholder
            // becoming PERMANENT — is now caught, and it had in fact happened: word-count
            // 2.0.0 shipped on 2026-07-30 and this file still carried all zeros three days
            // later, because the release workflow writes only the registry repo's index and a
            // maintainer pastes the real checksum here by hand. `scripts/validate-index.ts`
            // WARNS on an all-zero checksum every time it runs, which is now every
            // `npm run lint` — it found this on its first run. Still a warning rather than an
            // error, so seeding an unreleased entry stays possible.
            assert_eq!(entry.checksum.len(), 64, "checksum must be sha256 hex");
            assert!(entry.checksum.chars().all(|c| c.is_ascii_hexdigit()));
            // §260 Phase 6 — an entry without a tier is one the app refuses to install
            // (Phase 5 reads it as legacy), so a seed missing it would model a dead registry.
            assert_eq!(
                entry.trust.as_deref(),
                Some("sandboxed"),
                "{} must declare its tier",
                entry.id
            );
        }
    }

    /// §260 Phase 6 — `trust` must survive the round trip through this struct.
    ///
    /// THE DEFECT THIS PINS: `fetch_registry` deserializes the live index into
    /// `RegistryEntry` and Tauri re-serializes it to the frontend. `trust` was not a field,
    /// so serde dropped it silently — every entry reached the marketplace as `trust:
    /// undefined`, i.e. legacy, i.e. Install disabled. Publishing the field in `index.json`
    /// fixed nothing on its own. Asserting deserialization alone would NOT have caught it
    /// (unknown fields are ignored, so the old struct parsed the new JSON happily); it is
    /// the re-serialize half that carries the bug.
    #[test]
    fn registry_entry_carries_trust_back_out() {
        let json = r#"{"id":"p","name":"P","description":"d","version":"1.0.0",
        "author":"a","license":"MIT","downloadUrl":"https://example.test/p.zip",
        "checksum":"ab","capabilities":["events"],"trust":"sandboxed",
        "engines":{"baram":">=0.4.0"}}"#;
        let entry: RegistryEntry = serde_json::from_str(json).unwrap();
        assert_eq!(entry.trust.as_deref(), Some("sandboxed"));

        let back = serde_json::to_value(&entry).unwrap();
        assert_eq!(back["trust"], "sandboxed", "the frontend must see the tier");

        // A legacy entry stays legacy rather than acquiring a default tier: the key is
        // absent, not `null`, so `!entry.trust` in the frontend is the whole test.
        let legacy: RegistryEntry =
            serde_json::from_str(&json.replace(r#""trust":"sandboxed","#, "")).unwrap();
        assert_eq!(legacy.trust, None);
        assert!(
            serde_json::to_value(&legacy)
                .unwrap()
                .get("trust")
                .is_none(),
            "an absent tier must not be serialized as null"
        );
    }

    /// A `RegistryEntry` template with every field this struct requires.
    ///
    /// Built as a `Value` so a test can REMOVE a field, which is the mutation that matters
    /// here — a literal with one field edited proves nothing about the missing-field path.
    fn entry_json(id: &str) -> serde_json::Value {
        serde_json::json!({
            "id": id,
            "name": "P",
            "description": "d",
            "version": "1.0.0",
            "author": "a",
            "license": "MIT",
            "downloadUrl": "https://example.test/p.zip",
            "checksum": "ab",
            "capabilities": ["events"],
            "trust": "sandboxed",
            "engines": { "baram": ">=0.4.0" }
        })
    }

    /// THE DEFECT THIS PINS: one unreadable entry emptied the marketplace for everyone.
    ///
    /// `plugins` was a plain `Vec<RegistryEntry>`, so serde failed the WHOLE document on the
    /// first entry missing a required field — `fetch_registry` returned `Err`, and every
    /// user's Browse tab went blank until the registry operator noticed. The index is shared,
    /// so the cost of one contributor's typo was borne by all of them.
    #[test]
    fn registry_index_drops_only_the_unreadable_entry() {
        let mut broken = entry_json("broken");
        broken.as_object_mut().unwrap().remove("license");
        let doc = serde_json::json!({
            "plugins": [entry_json("first"), broken, entry_json("last")],
        });

        let idx: RegistryIndex = serde_json::from_value(doc).unwrap();

        // By ID, not by count. A comparator that dropped everything, or kept the broken entry
        // and dropped a good one, would satisfy `len() == 2`.
        let ids: Vec<&str> = idx.plugins.iter().map(|p| p.id.as_str()).collect();
        assert_eq!(ids, vec!["first", "last"]);
    }

    /// Collects every record the `log` facade emits, so a test can assert on log VOLUME.
    struct Capture(Mutex<Vec<String>>);

    impl log::Log for Capture {
        fn enabled(&self, _: &log::Metadata) -> bool {
            true
        }
        fn log(&self, record: &log::Record) {
            self.0.lock().unwrap().push(record.args().to_string());
        }
        fn flush(&self) {}
    }

    static CAPTURE: Capture = Capture(Mutex::new(Vec::new()));

    /// ‼️ The ONE global logger installation in this test binary.
    ///
    /// `log::set_boxed_logger` is process-wide and one-shot, so a second call anywhere in
    /// the lib tests fails. `logging::tests` deliberately never installs one — it drives
    /// `Box<dyn Log>` directly — precisely so this assertion, which needs the real
    /// `log::warn!` macro path, can have it. If this `expect` ever fires, some other test
    /// took the global slot and the two need to be reconciled, not worked around.
    /// Named for what it proves. It counts records, never bytes on disk, so it is not
    /// evidence that the log cannot be evicted — one line big enough would do that, and
    /// what stops it is `logging::MAX_LINE_BYTES`. The two bounds are separate
    /// properties and each needs its own test.
    #[test]
    fn the_number_of_named_registry_drops_is_bounded() {
        log::set_logger(&CAPTURE).expect("no other lib test may install a global logger");
        log::set_max_level(log::LevelFilter::Warn);

        // 500 entries that each fail on a missing field. Unbounded, this is one warning per
        // entry; the 4 MiB input cap allows ~380k of them, enough to overwrite a 2 MiB log
        // and both of its archives ~21 times over and take every real diagnostic with it.
        let junk: Vec<serde_json::Value> = (0..500)
            .map(|i| serde_json::json!({ "id": format!("junk-{i}") }))
            .collect();
        let doc = serde_json::json!({ "plugins": junk });

        let err = serde_json::from_value::<RegistryIndex>(doc).unwrap_err();
        assert!(
            err.to_string().contains("every one of the 500"),
            "an all-junk index is still a hard error: {err}"
        );

        // Count only what THIS test provoked. `CAPTURE` is process-global and
        // `set_max_level` above turns the facade on for the rest of the binary, so a
        // bare `records.len()` is coupled to every other test that reaches this same
        // `log::warn!` — three of them do. With zero headroom, that made a green run
        // depend on libtest sorting this name ahead of `registry_index_*`.
        let records = CAPTURE.0.lock().unwrap();
        let mine: Vec<&String> = records
            .iter()
            .filter(|r| r.contains("junk-") || r.contains("further unreadable"))
            .collect();
        assert!(
            mine.len() <= MAX_NAMED_DROPS + 1,
            "at most {MAX_NAMED_DROPS} named entries plus one summary, got {}",
            mine.len()
        );
        // Not just "few records": the summary has to account for the rest, or the bound
        // would be silence about 490 dropped entries.
        assert!(
            records.iter().any(|r| r.contains("490 further unreadable")),
            "the entries that were not named must still be counted: {records:?}"
        );
    }

    /// An absent `engines` costs the entry nothing, because it costs the app nothing.
    ///
    /// The frontend's floor gate reads a missing or unparseable range as "no opinion" and
    /// installs (`src/plugins/engines.ts`), so refusing to deserialize the entry would have
    /// been the one layer with a stronger view than the layer that decides. Absence must also
    /// survive re-serialization as ABSENCE — same argument as `trust` above: the frontend
    /// tests `engines?.baram`, and a `null` would reach it as a present-but-broken field.
    #[test]
    fn registry_entry_without_engines_keeps_the_entry() {
        let mut json = entry_json("no-floor");
        json.as_object_mut().unwrap().remove("engines");

        // Deliberately NOT `assert!(entry.engines.is_none())`. That reads on the field's
        // type, so reverting the field to a required `EngineRequirement` breaks this test at
        // COMPILE time — and a module that will not compile cannot demonstrate what its
        // assertions catch. Without that line the mutation runs, and what it produces is the
        // failure worth pinning: `from_value` returns Err, so at index level `tolerant_entries`
        // PRUNES the entry instead of raising anything. Absence is proved by the serialized
        // form below, which is the half the frontend actually reads.
        let entry: RegistryEntry = serde_json::from_value(json).unwrap();
        assert!(
            serde_json::to_value(&entry)
                .unwrap()
                .get("engines")
                .is_none(),
            "an absent floor must not be serialized as null"
        );

        // And the floor still round-trips when it IS declared — the tolerance must not have
        // been bought by dropping the field on the way back out (the `trust` defect, again).
        let declared: RegistryEntry = serde_json::from_value(entry_json("has-floor")).unwrap();
        assert_eq!(
            serde_json::to_value(&declared).unwrap()["engines"]["baram"],
            ">=0.4.0"
        );
    }

    /// The two changes MEET here, and the meeting point is where the silent loss would be.
    ///
    /// Per-entry tolerance is what makes a required `engines` dangerous rather than loud: if
    /// the field goes back to mandatory, nothing errors and nothing fails to compile — the
    /// entry is simply pruned on the way in, and a perfectly installable plugin disappears
    /// from every user's marketplace with a line in a log nobody reads. Asserted at INDEX
    /// level for exactly that reason; the entry-level test cannot see a pruning decision.
    #[test]
    fn registry_index_keeps_an_entry_that_declares_no_floor() {
        let mut no_floor = entry_json("no-floor");
        no_floor.as_object_mut().unwrap().remove("engines");
        let doc = serde_json::json!({ "plugins": [entry_json("has-floor"), no_floor] });

        let idx: RegistryIndex = serde_json::from_value(doc).unwrap();

        let ids: Vec<&str> = idx.plugins.iter().map(|p| p.id.as_str()).collect();
        assert_eq!(
            ids,
            vec!["has-floor", "no-floor"],
            "an entry that declares no floor is still installable, so it must still be listed"
        );
    }

    /// Keeps `scripts/validate-index.ts` honest about what this struct actually requires.
    ///
    /// That script's `REQUIRED_FIELDS` is a hand-copy of the fields below that carry no
    /// `#[serde(default)]`, and it is the list the publish gate refuses on. The dangerous
    /// drift is this struct growing a required field the script does not know about: the
    /// gate would pass an entry that `tolerant_entries` then silently prunes, which is
    /// precisely the invisible-plugin failure both were written to prevent. This entry holds
    /// EXACTLY the script's list, so that addition fails here.
    ///
    /// The reverse drift is deliberately not caught — a script asking for more than the
    /// struct needs costs a publish, not a user.
    #[test]
    fn registry_entry_minimal_required_fields_deserializes() {
        let minimal = serde_json::json!({
            "id": "m",
            "name": "M",
            "description": "d",
            "version": "1.0.0",
            "author": "a",
            "license": "MIT",
            "downloadUrl": "https://example.test/m.zip",
            "checksum": "ab",
            "capabilities": []
        });
        let entry = serde_json::from_value::<RegistryEntry>(minimal);
        assert!(
            entry.is_ok(),
            "a field became required without being added to REQUIRED_FIELDS in \
         scripts/validate-index.ts — entries missing it would be pruned, not reported: {:?}",
            entry.err()
        );
    }

    /// THE DEFECT THIS PINS (code review HIGH-1): tolerance that swallows TOTAL loss.
    ///
    /// Dropping bad entries makes "the whole document is unreadable" indistinguishable from
    /// "the registry is empty" — and the empty answer is the more dangerous one, because
    /// `fetchRegistryIndex` caches a successful result for 24 hours and only falls back to
    /// the stale cache on a throw. A schema mismatch would therefore replace every user's
    /// working listing with a silent empty Browse tab, for a day, with no error anywhere.
    #[test]
    fn registry_index_errors_when_no_entry_survives() {
        let doc = serde_json::json!({ "plugins": [{ "id": "a" }, { "id": "b" }] });
        let err = serde_json::from_value::<RegistryIndex>(doc).unwrap_err();
        // Names the count, so the message distinguishes this from a genuinely empty registry.
        assert!(
            err.to_string().contains("every one of the 2 entries"),
            "unexpected message: {err}"
        );

        // An index that is genuinely empty is NOT an error — nothing was lost.
        let empty: RegistryIndex =
            serde_json::from_value(serde_json::json!({ "plugins": [] })).unwrap();
        assert!(empty.plugins.is_empty());
        assert_eq!(empty.dropped_count, 0);
    }

    /// Partial loss is survivable but must not be silent, and the log alone cannot carry
    /// it: `src/logging` now gives `log::warn!` an implementation, but only the first
    /// `MAX_NAMED_DROPS` entries are named there, and a log file is not something the
    /// user sees. The count over the wire is what reaches them.
    #[test]
    fn registry_index_reports_how_many_entries_it_dropped() {
        let mut broken = entry_json("broken");
        broken.as_object_mut().unwrap().remove("license");
        let doc = serde_json::json!({ "plugins": [entry_json("kept"), broken] });

        let idx: RegistryIndex = serde_json::from_value(doc).unwrap();

        assert_eq!(idx.dropped_count, 1);
        let ids: Vec<&str> = idx.plugins.iter().map(|p| p.id.as_str()).collect();
        assert_eq!(ids, vec!["kept"]);
        assert_eq!(
            serde_json::to_value(&idx).unwrap()["droppedCount"],
            1,
            "the frontend is the only layer that can report this"
        );
    }

    /// `droppedCount` is a diagnostic this app produces, so the registry must not be able to
    /// assert one — the same rule `normalizeIndex` enforces for `demotedBecause`.
    #[test]
    fn registry_index_ignores_a_registry_supplied_dropped_count() {
        let doc = serde_json::json!({
            "plugins": [entry_json("fine")],
            "droppedCount": 99
        });
        let idx: RegistryIndex = serde_json::from_value(doc).unwrap();
        assert_eq!(idx.dropped_count, 0);
    }

    /// Backs the claim `scripts/validate-index.ts` makes in its own error text.
    ///
    /// That script tells the operator a wrong-typed field means the app "DROPS an entry it
    /// cannot deserialize". Worth pinning, because the intuition for the `#[serde(default)]`
    /// fields runs the other way — `default` looks like it should absorb anything. It does
    /// not: it applies only when the key is ABSENT. A key that is present with the wrong type
    /// is a hard deserialization error, so an optional field is every bit as fatal as a
    /// required one once someone actually writes it.
    #[test]
    fn a_wrong_typed_field_drops_the_entry_even_when_optional() {
        for (field, bad) in [
            ("license", serde_json::Value::Null),
            ("version", serde_json::json!(123)),
            ("name", serde_json::json!(["N"])),
            ("capabilities", serde_json::json!([1, 2])),
            // …and the `#[serde(default)]` ones, which is the counter-intuitive half.
            ("downloads", serde_json::json!("many")),
            ("keywords", serde_json::json!("word")),
            ("repository", serde_json::json!(5)),
            ("icon", serde_json::json!(true)),
            // ‼️ `downloads` is `u64`, and JS has ONE numeric type — so "is it a number?"
            // is not the same question on the two sides. Review round 3 found these three
            // still passing the publish gate after the presence-vs-type fix. It is also the
            // likeliest field to hold a computed value rather than a typed one: a rate
            // arrives as a float, "unknown" arrives as -1.
            ("downloads", serde_json::json!(1.5)),
            ("downloads", serde_json::json!(-1)),
            ("downloads", serde_json::json!(1e20)),
        ] {
            let mut json = entry_json("x");
            json.as_object_mut().unwrap().insert(field.into(), bad);
            assert!(
                serde_json::from_value::<RegistryEntry>(json).is_err(),
                "a wrong-typed `{field}` must fail to deserialize — validate-index.ts tells \
             operators it does"
            );
        }

        // The contrast that makes the point: OMITTING the same optional fields is fine.
        let mut json = entry_json("x");
        for field in ["downloads", "keywords", "repository", "icon"] {
            json.as_object_mut().unwrap().remove(field);
        }
        assert!(serde_json::from_value::<RegistryEntry>(json).is_ok());
    }

    /// Tolerance is per-ENTRY, not per-document. A payload with no `plugins` array is not a
    /// partly-broken index, and answering it with an empty marketplace would hide a registry
    /// that is serving the wrong file entirely.
    #[test]
    fn registry_index_without_plugins_array_is_an_error() {
        let err = serde_json::from_str::<RegistryIndex>(r#"{"updatedAt":"2026-01-01"}"#);
        assert!(err.is_err());
    }
}
