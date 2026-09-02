//! §324-e Read a media file that lives OUTSIDE the vault, as a `data:` URL.
//!
//! ‼️ WHY THIS COMMAND EXISTS AT ALL. A Quick Capture is not a file yet — no path,
//! no base directory, and the user may never press Save — so nothing it holds may
//! reach the disk before then. An OS drag hands the frontend a **vault-external
//! disk path**, not bytes, and there was no way to turn one into anything the
//! capture editor could paint *without making the app do something worse*:
//! `read_file` is vault-confined and returns `String`, and the `asset:` scope is
//! granted per registered context, so a `~/Desktop/x.png` belongs to none of them
//! **as things stand**.
//!
//! ‼️ That last clause used to read as "there is no way", which overstated it.
//! `add_context({type: "File", path})` grants `allow_directory` on the file's
//! PARENT (`context_cmd.rs`), and the CSP's `img-src` permits `asset:` — so a
//! stray context could be registered to paint one dropped image. This command is
//! better DESIGN, not the only possibility: registering a context (which joins the
//! context list, is persisted, and hands the whole parent directory to the asset
//! protocol) in order to show a picture the user has not saved yet is a worse
//! trade than reading the bytes once. Preference, argued — not necessity.
//!
//! Without one of the two, a dropped image had to be copied to its final
//! destination immediately, which is the defect.
//!
//! ‼️ WHY IT DOES NOT WIDEN THE HOST TIER. The Host webview can already read any
//! external file's bytes today, in three steps: `import_file(external, vault/tmp)`
//! — whose SOURCE is deliberately vault-external (`fs_cmd::import_file`) — then
//! `fetch(convertFileSrc(vault/tmp))`, then delete. Step two is not hypothetical:
//! `utils/export/export-html-media.ts:204` and `components/plugins/plugin-readme.ts:32`
//! already fetch asset URLs for their bytes. This collapses those three steps into
//! one and is *cleaner* than the workaround, which writes into the user's vault,
//! wakes the file watcher, and leaves debris if the app dies mid-way.
//!
//! ‼️ WHAT KEEPS THAT ARGUMENT TRUE — read before changing anything here:
//!
//! 1. **Host tier only.** It is granted in `capabilities/default.json` (windows
//!    `main` and `file-*`) and must NEVER appear in `plugin-sandbox.json`.
//!    `tests/acl_lockdown.rs::sandbox_tier_grants_exactly_its_allowlist` pins the
//!    sandbox tier to exactly three permissions; if adding something here makes
//!    that test fail, the boundary has leaked — fix the leak, never the test.
//! 2. **Not reachable through the plugin broker.** `plugin_call` dispatches a
//!    CLOSED enum (`plugin::PluginOp`), so a `#[tauri::command]` cannot become an
//!    op merely by existing, and `authorizer.rs`'s own
//!    `required_capability_mapping_is_exhaustive_and_not_cross_wired` keeps every
//!    variant audited. The remaining door — someone calling this from inside an
//!    existing op's body — is shut by
//!    `acl_lockdown.rs::the_unconfined_media_reader_is_not_reachable_from_the_broker`.
//! 3. **Media extensions only, REGULAR FILES only, and capped.** The command's
//!    legitimacy comes entirely from being narrow, and narrowness needs BOTH
//!    halves. The allowlist and the MIME table are the SAME table on purpose: two
//!    tables could disagree about what is media, and the disagreement would be
//!    silent.
//!
//!    ‼️ The extension check alone was NOT enough, and this is not hypothetical.
//!    Because the MIME comes from the PATH's extension and never from the file's
//!    content, an admitted name is the whole of the decision — so while `metadata`
//!    and `read` still followed symlinks, `~/Desktop/cat.png -> ~/.ssh/id_rsa`
//!    returned `data:image/png;base64,<the private key>`, which the frontend
//!    already ships a decoder for. Measured, not argued: the call returned
//!    `Ok("data:image/png;base64,U0VDUkVULVBSSVZBVEUtS0VZ")`.
//!
//!    `read_media_data_url` therefore requires `symlink_metadata(..).is_file()`
//!    before it reads anything. `refuses_everything_that_is_not_media` only tests
//!    `media_mime`, which never touches the disk — so
//!    `the_refusal_list_holds_through_a_symlink_too` re-runs that same list the way
//!    an attacker would reach it, end to end through the real function.

