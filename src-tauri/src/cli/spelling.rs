// §389 A path read by its letters alone — its Windows prefix and its components — so that
// `baram mcp` can match a tool's `vault` argument, and an absolute path argument, against
// the spellings of the vaults it reads without asking the disk (spec 0068 §3.2). The prefix
// reading is also what `paths::locate` asks of each part it pushes onto a vault root.
//
// Each `pub(crate)` free function — `prefix_kind`, `letters`, `not_one_name` — takes the
// platform as `windows`, so the Windows shape is tested on every host by passing `true` —
// the rule issue 595 set for `index::relative_links`. Only the callers pass `cfg!(windows)`.

use icu_normalizer::ComposingNormalizerBorrowed;

/// The prefix `std`'s `parse_prefix` reads at the start of a Windows path
/// (`library/std/src/sys/path/windows_prefix.rs`, Rust 1.98.1), ported line for line. The
/// strings are the prefix's parts as written; a drive letter is in upper case, as std gives
/// it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum Prefix {
    /// `\\?\pictures`
    Verbatim(String),
    /// `\\?\UNC\server\share`
    VerbatimUnc(String, String),
    /// `\\?\C:`
    VerbatimDisk(u8),
    /// `\\.\COM42`
    DeviceNs(String),
    /// `\\server\share`
    Unc(String, String),
    /// `C:`
    Disk(u8),
}

impl Prefix {
    /// How many bytes of the path the prefix takes — `std::path::Prefix::len`.
    fn len(&self) -> usize {
        let pair = |x: &str, y: &str| {
            let share = if y.is_empty() {
                0
            } else {
                y.len().saturating_add(1)
            };
            x.len().saturating_add(share)
        };
        match self {
            Prefix::Verbatim(x) | Prefix::DeviceNs(x) => x.len().saturating_add(4),
            Prefix::VerbatimUnc(x, y) => pair(x, y).saturating_add(8),
            Prefix::VerbatimDisk(_) => 6,
            Prefix::Unc(x, y) => pair(x, y).saturating_add(2),
            Prefix::Disk(_) => 2,
        }
    }
}

/// The Windows prefix `input` starts with, as std reads it; `None` when it has none, and
/// always when `windows` is false — a Unix path has no prefix.
pub(crate) fn prefix_kind(input: &str, windows: bool) -> Option<Prefix> {
    if !windows {
        return None;
    }
    // `PrefixParser::get_prefix`: the first eight bytes, `/` read as `\`.
    let head: Vec<u8> = input
        .bytes()
        .take(8)
        .map(|byte| if byte == b'/' { b'\\' } else { byte })
        .collect();
    let has = |at: usize, wanted: &[u8]| head.get(at..).is_some_and(|h| h.starts_with(wanted));
    // Every byte the checks above match is ASCII, so these offsets fall between characters.
    let after = |at: usize| input.get(at..).unwrap_or("");
    if !has(0, br"\\") {
        return parse_drive(input).map(Prefix::Disk);
    }
    // A verbatim prefix is one written with `\` alone: "the meaning of verbatim paths can
    // change when they use a different separator".
    let written_with_slash = input.as_bytes().iter().take(4).any(|&byte| byte == b'/');
    if has(2, br"?\") && !written_with_slash {
        if has(4, br"UNC\") {
            let (server, rest) = next_component(after(8), true);
            let (share, _) = next_component(rest, true);
            return Some(Prefix::VerbatimUnc(server.into(), share.into()));
        }
        let rest = after(4);
        return Some(match parse_drive_exact(rest) {
            Some(drive) => Prefix::VerbatimDisk(drive),
            None => Prefix::Verbatim(next_component(rest, true).0.into()),
        });
    }
    if has(2, br".\") {
        return Some(Prefix::DeviceNs(next_component(after(4), false).0.into()));
    }
    let (server, rest) = next_component(after(2), false);
    let (share, _) = next_component(rest, false);
    (!server.is_empty() && !share.is_empty()).then(|| Prefix::Unc(server.into(), share.into()))
}

