// §69 / #261 — bounded plugin archive extraction.
//
// `extract_zip_bytes` is the entry point `install.rs` calls to unpack a staged download; it is
// now a thin wrapper over the shared, dependency-free core in `crate::fs::archive` (also used
// by `fs::extract_zip` for Notion import). Every bound this file enforces lives in `limits.rs`.
use super::limits::{
    ALLOWED_COMPRESSION, MAX_ARCHIVE_ENTRIES, MAX_COMPRESSION_RATIO, MAX_ENTRY_BYTES,
    MAX_PATH_DEPTH, MAX_TOTAL_EXPANDED_BYTES, RATIO_FLOOR_BYTES,
};
use super::PluginError;
use std::path::Path;

/// Extract `data` into `output_dir`, bounded (#261).
///
/// ‼️ Every limit is checked against bytes THIS FUNCTION READ, never against `file.size()`
/// or `file.compressed_size()`. Those come out of the archive's own headers, so trusting
/// them to police the archive is asking the input whether it is allowed. A header may claim
/// 4 KiB and stream gigabytes; the `take` in `extract_zip_bounded` is what makes that claim
/// irrelevant.
///
/// Streams entry-by-entry into the output file rather than `read_to_end` into a `Vec`, so
/// the previous behaviour — an oversized entry exhausting memory before anything could
/// notice — is gone even for the bytes that are under the limit.
///
/// ‼️ THAT GUARANTEE COVERS OUR OWN READS AND NOTHING ELSE. Twice now it has been claimed
/// more broadly than it holds, so state it precisely:
///
/// - `Vec::with_capacity(file.size())` appears twice in zip 8.6.0's read path (`read.rs:417`,
///   `read/stream.rs:72`) and neither is reachable here — the first is inside
///   `ZipArchive::extract`, the second is the streaming reader. This function drives
///   `by_index` and its own loop.
/// - ‼️ But the DECOMPRESSOR is handed attacker numbers regardless. LZMA and PPMd build
///   themselves on the first `read` of an entry — inside the call `take` wraps — and size
///   their buffers from the payload, before any output byte exists for the ceilings to
///   count. No read cap can bound an allocation that precedes the first byte read. That is
///   why `ALLOWED_COMPRESSION` exists, and why it gates on the METHOD rather than on any
///   size: it stops such a decoder from being constructed at all.
///
/// So: do not "simplify" this to `archive.extract(dir)`. That call reintroduces the
/// declared-size allocation AND materialises symlink entries (`make_symlink`, `read.rs:419`)
/// — see `a_symlink_entry_becomes_a_regular_file` for why the second one matters.
pub(super) fn extract_zip_bytes(data: &[u8], output_dir: &Path) -> Result<(), PluginError> {
    extract_zip_bounded(data, output_dir, ExtractBounds::DEFAULT)
}

/// The limits `extract_zip_bounded` enforces.
///
/// A parameter rather than five constants read directly, so the tests can drive the same
/// code with kilobyte-sized limits. Asserting the real 256 MiB total would mean writing a
/// quarter of a gigabyte per run to prove arithmetic, and a test that slow gets skipped.
/// `ExtractBounds::DEFAULT` is what production uses, and one test still drives the real
/// constants end to end through the ratio limit, which a 2 MiB archive can reach.
#[derive(Clone, Copy)]
struct ExtractBounds {
    max_entries: usize,
    max_entry_bytes: u64,
    max_path_depth: usize,
    max_ratio: u64,
    max_total_bytes: u64,
    ratio_floor_bytes: u64,
}

impl ExtractBounds {
    const DEFAULT: Self = Self {
        max_entries: MAX_ARCHIVE_ENTRIES,
        max_entry_bytes: MAX_ENTRY_BYTES,
        max_path_depth: MAX_PATH_DEPTH,
        max_ratio: MAX_COMPRESSION_RATIO,
        max_total_bytes: MAX_TOTAL_EXPANDED_BYTES,
        ratio_floor_bytes: RATIO_FLOOR_BYTES,
    };
}

