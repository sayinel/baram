// §394 spec 0073 D9 — a function token whose decoded name is URL-bearing is a resource reference.
//
// css-tree 3.2.1 compares a name's RAW spelling with `url` before it makes a url token, the browser
// the DECODED name. So `u\72l(//evil/x)` is a remote url token to the browser and a function token
// to css-tree, and `forEachResourceName` saw nothing. These four passed `sanitizeThemeCss` (measured
// at b516f1f4 and again while writing plan 0125); the install path stayed closed only because
// `verifyStoredThemeCss` refuses a `url` function token later. The new scan makes the refusal happen
// in sanitize, under its own code.
import { describe, expect, it } from "vitest";

import { forEachUrlBearingFunction } from "../css-refs";
import { ThemeCssError } from "../errors";
import { sanitizeThemeCss } from "../sanitize";
import { verifyStoredThemeCss } from "../verify";

/** The four shapes the second review measured passing sanitize. */
const ESCAPED_URL_FUNCTIONS = [
  "a{background:u\\72l(//evil/x)}",
  "a{background:u\\72l(https\\3a //evil/x)}",
  ":root{--x:u\\72l(//evil/x)}a{background:var(--x)}",
  "a{background:image-set(u\\72l(//evil/x) 1x)}",
];

function refusal(css: string): null | { code: string; detail: string } {
  try {
    sanitizeThemeCss(css);
    return null;
  } catch (e) {
    if (!(e instanceof ThemeCssError)) throw e;
    return { code: e.code, detail: e.detail ?? "" };
  }
}

function visits(css: string): Array<[string, null | string]> {
  const seen: Array<[string, null | string]> = [];
  forEachUrlBearingFunction(css, (name, argument) => {
    seen.push([name, argument]);
  });
  return seen;
}

describe("forEachUrlBearingFunction", () => {
  /** What fails this: comparing the raw name (`u\72l`) instead of the decoded one, or not
   *  decoding the argument (`https\3a //evil/x` would stay a relative reference). */
  it("names the decoded function and the argument a url token would carry", () => {
    expect(visits("a{background:u\\72l(https\\3a //evil/x)}")).toEqual([
      ["url", "https://evil/x"],
    ]);
    expect(visits("a{background:U\\52L( //evil/x )}")).toEqual([
      ["url", "//evil/x"],
    ]);
  });

  /** What fails this: judging an argument that holds a string, a url token or a function as one
   *  value — `"data:…" 1x` would then read as not `data:` and refuse a legitimate stored theme. */
  it("leaves an argument holding a string, a url or a function to the scans that read those", () => {
    expect(
      visits('a{background:image-set("data:image/png;base64,AA" 1x)}'),
    ).toEqual([["image-set", null]]);
    expect(visits('a{background:url( "x.png" )}')).toEqual([["url", null]]);
    expect(visits("a{background:image-set(url(a.png) 1x)}")).toEqual([
      ["image-set", null],
    ]);
    // The nested escaped url is visited on its own turn.
    expect(visits("a{background:image-set(u\\72l(//evil/x) 1x)}")).toEqual([
      ["image-set", null],
      ["url", "//evil/x"],
    ]);
  });

  /** The pair of the two above: a url TOKEN is not a function token, so this scan is silent on
   *  it — `forEachResourceName` owns it. A function outside the set is not visited either. */
  it("does not visit a url token or a function outside the set", () => {
    expect(visits("a{background:url(img/x.png)}")).toEqual([]);
    expect(visits("a{color:color-mix(in oklab,red 50%,blue)}")).toEqual([]);
  });
});

describe("sanitizeThemeCss refuses an escaped url function in its own stage", () => {
  /** What fails this: removing the `forEachUrlBearingFunction` pass from `assertNoRemoteReferences`
   *  — all four pass again (plan 0125 Task 1 Step 5 measures it). The detail names the output scan. */
  it.each(ESCAPED_URL_FUNCTIONS)(
    "%s → absoluteUrl from the output scan",
    (css) => {
      const got = refusal(css);
      expect(got?.code).toBe("absoluteUrl");
      expect(got?.detail.startsWith("output ")).toBe(true);
    },
  );

  /** What fails this: judging a `url` visit by its decoded argument. After `u\72l(a"` css-tree
   *  reads one string, so `argument` is null and the browser's live rule `b` slips
   *  through — measured in headless Chrome by the Task 1 review. The rule is on the first token
   *  after `(`, whatever `argument` holds. */
  it.each([
    'a{background:u\\72l(a");}b{background:url(https://evil/x)}c{x:")}',
    'a{background:image-set(u\\72l(a");}b{background:url(https://evil/x)}c{x:") 1x)}',
  ])("%s → refused because the browser reads no function token", (css) => {
    expect(refusal(css)?.code).toBe("absoluteUrl");
  });

  /** The positive half: the shapes a theme legitimately writes still pass, so the refusal above
   *  is the rule and not a blanket refusal of `url`/`image-set` function tokens. */
  it.each([
    "a{background:url(img/x.png)}",
    'a{background:image-set("img/x.png" 1x)}',
    "a{background:image-set(url(img/x.png) 1x)}",
    'a{background:u\\72 l("local.png")}',
    'a{background:u\\72 l( "local.png" )}',
  ])("%s still passes", (css) => {
    expect(refusal(css)).toBeNull();
  });

  /** §7's third pass row: after inlining, a stored theme holds `image-set("data:…" 1x)`. verify
   *  never calls the new scan, and its `data:` check reads the STRING token — still true. */
  it('leaves a stored image-set("data:…" 1x) to verify, which accepts it', () => {
    expect(
      verifyStoredThemeCss(
        '@layer baram-theme {\na{background:image-set("data:image/png;base64,AAAA" 1x)}\n}\n',
      ),
    ).toBe(true);
  });
});