/// `C:` and `C:\whatever`: the drive letter, in upper case.
fn parse_drive(path: &str) -> Option<u8> {
    match path.as_bytes() {
        [drive, b':', ..] if drive.is_ascii_alphabetic() => Some(drive.to_ascii_uppercase()),
        _ => None,
    }
}

/// `C:` exactly — the drive followed by a separator or by nothing.
fn parse_drive_exact(path: &str) -> Option<u8> {
    let ends = path
        .as_bytes()
        .get(2)
        .is_none_or(|&byte| byte == b'/' || byte == b'\\');
    if ends {
        parse_drive(path)
    } else {
        None
    }
}

/// The next component and the rest after its separator. In a verbatim path only `\`
/// separates.
fn next_component(path: &str, verbatim: bool) -> (&str, &str) {
    let separates = |byte: &u8| *byte == b'\\' || (!verbatim && *byte == b'/');
    match path.as_bytes().iter().position(separates) {
        Some(at) => (
            path.get(..at).unwrap_or(""),
            path.get(at.saturating_add(1)..).unwrap_or(""),
        ),
        None => (path, ""),
    }
}

/// Where an absolute path starts, with the forms that name the same place made one: a drive
/// whether written `C:\` or `\\?\C:\`, a share whether written `\\server\share` or
/// `\\?\UNC\server\share`.
#[derive(Debug, Clone, PartialEq, Eq)]
enum Root {
    /// `/` on Unix.
    Slash,
    Drive(u8),
    /// The server and the share, in ASCII lower case.
    Share(String, String),
    /// Any other `\\?\` prefix, in ASCII lower case.
    Verbatim(String),
    /// `\\.\device`, in ASCII lower case.
    Device(String),
}

/// An absolute path as `letters` reads it.
#[derive(Debug, Clone)]
pub(crate) struct Letters {
    root: Root,
    /// The components after the root, as written, with `.` dropped and `..` applied.
    parts: Vec<String>,
    /// `parts` as they are compared: each in NFC, and when `windows` in ASCII lower case.
    keys: Vec<String>,
}

impl Letters {
    /// Whether the two name the same place by their letters.
    pub(crate) fn same_place(&self, other: &Letters) -> bool {
        self.root == other.root && self.keys == other.keys
    }

    /// The parts of this path below `root`, as written, when `root`'s letters start it
    /// component by component — `/v` does not start `/v2/a`.
    pub(crate) fn below(&self, root: &Letters) -> Option<&[String]> {
        if self.root != root.root || !self.keys.starts_with(&root.keys) {
            return None;
        }
        self.parts.get(root.keys.len()..)
    }
}

/// `path` as `baram mcp` compares spellings: its root and its components, `.` dropped and
/// `..` applied to the letters — as `paths::fold` applies them — each component compared in
/// NFC, so a name stored decomposed meets the same name typed composed (§390), and when
/// `windows` without regard to ASCII case, as Windows folds names by default (the
/// `same_component` note in `index::relative_links` says what that leaves out). `None` for a
/// path that is not absolute — on Windows a drive with no separator after it (`C:x`), or a
/// path with no prefix — and for one whose `..` climbs past its root.
pub(crate) fn letters(path: &str, windows: bool) -> Option<Letters> {
    let (root, rest, separators): (Root, &str, &[char]) = if windows {
        let prefix = prefix_kind(path, true)?;
        let rest = path.get(prefix.len()..).unwrap_or("");
        // After a drive written verbatim, and after the `\` that ends the share of a verbatim
        // UNC path — what `canonicalize` gives on Windows, so a vault's `vault.path` there —
        // `/` separates too: that is how `PathBuf::push` reads a path pushed onto such a base,
        // and so how `paths::fold` read a path argument before these letters. The prefix
        // itself is read as std reads it, so in `\\?\UNC\server\share/x` the share is
        // `share/x`. After any other `\\?\` prefix `\` alone separates, as std reads it.
        let separators: &[char] = match prefix {
            Prefix::Verbatim(_) => &['\\'],
            _ => &['/', '\\'],
        };
        let root = match prefix {
            Prefix::Disk(drive) if rest.starts_with(['/', '\\']) => Root::Drive(drive),
            // Relative to the current directory of that drive.
            Prefix::Disk(_) => return None,
            Prefix::VerbatimDisk(drive) => Root::Drive(drive),
            Prefix::Unc(server, share) | Prefix::VerbatimUnc(server, share) => {
                Root::Share(server.to_ascii_lowercase(), share.to_ascii_lowercase())
            }
            Prefix::Verbatim(name) => Root::Verbatim(name.to_ascii_lowercase()),
            Prefix::DeviceNs(name) => Root::Device(name.to_ascii_lowercase()),
        };
        (root, rest, separators)
    } else {
        (Root::Slash, path.strip_prefix('/')?, &['/'])
    };
    let mut parts: Vec<String> = Vec::new();
    for part in rest.split(separators) {
        match part {
            "" | "." => {}
            ".." => {
                parts.pop()?;
            }
            _ => parts.push(part.to_string()),
        }
    }
    let keys = parts
        .iter()
        .map(|part| {
            let composed = ComposingNormalizerBorrowed::new_nfc().normalize(part);
            if windows {
                composed.to_ascii_lowercase()
            } else {
                composed.into_owned()
            }
        })
        .collect();
    Some(Letters { root, parts, keys })
}

