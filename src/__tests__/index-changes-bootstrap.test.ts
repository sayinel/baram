// §29 #824 The `index:changed` subscription is in place before the app — and so any
// writer — exists: Rust emits before a write resolves, and an event with no listener is
// lost. Read from the entry module's source: mounting the bootstrap would test the mocks.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const MAIN = readFileSync(join(__dirname, "..", "main.tsx"), "utf8");

describe("main.tsx bootstrap", () => {
  // 이것을 실패시키는 것: `installIndexChanges` 를 `App` import 뒤로(또는 React tree 안으로) 옮긴다.
  it("awaits the index:changed subscription before importing the app", () => {
    const subscribed = MAIN.indexOf("await installIndexChanges()");
    const app = MAIN.indexOf('await import("./App")');
    expect(subscribed).toBeGreaterThan(0);
    expect(app).toBeGreaterThan(0);
    expect(subscribed).toBeLessThan(app);
  });
});