use std::path::Path;

use base64::Engine as _;

/// The largest file that may be inlined as a `data:` URL, in bytes (25 MiB).
///
/// ‼️ PER FILE. It bounds what any ONE file contributes, not what the webview
/// holds: this function is called once per file and knows nothing about the
/// others, so twenty 24 MiB files each pass it. The total is bounded separately by
/// `MAX_PENDING_MEDIA_BYTES` (`src/utils/media-data-url.ts`), which measures what
/// the DOCUMENT is already holding and so cannot be evaded by dropping twice.
///
/// This comment used to claim it bounded webview memory on its own. It did not,
/// and the aggregate guard was added rather than the sentence softened.
///
/// The bytes cross as base64 (×4/3) and are then held twice: once in a ProseMirror
/// node attribute and once as an `<img src>`/`<video src>` DOM attribute, until the
/// user saves or cancels. 25 MiB in is ~34 MiB of base64 out.
///
/// Chosen against the actual use case rather than a round number: the largest still
/// image a desktop OS realistically produces is an uncompressed full-screen PNG on a
/// 6K display, around 20 MiB, and a 48MP phone photo is well under half that. So no
/// screenshot or photo — the thing people actually drop into a capture — ever meets
/// this limit, and there is headroom above the worst realistic case.
///
/// ‼️ ONE CAP FOR IMAGES AND VIDEO, deliberately. The constraint being defended is
/// bytes held in the webview, and that does not care what the bytes decode to: a
/// 5 MiB clip is cheaper than a 20 MiB screenshot. A video-specific refusal would
/// reject cheap videos while admitting expensive images — a rule that does not track
/// the cost it exists to bound. A short clip that fits works end to end (the video
/// NodeView passes `data:` URLs straight through); a long one is refused *with a
/// message that names the limit*, never silently.
pub const MAX_INLINE_MEDIA_BYTES: u64 = 25 * 1024 * 1024;

/// Extension → MIME. **This is the allowlist**: an extension absent from this table
/// is not media, and the read is refused.
///
/// ‼️ The set must match the frontend's canonical media enumeration —
/// `IMAGE_EXTENSIONS` (`src/utils/path-utils.ts`) ∪ the video extensions in
/// `src/utils/media-src.ts`, which `isMediaFilePath` unions. The two live in
/// different languages, so they are kept honest by a scan rather than by hope:
/// `scripts/rust-constants.ts::inlineMediaExtensions` reads THIS table out of this
/// file and `src/utils/__tests__/media-extension-parity.test.ts` asserts the two
/// sets are equal. That is the same drift-guard shape §69 already uses for the
/// revocation key and byte cap — this repo has been bitten by extension lists
/// drifting apart before.
const MEDIA_MIME_TYPES: &[(&str, &str)] = &[
    ("avif", "image/avif"),
    ("bmp", "image/bmp"),
    ("gif", "image/gif"),
    ("ico", "image/x-icon"),
    ("jpeg", "image/jpeg"),
    ("jpg", "image/jpeg"),
    ("m4v", "video/x-m4v"),
    ("mov", "video/quicktime"),
    ("mp4", "video/mp4"),
    ("ogv", "video/ogg"),
    ("png", "image/png"),
    ("svg", "image/svg+xml"),
    ("webm", "video/webm"),
    ("webp", "image/webp"),
];

