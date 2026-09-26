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
/// before the read moved here (plan 0109 P8).
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
    let root = install_root(InstallKind::Theme)?;
    tokio::task::spawn_blocking(move || import_theme_file_in(&path, &root))
        .await
        // Not interpolated, for `stage_install`'s reason: a panic payload can carry absolute paths.
        .map_err(|_| PluginError::Refused("the theme import task did not finish".into()))?
}

fn import_theme_file_in(path: &Path, theme_root: &Path) -> Result<ThemeImportPick, PluginError> {
    let mut file = File::open(path)?;
    let len = file.metadata()?.len();
    let mut head = [0u8; 4];
    let is_zip = len >= ZIP_MAGIC.len() as u64 && {
        file.read_exact(&mut head)?;
        head == ZIP_MAGIC
    };
    file.seek(SeekFrom::Start(0))?;
    if is_zip {
        read_package(file, len, path, theme_root)
    } else {
        read_colors(file, len)
    }
}

/// ‼️ SIZE BEFORE READ, then a bounded read — the file can grow between `metadata` and `read`,
/// so the read itself stops one byte past the cap and that byte is the second check.
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

fn read_colors(file: File, len: u64) -> Result<ThemeImportPick, PluginError> {
    if len > MAX_THEME_COLORS_IMPORT_BYTES {
        return Ok(ThemeImportPick::TooLarge {
            format: ImportFormat::Colors,
        });
    }
    let mut text = String::new();
    // Invalid UTF-8 surfaces as an io::Error (InvalidData) → the frontend's generic "could not read".
    file.take(MAX_THEME_COLORS_IMPORT_BYTES + 1)
        .read_to_string(&mut text)?;
    if text.len() as u64 > MAX_THEME_COLORS_IMPORT_BYTES {
        return Ok(ThemeImportPick::TooLarge {
            format: ImportFormat::Colors,
        });
    }
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
        match import_theme_file_in(&path, root.path()).unwrap() {
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
            import_theme_file_in(&path, root.path()).unwrap()
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
        match import_theme_file_in(&path, root.path()).unwrap() {
            ThemeImportPick::Colors { text } => assert_eq!(text, r#"{"name":"x"}"#),
            other => panic!("expected colour text, got {other:?}"),
        }
    }

    // 무엇이 이것을 실패시키는가: 크기를 보기 전에 읽으면, 거대한 파일이 메모리에 다 올라온 뒤에야 거부된다.
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
            import_theme_file_in(&path, root.path()).unwrap(),
            ThemeImportPick::TooLarge {
                format: ImportFormat::Colors
            }
        ));
    }

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
            import_theme_file_in(&path, root.path()).unwrap(),
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
        let err = import_theme_file_in(&path, root.path()).unwrap_err();
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
        let err = import_theme_file_in(&path, root.path()).unwrap_err();
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
        let package =
            serde_json::to_value(import_theme_file_in(&path, root.path()).unwrap()).unwrap();
        assert_eq!(package["kind"], "package");
        assert_eq!(package["fileName"], "look.zip");
        assert!(package["staged"]["stage_id"].is_string());
    }
}
