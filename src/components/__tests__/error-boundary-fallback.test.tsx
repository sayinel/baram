// A fallback that cannot see the error cannot explain it.
//
// `ErrorBoundary` took `fallback?: ReactNode`, so any caller supplying its own UI lost both
// the message and the reset handler — which is why the only usable fallback was the
// boundary's built-in one, and why the app root was the only place a boundary could live.
// Widening it to a render function is what lets a tab surface own its own failure (§286).
import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ErrorBoundary } from "../ErrorBoundary";

function Boom({ message }: { message: string }): never {
  throw new Error(message);
}

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("ErrorBoundary fallback", () => {
  it("hands the caught error to a function fallback", () => {
    render(
      <ErrorBoundary fallback={(error) => <p>caught: {error.message}</p>}>
        <Boom message="chunk gone" />
      </ErrorBoundary>,
    );

    expect(screen.getByText("caught: chunk gone")).toBeTruthy();
  });

  it("hands a reset handler that re-renders the children", () => {
    let failing = true;
    function Child() {
      if (failing) throw new Error("chunk gone");
      return <p>recovered</p>;
    }

    render(
      <ErrorBoundary
        fallback={(_error, retry) => <button onClick={retry}>retry</button>}
      >
        <Child />
      </ErrorBoundary>,
    );

    failing = false;
    fireEvent.click(screen.getByRole("button", { name: "retry" }));

    expect(screen.getByText("recovered")).toBeTruthy();
  });

  it("still accepts a plain node fallback", () => {
    render(
      <ErrorBoundary fallback={<p>static</p>}>
        <Boom message="chunk gone" />
      </ErrorBoundary>,
    );

    expect(screen.getByText("static")).toBeTruthy();
  });
});
