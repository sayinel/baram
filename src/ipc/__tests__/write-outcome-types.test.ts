// §29 #824 `write_file` answers a `WriteOutcome`; what the app and the plugins see of it
// does not change. The app's `writeFile` resolves to the mtime `asTabSave` records
// (#795), and both plugin surfaces keep their public `Promise<void>`.
import type { FilesAPI, SandboxFilesAPI } from "../../plugins/types";
import type { WriteOutcome } from "../types";

import { describe, expectTypeOf, it } from "vitest";

import { writeFile } from "../fs";

describe("the write result each caller sees", () => {
  // 이것을 실패시키는 것: `writeFile` 이 `WriteOutcome` 을 그대로 돌려준다(`asTabSave` 가 mtime 대신 객체를 받는다).
  it("is the mtime for the app and void for plugins", () => {
    expectTypeOf(writeFile).returns.resolves.toEqualTypeOf<number>();
    expectTypeOf<FilesAPI["writeFile"]>().returns.toEqualTypeOf<
      Promise<void>
    >();
    expectTypeOf<SandboxFilesAPI["writeFile"]>().returns.toEqualTypeOf<
      Promise<void>
    >();
    expectTypeOf<WriteOutcome>().toEqualTypeOf<{
      indexFresh: boolean;
      mtime: number;
    }>();
  });
});