/// Read `path` and return a complete `data:<mime>;base64,<payload>` URL.
///
/// ‼️ Returns the finished URL as a `String` rather than `Vec<u8>`, and that is a
/// size decision, not a style one. Tauri serializes `Vec<u8>` as a JSON array of
/// decimal numbers — `[104,105,…]`, roughly four bytes of JSON per byte of file —
/// so a 25 MiB read would cross the IPC boundary as ~100 MB of JSON to parse.
/// Base64 is ~1.33 bytes per byte and its alphabet needs no JSON escaping.
///
/// Assembling the URL here rather than in TS also keeps the MIME beside the
/// allowlist that admitted the extension, so the caller cannot pair a permitted
/// extension with a MIME of its own choosing.
pub async fn read_media_data_url(path: &str, cap: u64) -> Result<String, String> {
    let mime = media_mime(path).ok_or_else(|| format!("not a media file: {}", label(path)))?;

    // ‼️ `symlink_metadata`, NOT `metadata`, and then REQUIRE A REGULAR FILE. This
    // single check closes three holes, and the first of them made this command a
    // general-purpose file reader:
    //
    //  - **Symlink traversal.** `metadata` and `read` both FOLLOW links, so
    //    `~/Desktop/cat.png -> ~/.ssh/id_rsa` passed the extension check and was
    //    read through. Verified before the fix: the call returned
    //    `Ok("data:image/png;base64,U0VDUkVULVBSSVZBVEUtS0VZ")`. Nothing
    //    downstream could notice, because the MIME comes from the PATH's
    //    extension and never from the bytes (`media_mime`) — so the allowlist is
    //    the ONLY thing narrowing this command, and a hole in it is total.
    //  - **FIFOs.** `read` on a FIFO with no writer blocks forever, holding a
    //    tokio blocking thread. Demonstrated by accident: adding the FIFO test
    //    before this fix hung the whole `cargo test` run until it was killed.
    //  - **Device files.** `/dev/zero` named `.png` has `len() == 0`, so the cap
    //    waves it through and `read` allocates until the process dies.
    //
    // ‼️ What this does NOT close, stated rather than implied: the path could be
    // swapped between this stat and the `read` below (TOCTOU). Closing that needs
    // one `O_NOFOLLOW` open plus an fstat on the handle. It is left open because
    // it requires an attacker who can already write to the filesystem the user is
    // dragging from — who can read the file directly anyway — whereas the symlink
    // hole above was reachable by a compromised webview alone. `metadata`-then-
    // `read` has the same window everywhere else in this codebase
    // (`plugin::read_text_capped`).
    let meta = tokio::fs::symlink_metadata(path)
        .await
        .map_err(|e| format!("cannot be measured: {e}"))?;
    if !meta.file_type().is_file() {
        return Err(format!("not a regular file: {}", label(path)));
    }

    // Measure before reading, exactly as `plugin::read_text_capped` does: the cost of
    // refusing must not scale with the size of the thing being refused.
    let size = meta.len();
    if size > cap {
        // The caller turns this into the user-visible "too large" message, so the
        // numbers have to be in it — a refusal that does not say how big is too big
        // is the silent failure this whole change exists to remove.
        return Err(format!("TOO_LARGE:{size}:{cap}"));
    }

    let bytes = tokio::fs::read(path)
        .await
        .map_err(|e| format!("could not be read: {e}"))?;

    Ok(format!(
        "data:{mime};base64,{}",
        base64::engine::general_purpose::STANDARD.encode(&bytes)
    ))
}

/// The basename for a user-facing refusal — never the whole path, which can carry
/// directories the user did not ask us to echo back.
fn label(path: &str) -> String {
    Path::new(path)
        .file_name()
        .map_or_else(|| path.to_string(), |n| n.to_string_lossy().into_owned())
}