/// Whether `PathBuf::push` would read `part` as a path of its own rather than one more name:
/// on Windows, a part that starts with a prefix (`C:x`, which names the current directory of
/// drive `C:`) replaces the path it is pushed onto, and one that holds a separator is more
/// than one name. A folder on Windows can hold neither — `:`, `/` and `\` are among the
/// characters Windows reserves in a file name.
pub(crate) fn not_one_name(part: &str, windows: bool) -> bool {
    windows && (prefix_kind(part, true).is_some() || part.contains(['/', '\\']))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn unc(server: &str, share: &str) -> Prefix {
        Prefix::Unc(server.into(), share.into())
    }

    /// The table std's `parse_prefix` gives, read from its source (Rust 1.98.1): each input
    /// with the prefix the port reads in it. `the_prefix_is_read_as_std_reads_it_on_windows`
    /// pins it on every host; `the_port_reads_each_prefix_as_this_hosts_std_does` checks it
    /// against the std that runs, on Windows.
    fn prefix_table() -> Vec<(&'static str, Option<Prefix>)> {
        vec![
            (
                r"\\?\UNC\server\share\x",
                Some(Prefix::VerbatimUnc("server".into(), "share".into())),
            ),
            (
                r"\\?\UNC/server",
                Some(Prefix::VerbatimUnc("server".into(), String::new())),
            ),
            (r"\\?\C:", Some(Prefix::VerbatimDisk(b'C'))),
            (r"\\?\c:\x", Some(Prefix::VerbatimDisk(b'C'))),
            (r"\\?\C:x", Some(Prefix::Verbatim("C:x".into()))),
            (r"\\?\pictures\x", Some(Prefix::Verbatim("pictures".into()))),
            (r"\\.\COM42", Some(Prefix::DeviceNs("COM42".into()))),
            ("//./pipe/x", Some(Prefix::DeviceNs("pipe".into()))),
            (r"\\server\share\x", Some(unc("server", "share"))),
            ("//server/share", Some(unc("server", "share"))),
            // Verbatim only with `\`: written with `/`, the `?` is a server's name.
            ("//?/C:/x", Some(unc("?", "C:"))),
            (r"\\server", None),
            (r"\\", None),
            (r"\??\C:\x", None),
            ("C:", Some(Prefix::Disk(b'C'))),
            (r"d:\x", Some(Prefix::Disk(b'D'))),
            ("C:x", Some(Prefix::Disk(b'C'))),
            ("1:", None),
            ("/usr", None),
            ("notes", None),
            ("", None),
        ]
    }

    /// `prefix_table` holds on every host, so the Windows reading is pinned where CI has no
    /// Windows job.
    ///
    /// What fails this: a branch of the port that reads differently from std's — the
    /// verbatim form taken with `/` in it, `UNC\` looked for past the eighth byte, a UNC
    /// prefix accepted without a share.
    #[test]
    fn the_prefix_is_read_as_std_reads_it_on_windows() {
        for (input, prefix) in prefix_table() {
            assert_eq!(prefix_kind(input, true), prefix, "{input}");
        }
        assert_eq!(prefix_kind(r"\\?\C:\x", false), None);
        assert_eq!(prefix_kind("C:x", false), None);
    }

    /// On Windows, the port against the std that runs: for each input of `prefix_table`, the
    /// prefix `Path::components` reads first — kind, parts and length — is the port's. The
    /// table was read from std's source; this asks std itself, so a std that reads a prefix
    /// differently turns this red where the table cannot.
    ///
    /// What fails this: the port and this host's std disagreeing on any input of the table.
    #[cfg(windows)]
    #[test]
    fn the_port_reads_each_prefix_as_this_hosts_std_does() {
        use std::path::{Component, Path, Prefix as Std};
        let text = |s: &std::ffi::OsStr| s.to_string_lossy().into_owned();
        for (input, _) in prefix_table() {
            let from_std = match Path::new(input).components().next() {
                Some(Component::Prefix(prefix)) => Some((
                    match prefix.kind() {
                        Std::Verbatim(x) => Prefix::Verbatim(text(x)),
                        Std::VerbatimUNC(x, y) => Prefix::VerbatimUnc(text(x), text(y)),
                        Std::VerbatimDisk(drive) => Prefix::VerbatimDisk(drive),
                        Std::DeviceNS(x) => Prefix::DeviceNs(text(x)),
                        Std::UNC(x, y) => Prefix::Unc(text(x), text(y)),
                        Std::Disk(drive) => Prefix::Disk(drive),
                    },
                    prefix.as_os_str().len(),
                )),
                _ => None,
            };
            let from_port = prefix_kind(input, true).map(|prefix| {
                let len = prefix.len();
                (prefix, len)
            });
            assert_eq!(from_port, from_std, "{input}");
        }
    }

    /// The bytes a prefix takes are std's `Prefix::len`: what follows is the path's root.
    #[test]
    fn a_prefix_takes_the_bytes_std_says() {
        for (input, len) in [
            (r"\\?\UNC\s\h\x", 11),
            (r"\\?\C:\x", 6),
            (r"\\?\pics\x", 8),
            (r"\\.\COM42", 9),
            (r"\\s\h\x", 5),
            (r"C:\x", 2),
        ] {
            let prefix = prefix_kind(input, true).expect(input);
            assert_eq!(prefix.len(), len, "{input}");
        }
    }

    fn same(a: &str, b: &str, windows: bool) -> bool {
        match (letters(a, windows), letters(b, windows)) {
            (Some(a), Some(b)) => a.same_place(&b),
            _ => false,
        }
    }

    /// On Windows a drive is one place however its prefix is written, and so is a share; a
    /// name compares without regard to ASCII case, and only ASCII case.
    ///
    /// What fails this: `\\?\C:` kept apart from `C:` — `canonicalize` gives the first, a
    /// user types the second; case folded on Unix, or past ASCII.
    #[test]
    fn on_windows_the_prefixes_that_name_one_place_compare_alike() {
        for (a, b) in [
            (r"C:\Vault\a", r"\\?\c:\vault\A"),
            (r"C:/Vault/a/", r"C:\vault\a"),
            (r"\\Server\Share\v", r"\\?\UNC\server\share\V"),
            ("//server/share/v", r"\\server\share\v"),
            (r"C:\v\x\..\.\a", r"C:\v\a"),
        ] {
            assert!(same(a, b, true), "{a} and {b}");
        }
        for (a, b) in [
            (r"C:\v", r"D:\v"),
            (r"\\s\h\v", r"\\s\other\v"),
            (r"C:\v", r"\\?\pictures\v"),
            ("C:\\\u{c9}cole", "C:\\\u{e9}cole"),
        ] {
            assert!(!same(a, b, true), "{a} and {b}");
        }
        assert!(!same("/Vault", "/vault", false));
        assert!(same("/vault/./a//", "/vault/a", false));
    }

    /// After a plain verbatim prefix only `\` separates and `..` is still a component, as std
    /// reads it; `..` past the root, and a path that is not absolute, are no place.
    #[test]
    fn the_components_are_the_ones_std_reads() {
        assert!(same(r"\\?\C:\v\x\..", r"C:\v", true));
        assert!(!same(r"\\?\pictures\a/b", r"\\?\pictures\a\b", true));
        for relative in ["C:x", r"\v", "v", "", r"C:\.."] {
            assert!(letters(relative, true).is_none(), "{relative}");
        }
        for relative in ["v", "", "/..", "/v/../.."] {
            assert!(letters(relative, false).is_none(), "{relative}");
        }
    }

    /// After a drive written verbatim, and after the `\` that ends the share of a verbatim UNC
    /// path — `\\?\C:\`, `\\?\UNC\server\share\`, the form `canonicalize` gives on Windows and
    /// so a vault's `vault.path` there — `/` separates too, as `PathBuf::push` reads a path
    /// pushed onto such a base: before the letters, `paths::fold` pushed each component, and a
    /// path argument built from `vault.path` with `/` was read. The share itself ends at a `\`
    /// only, as std's prefix reading has it: `\\?\UNC\s\h/v` names the share `h/v`.
    ///
    /// What fails this: the rest after `\\?\C:` split on `\` alone — `Vault/notes/a.md` and
    /// `notes/a.md` are then one name each, so neither input lies below the root.
    #[test]
    fn after_a_verbatim_drive_or_share_a_slash_separates_too() {
        let root = letters(r"\\?\C:\Vault", true).unwrap();
        let below = ["notes".to_string(), "a.md".to_string()];
        for input in [r"\\?\C:\Vault/notes/a.md", r"\\?\C:\Vault\notes/a.md"] {
            let path = letters(input, true).unwrap();
            assert_eq!(path.below(&root), Some(&below[..]), "{input}");
        }
        assert!(same(r"\\?\UNC\s\h\v/a", r"\\s\h\v\a", true));
        assert!(same(r"\\?\C:\v\x/..", r"C:\v", true));
        assert!(!same(r"\\?\UNC\s\h/v", r"\\s\h\v", true));
    }

    /// A name stored decomposed is the same name typed composed (§390).
    #[test]
    fn a_component_compares_in_nfc() {
        let (composed, decomposed) = ("\u{d68c}\u{c758}", "\u{1112}\u{116c}\u{110b}\u{1174}");
        assert!(same(
            &format!("/v/{composed}"),
            &format!("/v/{decomposed}"),
            false
        ));
        assert!(same(
            &format!(r"C:\v\{composed}"),
            &format!(r"\\?\C:\v\{decomposed}"),
            true
        ));
        assert!(!same("/v/a", &format!("/v/{decomposed}"), false));
    }

    /// `below` answers by whole components and keeps the rest as written.
    #[test]
    fn what_lies_below_a_root_is_kept_as_written() {
        let root = letters("/v", false).unwrap();
        let path = letters("/v/Notes/./a.md", false).unwrap();
        assert_eq!(
            path.below(&root),
            Some(&["Notes".to_string(), "a.md".to_string()][..])
        );
        assert_eq!(letters("/v2/a.md", false).unwrap().below(&root), None);
        let root = letters(r"\\?\C:\Vault", true).unwrap();
        let path = letters(r"c:\vault\Notes\a.md", true).unwrap();
        assert_eq!(
            path.below(&root),
            Some(&["Notes".to_string(), "a.md".to_string()][..])
        );
    }

    /// What fails this: a part with a drive or a separator taken as one name on Windows; a
    /// Unix name refused for a `:` or a `\`, which Unix allows in a name.
    #[test]
    fn a_part_that_is_not_one_name_on_windows_is_told() {
        for part in ["C:x", "c:", "a:b.md", "//s/h", "a/b", r"a\b"] {
            assert!(not_one_name(part, true), "{part}");
        }
        for part in ["C:x", "a:b.md", r"a\b", "a.md"] {
            assert!(!not_one_name(part, false), "{part}");
        }
        for part in ["notes", "a.md", "1:x"] {
            assert!(!not_one_name(part, true), "{part}");
        }
    }
}
