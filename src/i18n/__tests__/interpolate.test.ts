// §317 t() parameter interpolation.
//
// The substitution used `String.replace` with a STRING pattern, which fills
// only the first occurrence. A message naming the same parameter twice shipped
// the second one as a literal `{date}`. Word order differs between languages,
// so repeating a parameter is an ordinary thing for a translator to do — the
// helper must not depend on how many times the token appears.
import { describe, expect, it } from "vitest";

import { t } from "../index";

describe("t() interpolation", () => {
  it("fills every occurrence of a repeated parameter", () => {
    // en.json's journal.outsideCreate names {date} twice: once for the note it
    // would create, once inside the [[Journal::…]] it teaches.
    const out = t("journal.outsideCreate", "en", { date: "2026-08-30" });

    expect(out).toContain("[[Journal::2026-08-30]]");
    expect(out).not.toContain("{date}");
  });

  it("fills a repeated parameter in Korean too", () => {
    const out = t("journal.outsideCreate", "ko", { date: "2026-08-30" });

    expect(out).toContain("[[Journal::2026-08-30]]");
    expect(out).not.toContain("{date}");
  });

  it("leaves an unrelated brace token alone", () => {
    // Only the named params are substituted — an unknown token stays put
    // rather than being blanked, so a missing param is visible, not silent.
    const out = t("journal.createConfirm", "en", {});

    expect(out).toContain("{date}");
  });
});
