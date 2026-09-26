//! §371 6a (spec 0062 §5–§6) — read the ONE file a user picked in the theme import dialog and say
//! what it is: a legacy colour settings JSON (returned as text), or a theme package (staged).
//!
//! ‼️ NO PATH EVER COMES FROM THE WEBVIEW. `commands::theme_cmd::theme_import_pick` opens the native
//! dialog itself and hands the chosen path here; that command takes no path argument (spec 0062 D8).
//! So this is not the vault boundary's question (`fs_cmd::check_vault`): the user, not the webview,
//! chose which file is read — the same shape as `approval_cmd::pick_approved_file`.
//!
//! A package is staged by the registry install's own post-download step, `install::stage_archive_in`
//! — same `ExtractBounds`, same manifest cap, same id charset — so a file and a download reach the
//! frontend as the same `StagedThemeInfo`, and everything after staging is one shared path
//! (`finishStagedThemeInstall`, `src/themes/theme-install.ts`). What a file lacks is a listing to
//! compare a checksum against; the consent dialog stands in for it (spec 0062 §6).
use std::fs::File;
use std::io::{Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};

use serde::Serialize;

use super::install::{stage_archive_in, StagedInstall, StagedThemeInfo};
use super::limits::MAX_PLUGIN_ARCHIVE_BYTES;
use super::storage::{hex_sha256, install_root, InstallKind};
use super::PluginError;

/// The legacy colour settings file's cap — the 64 KiB `use-theme-import.ts` enforced in the webview
/// before the read moved here (plan 0110 P8).
pub const MAX_THEME_COLORS_IMPORT_BYTES: u64 = 64 * 1024;

/// A ZIP local file header. The format is judged from the CONTENT, not the extension, so a renamed
/// file cannot steer itself into the wrong parser (spec 0062 §5.1).
const ZIP_MAGIC: [u8; 4] = *b"PK\x03\x04";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum ImportFormat {
    Colors,
    Package,
}

/// What the picked file turned out to be. `TooLarge` is a value rather than an error so the
/// frontend can say which cap it hit without matching on message text.
#[derive(Debug, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum ThemeImportPick {
    Colors {
        text: String,
    },
    Package {
        staged: StagedThemeInfo,
        #[serde(rename = "fileName")]
        file_name: String,
    },
    TooLarge {
        format: ImportFormat,
    },
}

/// Read `path` (chosen in the native dialog) off the async runtime — extraction is CPU- and
/// syscall-bound, the same reason `stage_install` uses `spawn_blocking` (#261).
pub async fn import_theme_file(path: PathBuf) -> Result<ThemeImportPick, PluginError> {
    tokio::task::spawn_blocking(move || {
        import_theme_file_in(&path, || install_root(InstallKind::Theme))
    })
    .await
    // Not interpolated, for `stage_install`'s reason: a panic payload can carry absolute paths.
    .map_err(|_| PluginError::Refused("the theme import task did not finish".into()))?
}

