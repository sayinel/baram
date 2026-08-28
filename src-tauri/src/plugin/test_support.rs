//! Test-only fixtures shared across more than one submodule's `#[cfg(test)] mod tests`.
//!
//! A private item is visible to its defining module's descendants only, never to siblings —
//! the reason `zip_of` and `LIVE_INDEX` used to live at the flat `mod tests` level before the
//! plugin module was split into files (see the `#[261 archive expansion bounds]` history).
//! `pub(super)` here puts both at the `plugin` level, which every submodule's own test module
//! can reach via `super::super::test_support::…`. `mod.rs` gates this whole module behind
//! `#[cfg(test)]` already, so it is not repeated here.

/// The live registry index URL. Shared between `origin.rs` and `fetch.rs` test modules.
pub(super) const LIVE_INDEX: &str = "https://sayinel.github.io/baram-plugins/index.json";

/// A throwaway minisign key pair (generated with `tauri signer generate`, exactly as the real
/// one was) and a signature it produced over `SIGNED_BODY`. Shared between `origin.rs`'s
/// verification tests and the one `fetch.rs` test that drives `verified_revocations` — static
/// fixtures rather than signing at test time, since `minisign-verify` only verifies, which is
/// the whole point: nothing in the app can mint a signature, so nothing in the tests should
/// either.
pub(super) const TEST_PUBLIC_KEY: &str = "dW50cnVzdGVkIGNvbW1lbnQ6IG1pbmlzaWduIHB1YmxpYyBrZXk6IDk5MkMwMTZFMUZDQkEwNTEKUldSUm9Nc2ZiZ0VzbVRBMUFCSWpaeUZhNW45amZTMk93d0VNZkMwUVVlWCtIdDBKRnF4eEUyV24K";
pub(super) const TEST_SIGNATURE: &str = "dW50cnVzdGVkIGNvbW1lbnQ6IHNpZ25hdHVyZSBmcm9tIHRhdXJpIHNlY3JldCBrZXkKUlVSUm9Nc2ZiZ0VzbVZsTlRWaTNzQ09CaEdZOW8zZXVwV21laDlWcGg3V1lZNW9OT3RMT1JUZ3UrdWwvckFaaVJKMmovaVdNeE5seVJlYlcwaU1LdUZ6dEN2OEo3ODdJR0F3PQp0cnVzdGVkIGNvbW1lbnQ6IHRpbWVzdGFtcDoxNzg1NzMyODI3CWZpbGU6cmV2b2tlZC5qc29uCmxldG9xTmFJSmJ5cDh4NklhdkpSOU00ZEE2MWZDcUtSdHVpK0JsT0hubFBEOExyL0Mxem9ENm9ab0xEL01VK0dFRFlJT0w2dmUwcWdMQ0F0bndkMUJ3PT0K";
pub(super) const SIGNED_BODY: &[u8] = br#"{"version":1,"sequence":1,"revoked":[]}"#;

/// A deflated archive of `entries`, built in memory. Shared across `archive.rs`, `fetch.rs`,
/// and `install.rs` test modules (via `plugin_zip` in the latter).
pub(super) fn zip_of(entries: &[(&str, &[u8])]) -> Vec<u8> {
    use std::io::Write;
    let mut buf = std::io::Cursor::new(Vec::<u8>::new());
    {
        let mut writer = zip::write::ZipWriter::new(&mut buf);
        let opts = zip::write::SimpleFileOptions::default()
            .compression_method(zip::CompressionMethod::Deflated);
        for (name, body) in entries {
            writer.start_file(*name, opts).unwrap();
            writer.write_all(body).unwrap();
        }
        writer.finish().unwrap();
    }
    buf.into_inner()
}
