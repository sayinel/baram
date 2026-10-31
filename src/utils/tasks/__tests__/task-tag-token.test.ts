// §312 · §56m 줄 원문에 태그가 **쓰는 쪽 기준으로** 있는가.
//
// 행은 `src-tauri/src/task/fixtures/tag-boundary.json`에 있고, Rust `find_tag`의 시험
// (`task::tag::tests::tag_boundary_table_is_shared_with_the_front_end`)도 같은 파일을 읽는다.
// 두 벌이 된 규칙이므로 같은 행에 고정하지 않으면 어긋난 것을 알 방법이 없다 — 어긋나는
// 순간 메뉴가 할 수 없는 일을 약속한다(MODERATE-1).
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { lineHasTag } from "../task-tag-token";

interface BoundaryRow {
  found: boolean;
  line: string;
  read: boolean;
  why: string;
}

const table = JSON.parse(
  readFileSync(
    join(process.cwd(), "src-tauri/src/task/fixtures/tag-boundary.json"),
    "utf8",
  ),
) as { rows: BoundaryRow[] };

describe("lineHasTag — 쓰는 쪽 경계", () => {
  it("읽는 행이 양쪽 답을 다 담는다", () => {
    expect(table.rows.some((row) => row.found)).toBe(true);
    expect(table.rows.some((row) => !row.found)).toBe(true);
  });

  // What fails this: a `TAG_CHAR_RE` other than the reader's class — dropping any one of
  // its parts, or `\p{L}` for `\p{Alphabetic}` (the `Ⅻ` row), or `\p{N}` for `\p{Nd}` (the
  // `½` row), answers some row the other way; a boundary before the `#` read by JavaScript's
  // `\s` (the U+0085 and U+FEFF rows); or the character after the tag read as one UTF-16
  // unit (the U+20000 row).
  it.each(table.rows)("$line → $found ($why)", (row) => {
    expect(lineHasTag(row.line, "someday")).toBe(row.found);
  });
});