/// ‼️ `theme_root` IS A PROVIDER, NOT A VALUE (plan 0110 review round 1). `install_root` both
/// resolves `~/.baram/themes/` AND creates it if absent, so calling it unconditionally would mean
/// importing a colour settings file creates a directory it never uses, and fails outright on a
/// machine where `$HOME` cannot be resolved — a failure that has nothing to do with the colour
/// file being read. Calling the provider only once the header says ZIP keeps that cost, and that
/// failure mode, out of the colour path entirely. See
/// `a_colour_file_never_resolves_a_theme_root` for the pin.
///
/// ‼️ REGULAR FILES ONLY, CHECKED BEFORE `File::open` (plan 0110 security gate, Low-2). Opening a
/// FIFO blocks until a writer appears, and a tty or character device can block on `read` — inside
/// `spawn_blocking` that is a worker stuck forever and an import that never answers. The dialog can
/// hand back any path the user can name, so the kind is judged here: `std::fs::metadata` follows
/// symlinks, so a link to a regular file passes and a link to a FIFO does not. The second check,
/// on the opened handle, catches a path swapped to another non-regular kind between the two calls;
/// it cannot un-block an `open` that a swap to a FIFO in that window already made wait — that needs
/// a local process racing the user's own pick. See `a_fifo_is_refused_without_blocking`.
fn import_theme_file_in(
    path: &Path,
    theme_root: impl FnOnce() -> Result<PathBuf, PluginError>,
) -> Result<ThemeImportPick, PluginError> {
    if !std::fs::metadata(path)?.is_file() {
        return Err(not_a_regular_file());
    }
    let mut file = File::open(path)?;
    let meta = file.metadata()?;
    if !meta.is_file() {
        return Err(not_a_regular_file());
    }
    let len = meta.len();
    let mut head = [0u8; 4];
    let is_zip = len >= ZIP_MAGIC.len() as u64 && {
        file.read_exact(&mut head)?;
        head == ZIP_MAGIC
    };
    file.seek(SeekFrom::Start(0))?;
    if is_zip {
        let root = theme_root()?;
        read_package(file, len, path, &root)
    } else {
        read_colors(file, len)
    }
}

/// The refusal for a picked path whose kind is anything but a regular file — a directory, FIFO,
/// socket or device. One constructor so both checks in [`import_theme_file_in`] say the same thing.
fn not_a_regular_file() -> PluginError {
    PluginError::Refused("not a regular file".into())
}

/// ‼️ SIZE BEFORE READ, then a bounded read — the file can grow between `metadata` and `read`,
/// so the read itself stops one byte past the cap and that byte is the second check. Neither
/// check is provable from `a_package_over_the_registry_download_cap_is_refused_by_size` alone —
/// see `read_package_refuses_by_the_stated_length_before_any_byte_is_read` and
/// `read_package_refuses_the_bounded_read_when_the_file_grew_past_the_stated_length` for the
/// tests that actually pin each one (plan 0110 review round 1).
fn read_package(
    file: File,
    len: u64,
    path: &Path,
    theme_root: &Path,
) -> Result<ThemeImportPick, PluginError> {
    let cap = MAX_PLUGIN_ARCHIVE_BYTES as u64;
    if len > cap {
        return Ok(ThemeImportPick::TooLarge {
            format: ImportFormat::Package,
        });
    }
    let mut bytes = Vec::new();
    file.take(cap + 1).read_to_end(&mut bytes)?;
    if bytes.len() as u64 > cap {
        return Ok(ThemeImportPick::TooLarge {
            format: ImportFormat::Package,
        });
    }
    let checksum = hex_sha256(&bytes);
    let (stage_id, manifest, manifest_sha256) =
        stage_archive_in(theme_root, InstallKind::Theme, &bytes, None)?;
    let staged = StagedInstall {
        stage_id,
        checksum,
        manifest,
        manifest_sha256,
    }
    .into_theme()?;
    let file_name = path
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_default();
    Ok(ThemeImportPick::Package { staged, file_name })
}

/// See [`read_package`]'s doc for the same size-before-read / bounded-second-read shape, and
/// `read_colors_refuses_by_the_stated_length_before_any_byte_is_read` /
/// `read_colors_refuses_the_bounded_read_when_the_file_grew_past_the_stated_length` for the tests
/// that pin each half here.
fn read_colors(file: File, len: u64) -> Result<ThemeImportPick, PluginError> {
    if len > MAX_THEME_COLORS_IMPORT_BYTES {
        return Ok(ThemeImportPick::TooLarge {
            format: ImportFormat::Colors,
        });
    }
    let mut bytes = Vec::new();
    file.take(MAX_THEME_COLORS_IMPORT_BYTES + 1)
        .read_to_end(&mut bytes)?;
    if bytes.len() as u64 > MAX_THEME_COLORS_IMPORT_BYTES {
        return Ok(ThemeImportPick::TooLarge {
            format: ImportFormat::Colors,
        });
    }
    // ‼️ BYTES, NOT `read_to_string` (plan 0110 review round 1). The bounded read above can stop
    // exactly at the cap, and the cap is a byte count with no knowledge of UTF-8 boundaries — a
    // multi-byte character split there would make `read_to_string` surface `InvalidData` for a
    // file that is merely too large, before the size check even had a chance to say so.
    // Decoding AFTER both size checks means the only way here is genuinely invalid text.
    let text = String::from_utf8(bytes)
        .map_err(|e| PluginError::Io(std::io::Error::new(std::io::ErrorKind::InvalidData, e)))?;
    Ok(ThemeImportPick::Colors { text })
}

