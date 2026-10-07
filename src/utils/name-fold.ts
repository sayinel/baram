// §390 Link names compared across Unicode normalization (spec 0069 D2, D4).

/**
 * The key two link names are compared under — a note's name, a link's target,
 * a vault alias: NFC, then lowercase, then NFC. The backend folds its link
 * index keys the same way (`fold_name` in src-tauri/src/index/normalizer.rs),
 * and the cases in src-tauri/src/md/fixtures/name-fold.json hold the two to
 * one result.
 *
 * Why NFC: a name typed on a keyboard is composed (NFC), while some macOS
 * tools store file names decomposed (NFD) — one name, two strings. Why the
 * last NFC: lowercasing can leave a letter and its mark apart (capital `J`
 * with a caron lowercases to `j` + caron) where a name typed in lowercase
 * holds the composed letter (U+01F0).
 *
 * ‼️ Names and link targets only. Whether a path lies under a root is
 * `isUnderRoot`'s question, which folds ASCII case alone (`foldAsciiCase`),
 * and only when asked to.
 * ‼️ Never cut an unfolded string at an index or length measured on a folded
 * one: folding changes length — NFC joins a decomposed syllable into one code
 * unit, and lowercasing `İ` gives two.
 * ‼️ Compare strings of one shape, a name with a name and a path with a path:
 * Greek capital sigma lowercases by what follows it (`ΑΣ` → `ας`,
 * `ΑΣ.md` → `ασ.md`).
 */
export function foldName(s: string): string {
  return s.normalize("NFC").toLowerCase().normalize("NFC");
}
