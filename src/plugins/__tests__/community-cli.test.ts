// §380/§381 — the readers the community CLIs share. A missing value is the calling workflow's
// bug, not a verdict about a submission, so it exits 2 — the code a refusal (1) never uses.
import { afterEach, describe, expect, it, vi } from "vitest";

import { flag, need, needId } from "../../../scripts/community-cli";

class Exited extends Error {
  constructor(readonly code: unknown) {
    super(`process.exit(${String(code)})`);
  }
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

/** What `run` printed to stderr and the code it exited with ("returned" if it did not exit). */
function exitOf(run: () => unknown): { code: unknown; said: string } {
  const said: string[] = [];
  vi.spyOn(console, "error").mockImplementation((line: unknown) => {
    said.push(String(line));
  });
  vi.spyOn(process, "exit").mockImplementation((code) => {
    throw new Exited(code);
  });
  try {
    run();
  } catch (thrown) {
    if (thrown instanceof Exited)
      return { code: thrown.code, said: said.join("\n") };
    throw thrown;
  }
  return { code: "returned", said: said.join("\n") };
}

const NAME = "BARAM_COMMUNITY_CLI_TEST_VALUE";

describe("need — an environment variable the workflow must set", () => {
  it("answers with the value", () => {
    vi.stubEnv(NAME, "sayinel/baram-plugins");
    expect(need("community gate", NAME)).toBe("sayinel/baram-plugins");
  });

  it.each([
    ["unset", undefined],
    ["empty", ""],
  ])("exits 2 when it is %s", (_label, value) => {
    vi.stubEnv(NAME, value);
    expect(exitOf(() => need("community gate", NAME))).toEqual({
      code: 2,
      said: `✗ community gate: ${NAME} is not set — a bug in the workflow that runs this, not a verdict`,
    });
  });
});

describe("flag — a command-line value the workflow must pass", () => {
  const argv = ["node", "cli.ts", "--pr-root", "pr", "--base-url"];

  it("answers with the argument after the flag", () => {
    expect(flag("community gate", "--pr-root", argv)).toBe("pr");
  });

  it.each([
    ["absent", "--published-root"],
    ["last, with no value", "--base-url"],
  ])("exits 2 when the flag is %s", (_label, name) => {
    expect(exitOf(() => flag("community gate", name, argv))).toEqual({
      code: 2,
      said: `✗ community gate: ${name} <value> is required`,
    });
  });

  it("exits 2 when the next argument is another flag, rather than taking it as the value", () => {
    expect(
      exitOf(() =>
        flag("community publish", "--registry", [
          "--registry",
          "--report",
          "r.json",
        ]),
      ),
    ).toEqual({
      code: 2,
      said: "✗ community publish: --registry <value> is required",
    });
  });
});

describe("needId — a numeric GitHub id the workflow passes", () => {
  it("answers with the number", () => {
    vi.stubEnv(NAME, "12826809");
    expect(needId("community gate", NAME)).toBe(12826809);
  });

  it.each([
    ["hex", "0x1F"],
    ["an exponent", "1e3"],
    ["a sign", "+5"],
    ["zero", "0"],
    ["a leading zero", "012"],
    ["a fraction", "5.0"],
    ["a number past 2^53", "12345678901234567890"],
    ["surrounding whitespace", " 7"],
    ["a word", "abc"],
  ])("exits 2 for %s", (_label, value) => {
    vi.stubEnv(NAME, value);
    expect(exitOf(() => needId("community gate", NAME))).toEqual({
      code: 2,
      said: `✗ community gate: ${NAME} must be a positive decimal integer — a bug in the workflow that runs this, not a verdict`,
    });
  });
});