#[cfg(test)]
mod tests {
    use std::path::{Path, PathBuf};

    use super::super::test_support::zip_of;
    use super::*;

    fn theme_zip(id: &str) -> Vec<u8> {
        let manifest = format!(
            r#"{{"id":"{id}","name":"N","description":"d","version":"1.0.0",
             "author":"a","license":"MIT","engines":{{"baram":">=0.1.0"}},
             "modes":{{"light":{{"tokens":"light/tokens.json"}}}}}}"#
        );
        zip_of(&[
            ("baram-theme.json", manifest.as_bytes()),
            ("light/tokens.json", b"{}"),
        ])
    }

    fn write(dir: &Path, name: &str, bytes: &[u8]) -> PathBuf {
        let path = dir.join(name);
        std::fs::write(&path, bytes).unwrap();
        path
    }

    #[test]
    fn a_zip_is_staged_as_a_package_whatever_its_extension() {
        let files = tempfile::tempdir().unwrap();
        let root = tempfile::tempdir().unwrap();
        // ‼️ `.json` 확장자의 zip — 확장자가 아니라 내용으로 가른다(스펙 0062 §5.1).
        let path = write(files.path(), "look.json", &theme_zip("my-look"));
        match import_theme_file_in(&path, || Ok(root.path().to_path_buf())).unwrap() {
            ThemeImportPick::Package { staged, file_name } => {
                assert!(staged.manifest.contains(r#""id":"my-look""#));
                assert_eq!(file_name, "look.json");
            }
            other => panic!("expected a package, got {other:?}"),
        }
    }

    #[test]
    fn a_package_checksum_is_over_the_file_bytes() {
        let files = tempfile::tempdir().unwrap();
        let root = tempfile::tempdir().unwrap();
        let bytes = theme_zip("my-look");
        let path = write(files.path(), "look.zip", &bytes);
        let ThemeImportPick::Package { staged, .. } =
            import_theme_file_in(&path, || Ok(root.path().to_path_buf())).unwrap()
        else {
            panic!("expected a package");
        };
        assert_eq!(staged.checksum, hex_sha256(&bytes));
    }

    #[test]
    fn a_text_file_comes_back_as_colour_text() {
        let files = tempfile::tempdir().unwrap();
        let root = tempfile::tempdir().unwrap();
        let path = write(files.path(), "colors.json", br#"{"name":"x"}"#);
        match import_theme_file_in(&path, || Ok(root.path().to_path_buf())).unwrap() {
            ThemeImportPick::Colors { text } => assert_eq!(text, r#"{"name":"x"}"#),
            other => panic!("expected colour text, got {other:?}"),
        }
    }

    /// §371 6a review round 1 — a colour file must never pay for (or fail on) resolving a theme
    /// root: the provider closure panics if it is ever called, so this fails loudly rather than
    /// silently passing if `import_theme_file_in` starts calling it unconditionally again.
    #[test]
    fn a_colour_file_never_resolves_a_theme_root() {
        let files = tempfile::tempdir().unwrap();
        let path = write(files.path(), "colors.json", br#"{"name":"x"}"#);
        let result = import_theme_file_in(&path, || {
            panic!("a colour file must never resolve a theme root")
        });
        assert!(matches!(result.unwrap(), ThemeImportPick::Colors { .. }));
    }

    fn is_not_a_regular_file(err: &PluginError) -> bool {
        matches!(err, PluginError::Refused(message) if message == "not a regular file")
    }

    /// Plan 0110 security gate, Low-2. 무엇이 이것을 실패시키는가: `import_theme_file_in` 의
    /// `is_file()` 검사 **둘 다**를 지우면 디렉터리는 `File::open` 을 통과하고(unix 에서 디렉터리는
    /// 읽기 전용으로 열린다) 첫 `read_exact` 의 `Io` 오류로 끝나 red 가 된다. 하나만 지우면 남은
    /// 하나가 거부하므로 green 이다 — 열기 전 검사 하나를 고정하는 것은 아래 FIFO 테스트다.
    #[test]
    fn a_directory_is_refused_as_not_a_regular_file() {
        let files = tempfile::tempdir().unwrap();
        let dir = files.path().join("look.zip");
        std::fs::create_dir(&dir).unwrap();
        let err = import_theme_file_in(&dir, || {
            panic!("a refused path must never resolve a theme root")
        })
        .unwrap_err();
        assert!(is_not_a_regular_file(&err), "{err:?}");
    }

    /// Plan 0110 security gate, Low-2 — the case the check exists for: `File::open` on a FIFO
    /// waits for a writer that never comes. The call runs on its own thread with a deadline, so a
    /// regression FAILS this test instead of hanging the suite (the stuck thread is abandoned; the
    /// test binary exits when its main thread returns).
    ///
    /// 무엇이 이것을 실패시키는가: 열기 **전** `is_file()` 검사를 지우면 `File::open` 이 멈추고 5초
    /// 뒤 `recv_timeout` 이 red 를 낸다 — 열린 핸들을 보는 두 번째 검사로는 그 멈춤을 풀 수 없다.
    #[cfg(unix)]
    #[test]
    fn a_fifo_is_refused_without_blocking() {
        let files = tempfile::tempdir().unwrap();
        let fifo = files.path().join("look.zip");
        match std::process::Command::new("mkfifo").arg(&fifo).status() {
            Ok(status) if status.success() => {}
            other => {
                eprintln!(
                    "SKIPPED a_fifo_is_refused_without_blocking: mkfifo unavailable ({other:?})"
                );
                return;
            }
        }
        let (tx, rx) = std::sync::mpsc::channel();
        std::thread::spawn(move || {
            let result = import_theme_file_in(&fifo, || {
                panic!("a refused path must never resolve a theme root")
            });
            let _ = tx.send(result.map(|_| ()));
        });
        let result = rx
            .recv_timeout(std::time::Duration::from_secs(5))
            .expect("importing a FIFO blocked instead of being refused");
        let err = result.unwrap_err();
        assert!(is_not_a_regular_file(&err), "{err:?}");
    }

    // ‼️ 무엇이 이 둘(과 아래 패키지 테스트)이 실제로 pin 하는가: 상한이 존재하고 올바른
    // `format`을 낸다는 것뿐이다. "크기를 보기 전에 읽으면 실패한다"는 주장은 이 테스트로
    // 검증되지 않는다 — 다 읽은 뒤에 길이를 재는 구현도 여기서 똑같이 통과한다(리뷰 라운드 1
    // 실측: `take(cap + 1)`을 지우고 read-first로 바꿔도 이 두 테스트는 green이다). 그 구분은
    // `read_colors_refuses_by_the_stated_length_before_any_byte_is_read`(size-before-read) /
    // `read_colors_refuses_the_bounded_read_when_the_file_grew_past_the_stated_length`(bounded
    // second read)가 `read_colors`를 직접 불러 `len`과 실제 파일 크기를 어긋나게 만들어 낸다.
    #[test]
    fn a_colour_file_over_64_kib_is_refused_by_size() {
        let files = tempfile::tempdir().unwrap();
        let root = tempfile::tempdir().unwrap();
        let path = write(
            files.path(),
            "big.json",
            &vec![b' '; MAX_THEME_COLORS_IMPORT_BYTES as usize + 1],
        );
        assert!(matches!(
            import_theme_file_in(&path, || Ok(root.path().to_path_buf())).unwrap(),
            ThemeImportPick::TooLarge {
                format: ImportFormat::Colors
            }
        ));
    }

    // 위 콜론 테스트와 같은 한계 — 패키지 쪽 size-before-read / bounded-second-read 의 실제
    // pin 은 `read_package_refuses_by_the_stated_length_before_any_byte_is_read` /
    // `read_package_refuses_the_bounded_read_when_the_file_grew_past_the_stated_length`.
    #[test]
    fn a_package_over_the_registry_download_cap_is_refused_by_size() {
        let files = tempfile::tempdir().unwrap();
        let root = tempfile::tempdir().unwrap();
        let path = files.path().join("huge.zip");
        {
            let file = std::fs::File::create(&path).unwrap();
            use std::io::Write;
            (&file).write_all(&ZIP_MAGIC).unwrap();
            // sparse — 32 MiB 를 실제로 쓰지 않는다.
            file.set_len(MAX_PLUGIN_ARCHIVE_BYTES as u64 + 1).unwrap();
        }
        assert!(matches!(
            import_theme_file_in(&path, || Ok(root.path().to_path_buf())).unwrap(),
            ThemeImportPick::TooLarge {
                format: ImportFormat::Package
            }
        ));
    }

    /// §371 6a review round 1 — pins SIZE-BEFORE-READ for the colour path: a read-first
    /// implementation would read this tiny real file in full and return `Colors`, never
    /// consulting `len` at all. Calling `read_colors` directly, with a real file far under the
    /// cap but a stated `len` over it, isolates that ordering from the file's actual size.
    ///
    /// 무엇이 이것을 실패시키는가: `read_colors`의 첫 `if len > cap` 검사를 읽기 뒤로 옮기거나
    /// 지우면, 이 테스트는 실제 파일(2바이트)을 그대로 읽어 `Colors`를 돌려주므로 red가 된다.
    #[test]
    fn read_colors_refuses_by_the_stated_length_before_any_byte_is_read() {
        let files = tempfile::tempdir().unwrap();
        let path = write(files.path(), "tiny.json", b"{}");
        let file = File::open(&path).unwrap();
        let result = read_colors(file, MAX_THEME_COLORS_IMPORT_BYTES + 1).unwrap();
        assert!(matches!(
            result,
            ThemeImportPick::TooLarge {
                format: ImportFormat::Colors
            }
        ));
    }

    /// §371 6a review round 1 — pins the BOUNDED SECOND READ for the colour path: `len` says 0
    /// (as if the file grew between `metadata` and this read), so the first check passes, and
    /// only `take(cap + 1)` stops the read before all of a real over-cap file is loaded.
    ///
    /// 무엇이 이것을 실패시키는가: `read_colors`의 `take(MAX_THEME_COLORS_IMPORT_BYTES + 1)`을
    /// 지우면(무제한 `read_to_end`로 바꾸면), 이 테스트는 실제 파일 전체를 읽어 `Colors`를
    /// 돌려주므로 red가 된다.
    #[test]
    fn read_colors_refuses_the_bounded_read_when_the_file_grew_past_the_stated_length() {
        let files = tempfile::tempdir().unwrap();
        let bytes = vec![b' '; MAX_THEME_COLORS_IMPORT_BYTES as usize + 1024];
        let path = write(files.path(), "grown.json", &bytes);
        let file = File::open(&path).unwrap();
        let result = read_colors(file, 0).unwrap();
        assert!(matches!(
            result,
            ThemeImportPick::TooLarge {
                format: ImportFormat::Colors
            }
        ));
    }

    /// §371 6a review round 1 — [`read_colors_refuses_by_the_stated_length_before_any_byte_is_read`]
    /// for the package path: a real, tiny (4-byte) file with a stated `len` over the cap.
    #[test]
    fn read_package_refuses_by_the_stated_length_before_any_byte_is_read() {
        let files = tempfile::tempdir().unwrap();
        let root = tempfile::tempdir().unwrap();
        let path = write(files.path(), "tiny.zip", &ZIP_MAGIC);
        let file = File::open(&path).unwrap();
        let result = read_package(
            file,
            MAX_PLUGIN_ARCHIVE_BYTES as u64 + 1,
            &path,
            root.path(),
        )
        .unwrap();
        assert!(matches!(
            result,
            ThemeImportPick::TooLarge {
                format: ImportFormat::Package
            }
        ));
    }

    /// §371 6a review round 1 — [`read_colors_refuses_the_bounded_read_when_the_file_grew_past_the_stated_length`]
    /// for the package path: `len` says 0, and a real sparse file over the cap only trips
    /// `read_package`'s bounded `take(cap + 1)`.
    #[test]
    fn read_package_refuses_the_bounded_read_when_the_file_grew_past_the_stated_length() {
        let files = tempfile::tempdir().unwrap();
        let root = tempfile::tempdir().unwrap();
        let path = files.path().join("grown.zip");
        {
            let file = std::fs::File::create(&path).unwrap();
            use std::io::Write;
            (&file).write_all(&ZIP_MAGIC).unwrap();
            // sparse — 32 MiB 를 실제로 쓰지 않는다.
            file.set_len(MAX_PLUGIN_ARCHIVE_BYTES as u64 + 1).unwrap();
        }
        let file = File::open(&path).unwrap();
        let result = read_package(file, 0, &path, root.path()).unwrap();
        assert!(matches!(
            result,
            ThemeImportPick::TooLarge {
                format: ImportFormat::Package
            }
        ));
    }

    // 같은 관문을 지난다는 증거 — `stage_archive_in` 의 id 문자 집합 검사가 이 입구에도 걸린다.
    #[test]
    fn a_package_with_a_bad_id_is_refused_through_this_entry_too() {
        let files = tempfile::tempdir().unwrap();
        let root = tempfile::tempdir().unwrap();
        let path = write(files.path(), "bad.zip", &theme_zip("../escape"));
        let err = import_theme_file_in(&path, || Ok(root.path().to_path_buf())).unwrap_err();
        assert!(
            err.to_string().contains("theme id must be"),
            "unexpected: {err}"
        );
    }

    #[test]
    fn a_zip_without_a_theme_manifest_is_refused() {
        let files = tempfile::tempdir().unwrap();
        let root = tempfile::tempdir().unwrap();
        let path = write(files.path(), "x.zip", &zip_of(&[("readme.txt", b"hi")]));
        let err = import_theme_file_in(&path, || Ok(root.path().to_path_buf())).unwrap_err();
        assert!(
            err.to_string().contains("baram-theme.json not found"),
            "unexpected: {err}"
        );
    }

    #[test]
    fn the_wire_shapes_are_what_the_frontend_reads() {
        let colors = serde_json::to_value(ThemeImportPick::Colors { text: "t".into() }).unwrap();
        assert_eq!(colors, serde_json::json!({ "kind": "colors", "text": "t" }));
        let too_large = serde_json::to_value(ThemeImportPick::TooLarge {
            format: ImportFormat::Package,
        })
        .unwrap();
        assert_eq!(
            too_large,
            serde_json::json!({ "kind": "tooLarge", "format": "package" })
        );
        let files = tempfile::tempdir().unwrap();
        let root = tempfile::tempdir().unwrap();
        let path = write(files.path(), "look.zip", &theme_zip("my-look"));
        let package = serde_json::to_value(
            import_theme_file_in(&path, || Ok(root.path().to_path_buf())).unwrap(),
        )
        .unwrap();
        assert_eq!(package["kind"], "package");
        assert_eq!(package["fileName"], "look.zip");
        assert!(package["staged"]["stage_id"].is_string());
    }
}