/// The MIME for `path`'s extension, or `None` when the extension is not in the
/// allowlist above. Case-insensitive: macOS hands over `IMG_0001.PNG` verbatim.
fn media_mime(path: &str) -> Option<&'static str> {
    let ext = Path::new(path).extension()?.to_str()?.to_ascii_lowercase();
    MEDIA_MIME_TYPES
        .iter()
        .find(|(name, _)| *name == ext)
        .map(|(_, mime)| *mime)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn admits_every_allowlisted_extension_case_insensitively() {
        for (ext, mime) in MEDIA_MIME_TYPES {
            assert_eq!(media_mime(&format!("/a/b.{ext}")), Some(*mime));
            assert_eq!(
                media_mime(&format!("/a/b.{}", ext.to_uppercase())),
                Some(*mime),
                "macOS hands filenames over verbatim, so `.PNG` must be admitted"
            );
        }
    }

    /// ‼️ The whole justification for an unconfined read is that it can only ever
    /// return media. These are the files it must never open.
    #[test]
    fn refuses_everything_that_is_not_media() {
        for path in [
            "/Users/me/.ssh/id_rsa",
            "/etc/passwd",
            "/Users/me/notes/secret.md",
            "/Users/me/Library/Keychains/login.keychain-db",
            "/Users/me/wallet.json",
            "/Users/me/archive.zip",
            "/Users/me/report.pdf",
            // No extension at all — `extension()` is None, not "".
            "/Users/me/id_rsa",
            // A directory-looking path, and a dotfile whose "extension" is the name.
            "/Users/me/Desktop",
            "/Users/me/.bashrc",
        ] {
            assert_eq!(media_mime(path), None, "must refuse {path}");
        }
    }

    /// A media extension buried mid-path must not admit the file — only the real
    /// extension counts. `/a/b.png/secret` is a file named `secret`.
    #[test]
    fn only_the_final_extension_counts() {
        assert_eq!(media_mime("/a/b.png/secret"), None);
        assert_eq!(media_mime("/a/b.png.enc"), None);
        assert_eq!(media_mime("/a/.png"), None);
    }

    #[tokio::test]
    async fn reads_a_small_image_as_a_data_url() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("shot.png");
        std::fs::write(&path, b"hi").unwrap();

        let url = read_media_data_url(path.to_str().unwrap(), MAX_INLINE_MEDIA_BYTES)
            .await
            .unwrap();
        // "hi" -> aGk=. Asserting the payload, not just the prefix: a stub that
        // returned the right header and no bytes would pass a prefix check.
        assert_eq!(url, "data:image/png;base64,aGk=");
    }

    #[tokio::test]
    async fn refuses_a_file_over_the_cap_and_says_both_numbers() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("big.png");
        std::fs::write(&path, vec![0u8; 64]).unwrap();

        let err = read_media_data_url(path.to_str().unwrap(), 8)
            .await
            .unwrap_err();
        assert_eq!(err, "TOO_LARGE:64:8");
    }

    /// ‼️ THE BYPASS THIS GUARD EXISTS FOR. `tokio::fs::metadata` and
    /// `tokio::fs::read` both FOLLOW symlinks, so before `symlink_metadata` was
    /// used here a link named `cat.png` pointing at `~/.ssh/id_rsa` was admitted
    /// by the extension check and read through — returning
    /// `data:image/png;base64,<private key>`, which the frontend already ships a
    /// decoder for (`decodeBase64DataUrl`).
    ///
    /// The MIME comes from the PATH's extension, never from the file's content,
    /// so nothing downstream can notice that the bytes are not an image. That is
    /// why the allowlist is the only thing narrowing this command, and why a hole
    /// in it is a general-purpose file reader rather than a media-shaped one.
    #[cfg(unix)]
    #[tokio::test]
    async fn refuses_a_symlink_even_when_it_is_named_like_an_image() {
        let dir = tempfile::tempdir().unwrap();
        let secret = dir.path().join("id_rsa");
        std::fs::write(&secret, b"SECRET-PRIVATE-KEY").unwrap();
        let link = dir.path().join("cat.png");
        std::os::unix::fs::symlink(&secret, &link).unwrap();

        let err = read_media_data_url(link.to_str().unwrap(), MAX_INLINE_MEDIA_BYTES)
            .await
            .unwrap_err();
        assert_eq!(err, "not a regular file: cat.png");
    }

    /// A FIFO named `.png`: `read` on one BLOCKS until a writer appears, holding a
    /// tokio blocking thread forever. The same `is_file()` check refuses it, which
    /// is why this test and the symlink test guard one line between them.
    #[cfg(unix)]
    #[tokio::test]
    async fn refuses_a_fifo_named_like_an_image() {
        let dir = tempfile::tempdir().unwrap();
        let fifo = dir.path().join("pipe.png");
        // `mkfifo(1)` rather than a new `libc` dependency for one test line.
        let status = std::process::Command::new("mkfifo")
            .arg(&fifo)
            .status()
            .expect("mkfifo");
        assert!(status.success(), "mkfifo failed");

        let err = read_media_data_url(fifo.to_str().unwrap(), MAX_INLINE_MEDIA_BYTES)
            .await
            .unwrap_err();
        assert_eq!(err, "not a regular file: pipe.png");
    }

    /// A directory named `.png`. `metadata` succeeds on one, so without the
    /// `is_file()` check this reached `read` and failed with a confusing OS error
    /// instead of a refusal.
    #[tokio::test]
    async fn refuses_a_directory_named_like_an_image() {
        let dir = tempfile::tempdir().unwrap();
        let masquerade = dir.path().join("folder.png");
        std::fs::create_dir(&masquerade).unwrap();

        let err = read_media_data_url(masquerade.to_str().unwrap(), MAX_INLINE_MEDIA_BYTES)
            .await
            .unwrap_err();
        assert_eq!(err, "not a regular file: folder.png");
    }

    /// ‼️ The lead asked me to VERIFY rather than assume that
    /// `refuses_everything_that_is_not_media`'s promise now holds. That test only
    /// checks `media_mime`, which never touches the disk — so it says nothing
    /// about a path whose NAME passes. This is the same list, reached the way an
    /// attacker would actually reach it: through a symlink with an admitted
    /// extension, all the way through the real read function.
    #[cfg(unix)]
    #[tokio::test]
    async fn the_refusal_list_holds_through_a_symlink_too() {
        let dir = tempfile::tempdir().unwrap();
        for (i, secret) in [
            "id_rsa",
            "passwd",
            "login.keychain-db",
            "wallet.json",
            ".bashrc",
        ]
        .iter()
        .enumerate()
        {
            let target = dir.path().join(secret);
            std::fs::write(&target, b"SECRET").unwrap();
            let link = dir.path().join(format!("innocent{i}.png"));
            std::os::unix::fs::symlink(&target, &link).unwrap();

            let err = read_media_data_url(link.to_str().unwrap(), MAX_INLINE_MEDIA_BYTES)
                .await
                .unwrap_err();
            assert!(
                err.starts_with("not a regular file:"),
                "{secret} was reachable through a .png symlink: {err}"
            );
        }
    }

    /// The extension is checked BEFORE the file is touched, so the command cannot be
    /// used to probe for the existence of non-media files: a missing `.png` and a
    /// present `.pem` must fail differently, and only the `.png` may reach the disk.
    #[tokio::test]
    async fn checks_the_extension_before_touching_the_disk() {
        let dir = tempfile::tempdir().unwrap();
        let secret = dir.path().join("id_rsa");
        std::fs::write(&secret, b"PRIVATE KEY").unwrap();

        let err = read_media_data_url(secret.to_str().unwrap(), MAX_INLINE_MEDIA_BYTES)
            .await
            .unwrap_err();
        assert!(err.starts_with("not a media file:"), "got {err}");

        let missing = dir.path().join("nope.png");
        let err = read_media_data_url(missing.to_str().unwrap(), MAX_INLINE_MEDIA_BYTES)
            .await
            .unwrap_err();
        assert!(err.starts_with("cannot be measured:"), "got {err}");
    }
}