/// Maps the shared core's error back onto `PluginError`, so callers see exactly what they
/// did before this delegated to `crate::fs::archive` — `Refused` carries the same message
/// text the inline loop used to format itself (`kind` below is `"plugin archive"`, matching
/// the wording every in-file test still asserts on).
fn archive_error_to_plugin_error(e: crate::fs::archive::ArchiveError) -> PluginError {
    match e {
        crate::fs::archive::ArchiveError::Io(io) => PluginError::Io(io),
        crate::fs::archive::ArchiveError::Refused(msg) => PluginError::Refused(msg),
    }
}

fn extract_zip_bounded(
    data: &[u8],
    output_dir: &Path,
    bounds: ExtractBounds,
) -> Result<(), PluginError> {
    let cursor = std::io::Cursor::new(data);
    let mut archive = zip::ZipArchive::new(cursor)?;

    let core_bounds = crate::fs::archive::ExtractBounds {
        max_entries: bounds.max_entries,
        max_entry_bytes: bounds.max_entry_bytes,
        max_total_bytes: bounds.max_total_bytes,
        max_ratio: bounds.max_ratio,
        ratio_floor_bytes: bounds.ratio_floor_bytes,
        max_path_depth: bounds.max_path_depth,
        allowed_compression: &ALLOWED_COMPRESSION,
    };

    // First of OUR checks, and safe to read from the central directory: an archive claiming
    // fewer entries than it holds simply gets fewer extracted.
    //
    // ‼️ Not cheap in absolute terms, and nothing here can make it so (review M3):
    // `ZipArchive::new` above has already parsed every central-directory record into memory
    // before `archive.len()` exists, at roughly 251 resident bytes per 46-byte record — so a
    // 32 MiB download can hold ~175 MiB of parsed records before this line runs. Bounded by
    // the download cap and transient, but it is upstream of every limit below. Backlogged;
    // the only real fix is a streaming central-directory reader the `zip` crate does not
    // expose.
    crate::fs::archive::check_entry_count(archive.len(), &core_bounds, "plugin archive")
        .map_err(archive_error_to_plugin_error)?;

    let compressed_len = data.len() as u64;
    let mut total_written: u64 = 0;

    for i in 0..archive.len() {
        let mut file = archive.by_index(i)?;
        let Some(enclosed_name) = file.enclosed_name() else {
            continue; // skip invalid paths (path traversal protection)
        };
        let method = file.compression();
        let is_dir = file.is_dir();
        let depth = enclosed_name.components().count();
        let out_path = output_dir.join(&enclosed_name);
        let raw_name = file.name().to_string();

        // Remaining five defenses (method allowlist, path depth, per-entry/total/ratio caps)
        // and the actual bounded copy live in the shared core — see `crate::fs::archive` for
        // why each check runs where it does (method and depth BEFORE any `create_dir_all`,
        // the byte ceilings folded into a single capped read).
        let written = crate::fs::archive::extract_entry(
            &mut file,
            crate::fs::archive::EntryContext {
                method,
                is_dir,
                depth,
                raw_name: &raw_name,
                relative_path: &enclosed_name,
                out_path: &out_path,
                compressed_len,
                total_written,
            },
            &core_bounds,
            "plugin archive",
        )
        .map_err(archive_error_to_plugin_error)?;
        total_written += written;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::super::test_support::zip_of;
    use super::*;

    // ── #261 archive expansion bounds ────────────────────────────────────────────────
    //
    // The download cap (32 MiB) never bounded the extraction. DEFLATE tops out around
    // 1032:1, so that archive could expand to roughly 33 GB, and `read_to_end` into an
    // unbounded `Vec` meant memory went before disk did.

    /// Kilobyte-scale limits, so the arithmetic can be tested without writing a quarter of
    /// a gigabyte. `refuses_a_real_bomb_through_the_production_bounds` covers the shipped
    /// constants; these cover the branches.
    ///
    /// ‼️ The ratio has to be small (3:1) for a different reason than the others: at these
    /// sizes the ZIP container's own headers are a large fraction of the archive, so a
    /// realistic 10:1 is unreachable inside a 8 KiB total budget no matter how compressible
    /// the payload. The first draft of these tests set 10 and two of them silently could not
    /// trip the limit they were named after.
    fn tiny_bounds() -> ExtractBounds {
        ExtractBounds {
            max_entries: 4,
            max_entry_bytes: 4096,
            max_path_depth: 3,
            max_ratio: 3,
            max_total_bytes: 8192,
            ratio_floor_bytes: 2000,
        }
    }

    /// Rewrites the compression-method field of every header in `data`.
    ///
    /// The method lives at offset 8 of a local file header (`PK\x03\x04`) and offset 10 of a
    /// central-directory header (`PK\x01\x02`); both must agree or the reader disagrees with
    /// itself. Lets a test produce an archive claiming a codec this build does not compile,
    /// which is exactly what the allowlist has to refuse.
    fn with_compression_method(mut data: Vec<u8>, method: u16) -> Vec<u8> {
        let bytes = method.to_le_bytes();
        let mut patched = 0;
        for i in 0..data.len().saturating_sub(4) {
            let offset = match &data[i..i + 4] {
                b"PK\x03\x04" => 8,
                b"PK\x01\x02" => 10,
                _ => continue,
            };
            if i + offset + 2 <= data.len() {
                data[i + offset..i + offset + 2].copy_from_slice(&bytes);
                patched += 1;
            }
        }
        // One local header + one central-directory header for a single-entry archive. Without
        // this the test could pass while patching nothing, which is the hollow-guard shape.
        assert_eq!(patched, 2, "expected to patch both headers");
        data
    }

    /// Bytes deflate cannot shrink, so the ratio limit stays out of the way.
    ///
    /// The total- and per-file-limit tests need this: zeros compress so well that the RATIO
    /// refusal fires first and the test passes while proving the wrong thing.
    fn incompressible(n: usize) -> Vec<u8> {
        let mut x: u32 = 0x1234_5678;
        (0..n)
            .map(|_| {
                x ^= x << 13;
                x ^= x >> 17;
                x ^= x << 5;
                (x & 0xff) as u8
            })
            .collect()
    }

    #[test]
    fn extracts_a_normal_archive_unchanged() {
        // The control. Every refusal below is only meaningful if the ordinary case still
        // works, byte for byte.
        let data = zip_of(&[
            ("baram-plugin.json", b"{}"),
            ("dist/index.mjs", b"export {}"),
        ]);
        let dir = tempfile::tempdir().unwrap();
        extract_zip_bounded(&data, dir.path(), tiny_bounds()).unwrap();
        assert_eq!(
            std::fs::read_to_string(dir.path().join("dist/index.mjs")).unwrap(),
            "export {}"
        );
    }

    #[test]
    fn refuses_more_entries_than_the_limit() {
        let names: Vec<String> = (0..5).map(|i| format!("f{i}.txt")).collect();
        let entries: Vec<(&str, &[u8])> =
            names.iter().map(|n| (n.as_str(), b"x" as &[u8])).collect();
        let dir = tempfile::tempdir().unwrap();

        let err = extract_zip_bounded(&zip_of(&entries), dir.path(), tiny_bounds()).unwrap_err();

        // Names the limit, not just "refused" — five different bounds live in this function
        // and "it errored" would not tell them apart.
        assert!(err.to_string().contains("over the 4 limit"), "{err}");
    }

    #[test]
    fn refuses_an_entry_over_the_per_file_limit() {
        let dir = tempfile::tempdir().unwrap();
        let data = zip_of(&[("big.bin", &incompressible(5000))]);

        let err = extract_zip_bounded(&data, dir.path(), tiny_bounds()).unwrap_err();

        assert!(err.to_string().contains("per-file limit"), "{err}");
    }

    #[test]
    fn refuses_an_archive_over_the_total_limit() {
        // Each entry is under the 4096 per-file limit; together they pass 8192. The
        // distinction matters because the message tells the operator which limit to raise.
        let body = incompressible(3000);
        let dir = tempfile::tempdir().unwrap();
        let data = zip_of(&[("a", &body), ("b", &body), ("c", &body)]);

        let err = extract_zip_bounded(&data, dir.path(), tiny_bounds()).unwrap_err();

        assert!(err.to_string().contains("total limit"), "{err}");
        assert!(
            !err.to_string().contains("per-file"),
            "the total is what bound this, and the message must say so: {err}"
        );
    }

    #[test]
    fn does_not_apply_the_ratio_below_its_floor() {
        // Compressible enough to blow past 3:1, but under the 2000-byte floor — where the
        // ratio is a statistic computed on too little output to mean anything. Refusing here
        // would reject ordinary small archives of text.
        let dir = tempfile::tempdir().unwrap();
        let expanded = 1500;
        let data = zip_of(&[("small.txt", &vec![0u8; expanded])]);
        let bounds = tiny_bounds();
        assert!(
            expanded as u64 > data.len() as u64 * bounds.max_ratio,
            "the fixture must exceed the ratio, or the floor is not what let it through: \
         {expanded} expanded from {} on the wire",
            data.len()
        );
        assert!((expanded as u64) < bounds.ratio_floor_bytes);

        extract_zip_bounded(&data, dir.path(), bounds).unwrap();
    }

    #[test]
    fn refuses_a_high_ratio_archive_once_past_the_floor() {
        let dir = tempfile::tempdir().unwrap();
        // Two entries of zeros: together they clear the 2000-byte floor and pass 3:1, while
        // each stays under the per-file limit and the pair stays under the total.
        let data = zip_of(&[("a.bin", &vec![0u8; 1500]), ("b.bin", &vec![0u8; 1500])]);

        let err = extract_zip_bounded(&data, dir.path(), tiny_bounds()).unwrap_err();

        // Names the computed ALLOWANCE, not the bare ratio: `max(wire × ratio, floor)`
        // means the ratio is often not the binding number, and a message that says otherwise
        // sends the operator to the wrong arithmetic (review round 2).
        assert!(err.to_string().contains("bytes allowed for its"), "{err}");
    }

    /// Total bytes sitting under `dir` after a refusal.
    fn bytes_on_disk(dir: &Path) -> u64 {
        fn walk(dir: &Path, total: &mut u64) {
            let Ok(entries) = std::fs::read_dir(dir) else {
                return;
            };
            for entry in entries.flatten() {
                let path = entry.path();
                if path.is_dir() {
                    walk(&path, total);
                } else if let Ok(meta) = entry.metadata() {
                    *total += meta.len();
                }
            }
        }
        let mut total = 0;
        walk(dir, &mut total);
        total
    }

    /// THE DEFECT THIS PINS (review M1): the ratio limit bounded what SURVIVED, not what the
    /// archive could make us write.
    ///
    /// Measured before the fix: a 64 KiB archive holding one 64 MiB entry cleared the
    /// per-file and total ceilings, put all 64 MiB on disk, and only then hit the "100:1"
    /// refusal — 1027:1 of transient amplification against a documented 100:1. Asserting the
    /// message alone could not see it; the refusal fired either way. This asserts the BYTES.
    #[test]
    fn a_bomb_is_refused_before_it_can_fill_the_disk() {
        let dir = tempfile::tempdir().unwrap();
        let data = zip_of(&[("bomb.bin", &vec![0u8; 64 * 1024 * 1024])]);
        let wire = data.len() as u64;

        let err = extract_zip_bytes(&data, dir.path()).unwrap_err();
        // The mirror of the test above: this fixture is RATIO-bound (64 KiB × 100 clears
        // the floor), so here the ratio genuinely is the enforced number.
        let allowance = (wire * MAX_COMPRESSION_RATIO).max(RATIO_FLOOR_BYTES);
        assert_eq!(
            allowance,
            wire * MAX_COMPRESSION_RATIO,
            "fixture must be ratio-bound"
        );
        assert!(
            err.to_string()
                .contains(&format!("{allowance} bytes allowed")),
            "{err}"
        );

        // The allowance is `max(wire × 100, 1 MiB)`, and one byte over it is what triggers
        // the refusal — so anything materially past that means the cap is not in the read.
        let written = bytes_on_disk(dir.path());
        let allowance = (wire * MAX_COMPRESSION_RATIO).max(RATIO_FLOOR_BYTES);
        assert!(
        written <= allowance + 1,
        "{written} bytes reached disk from a {wire} byte archive; the {MAX_COMPRESSION_RATIO}:1 \
         ratio allows {allowance}"
    );
    }

    /// The shipped constants, end to end — the others drive injected limits.
    ///
    /// Reachable cheaply only through the ratio: 2 MiB of zeros deflates to a couple of
    /// kilobytes, which clears the 1 MiB floor at roughly 1000:1 while staying far under
    /// the 64 MiB per-file and 256 MiB total ceilings. Those two are covered above with
    /// injected bounds precisely so this test does not have to write 256 MiB.
    #[test]
    fn refuses_a_real_bomb_through_the_production_bounds() {
        let dir = tempfile::tempdir().unwrap();
        let data = zip_of(&[("bomb.bin", &vec![0u8; 2 * 1024 * 1024])]);
        assert!(
            data.len() < 64 * 1024,
            "the fixture must actually be a bomb: {} bytes on the wire",
            data.len()
        );

        let err = extract_zip_bytes(&data, dir.path()).unwrap_err();

        // ‼️ This fixture is FLOOR-bound, not ratio-bound: 2 KiB on the wire × 100 is well
        // under 1 MiB, so the allowance is the floor and the ratio actually enforced is
        // ~476:1. The message must say 1048576, not "100:1" — this assertion is the one that
        // would have caught it claiming the latter.
        let allowance = (data.len() as u64 * MAX_COMPRESSION_RATIO).max(RATIO_FLOOR_BYTES);
        assert_eq!(
            allowance, RATIO_FLOOR_BYTES,
            "fixture must be floor-bound to be the point"
        );
        assert!(
            err.to_string()
                .contains(&format!("{allowance} bytes allowed")),
            "{err}"
        );
    }

    // ── At the boundary ──────────────────────────────────────────────────────────────
    //
    // ‼️ Every fixture above sits comfortably on one side of its limit, so `>` → `>=` on any
    // of these comparisons is invisible: a mutation that spuriously refuses an entry of
    // EXACTLY the ceiling passes the whole suite. Ten mutations were run on the first draft
    // and every one was a removal — the same blind spot as [[mutation-removal-vs-substitution]],
    // recurring in the phase that recorded it. These three fixtures land on the value.

    #[test]
    fn admits_an_entry_of_exactly_the_per_file_limit() {
        let bounds = tiny_bounds();
        let dir = tempfile::tempdir().unwrap();
        let data = zip_of(&[(
            "exact.bin",
            &incompressible(bounds.max_entry_bytes as usize),
        )]);

        extract_zip_bounded(&data, dir.path(), bounds).expect("exactly the limit is legal");
    }

    #[test]
    fn admits_an_archive_of_exactly_the_total_limit() {
        let bounds = tiny_bounds();
        let half = (bounds.max_total_bytes / 2) as usize;
        let dir = tempfile::tempdir().unwrap();
        let data = zip_of(&[("a", &incompressible(half)), ("b", &incompressible(half))]);

        extract_zip_bounded(&data, dir.path(), bounds).expect("exactly the limit is legal");
    }

    #[test]
    fn admits_exactly_the_entry_count_limit() {
        let bounds = tiny_bounds();
        let names: Vec<String> = (0..bounds.max_entries).map(|i| format!("f{i}")).collect();
        let entries: Vec<(&str, &[u8])> =
            names.iter().map(|n| (n.as_str(), b"x" as &[u8])).collect();
        let dir = tempfile::tempdir().unwrap();

        extract_zip_bounded(&zip_of(&entries), dir.path(), bounds)
            .expect("exactly the limit is legal");
    }

    /// THE DEFECT THIS PINS (§69 security review, HIGH): a decoder that allocates from a
    /// number in the archive, before any byte the ceilings can count.
    ///
    /// `zip = "8"` compiles LZMA, PPMd, zstd, xz and bzip2 by default. LZMA builds its
    /// decoder on the FIRST READ — inside the very `read` that `take` wraps — and sizes its
    /// dictionary from the payload, clamped only to ~4 GiB. Measured: a 114-byte archive
    /// drove a single 512 MiB allocation through `take(64 MiB + 1)`, and a failed
    /// `alloc_zeroed` aborts rather than unwinding, so `spawn_blocking` cannot even report
    /// it. Every byte bound in this module is downstream of that.
    ///
    /// ‼️ Built by BYTE-PATCHING a Deflated archive to method 14, not by asking the writer.
    ///
    /// `CompressionMethod`'s variants are feature-gated, so once `lzma` is not compiled the
    /// name does not exist to write with — and the earlier version of this test, which used
    /// `Bzip2`, stopped compiling the moment the decoders were removed. Patching the header
    /// is also the better test: it produces the shape an attacker actually sends, and it
    /// keeps working whichever codecs are enabled. The refusal must come from
    /// `ALLOWED_COMPRESSION`, not from the crate happening to lack a decoder.
    #[test]
    fn refuses_a_compression_method_outside_the_allowlist() {
        const LZMA: u16 = 14;
        let data = with_compression_method(zip_of(&[("payload.bin", b"harmless content")]), LZMA);
        let dir = tempfile::tempdir().unwrap();

        let err = extract_zip_bounded(&data, dir.path(), tiny_bounds()).unwrap_err();

        assert!(err.to_string().contains("compression method"), "{err}");
        // ‼️ Refused before the entry was touched. If the check ran after the first read the
        // decoder would already have been constructed, which is the whole exposure.
        assert!(
            !dir.path().join("payload.bin").exists(),
            "the entry must be refused before anything is created for it"
        );
    }

    #[test]
    fn admits_both_allowed_compression_methods() {
        // The allowlist must not break what the release pipeline actually produces: `zip -r`
        // emits Deflated, and Stored covers entries too small to gain from compression.
        use std::io::Write;
        for method in ALLOWED_COMPRESSION {
            let mut buf = std::io::Cursor::new(Vec::<u8>::new());
            {
                let mut writer = zip::write::ZipWriter::new(&mut buf);
                let opts = zip::write::SimpleFileOptions::default().compression_method(method);
                writer.start_file("a.txt", opts).unwrap();
                writer.write_all(b"content").unwrap();
                writer.finish().unwrap();
            }
            let dir = tempfile::tempdir().unwrap();

            extract_zip_bounded(&buf.into_inner(), dir.path(), tiny_bounds())
                .unwrap_or_else(|e| panic!("{method} must be accepted: {e}"));

            assert_eq!(
                std::fs::read_to_string(dir.path().join("a.txt")).unwrap(),
                "content"
            );
        }
    }

    /// ‼️ A symlink entry must not become a symlink.
    ///
    /// ZIP can carry them, and the `zip` crate's own `ZipArchive::extract` materialises them
    /// (`make_symlink`, zip-8.6.0 `read.rs:419`). This loop never consults `is_symlink()`, so
    /// such an entry takes the ordinary file path and its CONTENT — the target string — is
    /// written as text. Nothing links anywhere.
    ///
    /// ‼️ #261 made this matter MORE, not less. The staged tree used to be COPIED into place,
    /// and `copy_dir_recursive` would have dereferenced a link on the way; it is now
    /// `rename`d, which preserves one verbatim into the installed tree for the loader — or
    /// any later copy — to follow. Either way the defence is the same and it is upstream of
    /// both: no link is ever created.
    ///
    /// That safety is currently a consequence of what this loop does NOT do, which is
    /// exactly the kind of property a refactor toward the crate's `extract()` would delete
    /// silently. `enclosed_name` would not save us there: it constrains the entry's own path,
    /// not where a link it creates may point.
    #[test]
    fn a_symlink_entry_becomes_a_regular_file() {
        let mut buf = std::io::Cursor::new(Vec::<u8>::new());
        {
            let mut writer = zip::write::ZipWriter::new(&mut buf);
            writer
                .add_symlink(
                    "escape",
                    "../../../../etc/passwd",
                    zip::write::SimpleFileOptions::default(),
                )
                .unwrap();
            writer.finish().unwrap();
        }
        let dir = tempfile::tempdir().unwrap();

        extract_zip_bounded(&buf.into_inner(), dir.path(), tiny_bounds()).unwrap();

        let made = dir.path().join("escape");
        // `symlink_metadata` does not follow, so this sees what was actually created.
        let kind = std::fs::symlink_metadata(&made).unwrap().file_type();
        assert!(
            !kind.is_symlink(),
            "a symlink entry was materialised as a link; the swap would rename it straight \
         into the installed tree"
        );
        assert_eq!(
            std::fs::read_to_string(&made).unwrap(),
            "../../../../etc/passwd",
            "the target should have landed as inert text"
        );
    }

    #[test]
    fn refuses_a_path_deeper_than_the_limit() {
        // Directories are free to the byte ceilings — an entry's parents contribute no
        // expanded bytes — so depth is the one dimension they cannot bound (review M2).
        let dir = tempfile::tempdir().unwrap();
        let deep = "a/b/c/d/e/f.txt";
        let data = zip_of(&[(deep, b"x")]);

        let err = extract_zip_bounded(&data, dir.path(), tiny_bounds()).unwrap_err();

        assert!(err.to_string().contains("path components"), "{err}");
        assert!(
            !dir.path().join("a").exists(),
            "the depth check must run BEFORE create_dir_all, or it charges nothing"
        );
    }

    #[test]
    fn admits_a_path_at_the_depth_limit() {
        // `dist/chunks/x.mjs` is depth 3 and must keep working; the production limit is 16.
        let dir = tempfile::tempdir().unwrap();
        let data = zip_of(&[("a/b/c.txt", b"x")]);

        extract_zip_bounded(&data, dir.path(), tiny_bounds()).unwrap();

        assert_eq!(
            std::fs::read_to_string(dir.path().join("a/b/c.txt")).unwrap(),
            "x"
        );
    }

    /// ‼️ The bounds must never be computed from what the archive says about itself.
    ///
    /// `file.size()` and `file.compressed_size()` are read out of the archive's own headers,
    /// so a check against them asks the attacker whether the attack is allowed: a header can
    /// claim 4 KiB and the stream can deliver gigabytes. The code reads through `take`
    /// instead, and this asserts it stays that way — the plausible regression is someone
    /// adding a "fast path" that skips an entry whose declared size looks small.
    ///
    /// Windowed to the function body and asserting ABSENCE, so it cannot pass by matching
    /// something elsewhere in the file.
    #[test]
    fn extraction_never_consults_the_declared_size() {
        // #D6 moved the bounded copy itself into `crate::fs::archive::extract_entry`, shared
        // with `fs::extract_zip` (Notion import) — `extract_zip_bounded` above is now a thin
        // wrapper that delegates to it, so this pin follows the real implementation there
        // rather than scanning a wrapper that no longer contains the read it is pinning.
        const SOURCE: &str = include_str!("../fs/archive.rs");
        let start = SOURCE
            .find("fn extract_entry<")
            .expect("the function must still exist under this name");
        let body = &SOURCE[start..];
        let end = body.find("\n}\n").expect("the function must end");
        let body = &body[..end];

        // ‼️ A positive anchor FIRST. The window ends at the next column-0 `}`, so a future
        // edit that shortens the function — or a rename — leaves an absence assertion that
        // passes over nothing at all (review L4). This line fails loudly instead.
        assert!(
            body.contains("take(cap + 1)"),
            "the window no longer contains the bounded read, so the absence checks below \
         would be vacuous"
        );
        for header_field in [".size()", ".compressed_size()"] {
            assert!(
                !body.contains(header_field),
                "extract_zip_bounded reads `{header_field}` from the archive header — the \
             bounds must be enforced on bytes actually read"
            );
        }

        // §D6 security review, MINOR — the check above only ever looks at the shared
        // core, so a "fast path" added to THIS wrapper that consults the declared size
        // before ever calling `extract_entry` would bypass it invisibly. Window on the
        // wrapper itself, in this same file (it moved here with `extract_zip_bounded` when
        // the plugin module was split out of `mod.rs`), to close that gap.
        const WRAPPER_SOURCE: &str = include_str!("archive.rs");
        let wrapper_start = WRAPPER_SOURCE
            .find("fn extract_zip_bounded(")
            .expect("the wrapper must still exist under this name");
        let wrapper_body = &WRAPPER_SOURCE[wrapper_start..];
        let wrapper_end = wrapper_body.find("\n}\n").expect("the wrapper must end");
        let wrapper_body = &wrapper_body[..wrapper_end];

        assert!(
            wrapper_body.contains("total_written += written;"),
            "the window no longer reaches the end of extract_zip_bounded, so the absence \
         checks below would be vacuous"
        );
        for header_field in [".size()", ".compressed_size()"] {
            assert!(
                !wrapper_body.contains(header_field),
                "extract_zip_bounded's own body reads `{header_field}` before delegating \
             to the shared core — a declared-size precheck here would bypass it entirely"
            );
        }
    }
}
