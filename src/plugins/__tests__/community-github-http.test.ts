// §380 — the GitHub HTTP primitives: `githubGet`'s request/response shape and `repoFacts`'s
// numeric-id extraction from a repository lookup (plan 0105 Task 7).
import { describe, expect, it } from "vitest";

import { githubGet, repoFacts } from "../../../scripts/community-github";
import { fakeGithub, ok, repoReply } from "./community-gate-fixtures";

describe("githubGet", () => {
  it("requests the exact URL and the exact headers, and its reply never carries the token", async () => {
    const calls: { init: { headers: Record<string, string> }; url: string }[] =
      [];
    const fetchImpl = (
      url: string,
      init: { headers: Record<string, string> },
    ) => {
      calls.push({ init, url });
      return Promise.resolve({
        status: 200,
        text: () => Promise.resolve('{"ok":true}'),
      });
    };
    const get = githubGet("s3cr3t-token", fetchImpl);
    const reply = await get("repos/octocat/hello");

    expect(calls).toEqual([
      {
        init: {
          headers: {
            Accept: "application/vnd.github+json",
            Authorization: "Bearer s3cr3t-token",
            "X-GitHub-Api-Version": "2022-11-28",
          },
        },
        url: "https://api.github.com/repos/octocat/hello",
      },
    ]);
    expect(reply).toEqual({ body: { ok: true }, status: 200 });
    expect(JSON.stringify(reply)).not.toContain("s3cr3t-token");
  });

  it("treats a 200 with an HTML body as no body — GitHub never answers the REST API that way, but a proxy or an outage page might", async () => {
    const get = githubGet("t", () =>
      Promise.resolve({
        status: 200,
        text: () => Promise.resolve("<html><body>Not JSON</body></html>"),
      }),
    );
    expect(await get("repos/x/y")).toEqual({ body: null, status: 200 });
  });

  it("treats an empty body as no body", async () => {
    const get = githubGet("t", () =>
      Promise.resolve({ status: 204, text: () => Promise.resolve("") }),
    );
    expect(await get("repos/x/y")).toEqual({ body: null, status: 204 });
  });
});

describe("repoFacts", () => {
  it("reads the numbers", async () => {
    expect(
      await repoFacts(
        fakeGithub({ "repos/octocat/baram-hello-counter": repoReply() }),
        "octocat/baram-hello-counter",
      ),
    ).toEqual({
      facts: {
        fullName: "octocat/baram-hello-counter",
        isPrivate: false,
        ownerId: 583231,
        ownerType: "User",
        repoId: 555,
      },
      ok: true,
    });
  });

  it("refuses a repository GitHub does not show", async () => {
    expect(await repoFacts(fakeGithub({}), "octocat/gone")).toEqual({
      error: "octocat/gone is not a public repository GitHub can see",
      ok: false,
    });
  });

  it("refuses a non-404 error status from GitHub", async () => {
    expect(
      await repoFacts(
        fakeGithub({ "repos/octocat/down": { body: null, status: 500 } }),
        "octocat/down",
      ),
    ).toEqual({
      error: "GitHub answered HTTP 500 for octocat/down",
      ok: false,
    });
  });

  it.each([
    [
      "full_name is missing",
      { id: 555, owner: { id: 583231, type: "User" }, private: false },
    ],
    [
      "id is not a positive integer",
      {
        full_name: "octocat/x",
        id: 0,
        owner: { id: 583231, type: "User" },
        private: false,
      },
    ],
    [
      "owner id is not a positive integer",
      {
        full_name: "octocat/x",
        id: 555,
        owner: { id: -1, type: "User" },
        private: false,
      },
    ],
    [
      "owner type is missing",
      {
        full_name: "octocat/x",
        id: 555,
        owner: { id: 583231 },
        private: false,
      },
    ],
    [
      "private is not a boolean",
      {
        full_name: "octocat/x",
        id: 555,
        owner: { id: 583231, type: "User" },
        private: "false",
      },
    ],
  ])("refuses a 200 body where %s", async (_label, body) => {
    expect(
      await repoFacts(fakeGithub({ "repos/octocat/x": ok(body) }), "octocat/x"),
    ).toEqual({
      error: "GitHub's answer for octocat/x is missing its ids",
      ok: false,
    });
  });
});
