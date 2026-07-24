import { Component, type ErrorInfo, type ReactNode } from "react";

import { logger } from "../utils/logger";

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
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
      if (this.props.fallback) {
        return this.props.fallback;
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
