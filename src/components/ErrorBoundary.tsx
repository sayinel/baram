import { Component, type ErrorInfo, type ReactNode } from "react";

import { logger } from "../utils/logger";

interface Props {
  children: ReactNode;
  /**
   * Either a fixed node, or a render function receiving the caught error and a reset
   * handler.
   *
   * ‼️ The function form is what lets a boundary live somewhere other than the app root.
   * With `ReactNode` alone a caller's own fallback could see neither the message nor the
   * reset, so the only fallback worth using was this class's built-in one — and a boundary
   * whose fallback fills the window can only be mounted at the top. §286 tab surfaces need
   * the opposite: a failure that stays inside one pane and can say what happened.
   */
  fallback?: ((error: Error, retry: () => void) => ReactNode) | ReactNode;
}

interface State {
  componentStack: null | string;
  error: Error | null;
  hasError: boolean;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { componentStack: null, error: null, hasError: false };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error, hasError: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    logger.error("ErrorBoundary caught:", error, info.componentStack);
    this.setState({ componentStack: info.componentStack ?? null });
  }

  render(): ReactNode {
    if (this.state.hasError) {
      const { fallback } = this.props;
      if (typeof fallback === "function") {
        // `state.error` is set together with `hasError` by getDerivedStateFromError, so it is
        // non-null here; the fallback is spared a null check it could not act on anyway.
        return fallback(
          this.state.error ?? new Error("Unknown error"),
          this.handleRetry,
        );
      }
      if (fallback) {
        return fallback;
      }
      return (
        <div style={{ padding: "2rem", textAlign: "center" }}>
          <h2>Something went wrong</h2>
          <p
            style={{ color: "var(--color-text-secondary)", margin: "0.5rem 0" }}
          >
            {this.state.error?.message}
          </p>
          {/* Surface the stack so release-build crashes are diagnosable
              without devtools access */}
          <details
            style={{ margin: "1rem auto", maxWidth: 720, textAlign: "left" }}
          >
            <summary style={{ cursor: "pointer" }}>Details</summary>
            <pre
              style={{
                fontSize: 12,
                overflow: "auto",
                whiteSpace: "pre-wrap",
              }}
            >
              {this.state.error?.stack}
              {this.state.componentStack}
            </pre>
          </details>
          <button
            onClick={this.handleRetry}
            style={{
              marginTop: "1rem",
              marginRight: "0.5rem",
              padding: "0.5rem 1rem",
              cursor: "pointer",
            }}
          >
            Retry
          </button>
          <button
            onClick={() => window.location.reload()}
            style={{
              marginTop: "1rem",
              padding: "0.5rem 1rem",
              cursor: "pointer",
            }}
          >
            Reload
          </button>
        </div>
      );
    }
    return this.props.children;
  }

  private handleRetry = (): void => {
    this.setState({ componentStack: null, error: null, hasError: false });
  };
}
